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
        // SAFETY: FFI call into WebCore C++; `global` is a valid borrowed JSGlobalObject.
        // `as_ptr()` goes through `UnsafeCell` so the `*mut` carries write provenance
        // (C++ may mutate the global to allocate the JS error value).
        unsafe { WebCore__CommonAbortReason__toJS(global.as_ptr(), self) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WebCore__CommonAbortReason__toJS(
        global: *mut JSGlobalObject,
        reason: CommonAbortReason,
    ) -> JSValue;
}

// ported from: src/jsc/CommonAbortReason.zig
