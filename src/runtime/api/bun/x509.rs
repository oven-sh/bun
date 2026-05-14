use bun_boringssl_sys::X509;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub use bun_boringssl::x509::is_safe_alt_name;

pub fn to_js(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global_object, || {
        Bun__X509__toJSLegacyEncoding(cert, global_object)
    })
}

pub fn to_js_object(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    Ok(Bun__X509__toJS(cert, global_object))
}

// TODO(port): move to runtime_sys (or bun_boringssl_sys)
// `X509`/`JSGlobalObject` are opaque `repr(C)` handles; `&mut`/`&` are
// ABI-identical to non-null pointers, so the validity proof is in the type.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
    safe fn Bun__X509__toJS(cert: &mut X509, global_object: &JSGlobalObject) -> JSValue;
}

// ported from: src/runtime/api/bun/x509.zig
