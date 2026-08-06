bun_opaque::opaque_ffi! {
    /// Opaque representation of a JavaScript source provider
    pub struct SourceProvider;
}

impl SourceProvider {
    pub(crate) fn deref(&mut self) {
        JSC__SourceProvider__deref(self)
    }
}

unsafe extern "C" {
    // safe: `SourceProvider` is an opaque `UnsafeCell`-backed ZST handle; `&mut` is
    // ABI-identical to a non-null pointer and C++ refcount mutation is interior.
    safe fn JSC__SourceProvider__deref(provider: &mut SourceProvider);
}
