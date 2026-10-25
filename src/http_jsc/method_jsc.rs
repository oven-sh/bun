//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_http_types::Method::Method;
use bun_jsc::{JSGlobalObject, JSValue};

unsafe extern "C" {
    // SAFETY (safe fn): `Method` is a `#[repr(uN)]` scalar; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed handle, so `&JSGlobalObject` is ABI-identical to a
    // non-null `JSGlobalObject*` and C++ mutating VM/heap state through it is
    // interior mutation invisible to Rust.
    safe fn Bun__HTTPMethod__toJS(method: Method, global_object: &JSGlobalObject) -> JSValue;
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
