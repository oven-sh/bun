//! expensive heap reference-counted string type
//! only use this for big strings
//! like source code
//! not little ones

use core::ffi::c_void;
use core::ptr::NonNull;

// `bun_core::WTFStringImpl` is the *pointer* type (= `*mut WTFStringImplStruct`).
use bun_core::WTFStringImpl;

pub(crate) type Hash = u32;

/// `std.HashMap(Hash, *RefString, bun.IdentityContext(Hash), 80)`
// `bun.IdentityContext` is an identity hasher (key is already a hash). The `80`
// max-load-percentage has no direct knob on the Rust side.
pub type Map =
    bun_collections::HashMap<Hash, *mut RefString, bun_collections::IdentityContext<Hash>>;

pub type Callback = unsafe fn(ctx: *mut c_void, str: *mut RefString);

pub struct RefString {
    pub ptr: *const u8,
    pub(crate) len: usize,
    pub(crate) hash: Hash,
    // `impl` is a Rust keyword — renamed to `impl_`.
    pub(crate) impl_: WTFStringImpl,

    // No per-instance allocator — non-AST crate uses the
    // global mimalloc allocator (see PORTING.md §Allocators). `destroy` below
    // frees via `heap::take`.
    pub ctx: Option<NonNull<c_void>>,
    pub(crate) on_before_deinit: Option<Callback>,
}

/// RAII owner of one reference to an interned [`RefString`] (one
/// `WTF::StringImpl` refcount). Mirrors `bun_core::OwnedString`: `Drop`
/// releases the reference, `Clone` takes another one, and
/// [`OwnedRefString::into_raw`] transfers it to a consumer that will release
/// it (e.g. C++ via `ResolvedSource.source_code_needs_deref`).
///
/// Intentionally no `Deref` to [`RefString`]: `RefString::ref_`/`deref` are
/// the raw refcount ops this type exists to encapsulate, so reaching them
/// must go through the explicit [`OwnedRefString::get`].
pub struct OwnedRefString(NonNull<RefString>);

impl OwnedRefString {
    /// Adopt a reference the caller already owns (e.g. the +1
    /// `String::create_external` leaves on a fresh entry).
    ///
    /// # Safety
    /// `p` points at a live `RefString` and the caller transfers exactly one
    /// owned reference.
    pub(crate) unsafe fn adopt(p: NonNull<RefString>) -> Self {
        Self(p)
    }

    /// Take a new reference on a live `RefString`.
    ///
    /// # Safety
    /// `p` points at a `RefString` that stays live for the duration of this
    /// call (e.g. it sits in `ref_strings` under `ref_strings_mutex`).
    pub(crate) unsafe fn claim(p: NonNull<RefString>) -> Self {
        // SAFETY: caller contract — `p` is live for this call.
        unsafe { p.as_ref() }.ref_();
        Self(p)
    }

    pub fn get(&self) -> &RefString {
        // SAFETY: `self` owns a reference, so the pointee is live.
        unsafe { self.0.as_ref() }
    }

    /// Disarm the drop guard and hand the owned reference to the caller, who
    /// becomes responsible for the matching `deref`.
    pub fn into_raw(self) -> *mut RefString {
        core::mem::ManuallyDrop::new(self).0.as_ptr()
    }
}

impl Clone for OwnedRefString {
    fn clone(&self) -> Self {
        // SAFETY: `self` owns a reference, so the pointee is live.
        unsafe { Self::claim(self.0) }
    }
}

impl Drop for OwnedRefString {
    fn drop(&mut self) {
        self.get().deref();
    }
}

impl RefString {
    pub(crate) fn compute_hash(input: &[u8]) -> u32 {
        bun_hash::XxHash32::hash(0, input)
    }

    /// Single audited deref of the set-once `impl_` backref so `ref_` /
    /// `deref` below are safe callers. `impl_` is assigned at construction
    /// from a live refcounted `WTF::StringImpl*` and remains valid until
    /// `destroy` consumes `self`.
    #[inline]
    fn wtf_impl(&self) -> &bun_core::WTFStringImplStruct {
        // SAFETY: `impl_` is a live `WTF::StringImpl*` for the lifetime of
        // `self` (set at construction; freed only after `destroy`).
        unsafe { &*self.impl_ }
    }

    pub fn ref_(&self) {
        self.wtf_impl().r#ref();
    }

    pub fn leak(&self) -> &[u8] {
        // SAFETY: `ptr` points to a live allocation of `len` bytes for the
        // lifetime of `self` (freed only in `destroy`).
        unsafe { bun_core::ffi::slice(self.ptr, self.len) }
    }

    pub fn deref(&self) {
        self.wtf_impl().deref();
    }

    /// Called when the underlying `WTF::StringImpl` refcount reaches zero.
    ///
    /// Frees the byte
    /// buffer and then the `RefString` itself (self-destroying). Because
    /// `RefString` is heap-allocated and held as `*mut RefString` (see `Map`),
    /// this stays an explicit raw-pointer destroy rather than `impl Drop`.
    ///
    /// SAFETY: `this` must be the unique live reference to a `RefString`
    /// previously allocated via `heap::alloc` (or equivalent). After this
    /// call `this` is dangling.
    pub(crate) unsafe fn destroy(this: *mut RefString) {
        // SAFETY: caller contract — `this` is the unique live pointer to a
        // `Box<RefString>`-allocated value whose `ptr`/`len` describe a
        // `Box<[u8]>`-allocated buffer. All raw derefs and `from_raw` calls
        // below operate on those owned allocations.
        unsafe {
            if let Some(on_before_deinit) = (*this).on_before_deinit {
                // Caller guarantees `ctx` is set
                // whenever `on_before_deinit` is set.
                on_before_deinit((*this).ctx.unwrap().as_ptr(), this);
            }

            // `allocator.free(this.leak())` — reconstitute the owned byte slice
            // and drop it. Build the fat `*mut [u8]` as a raw pointer (no `&mut`
            // materialized — the WTF::StringImpl finalizer may still hold a
            // shared view at this instant, so forming `&mut [u8]` would assert
            // exclusivity we cannot prove).
            drop(bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(
                (*this).ptr.cast_mut(),
                (*this).len,
            )));
            // `allocator.destroy(this)`
            drop(bun_core::heap::take(this));
        }
    }
}
