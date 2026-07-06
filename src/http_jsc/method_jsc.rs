//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_core::{OwnedString, String as BunString};
use bun_http_types::Method::{Method, MethodBuf, MethodRef};
use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsResult, StringJsc as _};

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
    // `defer str.deref()` — `bun_core::String` is `Copy` (no `Drop`), so wrap the
    // +1 ref from `BunString::from_js` in `OwnedString` to release it on scope exit.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != bun_core::Tag::Dead);
    // `Method::which` is keyed on `&[u8]`, so materialize UTF-8 and call it
    // directly.
    let utf8 = str.to_utf8();
    Ok(Method::which(utf8.slice()))
}

/// Parses `init["method"]` for `fetch()` / `new Request()` per
/// <https://fetch.spec.whatwg.org/#dom-request>: the six normalizable verbs are
/// upper-cased, every other valid token is kept byte-for-byte so it reaches the
/// server as the caller wrote it, and invalid or forbidden tokens yield a
/// `TypeError`.
///
/// The `TypeError` is returned as a value rather than thrown so `fetch()` can
/// reject its promise with it while `new Request()` throws it.
pub fn request_method_from_js(
    global_this: &JSGlobalObject,
    input: JSValue,
) -> JsResult<Result<MethodBuf, JSValue>> {
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != bun_core::Tag::Dead);
    let utf8 = str.to_utf8();
    let token = utf8.slice();

    if let Some(method) = Method::normalize(token) {
        return Ok(Ok(MethodBuf::Known(method)));
    }

    if !Method::is_token(token) {
        return Ok(Err(global_this.to_type_error(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("{} is not a valid HTTP method", bun_core::fmt::quote(token)),
        )));
    }

    if Method::is_forbidden(token) {
        return Ok(Err(global_this.to_type_error(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("{} HTTP method is unsupported", bun_core::fmt::quote(token)),
        )));
    }

    // Keep the enum (and its interned JS string) whenever the token is already
    // the exact wire spelling of a verb the table holds.
    if let Some(method) = Method::which(token)
        && method.as_str().as_bytes() == token
    {
        return Ok(Ok(MethodBuf::Known(method)));
    }

    Ok(Ok(MethodBuf::Custom(Box::from(token))))
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

/// `.to_js()` for a possibly-custom method. Known verbs keep the interned
/// common-string fast path; a custom token allocates a JS string.
pub trait MethodRefJsc {
    fn to_js(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl MethodRefJsc for MethodRef<'_> {
    fn to_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            MethodRef::Known(method) => Ok(Bun__HTTPMethod__toJS(method, global)),
            // `transfer_to_js` consumes the `+1` from `clone_utf8`.
            MethodRef::Custom(token) => BunString::clone_utf8(token).transfer_to_js(global),
        }
    }
}
