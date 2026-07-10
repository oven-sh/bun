use bun_boringssl_sys::{X509, sys};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub use bun_boringssl::x509::is_safe_alt_name;

/// Borrows `cert`: C++ wraps the pointer in a non-owning `ncrypto::X509View`
/// (`Bun__X509__toJSLegacyEncoding`), so the caller keeps its reference.
pub fn to_js(cert: &mut sys::X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(global_object, || {
        Bun__X509__toJSLegacyEncoding(cert, global_object)
    })
}

/// Consumes `cert`: C++ moves the pointer into an owning `ncrypto::X509Pointer`
/// (`Bun__X509__toJS`), so the handle's ref is leaked here rather than released.
pub(crate) fn to_js_object(cert: X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    let cert = sys::X509::opaque_mut(cert.leak().as_ptr());
    Ok(Bun__X509__toJS(cert, global_object))
}

// `sys::X509`/`JSGlobalObject` are opaque `repr(C)` handles; `&mut`/`&` are
// ABI-identical to non-null pointers, so the validity proof is in the type.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut sys::X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
    safe fn Bun__X509__toJS(cert: &mut sys::X509, global_object: &JSGlobalObject) -> JSValue;
}
