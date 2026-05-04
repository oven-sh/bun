use crate::{JSGlobalObject, JSValue};
use crate::zig_stack_trace::ZigStackTrace;

/// Opaque representation of a JavaScript exception
#[repr(C)]
pub struct Exception {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__Exception__getStackTrace(
        this: *mut Exception,
        global: *mut JSGlobalObject,
        stack: *mut ZigStackTrace,
    );
    fn JSC__Exception__asJSValue(this: *mut Exception) -> JSValue;
}

impl Exception {
    pub fn get_stack_trace(&self, global: &JSGlobalObject, stack: &mut ZigStackTrace) {
        // SAFETY: self is a valid *Exception (opaque FFI handle); global and stack are valid for the call.
        unsafe {
            JSC__Exception__getStackTrace(
                self as *const Exception as *mut Exception,
                global as *const JSGlobalObject as *mut JSGlobalObject,
                stack,
            );
        }
    }

    pub fn value(&self) -> JSValue {
        // SAFETY: self is a valid *Exception (opaque FFI handle).
        unsafe { JSC__Exception__asJSValue(self as *const Exception as *mut Exception) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Exception.zig (20 lines)
//   confidence: high
//   todos:      1
//   notes:      opaque FFI handle + 2 extern wrappers; externs flagged for jsc_sys
// ──────────────────────────────────────────────────────────────────────────
