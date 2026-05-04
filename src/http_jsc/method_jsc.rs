//! JSC bridge for `bun_http_types::Method`. Keeps `bun_http_types` free of JSC types.

use bun_http_types::Method;
use bun_jsc::{JSGlobalObject, JSValue};

unsafe extern "C" {
    fn Bun__HTTPMethod__toJS(method: Method, global_object: *mut JSGlobalObject) -> JSValue;
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
        unsafe { Bun__HTTPMethod__toJS(self, global as *const _ as *mut _) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/method_jsc.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      Zig `pub const toJS = extern_fn` reshaped to extension trait per §Idiom map (*_jsc pattern)
// ──────────────────────────────────────────────────────────────────────────
