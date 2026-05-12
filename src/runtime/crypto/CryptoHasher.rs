use core::any::Any;
use core::cell::Cell;
use core::ffi::c_char;

use bun_boringssl_sys as boring_ssl;
use bun_core::ZigString;
use bun_jsc::{
    ArrayBuffer, CallFrame, ErrorCode, JSGlobalObject, JSObject, JSValue, JsCell, JsClass as _,
    JsError, JsResult,
};

use crate::crypto::evp::{AlgorithmExt as _, EVP};
use crate::crypto::{HMAC, create_crypto_error, evp};
use crate::generated_classes::PropertyName;
use crate::node::{BlobOrStringOrBuffer, Encoding, StringOrBuffer};
// `Hashers` = src/sha_hmac/sha.zig (re-exported via bun_sha_hmac::sha::evp::*).
use bun_sha_hmac::sha as hashers;

// `std.crypto.hash.{sha3,blake2}` — pure-Zig stdlib algos with no BoringSSL
// streaming context. Per docs/PORTING.md ("prefer a well-tested crates.io dep
// over hand-porting bit-twiddling"), wire RustCrypto's `sha3`/`blake2` into the
// `ZigHashAlgo` trait below.
use zig_crypto_algos::{Blake2s256, Sha3_224, Sha3_256, Sha3_384, Sha3_512, Shake128, Shake256};

// Zig: `const Digest = EVP.Digest;` → `[u8; EVP_MAX_MD_SIZE]`
type Digest = evp::Digest;

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

/// Local helper replacing `input == .blob && input.blob.isBunFile()`.
#[inline]
fn is_bun_file_blob(input: &BlobOrStringOrBuffer) -> bool {
    match input {
        BlobOrStringOrBuffer::Blob(b) => b.is_bun_file(),
        _ => false,
    }
}

/// `union(enum)` → Rust enum with payload variants.
/// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated; this is the `m_ctx` payload.
///
/// `#[repr(C)]` only to satisfy the `improper_ctypes` lint on the generated
/// `extern "C" fn(..., *mut CryptoHasher)` shims — C++ never reads this layout
/// (it round-trips `m_ctx` as `void*`).
///
/// R-2 (`sharedThis`): every JS-facing host-fn takes `&CryptoHasher` (not
/// `&mut`). The discriminant is fixed at construction; only the payload mutates,
/// so each variant payload is wrapped in [`JsCell`] (UnsafeCell projector,
/// single-JS-thread). The codegen shim still emits `this: &mut CryptoHasher`
/// until Phase 1 lands — `&mut T` auto-derefs to `&T` so the impls below
/// compile against either.
#[bun_jsc::JsClass]
#[repr(C)]
pub enum CryptoHasher {
    // HMAC_CTX contains 3 EVP_CTX, so let's store it as a pointer.
    Hmac(JsCell<Option<Box<HMAC>>>),
    Evp(JsCell<EVP>),
    Zig(JsCell<CryptoHasherZig>),
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
        let name = unsafe { bun_core::ffi::slice(name_bytes.cast::<u8>(), name_len) };

        if let Some(inner) = CryptoHasherZig::init(name) {
            return Some(CryptoHasher::new(CryptoHasher::Zig(JsCell::new(inner))));
        }

        let Some(algorithm) = evp::lookup(name) else {
            return None;
        };

        match algorithm {
            evp::Algorithm::Ripemd160
            | evp::Algorithm::Blake2b256
            | evp::Algorithm::Blake2b512
            | evp::Algorithm::Sha512_224 => {
                if let Some(md) = algorithm.md() {
                    // `Algorithm::md()` lives in `bun_sha_hmac` and
                    // returns that crate's opaque `EVP_MD`; cast to the boringssl-sys
                    // opaque (same underlying C `struct env_md_st`).
                    return Some(CryptoHasher::new(CryptoHasher::Evp(JsCell::new(
                        EVP::init(
                            algorithm,
                            md.cast::<boring_ssl::EVP_MD>(),
                            boring_engine(global),
                        ),
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
                let hasher = CryptoHasher::new(CryptoHasher::Zig(JsCell::new(other.get().copy())));
                Some(hasher)
            }
            CryptoHasher::Evp(other) => {
                let evp = match other.get().copy(boring_engine(global)) {
                    Ok(e) => e,
                    Err(_) => return None,
                };
                Some(CryptoHasher::new(CryptoHasher::Evp(JsCell::new(evp))))
            }
            _ => None,
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__CryptoHasherExtern__destroy(handle: *mut CryptoHasher) {
        // SAFETY: `handle` was produced by heap::alloc via getByName/getFromOther
        // and ownership is being returned to us.
        CryptoHasher::finalize(unsafe { Box::from_raw(handle) });
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__update")]
    pub fn extern_update(&self, input: &[u8]) -> bool {
        match self {
            CryptoHasher::Zig(zig) => {
                zig.with_mut(|z| z.update(input));
                true
            }
            CryptoHasher::Evp(evp) => {
                evp.with_mut(|e| e.update(input));
                true
            }
            _ => false,
        }
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__digest")]
    pub fn extern_digest(&self, global: &JSGlobalObject, digest_buf: &mut [u8]) -> u32 {
        let buf_len = digest_buf.len();
        match self {
            CryptoHasher::Zig(zig) => {
                let res = zig.with_mut(move |z| z.final_with_len(digest_buf, buf_len));
                u32::try_from(res.len()).expect("int cast")
            }
            CryptoHasher::Evp(evp) => {
                let engine = boring_engine(global);
                let res = evp.with_mut(move |e| e.r#final(engine, digest_buf));
                u32::try_from(res.len()).expect("int cast")
            }
            _ => 0,
        }
    }

    #[bun_uws::uws_callback(export = "Bun__CryptoHasherExtern__getDigestSize", no_catch)]
    pub fn extern_digest_size(&self) -> u32 {
        match self {
            CryptoHasher::Zig(inner) => inner.get().digest_length as u32,
            CryptoHasher::Evp(inner) => inner.get().size() as u32,
            _ => 0,
        }
    }

    // ── JS host fns ────────────────────────────────────────────────────────

    /// `pub const digest = jsc.host_fn.wrapInstanceMethod(CryptoHasher, "digest_", false);`
    ///
    /// Hand-expanded `wrapInstanceMethod` decode for the parameter list
    /// `(*CryptoHasher, *JSGlobalObject, ?Node.StringOrBuffer)`.
    pub fn digest(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        // ?Node.StringOrBuffer (instance-method arm: empty/undefined/null → None)
        let output: Option<StringOrBuffer> = if arguments.len > 0 {
            let arg = arguments.ptr[0];
            if !arg.is_empty_or_undefined_or_null() {
                match StringOrBuffer::from_js(global, arg)? {
                    Some(v) => Some(v),
                    None => {
                        return Err(global
                            .throw_invalid_arguments(format_args!("expected string or buffer")));
                    }
                }
            } else {
                None
            }
        } else {
            None
        };
        Self::digest_(this, global, output)
    }

    /// `pub const hash = jsc.host_fn.wrapStaticMethod(CryptoHasher, "hash_", false);`
    ///
    /// Hand-expanded `wrapStaticMethod` decode for the parameter list
    /// `(*JSGlobalObject, ZigString, Node.BlobOrStringOrBuffer, ?Node.StringOrBuffer)`.
    pub fn hash(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<3>();
        let mut i = 0usize;
        let mut next_eat = || {
            if i < arguments.len {
                let v = arguments.ptr[i];
                i += 1;
                Some(v)
            } else {
                None
            }
        };

        // ZigString
        let algorithm = {
            let Some(string_value) = next_eat() else {
                return Err(global.throw_invalid_arguments(format_args!("Missing argument")));
            };
            if string_value.is_undefined_or_null() {
                return Err(global.throw_invalid_arguments(format_args!("Expected string")));
            }
            string_value.get_zig_string(global)?
        };

        // Node.BlobOrStringOrBuffer
        let input = {
            let Some(arg) = next_eat() else {
                return Err(
                    global.throw_invalid_arguments(format_args!("expected blob, string or buffer"))
                );
            };
            match BlobOrStringOrBuffer::from_js(global, arg)? {
                Some(b) => b,
                None => {
                    return Err(global
                        .throw_invalid_arguments(format_args!("expected blob, string or buffer")));
                }
            }
        };

        // ?Node.StringOrBuffer (static-method arm: only `undefined` → None)
        let output: Option<StringOrBuffer> = match next_eat() {
            Some(arg) => match StringOrBuffer::from_js(global, arg)? {
                Some(v) => Some(v),
                None => {
                    if arg.is_undefined() {
                        None
                    } else {
                        return Err(global
                            .throw_invalid_arguments(format_args!("expected string or buffer")));
                    }
                }
            },
            None => None,
        };

        Self::hash_(global, algorithm, input, output)
    }

    fn throw_hmac_consumed(global: &JSGlobalObject) -> JsError {
        global.throw(format_args!(
            "HMAC has been consumed and is no longer usable"
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_byte_length(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(match this {
            CryptoHasher::Evp(inner) => inner.get().size() as f64,
            CryptoHasher::Hmac(inner) => match inner.get() {
                Some(hmac) => hmac.size() as f64,
                None => return Err(Self::throw_hmac_consumed(global)),
            },
            CryptoHasher::Zig(inner) => inner.get().digest_length as f64,
        }))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_algorithm(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // Zig: `@tagName(inner.algorithm)` → `AlgorithmExt::tag_cstr` (ASCII).
        let tag: &'static [u8] = match this {
            CryptoHasher::Evp(inner) => inner.get().algorithm.tag_cstr().to_bytes(),
            CryptoHasher::Zig(inner) => inner.get().algorithm.tag_cstr().to_bytes(),
            CryptoHasher::Hmac(inner) => match inner.get() {
                Some(hmac) => hmac.algorithm.tag_cstr().to_bytes(),
                None => return Err(Self::throw_hmac_consumed(global)),
            },
        };
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, tag)
    }

    // PORT NOTE: `#[bun_jsc::host_fn]` (Free) emits a bare `fn_name(g, f)` call,
    // which cannot resolve to an associated fn inside an `impl` block. The shim
    // for this static prop getter is wired by `#[bun_jsc::JsClass]` codegen.
    pub fn get_algorithms(
        global: &JSGlobalObject,
        _: JSValue,
        _: PropertyName,
    ) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::to_js_array(global, evp::Algorithm::names())
    }

    fn hash_to_encoding(
        global: &JSGlobalObject,
        evp: &mut EVP,
        input: BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: Digest = [0u8; EVP_MAX_MD_SIZE_USIZE];
        // `defer input.deinit()` — handled by Drop on `input`.

        if is_bun_file_blob(&input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        let Some(len) = evp.hash(boring_engine(global), input.slice(), &mut output_digest_buf)
        else {
            let err = boring_ssl::ERR_get_error();
            let instance = create_crypto_error(global, err);
            boring_ssl::ERR_clear_error();
            return Err(global.throw_value(instance));
        };
        encoding.encode_with_max_size(
            global,
            EVP_MAX_MD_SIZE_USIZE,
            &output_digest_buf[0..len as usize],
        )
    }

    fn hash_to_bytes(
        global: &JSGlobalObject,
        evp: &mut EVP,
        input: BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: Digest = [0u8; EVP_MAX_MD_SIZE_USIZE];
        let mut output_digest_slice: &mut [u8] = &mut output_digest_buf;
        // `defer input.deinit()` — handled by Drop on `input`.

        if is_bun_file_blob(&input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        if let Some(output_buf) = &output {
            let size = evp.size() as usize;
            let bytes_len = output_buf.byte_slice().len();
            if bytes_len < size {
                return Err(global.throw_invalid_arguments(format_args!(
                    "TypedArray must be at least {} bytes",
                    size
                )));
            }
            // PORT NOTE: reshaped for borrowck — Zig rebinds the slice into the output buffer.
            // SAFETY: `output_buf.ptr` is the JSC-owned writable backing store
            // (`bytes_len >= size` checked above; not detached since len > 0);
            // borrowed for this frame only. Build the `&mut` directly from the
            // raw `*mut u8` field — never via `&[u8].as_ptr()` (Stacked-Borrows UB).
            output_digest_slice = unsafe { core::slice::from_raw_parts_mut(output_buf.ptr, size) };
        }

        let Some(len) = evp.hash(boring_engine(global), input.slice(), output_digest_slice) else {
            let err = boring_ssl::ERR_get_error();
            let instance = create_crypto_error(global, err);
            boring_ssl::ERR_clear_error();
            return Err(global.throw_value(instance));
        };

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            // Clone to GC-managed memory
            ArrayBuffer::create_buffer(global, &output_digest_slice[0..len as usize])
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
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Unsupported algorithm \"{}\"",
                        algorithm
                    )));
                }
            },
        };
        // `defer evp.deinit()` — handled by Drop on `evp`.

        if let Some(string_or_buffer) = output {
            if let StringOrBuffer::Buffer(buffer) = &string_or_buffer {
                let ab = buffer.buffer;
                return Self::hash_to_bytes(global, &mut evp, input, Some(ab));
            }
            // `inline else => |*str|` — every non-buffer arm yields a string-like
            // `defer str.deinit()` — handled by Drop.
            let Some(encoding) = Encoding::from(string_or_buffer.slice()) else {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Unknown encoding: {}",
                            bstr::BStr::new(string_or_buffer.slice())
                        ),
                    )
                    .throw());
            };

            Self::hash_to_encoding(global, &mut evp, input, encoding)
        } else {
            Self::hash_to_bytes(global, &mut evp, input, None)
        }
    }

    // Bun.CryptoHasher(algorithm, hmacKey?: string | Buffer)
    // PORT NOTE: `#[bun_jsc::host_fn]` (Free) emits a bare `fn_name(g, f)` call,
    // which cannot resolve to an associated fn inside an `impl` block. The
    // constructor shim is wired by `#[bun_jsc::JsClass]` codegen.
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<CryptoHasher>> {
        let arguments = callframe.arguments_old::<2>();
        if arguments.len == 0 {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected an algorithm name as an argument"
            )));
        }

        let algorithm_name = arguments.ptr[0];
        if algorithm_name.is_empty_or_undefined_or_null() || !algorithm_name.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("algorithm must be a string")));
        }

        let algorithm = algorithm_name.get_zig_string(global)?;

        if algorithm.len == 0 {
            return Err(global.throw_invalid_arguments(format_args!("Invalid algorithm name")));
        }

        let hmac_value = arguments.ptr[1];
        let mut hmac_key: Option<StringOrBuffer> = None;
        // `defer { if (hmac_key) |*key| key.deinit(); }` — handled by Drop on `hmac_key`.

        if !hmac_value.is_empty_or_undefined_or_null() {
            hmac_key = match StringOrBuffer::from_js(global, hmac_value)? {
                Some(k) => Some(k),
                None => {
                    return Err(global
                        .throw_invalid_arguments(format_args!("key must be a string or buffer")));
                }
            };
        }

        let init = 'brk: {
            if let Some(key) = &hmac_key {
                // Inlined `JSValue::to_enum_from_map` (the `is_string` guard
                // already ran above) so the lookup goes through the
                // length-gated `evp::lookup` instead of a `phf::Map`.
                let chosen_algorithm: evp::Algorithm = {
                    let slice = algorithm_name.to_slice(global)?;
                    match evp::lookup(slice.slice()) {
                        Some(v) => v,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "algorithm must be one of {}",
                                evp::ALGORITHM_ONE_OF
                            )));
                        }
                    }
                };

                break 'brk CryptoHasher::Hmac(JsCell::new(Some(
                    match HMAC::init(chosen_algorithm, key.slice()) {
                        Some(h) => h,
                        None => {
                            if !global.has_exception() {
                                let err = boring_ssl::ERR_get_error();
                                if err != 0 {
                                    let instance = create_crypto_error(global, err);
                                    boring_ssl::ERR_clear_error();
                                    return Err(global.throw_value(instance));
                                } else {
                                    return Err(global.throw_todo(
                                        b"HMAC is not supported for this algorithm yet",
                                    ));
                                }
                            }
                            return Err(JsError::Thrown);
                        }
                    },
                )));
            }

            break 'brk CryptoHasher::Evp(JsCell::new(match EVP::by_name(&algorithm, global) {
                Some(e) => e,
                None => match CryptoHasherZig::constructor(&algorithm) {
                    Some(h) => return Ok(h),
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Unsupported algorithm {}",
                            algorithm
                        )));
                    }
                },
            }));
        };
        Ok(CryptoHasher::new(init))
    }

    pub fn getter(global: &JSGlobalObject, _: &JSObject) -> JSValue {
        bun_jsc::codegen::js::get_constructor::<CryptoHasher>(global)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        let arguments = callframe.arguments_old::<2>();
        let input = arguments.ptr[0];
        if input.is_empty_or_undefined_or_null() {
            return Err(
                global.throw_invalid_arguments(format_args!("expected blob, string or buffer"))
            );
        }
        let encoding = arguments.ptr[1];
        let buffer =
            match BlobOrStringOrBuffer::from_js_with_encoding_value(global, input, encoding)? {
                Some(b) => b,
                None => {
                    if !global.has_exception() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "expected blob, string or buffer"
                        )));
                    }
                    return Err(JsError::Thrown);
                }
            };
        // `defer buffer.deinit()` — handled by Drop.
        if is_bun_file_blob(&buffer) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        match this {
            CryptoHasher::Evp(inner) => {
                inner.with_mut(|e| e.update(buffer.slice()));
                let err = boring_ssl::ERR_get_error();
                if err != 0 {
                    let instance = create_crypto_error(global, err);
                    boring_ssl::ERR_clear_error();
                    return Err(global.throw_value(instance));
                }
            }
            CryptoHasher::Hmac(inner) => {
                // R-2: check None first via shared `.get()`, then mutate via
                // `with_mut`. No JS re-entry between the check and the write
                // (HMAC_Update is a pure FFI call), so the `unwrap` is sound.
                if inner.get().is_none() {
                    return Err(Self::throw_hmac_consumed(global));
                }
                inner.with_mut(|opt| opt.as_mut().unwrap().update(buffer.slice()));
                let err = boring_ssl::ERR_get_error();
                if err != 0 {
                    let instance = create_crypto_error(global, err);
                    boring_ssl::ERR_clear_error();
                    return Err(global.throw_value(instance));
                }
            }
            CryptoHasher::Zig(inner) => {
                inner.with_mut(|z| z.update(buffer.slice()));
                return Ok(this_value);
            }
        }

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy(this: &Self, global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let copied: CryptoHasher = match this {
            CryptoHasher::Evp(inner) => CryptoHasher::Evp(JsCell::new(
                inner
                    .get()
                    .copy(boring_engine(global))
                    // bun.handleOom → unwrap (abort on OOM)
                    .expect("OOM"),
            )),
            CryptoHasher::Hmac(inner) => 'brk: {
                // R-2: `HMAC::copy` takes `&mut self` (writes nothing — Zig
                // legacy signature). Project a short `&mut` via `with_mut`;
                // no JS re-entry inside (HMAC_CTX_copy is a pure FFI call).
                let copy_result = inner.with_mut(|opt| opt.as_mut().map(|h| h.copy()));
                let Some(result) = copy_result else {
                    return Err(Self::throw_hmac_consumed(global));
                };
                break 'brk CryptoHasher::Hmac(JsCell::new(Some(match result {
                    Ok(h) => h,
                    Err(_) => {
                        let code = boring_ssl::ERR_get_error();
                        let err = create_crypto_error(global, code);
                        boring_ssl::ERR_clear_error();
                        return Err(global.throw_value(err));
                    }
                })));
            }
            CryptoHasher::Zig(inner) => CryptoHasher::Zig(JsCell::new(inner.get().copy())),
        };
        Ok(copied.to_js(global))
    }

    pub fn digest_(
        this: &Self,
        global: &JSGlobalObject,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        if let Some(string_or_buffer) = output {
            if let StringOrBuffer::Buffer(buffer) = &string_or_buffer {
                let ab = buffer.buffer;
                return this.digest_to_bytes(global, Some(ab));
            }
            // `defer str.deinit()` — handled by Drop.
            let Some(encoding) = Encoding::from(string_or_buffer.slice()) else {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Unknown encoding: {}",
                            bstr::BStr::new(string_or_buffer.slice())
                        ),
                    )
                    .throw());
            };

            this.digest_to_encoding(global, encoding)
        } else {
            this.digest_to_bytes(global, None)
        }
    }

    fn digest_to_bytes(
        &self,
        global: &JSGlobalObject,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: evp::Digest = [0u8; EVP_MAX_MD_SIZE_USIZE];
        let buf_len = output_digest_buf.len();
        let output_digest_slice: &mut [u8];
        if let Some(output_buf) = &output {
            let bytes_len = output_buf.byte_slice().len();
            if bytes_len < buf_len {
                return Err(global.throw_invalid_arguments(format_args!(
                    "TypedArray must be at least {} bytes",
                    boring_ssl::EVP_MAX_MD_SIZE
                )));
            }
            // PORT NOTE: reshaped for borrowck.
            // SAFETY: `bytes_len >= EVP_MAX_MD_SIZE` checked above; `output_buf.ptr`
            // is the JSC-owned writable backing store, outliving this frame. Build
            // the `&mut` directly from the raw `*mut u8` field — never via
            // `&[u8].as_ptr()` (Stacked-Borrows UB).
            output_digest_slice =
                unsafe { core::slice::from_raw_parts_mut(output_buf.ptr, bytes_len) };
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

    fn digest_to_encoding(&self, global: &JSGlobalObject, encoding: Encoding) -> JsResult<JSValue> {
        let mut output_digest_buf: evp::Digest = [0u8; EVP_MAX_MD_SIZE_USIZE];
        let output_digest_slice: &mut [u8] = &mut output_digest_buf;
        let out = match self.final_(global, output_digest_slice) {
            Ok(r) => r,
            Err(_) => return Ok(JSValue::ZERO),
        };
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        encoding.encode_with_max_size(global, EVP_MAX_MD_SIZE_USIZE, out)
    }

    fn final_<'a>(
        &self,
        global: &JSGlobalObject,
        output_digest_slice: &'a mut [u8],
    ) -> JsResult<&'a mut [u8]> {
        match self {
            CryptoHasher::Hmac(inner) => 'brk: {
                let Some(mut hmac) = inner.replace(None) else {
                    return Err(Self::throw_hmac_consumed(global));
                };
                // `this.hmac = null; defer hmac.deinit();` — `replace(None)` + Drop on `hmac`.
                // PORT NOTE: `HMAC::r#final<'a>(&mut self, out: &'a mut [u8]) -> &'a mut [u8]`
                // returns a subslice of `out`, not `self`, so dropping `hmac` at scope end
                // does not invalidate the returned borrow.
                break 'brk Ok(hmac.r#final(output_digest_slice));
            }
            CryptoHasher::Evp(inner) => {
                // R-2: `with_mut` scopes the `&mut EVP` to the FFI call; the
                // returned `&'a mut [u8]` borrows `output_digest_slice` (not
                // `self`), so it escapes the closure cleanly.
                let engine = boring_engine(global);
                Ok(inner.with_mut(move |e| e.r#final(engine, output_digest_slice)))
            }
            CryptoHasher::Zig(inner) => Ok(inner.with_mut(move |z| z.final_(output_digest_slice))),
        }
    }

    /// `.classes.ts` finalize — runs on mutator thread during lazy sweep.
    pub fn finalize(self: Box<Self>) {
        match *self {
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
    pub algorithm: evp::Algorithm,
    pub state: Box<dyn Any>,
    pub digest_length: u8,
}

/// Trait for the Zig-std hash algorithms used by `CryptoHasherZig`.
/// Replaces the comptime `(string, type)` table + `@typeInfo` introspection.
/// Implemented for each algo in `zig_crypto_algos` below.
pub trait ZigHashAlgo: Default + Clone + 'static {
    const NAME: &'static [u8];
    const ALGORITHM: evp::Algorithm;
    /// Replaces `digestLength(Algorithm)` (Shake128→16, Shake256→32, else `T.digest_length`).
    const DIGEST_LENGTH: u8;
    fn init() -> Self {
        Self::default()
    }
    fn update(&mut self, bytes: &[u8]);
    fn final_(&mut self, out: &mut [u8]);
}

/// Hash-state types for the Zig-stdlib algorithms (`std.crypto.hash.{sha3,blake2}`)
/// that BoringSSL does not expose as a streaming context. Backed by RustCrypto's
/// `sha3`/`blake2` crates (same Keccak-p[1600,24] permutation and BLAKE2s as
/// Zig's `std.crypto`).
mod zig_crypto_algos {
    use super::{ZigHashAlgo, evp};
    use sha3::digest::{ExtendableOutputReset, FixedOutputReset, Output, Update};

    pub type Sha3_224 = sha3::Sha3_224;
    pub type Sha3_256 = sha3::Sha3_256;
    pub type Sha3_384 = sha3::Sha3_384;
    pub type Sha3_512 = sha3::Sha3_512;
    pub type Shake128 = sha3::Shake128;
    pub type Shake256 = sha3::Shake256;
    pub type Blake2s256 = blake2::Blake2s256;

    /// Fixed-digest Keccak/BLAKE2 — Zig `T.final(state, *[digest_length]u8)`
    /// writes exactly `digest_length` bytes; mirror via `FixedOutputReset`.
    macro_rules! impl_fixed {
        ($ty:ty, $name:literal, $variant:ident, $len:expr) => {
            impl ZigHashAlgo for $ty {
                const NAME: &'static [u8] = $name;
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

    /// SHAKE XOF — Zig `digestLength(Shake128) = 16` / `Shake256 = 32` (the
    /// Zig stdlib's `Shake.final` squeezes exactly `out.len` bytes).
    macro_rules! impl_xof {
        ($ty:ty, $name:literal, $variant:ident, $len:expr) => {
            impl ZigHashAlgo for $ty {
                const NAME: &'static [u8] = $name;
                const ALGORITHM: evp::Algorithm = evp::Algorithm::$variant;
                const DIGEST_LENGTH: u8 = $len;
                fn update(&mut self, bytes: &[u8]) {
                    Update::update(self, bytes);
                }
                fn final_(&mut self, out: &mut [u8]) {
                    // Zig `Shake.final(out: []u8)` squeezes exactly `out.len`
                    // bytes — fill the full slice, not just `DIGEST_LENGTH`.
                    ExtendableOutputReset::finalize_xof_reset_into(self, out);
                }
            }
        };
    }

    impl_fixed!(Sha3_224, b"sha3-224", Sha3_224, 28);
    impl_fixed!(Sha3_256, b"sha3-256", Sha3_256, 32);
    impl_fixed!(Sha3_384, b"sha3-384", Sha3_384, 48);
    impl_fixed!(Sha3_512, b"sha3-512", Sha3_512, 64);
    impl_xof!(Shake128, b"shake128", Shake128, 16);
    impl_xof!(Shake256, b"shake256", Shake256, 32);
    impl_fixed!(Blake2s256, b"blake2s256", Blake2s256, 32);
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
            if let StringOrBuffer::Buffer(buffer) = &string_or_buffer {
                let ab = buffer.buffer;
                return Self::hash_by_name_inner_to_bytes::<A>(global, input, Some(ab));
            }
            let Some(encoding) = Encoding::from(string_or_buffer.slice()) else {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Unknown encoding: {}",
                            bstr::BStr::new(string_or_buffer.slice())
                        ),
                    )
                    .throw());
            };

            if encoding == Encoding::Buffer {
                return Self::hash_by_name_inner_to_bytes::<A>(global, input, None);
            }

            return Self::hash_by_name_inner_to_string::<A>(global, input, encoding);
        }
        Self::hash_by_name_inner_to_bytes::<A>(global, input, None)
    }

    fn hash_by_name_inner_to_string<A: ZigHashAlgo>(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if is_bun_file_blob(&input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        let mut h = A::init();
        h.update(input.slice());

        // PORT NOTE: const-generic array length from trait assoc const requires
        // `feature(generic_const_exprs)` — use a stack buffer of EVP_MAX_MD_SIZE
        // sliced to A::DIGEST_LENGTH instead.
        let mut out = [0u8; EVP_MAX_MD_SIZE_USIZE];
        let len = A::DIGEST_LENGTH as usize;
        h.final_(&mut out[..len]);

        encoding.encode_with_max_size(global, EVP_MAX_MD_SIZE_USIZE, &out[..len])
    }

    fn hash_by_name_inner_to_bytes<A: ZigHashAlgo>(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if is_bun_file_blob(&input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        let mut h = A::init();
        let digest_length_comptime = A::DIGEST_LENGTH as usize;

        if let Some(output_buf) = &output {
            if output_buf.byte_slice().len() < digest_length_comptime {
                return Err(global.throw_invalid_arguments(format_args!(
                    "TypedArray must be at least {} bytes",
                    digest_length_comptime
                )));
            }
        }

        h.update(input.slice());

        if let Some(output_buf) = output {
            // SAFETY: length checked above; `output_buf.ptr` is the JSC-owned
            // writable backing store, outliving this frame. Build the `&mut`
            // directly from the raw `*mut u8` field — never via `&[u8].as_ptr()`
            // (Stacked-Borrows UB).
            let out =
                unsafe { core::slice::from_raw_parts_mut(output_buf.ptr, digest_length_comptime) };
            h.final_(out);
            Ok(output_buf.value)
        } else {
            let mut out = [0u8; EVP_MAX_MD_SIZE_USIZE];
            h.final_(&mut out[..digest_length_comptime]);
            // Clone to GC-managed memory
            ArrayBuffer::create_buffer(global, &out[..digest_length_comptime])
        }
    }

    fn constructor(algorithm: &ZigString) -> Option<Box<CryptoHasher>> {
        macro_rules! arm {
            ($name:literal, $ty:ty, $alg:expr) => {
                if $alg.slice() == $name {
                    return Some(CryptoHasher::new(CryptoHasher::Zig(JsCell::new(
                        CryptoHasherZig {
                            algorithm: <$ty as ZigHashAlgo>::ALGORITHM,
                            state: Box::new(<$ty as ZigHashAlgo>::init()),
                            digest_length: <$ty as ZigHashAlgo>::DIGEST_LENGTH,
                        },
                    ))));
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
pub trait StaticHasher: 'static {
    const NAME: &'static str;
    const DIGEST: usize;
    type Digest: AsRef<[u8]> + AsMut<[u8]>; // = [u8; Self::DIGEST]
    const HAS_ENGINE: bool;

    fn init() -> Self;
    fn new_digest() -> Self::Digest;
    fn update(&mut self, bytes: &[u8]);
    fn final_(&mut self, out: &mut Self::Digest);
    fn hash(input: &[u8], out: &mut Self::Digest, engine: *mut boring_ssl::ENGINE);
    /// `@field(jsc.Codegen, "JS" ++ name).getConstructor` — per-monomorphization
    /// codegen module (`bun_jsc::generated::JS${NAME}`). Replaces the Zig
    /// `comptime "JS" ++ name` token paste; each `impl_static_hasher!` arm binds
    /// to the typed wrapper exported by `js_class_module!` for its concrete name.
    fn get_constructor(global: &JSGlobalObject) -> JSValue;
}

/// Local impls of `StaticHasher` for the upstream `bun_sha_hmac::sha::evp::*`
/// hasher types. Those types live in another crate so we cannot add inherent
/// methods; the trait bridges the comptime-style API.
macro_rules! impl_static_hasher {
    ($ty:ty, $name:literal, $js_mod:ident, $len:expr) => {
        impl StaticHasher for $ty {
            const NAME: &'static str = $name;
            const DIGEST: usize = $len;
            type Digest = [u8; $len];
            const HAS_ENGINE: bool = true;

            #[inline]
            fn init() -> Self {
                <$ty>::init()
            }
            #[inline]
            fn new_digest() -> Self::Digest {
                [0u8; $len]
            }
            #[inline]
            fn update(&mut self, bytes: &[u8]) {
                <$ty>::update(self, bytes)
            }
            #[inline]
            fn final_(&mut self, out: &mut Self::Digest) {
                <$ty>::r#final(self, out)
            }
            #[inline]
            fn hash(input: &[u8], out: &mut Self::Digest, engine: *mut boring_ssl::ENGINE) {
                // `bun_sha_hmac::sha::ffi::ENGINE` re-exports `bun_boringssl_sys::ENGINE`,
                // so the VM-owned engine pointer threads through without a cast.
                <$ty>::hash(input, out, engine)
            }
            #[inline]
            fn get_constructor(global: &JSGlobalObject) -> JSValue {
                bun_jsc::generated::$js_mod::get_constructor(global)
            }
        }
    };
}

impl_static_hasher!(hashers::MD4, "MD4", JSMD4, 16);
impl_static_hasher!(hashers::MD5, "MD5", JSMD5, 16);
impl_static_hasher!(hashers::SHA1, "SHA1", JSSHA1, 20);
impl_static_hasher!(hashers::SHA224, "SHA224", JSSHA224, 28);
impl_static_hasher!(hashers::SHA256, "SHA256", JSSHA256, 32);
impl_static_hasher!(hashers::SHA384, "SHA384", JSSHA384, 48);
impl_static_hasher!(hashers::SHA512, "SHA512", JSSHA512, 64);
impl_static_hasher!(hashers::SHA512_256, "SHA512_256", JSSHA512_256, 32);

// PORT NOTE: `#[bun_jsc::JsClass]` cannot expand over a generic struct (it emits
// `*mut StaticCryptoHasher` without `<H>`). In Zig each `StaticCryptoHasher(Hasher, name)`
// instantiation gets its own `.classes.ts` codegen; the Rust equivalent must apply
// `JsClass` to each concrete monomorphization (MD4/MD5/SHA1/…) once the macro grows
// generic/alias support.
// The per-monomorphization `JsClass` impl + extern shims live in
// `build/*/codegen/generated_classes.rs` (one block per `pub type` alias below);
// `#[repr(C)]` here only silences the `improper_ctypes` lint on those externs.
// R-2 (`sharedThis`): every JS-facing host-fn takes `&StaticCryptoHasher<H>`.
// `hashing` is mutated by `update`/`final_` → `JsCell<H>`; `digested` is a
// Copy flag → `Cell<bool>`.
#[repr(C)]
pub struct StaticCryptoHasher<H: StaticHasher> {
    pub hashing: JsCell<H>,
    pub digested: Cell<bool>,
}

impl<H: StaticHasher> Default for StaticCryptoHasher<H> {
    fn default() -> Self {
        Self {
            hashing: JsCell::new(H::init()),
            digested: Cell::new(false),
        }
    }
}

impl<H: StaticHasher> StaticCryptoHasher<H> {
    /// `pub const digest = host_fn.wrapInstanceMethod(ThisHasher, "digest_", false);`
    ///
    /// Hand-expanded `wrapInstanceMethod` decode for the parameter list
    /// `(*ThisHasher, *JSGlobalObject, ?Node.StringOrBuffer)`.
    pub fn digest(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        // ?Node.StringOrBuffer (instance-method arm: empty/undefined/null → None)
        let output: Option<StringOrBuffer> = if arguments.len > 0 {
            let arg = arguments.ptr[0];
            if !arg.is_empty_or_undefined_or_null() {
                match StringOrBuffer::from_js(global, arg)? {
                    Some(v) => Some(v),
                    None => {
                        return Err(global
                            .throw_invalid_arguments(format_args!("expected string or buffer")));
                    }
                }
            } else {
                None
            }
        } else {
            None
        };
        Self::digest_(this, global, output)
    }

    /// `pub const hash = host_fn.wrapStaticMethod(ThisHasher, "hash_", false);`
    ///
    /// Hand-expanded `wrapStaticMethod` decode for the parameter list
    /// `(*JSGlobalObject, Node.BlobOrStringOrBuffer, ?Node.StringOrBuffer)`.
    pub fn hash(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        let mut i = 0usize;
        let mut next_eat = || {
            if i < arguments.len {
                let v = arguments.ptr[i];
                i += 1;
                Some(v)
            } else {
                None
            }
        };

        // Node.BlobOrStringOrBuffer
        let input = {
            let Some(arg) = next_eat() else {
                return Err(
                    global.throw_invalid_arguments(format_args!("expected blob, string or buffer"))
                );
            };
            match BlobOrStringOrBuffer::from_js(global, arg)? {
                Some(b) => b,
                None => {
                    return Err(global
                        .throw_invalid_arguments(format_args!("expected blob, string or buffer")));
                }
            }
        };

        // ?Node.StringOrBuffer (static-method arm: only `undefined` → None)
        let output: Option<StringOrBuffer> = match next_eat() {
            Some(arg) => match StringOrBuffer::from_js(global, arg)? {
                Some(v) => Some(v),
                None => {
                    if arg.is_undefined() {
                        None
                    } else {
                        return Err(global
                            .throw_invalid_arguments(format_args!("expected string or buffer")));
                    }
                }
            },
            None => None,
        };

        Self::hash_(global, input, output)
    }

    pub fn get_byte_length(_this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(H::DIGEST as f64)
    }

    pub fn get_byte_length_static(_: &JSGlobalObject, _: JSValue, _: PropertyName) -> JSValue {
        JSValue::js_number(H::DIGEST as f64)
    }

    fn hash_to_encoding(
        global: &JSGlobalObject,
        input: &BlobOrStringOrBuffer,
        encoding: Encoding,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::new_digest();

        if is_bun_file_blob(input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        if H::HAS_ENGINE {
            H::hash(input.slice(), &mut output_digest_buf, boring_engine(global));
        } else {
            H::hash(input.slice(), &mut output_digest_buf, core::ptr::null_mut());
        }

        encoding.encode_with_max_size(global, EVP_MAX_MD_SIZE_USIZE, output_digest_buf.as_ref())
    }

    fn hash_to_bytes(
        global: &JSGlobalObject,
        input: &BlobOrStringOrBuffer,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::new_digest();
        // PORT NOTE: reshaped for borrowck — Zig used `*Hasher.Digest` rebound into output buffer.
        let output_digest_slice: &mut H::Digest;
        if let Some(output_buf) = &output {
            let bytes_len = output_buf.byte_slice().len();
            if bytes_len < H::DIGEST {
                // Zig `comptimePrint` → runtime `format_args!`; observable string is identical.
                return Err(global.throw_invalid_arguments(format_args!(
                    "TypedArray must be at least {} bytes",
                    H::DIGEST
                )));
            }
            // SAFETY: `bytes_len >= H::DIGEST` checked above; `H::Digest = [u8; H::DIGEST]`;
            // `output_buf.ptr` is the JSC-owned writable backing store. Build the
            // `&mut` directly from the raw `*mut u8` field — never via
            // `&[u8].as_ptr()` (Stacked-Borrows UB).
            output_digest_slice = unsafe { &mut *output_buf.ptr.cast::<H::Digest>() };
        } else {
            output_digest_slice = &mut output_digest_buf;
        }

        if H::HAS_ENGINE {
            H::hash(input.slice(), output_digest_slice, boring_engine(global));
        } else {
            H::hash(input.slice(), output_digest_slice, core::ptr::null_mut());
        }

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            ArrayBuffer::create_uint8_array(global, output_digest_slice.as_ref())
        }
    }

    pub fn hash_(
        global: &JSGlobalObject,
        input: BlobOrStringOrBuffer,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        // `defer input.deinit()` — handled by Drop.

        if is_bun_file_blob(&input) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }

        if let Some(string_or_buffer) = output {
            if let StringOrBuffer::Buffer(buffer) = &string_or_buffer {
                let ab = buffer.buffer;
                return Self::hash_to_bytes(global, &input, Some(ab));
            }
            let Some(encoding) = Encoding::from(string_or_buffer.slice()) else {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Unknown encoding: {}",
                            bstr::BStr::new(string_or_buffer.slice())
                        ),
                    )
                    .throw());
            };

            Self::hash_to_encoding(global, &input, encoding)
        } else {
            Self::hash_to_bytes(global, &input, None)
        }
    }

    // PORT NOTE: `#[bun_jsc::host_fn]` (Free) emits a bare `fn_name(g, f)` call,
    // which cannot resolve to an associated fn inside an `impl` block. The
    // constructor shim is wired by per-monomorphization `#[bun_jsc::JsClass]` codegen.
    pub fn constructor(_: &JSGlobalObject, _: &CallFrame) -> JsResult<Box<Self>> {
        Ok(Box::new(Self {
            hashing: JsCell::new(H::init()),
            digested: Cell::new(false),
        }))
    }

    pub fn getter(global: &JSGlobalObject, _: &JSObject) -> JSValue {
        H::get_constructor(global)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.digested.get() {
            return Err(global
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!(
                        "{} hasher already digested, create a new instance to update",
                        H::NAME
                    ),
                )
                .throw());
        }
        let this_value = callframe.this();
        let input = callframe.argument(0);
        let buffer = match BlobOrStringOrBuffer::from_js(global, input)? {
            Some(b) => b,
            None => {
                return Err(global
                    .throw_invalid_arguments(format_args!("expected blob or string or buffer")));
            }
        };
        // `defer buffer.deinit()` — handled by Drop.

        if is_bun_file_blob(&buffer) {
            return Err(global.throw(format_args!(
                "Bun.file() is not supported here yet (it needs an async version)"
            )));
        }
        this.hashing.with_mut(|h| h.update(buffer.slice()));
        Ok(this_value)
    }

    pub fn digest_(
        this: &Self,
        global: &JSGlobalObject,
        output: Option<StringOrBuffer>,
    ) -> JsResult<JSValue> {
        if this.digested.get() {
            return Err(global
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!(
                        "{} hasher already digested, create a new instance to digest again",
                        H::NAME
                    ),
                )
                .throw());
        }
        if let Some(string_or_buffer) = output {
            if let StringOrBuffer::Buffer(buffer) = &string_or_buffer {
                let ab = buffer.buffer;
                return this.digest_to_bytes(global, Some(ab));
            }
            let Some(encoding) = Encoding::from(string_or_buffer.slice()) else {
                return Err(global
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "Unknown encoding: {}",
                            bstr::BStr::new(string_or_buffer.slice())
                        ),
                    )
                    .throw());
            };

            this.digest_to_encoding(global, encoding)
        } else {
            this.digest_to_bytes(global, None)
        }
    }

    fn digest_to_bytes(
        &self,
        global: &JSGlobalObject,
        output: Option<ArrayBuffer>,
    ) -> JsResult<JSValue> {
        let mut output_digest_buf: H::Digest = H::new_digest();
        let output_digest_slice: &mut H::Digest;
        if let Some(output_buf) = &output {
            let bytes_len = output_buf.byte_slice().len();
            if bytes_len < H::DIGEST {
                return Err(global.throw_invalid_arguments(format_args!(
                    "TypedArray must be at least {} bytes",
                    H::DIGEST
                )));
            }
            // SAFETY: `bytes_len >= H::DIGEST`; `H::Digest = [u8; H::DIGEST]`;
            // `output_buf.ptr` is the JSC-owned writable backing store. Build the
            // `&mut` directly from the raw `*mut u8` field — never via
            // `&[u8].as_ptr()` (Stacked-Borrows UB).
            output_digest_slice = unsafe { &mut *output_buf.ptr.cast::<H::Digest>() };
        } else {
            // Zig: `output_digest_buf = std.mem.zeroes(Hasher.Digest);` — Default already zeroes.
            output_digest_slice = &mut output_digest_buf;
        }

        self.hashing.with_mut(|h| h.final_(output_digest_slice));
        self.digested.set(true);

        if let Some(output_buf) = output {
            Ok(output_buf.value)
        } else {
            ArrayBuffer::create_uint8_array(global, output_digest_buf.as_ref())
        }
    }

    fn digest_to_encoding(&self, global: &JSGlobalObject, encoding: Encoding) -> JsResult<JSValue> {
        // Zig comptime zero-init loop → new_digest (zeroed [u8; N]).
        let mut output_digest_buf: H::Digest = H::new_digest();

        let output_digest_slice: &mut H::Digest = &mut output_digest_buf;

        self.hashing.with_mut(|h| h.final_(output_digest_slice));
        self.digested.set(true);

        encoding.encode_with_max_size(global, EVP_MAX_MD_SIZE_USIZE, output_digest_slice.as_ref())
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

// ported from: src/runtime/crypto/CryptoHasher.zig
