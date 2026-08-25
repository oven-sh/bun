//! JSC bridge for BoringSSL error formatting. Keeps `src/boringssl/` free of JSC types.

use bun_boringssl_sys as boring;
use bun_core::EncodedSlice;
use bun_jsc::{EncodedSliceJsc as _, JSGlobalObject, JSValue};

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

fn non_empty(s: Option<&core::ffi::CStr>) -> Option<&[u8]> {
    s.map(core::ffi::CStr::to_bytes).filter(|b| !b.is_empty())
}

pub(crate) fn err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
    // The message is the raw ERR_error_string output
    // ("error:0b000074:X.509 certificate routines:OPENSSL_internal:..."),
    // exactly what Node built against BoringSSL produces - no prefix.
    let mut outbuf = [0u8; 128 + 1];
    let error_message: &[u8] = boring::err_error_string_n(err_code, &mut outbuf);
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
    let err = EncodedSlice::utf8(error_message).to_error_instance(global);

    if let Some(library) = non_empty(boring::err_lib_error_string(err_code)) {
        err.put(global, b"library", EncodedSlice::latin1(library).to_js(global));
    }
    if let Some(function) = non_empty(boring::err_func_error_string(err_code)) {
        err.put(global, b"function", EncodedSlice::latin1(function).to_js(global));
    }
    let reason = boring::err_reason_error_string(err_code);
    if let Some(reason) = non_empty(reason.as_deref()) {
        err.put(global, b"reason", EncodedSlice::latin1(reason).to_js(global));

        let lib = lib_short_name(boring::err_get_lib(err_code));
        // Don't generate codes like "ERR_OSSL_SSL_".
        let prefix = if lib == "SSL_" { "" } else { "OSSL_" };
        let mut code = Vec::with_capacity(4 + prefix.len() + lib.len() + reason.len());
        code.extend_from_slice(b"ERR_");
        code.extend_from_slice(prefix.as_bytes());
        code.extend_from_slice(lib.as_bytes());
        code.extend_from_slice(reason);
        err.put(global, b"code", EncodedSlice::latin1(&code).to_js(global));
    }

    err
}
