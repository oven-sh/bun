use core::any::Any;
use core::ffi::c_char;

use bun_boringssl::c as boring_ssl;
use bun_jsc::node::{BlobOrStringOrBuffer, Encoding, StringOrBuffer};
use bun_jsc::{ArrayBuffer, CallFrame, JSGlobalObject, JSObject, JSValue, JsError, JsResult};
use bun_str::{strings, ZigString};

use crate::api::bun::crypto::{create_crypto_error, EVP, HMAC};
// TODO(port): `Hashers` = src/sha_hmac/sha.zig — confirm crate path in Phase B
use bun_sha_hmac::sha as hashers;

// TODO(port): std.crypto.hash.{sha3,blake2} — Zig std crypto algos not in BoringSSL.
// Phase B: pick a Rust impl (e.g. `sha3`/`blake2` crates or a thin Zig→C shim) and
// expose as `bun_crypto_std::{sha3,blake2}` with the `ZigHashAlgo` trait below.
use bun_crypto_std::blake2::Blake2s256;
use bun_crypto_std::sha3::{Sha3_224, Sha3_256, Sha3_384, Sha3_512, Shake128, Shake256};

type Digest = <EVP as evp_digest_alias::HasDigest>::Digest;
// PORT NOTE: in Zig `Digest = EVP.Digest` is a `[EVP_MAX_MD_SIZE]u8`. The alias above
// is just to mirror the Zig — Phase B can replace with a direct `pub type Digest = EVP::Digest;`
// once the `EVP` Rust port lands. Kept as a TODO indirection to avoid guessing the array len here.
mod evp_digest_alias {
    pub trait HasDigest {
        type Digest;
    }
    impl HasDigest for super::EVP {
        type Digest = super::EVP::Digest; // TODO(port): EVP::Digest = [u8; EVP_MAX_MD_SIZE]
    }
}

/// `union(enum)` → Rust enum with payload variants.
/// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated; this is the `m_ctx` payload.
#[bun_jsc::JsClass]
pub enum CryptoHasher {
    // HMAC_CTX contains 3 EVP_CTX, so let's store it as a pointer.
    Hmac(Option<Box<HMAC>>),
    Evp(EVP),
    Zig(CryptoHasherZig),
}

impl CryptoHasher {
    // `pub const new = bun.TrivialNew(@This());`
    #[inline]
    pub fn new(init: CryptoHasher) -> Box<CryptoHasher> {
        Box::new(init)
    }

    // ── Extern: For using only CryptoHasherZig in c++ ──────────────────────
    // TODO(port): move to <runtime>_sys (these are exported C ABI fns)

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__getByName(
        global: &JSGlobalObject,
        name_bytes: *const c_char,
        name_len: usize,
    ) -> Option<Box<CryptoHasher>> {
        // SAFETY: caller passes a valid (ptr,len) byte slice
        let name = unsafe { core::slice::from_raw_parts(name_bytes as *const u8, name_len) };

        if let Some(inner) = CryptoHasherZig::init(name) {
            return Some(CryptoHasher::new(CryptoHasher::Zig(inner)));
        }

        let Some(algorithm) = EVP::Algorithm::map().get(name) else {
            return None;
        };

        match algorithm {
            EVP::Algorithm::ripemd160
            | EVP::Algorithm::blake2b256
            | EVP::Algorithm::blake2b512
            | EVP::Algorithm::sha512_224 => {
                if let Some(md) = algorithm.md() {
                    return Some(CryptoHasher::new(CryptoHasher::Evp(EVP::init(
                        algorithm,
                        md,
                        global.bun_vm().rare_data().boring_engine(),
                    ))));
                }
            }
            _ => {
                return None;
            }
        }

        None
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__getFromOther(
        global: &JSGlobalObject,
        other_handle: &CryptoHasher,
    ) -> Option<Box<CryptoHasher>> {
        match other_handle {
            CryptoHasher::Zig(other) => {
                let hasher = CryptoHasher::new(CryptoHasher::Zig(other.copy()));
                Some(hasher)
            }
            CryptoHasher::Evp(other) => {
                let evp = match other.copy(global.bun_vm().rare_data().boring_engine()) {
                    Ok(e) => e,
                    Err(_) => return None,
                };
                Some(CryptoHasher::new(CryptoHasher::Evp(evp)))
            }
            _ => None,
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__destroy(handle: *mut CryptoHasher) {
        // SAFETY: handle was produced by Box::into_raw via getByName/getFromOther
        unsafe { CryptoHasher::finalize(handle) };
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__update(
        handle: &mut CryptoHasher,
        input_bytes: *const u8,
        input_len: usize,
    ) -> bool {
        // SAFETY: caller passes a valid (ptr,len) byte slice
        let input = unsafe { core::slice::from_raw_parts(input_bytes, input_len) };

        match handle {
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

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__digest(
        handle: &mut CryptoHasher,
        global: &JSGlobalObject,
        buf: *mut u8,
        buf_len: usize,
    ) -> u32 {
        // SAFETY: caller passes a valid writable (ptr,len) byte slice
        let digest_buf = unsafe { core::slice::from_raw_parts_mut(buf, buf_len) };
        match handle {
            CryptoHasher::Zig(zig) => {
                let res = zig.final_with_len(digest_buf, buf_len);
                u32::try_from(res.len()).unwrap()
            }
            CryptoHasher::Evp(evp) => {
                let res = evp.final_(global.bun_vm().rare_data().boring_engine(), digest_buf);
                u32::try_from(res.len()).unwrap()
            }
            _ => 0,
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__getDigestSize(handle: &CryptoHasher) -> u32 {
        match handle {
            CryptoHasher::Zig(inner) => inner.digest_length as u32,
            CryptoHasher::Evp(inner) => inner.size(),
            _ => 0,
        }
    }

    // ── JS host fns ────────────────────────────────────────────────────────

    // `pub const digest = jsc.host_fn.wrapInstanceMethod(CryptoHasher, "digest_", false);`
    // `pub const hash   = jsc.host_fn.wrapStaticMethod(CryptoHasher, "hash_", false);`
    // TODO(port): proc-macro — `wrapInstanceMethod`/`wrapStaticMethod` reflect on the
    // wrapped fn's parameter list to decode CallFrame args. Phase B: emit via #[bun_jsc::host_fn].

    fn throw_hmac_consumed(global: &JSGlobalObject) -> JsError {
        global.throw("HMAC has been consumed and is no longer usable", format_args!(""))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_byte_length(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(match this {
            CryptoHasher::Evp(inner) => inner.size(),
            CryptoHasher::Hmac(inner) => match inner {
                Some(hmac) => hmac.size(),
                None => return Err(Self::throw_hmac_consumed(global)),
            },
            CryptoHasher::Zig(inner) => inner.digest_length as u32,
        }))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_algorithm(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match this {
            CryptoHasher::Evp(inner) => {
                Ok(ZigString::from_utf8(<&'static str>::from(inner.algorithm).as_bytes())
                    .to_js(global))
            }
            CryptoHasher::Zig(inner) => {
                Ok(ZigString::from_utf8(<&'static str>::from(inner.algorithm).as_bytes())
                    .to_js(global))
            }
            CryptoHasher::Hmac(inner) => match inner {
                Some(hmac) => Ok(ZigString::from_utf8(
                    <&'static str>::from(hmac.algorithm).as_bytes(),
                )
                .to_js(global)),
                None => Err(Self::throw_hmac_consumed(global)),
            },
        }
    }

    #[bun_jsc::host_fn]
    pub fn get_algorithms(
        global: &JSGlobalObject,
        _: JSValue,
        _: JSValue,
    ) -> JsResult<JSValue> {
        bun_str::String::to_js_array(global, EVP::Algorithm::names().values())
    }

    fn hash_to_encoding(
        global: &JSGlobalObject,
        evp: &mut EVP,
        input: BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: Digest = unsafe { core::mem::zeroed() };
        // SAFETY: Digest = [u8; N] is POD; all-zero is valid.
        // `defer input.deinit()` — handled by Drop on `input`.

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        let Some(len) = evp.hash(
            global.bun_vm().rare_data().boring_engine(),
            input.slice(),
            &mut output_digest_buf,
        ) else {
            let err = boring_ssl::ERR_get_error();
            let instance = create_crypto_error(global, err);
            boring_ssl::ERR_clear_error();
            return Err(global.throw_value(instance));
        };
        encoding.encode_with_max_size(
            global,
            boring_ssl::EVP_MAX_MD_SIZE,
            &output_digest_buf[0..len],
        )
    }

    fn hash_to_bytes(
        global: &JSGlobalObject,
        evp: &mut EVP,
        input: BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: Digest = unsafe { core::mem::zeroed() };
        // SAFETY: Digest = [u8; N] is POD; all-zero is valid.
        let mut output_digest_slice: &mut [u8] = &mut output_digest_buf;
        // `defer input.deinit()` — handled by Drop on `input`.

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        if let Some(output_buf) = &output {
            let size = evp.size();
            let bytes = output_buf.byte_slice();
            if bytes.len() < size as usize {
                return Err(global.throw_invalid_arguments(
                    "TypedArray must be at least {d} bytes",
                    format_args!("{}", size),
                ));
            }
            // PORT NOTE: reshaped for borrowck — Zig rebinds the slice into the output buffer.
            // SAFETY: output_buf outlives this function frame; we drop output_digest_slice
            // borrow of the stack buffer and reborrow into the JS-owned buffer.
            output_digest_slice = unsafe {
                core::slice::from_raw_parts_mut(output_buf.byte_slice_mut_ptr(), size as usize)
            };
        }

        let Some(len) = evp.hash(
            global.bun_vm().rare_data().boring_engine(),
            input.slice(),
            output_digest_slice,
        ) else {
            let err = boring_ssl::ERR_get_error();
            let instance = create_crypto_error(global, err);
            boring_ssl::ERR_clear_error();
            return Err(global.throw_value(instance));
        };

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            // Clone to GC-managed memory
            ArrayBuffer::create_buffer(global, &output_digest_slice[0..len])
        }
    }

    pub fn hash_(
        global: &JSGlobalObject,
        algorithm: ZigString,
        input: BlobOrStringOrBuffer,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        let mut evp = match EVP::by_name(&algorithm, global) {
            Some(e) => e,
            None => match CryptoHasherZig::hash_by_name(global, &algorithm, input, output)? {
                Some(v) => return Ok(v),
                None => {
                    return Err(global.throw_invalid_arguments(
                        "Unsupported algorithm \"{f}\"",
                        format_args!("{}", algorithm),
                    ));
                }
            },
        };
        // `defer evp.deinit()` — handled by Drop on `evp`.

        if let Some(string_or_buffer) = output {
            match string_or_buffer {
                StringOrBuffer::Buffer(buffer) => {
                    Self::hash_to_bytes(global, &mut evp, input, Some(buffer.buffer))
                }
                // `inline else => |*str|` — every non-buffer arm yields a string-like
                other => {
                    let str = other.as_string_like();
                    // `defer str.deinit()` — handled by Drop.
                    let Some(encoding) = Encoding::from(str.slice()) else {
                        return Err(global
                            .err_invalid_arg_value(format_args!(
                                "Unknown encoding: {}",
                                bstr::BStr::new(str.slice())
                            ))
                            .throw());
                    };

                    Self::hash_to_encoding(global, &mut evp, input, encoding)
                }
            }
        } else {
            Self::hash_to_bytes(global, &mut evp, input, None)
        }
    }

    // Bun.CryptoHasher(algorithm, hmacKey?: string | Buffer)
    #[bun_jsc::host_fn]
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<CryptoHasher>> {
        let arguments = callframe.arguments_old(2);
        if arguments.len() == 0 {
            return Err(global.throw_invalid_arguments(
                "Expected an algorithm name as an argument",
                format_args!(""),
            ));
        }

        let algorithm_name = arguments.ptr[0];
        if algorithm_name.is_empty_or_undefined_or_null() || !algorithm_name.is_string() {
            return Err(
                global.throw_invalid_arguments("algorithm must be a string", format_args!(""))
            );
        }

        let algorithm = algorithm_name.get_zig_string(global)?;

        if algorithm.len() == 0 {
            return Err(
                global.throw_invalid_arguments("Invalid algorithm name", format_args!(""))
            );
        }

        let hmac_value = arguments.ptr[1];
        let mut hmac_key: Option<StringOrBuffer> = None;
        // `defer { if (hmac_key) |*key| key.deinit(); }` — handled by Drop on `hmac_key`.

        if !hmac_value.is_empty_or_undefined_or_null() {
            hmac_key = match StringOrBuffer::from_js(global, hmac_value)? {
                Some(k) => Some(k),
                None => {
                    return Err(global.throw_invalid_arguments(
                        "key must be a string or buffer",
                        format_args!(""),
                    ));
                }
            };
        }

        let init = 'brk: {
            if let Some(key) = &hmac_key {
                let chosen_algorithm = algorithm_name.to_enum_from_map::<EVP::Algorithm>(
                    global,
                    "algorithm",
                    EVP::Algorithm::map(),
                )?;

                break 'brk CryptoHasher::Hmac(Some(match HMAC::init(chosen_algorithm, key.slice()) {
                    Some(h) => h,
                    None => {
                        if !global.has_exception() {
                            let err = boring_ssl::ERR_get_error();
                            if err != 0 {
                                let instance = create_crypto_error(global, err);
                                boring_ssl::ERR_clear_error();
                                return Err(global.throw_value(instance));
                            } else {
                                return Err(global
                                    .throw_todo("HMAC is not supported for this algorithm yet"));
                            }
                        }
                        return Err(JsError::Thrown);
                    }
                }));
            }

            break 'brk CryptoHasher::Evp(match EVP::by_name(&algorithm, global) {
                Some(e) => e,
                None => match CryptoHasherZig::constructor(&algorithm) {
                    Some(h) => return Ok(h),
                    None => {
                        return Err(global.throw_invalid_arguments(
                            "Unsupported algorithm {f}",
                            format_args!("{}", algorithm),
                        ));
                    }
                },
            });
        };
        Ok(CryptoHasher::new(init))
    }

    pub fn getter(global: &JSGlobalObject, _: &JSObject) -> JSValue {
        bun_jsc::codegen::JSCryptoHasher::get_constructor(global)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        let arguments = callframe.arguments_old(2);
        let input = arguments.ptr[0];
        if input.is_empty_or_undefined_or_null() {
            return Err(global
                .throw_invalid_arguments("expected blob, string or buffer", format_args!("")));
        }
        let encoding = arguments.ptr[1];
        let buffer = match BlobOrStringOrBuffer::from_js_with_encoding_value(
            global, input, encoding,
        )? {
            Some(b) => b,
            None => {
                if !global.has_exception() {
                    return Err(global.throw_invalid_arguments(
                        "expected blob, string or buffer",
                        format_args!(""),
                    ));
                }
                return Err(JsError::Thrown);
            }
        };
        // `defer buffer.deinit()` — handled by Drop.
        if buffer.is_blob() && buffer.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        match this {
            CryptoHasher::Evp(inner) => {
                inner.update(buffer.slice());
                let err = boring_ssl::ERR_get_error();
                if err != 0 {
                    let instance = create_crypto_error(global, err);
                    boring_ssl::ERR_clear_error();
                    return Err(global.throw_value(instance));
                }
            }
            CryptoHasher::Hmac(inner) => {
                let Some(hmac) = inner else {
                    return Err(Self::throw_hmac_consumed(global));
                };

                hmac.update(buffer.slice());
                let err = boring_ssl::ERR_get_error();
                if err != 0 {
                    let instance = create_crypto_error(global, err);
                    boring_ssl::ERR_clear_error();
                    return Err(global.throw_value(instance));
                }
            }
            CryptoHasher::Zig(inner) => {
                inner.update(buffer.slice());
                return Ok(this_value);
            }
        }

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy(
        this: &mut Self,
        global: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        let copied: CryptoHasher = match this {
            CryptoHasher::Evp(inner) => CryptoHasher::Evp(
                inner
                    .copy(global.bun_vm().rare_data().boring_engine())
                    // bun.handleOom → unwrap (abort on OOM)
                    .expect("OOM"),
            ),
            CryptoHasher::Hmac(inner) => 'brk: {
                let Some(hmac) = inner else {
                    return Err(Self::throw_hmac_consumed(global));
                };
                break 'brk CryptoHasher::Hmac(Some(match hmac.copy() {
                    Ok(h) => h,
                    Err(_) => {
                        let err = create_crypto_error(global, boring_ssl::ERR_get_error());
                        boring_ssl::ERR_clear_error();
                        return Err(global.throw_value(err));
                    }
                }));
            }
            CryptoHasher::Zig(inner) => CryptoHasher::Zig(inner.copy()),
        };
        Ok(CryptoHasher::new(copied).to_js(global))
    }

    pub fn digest_(
        this: &mut Self,
        global: &JSGlobalObject,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        if let Some(string_or_buffer) = output {
            match string_or_buffer {
                StringOrBuffer::Buffer(buffer) => this.digest_to_bytes(global, Some(buffer.buffer)),
                other => {
                    let str = other.as_string_like();
                    // `defer str.deinit()` — handled by Drop.
                    let Some(encoding) = Encoding::from(str.slice()) else {
                        return Err(global
                            .err_invalid_arg_value(format_args!(
                                "Unknown encoding: {}",
                                bstr::BStr::new(str.slice())
                            ))
                            .throw());
                    };

                    this.digest_to_encoding(global, encoding)
                }
            }
        } else {
            this.digest_to_bytes(global, None)
        }
    }

    fn digest_to_bytes(
        &mut self,
        global: &JSGlobalObject,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: EVP::Digest = unsafe { core::mem::zeroed() };
        // SAFETY: EVP::Digest = [u8; N] is POD; all-zero is valid.
        let buf_len = output_digest_buf.len();
        let output_digest_slice: &mut [u8];
        if let Some(output_buf) = &output {
            let bytes = output_buf.byte_slice();
            if bytes.len() < buf_len {
                return Err(global.throw_invalid_arguments(
                    const_format::formatcp!(
                        "TypedArray must be at least {} bytes",
                        boring_ssl::EVP_MAX_MD_SIZE
                    ),
                    format_args!(""),
                ));
            }
            // PORT NOTE: reshaped for borrowck
            // SAFETY: bytes.len() >= EVP_MAX_MD_SIZE checked above; output_buf backing storage outlives this frame.
            output_digest_slice = unsafe {
                core::slice::from_raw_parts_mut(output_buf.byte_slice_mut_ptr(), bytes.len())
            };
        } else {
            // Zig: `output_digest_buf = std.mem.zeroes(EVP.Digest);` — already zeroed above.
            output_digest_slice = &mut output_digest_buf;
        }

        let result = match self.final_(global, output_digest_slice) {
            Ok(r) => r,
            Err(_) => return Ok(JSValue::ZERO),
        };
        if global.has_exception() {
            return Err(JsError::Thrown);
        }

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            // Clone to GC-managed memory
            ArrayBuffer::create_buffer(global, result)
        }
    }

    fn digest_to_encoding(
        &mut self,
        global: &JSGlobalObject,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: EVP::Digest = unsafe { core::mem::zeroed() };
        // SAFETY: EVP::Digest = [u8; N] is POD; all-zero is valid.
        let output_digest_slice: &mut [u8] = &mut output_digest_buf;
        let out = match self.final_(global, output_digest_slice) {
            Ok(r) => r,
            Err(_) => return Ok(JSValue::ZERO),
        };
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        encoding.encode_with_max_size(global, boring_ssl::EVP_MAX_MD_SIZE, out)
    }

    fn final_<'a>(
        &mut self,
        global: &JSGlobalObject,
        output_digest_slice: &'a mut [u8],
    ) -> JsResult<&'a mut [u8]> {
        match self {
            CryptoHasher::Hmac(inner) => 'brk: {
                let Some(hmac) = inner.take() else {
                    return Err(Self::throw_hmac_consumed(global));
                };
                // `this.hmac = null; defer hmac.deinit();` — `take()` + Drop on `hmac`.
                break 'brk Ok(hmac.final_(output_digest_slice));
                // TODO(port): lifetime — `hmac.final_` must write into `output_digest_slice`
                // and return a subslice of it; the returned borrow must NOT borrow `hmac`
                // (which is dropped at scope end). Mirror Zig: HMAC.final returns slice of arg.
            }
            CryptoHasher::Evp(inner) => Ok(inner.final_(
                global.bun_vm().rare_data().boring_engine(),
                output_digest_slice,
            )),
            CryptoHasher::Zig(inner) => Ok(inner.final_(output_digest_slice)),
        }
    }

    /// `.classes.ts` finalize — runs on mutator thread during lazy sweep.
    pub fn finalize(this: *mut CryptoHasher) {
        // SAFETY: `this` was allocated via `CryptoHasher::new` (Box::new) and ownership
        // is being returned to us by the JSC wrapper / extern destroy.
        let this = unsafe { Box::from_raw(this) };
        match *this {
            CryptoHasher::Evp(_inner) => {
                // https://github.com/oven-sh/bun/issues/3250
                // `inner.deinit()` — handled by Drop on EVP.
            }
            CryptoHasher::Zig(_inner) => {
                // `inner.deinit()` — handled by Drop on CryptoHasherZig.
            }
            CryptoHasher::Hmac(_inner) => {
                // `if (inner) |hmac| hmac.deinit();` — handled by Drop on Option<Box<HMAC>>.
            }
        }
        // `bun.destroy(this)` — handled by Drop on Box at scope end.
    }
}

// ───────────────────────────────────────────────────────────────────────────
// CryptoHasherZig
// ───────────────────────────────────────────────────────────────────────────

pub struct CryptoHasherZig {
    pub algorithm: EVP::Algorithm,
    pub state: Box<dyn Any>,
    pub digest_length: u8,
}

/// Trait for the Zig-std hash algorithms used by `CryptoHasherZig`.
/// Replaces the comptime `(string, type)` table + `@typeInfo` introspection.
// TODO(port): impl this trait for each algo in `bun_crypto_std` (Phase B).
pub trait ZigHashAlgo: Default + Clone + 'static {
    const NAME: &'static [u8];
    const ALGORITHM: EVP::Algorithm;
    /// Replaces `digestLength(Algorithm)` (Shake128→16, Shake256→32, else `T.digest_length`).
    const DIGEST_LENGTH: u8;
    fn init() -> Self {
        Self::default()
    }
    fn update(&mut self, bytes: &[u8]);
    fn final_(&mut self, out: &mut [u8]);
}

/// Expands `$body` once per `(name_literal, Type)` pair from the Zig `algo_map`.
/// Heterogeneous-type `inline for` → `macro_rules!` per PORTING.md.
macro_rules! for_each_zig_algo {
    ($mac:ident $(, $($args:tt)*)?) => {
        $mac!(b"sha3-224",   Sha3_224   $(, $($args)*)?);
        $mac!(b"sha3-256",   Sha3_256   $(, $($args)*)?);
        $mac!(b"sha3-384",   Sha3_384   $(, $($args)*)?);
        $mac!(b"sha3-512",   Sha3_512   $(, $($args)*)?);
        $mac!(b"shake128",   Shake128   $(, $($args)*)?);
        $mac!(b"shake256",   Shake256   $(, $($args)*)?);
        $mac!(b"blake2s256", Blake2s256 $(, $($args)*)?);
    };
}

impl CryptoHasherZig {
    pub fn hash_by_name(
        global: &JSGlobalObject,
        algorithm: &ZigString,
        input: BlobOrStringOrBuffer,
        output: Option<StringOrBuffer>,
    ) -> JsResult<Option<JSValue>> {
        macro_rules! arm {
            ($name:literal, $ty:ty, $g:expr, $alg:expr, $in:expr, $out:expr) => {
                if $alg.slice() == $name {
                    return Ok(Some(Self::hash_by_name_inner::<$ty>($g, $in, $out)?));
                }
            };
        }
        for_each_zig_algo!(arm, global, algorithm, input, output);
        Ok(None)
    }

    fn hash_by_name_inner<A: ZigHashAlgo>(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        if let Some(string_or_buffer) = output {
            match string_or_buffer {
                StringOrBuffer::Buffer(buffer) => {
                    return Self::hash_by_name_inner_to_bytes::<A>(
                        global,
                        input,
                        Some(buffer.buffer),
                    );
                }
                other => {
                    let str = other.as_string_like();
                    let Some(encoding) = Encoding::from(str.slice()) else {
                        return Err(global
                            .err_invalid_arg_value(format_args!(
                                "Unknown encoding: {}",
                                bstr::BStr::new(str.slice())
                            ))
                            .throw());
                    };

                    if encoding == Encoding::Buffer {
                        return Self::hash_by_name_inner_to_bytes::<A>(global, input, None);
                    }

                    return Self::hash_by_name_inner_to_string::<A>(global, input, encoding);
                }
            }
        }
        Self::hash_by_name_inner_to_bytes::<A>(global, input, None)
    }

    fn hash_by_name_inner_to_string<A: ZigHashAlgo>(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        let mut h = A::init();
        h.update(input.slice());

        let mut out = [0u8; A::DIGEST_LENGTH as usize];
        // TODO(port): const-generic array length from trait assoc const requires
        // `feature(generic_const_exprs)` — Phase B may need a stack buffer of EVP_MAX_MD_SIZE
        // sliced to A::DIGEST_LENGTH instead.
        h.final_(&mut out);

        encoding.encode_with_size(global, A::DIGEST_LENGTH as usize, &out)
    }

    fn hash_by_name_inner_to_bytes<A: ZigHashAlgo>(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        let mut h = A::init();
        let digest_length_comptime = A::DIGEST_LENGTH as usize;

        if let Some(output_buf) = &output {
            if output_buf.byte_slice().len() < digest_length_comptime {
                return Err(global.throw_invalid_arguments(
                    "TypedArray must be at least {d} bytes",
                    format_args!("{}", digest_length_comptime),
                ));
            }
        }

        h.update(input.slice());

        if let Some(output_buf) = output {
            h.final_(&mut output_buf.slice_mut()[0..digest_length_comptime]);
            Ok(output_buf.value)
        } else {
            let mut out = [0u8; A::DIGEST_LENGTH as usize];
            // TODO(port): see note above re: generic_const_exprs.
            h.final_(&mut out);
            // Clone to GC-managed memory
            ArrayBuffer::create_buffer(global, &out)
        }
    }

    fn constructor(algorithm: &ZigString) -> Option<Box<CryptoHasher>> {
        macro_rules! arm {
            ($name:literal, $ty:ty, $alg:expr) => {
                if $alg.slice() == $name {
                    return Some(CryptoHasher::new(CryptoHasher::Zig(CryptoHasherZig {
                        algorithm: <$ty as ZigHashAlgo>::ALGORITHM,
                        state: Box::new(<$ty as ZigHashAlgo>::init()),
                        digest_length: <$ty as ZigHashAlgo>::DIGEST_LENGTH,
                    })));
                }
            };
        }
        for_each_zig_algo!(arm, algorithm);
        None
    }

    pub fn init(algorithm: &[u8]) -> Option<CryptoHasherZig> {
        macro_rules! arm {
            ($name:literal, $ty:ty, $alg:expr) => {
                if $alg == $name {
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
            ($name:literal, $ty:ty, $self:expr, $bytes:expr) => {
                if $self.algorithm == <$ty as ZigHashAlgo>::ALGORITHM {
                    // SAFETY: tag matches type stored in `state` (set in init/constructor).
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
            ($name:literal, $ty:ty, $self:expr) => {
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
            ($name:literal, $ty:ty, $self:expr, $out:expr, $len:expr) => {
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
// StaticCryptoHasher
// ───────────────────────────────────────────────────────────────────────────

/// Trait for `Hashers.*` (src/sha_hmac/sha.zig) — replaces the comptime `Hasher`
/// type param. `HAS_ENGINE` replaces the Zig `@typeInfo(@TypeOf(Hasher.hash)).fn.params.len == 3`
/// reflection: when true, `hash()` takes a BoringSSL ENGINE*.
pub trait StaticHasher: Default + 'static {
    const NAME: &'static str;
    const DIGEST: usize;
    type Digest: AsRef<[u8]> + AsMut<[u8]> + Default; // = [u8; Self::DIGEST]
    const HAS_ENGINE: bool;

    fn init() -> Self;
    fn update(&mut self, bytes: &[u8]);
    fn final_(&mut self, out: &mut Self::Digest);
    fn hash(input: &[u8], out: &mut Self::Digest, engine: Option<*mut boring_ssl::ENGINE>);
}

#[bun_jsc::JsClass]
pub struct StaticCryptoHasher<H: StaticHasher> {
    pub hashing: H,
    pub digested: bool,
}

impl<H: StaticHasher> Default for StaticCryptoHasher<H> {
    fn default() -> Self {
        Self {
            hashing: H::default(),
            digested: false,
        }
    }
}

impl<H: StaticHasher> StaticCryptoHasher<H> {
    // `pub const digest = host_fn.wrapInstanceMethod(ThisHasher, "digest_", false);`
    // `pub const hash   = host_fn.wrapStaticMethod(ThisHasher, "hash_", false);`
    // TODO(port): proc-macro — see note on CryptoHasher::digest/hash.

    pub fn get_byte_length(_this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(u16::try_from(H::DIGEST).unwrap())
    }

    pub fn get_byte_length_static(_: &JSGlobalObject, _: JSValue, _: JSValue) -> JSValue {
        JSValue::js_number(u16::try_from(H::DIGEST).unwrap())
    }

    fn hash_to_encoding(
        global: &JSGlobalObject,
        input: &BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::Digest::default();

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        if H::HAS_ENGINE {
            H::hash(
                input.slice(),
                &mut output_digest_buf,
                Some(bun_jsc::VirtualMachine::get().rare_data().boring_engine()),
            );
        } else {
            H::hash(input.slice(), &mut output_digest_buf, None);
        }

        encoding.encode_with_size(global, H::DIGEST, output_digest_buf.as_ref())
    }

    fn hash_to_bytes(
        global: &JSGlobalObject,
        input: &BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::Digest::default();
        // PORT NOTE: reshaped for borrowck — Zig used `*Hasher.Digest` rebound into output buffer.
        let output_digest_slice: &mut H::Digest;
        if let Some(output_buf) = &output {
            let bytes = output_buf.byte_slice();
            if bytes.len() < H::DIGEST {
                return Err(global.throw_invalid_arguments(
                    // TODO(port): comptimePrint with H::DIGEST — const_format can't see trait
                    // assoc consts generically; Phase B can specialize per-H or format at runtime.
                    "TypedArray must be at least {d} bytes",
                    format_args!("{}", H::DIGEST),
                ));
            }
            // SAFETY: bytes.len() >= H::DIGEST checked above; H::Digest = [u8; H::DIGEST].
            output_digest_slice = unsafe {
                &mut *(output_buf.byte_slice_mut_ptr() as *mut H::Digest)
            };
        } else {
            output_digest_slice = &mut output_digest_buf;
        }

        if H::HAS_ENGINE {
            H::hash(
                input.slice(),
                output_digest_slice,
                Some(bun_jsc::VirtualMachine::get().rare_data().boring_engine()),
            );
        } else {
            H::hash(input.slice(), output_digest_slice, None);
        }

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            let mut array_buffer_out = ArrayBuffer::from_bytes(
                Box::<[u8]>::from(output_digest_slice.as_ref()),
                ArrayBuffer::Kind::Uint8Array,
            );
            array_buffer_out.to_js_unchecked(global)
        }
    }

    pub fn hash_(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if input.is_blob() && input.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }

        if let Some(string_or_buffer) = output {
            match string_or_buffer {
                StringOrBuffer::Buffer(buffer) => {
                    Self::hash_to_bytes(global, &input, Some(buffer.buffer))
                }
                other => {
                    let str = other.as_string_like();
                    let Some(encoding) = Encoding::from(str.slice()) else {
                        return Err(global
                            .err_invalid_arg_value(format_args!(
                                "Unknown encoding: {}",
                                bstr::BStr::new(str.slice())
                            ))
                            .throw());
                    };

                    Self::hash_to_encoding(global, &input, encoding)
                }
            }
        } else {
            Self::hash_to_bytes(global, &input, None)
        }
    }

    #[bun_jsc::host_fn]
    pub fn constructor(_: &JSGlobalObject, _: &CallFrame) -> JsResult<Box<Self>> {
        Ok(Box::new(Self {
            hashing: H::init(),
            digested: false,
        }))
    }

    pub fn getter(global: &JSGlobalObject, _: &JSObject) -> JSValue {
        // TODO(port): `@field(jsc.Codegen, "JS" ++ name).getConstructor(global)` —
        // codegen accessor is per-monomorphization; Phase B wires via #[bun_jsc::JsClass].
        bun_jsc::codegen::get_constructor::<Self>(global)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.digested {
            return Err(global
                .err_invalid_state(format_args!(
                    "{} hasher already digested, create a new instance to update",
                    H::NAME
                ))
                .throw());
        }
        let this_value = callframe.this();
        let input = callframe.argument(0);
        let buffer = match BlobOrStringOrBuffer::from_js(global, input)? {
            Some(b) => b,
            None => {
                return Err(global.throw_invalid_arguments(
                    "expected blob or string or buffer",
                    format_args!(""),
                ));
            }
        };
        // `defer buffer.deinit()` — handled by Drop.

        if buffer.is_blob() && buffer.blob().is_bun_file() {
            return Err(global.throw(
                "Bun.file() is not supported here yet (it needs an async version)",
                format_args!(""),
            ));
        }
        this.hashing.update(buffer.slice());
        Ok(this_value)
    }

    pub fn digest_(
        this: &mut Self,
        global: &JSGlobalObject,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        if this.digested {
            return Err(global
                .err_invalid_state(format_args!(
                    "{} hasher already digested, create a new instance to digest again",
                    H::NAME
                ))
                .throw());
        }
        if let Some(string_or_buffer) = output {
            match string_or_buffer {
                StringOrBuffer::Buffer(buffer) => {
                    this.digest_to_bytes(global, Some(buffer.buffer))
                }
                other => {
                    let str = other.as_string_like();
                    let Some(encoding) = Encoding::from(str.slice()) else {
                        return Err(global
                            .err_invalid_arg_value(format_args!(
                                "Unknown encoding: {}",
                                bstr::BStr::new(str.slice())
                            ))
                            .throw());
                    };

                    this.digest_to_encoding(global, encoding)
                }
            }
        } else {
            this.digest_to_bytes(global, None)
        }
    }

    fn digest_to_bytes(
        &mut self,
        global: &JSGlobalObject,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::Digest::default();
        let output_digest_slice: &mut H::Digest;
        if let Some(output_buf) = &output {
            let bytes = output_buf.byte_slice();
            if bytes.len() < H::DIGEST {
                return Err(global.throw_invalid_arguments(
                    "TypedArray must be at least {d} bytes",
                    format_args!("{}", H::DIGEST),
                ));
            }
            // SAFETY: bytes.len() >= H::DIGEST; H::Digest = [u8; H::DIGEST].
            output_digest_slice = unsafe {
                &mut *(output_buf.byte_slice_mut_ptr() as *mut H::Digest)
            };
        } else {
            // Zig: `output_digest_buf = std.mem.zeroes(Hasher.Digest);` — Default already zeroes.
            output_digest_slice = &mut output_digest_buf;
        }

        self.hashing.final_(output_digest_slice);
        self.digested = true;

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            let mut array_buffer_out = ArrayBuffer::from_bytes(
                Box::<[u8]>::from(output_digest_buf.as_ref()),
                ArrayBuffer::Kind::Uint8Array,
            );
            array_buffer_out.to_js_unchecked(global)
        }
    }

    fn digest_to_encoding(
        &mut self,
        global: &JSGlobalObject,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        // Zig comptime zero-init loop → Default (zeroed [u8; N]).
        let mut output_digest_buf: H::Digest = H::Digest::default();

        let output_digest_slice: &mut H::Digest = &mut output_digest_buf;

        self.hashing.final_(output_digest_slice);
        self.digested = true;

        encoding.encode_with_size(global, H::DIGEST, output_digest_slice.as_ref())
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` was allocated via `Box::new` in `constructor`.
        drop(unsafe { Box::from_raw(this) });
    }
}

pub type MD4 = StaticCryptoHasher<hashers::MD4>;
pub type MD5 = StaticCryptoHasher<hashers::MD5>;
pub type SHA1 = StaticCryptoHasher<hashers::SHA1>;
pub type SHA224 = StaticCryptoHasher<hashers::SHA224>;
pub type SHA256 = StaticCryptoHasher<hashers::SHA256>;
pub type SHA384 = StaticCryptoHasher<hashers::SHA384>;
pub type SHA512 = StaticCryptoHasher<hashers::SHA512>;
pub type SHA512_256 = StaticCryptoHasher<hashers::SHA512_256>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/CryptoHasher.zig (894 lines)
//   confidence: medium-high
//   todos:      12
//   notes:      Heavy comptime reflection (algo_map inline-for, @typeInfo on Hasher.hash arity) replaced with ZigHashAlgo/StaticHasher traits + for_each_zig_algo! macro; [u8; ASSOC_CONST] arrays need generic_const_exprs workaround; StringOrBuffer `inline else` arms collapsed to .as_string_like() helper.
// ──────────────────────────────────────────────────────────────────────────
