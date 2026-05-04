use core::marker::{PhantomData, PhantomPinned};

/// Opaque representation of a JavaScript source provider
#[repr(C)]
pub struct SourceProvider {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl SourceProvider {
    pub fn deref(&mut self) {
        // SAFETY: self is a valid *mut SourceProvider obtained from JSC; C++ side handles refcount.
        unsafe { JSC__SourceProvider__deref(self) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__SourceProvider__deref(provider: *mut SourceProvider);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/SourceProvider.zig (8 lines)
//   confidence: high
//   todos:      1
//   notes:      opaque FFI handle; extern decl should move to jsc_sys in Phase B
// ──────────────────────────────────────────────────────────────────────────
