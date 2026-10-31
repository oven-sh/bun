//! The certificate object handed to `tls.checkServerIdentity(hostname, cert)`
//! and returned by `getPeerCertificate(true)`.

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_boringssl::c::X509;
use bun_uws::PeerCertificateChain;

unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(cert: &mut X509, global: &JSGlobalObject) -> JSValue;
}

/// The legacy (`node:tls`) object for one certificate.
pub fn certificate_to_js(cert: &mut X509, global: &JSGlobalObject) -> JsResult<JSValue> {
    crate::from_js_host_call(global, || Bun__X509__toJSLegacyEncoding(cert, global))
}

/// The leaf's legacy object, with every certificate linked to the next through
/// `issuerCertificate`, the way Node's `getPeerCertificate(true)` returns it. A
/// self-issued last certificate links to itself.
pub fn chain_to_js(chain: &mut PeerCertificateChain, global: &JSGlobalObject) -> JsResult<JSValue> {
    let mut certs = chain.certs();
    let Some(leaf) = certs.next() else {
        return Ok(JSValue::UNDEFINED);
    };
    let leaf = certificate_to_js(leaf, global)?;
    // Link each certificate to its predecessor as soon as it exists, so every
    // object in the chain is reachable from the stack-rooted `leaf` before the
    // next allocation can start a GC.
    let mut prev = leaf;
    for cert in certs {
        let obj = certificate_to_js(cert, global)?;
        prev.put(global, b"issuerCertificate", obj);
        prev = obj;
    }
    if chain.self_issued_terminal() {
        prev.put(global, b"issuerCertificate", prev);
    }
    leaf.ensure_still_alive();
    Ok(leaf)
}
