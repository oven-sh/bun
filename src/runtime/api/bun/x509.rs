use bun_boringssl_sys::{OwnedX509, X509};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

/// The legacy-encoding object for `cert`; borrows it.
pub fn to_js(cert: &X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global_object, || {
        Bun__X509__toJSLegacyEncoding(cert, global_object)
    })
}

/// A JS `X509Certificate` that adopts `cert`'s reference.
pub(crate) fn to_js_object(cert: OwnedX509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    Ok(Bun__X509__toJS(
        X509::opaque_ref(cert.into_raw()),
        global_object,
    ))
}

// `X509`/`JSGlobalObject` are opaque `repr(C)` handles; `&` is ABI-identical
// to a non-null pointer, so the validity proof is in the type.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(cert: &X509, global_object: &JSGlobalObject) -> JSValue;
    safe fn Bun__X509__toJS(cert: &X509, global_object: &JSGlobalObject) -> JSValue;
}
