use bun_boringssl_sys::{OwnedX509, X509};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub(crate) fn to_js(cert: &X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global_object, || {
        Bun__X509__toJSLegacyEncoding(cert, global_object)
    })
}

pub(crate) fn to_js_object(cert: OwnedX509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    Ok(Bun__X509__toJS(cert, global_object))
}

unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(cert: &X509, global_object: &JSGlobalObject) -> JSValue;
    safe fn Bun__X509__toJS(cert: OwnedX509, global_object: &JSGlobalObject) -> JSValue;
}
