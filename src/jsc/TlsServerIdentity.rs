//! `tls.checkServerIdentity` and the built-in hostname check for JS-thread TLS clients (`Bun.SQL`, `RedisClient`).

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

/// Node's default check of `hostname` against the peer certificate; `ERR_TLS_CERT_ALTNAME_INVALID` on mismatch.
pub fn check_builtin(
    global: &JSGlobalObject,
    ssl: &mut boringssl::c::SSL,
    hostname: &[u8],
) -> Result<(), JSValue> {
    if boringssl::check_server_identity(ssl, hostname) {
        return Ok(());
    }
    let mut reason = String::new();
    // Infallible: the writer is a `String`.
    let _ = boringssl::write_server_identity_mismatch_reason(ssl, hostname, &mut reason);
    Err(altname_invalid(global, &reason))
}

/// Runs the user's `tls.checkServerIdentity(hostname, cert)`; fails with the `Error` it returns or anything it throws.
pub fn check_with_callback(
    global: &JSGlobalObject,
    callback: JSValue,
    ssl: &mut boringssl::c::SSL,
    hostname: &[u8],
) -> Result<(), JSValue> {
    let Some(cert) = ssl.peer_leaf_certificate() else {
        return Err(altname_invalid(global, "the peer presented no certificate"));
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

fn altname_invalid(global: &JSGlobalObject, reason: &str) -> JSValue {
    global
        .err(
            ErrorCode::TLS_CERT_ALTNAME_INVALID,
            format_args!("Hostname/IP does not match certificate's altnames: {reason}"),
        )
        .to_js()
}
