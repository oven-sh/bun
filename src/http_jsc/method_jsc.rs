//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_core::{OwnedString, String as BunString};
use bun_http_types::Method::Method;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};

unsafe extern "C" {
    // SAFETY (safe fn): `Method` is a `#[repr(uN)]` scalar; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed handle, so `&JSGlobalObject` is ABI-identical to a
    // non-null `JSGlobalObject*` and C++ mutating VM/heap state through it is
    // interior mutation invisible to Rust.
    safe fn Bun__HTTPMethod__toJS(method: Method, global_object: &JSGlobalObject) -> JSValue;
}

/// Port of Zig `Method.fromJS` (= `Map.fromJS`, the `ComptimeStringMap` JSC
/// bridge in `src/jsc/comptime_string_map_jsc.zig`). Converts a JS string
/// value to UTF-8 and looks it up in the static method table.
///
/// Lives here (not in `bun_http_types`) so the base crate stays JSC-free.
pub fn from_js(global_this: &JSGlobalObject, input: JSValue) -> JsResult<Option<Method>> {
    // `defer str.deref()` — `bun_core::String` is `Copy` (no `Drop`), so wrap the
    // +1 ref from `BunString::from_js` in `OwnedString` to release it on scope exit.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != bun_core::Tag::Dead);
    // PORT NOTE: Zig used `Map.getWithEql(str, bun.String.eqlComptime)`; the
    // Rust phf table is keyed on `&[u8]`, so materialize UTF-8 and call the
    // existing `Method::which` (which wraps the same map lookup).
    let utf8 = str.to_utf8();
    Ok(Method::which(utf8.slice()))
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

// ported from: src/http_jsc/method_jsc.zig
