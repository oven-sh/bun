//! JSC bridge for BoringSSL error formatting. Keeps `src/boringssl/` free of JSC types.

use bun_boringssl_sys as boring;
use bun_core::{String as BunString, ZigString};
use bun_jsc::{JSGlobalObject, JSValue, StringJsc as _, ZigStringJsc as _};

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

pub fn err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
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
                bun_jsc::ErrorCode::BORINGSSL,
                format_args!("An unknown BoringSSL error occurred: {}", err_code),
            )
            .to_js();
    }

    // A plain Error carrying Node's library/function/reason/code decomposition
    // of the OpenSSL error, the way ThrowCryptoError builds it: the code is
    // ERR_OSSL_<LIB>_<REASON> (or ERR_SSL_<REASON> for the SSL library).
    // The message must own its bytes - `outbuf` is a stack buffer and the
    // error instance outlives this frame.
    let err = BunString::clone_utf8(error_message).to_error_instance(global);

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
