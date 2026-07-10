/// The C++ object itself. Only the extern declaration below names this type;
/// all Rust code uses the owning [`SourceProvider`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `JSC::SourceProvider`. `&Self` is ABI-identical to a non-null
        /// `JSC::SourceProvider*`, and carries no `noalias`/`readonly` — C++
        /// mutates the intrusive refcount through it.
        pub struct SourceProvider;
    }
}

// C++ hands Rust a `+1` by `provider->ref()`-ing into the
// `ZigStackTrace::referenced_source_provider` out-param field
// (`populateStackFramePosition`, ZigException.cpp). One handle owns that ref.
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ `JSC::SourceProvider` (a `WTF::RefCounted`).
    ///
    /// Holds one ref on the intrusive refcount; `Drop` gives it back. There is no
    /// `&mut self` API and no `DerefMut`: a refcount is shared by definition, and
    /// JSC mutates the provider through the same pointer.
    ///
    /// `Option<SourceProvider>` niche-optimizes to a single thin pointer, so it is
    /// exactly the ABI of the C++ `JSC::SourceProvider*` struct field.
    pub struct SourceProvider(sys::SourceProvider) via JSC__SourceProvider__deref;
}

unsafe extern "C" {
    // safe: C++ takes `JSC::SourceProvider*` and calls the intrusive `->deref()`.
    // A refcount decrement is not exclusive access — other refs exist by
    // definition — so the receiver is `&`, not `&mut`.
    safe fn JSC__SourceProvider__deref(provider: &sys::SourceProvider);
}
