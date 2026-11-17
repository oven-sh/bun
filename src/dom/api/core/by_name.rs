//! Calls to what the host of a page has handed over. Nothing is looked up in `Object.prototype`, which scripts can change.

use bun_jsc::bindgen::{self, JsScope};
use bun_jsc::{JSGlobalObject, JSValue};

unsafe extern "C" {
    fn Bun__DOM__memberOf(
        global: &JSGlobalObject,
        object: JSValue,
        name: *const u8,
        name_length: usize,
    ) -> JSValue;
    safe fn Bun__DOM__globalOf(cell: JSValue) -> *const JSGlobalObject;
}

pub(crate) fn member(global: &JSGlobalObject, object: JSValue, name: &str) -> Option<JSValue> {
    // SAFETY: the pointer and the length are of a slice.
    Some(unsafe { Bun__DOM__memberOf(global, object, name.as_ptr(), name.len()) })
        .filter(|it| !it.is_empty_or_undefined_or_null())
}

/// `null` if there is no such method.
pub(crate) fn call_with<'a>(
    global: &JSGlobalObject,
    object: JSValue,
    name: &str,
    arguments: &[JSValue],
) -> bindgen::Result<'a, JSValue> {
    Ok(member(global, object, name)
        .filter(|it| it.is_callable())
        .map_or(Ok(JSValue::NULL), |it| it.call(global, object, arguments))?)
}

/// It does not throw.
pub(crate) fn call_directly(
    cx: &mut JsScope<'_>,
    object: JSValue,
    name: &str,
    arguments: &[JSValue],
) -> JSValue {
    if cx.global().has_exception() {
        return JSValue::NULL;
    }
    // SAFETY: the structure of `object` holds it.
    call_with(
        unsafe { &*Bun__DOM__globalOf(object) },
        object,
        name,
        arguments,
    )
    .unwrap_or_else(|_| {
        cx.global().clear_exception_except_termination();
        JSValue::NULL
    })
}
