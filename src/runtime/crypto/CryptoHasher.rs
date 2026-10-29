use core::any::Any;
use core::ffi::c_char;
use core::ops::ControlFlow;

use bun_boringssl_sys as boring_ssl;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsPayload as _, JsWrapper};
use bun_jsc::{ErrorCode, JSGlobalObject, StringJsc as _};

use crate::crypto::evp::{AlgorithmExt as _, EVP};
use crate::crypto::{HMAC, create_crypto_error, evp};
use crate::generated_bindgen::crypto_hasher::{DigestOutput, HashOptions, HashOutput};
use crate::node::Encoding;
use crate::webcore::encoding::BunStringEncode as _;
use bun_sha_hmac::sha as hashers;

// sha3/blake2 algorithms with no BoringSSL streaming context:
// RustCrypto's `sha3`/`blake2` crates are wired into the
// `ZigHashAlgo` trait below.
use zig_crypto_algos::{Blake2s256, Sha3_224, Sha3_256, Sha3_384, Sha3_512, Shake128, Shake256};

const EVP_MAX_MD_SIZE_USIZE: usize = boring_ssl::EVP_MAX_MD_SIZE as usize;

/// `code` is from `ERR_get_error`.
#[cold]
fn crypto_error<'a>(heap: &JsHeap<'a>, code: u32) -> bindgen::Error<'a> {
    // SAFETY: makes an `Error`.
    let error = create_crypto_error(unsafe { heap.global() }, code);
    boring_ssl::ERR_clear_error();
    bindgen::Error::from_value(JsLocal::new(heap, error))
}

type MakeBuffer<'a> = fn(&JsHeap<'a>, &[u8]) -> bindgen::Result<'a, JsLocal<'a, BufferSource>>;

/// `write` gets all of `buffer`. It reads a hasher or a local array, never the bytes of an argument.
fn write_into<'a>(
    heap: &JsHeap<'a>,
    buffer: JsLocal<'a, BufferSource>,
    at_least: usize,
    write: impl FnOnce(&mut [u8]) -> bindgen::Result<'a, usize>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    // SAFETY: `write` is the last to run, and reads none of these bytes.
    unsafe {
        buffer.with_bytes_mut(heap, |bytes| {
            if bytes.len() < at_least {
                return Err(heap.invalid_arguments(format_args!(
                    "TypedArray must be at least {at_least} bytes"
                )));
            }
            write(bytes)
        })
    }?;
    Ok(buffer.as_value())
}

fn encoding_named<'a>(heap: &JsHeap<'a>, name: &[u8]) -> bindgen::Result<'a, Encoding> {
    Encoding::from(name).ok_or_else(|| {
        heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("Unknown encoding: {}", bstr::BStr::new(name)),
        )
    })
}

fn encoded<'a>(
    heap: &JsHeap<'a>,
    encoding: Encoding,
    digest: &[u8],
) -> bindgen::Result<'a, JsLocal<'a>> {
    // SAFETY: makes a string or a `Buffer`.
    let global = unsafe { heap.global() };
    let value = encoding.encode_with_max_size(global, EVP_MAX_MD_SIZE_USIZE, digest)?;
    Ok(JsLocal::new(heap, value))
}

/// node's error for an `outputLength` that the digests of `algorithm` do not have: https://github.com/nodejs/node/blob/v26.12.1/src/crypto/crypto_hash.cc#L377-L389
#[cold]
fn not_an_xof<'a>(heap: &JsHeap<'a>, algorithm: &[u8], wanted: u32) -> bindgen::Error<'a> {
    heap.error(format_args!(
        "Output length {wanted} is invalid for {}, which does not support XOF",
        bstr::BStr::new(algorithm)
    ))
}

/// `write` runs once `output` is valid, and returns the length of the digest.
fn finish<'a>(
    heap: &JsHeap<'a>,
    output: Option<DigestOutput<'a>>,
    at_least: usize,
    without_output: MakeBuffer<'a>,
    write: impl FnOnce(&mut [u8]) -> bindgen::Result<'a, usize>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    let encoding = match output {
        Some(DigestOutput::Into(buffer)) => return write_into(heap, buffer, at_least, write),
        Some(DigestOutput::Encoding(name)) => Some(encoding_named(heap, name)?),
        None => None,
    };
    let mut digest: evp::Digest = [0; EVP_MAX_MD_SIZE_USIZE];
    let length = write(&mut digest)?;
    match encoding {
        Some(encoding) => encoded(heap, encoding, &digest[..length]),
        None => Ok(without_output(heap, &digest[..length])?.as_value()),
    }
}

/// [`finish`] for a digest that is already computed, in a local array.
fn finish_with<'a>(
    heap: &JsHeap<'a>,
    output: Option<DigestOutput<'a>>,
    without_output: MakeBuffer<'a>,
    digest: &[u8],
) -> bindgen::Result<'a, JsLocal<'a>> {
    match output {
        Some(DigestOutput::Into(buffer)) => write_into(heap, buffer, digest.len(), |out| {
            out[..digest.len()].copy_from_slice(digest);
            Ok(digest.len())
        }),
        Some(DigestOutput::Encoding(name)) => encoded(heap, encoding_named(heap, name)?, digest),
        None => Ok(without_output(heap, digest)?.as_value()),
    }
}

pub(crate) enum CryptoHasher {
    /// `None` once digested. HMAC_CTX contains 3 EVP_CTX, so let's store it as a pointer.
    Hmac(Option<Box<HMAC>>),
    /// `EVP_MD_CTX` holds its state inline. Boxed, so that the cell stays small.
    Evp(Box<EVP>),
    Zig(CryptoHasherZig),
}

impl CryptoHasher {
    // ── Extern: For using only CryptoHasherZig in c++ ──────────────────────

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__CryptoHasherExtern__getByName(
        name_bytes: *const c_char,
        name_len: usize,
    ) -> Option<Box<CryptoHasher>> {
        // SAFETY: caller passes a valid (ptr,len) byte slice
        let name = unsafe { bun_core::ffi::slice(name_bytes.cast::<u8>(), name_len) };

        if let Some(inner) = CryptoHasherZig::init(name) {
            return Some(Box::new(CryptoHasher::Zig(inner)));
        }

        let algorithm = evp::lookup_ignore_case(name)?;

        match algorithm {
            evp::Algorithm::Ripemd160
            | evp::Algorithm::Blake2b256
            | evp::Algorithm::Blake2b512
            | evp::Algorithm::Sha512_224 => {
                if let Some(md) = algorithm.md() {
                    return Some(Box::new(CryptoHasher::Evp(Box::new(EVP::init(
                        algorithm, md,
                    )))));
                }
            }
            _ => {
                return None;
            }
        }

        None
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__CryptoHasherExtern__getFromOther(
        other_handle: &CryptoHasher,
    ) -> Option<Box<CryptoHasher>> {
        match other_handle {
            CryptoHasher::Zig(other) => Some(Box::new(CryptoHasher::Zig(other.copy()))),
            CryptoHasher::Evp(other) => {
                let evp = match other.copy() {
                    Ok(e) => e,
                    Err(_) => return None,
                };
                Some(Box::new(CryptoHasher::Evp(Box::new(evp))))
            }
            _ => None,
        }
    }

    /// # Safety
    /// `handle` must be a `Box<CryptoHasher>` raw pointer previously returned by
    /// `Bun__CryptoHasherExtern__getByName` / `getFromOther`, with ownership
    /// being returned to Rust (not yet destroyed).
    #[unsafe(no_mangle)]
    pub(crate) unsafe extern "C" fn Bun__CryptoHasherExtern__destroy(handle: *mut CryptoHasher) {
        // SAFETY: caller transfers ownership of a valid `Box<CryptoHasher>` raw
        // pointer previously returned to C++ (see `# Safety` above).
        drop(unsafe { Box::from_raw(handle) });
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__update")]
    pub(crate) fn extern_update(&mut self, input: &[u8]) -> bool {
        match self {
            CryptoHasher::Zig(zig) => {
                zig.update(input);
                true
            }
            CryptoHasher::Evp(evp) => {
                evp.update(input);
                true
            }
            _ => false,
        }
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__digest")]
    pub(crate) fn extern_digest(&mut self, digest_buf: &mut [u8]) -> u32 {
        let buf_len = digest_buf.len();
        match self {
            CryptoHasher::Zig(zig) => {
                let res = zig.final_with_len(digest_buf, buf_len);
                u32::try_from(res.len()).expect("int cast")
            }
            CryptoHasher::Evp(evp) => {
                let res = evp.r#final(digest_buf);
                u32::try_from(res.len()).expect("int cast")
            }
            _ => 0,
        }
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__getDigestSize", no_catch)]
    pub(crate) fn extern_digest_size(&self) -> u32 {
        match self {
            CryptoHasher::Zig(inner) => inner.digest_length as u32,
            CryptoHasher::Evp(inner) => inner.size() as u32,
            _ => 0,
        }
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__isXof", no_catch)]
    pub(crate) fn extern_is_xof(&self) -> bool {
        match self {
            CryptoHasher::Zig(inner) => matches!(
                inner.algorithm,
                evp::Algorithm::Shake128 | evp::Algorithm::Shake256
            ),
            _ => false,
        }
    }

    // ── JS ─────────────────────────────────────────────────────────────────

    #[cold]
    fn hmac_consumed<'a>(heap: &JsHeap<'a>) -> bindgen::Error<'a> {
        heap.error(format_args!(
            "HMAC has been consumed and is no longer usable"
        ))
    }

    fn update<'a>(&mut self, heap: &JsHeap<'a>, input: &[u8]) -> bindgen::Result<'a, ()> {
        match self {
            CryptoHasher::Evp(evp) => evp.update(input),
            CryptoHasher::Hmac(hmac) => hmac
                .as_mut()
                .ok_or_else(|| Self::hmac_consumed(heap))?
                .update(input),
            CryptoHasher::Zig(zig) => {
                zig.update(input);
                return Ok(());
            }
        }
        match boring_ssl::ERR_get_error() {
            0 => Ok(()),
            code => Err(crypto_error(heap, code)),
        }
    }
}

impl CryptoHasher {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        algorithm: &'a [u8],
        hmac_key: Option<&'a [u8]>,
    ) -> bindgen::Result<'a, Self> {
        if algorithm.is_empty() {
            return Err(heap.invalid_arguments(format_args!("Invalid algorithm name")));
        }

        if let Some(key) = hmac_key {
            let Some(algorithm) = evp::lookup_ignore_case(algorithm) else {
                return Err(heap.invalid_arguments(format_args!(
                    "algorithm must be one of {}",
                    evp::ALGORITHM_ONE_OF
                )));
            };
            if let Some(hmac) = HMAC::init(algorithm, key) {
                return Ok(CryptoHasher::Hmac(Some(hmac)));
            }
            return Err(match boring_ssl::ERR_get_error() {
                // SAFETY: throws, and the body returns.
                0 => unsafe { heap.global() }
                    .throw_todo(b"HMAC is not supported for this algorithm yet")
                    .into(),
                code => crypto_error(heap, code),
            });
        }

        if let Some(evp) = EVP::by_name(algorithm) {
            return Ok(CryptoHasher::Evp(Box::new(evp)));
        }
        CryptoHasherZig::init(algorithm)
            .map(CryptoHasher::Zig)
            .ok_or_else(|| {
                heap.invalid_arguments(format_args!(
                    "Unsupported algorithm {}",
                    bstr::BStr::new(algorithm)
                ))
            })
    }

    pub(crate) fn get_algorithm<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, bun_core::String> {
        let algorithm = match self {
            CryptoHasher::Evp(evp) => evp.algorithm(),
            CryptoHasher::Zig(zig) => zig.algorithm,
            CryptoHasher::Hmac(hmac) => {
                hmac.as_ref()
                    .ok_or_else(|| Self::hmac_consumed(heap))?
                    .algorithm
            }
        };
        Ok(bun_core::String::static_(algorithm.tag_cstr().to_bytes()))
    }

    pub(crate) fn get_byte_length<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, u32> {
        Ok(match self {
            CryptoHasher::Evp(evp) => evp.size() as u32,
            CryptoHasher::Hmac(hmac) => hmac
                .as_ref()
                .ok_or_else(|| Self::hmac_consumed(heap))?
                .size() as u32,
            CryptoHasher::Zig(zig) => zig.digest_length as u32,
        })
    }

    pub(crate) fn get_algorithms() -> impl IntoIterator<Item = impl AsRef<[u8]>> {
        evp::ALL
            .iter()
            .map(|algorithm| algorithm.tag_cstr().to_bytes())
    }

    pub(crate) fn copy<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let copied = match self {
            CryptoHasher::Evp(evp) => CryptoHasher::Evp(Box::new(evp.copy()?)),
            CryptoHasher::Hmac(hmac) => {
                let hmac = hmac.as_ref().ok_or_else(|| Self::hmac_consumed(heap))?;
                CryptoHasher::Hmac(Some(
                    hmac.copy()
                        .map_err(|_| crypto_error(heap, boring_ssl::ERR_get_error()))?,
                ))
            }
            CryptoHasher::Zig(zig) => CryptoHasher::Zig(zig.copy()),
        };
        Ok(copied.into_js(heap))
    }

    pub(crate) fn update_string<'a>(
        &mut self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: &bun_core::String,
        encoding: Option<&'a [u8]>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        match encoding.and_then(Encoding::from).unwrap_or(Encoding::Utf8) {
            Encoding::Utf8 => self.update(heap, &input.to_utf8())?,
            Encoding::Hex if !input.length().is_multiple_of(2) => {
                return Err(heap.error_with_code(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'encoding' is invalid for data of length {}. Received '{}'",
                        input.length(),
                        bstr::BStr::new(encoding.unwrap_or_default()),
                    ),
                ));
            }
            encoding => self.update(heap, &input.encode(encoding))?,
        }
        Ok(this_value)
    }

    pub(crate) fn update_bytes<'a>(
        &mut self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: &'a [u8],
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        self.update(heap, input)?;
        Ok(this_value)
    }

    pub(crate) fn digest<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        output: Option<DigestOutput<'a>>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        finish(
            heap,
            output,
            EVP_MAX_MD_SIZE_USIZE,
            JsHeap::create_buffer,
            |out| {
                Ok(match self {
                    CryptoHasher::Hmac(hmac) => hmac
                        .take()
                        .ok_or_else(|| Self::hmac_consumed(heap))?
                        .r#final(out)
                        .len(),
                    CryptoHasher::Evp(evp) => evp.r#final(out).len(),
                    CryptoHasher::Zig(zig) => zig.final_(out).len(),
                })
            },
        )
    }

    pub(crate) fn hash<'a>(
        heap: &JsHeap<'a>,
        algorithm: &bun_core::String,
        input: &'a [u8],
        output: Option<HashOutput<'a>>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        let output = match output {
            None => None,
            Some(HashOutput::Encoding(name)) => Some(DigestOutput::Encoding(name)),
            Some(HashOutput::Into(buffer)) => Some(DigestOutput::Into(buffer)),
            Some(HashOutput::Function(function)) => {
                return Err(Self::not_options(heap, Some(function)));
            }
            Some(HashOutput::Array(_)) => return Err(Self::not_options(heap, None)),
            Some(HashOutput::Options(options)) => {
                match Self::hash_with_options(heap, algorithm, input, &options)? {
                    ControlFlow::Break(digest) => return Ok(digest),
                    ControlFlow::Continue(encoding) => Some(DigestOutput::Encoding(encoding)),
                }
            }
        };
        let algorithm = &*algorithm.to_utf8();
        let mut digest: evp::Digest = [0; EVP_MAX_MD_SIZE_USIZE];
        let length = if let Some(mut evp) = EVP::by_name(algorithm) {
            let Some(length) = evp.hash(input, &mut digest) else {
                return Err(crypto_error(heap, boring_ssl::ERR_get_error()));
            };
            length as usize
        } else if let Some(length) = CryptoHasherZig::hash_by_name(algorithm, input, &mut digest) {
            length
        } else {
            return Err(heap.invalid_arguments(format_args!(
                "Unsupported algorithm \"{}\"",
                bstr::BStr::new(algorithm)
            )));
        };
        finish_with(heap, output, JsHeap::create_buffer, &digest[..length])
    }

    /// What node's `validateObject` throws for the two kinds of object that it refuses: `function`, or else an array.
    #[cold]
    #[inline(never)]
    fn not_options<'a>(
        heap: &JsHeap<'a>,
        function: Option<JsLocal<'a, bindgen::Callable>>,
    ) -> bindgen::Error<'a> {
        let received = match function {
            None => bun_core::String::static_("an instance of Array"),
            Some(function) => {
                // SAFETY: a function is described by its name, which is read without running JavaScript.
                let global = unsafe { heap.global() };
                match JSGlobalObject::determine_specific_type(global, function.to_js()) {
                    Ok(received) => received,
                    Err(error) => return error.into(),
                }
            }
        };
        heap.invalid_arguments(format_args!(
            "The \"options\" argument must be of type object. Received {received}"
        ))
    }

    /// node's `ERR_INVALID_ARG_VALUE('outputEncoding', name)`. `name` is quoted as the C++ that throws this error quotes a string.
    #[cold]
    fn unknown_output_encoding<'a>(
        heap: &JsHeap<'a>,
        name: &bun_core::String,
    ) -> bindgen::Error<'a> {
        // SAFETY: a string is made and described without running JavaScript.
        let global = unsafe { heap.global() };
        let described = name
            .to_js(global)
            .and_then(|name| JSGlobalObject::inspect_for_error_message(global, name));
        match described {
            Ok(received) => heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("The argument 'outputEncoding' is invalid. Received {received}"),
            ),
            Err(error) => error.into(),
        }
    }

    /// `Break` is a SHAKE digest of the length asked for. `Continue` is the encoding that `hash` goes on with, as if given its name.
    #[cold]
    #[inline(never)]
    fn hash_with_options<'a>(
        heap: &JsHeap<'a>,
        algorithm: &bun_core::String,
        input: &'a [u8],
        options: &HashOptions<'a>,
    ) -> bindgen::Result<'a, ControlFlow<JsLocal<'a>, &'static [u8]>> {
        let encoding = match &options.output_encoding {
            None => Encoding::Hex,
            // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util.js#L313
            Some(name) if name.is_empty() => Encoding::Utf8,
            Some(name) => match Encoding::from_bun_string(name) {
                Some(encoding) => encoding,
                None => return Err(Self::unknown_output_encoding(heap, name)),
            },
        };
        let encoding_name = <&'static str>::from(encoding).as_bytes();
        let cshake = !options.function_name.is_undefined() || !options.customization.is_undefined();
        if options.output_length.is_none() && !cshake {
            return Ok(ControlFlow::Continue(encoding_name));
        }
        let algorithm = &*algorithm.to_utf8();
        let xof = CryptoHasherZig::xof_by_name(algorithm);
        if xof.is_none() {
            let length = match EVP::by_name(algorithm) {
                Some(evp) => Some(usize::from(evp.size())),
                None => CryptoHasherZig::digest_length_by_name(algorithm),
            };
            // `hash` refuses a name that is no algorithm's.
            let Some(length) = length else {
                return Ok(ControlFlow::Continue(encoding_name));
            };
            if let Some(wanted) = options.output_length
                && wanted as usize != length
            {
                return Err(not_an_xof(heap, algorithm, wanted));
            }
        }
        // node refuses these last of all: https://github.com/nodejs/node/blob/v26.12.1/src/crypto/crypto_hash.cc#L460-L464
        if cshake {
            return Err(heap.error(format_args!("Digest options are not supported")));
        }
        let (Some(squeeze), Some(wanted)) = (xof, options.output_length) else {
            return Ok(ControlFlow::Continue(encoding_name));
        };
        let length = wanted as usize;

        let characters = match encoding {
            Encoding::Hex => length.saturating_mul(2),
            Encoding::Base64 => length.div_ceil(3).saturating_mul(4),
            Encoding::Base64url => length.saturating_mul(4).div_ceil(3),
            // UTF-16 has no more units than UTF-8 has bytes, so this is the most that it can be.
            Encoding::Latin1 | Encoding::Ascii | Encoding::Utf8 => length,
            Encoding::Ucs2 | Encoding::Utf16le => length / 2,
            Encoding::Buffer => 0,
        };
        if characters > bun_core::String::max_length() {
            return Err(heap.string_too_long());
        }

        let mut short: evp::Digest = [0; EVP_MAX_MD_SIZE_USIZE];
        if let Some(out) = short.get_mut(..length) {
            squeeze(input, out);
            return encoded(heap, encoding, out).map(ControlFlow::Break);
        }
        let mut long = Vec::new();
        if long.try_reserve_exact(length).is_err() {
            return Err(heap.memory_allocation_failed());
        }
        long.resize(length, 0);
        squeeze(input, &mut long);
        if encoding == Encoding::Buffer {
            let buffer = heap.create_buffer_from_box(long.into_boxed_slice())?;
            return Ok(ControlFlow::Break(buffer.as_value()));
        }
        // SAFETY: makes a string.
        let global = unsafe { heap.global() };
        let value = encoding.encode_with_max_size(global, length, &long)?;
        Ok(ControlFlow::Break(JsLocal::new(heap, value)))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// CryptoHasherZig
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct CryptoHasherZig {
    pub(crate) algorithm: evp::Algorithm,
    pub(crate) state: Box<dyn Any>,
    pub(crate) digest_length: u8,
}

/// Trait for the non-BoringSSL hash algorithms used by `CryptoHasherZig`.
/// Implemented for each algo in `zig_crypto_algos` below.
trait ZigHashAlgo: Default + Clone + 'static {
    const ALGORITHM: evp::Algorithm;
    /// Shake128→16, Shake256→32, else the algorithm's digest length.
    const DIGEST_LENGTH: u8;
    fn init() -> Self {
        Self::default()
    }
    fn update(&mut self, bytes: &[u8]);
    fn final_(&mut self, out: &mut [u8]);
}

/// Hash-state types for the algorithms that BoringSSL does not expose as a
/// streaming context. Backed by RustCrypto's `sha3`/`blake2` crates
/// (Keccak-p[1600,24] permutation and BLAKE2s).
mod zig_crypto_algos {
    use super::{ZigHashAlgo, evp};
    use sha3::digest::{ExtendableOutputReset, FixedOutputReset, Output, Update};

    pub(super) type Sha3_224 = sha3::Sha3_224;
    pub(super) type Sha3_256 = sha3::Sha3_256;
    pub(super) type Sha3_384 = sha3::Sha3_384;
    pub(super) type Sha3_512 = sha3::Sha3_512;
    pub(super) type Shake128 = sha3::Shake128;
    pub(super) type Shake256 = sha3::Shake256;
    pub(super) type Blake2s256 = blake2::Blake2s256;

    /// Fixed-digest Keccak/BLAKE2 — `final_` writes exactly `DIGEST_LENGTH`
    /// bytes via `FixedOutputReset`.
    macro_rules! impl_fixed {
        ($ty:ty, $variant:ident, $len:expr) => {
            impl ZigHashAlgo for $ty {
                const ALGORITHM: evp::Algorithm = evp::Algorithm::$variant;
                const DIGEST_LENGTH: u8 = $len;
                fn update(&mut self, bytes: &[u8]) {
                    Update::update(self, bytes);
                }
                fn final_(&mut self, out: &mut [u8]) {
                    let len = Self::DIGEST_LENGTH as usize;
                    FixedOutputReset::finalize_into_reset(
                        self,
                        Output::<$ty>::from_mut_slice(&mut out[..len]),
                    );
                }
            }
        };
    }

    /// SHAKE XOF — default digest lengths: Shake128 = 16, Shake256 = 32;
    /// `final_` squeezes exactly `out.len` bytes.
    macro_rules! impl_xof {
        ($ty:ty, $variant:ident, $len:expr) => {
            impl ZigHashAlgo for $ty {
                const ALGORITHM: evp::Algorithm = evp::Algorithm::$variant;
                const DIGEST_LENGTH: u8 = $len;
                fn update(&mut self, bytes: &[u8]) {
                    Update::update(self, bytes);
                }
                fn final_(&mut self, out: &mut [u8]) {
                    // Squeeze exactly `out.len` bytes — fill the
                    // full slice, not just `DIGEST_LENGTH`.
                    ExtendableOutputReset::finalize_xof_reset_into(self, out);
                }
            }
        };
    }

    impl_fixed!(Sha3_224, Sha3_224, 28);
    impl_fixed!(Sha3_256, Sha3_256, 32);
    impl_fixed!(Sha3_384, Sha3_384, 48);
    impl_fixed!(Sha3_512, Sha3_512, 64);
    impl_xof!(Shake128, Shake128, 16);
    impl_xof!(Shake256, Shake256, 32);
    impl_fixed!(Blake2s256, Blake2s256, 32);
}

/// Expands the macro once per supported `ZigHashAlgo` type.
macro_rules! for_each_zig_algo {
    ($mac:ident $(, $($args:tt)*)?) => {
        $mac!(Sha3_224   $(, $($args)*)?);
        $mac!(Sha3_256   $(, $($args)*)?);
        $mac!(Sha3_384   $(, $($args)*)?);
        $mac!(Sha3_512   $(, $($args)*)?);
        $mac!(Shake128   $(, $($args)*)?);
        $mac!(Shake256   $(, $($args)*)?);
        $mac!(Blake2s256 $(, $($args)*)?);
    };
}

impl CryptoHasherZig {
    /// How many bytes of `out` it wrote. `None` when `algorithm` is not one of these.
    fn hash_by_name(algorithm: &[u8], input: &[u8], out: &mut evp::Digest) -> Option<usize> {
        let algorithm = evp::lookup_ignore_case(algorithm)?;
        macro_rules! arm {
            ($ty:ty) => {
                if algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    let length = <$ty as ZigHashAlgo>::DIGEST_LENGTH as usize;
                    let mut hasher = <$ty as ZigHashAlgo>::init();
                    hasher.update(input);
                    hasher.final_(&mut out[..length]);
                    return Some(length);
                }
            };
        }
        for_each_zig_algo!(arm);
        None
    }

    /// How many bytes `hash_by_name` writes. `None` when `algorithm` is not one of these.
    fn digest_length_by_name(algorithm: &[u8]) -> Option<usize> {
        let algorithm = evp::lookup_ignore_case(algorithm)?;
        macro_rules! arm {
            ($ty:ty) => {
                if algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    return Some(<$ty as ZigHashAlgo>::DIGEST_LENGTH as usize);
                }
            };
        }
        for_each_zig_algo!(arm);
        None
    }

    /// What fills `out`, of any length, with the output of shake128 or shake256 for `input`. `None` for any other algorithm.
    fn xof_by_name(algorithm: &[u8]) -> Option<fn(input: &[u8], out: &mut [u8])> {
        fn squeeze<Xof: ZigHashAlgo>(input: &[u8], out: &mut [u8]) {
            let mut hasher = Xof::init();
            hasher.update(input);
            hasher.final_(out);
        }
        match evp::lookup_ignore_case(algorithm)? {
            evp::Algorithm::Shake128 => Some(squeeze::<Shake128>),
            evp::Algorithm::Shake256 => Some(squeeze::<Shake256>),
            _ => None,
        }
    }

    pub(crate) fn init(name: &[u8]) -> Option<CryptoHasherZig> {
        let algorithm = evp::lookup_ignore_case(name)?;
        macro_rules! arm {
            ($ty:ty, $alg:expr) => {
                if $alg == <$ty as ZigHashAlgo>::ALGORITHM {
                    let handle = CryptoHasherZig {
                        algorithm: <$ty as ZigHashAlgo>::ALGORITHM,
                        state: Box::new(<$ty as ZigHashAlgo>::init()),
                        digest_length: <$ty as ZigHashAlgo>::DIGEST_LENGTH,
                    };
                    return Some(handle);
                }
            };
        }
        for_each_zig_algo!(arm, algorithm);
        None
    }

    fn update(&mut self, bytes: &[u8]) {
        macro_rules! arm {
            ($ty:ty, $self:expr, $bytes:expr) => {
                if $self.algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    // SAFETY: tag matches type stored in `state` (set in init).
                    let state = $self.state.downcast_mut::<$ty>().expect("unreachable");
                    return <$ty as ZigHashAlgo>::update(state, $bytes);
                }
            };
        }
        for_each_zig_algo!(arm, self, bytes);
        unreachable!();
    }

    fn copy(&self) -> CryptoHasherZig {
        macro_rules! arm {
            ($ty:ty, $self:expr) => {
                if $self.algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    let state = $self.state.downcast_ref::<$ty>().expect("unreachable");
                    return CryptoHasherZig {
                        algorithm: $self.algorithm,
                        state: Box::new(state.clone()),
                        digest_length: $self.digest_length,
                    };
                }
            };
        }
        for_each_zig_algo!(arm, self);
        unreachable!();
    }

    fn final_with_len<'a>(
        &mut self,
        output_digest_slice: &'a mut [u8],
        res_len: usize,
    ) -> &'a mut [u8] {
        macro_rules! arm {
            ($ty:ty, $self:expr, $out:expr, $len:expr) => {
                if $self.algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    let state = $self.state.downcast_mut::<$ty>().expect("unreachable");
                    <$ty as ZigHashAlgo>::final_(state, $out);
                    *state = <$ty as ZigHashAlgo>::init();
                    return &mut $out[0..$len];
                }
            };
        }
        for_each_zig_algo!(arm, self, output_digest_slice, res_len);
        unreachable!();
    }

    fn final_<'a>(&mut self, output_digest_slice: &'a mut [u8]) -> &'a mut [u8] {
        let len = self.digest_length as usize;
        self.final_with_len(output_digest_slice, len)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// MD4, MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256
// ───────────────────────────────────────────────────────────────────────────

#[cold]
fn already_digested<'a>(heap: &JsHeap<'a>, name: &str, to: &str) -> bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::INVALID_STATE,
        format_args!("{name} hasher already digested, create a new instance to {to}"),
    )
}

macro_rules! static_hasher {
    ($name:ident) => {
        pub(crate) struct $name {
            hashing: hashers::$name,
            digested: bool,
        }

        impl $name {
            pub(crate) fn constructor() -> Self {
                Self {
                    hashing: hashers::$name::init(),
                    digested: false,
                }
            }

            pub(crate) fn get_byte_length(&self) -> u32 {
                hashers::$name::DIGEST as u32
            }

            pub(crate) fn get_static_byte_length() -> u32 {
                hashers::$name::DIGEST as u32
            }

            pub(crate) fn update<'a>(
                &mut self,
                this_value: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
                input: &'a [u8],
            ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
                if self.digested {
                    return Err(already_digested(heap, stringify!($name), "update"));
                }
                self.hashing.update(input);
                Ok(this_value)
            }

            pub(crate) fn digest<'a>(
                &mut self,
                heap: &JsHeap<'a>,
                output: Option<DigestOutput<'a>>,
            ) -> bindgen::Result<'a, JsLocal<'a>> {
                if self.digested {
                    return Err(already_digested(heap, stringify!($name), "digest again"));
                }
                const LENGTH: usize = hashers::$name::DIGEST;
                finish(heap, output, LENGTH, JsHeap::create_uint8_array, |out| {
                    self.hashing
                        .r#final(out.first_chunk_mut().expect("at least that long"));
                    self.digested = true;
                    Ok(LENGTH)
                })
            }

            pub(crate) fn hash<'a>(
                heap: &JsHeap<'a>,
                input: &'a [u8],
                output: Option<DigestOutput<'a>>,
            ) -> bindgen::Result<'a, JsLocal<'a>> {
                let mut digest = [0; hashers::$name::DIGEST];
                hashers::$name::hash(input, &mut digest);
                finish_with(heap, output, JsHeap::create_uint8_array, &digest)
            }
        }
    };
}

static_hasher!(MD4);
static_hasher!(MD5);
static_hasher!(SHA1);
static_hasher!(SHA224);
static_hasher!(SHA256);
static_hasher!(SHA384);
static_hasher!(SHA512);
static_hasher!(SHA512_256);

pub(crate) fn sha<'a>(
    heap: &JsHeap<'a>,
    input: &'a [u8],
    output: Option<DigestOutput<'a>>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    SHA512_256::hash(heap, input, output)
}
