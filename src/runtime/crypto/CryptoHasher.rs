use core::any::Any;
use core::ffi::{c_char, c_uint};

use bun_boringssl_sys as boring_ssl;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsPayload as _, JsWrapper};
use bun_jsc::{ErrorCode, JSGlobalObject};

use crate::crypto::evp::{AlgorithmExt as _, EVP};
use crate::crypto::{HMAC, create_crypto_error, evp};
use crate::generated_bindgen::crypto_hasher::{
    CryptoHasherClass, DigestOutput, MD4Class, MD5Class, SHA1Class, SHA224Class, SHA256Class,
    SHA384Class, SHA512_256Class, SHA512Class,
};
use crate::node::Encoding;
use crate::webcore::encoding::BunStringEncode as _;
use bun_sha_hmac::sha as hashers;

// sha3/blake2 algorithms with no BoringSSL streaming context:
// RustCrypto's `sha3`/`blake2` crates are wired into the
// `ZigHashAlgo` trait below.
use zig_crypto_algos::{Blake2s256, Sha3_224, Sha3_256, Sha3_384, Sha3_512, Shake128, Shake256};

const EVP_MAX_MD_SIZE_USIZE: usize = boring_ssl::EVP_MAX_MD_SIZE as usize;

/// Local helper: dereference the raw `*mut VirtualMachine` to reach
/// `RareData::boring_engine()` and cast the bun_jsc-local opaque `ENGINE`
/// to the real `bun_boringssl_sys::ENGINE` (both name the same C struct).
#[inline]
fn boring_engine(global: &JSGlobalObject) -> *mut boring_ssl::ENGINE {
    // SAFETY: `bun_vm()` returns the raw `*mut VirtualMachine` for a Bun-owned
    // global (never null, single-threaded JS heap), so deref-to-&mut is sound here.
    global
        .bun_vm()
        .as_mut()
        .rare_data()
        .boring_engine()
        .cast::<boring_ssl::ENGINE>()
}

#[inline]
fn engine_of(heap: &JsHeap<'_>) -> *mut boring_ssl::ENGINE {
    // SAFETY: the VM's engine is made without running JavaScript.
    boring_engine(unsafe { heap.global() })
}

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
        global: &JSGlobalObject,
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
                    // `Algorithm::md()` lives in `bun_sha_hmac` and
                    // returns that crate's opaque `EVP_MD`; cast to the boringssl-sys
                    // opaque (same underlying C `struct env_md_st`).
                    return Some(Box::new(CryptoHasher::Evp(Box::new(EVP::init(
                        algorithm,
                        md.cast::<boring_ssl::EVP_MD>(),
                        boring_engine(global),
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
        global: &JSGlobalObject,
        other_handle: &CryptoHasher,
    ) -> Option<Box<CryptoHasher>> {
        match other_handle {
            CryptoHasher::Zig(other) => Some(Box::new(CryptoHasher::Zig(other.copy()))),
            CryptoHasher::Evp(other) => {
                let evp = match other.copy(boring_engine(global)) {
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
    pub(crate) fn extern_digest(&mut self, global: &JSGlobalObject, digest_buf: &mut [u8]) -> u32 {
        let buf_len = digest_buf.len();
        match self {
            CryptoHasher::Zig(zig) => {
                let res = zig.final_with_len(digest_buf, buf_len);
                u32::try_from(res.len()).expect("int cast")
            }
            CryptoHasher::Evp(evp) => {
                let res = evp.r#final(boring_engine(global), digest_buf);
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

impl CryptoHasherClass for CryptoHasher {
    type Error<'a> = bindgen::Error<'a>;

    fn constructor<'a>(
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

        if let Some(evp) = EVP::by_name_and_engine(engine_of(heap), algorithm) {
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

    fn algorithm<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, bun_core::String> {
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

    fn byte_length<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, u32> {
        Ok(match self {
            CryptoHasher::Evp(evp) => evp.size() as u32,
            CryptoHasher::Hmac(hmac) => hmac
                .as_ref()
                .ok_or_else(|| Self::hmac_consumed(heap))?
                .size() as u32,
            CryptoHasher::Zig(zig) => zig.digest_length as u32,
        })
    }

    fn algorithms() -> impl IntoIterator<Item = impl AsRef<[u8]>> {
        evp::ALL
            .iter()
            .map(|algorithm| algorithm.tag_cstr().to_bytes())
    }

    fn copy<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let copied = match self {
            CryptoHasher::Evp(evp) => CryptoHasher::Evp(Box::new(evp.copy(engine_of(heap))?)),
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

    fn update_string<'a>(
        &mut self,
        this: JsWrapper<'a, Self>,
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
        Ok(this)
    }

    fn update_bytes<'a>(
        &mut self,
        this: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: &'a [u8],
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        self.update(heap, input)?;
        Ok(this)
    }

    fn digest<'a>(
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
                    CryptoHasher::Evp(evp) => evp.r#final(engine_of(heap), out).len(),
                    CryptoHasher::Zig(zig) => zig.final_(out).len(),
                })
            },
        )
    }

    fn hash<'a>(
        heap: &JsHeap<'a>,
        algorithm: &'a [u8],
        input: &'a [u8],
        output: Option<DigestOutput<'a>>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        let Some((algorithm, md)) = evp::md_by_name(algorithm) else {
            return Err(heap.invalid_arguments(format_args!(
                "Unsupported algorithm \"{}\"",
                bstr::BStr::new(algorithm)
            )));
        };
        let mut digest: evp::Digest = [0; EVP_MAX_MD_SIZE_USIZE];
        let length = match md {
            Some(md) => {
                let mut length: c_uint = 0;
                // SAFETY: `input` is valid for its length, `digest` holds
                // `EVP_MAX_MD_SIZE` bytes, `md` is a BoringSSL static
                // singleton, and the engine is the VM's.
                let rc = unsafe {
                    boring_ssl::EVP_Digest(
                        input.as_ptr().cast(),
                        input.len(),
                        digest.as_mut_ptr(),
                        &raw mut length,
                        md,
                        engine_of(heap),
                    )
                };
                debug_assert!(rc == 1);
                length as usize
            }
            None => CryptoHasherZig::hash(algorithm, input, &mut digest),
        };
        finish_with(heap, output, JsHeap::create_buffer, &digest[..length])
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
    /// How many bytes of `out` it wrote. `algorithm` is one of these: the
    /// ones without a BoringSSL `EVP_MD`.
    fn hash(algorithm: evp::Algorithm, input: &[u8], out: &mut evp::Digest) -> usize {
        macro_rules! arm {
            ($ty:ty) => {
                if algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    let length = <$ty as ZigHashAlgo>::DIGEST_LENGTH as usize;
                    let mut hasher = <$ty as ZigHashAlgo>::init();
                    hasher.update(input);
                    hasher.final_(&mut out[..length]);
                    return length;
                }
            };
        }
        for_each_zig_algo!(arm);
        unreachable!("{algorithm:?} has a BoringSSL EVP_MD");
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
    ($name:ident, $class:ident) => {
        pub(crate) struct $name {
            hashing: hashers::$name,
            digested: bool,
        }

        impl $class for $name {
            type Error<'a> = bindgen::Error<'a>;

            fn constructor() -> Self {
                Self {
                    hashing: hashers::$name::init(),
                    digested: false,
                }
            }

            fn byte_length(&self) -> u32 {
                hashers::$name::DIGEST as u32
            }

            fn static_byte_length() -> u32 {
                hashers::$name::DIGEST as u32
            }

            fn update<'a>(
                &mut self,
                this: JsWrapper<'a, Self>,
                heap: &JsHeap<'a>,
                input: &'a [u8],
            ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
                if self.digested {
                    return Err(already_digested(heap, stringify!($name), "update"));
                }
                self.hashing.update(input);
                Ok(this)
            }

            fn digest<'a>(
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

            fn hash<'a>(
                heap: &JsHeap<'a>,
                input: &'a [u8],
                output: Option<DigestOutput<'a>>,
            ) -> bindgen::Result<'a, JsLocal<'a>> {
                let mut digest = [0; hashers::$name::DIGEST];
                // SAFETY: the engine is the VM's.
                unsafe { hashers::$name::hash(input, &mut digest, engine_of(heap)) };
                finish_with(heap, output, JsHeap::create_uint8_array, &digest)
            }
        }
    };
}

static_hasher!(MD4, MD4Class);
static_hasher!(MD5, MD5Class);
static_hasher!(SHA1, SHA1Class);
static_hasher!(SHA224, SHA224Class);
static_hasher!(SHA256, SHA256Class);
static_hasher!(SHA384, SHA384Class);
static_hasher!(SHA512, SHA512Class);
static_hasher!(SHA512_256, SHA512_256Class);

pub(crate) fn sha<'a>(
    heap: &JsHeap<'a>,
    input: &'a [u8],
    output: Option<DigestOutput<'a>>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    SHA512_256::hash(heap, input, output)
}
