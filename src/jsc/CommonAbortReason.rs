use crate::{JSGlobalObject, JSValue};

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum CommonAbortReason {
    Timeout = 1,
    UserAbort = 2,
    ConnectionClosed = 3,
}

impl CommonAbortReason {
    pub fn to_js(self, global: &JSGlobalObject) -> JSValue {
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
