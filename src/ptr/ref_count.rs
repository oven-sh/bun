//! Intrusive reference counting (single-threaded and thread-safe) and
//! `RefPtr<T>`, the owning handle to one such ref.
//!
//! Each ref-count mixin is a pair of (embedded struct + trait the host
//! type implements). See `RefCounted` / `ThreadSafeRefCounted`.

use core::cell::Cell;
use core::marker::PhantomData;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::ThreadLock;

// ──────────────────────────────────────────────────────────────────────────
// Host-type traits (field projection + destructor)
// ──────────────────────────────────────────────────────────────────────────

/// `bun.meta.typeBaseName` — strip the module path (and the path inside any
/// leading generic segment) from a `core::any::type_name` string, returning a
/// subslice so the result stays `&'static str`.
/// `"a::b::Foo<c::Bar>"` → `"Foo<c::Bar>"`.
fn type_base_name(name: &'static str) -> &'static str {
    let bytes = name.as_bytes();
    let end = bun_core::strings::index_of_char_usize(bytes, b'<').unwrap_or(bytes.len());
    match bun_core::strings::last_index_of(&bytes[..end], b"::") {
        Some(i) => &name[i + 2..],
        None => name,
    }
}

/// Implemented by types that embed a [`RefCount`] field.
pub trait RefCounted: Sized {
    /// Defaults to the type basename.
    fn debug_name() -> &'static str {
        type_base_name(core::any::type_name::<Self>())
    }

    /// Locate the embedded `RefCount` field.
    ///
    /// # Safety
    /// `this` must be non-null, properly aligned, and in-bounds of an
    /// allocation large enough for `Self` — but it may point to
    /// **uninitialized** memory.
    ///
    /// Consequently, implementations MUST be pure raw-pointer field
    /// projections (`&raw mut (*this).field`): no reads through `this`, no
    /// creation of references (`&`/`&mut`) to `*this` or any of its fields,
    /// and no other side effects.
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self>;

    /// Called when the refcount reaches zero.
    ///
    /// # Safety
    /// `this` must point to a live `Self` with `raw_count == 0`.
    unsafe fn destructor(this: *mut Self);
}

/// Implemented by types that embed a [`ThreadSafeRefCount`] field.
pub trait ThreadSafeRefCounted: Sized {
    /// Defaults to the type basename.
    fn debug_name() -> &'static str {
        type_base_name(core::any::type_name::<Self>())
    }

    /// Locate the embedded `ThreadSafeRefCount` field.
    ///
    /// # Safety
    /// `this` must be non-null, properly aligned, and in-bounds of an
    /// allocation large enough for `Self` — but it may point to
    /// **uninitialized** memory.
    ///
    /// Consequently, implementations MUST be pure raw-pointer field
    /// projections (`&raw mut (*this).field`): no reads through `this`, no
    /// creation of references (`&`/`&mut`) to `*this` or any of its fields,
    /// and no other side effects.
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self>;

    /// Called when the refcount reaches zero.
    ///
    /// # Safety
    /// `this` must point to a live `Self` with `raw_count == 0`.
    #[inline]
    unsafe fn destructor(this: *mut Self) {
        // Default: the allocation came from `heap::alloc` / `Box::into_raw`;
        // reclaim and drop. Override for pooled / arena-backed types.
        // SAFETY: caller contract — sole owner of a Box-allocated `Self`.
        drop(unsafe { Box::from_raw(this) });
    }
}

/// Unifying trait so `RefPtr<T>` works with either ref-count flavor.
pub trait AnyRefCounted: Sized {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_ref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self` and the caller must own one ref.
    unsafe fn rc_deref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_has_one_ref(this: *const Self) -> bool;
    /// Debug-asserts the refcount has not already been destroyed.
    ///
    /// # Safety
    /// `this` must point to a live `Self`.
    #[inline]
    unsafe fn rc_assert_valid(_this: *const Self) {}
}

// ──────────────────────────────────────────────────────────────────────────
// JS-wrapper finalize → intrusive-refcount release
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// RefCount (single-threaded, intrusive)
// ──────────────────────────────────────────────────────────────────────────

/// Add managed reference counting to a struct type. This implements a `ref()`
/// and `deref()` method to add to the struct itself. This mixin doesn't handle
/// memory management, but is very easy to integrate with `Box::new` + `drop`.
///
/// Avoid reference counting when an object only has one owner.
///
/// ```ignore
/// struct Thing {
///     ref_count: RefCount<Thing>,
///     other_field: u32,
/// }
/// impl RefCounted for Thing {
///     unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
///         unsafe { &raw mut (*this).ref_count }
///     }
///     unsafe fn destructor(this: *mut Self) {
///         println!("deinit {}", unsafe { (*this).other_field });
///         drop(unsafe { heap::take(this) });
///     }
/// }
/// ```
pub struct RefCount<T: RefCounted> {
    raw_count: Cell<u32>,
    thread: ThreadLock,
    #[cfg(debug_assertions)]
    debug: DebugData,
    _phantom: PhantomData<*const T>,
}

impl<T: RefCounted> RefCount<T> {
    pub fn init() -> Self {
        Self::init_exact_refs(1)
    }

    /// Caller will have to call `deref()` exactly `count` times to destroy.
    pub fn init_exact_refs(count: u32) -> Self {
        debug_assert!(count > 0);
        Self {
            raw_count: Cell::new(count),
            thread: ThreadLock::init_locked_if_non_comptime(),
            #[cfg(debug_assertions)]
            debug: DebugData::empty(),
            _phantom: PhantomData,
        }
    }

    // interface implementation

    // `ref` is a Rust keyword; renamed to `ref_`.
    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn ref_(self_: *mut T) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        count.assert_valid();
        bun_core::scoped_log!(
            ref_count,
            "0x{:x}   ref {} -> {}:",
            self_ as usize,
            count.raw_count.get(),
            count.raw_count.get() + 1,
        );
        count.assert_single_threaded();
        count.raw_count.set(count.raw_count.get() + 1);
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn deref(self_: *mut T) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        count.assert_valid(); // Likely double deref.
        bun_core::scoped_log!(
            ref_count,
            "0x{:x} deref {} -> {}:",
            self_ as usize,
            count.raw_count.get(),
            count.raw_count.get() - 1,
        );
        count.assert_single_threaded();
        count.raw_count.set(count.raw_count.get() - 1);
        if count.raw_count.get() == 0 {
            #[cfg(debug_assertions)]
            {
                // SAFETY: `count` is not used again; we need &mut for deinit
                unsafe { (*T::get_ref_count(self_)).debug.deinit() };
            }
            // SAFETY: raw_count == 0, sole owner
            unsafe { T::destructor(self_) };
        }
    }

    // utility functions

    pub fn has_one_ref(&self) -> bool {
        self.assert_single_threaded();
        self.raw_count.get() == 1
    }

    pub fn get(&self) -> u32 {
        self.raw_count.get()
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        assert!(self.raw_count.get() == 0);
    }

    fn assert_single_threaded(&self) {
        self.thread.lock_or_assert();
    }

    #[inline]
    pub fn assert_valid(&self) {
        #[cfg(debug_assertions)]
        self.debug.assert_valid();
    }
}

impl<T: RefCounted> AnyRefCounted for T {
    unsafe fn rc_ref(this: *mut Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { RefCount::<T>::ref_(this) }
    }
    unsafe fn rc_deref(this: *mut Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { RefCount::<T>::deref(this) }
    }
    unsafe fn rc_has_one_ref(this: *const Self) -> bool {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this.cast_mut())).has_one_ref() }
    }
    unsafe fn rc_assert_valid(this: *const Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this.cast_mut())).assert_valid() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeRefCount (atomic, intrusive)
// ──────────────────────────────────────────────────────────────────────────

/// Add thread-safe reference counting to a struct type. This implements a
/// `ref()` and `deref()` method to add to the struct itself. This mixin doesn't
/// handle memory management, but is very easy to integrate with `Box::new` +
/// `drop`.
///
/// See [`RefCount`]'s comment for examples & best practices.
///
/// Avoid reference counting when an object only has one owner.
/// Avoid thread-safe reference counting when only one thread allocates and frees.
pub struct ThreadSafeRefCount<T: ThreadSafeRefCounted> {
    raw_count: AtomicU32,
    #[cfg(debug_assertions)]
    debug: DebugData,
    _phantom: PhantomData<*const T>,
}

impl<T: ThreadSafeRefCounted> ThreadSafeRefCount<T> {
    pub fn init() -> Self {
        Self::init_exact_refs(1)
    }

    /// Caller will have to call `deref()` exactly `count` times to destroy.
    pub fn init_exact_refs(count: u32) -> Self {
        debug_assert!(count > 0);
        Self {
            raw_count: AtomicU32::new(count),
            #[cfg(debug_assertions)]
            debug: DebugData::empty(),
            _phantom: PhantomData,
        }
    }

    // interface implementation

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn ref_(self_: *mut T) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        count.assert_valid();
        let old_count = count.raw_count.fetch_add(1, Ordering::SeqCst);
        bun_core::scoped_log!(
            ref_count,
            "0x{:x}   ref {} -> {}",
            self_ as usize,
            old_count,
            old_count + 1,
        );
        debug_assert!(old_count > 0);
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn deref(self_: *mut T) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        count.assert_valid();
        let old_count = count.raw_count.fetch_sub(1, Ordering::SeqCst);
        bun_core::scoped_log!(
            ref_count,
            "0x{:x} deref {} -> {}",
            self_ as usize,
            old_count,
            old_count - 1,
        );
        debug_assert!(old_count > 0);
        if old_count == 1 {
            #[cfg(debug_assertions)]
            {
                // SAFETY: we hold the last ref; exclusive access
                unsafe { (*T::get_ref_count(self_)).debug.deinit() };
            }
            // SAFETY: last ref dropped
            unsafe { T::destructor(self_) };
        }
    }

    /// Decrement the refcount WITHOUT running `T::destructor`; returns `true`
    /// on the 1→0 transition (caller now exclusively owns `*self_` and MUST
    /// destroy it exactly once).
    ///
    /// Prefer [`deref`](Self::deref). Use `release` only when destruction must
    /// be deferred or routed elsewhere (e.g. bouncing the final drop back to
    /// the owning thread's event loop).
    ///
    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn release(self_: *mut T) -> bool {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        count.assert_valid();
        let old_count = count.raw_count.fetch_sub(1, Ordering::SeqCst);
        bun_core::scoped_log!(
            ref_count,
            "0x{:x} deref {} -> {}",
            self_ as usize,
            old_count,
            old_count - 1,
        );
        debug_assert!(old_count > 0);
        if old_count == 1 {
            #[cfg(debug_assertions)]
            {
                // SAFETY: we hold the last ref; exclusive access
                unsafe { (*T::get_ref_count(self_)).debug.deinit() };
            }
            true
        } else {
            false
        }
    }

    // utility functions

    pub fn get(&self) -> u32 {
        self.raw_count.load(Ordering::SeqCst)
    }

    pub fn has_one_ref(&self) -> bool {
        self.assert_valid();
        self.get() == 1
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        assert!(self.raw_count.load(Ordering::SeqCst) == 0);
    }

    #[inline]
    pub fn assert_valid(&self) {
        #[cfg(debug_assertions)]
        self.debug.assert_valid();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CellRefCounted — lightweight intrusive refcount over a raw `Cell<u32>`
// ──────────────────────────────────────────────────────────────────────────

/// Lightweight intrusive refcount trait for types that embed a bare
/// `ref_count: Cell<u32>` field (no [`RefCount<Self>`] wrapper, no debug
/// canary, no thread-lock).
///
/// Implementors supply only [`ref_count`] and [`destroy`]; the trait provides
/// `ref_()`/`deref()` with the canonical inc/dec/destroy-at-zero logic.
///
/// Use `#[derive(CellRefCounted)]` to derive this trait together with the
/// [`AnyRefCounted`] bridge (so [`RefPtr`] accepts the type)
/// and inherent `ref_()`/`deref()` forwarders (so existing call sites that
/// invoke them as inherent methods keep compiling without importing the
/// trait).
///
/// # Safety
/// Single-threaded only (`Cell<u32>` is `!Sync`). The implementor guarantees
/// that every live `*mut Self` reaching `deref` originated from an allocation
/// that `destroy` knows how to free.
///
/// [`ref_count`]: CellRefCounted::ref_count
/// [`destroy`]: CellRefCounted::destroy
pub unsafe trait CellRefCounted: Sized {
    /// Locate the embedded `Cell<u32>` refcount field.
    fn ref_count(&self) -> &Cell<u32>;

    /// Raw-pointer projection to the embedded refcount. Unlike [`ref_count`],
    /// this never materialises a whole-struct `&Self`, so it is sound to call
    /// from contexts where another live borrow (e.g. a `&mut` on a sibling
    /// field) overlaps `*this` under Stacked Borrows. The derive supplies this
    /// via `addr_of!((*this).#field)`.
    ///
    /// # Safety
    /// `this` must point to a live `Self` for the chosen `'a`.
    ///
    /// [`ref_count`]: CellRefCounted::ref_count
    unsafe fn ref_count_raw<'a>(this: *const Self) -> &'a Cell<u32>;

    /// Called exactly once when the refcount reaches zero.
    ///
    /// The default reclaims the allocation as a `Box<Self>` (i.e.
    /// `drop(heap::take(this))`); override only when the allocation came from
    /// somewhere other than `heap::alloc` / `Box::into_raw`, or when extra
    /// teardown must run before field `Drop` impls.
    ///
    /// # Safety
    /// `this` points to a live `Self` whose refcount just hit zero; no other
    /// alias remains. Callee takes ownership and frees the allocation.
    #[inline]
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — sole owner of a Box-allocated `Self`.
        drop(unsafe { Box::from_raw(this) });
    }

    /// Increment the intrusive refcount.
    #[inline]
    fn ref_(&self) {
        let rc = self.ref_count();
        rc.set(rc.get() + 1);
    }

    /// Decrement the intrusive refcount; runs [`destroy`](Self::destroy) when
    /// it reaches zero.
    ///
    /// Takes a raw `*mut Self` (not `&self`) so the pointer retains the full
    /// write provenance from `heap::alloc`; routing through `&self` and
    /// casting back to `*mut` would be UB under Stacked Borrows when
    /// `heap::take` reclaims the allocation in `destroy`.
    ///
    /// # Safety
    /// `this` must point to a live `Self` and the caller must own one ref.
    /// After this call `this` may be dangling.
    #[inline]
    unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live. Project to the `Cell<u32>`
        // only via `ref_count_raw` (no `&Self` formed), so this is sound even
        // when a `&mut` on a sibling field is live in a parent frame.
        let rc = unsafe { Self::ref_count_raw(this) };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            // SAFETY: refcount reached zero; no other holders.
            unsafe { Self::destroy(this) };
        }
    }

    /// Safe [`deref`](Self::deref) for a `NonNull<Self>` handle.
    ///
    /// The single audited `unsafe` lives here in `bun_ptr`, beside the trait
    /// contract that makes it sound, so callers holding a `NonNull` never
    /// re-derive the raw-pointer provenance themselves.
    #[inline]
    fn deref_nn(this: NonNull<Self>) {
        // SAFETY: `CellRefCounted` impl contract — `this` is a live,
        // heap-allocated `Self` whose allocation `destroy` knows how to free;
        // `NonNull` guarantees non-null. The caller owns one ref.
        unsafe { Self::deref(this.as_ptr()) };
    }
}

// A blanket `impl<T: ThreadSafeRefCounted> AnyRefCounted for T` would overlap
// with the `RefCounted` blanket above (Rust forbids overlapping blanket impls).
// Instead, thread-safe hosts opt in via `#[derive(ThreadSafeRefCounted)]`,
// which emits the per-type `AnyRefCounted` impl alongside the trait impl.

// ──────────────────────────────────────────────────────────────────────────
// RefPtr
// ──────────────────────────────────────────────────────────────────────────

/// An owned strong reference to an intrusively refcounted `T` (`RefCount`,
/// `ThreadSafeRefCount`, or `CellRefCounted`).
///
/// Holding a `RefPtr` *is* holding one ref: `Drop` releases it (destroying `T`
/// if it was the last), `Clone` takes another. To hand the ref to a raw-pointer
/// consumer (C++ `m_ctx`, a uws/libuv userdata slot) use
/// [`into_raw`](Self::into_raw) and reclaim it later with
/// [`from_raw`](Self::from_raw).
#[must_use = "dropping a RefPtr releases its ref"]
#[repr(transparent)]
pub struct RefPtr<T: AnyRefCounted>(NonNull<T>);

impl<T: AnyRefCounted> Drop for RefPtr<T> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: we own a ref, so the pointee is live; this releases it.
        unsafe { T::rc_deref(self.0.as_ptr()) };
    }
}

// Like `Arc<T>`: sending or sharing a `RefPtr` sends/shares `&T` and may run
// `T`'s destructor on another thread.
// SAFETY: see above; hosts opt in by being `Send + Sync` themselves.
unsafe impl<T: AnyRefCounted + Send + Sync> Send for RefPtr<T> {}
// SAFETY: see above.
unsafe impl<T: AnyRefCounted + Send + Sync> Sync for RefPtr<T> {}

impl<T: AnyRefCounted> RefPtr<T> {
    /// Allocate `value` on the heap and own its initial ref (its embedded count
    /// starts at 1).
    #[inline]
    pub fn new(value: T) -> Self {
        let ptr = bun_core::heap::into_raw_nn(Box::new(value));
        // SAFETY: freshly boxed, so live.
        debug_assert!(unsafe { T::rc_has_one_ref(ptr.as_ptr()) });
        Self(ptr)
    }

    /// Take a new ref on `*raw_ptr`.
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T`.
    #[inline]
    pub unsafe fn init_ref(raw_ptr: *mut T) -> Self {
        // SAFETY: caller contract
        unsafe {
            T::rc_assert_valid(raw_ptr);
            T::rc_ref(raw_ptr);
            Self(NonNull::new_unchecked(raw_ptr))
        }
    }

    /// Take a new ref on the pointee of a [`ThisPtr`](crate::ThisPtr). Safe:
    /// the `ThisPtr` invariant is that its pointee is live. This is the guard
    /// to hold across a re-entrant call that may otherwise drop the last ref.
    #[inline]
    pub fn from_this(this: crate::ThisPtr<T>) -> Self {
        // SAFETY: `ThisPtr::new` invariant — pointee is live.
        unsafe { Self::init_ref(this.as_ptr()) }
    }

    /// Take ownership of a ref the caller already holds on `*raw_ptr`, without
    /// incrementing. Inverse of [`into_raw`](Self::into_raw) (`Arc::from_raw`
    /// semantics).
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T` and the caller must own one ref.
    #[inline]
    pub unsafe fn from_raw(raw_ptr: *mut T) -> Self {
        // SAFETY: caller contract
        unsafe {
            T::rc_assert_valid(raw_ptr);
            Self(NonNull::new_unchecked(raw_ptr))
        }
    }

    /// Give up ownership of the ref without decrementing; whoever holds the
    /// returned pointer now owns it. Inverse of [`from_raw`](Self::from_raw)
    /// (`Arc::into_raw` semantics).
    #[inline]
    pub fn into_raw(self) -> *mut T {
        self.into_non_null().as_ptr()
    }

    /// [`into_raw`](Self::into_raw) as a `NonNull`.
    #[inline]
    pub fn into_non_null(self) -> NonNull<T> {
        core::mem::ManuallyDrop::new(self).0
    }

    /// A [`ThisPtr`](crate::ThisPtr) to the pointee, valid while this (or
    /// another) ref is alive.
    #[inline]
    pub fn this_ptr(&self) -> crate::ThisPtr<T> {
        // SAFETY: we own a ref, so the pointee is live.
        unsafe { crate::ThisPtr::new(self.0.as_ptr()) }
    }

    /// [`into_raw`](Self::into_raw) for the `ThisPtr`-shaped dispatch entry
    /// points: the callee takes over this ref.
    #[inline]
    pub fn into_this_ptr(self) -> crate::ThisPtr<T> {
        // SAFETY: `into_raw` transfers our live ref; the pointee is non-null.
        unsafe { crate::ThisPtr::new(self.into_raw()) }
    }

    /// The pointee's address without affecting the refcount (`Arc::as_ptr`).
    /// It carries the allocation's own provenance, so it may be threaded back
    /// through APIs that eventually free it, provided a ref is held meanwhile.
    ///
    /// This is the only sanctioned way to mutate the pointee: `RefPtr` is a
    /// shared-ownership handle, so a `&mut T` accessor would alias any other
    /// live `RefPtr`/`&T` to the same allocation.
    #[inline]
    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }

    /// [`as_ptr`](Self::as_ptr) as a `NonNull`.
    #[inline]
    pub fn as_non_null(&self) -> NonNull<T> {
        self.0
    }
}

impl<T: AnyRefCounted> Clone for RefPtr<T> {
    /// Takes another ref on the same allocation.
    #[inline]
    fn clone(&self) -> Self {
        // SAFETY: we own a ref, so the pointee is live.
        unsafe { Self::init_ref(self.0.as_ptr()) }
    }
}

impl<T: AnyRefCounted> core::ops::Deref for RefPtr<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: we own a ref, so the pointee is live for the borrow.
        // Single-threaded hosts are !Send/!Sync so no concurrent mutation;
        // thread-safe hosts coordinate their own interior mutability.
        unsafe { self.0.as_ref() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DebugData
// ──────────────────────────────────────────────────────────────────────────

#[cfg(debug_assertions)]
const MAGIC_VALID: u32 = 0x2f84_e51d;

/// Debug-only liveness canary embedded in `RefCount`/`ThreadSafeRefCount`:
/// poisoned when the destructor runs, so a ref/deref through a dangling
/// pointer asserts instead of silently corrupting the count.
#[cfg(debug_assertions)]
struct DebugData {
    magic: u32,
}

#[cfg(debug_assertions)]
impl DebugData {
    const fn empty() -> Self {
        Self { magic: MAGIC_VALID }
    }

    fn assert_valid(&self) {
        debug_assert!(
            self.magic == MAGIC_VALID,
            "ref/deref on a destroyed refcount"
        );
    }

    fn deinit(&mut self) {
        self.assert_valid();
        self.magic = 0;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

bun_core::declare_scope!(ref_count, hidden);

// ──────────────────────────────────────────────────────────────────────────
// Tests
//
// Run under Miri (`bun run rust:miri -p bun_ptr`): every path here walks raw
// pointers through `Box::into_raw` / `heap::take`, so Tree Borrows is what
// proves the ref/deref/destructor handoff does not alias or use-after-free.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::AtomicUsize;
    use std::sync::{Mutex, MutexGuard, PoisonError};

    static DROPS: AtomicUsize = AtomicUsize::new(0);

    /// `DROPS` is process-wide but libtest runs `#[test]`s on parallel threads,
    /// so every test asserting on it holds this for its duration.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn drops() -> usize {
        DROPS.load(Ordering::SeqCst)
    }

    // ── RefCount (single-threaded) ────────────────────────────────────────

    struct Thing {
        ref_count: RefCount<Thing>,
        payload: Box<u32>,
    }

    impl Thing {
        fn new(payload: u32) -> *mut Thing {
            bun_core::heap::into_raw(Box::new(Thing {
                ref_count: RefCount::init(),
                payload: Box::new(payload),
            }))
        }
    }

    impl Drop for Thing {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl RefCounted for Thing {
        unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
            // SAFETY: caller contract — `this` is in-bounds of a `Thing`
            // allocation. Pure field projection, no read.
            unsafe { &raw mut (*this).ref_count }
        }
        unsafe fn destructor(this: *mut Self) {
            // SAFETY: caller contract — refcount hit zero, sole owner.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    #[test]
    fn ref_count_ref_deref_destroys_at_zero() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(7);
        // SAFETY: `t` is live with one ref.
        unsafe {
            RefCount::<Thing>::ref_(t);
            assert_eq!((*RefCounted::get_ref_count(t)).get(), 2);
            RefCount::<Thing>::deref(t);
            assert!((*RefCounted::get_ref_count(t)).has_one_ref());
            assert_eq!(*(*t).payload, 7);
            // Last ref: runs `destructor`, freeing the allocation.
            RefCount::<Thing>::deref(t);
        }
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_count_init_exact_refs() {
        let _serial = serial();
        let before = drops();
        let t = bun_core::heap::into_raw(Box::new(Thing {
            ref_count: RefCount::init_exact_refs(3),
            payload: Box::new(1),
        }));
        // SAFETY: `t` is live with three refs; exactly three derefs destroy it.
        unsafe {
            RefCount::<Thing>::deref(t);
            RefCount::<Thing>::deref(t);
            assert_eq!(drops(), before);
            RefCount::<Thing>::deref(t);
        }
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_round_trip() {
        let _serial = serial();
        let before = drops();
        let p = RefPtr::new(Thing {
            ref_count: RefCount::init(),
            payload: Box::new(42),
        });
        assert_eq!(*p.payload, 42);

        let q = p.clone();
        let r = p.clone();
        assert_eq!(p.as_ptr(), q.as_ptr());
        assert_eq!(p.as_ptr(), r.as_ptr());
        drop(r);
        drop(q);
        assert_eq!(drops(), before);

        // `into_raw` hands the ref off without decrementing; `from_raw` takes it back.
        let raw = p.into_raw();
        // SAFETY: `raw` still owns the ref `p` gave up.
        let p = unsafe { RefPtr::from_raw(raw) };
        assert_eq!(*p.payload, 42);
        drop(p);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_init_ref_releases_on_drop() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(3);
        {
            // SAFETY: `t` is live; the guard's ref keeps it alive for the scope.
            let _guard = unsafe { RefPtr::init_ref(t) };
            // SAFETY: two refs outstanding.
            assert_eq!(unsafe { (*RefCounted::get_ref_count(t)).get() }, 2);
        }
        // SAFETY: the original ref is still outstanding.
        assert!(unsafe { (*RefCounted::get_ref_count(t)).has_one_ref() });
        // SAFETY: releasing the last ref.
        unsafe { RefCount::<Thing>::deref(t) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_from_raw_consumes_caller_ref() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(3);
        // SAFETY: `t` is live and we own the one ref the RefPtr will consume.
        drop(unsafe { RefPtr::from_raw(t) });
        assert_eq!(drops(), before + 1);
    }

    // ── ThreadSafeRefCount (atomic, cross-thread) ─────────────────────────

    #[derive(crate::ThreadSafeRefCounted)]
    struct Shared {
        ref_count: ThreadSafeRefCount<Shared>,
        payload: Box<u32>,
    }

    impl Drop for Shared {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    // SAFETY: the count is atomic and `payload` is only ever read, so `&Shared`
    // may be used from any thread and the last thread out may run the
    // destructor. This is what makes `RefPtr<Shared>: Send + Sync`.
    unsafe impl Send for Shared {}
    // SAFETY: as above.
    unsafe impl Sync for Shared {}

    /// `*mut Shared` is not `Send`; the refcount is what makes sharing it sound.
    #[derive(Clone, Copy)]
    struct SendPtr(*mut Shared);
    // SAFETY: `Shared`'s payload is only read across threads, and every thread
    // holds its own ref for the duration (taken before spawn).
    unsafe impl Send for SendPtr {}

    #[test]
    fn thread_safe_ref_count_cross_thread_destroy() {
        let _serial = serial();
        let before = drops();
        let s = bun_core::heap::into_raw(Box::new(Shared {
            ref_count: ThreadSafeRefCount::init(),
            payload: Box::new(5),
        }));

        const N: usize = 4;
        let mut handles = Vec::with_capacity(N);
        for _ in 0..N {
            // SAFETY: `s` is live and we hold a ref while handing one out.
            unsafe { ThreadSafeRefCount::<Shared>::ref_(s) };
            let p = SendPtr(s);
            handles.push(std::thread::spawn(move || {
                let p = p;
                // SAFETY: this thread owns one ref, so `*p.0` is live.
                unsafe {
                    assert_eq!(*(*p.0).payload, 5);
                    ThreadSafeRefCount::<Shared>::deref(p.0);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(drops(), before);
        // SAFETY: the initial ref; last one out runs `destructor`.
        unsafe { ThreadSafeRefCount::<Shared>::deref(s) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_clones_cross_threads_and_the_last_one_destroys() {
        let _serial = serial();
        let before = drops();
        let main_ref = RefPtr::new(Shared {
            ref_count: ThreadSafeRefCount::init(),
            payload: Box::new(5),
        });

        // Clone through a shared `&RefPtr` on other threads (`Sync`), hand back (`Send`).
        let clones: Vec<RefPtr<Shared>> = std::thread::scope(|scope| {
            let shared = &main_ref;
            let workers: Vec<_> = (0..4)
                .map(|_| scope.spawn(move || shared.clone()))
                .collect();
            workers.into_iter().map(|w| w.join().unwrap()).collect()
        });
        assert_eq!(main_ref.ref_count.get(), 5);
        assert_eq!(drops(), before);

        // Release all five refs on concurrent threads: only the count orders the destructor.
        let workers: Vec<_> = clones
            .into_iter()
            .chain(core::iter::once(main_ref))
            .map(|theirs| std::thread::spawn(move || *theirs.payload))
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap(), 5);
        }
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn thread_safe_release_defers_destruction() {
        let _serial = serial();
        let before = drops();
        let s = bun_core::heap::into_raw(Box::new(Shared {
            ref_count: ThreadSafeRefCount::init_exact_refs(2),
            payload: Box::new(8),
        }));
        // SAFETY: `s` is live with two refs.
        unsafe {
            assert!(!ThreadSafeRefCount::<Shared>::release(s));
            assert_eq!(drops(), before);
            // 1 → 0: `release` reports sole ownership but runs no destructor.
            assert!(ThreadSafeRefCount::<Shared>::release(s));
            assert_eq!(drops(), before);
            drop(bun_core::heap::take(s));
        }
        assert_eq!(drops(), before + 1);
    }

    // ── CellRefCounted ────────────────────────────────────────────────────

    struct Light {
        ref_count: Cell<u32>,
        payload: Box<u32>,
    }

    impl Drop for Light {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    // SAFETY: every `*mut Light` reaching `deref` came from `Box::into_raw`,
    // which the default `destroy` reclaims.
    unsafe impl CellRefCounted for Light {
        fn ref_count(&self) -> &Cell<u32> {
            &self.ref_count
        }
        unsafe fn ref_count_raw<'a>(this: *const Self) -> &'a Cell<u32> {
            // SAFETY: caller contract — `this` is live. Field projection only;
            // no whole-struct `&Self` is formed.
            unsafe { &*(&raw const (*this).ref_count) }
        }
    }

    #[test]
    fn cell_ref_counted_destroys_at_zero() {
        let _serial = serial();
        let before = drops();
        let l = bun_core::heap::into_raw(Box::new(Light {
            ref_count: Cell::new(1),
            payload: Box::new(11),
        }));
        // SAFETY: `l` is live.
        unsafe {
            (*l).ref_();
            assert_eq!((*l).ref_count.get(), 2);
            CellRefCounted::deref(l);
            assert_eq!(*(*l).payload, 11);
            assert_eq!(drops(), before);
            CellRefCounted::deref(l);
        }
        assert_eq!(drops(), before + 1);
    }

    // ── helpers ───────────────────────────────────────────────────────────

    #[test]
    fn type_base_name_strips_module_path() {
        assert_eq!(type_base_name("a::b::Foo"), "Foo");
        assert_eq!(type_base_name("a::b::Foo<c::Bar>"), "Foo<c::Bar>");
        assert_eq!(type_base_name("Foo"), "Foo");
    }
}
