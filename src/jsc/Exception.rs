use crate::{JSGlobalObject, JSValue, ZigStackTrace};

/// Opaque representation of a JavaScript exception
#[repr(C)]
pub struct Exception {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__Exception__getStackTrace(
        this: *const Exception,
        global: *const JSGlobalObject,
        stack: *mut ZigStackTrace,
    );
    fn JSC__Exception__asJSValue(this: *const Exception) -> JSValue;
}

impl Exception {
    pub fn get_stack_trace(&self, global: &JSGlobalObject, stack: &mut ZigStackTrace) {
        // SAFETY: `self`/`global` are valid opaque FFI handles (ZST in Rust; all state lives
        // on the C++ side, so passing `*const` is sound — C++ mutates only its own heap data,
        // never memory observable through Rust's type). `stack` is exclusively borrowed and
        // writable for the call.
        unsafe {
            JSC__Exception__getStackTrace(self, global, stack);
        }
    }

    pub fn value(&self) -> JSValue {
        // SAFETY: `self` is a valid opaque FFI handle; C++ only encodes the pointer as a
        // JSValue and performs no writes.
        unsafe { JSC__Exception__asJSValue(self) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Exception.zig (20 lines)
//   confidence: high
//   todos:      1
//   notes:      opaque FFI handle + 2 extern wrappers; externs flagged for jsc_sys
// ──────────────────────────────────────────────────────────────────────────
