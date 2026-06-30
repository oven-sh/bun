use bun_core::String;

use crate::{JSGlobalObject, JSPromise, JSValue};

/// Canonical definition lives in tier-1 `bun_sys`; JSC-side conversions are
/// provided by [`SystemErrorJsc`] below.
pub use bun_sys::SystemError;

/// `core::result::Result` alias in Phase F so callers get `?` for free.
pub type Maybe<R> = core::result::Result<R, SystemError>;

// SAFETY (safe fn): `SystemError` is `#[repr(C)]` and read-only on the C++ side;
// `JSGlobalObject` is an opaque `UnsafeCell`-backed handle, so `&JSGlobalObject`
// is ABI-identical to a non-null `JSGlobalObject*` with write provenance.
unsafe extern "C" {
    safe fn SystemError__toErrorInstance(this: &SystemError, global: &JSGlobalObject) -> JSValue;
    safe fn SystemError__toErrorInstanceWithInfoObject(
        this: &SystemError,
        global: &JSGlobalObject,
    ) -> JSValue;
}

/// JSC-side conversions on `bun_sys::SystemError`.
pub trait SystemErrorJsc {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue;
    fn to_error_instance_with_info_object(&self, global: &JSGlobalObject) -> JSValue;
}

impl SystemErrorJsc for SystemError {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        let result = SystemError__toErrorInstance(self, global);
        self.deref();
        result
    }

    /// Like `to_error_instance` but populates the error's stack trace with async
    /// frames from the given promise's await chain. Use when creating an error
    /// from native code at the top of the event loop (threadpool callback) to
    /// reject a promise — otherwise the error will have an empty stack.
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        let value = self.to_error_instance(global);
        value.attach_async_stack_from_promise(global, promise);
        value
    }

    /// This constructs the ERR_SYSTEM_ERROR error object, which has an `info`
    /// property containing the details of the system error:
    ///
    /// SystemError [ERR_SYSTEM_ERROR]: A system error occurred: {syscall} returned {errno} ({message})
    /// {
    ///     name: "ERR_SYSTEM_ERROR",
    ///     info: {
    ///         errno: -{errno},
    ///         code: {code},        // string
    ///         message: {message},  // string
    ///         syscall: {syscall},  // string
    ///     },
    ///     errno: -{errno},
    ///     syscall: {syscall},
    /// }
    ///
    /// Before using this function, consider if the Node.js API it is
    /// implementing follows this convention. It is exclusively used
    /// to match the error code that `node:os` throws.
    fn to_error_instance_with_info_object(&self, global: &JSGlobalObject) -> JSValue {
        let result = SystemError__toErrorInstanceWithInfoObject(self, global);
        self.deref();
        result
    }
}

/// `uws.us_bun_verify_error_t.toJS` — wrap a uSockets handshake-verify error
/// (`{code,reason}` C strings) as a JS `SystemError`.
///
/// LAYERING: lives here (not `bun_runtime::socket::uws_jsc`) so both
/// `bun_runtime::socket` and `bun_runtime::sql_jsc` import the single
/// canonical body — `bun_runtime` already depends on `bun_jsc` + `bun_uws`,
/// and the body touches nothing higher-tier.
pub fn verify_error_to_js(
    err: &bun_uws::us_bun_verify_error_t,
    global: &JSGlobalObject,
) -> crate::JsResult<JSValue> {
    let code: &[u8] = err.code_bytes();
    let reason: &[u8] = err.reason_bytes();

    let fallback = SystemError {
        code: String::clone_utf8(code),
        message: String::clone_utf8(reason),
        ..Default::default()
    };

    Ok(fallback.to_error_instance(global))
}

/// Node's `ERR_LIB_*` → macro-prefix map from `crypto_util.cc`
/// (`OSSL_ERROR_CODES_MAP`). Libraries Node does not map get an empty prefix
/// and compose to `ERR_OSSL_<REASON>`.
fn lib_short_name(lib: u32) -> &'static str {
    // The numeric values are BoringSSL's `ERR_LIB_*` enum (err.h).
    match lib {
        2 => "SYS_",
        3 => "BN_",
        4 => "RSA_",
        5 => "DH_",
        6 => "EVP_",
        7 => "BUF_",
        8 => "OBJ_",
        9 => "PEM_",
        10 => "DSA_",
        11 => "X509_",
        12 => "ASN1_",
        13 => "CONF_",
        14 => "CRYPTO_",
        15 => "EC_",
        16 => "SSL_",
        17 => "BIO_",
        18 => "PKCS7_",
        20 => "X509V3_",
        21 => "RAND_",
        22 => "ENGINE_",
        23 => "OCSP_",
        24 => "UI_",
        25 => "COMP_",
        26 => "ECDSA_",
        27 => "ECDH_",
        28 => "HMAC_",
        33 => "USER_",
        _ => "",
    }
}

/// SAFETY: `ptr` is a NUL-terminated static string returned by BoringSSL's
/// error-string tables (or null).
fn static_cstr<'a>(ptr: *const core::ffi::c_char) -> Option<&'a [u8]> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: see above - the pointer is a 'static NUL-terminated table entry.
    let bytes = unsafe { core::ffi::CStr::from_ptr(ptr) }.to_bytes();
    if bytes.is_empty() { None } else { Some(bytes) }
}

/// `BoringSSL.ERR_toJS` — formats a packed BoringSSL error code into a JS Error
/// with code BORINGSSL. LAYERING: lives here so bun_runtime::crypto and
/// bun_runtime::sql_jsc share the single canonical body.
pub fn boringssl_err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
    use crate::{StringJsc as _, ZigStringJsc as _};
    use bun_boringssl::c as boring;
    use bun_core::ZigString;

    // The message is the raw ERR_error_string output
    // ("error:0b000074:X.509 certificate routines:OPENSSL_internal:..."),
    // exactly what Node built against BoringSSL produces - no prefix.
    let mut outbuf = [0u8; 128 + 1];
    let message_buf = &mut outbuf[..];

    // SAFETY: message_buf is a valid writable buffer of message_buf.len() bytes.
    unsafe {
        boring::ERR_error_string_n(
            err_code,
            message_buf.as_mut_ptr().cast::<core::ffi::c_char>(),
            message_buf.len(),
        );
    }

    let error_message: &[u8] = bun_core::slice_to_nul(&outbuf[..]);
    if error_message.is_empty() {
        return global
            .err(
                crate::ErrorCode::BORINGSSL,
                format_args!("An unknown BoringSSL error occurred: {}", err_code),
            )
            .to_js();
    }

    // A plain Error carrying Node's library/function/reason/code decomposition
    // of the OpenSSL error, the way ThrowCryptoError builds it: the code is
    // ERR_OSSL_<LIB>_<REASON> (or ERR_SSL_<REASON> for the SSL library).
    // The message must own its bytes - `outbuf` is a stack buffer and the
    // error instance outlives this frame.
    let err = String::clone_utf8(error_message).to_error_instance(global);

    if let Some(library) = static_cstr(boring::ERR_lib_error_string(err_code)) {
        err.put(global, b"library", ZigString::init(library).to_js(global));
    }
    if let Some(function) = static_cstr(boring::ERR_func_error_string(err_code)) {
        err.put(global, b"function", ZigString::init(function).to_js(global));
    }
    if let Some(reason) = static_cstr(boring::ERR_reason_error_string(err_code)) {
        err.put(global, b"reason", ZigString::init(reason).to_js(global));

        let lib = lib_short_name((err_code >> 24) & 0xff);
        // Don't generate codes like "ERR_OSSL_SSL_".
        let prefix = if lib == "SSL_" { "" } else { "OSSL_" };
        let mut code = Vec::with_capacity(4 + prefix.len() + lib.len() + reason.len());
        code.extend_from_slice(b"ERR_");
        code.extend_from_slice(prefix.as_bytes());
        code.extend_from_slice(lib.as_bytes());
        code.extend_from_slice(reason);
        err.put(global, b"code", ZigString::init(&code).to_js(global));
    }

    err
}

/// `uws.create_bun_socket_error_t.toJS`. Same layering note as verify_error_to_js.
pub fn create_bun_socket_error_to_js(
    err: bun_uws::create_bun_socket_error_t,
    global: &JSGlobalObject,
) -> JSValue {
    use bun_uws::create_bun_socket_error_t as E;
    match err {
        // us_ssl_ctx_from_options only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with .none and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `createSSLContext(...) orelse return err.toJS()` site correct.
        E::none => boringssl_err_to_js(global, bun_boringssl::c::ERR_get_error()),
        E::load_ca_file => global
            .err(
                crate::ErrorCode::BORINGSSL,
                format_args!("Failed to load CA file"),
            )
            .to_js(),
        E::invalid_ca_file => global
            .err(crate::ErrorCode::BORINGSSL, format_args!("Invalid CA file"))
            .to_js(),
        E::invalid_ca => global
            .err(crate::ErrorCode::BORINGSSL, format_args!("Invalid CA"))
            .to_js(),
        E::invalid_ciphers => global
            .err(crate::ErrorCode::BORINGSSL, format_args!("Invalid ciphers"))
            .to_js(),
    }
}
