//! Intrusive reference counting (single-threaded and thread-safe) and
//! `RefPtr<T>`, the owning handle to one such ref.

use core::cell::Cell;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::{IntrusiveField, ThreadLock};

use crate::AliasableBox;
use sealed::{Count, DebugData, Token};

// ──────────────────────────────────────────────────────────────────────────
// Host-type trait
// ──────────────────────────────────────────────────────────────────────────

/// Implemented by types that embed a [`RefCount`] or [`ThreadSafeRefCount`]
/// field. Only [`RefPtr`] changes the count.
///
/// Avoid reference counting when an object only has one owner.
///
/// ```ignore
/// #[derive(bun_ptr::RefCounted)]
/// #[ref_count(destroy = Self::deinit)] // optional, like `did_ref` and `will_release`
/// struct Thing {
///     ref_count: RefCount, // or `ThreadSafeRefCount`
///     other_field: u32,
/// }
/// ```
pub trait RefCounted: IntrusiveField<Self::Count> {
    type Count: Count;

    /// Called after the count was incremented for `this`.
    #[inline]
    fn did_ref(_this: &RefPtr<Self>) {}

    /// Called before the count is decremented for `this`, and by every [`RefPtr::release_unless_last`].
    #[inline]
    fn will_release(_this: &RefPtr<Self>) {}

    /// Called when the last ref was released. The count is 1 again, so `RefPtr::from(last)` can take a ref.
    #[inline]
    fn destroy(last: AliasableBox<Self>) {
        drop(last);
    }
}

mod sealed {
    #[cfg(debug_assertions)]
    use core::sync::atomic::{AtomicU32, Ordering};

    /// Keeps other modules from calling the methods of `T::Count`, which resolve without importing [`Count`].
    pub struct Token;

    pub trait Count {
        fn get(&self) -> u32;
        fn increment(&self, _: Token);
        /// Returns whether the count reached 0.
        fn decrement(&self, _: Token) -> bool;
        /// Returns whether the count was decremented.
        fn decrement_unless_one(&self, _: Token) -> bool;
        /// Sets the count to 1.
        fn reset(&self, _: Token);
        fn debug(&self) -> &DebugData;
    }

    #[cfg(debug_assertions)]
    const MAGIC_VALID: u32 = 0x2f84_e51d;

    /// Debug-only liveness canary embedded in `RefCount`/`ThreadSafeRefCount`:
    /// poisoned when the destructor runs, so a ref/deref through a dangling
    /// pointer asserts instead of silently corrupting the count.
    pub struct DebugData {
        #[cfg(debug_assertions)]
        magic: AtomicU32,
    }

    impl DebugData {
        #[inline]
        pub(super) const fn empty() -> Self {
            Self {
                #[cfg(debug_assertions)]
                magic: AtomicU32::new(MAGIC_VALID),
            }
        }

        #[inline]
        pub(super) fn assert_valid(&self) {
            #[cfg(debug_assertions)]
            assert!(
                self.magic.load(Ordering::Relaxed) == MAGIC_VALID,
                "ref/deref on a destroyed refcount"
            );
        }

        #[inline]
        pub(super) fn init(&self) {
            #[cfg(debug_assertions)]
            self.magic.store(MAGIC_VALID, Ordering::Relaxed);
        }

        #[inline]
        pub(super) fn deinit(&self) {
            #[cfg(debug_assertions)]
            self.magic.store(0, Ordering::Relaxed);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RefCount (single-threaded, intrusive)
// ──────────────────────────────────────────────────────────────────────────

/// The count of a [`RefCounted`] type whose refs all live on one thread.
pub struct RefCount {
    raw_count: Cell<u32>,
    thread: ThreadLock,
    debug: DebugData,
}

impl RefCount {
    #[inline]
    pub const fn init() -> Self {
        Self {
            raw_count: Cell::new(1),
            thread: ThreadLock::init_unlocked(),
            debug: DebugData::empty(),
        }
    }

    #[inline]
    pub fn has_one_ref(&self) -> bool {
        self.thread.lock_or_assert();
        self.get() == 1
    }

    #[inline]
    pub fn get(&self) -> u32 {
        self.raw_count.get()
    }
}

impl Count for RefCount {
    #[inline]
    fn get(&self) -> u32 {
        self.get()
    }

    #[inline]
    fn increment(&self, _: Token) {
        self.thread.lock_or_assert();
        let count = self.raw_count.get().wrapping_add(1);
        self.raw_count.set(count);
        if count == 0 {
            core::process::abort_immediate();
        }
    }

    #[inline]
    fn decrement(&self, _: Token) -> bool {
        self.thread.lock_or_assert();
        let count = self.raw_count.get() - 1;
        self.raw_count.set(count);
        count == 0
    }

    #[inline]
    fn decrement_unless_one(&self, token: Token) -> bool {
        if self.has_one_ref() {
            return false;
        }
        self.decrement(token);
        true
    }

    #[inline]
    fn reset(&self, _: Token) {
        self.raw_count.set(1);
    }

    #[inline]
    fn debug(&self) -> &DebugData {
        &self.debug
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeRefCount (atomic, intrusive)
// ──────────────────────────────────────────────────────────────────────────

/// The count of a [`RefCounted`] type whose refs cross threads.
///
/// Avoid thread-safe reference counting when only one thread allocates and frees.
pub struct ThreadSafeRefCount {
    raw_count: AtomicU32,
    debug: DebugData,
}

impl ThreadSafeRefCount {
    #[inline]
    pub const fn init() -> Self {
        Self {
            raw_count: AtomicU32::new(1),
            debug: DebugData::empty(),
        }
    }

    #[inline]
    pub fn has_one_ref(&self) -> bool {
        self.debug.assert_valid();
        self.get() == 1
    }

    #[inline]
    pub fn get(&self) -> u32 {
        self.raw_count.load(Ordering::SeqCst)
    }
}

impl Count for ThreadSafeRefCount {
    #[inline]
    fn get(&self) -> u32 {
        self.get()
    }

    #[inline]
    fn increment(&self, _: Token) {
        let old_count = self.raw_count.fetch_add(1, Ordering::SeqCst);
        debug_assert!(old_count > 0);
        // As in `Arc::clone`: other threads can increment before this one aborts.
        if old_count > i32::MAX as u32 {
            core::process::abort_immediate();
        }
    }

    #[inline]
    fn decrement(&self, _: Token) -> bool {
        let old_count = self.raw_count.fetch_sub(1, Ordering::SeqCst);
        debug_assert!(old_count > 0);
        old_count == 1
    }

    #[inline]
    fn decrement_unless_one(&self, _: Token) -> bool {
        self.raw_count
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                (count != 1).then(|| count - 1)
            })
            .is_ok()
    }

    #[inline]
    fn reset(&self, _: Token) {
        // Relaxed: no other thread holds a ref.
        self.raw_count.store(1, Ordering::Relaxed);
    }

    #[inline]
    fn debug(&self) -> &DebugData {
        &self.debug
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RefPtr
// ──────────────────────────────────────────────────────────────────────────

/// An owned strong reference to a [`RefCounted`] `T`.
///
/// Holding a `RefPtr` *is* holding one ref: `Drop` releases it (destroying `T`
/// if it was the last), `Clone` takes another. To hand the ref to a raw-pointer
/// consumer (a JS wrapper, a uws/libuv userdata slot) use
/// [`into_raw`](Self::into_raw) and reclaim it later with
/// [`from_raw`](Self::from_raw).
#[must_use = "dropping a RefPtr releases its ref"]
#[repr(transparent)]
pub struct RefPtr<T: RefCounted>(NonNull<T>);

impl<T: RefCounted> Drop for RefPtr<T> {
    #[inline]
    fn drop(&mut self) {
        if self.begin_release().decrement(Token) {
            // SAFETY: the count reached 0.
            unsafe { Self::drop_slow(self.0) };
        }
    }
}

// Like `Arc<T>`: sending or sharing a `RefPtr` sends/shares `&T` and may run
// `T`'s destructor on another thread.
// SAFETY: see above; the host is `Send + Sync`, with an atomic count.
unsafe impl<T: RefCounted<Count = ThreadSafeRefCount> + Send + Sync> Send for RefPtr<T> {}
// SAFETY: see above.
unsafe impl<T: RefCounted<Count = ThreadSafeRefCount> + Send + Sync> Sync for RefPtr<T> {}

impl<T: RefCounted> RefPtr<T> {
    /// Does not form a `&T`: a caller can hold a `&mut` to another field.
    #[inline]
    fn count(&self) -> &T::Count {
        const {
            assert!(align_of::<T>() >= align_of::<T::Count>());
            assert!(T::OFFSET % align_of::<T::Count>() == 0);
        }
        // SAFETY: we own a ref, so the pointee is live.
        unsafe { &*T::field_of(self.as_ptr()) }
    }

    #[inline]
    fn begin_release(&self) -> &T::Count {
        T::will_release(self);
        let count = self.count();
        count.debug().assert_valid(); // Likely double deref.
        bun_core::scoped_log!(
            ref_count,
            "0x{:x} deref {} -> {}",
            self.0.addr(),
            count.get(),
            count.get() - 1,
        );
        count
    }

    /// Not inlined, as `Rc::drop_slow`.
    ///
    /// # Safety
    /// The last ref on `last` was just released.
    #[inline(never)]
    unsafe fn drop_slow(last: NonNull<T>) {
        let this = ManuallyDrop::new(Self(last));
        this.count().reset(Token);
        this.count().debug().deinit();
        // SAFETY: no ref is left, and `last` is a `Box` allocation or a pool slot, see `from_raw`.
        T::destroy(unsafe { AliasableBox::from_non_null(last) });
    }

    /// Allocate `value` on the heap and own its initial ref (its embedded count
    /// starts at 1).
    #[inline]
    pub fn new(value: T) -> Self {
        let this = Self(bun_core::heap::alloc_nn(value));
        debug_assert!(Self::has_one_ref(&this));
        this
    }

    /// Take a new ref on `*raw_ptr`.
    ///
    /// # Safety
    /// `raw_ptr` must be the pointer of a ref that is still held, see [`from_raw`](Self::from_raw).
    #[inline]
    pub unsafe fn init_ref(raw_ptr: *mut T) -> Self {
        // SAFETY: caller contract
        let this = unsafe { Self::from_raw(raw_ptr) };
        let count = this.count();
        count.increment(Token);
        bun_core::scoped_log!(
            ref_count,
            "0x{:x}   ref {} -> {}",
            this.0.addr(),
            count.get() - 1,
            count.get(),
        );
        T::did_ref(&this);
        this
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
    /// The caller must own one ref on a live `T`. `raw_ptr` is the pointer of
    /// its `Box` allocation (a new one counts as one ref), or of a pool slot
    /// that [`RefCounted::destroy`] returns without dropping the box it is given.
    #[inline]
    pub unsafe fn from_raw(raw_ptr: *mut T) -> Self {
        // SAFETY: caller contract
        let this = Self(unsafe { NonNull::new_unchecked(raw_ptr) });
        this.count().debug().assert_valid();
        this
    }

    /// As `Rc::increment_strong_count`.
    ///
    /// # Safety
    /// As [`init_ref`](Self::init_ref).
    #[inline]
    pub unsafe fn increment_strong_count(raw_ptr: *mut T) {
        // SAFETY: caller contract
        unsafe { Self::init_ref(raw_ptr) }.into_raw();
    }

    /// As `Rc::decrement_strong_count`.
    ///
    /// # Safety
    /// As [`from_raw`](Self::from_raw).
    #[inline]
    pub unsafe fn decrement_strong_count(raw_ptr: *mut T) {
        // SAFETY: caller contract
        drop(unsafe { Self::from_raw(raw_ptr) });
    }

    /// Release this ref, or return it if it is the last one, so that the caller
    /// can drop it later or on another thread.
    #[inline]
    #[must_use = "dropping the last ref destroys `T` on this thread"]
    pub fn release_unless_last(self) -> Option<Self> {
        let this = ManuallyDrop::new(self);
        let released = this.begin_release().decrement_unless_one(Token);
        (!released).then(|| ManuallyDrop::into_inner(this))
    }

    /// An associated function, as `Rc::strong_count`.
    #[inline]
    pub fn has_one_ref(this: &Self) -> bool {
        this.count().get() == 1
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
        ManuallyDrop::new(self).0
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

/// As [`RefPtr::new`]. For the box passed to [`RefCounted::destroy`], `destroy` is called again later.
impl<T: RefCounted> From<AliasableBox<T>> for RefPtr<T> {
    #[inline]
    fn from(owned: AliasableBox<T>) -> Self {
        let this = Self(owned.into_non_null());
        debug_assert!(Self::has_one_ref(&this));
        this.count().debug().init();
        this
    }
}

impl<T: RefCounted> Clone for RefPtr<T> {
    /// Takes another ref on the same allocation.
    #[inline]
    fn clone(&self) -> Self {
        // SAFETY: we own a ref, so the pointee is live.
        unsafe { Self::init_ref(self.0.as_ptr()) }
    }
}

impl<T: RefCounted> core::ops::Deref for RefPtr<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: we own a ref, so the pointee is live for the borrow.
        // Single-threaded hosts are !Send/!Sync so no concurrent mutation;
        // thread-safe hosts coordinate their own interior mutability.
        unsafe { self.0.as_ref() }
    }
}

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
    use core::cell::RefCell;
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

    #[derive(crate::RefCounted)]
    struct Thing {
        payload: Box<u32>,
        ref_count: RefCount,
    }

    impl Thing {
        fn new(payload: u32) -> RefPtr<Thing> {
            RefPtr::new(Thing {
                payload: Box::new(payload),
                ref_count: RefCount::init(),
            })
        }
    }

    impl Drop for Thing {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn ref_ptr_round_trip() {
        let _serial = serial();
        let before = drops();
        let p = Thing::new(42);
        assert_eq!(*p.payload, 42);
        assert!(p.ref_count.has_one_ref());

        let q = p.clone();
        let r = p.clone();
        assert_eq!(p.ref_count.get(), 3);
        assert_eq!(p.as_ptr(), q.as_ptr());
        assert_eq!(p.as_ptr(), r.as_ptr());
        drop(r);
        assert!(!RefPtr::has_one_ref(&p));
        drop(q);
        assert!(RefPtr::has_one_ref(&p));
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
        // SAFETY: `t` holds a ref.
        let guard = unsafe { RefPtr::init_ref(t.as_ptr()) };
        assert_eq!(t.ref_count.get(), 2);
        drop(t);
        assert_eq!(*guard.payload, 3);
        assert_eq!(drops(), before);
        drop(guard);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_from_raw_consumes_caller_ref() {
        let _serial = serial();
        let before = drops();
        let t = bun_core::heap::into_raw(Box::new(Thing {
            payload: Box::new(3),
            ref_count: RefCount::init(),
        }));
        // SAFETY: `t` is a new `Box` allocation, whose count is 1.
        drop(unsafe { RefPtr::from_raw(t) });
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn increment_and_decrement_strong_count() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(3);
        let raw = t.as_ptr();
        // SAFETY: `t` holds a ref.
        unsafe { RefPtr::increment_strong_count(raw) };
        assert_eq!(t.ref_count.get(), 2);
        drop(t);
        assert_eq!(drops(), before);
        // SAFETY: the ref taken above.
        unsafe { RefPtr::decrement_strong_count(raw) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_clone_keeps_mut_borrow_of_other_field_valid() {
        let _serial = serial();
        let t = Thing::new(1);
        // SAFETY: nothing else accesses `payload` until the last use of this borrow.
        let payload = unsafe { &mut (*t.as_ptr()).payload };
        *payload = Box::new(2);
        drop(t.clone());
        *payload = Box::new(3);
        assert_eq!(*t.payload, 3);
    }

    #[test]
    fn release_unless_last_returns_only_last_ref() {
        let _serial = serial();
        let before = drops();
        let a = Thing::new(8);
        let b = a.clone();
        assert!(a.release_unless_last().is_none());
        let last = b.release_unless_last().expect("the last ref");
        assert_eq!(drops(), before);

        drop(last.clone());
        assert_eq!(*last.payload, 8);
        drop(last);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_count_is_one_in_destroy() {
        #[derive(crate::RefCounted)]
        #[ref_count(destroy = Self::record_count)]
        struct Host<C: Count> {
            ref_count: C,
        }
        thread_local! {
            static COUNTS: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
        }
        impl<C: Count> Host<C> {
            fn record_count(last: AliasableBox<Self>) {
                COUNTS.with_borrow_mut(|counts| counts.push(last.ref_count.get()));
            }
        }
        drop(RefPtr::new(Host {
            ref_count: RefCount::init(),
        }));
        drop(RefPtr::new(Host {
            ref_count: ThreadSafeRefCount::init(),
        }));
        assert_eq!(COUNTS.take(), [1, 1]);
    }

    // ── hooks ─────────────────────────────────────────────────────────────

    #[derive(crate::RefCounted)]
    #[ref_count(did_ref = Self::did_ref, will_release = Self::will_release, destroy = Self::destroy)]
    struct WithHooks {
        ref_count: RefCount,
        calls: RefCell<Vec<(&'static str, u32)>>,
        clone_in_will_release: Cell<bool>,
    }

    thread_local! {
        static CLONED: Cell<Option<RefPtr<WithHooks>>> = const { Cell::new(None) };
        static DESTROYED: Cell<Option<AliasableBox<WithHooks>>> = const { Cell::new(None) };
    }

    impl WithHooks {
        fn new(clone_in_will_release: bool) -> RefPtr<WithHooks> {
            RefPtr::new(WithHooks {
                ref_count: RefCount::init(),
                calls: RefCell::default(),
                clone_in_will_release: Cell::new(clone_in_will_release),
            })
        }

        fn did_ref(this: &RefPtr<Self>) {
            this.calls
                .borrow_mut()
                .push(("did_ref", this.ref_count.get()));
        }

        fn will_release(this: &RefPtr<Self>) {
            this.calls
                .borrow_mut()
                .push(("will_release", this.ref_count.get()));
            if this.clone_in_will_release.take() {
                CLONED.set(Some(this.clone()));
            }
        }

        fn destroy(last: AliasableBox<Self>) {
            DESTROYED.set(Some(last));
        }
    }

    #[test]
    fn did_ref_and_will_release_see_count_that_includes_ref() {
        let a = WithHooks::new(false);
        drop(a.clone());
        assert!(DESTROYED.take().is_none());
        drop(a);
        let last = DESTROYED.take().expect("destroyed");
        assert_eq!(
            last.calls.take(),
            [("did_ref", 2), ("will_release", 2), ("will_release", 1)]
        );
    }

    #[test]
    fn clone_in_will_release_prevents_destroy() {
        drop(WithHooks::new(true));
        assert!(DESTROYED.take().is_none());
        let cloned = CLONED.take().expect("cloned");
        assert!(cloned.ref_count.has_one_ref());
        drop(cloned);
        let last = DESTROYED.take().expect("destroyed");
        assert_eq!(
            last.calls.take(),
            [("will_release", 1), ("did_ref", 2), ("will_release", 1)]
        );
    }

    #[test]
    fn ref_ptr_from_destroyed_box_calls_destroy_again() {
        drop(WithHooks::new(false));
        let a = RefPtr::from(DESTROYED.take().expect("destroyed"));
        drop(a.clone());
        assert!(DESTROYED.take().is_none());
        drop(a);
        assert!(DESTROYED.take().is_some());
    }

    // ── ThreadSafeRefCount (atomic, cross-thread) ─────────────────────────

    #[derive(crate::RefCounted)]
    struct Shared {
        ref_count: ThreadSafeRefCount,
        payload: Box<u32>,
    }

    impl Shared {
        fn new(payload: u32) -> RefPtr<Shared> {
            RefPtr::new(Shared {
                ref_count: ThreadSafeRefCount::init(),
                payload: Box::new(payload),
            })
        }
    }

    impl Drop for Shared {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn thread_safe_ref_count_cross_thread_destroy() {
        let _serial = serial();
        let before = drops();
        let s = Shared::new(5);
        let handles = [s.clone(), s.clone(), s.clone(), s]
            .map(|s| std::thread::spawn(move || assert_eq!(*s.clone().payload, 5)));
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn thread_safe_release_unless_last_returns_one_ref() {
        let _serial = serial();
        let before = drops();
        let s = Shared::new(8);
        let handles = [s.clone(), s.clone(), s.clone(), s]
            .map(|s| std::thread::spawn(|| s.release_unless_last()));
        let last: Vec<_> = handles
            .into_iter()
            .filter_map(|h| h.join().unwrap())
            .collect();
        assert_eq!(last.len(), 1);
        assert_eq!(*last[0].payload, 8);
        assert_eq!(drops(), before);
        drop(last);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn thread_safe_init_ref_races_with_release_unless_last() {
        let _serial = serial();
        let before = drops();
        for _ in 0..50 {
            let s = Shared::new(9);
            let raw = s.as_ptr();
            let handle = std::thread::spawn(|| s.release_unless_last());
            let mut mine = None;
            while mine.is_none() && !handle.is_finished() {
                // SAFETY: the ref of `s` is held. If `handle` released it, `mine` is `Some` and the loop has ended.
                mine = unsafe { RefPtr::init_ref(raw) }.release_unless_last();
            }
            let theirs = handle.join().unwrap();
            assert_ne!(mine.is_some(), theirs.is_some());
        }
        assert_eq!(drops(), before + 50);
    }
}
