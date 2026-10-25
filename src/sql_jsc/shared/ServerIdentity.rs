//! `tls.checkServerIdentity(hostname, cert)` for the SQL drivers.

use crate::jsc::{
    EventLoopSqlExt as _, JSGlobalObject, JSValue, JsResult, VirtualMachine, bun_string_jsc,
};
use bun_jsc::ErrorCode;
use bun_uws::{AnySocket, PeerCertificateChain};

pub(crate) fn callback_of(global: &JSGlobalObject, tls: JSValue) -> JsResult<Option<JSValue>> {
    if !tls.is_object() {
        return Ok(None);
    }
    Ok(tls
        .get(global, "checkServerIdentity")?
        .filter(|callback| callback.is_callable()))
}

/// `Err` is what the connection fails with. Runs user code, which can close the connection.
pub(crate) fn check(
    global: &JSGlobalObject,
    callback: JSValue,
    socket: &AnySocket,
    hostname: &[u8],
) -> Result<(), JSValue> {
    let _entered = VirtualMachine::get().as_mut().event_loop_mut().entered();
    match verdict(global, callback, socket, hostname) {
        Ok(None) => Ok(()),
        Ok(Some(reason)) => Err(reason),
        Err(thrown) => Err(global.take_exception(thrown)),
    }
}

/// `None` approves.
fn verdict(
    global: &JSGlobalObject,
    callback: JSValue,
    socket: &AnySocket,
    hostname: &[u8],
) -> JsResult<Option<JSValue>> {
    let AnySocket::SocketTls(tls) = socket else {
        return Ok(Some(no_verdict(global)));
    };
    let Some(mut chain) = tls.ssl_mut().and_then(PeerCertificateChain::collect) else {
        return Ok(Some(no_verdict(global)));
    };
    let cert = bun_jsc::tls_server_identity::chain_to_js(&mut chain, global)?;
    drop(chain);
    let hostname = bun_string_jsc::create_utf8_for_js(global, hostname)?;
    let result = callback.call(global, JSValue::UNDEFINED, &[hostname, cert])?;
    if callback.call_may_have_been_dropped(global) {
        return Ok(Some(no_verdict(global)));
    }
    // Any object counts: a DOMException or a util.inherits() error is not an ErrorInstance cell.
    if result.is_object() && result.as_any_promise().is_none() {
        return Ok(Some(result));
    }
    // As in Node, every other truthy value refuses too, the Promise of an async callback included.
    if result.to_boolean() {
        let received = JSGlobalObject::determine_specific_type(global, result)?;
        return Ok(Some(ErrorCode::INVALID_RETURN_VALUE.fmt(
            global,
            format_args!(
                "Expected undefined or an Error to be returned from the \"tls.checkServerIdentity\" function but got {received}."
            ),
        )));
    }
    Ok(None)
}

fn no_verdict(global: &JSGlobalObject) -> JSValue {
    ErrorCode::ERR_TLS_CERT_ALTNAME_INVALID.fmt(
        global,
        format_args!("tls.checkServerIdentity could not be asked about the server's certificate"),
    )
}
