use crate::{JSGlobalObject, JSValue};

// The enum itself lives in `bun_http_types` (lower tier — `bun_http` needs it
// without pulling in `bun_jsc`). Re-export so existing `jsc::CommonAbortReason`
// paths keep resolving; `to_js()` stays here as an extension trait because it
// names `JSGlobalObject` / `JSValue`.
pub use bun_http_types::FetchRedirect::CommonAbortReason;

pub trait CommonAbortReasonExt {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
}

impl CommonAbortReasonExt for CommonAbortReason {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        WebCore__CommonAbortReason__toJS(global, self)
    }
}

// TODO(port): move to jsc_sys
//
// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; C++ allocating
// the JS error value through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn WebCore__CommonAbortReason__toJS(
        global: &JSGlobalObject,
        reason: CommonAbortReason,
    ) -> JSValue;
}

// ported from: src/jsc/CommonAbortReason.zig
