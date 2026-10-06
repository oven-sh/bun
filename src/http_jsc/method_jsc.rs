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

/// Looks up the string of a JS value in the method table. A hit is the verb.
/// After a miss the string is in `miss`, for the caller to read further.
///
/// `#[inline(never)]`: every method string from JS comes through here, and
/// the binary keeps one copy of the lookup.
#[inline(never)]
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

/// The method of a request (`fetch`, `Request`, `server.fetch`): a verb of
/// the table, or any other token as written. Throws a `TypeError` for a
/// string that is not a token.
///
/// Three things differ from <https://fetch.spec.whatwg.org/#dom-request> on
/// purpose, because callers depend on them:
/// - An all-lower table verb is upper-cased (`"patch"` is PATCH). Fetch
///   keeps it as written.
/// - `CONNECT` and `TRACE` in the spellings of the table are accepted. Fetch
///   forbids them, and TRACK, in any case.
/// - [`request_method_from_init`] takes `null` and `""` as absent. Fetch
///   takes `null` as the token `null` and throws for `""`.
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

/// `init.method` of a `RequestInit`-like object, read once. `None` means that
/// the member is absent, which is `undefined`, `null` or `""`. Any other
/// value is a method or an error, so only an absent member leaves the caller
/// its default.
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

/// Converts a JS string value to UTF-8 and looks it up in the static method
/// table. For a caller that takes a verb of the table and reports everything
/// else in its own words (S3 presign). The method of a request goes through
/// [`request_method_from_init`].
pub fn from_js(global: &JSGlobalObject, input: JSValue) -> JsResult<Option<Method>> {
    let mut miss = BunString::EMPTY;
    which(global, input, &mut miss)
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
