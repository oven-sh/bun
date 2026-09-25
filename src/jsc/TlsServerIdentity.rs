//! `tls.checkServerIdentity` for TLS clients whose handshake events run on the JS thread (`Bun.SQL`, `RedisClient`).

use bun_boringssl as boringssl;

use crate::{ErrorCode, JSGlobalObject, JSValue, JsResult};

// JSX509Certificate.cpp. Opaque `repr(C)` handles: `&mut`/`&` are ABI-identical to non-null pointers.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut boringssl::c::X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

/// The `tls.getPeerCertificate()`-style object for `cert` (borrowed, not adopted).
pub fn x509_to_legacy_object(
    cert: &mut boringssl::c::X509,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    crate::from_js_host_call(global, || Bun__X509__toJSLegacyEncoding(cert, global))
}

/// Runs `callback(hostname, cert)` on the peer's leaf certificate. `Err`: the `Error` it returns, or what it throws.
pub fn check_with_callback(
    global: &JSGlobalObject,
    callback: JSValue,
    ssl: Option<&mut boringssl::c::SSL>,
    hostname: &[u8],
) -> Result<(), JSValue> {
    let Some(cert) = ssl.and_then(|ssl| ssl.peer_leaf_certificate()) else {
        return Err(global
            .err(
                ErrorCode::TLS_CERT_ALTNAME_INVALID,
                format_args!("The server did not present a certificate"),
            )
            .to_js());
    };
    let js_cert = x509_to_legacy_object(cert, global).map_err(|e| global.take_exception(e))?;
    let js_hostname = crate::bun_string_jsc::create_utf8_for_js(global, hostname)
        .map_err(|e| global.take_exception(e))?;
    let result = {
        let _scope = global.bun_vm().enter_event_loop_scope();
        callback.call(global, JSValue::UNDEFINED, &[js_hostname, js_cert])
    };
    let result = result.map_err(|e| global.take_exception(e))?;
    // > Returns <Error> object [...] on failure. On success, returns <undefined>.
    if result.is_any_error() {
        return Err(result);
    }
    Ok(())
}
