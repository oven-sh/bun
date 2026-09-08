//! Server-identity verification for TLS clients whose handshake callback runs
//! on the JS thread (`Bun.SQL`, `RedisClient`). Either Node's built-in
//! hostname match, or the user's `tls.checkServerIdentity(hostname, cert)`.
//!
//! `Err` carries the value the caller fails the connection with.

use bun_boringssl as boringssl;

use crate::{ErrorCode, JSGlobalObject, JSValue, JsResult};

// Implemented in JSX509Certificate.cpp. `X509`/`JSGlobalObject` are opaque
// `repr(C)` handles; `&mut`/`&` are ABI-identical to non-null pointers.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut boringssl::c::X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

/// The legacy certificate object of `tls.getPeerCertificate()` (`subject`,
/// `subjectaltname`, `fingerprint256`, `raw`, ...). Borrows `cert`.
pub fn x509_to_legacy_object(
    cert: &mut boringssl::c::X509,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    crate::from_js_host_call(global, || Bun__X509__toJSLegacyEncoding(cert, global))
}

/// Node's built-in check: `hostname` must match a name in the peer's leaf
/// certificate. Fails with `ERR_TLS_CERT_ALTNAME_INVALID` and Node's reason
/// text.
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

/// Calls the user's `tls.checkServerIdentity(hostname, cert)` in place of the
/// built-in check, as Node and `fetch` do. Fails with the `Error` it returns,
/// or with whatever it throws.
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
