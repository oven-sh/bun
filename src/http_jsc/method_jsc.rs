//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_http_types::Method::Method;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_string::{OwnedString, String as BunString};

unsafe extern "C" {
    fn Bun__HTTPMethod__toJS(method: Method, global_object: *mut JSGlobalObject) -> JSValue;
}

/// Port of Zig `Method.fromJS` (= `Map.fromJS`, the `ComptimeStringMap` JSC
/// bridge in `src/jsc/comptime_string_map_jsc.zig`). Converts a JS string
/// value to UTF-8 and looks it up in the static method table.
///
/// Lives here (not in `bun_http_types`) so the base crate stays JSC-free.
pub fn from_js(global_this: &JSGlobalObject, input: JSValue) -> JsResult<Option<Method>> {
    // `defer str.deref()` — `bun_string::String` is `Copy` (no `Drop`), so wrap the
    // +1 ref from `BunString::from_js` in `OwnedString` to release it on scope exit.
    let str = OwnedString::new(BunString::from_js(input, global_this)?);
    debug_assert!(str.tag() != bun_string::Tag::Dead);
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
        // SAFETY: `global` is a valid live JSGlobalObject for the duration of the call;
        // `Method` is `#[repr(uN)]` matching the C++ definition of `Bun__HTTPMethod__toJS`.
        // `as_ptr()` routes through `JSGlobalObject`'s `UnsafeCell` interior, so the
        // resulting `*mut` carries write provenance (C++ may mutate VM/heap state).
        unsafe { Bun__HTTPMethod__toJS(self, global.as_ptr()) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/method_jsc.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      Zig `pub const toJS = extern_fn` reshaped to extension trait per §Idiom map (*_jsc pattern)
// ──────────────────────────────────────────────────────────────────────────
