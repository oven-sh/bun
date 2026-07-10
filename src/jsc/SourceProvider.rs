use core::ptr::NonNull;

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
bun_opaque::foreign_owned!(sys::SourceProvider, JSC__SourceProvider__deref);

/// Owned handle to a C++ `JSC::SourceProvider` (a `WTF::RefCounted`).
///
/// Holds one ref on the intrusive refcount; `Drop` gives it back. There is no
/// `&mut self` API and no `DerefMut`: a refcount is shared by definition, and
/// JSC mutates the provider through the same pointer.
///
/// `Option<SourceProvider>` niche-optimizes to a single thin pointer, so it is
/// exactly the ABI of the C++ `JSC::SourceProvider*` struct field.
#[repr(transparent)]
pub struct SourceProvider(bun_opaque::ForeignRef<sys::SourceProvider>);

unsafe extern "C" {
    // safe: C++ takes `JSC::SourceProvider*` and calls the intrusive `->deref()`.
    // A refcount decrement is not exclusive access — other refs exist by
    // definition — so the receiver is `&`, not `&mut`.
    safe fn JSC__SourceProvider__deref(provider: &sys::SourceProvider);
}

/// Ownership plumbing. `deref` is the release fn, so it lives only in `Drop`;
/// there is no other inherent method to forward, hence no private `raw()`.
impl SourceProvider {
    /// Adopt a `+1` C++ wrote into an out-param.
    ///
    /// # Safety
    /// `ptr` must carry exactly one ref that no other handle will release.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::SourceProvider>) -> Self {
        // SAFETY: caller transfers the +1.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// The C++ pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::SourceProvider {
        self.0.as_ptr()
    }

    /// Hand our `+1` to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::SourceProvider> {
        self.0.leak()
    }
}
