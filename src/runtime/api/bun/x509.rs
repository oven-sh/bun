use bun_boringssl_sys::X509;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub use bun_jsc::tls_server_identity::x509_to_legacy_object as to_js;

pub(crate) fn to_js_object(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    Ok(Bun__X509__toJS(cert, global_object))
}

// `X509`/`JSGlobalObject` are opaque `repr(C)` handles; `&mut`/`&` are
// ABI-identical to non-null pointers, so the validity proof is in the type.
unsafe extern "C" {
    safe fn Bun__X509__toJS(cert: &mut X509, global_object: &JSGlobalObject) -> JSValue;
}
