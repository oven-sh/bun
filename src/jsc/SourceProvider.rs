use core::marker::{PhantomData, PhantomPinned};

bun_opaque::opaque_ffi! {
    /// Opaque representation of a JavaScript source provider
    pub struct SourceProvider;
}

impl SourceProvider {
    pub fn deref(&mut self) {
        JSC__SourceProvider__deref(self)
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // safe: `SourceProvider` is an opaque `UnsafeCell`-backed ZST handle; `&mut` is
    // ABI-identical to a non-null pointer and C++ refcount mutation is interior.
    safe fn JSC__SourceProvider__deref(provider: &mut SourceProvider);
}

// ported from: src/jsc/SourceProvider.zig
