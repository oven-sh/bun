use core::marker::{PhantomData, PhantomPinned};

bun_opaque::opaque_ffi! {
    /// Opaque representation of a JavaScript source provider
    pub struct SourceProvider;
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

// ported from: src/jsc/SourceProvider.zig
