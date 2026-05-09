use bun_boringssl_sys::X509;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub use bun_boringssl::x509::is_safe_alt_name;

pub fn to_js(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global_object, || unsafe {
        Bun__X509__toJSLegacyEncoding(std::ptr::from_mut::<X509>(cert), global_object)
    })
}

pub fn to_js_object(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: cert is a valid X509* owned by the caller; global_object is a live JSC global
    Ok(unsafe { Bun__X509__toJS(std::ptr::from_mut::<X509>(cert), global_object) })
}

// TODO(port): move to runtime_sys (or bun_boringssl_sys)
unsafe extern "C" {
    fn Bun__X509__toJSLegacyEncoding(cert: *mut X509, global_object: *const JSGlobalObject) -> JSValue;
    fn Bun__X509__toJS(cert: *mut X509, global_object: *const JSGlobalObject) -> JSValue;
}

// ported from: src/runtime/api/bun/x509.zig
