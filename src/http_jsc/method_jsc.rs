//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_core::String as BunString;
use bun_http_types::Method::{Classified, Method, OwnedMethod};
use bun_jsc::{BuiltinName, ErrorCode, JSGlobalObject, JSValue, JsResult, StringJsc as _};

unsafe extern "C" {
    // SAFETY (safe fn): `Method` is a `#[repr(uN)]` scalar; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed handle, so `&JSGlobalObject` is ABI-identical to a
    // non-null `JSGlobalObject*` and C++ mutating VM/heap state through it is
    // interior mutation invisible to Rust.
    safe fn Bun__HTTPMethod__toJS(method: Method, global_object: &JSGlobalObject) -> JSValue;
}

/// Converts a JS string
/// value to UTF-8 and looks it up in the static method table.
///
/// Lives here (not in `bun_http_types`) so the base crate stays JSC-free.
pub fn from_js(global_this: &JSGlobalObject, input: JSValue) -> JsResult<Option<Method>> {
    let mut miss = BunString::EMPTY;
    which(global_this, input, &mut miss)
}

/// [`from_js`] that leaves the string of a miss in `miss`, for the caller to read further.
#[inline(never)] // one copy of the table lookup in the binary for every caller
fn which(
    global: &JSGlobalObject,
    input: JSValue,
    miss: &mut BunString,
) -> JsResult<Option<Method>> {
    let str = BunString::from_js(input, global)?;
    debug_assert!(str.tag() != bun_core::Tag::Dead);
    let hit = Method::which(str.to_utf8().slice());
    if hit.is_none() {
        *miss = str;
    }
    Ok(hit)
}

/// Not Fetch, on purpose: "patch" is PATCH, exact CONNECT and TRACE pass, `null` and "" are absent.
#[inline]
fn request_method_from_js(global: &JSGlobalObject, input: JSValue) -> JsResult<OwnedMethod> {
    let mut miss = BunString::EMPTY;
    match which(global, input, &mut miss)? {
        Some(method) => Ok(method.into()),
        None => request_method_miss(global, &miss),
    }
}

#[cold]
fn request_method_miss(global: &JSGlobalObject, str: &BunString) -> JsResult<OwnedMethod> {
    let utf8 = str.to_utf8();
    let quoted = bun_core::fmt::quote(utf8.slice());
    match Method::classify_miss(utf8.slice()) {
        Classified::Known(method) => Ok(method.into()),
        Classified::Token => Ok(OwnedMethod::Token(Box::from(utf8.slice()))),
        Classified::Forbidden => Err(global
            .err(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("{quoted} HTTP method is unsupported."),
            )
            .throw()),
        Classified::Invalid => Err(global
            .err(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("{quoted} is not a valid HTTP method."),
            )
            .throw()),
    }
}

/// The method of a request from `init.method`, read once. `None`: the member is absent.
#[inline]
pub fn request_method_from_init(
    global: &JSGlobalObject,
    init: JSValue,
) -> JsResult<Option<OwnedMethod>> {
    match init.fast_get_truthy(global, BuiltinName::method)? {
        Some(value) => request_method_from_js(global, value).map(Some),
        None => Ok(None),
    }
}

/// Extension trait providing `.to_js()` on `Method` (lives in the `*_jsc` crate so the
/// base `bun_http_types` crate has no `bun_jsc` dependency).
pub trait MethodJsc {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}

impl MethodJsc for Method {
    #[inline]
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        Bun__HTTPMethod__toJS(self, global)
    }
}
