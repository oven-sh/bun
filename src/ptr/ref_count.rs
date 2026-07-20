//! Intrusive reference counting (single-threaded and thread-safe) + `RefPtr<T>`
//! debug-tracking wrapper.
//!
//! Each ref-count mixin is a pair of (embedded struct + trait the host
//! type implements). See `RefCounted` / `ThreadSafeRefCounted`.

use core::cell::Cell;
#[cfg(debug_assertions)]
use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::StoredTrace;
use bun_core::ThreadLock;

// was `bun_collections::{ArrayHashMap, HashMap}` (T1 → upward).
// Debug-only diagnostic storage; std HashMap drops insertion order for `frees`
// which is acceptable for leak reports.
#[cfg(debug_assertions)]
use std::collections::HashMap;
#[cfg(debug_assertions)]
type ArrayHashMap<K, V> = HashMap<K, V>;

// ──────────────────────────────────────────────────────────────────────────
// Debug stack dump — calls straight into bun_core (T0 owns the std::backtrace
// fallback). Crash-report symbolication lives in bun_crash_handler and is
// invoked from there directly when needed.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
fn dump_stack_hook(trace: Option<&StoredTrace>, ret_addr: usize) {
    match trace {
        None => bun_core::dump_current_stack_trace(
            if ret_addr == 0 { None } else { Some(ret_addr) },
            bun_core::DumpStackTraceOptions::default(),
        ),
        Some(stored) => {
            bun_core::dump_stack_trace(&stored.trace(), bun_core::DumpStackTraceOptions::default())
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────

/// Options for `RefCount` / `ThreadSafeRefCount`.
///
/// The destructor-context knob is the associated type
/// `RefCounted::DestructorCtx`, not a field here.
#[derive(Default)]
pub struct Options {
    /// Defaults to the type basename.
    pub debug_name: Option<&'static str>,
    // destructor_ctx: see RefCounted::DestructorCtx
}

// ──────────────────────────────────────────────────────────────────────────
// Host-type traits (field projection + destructor)
// ──────────────────────────────────────────────────────────────────────────

/// `bun.meta.typeBaseName` — strip the module path (and the path inside any
/// leading generic segment) from a `core::any::type_name` string, returning a
/// subslice so the result stays `&'static str`.
/// `"a::b::Foo<c::Bar>"` → `"Foo<c::Bar>"`.
fn type_base_name(name: &'static str) -> &'static str {
    let end = name.find('<').unwrap_or(name.len());
    match name[..end].rfind("::") {
        Some(i) => &name[i + 2..],
        None => name,
    }
}

/// Implemented by types that embed a [`RefCount`] field.
pub trait RefCounted: Sized {
    type DestructorCtx;

    /// Defaults to the type basename.
    fn debug_name() -> &'static str {
        type_base_name(core::any::type_name::<Self>())
    }

    /// Locate the embedded `RefCount` field.
    ///
    /// # Safety
    /// `this` must be non-null, properly aligned, and in-bounds of an
    /// allocation large enough for `Self` — but it may point to
    /// **uninitialized** memory: `offset_of_ref_count` probes this method
    /// with a `MaybeUninit<Self>` to recover the field offset.
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
    unsafe fn destructor(this: *mut Self, ctx: Self::DestructorCtx);
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
    /// **uninitialized** memory: `offset_of_ref_count_ts` probes this
    /// method with a `MaybeUninit<Self>` to recover the field offset.
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
    type DestructorCtx;

    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_ref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_deref_with_context(this: *mut Self, ctx: Self::DestructorCtx);
    /// Forwards `Default::default()` as the ctx. Types with a non-unit
    /// `DestructorCtx` must call `rc_deref_with_context` explicitly.
    ///
    /// # Safety
    /// `this` must point to a live `Self`.
    #[inline]
    unsafe fn rc_deref(this: *mut Self)
    where
        Self::DestructorCtx: Default,
    {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { Self::rc_deref_with_context(this, Default::default()) }
    }
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_has_one_ref(this: *const Self) -> bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_assert_no_refs(this: *const Self);

    #[cfg(debug_assertions)]
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_debug_data(this: *mut Self) -> *mut dyn DebugDataOps;
}

// ──────────────────────────────────────────────────────────────────────────
// JS-wrapper finalize → intrusive-refcount release
// ──────────────────────────────────────────────────────────────────────────

/// Release the JS wrapper's `+1` on an intrusive-refcounted `m_ctx` payload.
///
/// `.classes.ts` codegen hands `finalize` the payload as `Box<Self>`; the
/// allocation may outlive that `Box` if other refs remain, so this leaks the
/// `Box` back to a raw pointer FIRST (a panic in `before` then leaks instead of
/// double-freeing siblings), runs `before` against a *shared* borrow, then
/// drops one ref.
///
/// `before` deliberately receives `&T`, never `&mut T`: concurrent `&T` aliases
/// may exist (e.g. work-pool threads, uws callbacks) while the GC sweeps, so
/// forming `&mut T` here would be UB. All teardown therefore goes through
/// `Cell`/`JsCell`/atomic fields.
#[inline]
pub fn finalize_js_box<T, F>(boxed: Box<T>, before: F)
where
    T: AnyRefCounted,
    T::DestructorCtx: Default,
    F: FnOnce(&T),
{
    let ptr: *mut T = Box::into_raw(boxed);
    // SAFETY: `ptr` was just leaked from `Box`; ref_count >= 1 (the JS
    // wrapper's +1). No `&mut T` is formed — `before` sees only `&T`.
    before(unsafe { &*ptr });
    // SAFETY: `ptr` is still live (the +1 has not yet been released).
    unsafe { T::rc_deref(ptr) };
}

/// [`finalize_js_box`] with no pre-release work — just hands ownership back to
/// the intrusive refcount and drops the JS wrapper's `+1`.
#[inline]
pub fn finalize_js_box_noop<T>(boxed: Box<T>)
where
    T: AnyRefCounted,
    T::DestructorCtx: Default,
{
    let ptr: *mut T = Box::into_raw(boxed);
    // SAFETY: `ptr` was just leaked from `Box`; ref_count >= 1.
    unsafe { T::rc_deref(ptr) };
}

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
///     type DestructorCtx = ();
///     unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
///         unsafe { &raw mut (*this).ref_count }
///     }
///     unsafe fn destructor(this: *mut Self, _: ()) {
///         println!("deinit {}", unsafe { (*this).other_field });
///         drop(unsafe { heap::take(this) });
///     }
/// }
/// ```
///
/// When `RefCount` is implemented, it can be used with `RefPtr<T>` to track
/// where a reference leak may be happening.
pub struct RefCount<T: RefCounted> {
    raw_count: Cell<u32>,
    thread: ThreadLock,
    #[cfg(debug_assertions)]
    debug: DebugData<Cell<u32>>,
    _phantom: PhantomData<*const T>,
}

const DEBUG_STACK_TRACE: bool = false;

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
        #[cfg(debug_assertions)]
        {
            count.debug.assert_valid();
        }
        // `bun_core::scoped_log!` requires a static scope ident, so all types
        // share the single `ref_count` scope.
        bun_core::scoped_log!(
            ref_count,
            "0x{:x}   ref {} -> {}:",
            self_ as usize,
            count.raw_count.get(),
            count.raw_count.get() + 1,
        );
        if DEBUG_STACK_TRACE {
            dump_stack_hook(None, return_address());
        }
        count.assert_single_threaded();
        count.raw_count.set(count.raw_count.get() + 1);
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn deref(self_: *mut T)
    where
        T: RefCounted<DestructorCtx = ()>,
    {
        // SAFETY: caller contract
        unsafe { Self::deref_with_context(self_, ()) }
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn deref_with_context(self_: *mut T, ctx: T::DestructorCtx) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        #[cfg(debug_assertions)]
        {
            count.debug.assert_valid(); // Likely double deref.
        }
        bun_core::scoped_log!(
            ref_count,
            "0x{:x} deref {} -> {}:",
            self_ as usize,
            count.raw_count.get(),
            count.raw_count.get() - 1,
        );
        if DEBUG_STACK_TRACE {
            dump_stack_hook(None, return_address());
        }
        count.assert_single_threaded();
        count.raw_count.set(count.raw_count.get() - 1);
        if count.raw_count.get() == 0 {
            #[cfg(debug_assertions)]
            {
                // SAFETY: count is &*get_ref_count(self_); we need &mut for deinit
                unsafe { (*T::get_ref_count(self_)).debug.deinit(return_address()) };
            }
            // SAFETY: raw_count == 0, sole owner
            unsafe { T::destructor(self_, ctx) };
        }
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn dupe_ref(self_: *mut T) -> RefPtr<T>
    where
        T: AnyRefCounted,
    {
        // SAFETY: caller contract
        unsafe { RefPtr::init_ref(self_) }
    }

    // utility functions

    pub fn has_one_ref(&self) -> bool {
        self.assert_single_threaded();
        self.raw_count.get() == 1
    }

    pub fn get(&self) -> u32 {
        self.raw_count.get()
    }

    pub fn dump_active_refs(&mut self) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: self is the `ref_count` field of a live T
            let ptr: *mut T = unsafe {
                bun_core::container_of::<T, Self>(
                    std::ptr::from_mut(self),
                    offset_of_ref_count::<T>(),
                )
            };
            self.debug.dump(
                Some(core::any::type_name::<T>().as_bytes()),
                ptr.cast::<c_void>(),
                self.raw_count.get(),
            );
        }
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        assert!(self.raw_count.get() == 0);
    }

    /// Sets the ref count to 0 without running the destructor.
    ///
    /// Only use this if you're about to free the object (e.g., with `drop(Box)`).
    ///
    /// Don't modify the ref count or create any `RefPtr`s after calling this method.
    pub fn clear_without_destructor(&self) {
        self.assert_single_threaded();
        self.raw_count.set(0);
    }

    fn assert_single_threaded(&self) {
        self.thread.lock_or_assert();
    }

    // `getRefCount(self: *T) *@This()` is the trait method
    // `T::get_ref_count` above; not duplicated here.

    // `is_ref_count = unique_symbol` and `ref_count_options` were
    // reflection markers for `RefPtr`; replaced by the `AnyRefCounted`
    // trait bound.
}

impl<T: RefCounted> AnyRefCounted for T {
    type DestructorCtx = <T as RefCounted>::DestructorCtx;

    unsafe fn rc_ref(this: *mut Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { RefCount::<T>::ref_(this) }
    }
    unsafe fn rc_deref_with_context(this: *mut Self, ctx: Self::DestructorCtx) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { RefCount::<T>::deref_with_context(this, ctx) }
    }
    unsafe fn rc_has_one_ref(this: *const Self) -> bool {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this.cast_mut())).has_one_ref() }
    }
    unsafe fn rc_assert_no_refs(this: *const Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this.cast_mut())).assert_no_refs() }
    }
    #[cfg(debug_assertions)]
    unsafe fn rc_debug_data(this: *mut Self) -> *mut dyn DebugDataOps {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { &raw mut (*T::get_ref_count(this)).debug }
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
    debug: DebugData<AtomicU32>,
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
        #[cfg(debug_assertions)]
        count.debug.assert_valid();
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
        #[cfg(debug_assertions)]
        count.debug.assert_valid();
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
                unsafe { (*T::get_ref_count(self_)).debug.deinit(return_address()) };
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
        #[cfg(debug_assertions)]
        count.debug.assert_valid();
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
                unsafe { (*T::get_ref_count(self_)).debug.deinit(return_address()) };
            }
            true
        } else {
            false
        }
    }

    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn dupe_ref(self_: *mut T) -> RefPtr<T>
    where
        T: AnyRefCounted,
    {
        #[cfg(debug_assertions)]
        // SAFETY: caller contract — `self_` points to a live T
        unsafe {
            (*T::get_ref_count(self_)).debug.assert_valid();
        }
        // SAFETY: caller contract
        unsafe { RefPtr::init_ref(self_) }
    }

    // utility functions

    pub fn get(&self) -> u32 {
        self.raw_count.load(Ordering::SeqCst)
    }

    pub fn has_one_ref(&self) -> bool {
        #[cfg(debug_assertions)]
        self.debug.assert_valid();
        self.get() == 1
    }

    pub fn dump_active_refs(&mut self) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: self is the `ref_count` field of a live T
            let ptr: *mut T = unsafe {
                bun_core::container_of::<T, Self>(
                    std::ptr::from_mut(self),
                    offset_of_ref_count_ts::<T>(),
                )
            };
            self.debug.dump(
                Some(core::any::type_name::<T>().as_bytes()),
                ptr.cast::<c_void>(),
                self.raw_count.load(Ordering::SeqCst),
            );
        }
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        assert!(self.raw_count.load(Ordering::SeqCst) == 0);
    }

    /// Sets the ref count to 0 without running the destructor.
    ///
    /// Only use this if you're about to free the object (e.g., with `drop(Box)`).
    ///
    /// Don't modify the ref count or create any `RefPtr`s after calling this method.
    pub fn clear_without_destructor(&self) {
        // This method should only be used if you're about to free the object.
        // You shouldn't be freeing the object if other threads might be using
        // it, and no memory order can help with that, so Relaxed is sufficient.
        self.raw_count.store(0, Ordering::Relaxed);
    }

    /// Type-erased accessor for the embedded debug tracker. Exposed (rather
    /// than the private `debug` field) so `#[derive(ThreadSafeRefCounted)]`
    /// can emit [`AnyRefCounted::rc_debug_data`] from outside this crate.
    #[cfg(debug_assertions)]
    #[doc(hidden)]
    #[inline]
    pub fn debug_data_ptr(&mut self) -> *mut dyn DebugDataOps {
        &raw mut self.debug
    }

    // `getRefCount` / `is_ref_count` / `ref_count_options` — see
    // notes on RefCount above.
}

// ──────────────────────────────────────────────────────────────────────────
// CellRefCounted — lightweight intrusive refcount over a raw `Cell<u32>`
// ──────────────────────────────────────────────────────────────────────────

/// Lightweight intrusive refcount trait for types that embed a bare
/// `ref_count: Cell<u32>` field (no [`RefCount<Self>`] wrapper, no debug
/// tracking, no thread-lock).
///
/// This is the migration target for the ~30 types that previously hand-rolled
/// `ref_()`/`deref()` pairs around a `Cell<u32>`. Implementors supply only
/// [`ref_count`] and [`destroy`]; the trait provides `ref_()`/`deref()` with
/// the canonical inc/dec/destroy-at-zero logic.
///
/// Use `#[derive(CellRefCounted)]` to derive this trait together with the
/// [`AnyRefCounted`] bridge (so [`RefPtr`] / [`ScopedRef`] accept the type)
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
}

/// No-op [`DebugDataOps`] for [`CellRefCounted`] types — they carry no
/// `DebugData` field, so [`RefPtr`]'s acquire/release tracking degrades to
/// a stub.
#[cfg(debug_assertions)]
#[doc(hidden)]
pub struct NoopDebugData;

#[cfg(debug_assertions)]
impl DebugDataOps for NoopDebugData {
    fn assert_valid_dyn(&self) {}
    fn acquire(&mut self, _return_address: usize) -> TrackedRefId {
        TrackedRefId::new(0)
    }
    fn release(&mut self, _id: TrackedRefId, _return_address: usize) {}
}

#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn noop_debug_data() -> *mut dyn DebugDataOps {
    // Per-call leaked stub — `RefPtr` only calls `acquire`/`release` on it,
    // both of which are no-ops, so a shared static would also be sound; but
    // `*mut dyn` from a `static mut` is unergonomic. Debug-only.
    // SAFETY: NonNull::dangling is fine here? No — `RefPtr` derefs it.
    // Use a thread-local static to avoid per-ref allocation.
    thread_local! {
        static NOOP: core::cell::UnsafeCell<NoopDebugData> =
            const { core::cell::UnsafeCell::new(NoopDebugData) };
    }
    NOOP.with(|n| n.get() as *mut dyn DebugDataOps)
}

// A blanket `impl<T: ThreadSafeRefCounted> AnyRefCounted for T` would overlap
// with the `RefCounted` blanket above (Rust forbids overlapping blanket impls).
// Instead, thread-safe hosts opt in via `#[derive(ThreadSafeRefCounted)]`,
// which emits the per-type `AnyRefCounted` impl alongside the trait impl.

// ──────────────────────────────────────────────────────────────────────────
// RefPtr
// ──────────────────────────────────────────────────────────────────────────

/// A pointer to an object implementing `RefCount` or `ThreadSafeRefCount`.
/// The benefit of this over `*mut T` is that instances of `RefPtr` are tracked.
///
/// By using this, you gain the following memory debugging tools:
///
/// - `T.ref_count.dump_active_refs()` to dump all active references.
///
/// If you want to enforce usage of RefPtr for memory management, you
/// can remove the forwarded `ref` and `deref` methods from `RefCount`.
///
/// # ⚠️ No `Drop` impl — the owned ref must be released *manually*
///
/// `RefPtr` does **not** implement `Drop`: dropping a `RefPtr`
/// value — including `Option::take()`-then-drop, or letting a struct field
/// holding one go out of scope — **leaks** the strong ref it owns. On every
/// path that gives up a `RefPtr` you must explicitly call one of:
///
/// - [`deref`](Self::deref) / [`deref_with_context`](Self::deref_with_context)
///   — release the ref (and destroy `T` if it was the last);
/// - [`leak`](Self::leak) / [`into_raw`](Self::into_raw) — hand the ref off to
///   someone else (the inverse of [`from_raw`](Self::from_raw)).
///
/// Any new struct field of `RefPtr<T>` type must document, at the field site,
/// which of its owners' methods discharges this obligation. (Newtypes like
/// `CookieMapRef` wrap a single owned ref *and* implement `Drop` themselves —
/// `RefPtr` itself does not.)
///
/// See [`RefCount`]'s comment for examples & best practices.
pub struct RefPtr<T: AnyRefCounted> {
    pub data: NonNull<T>,
    #[cfg(debug_assertions)]
    debug: TrackedRefId,
}

impl<T: AnyRefCounted> RefPtr<T> {
    /// Increment the reference count, and return a structure boxing the pointer.
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T`.
    pub unsafe fn init_ref(raw_ptr: *mut T) -> Self {
        // SAFETY: caller contract
        unsafe { T::rc_ref(raw_ptr) };
        // SAFETY: caller contract
        unsafe { Self::unchecked_and_unsafe_init(raw_ptr, return_address()) }
    }

    // NOTE: would be nice to use a const for deref dispatch, but keep two
    // methods for clarity.

    /// Decrement the reference count, and destroy the object if the count is 0.
    pub fn deref(&self)
    where
        T::DestructorCtx: Default,
    {
        self.deref_with_context(Default::default());
    }

    /// Decrement the reference count, and destroy the object if the count is 0.
    pub fn deref_with_context(&self, ctx: T::DestructorCtx) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: data is live (we hold a ref)
            unsafe { (*T::rc_debug_data(self.as_ptr())).release(self.debug, return_address()) };
        }
        // SAFETY: data is live (we hold a ref)
        unsafe { T::rc_deref_with_context(self.as_ptr(), ctx) };
        // The handle is not poisoned after release: that would require
        // mutating through `&self` (UnsafeCell), and `&self` is load-bearing
        // here: hundreds of call sites (including Drop impls and ScopedRef)
        // deref through a borrow they cannot move out of, so a by-value
        // signature is not an option.
    }

    pub fn dupe_ref(&self) -> Self {
        // SAFETY: data is live (we hold a ref)
        unsafe { Self::init_ref(self.as_ptr()) }
    }

    /// Allocate a new object, returning a RefPtr to it.
    pub fn new(init_data: T) -> Self {
        // SAFETY: freshly boxed, ref_count == 1
        unsafe { Self::adopt_ref(bun_core::heap::into_raw(Box::new(init_data))) }
    }

    /// Initialize a newly allocated pointer, returning a RefPtr to it.
    /// Care must be taken when using non-default allocators.
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T` with exactly one ref.
    pub unsafe fn adopt_ref(raw_ptr: *mut T) -> Self {
        #[cfg(debug_assertions)]
        {
            // SAFETY: caller contract
            debug_assert!(unsafe { T::rc_has_one_ref(raw_ptr) });
            // SAFETY: caller contract
            unsafe { (*T::rc_debug_data(raw_ptr)).assert_valid_dyn() };
        }
        // SAFETY: caller contract
        unsafe { Self::unchecked_and_unsafe_init(raw_ptr, return_address()) }
    }

    /// A [`ThisPtr`](crate::ThisPtr) to the pointee, for the FFI-shaped call
    /// sites that take one.
    ///
    /// Safe: holding a `RefPtr` means we own a ref, so the pointee is live —
    /// which is exactly `ThisPtr::new`'s precondition. The returned handle is
    /// only valid while this `RefPtr` (or another ref) is alive.
    #[inline]
    pub fn this_ptr(&self) -> crate::ThisPtr<T> {
        // SAFETY: we own an outstanding ref, so `self.data` is live and non-null.
        unsafe { crate::ThisPtr::new(self.data.as_ptr()) }
    }

    /// Consume this `RefPtr` into a [`ThisPtr`](crate::ThisPtr), transferring
    /// the ref to the callee — the counterpart of `into_raw` for the
    /// `ThisPtr`-shaped dispatch entry points. Safe for the same reason
    /// `into_raw` is: no ref is released, and the pointee stays live.
    #[inline]
    pub fn into_this_ptr(self) -> crate::ThisPtr<T> {
        // SAFETY: `into_raw` transfers our live ref; the pointee is non-null.
        unsafe { crate::ThisPtr::new(self.into_raw()) }
    }

    /// Wrap a raw pointer whose ref is being transferred to this RefPtr
    /// WITHOUT incrementing the refcount. The caller gives up their ref;
    /// this RefPtr now owns it. Unlike `adopt_ref`, this does not assert
    /// `has_one_ref()` — the pointer may have other outstanding refs.
    /// This is the inverse of `leak()` / `into_raw()`.
    ///
    /// Std-conventional alias for [`take_ref`] (matches `Arc::from_raw` /
    /// `Rc::from_raw` semantics) so call sites that reach for the idiomatic
    /// Rust name compile without churn.
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T` and the caller must own one ref.
    #[inline]
    pub unsafe fn from_raw(raw_ptr: *mut T) -> Self {
        // SAFETY: forwarded caller contract
        unsafe { Self::take_ref(raw_ptr) }
    }

    /// Std-conventional alias for [`leak`]. Extract the raw pointer, giving up
    /// ownership WITHOUT decrementing the refcount. Inverse of [`from_raw`].
    #[inline]
    pub fn into_raw(self) -> *mut T {
        self.leak()
    }

    /// Borrow the inner `*mut T` without affecting the refcount (analogous to
    /// `Arc::as_ptr`). The pointer carries the original `heap::alloc`
    /// provenance, so it is sound to thread it back through APIs that may
    /// eventually `heap::take` it (e.g. allocator-vtable `free`), provided
    /// the caller still holds a ref for the duration.
    ///
    /// This is the only sanctioned way to mutate the pointee: `RefPtr` is a
    /// shared-ownership handle, so a `&mut T` accessor would alias with any
    /// other live `RefPtr`/`&T` to the same allocation. Callers that need
    /// mutation must go through this raw pointer and uphold the no-alias
    /// invariant themselves.
    #[inline]
    pub fn as_ptr(&self) -> *mut T {
        self.data.as_ptr()
    }

    /// Borrow the pointee immutably. Named accessor equivalent to
    /// `<RefPtr<T> as Deref>::deref` — provided so call sites can be explicit
    /// (the inherent `RefPtr::deref` *decrements the refcount*, so `r.deref()`
    /// is not the borrow you want).
    #[inline]
    pub fn data(&self) -> &T {
        // SAFETY: holding a `RefPtr` means we own at least one ref, so the
        // pointee is live for the borrow. Single-threaded `RefCount` hosts are
        // !Send/!Sync so no concurrent mutation; thread-safe hosts coordinate
        // their own interior mutability.
        unsafe { self.data.as_ref() }
    }

    /// Wrap a raw pointer whose ref is being transferred to this RefPtr
    /// WITHOUT incrementing the refcount. The caller gives up their ref;
    /// this RefPtr now owns it. Unlike `adopt_ref`, this does not assert
    /// `has_one_ref()` — the pointer may have other outstanding refs.
    /// This is the inverse of `leak()`.
    ///
    /// # Safety
    /// `raw_ptr` must point to a live `T` and the caller must own one ref.
    pub unsafe fn take_ref(raw_ptr: *mut T) -> Self {
        #[cfg(debug_assertions)]
        {
            // SAFETY: caller contract
            unsafe { (*T::rc_debug_data(raw_ptr)).assert_valid_dyn() };
        }
        // SAFETY: caller contract
        unsafe { Self::unchecked_and_unsafe_init(raw_ptr, return_address()) }
    }

    /// Extract the raw pointer, giving up ownership WITHOUT decrementing
    /// the refcount. The caller is responsible for the ref that this
    /// RefPtr was holding. After calling this, the RefPtr is invalid
    /// and must not be used. This is the inverse of `take_ref()`.
    pub fn leak(self) -> *mut T {
        let ptr = self.data.as_ptr();
        #[cfg(debug_assertions)]
        {
            // mark debug tracking as released without actually derefing
            // SAFETY: data is live (we hold a ref)
            unsafe { (*T::rc_debug_data(ptr)).release(self.debug, return_address()) };
        }
        // Taking `self` by value makes the RefPtr unusable afterwards.
        ptr
    }

    /// # Safety
    /// `raw_ptr` must point to a live `T` and the caller must hold/own a ref.
    pub unsafe fn unchecked_and_unsafe_init(raw_ptr: *mut T, ret_addr: usize) -> Self {
        let _ = ret_addr;
        Self {
            // SAFETY: caller contract — raw_ptr is non-null and live
            data: unsafe { NonNull::new_unchecked(raw_ptr) },
            #[cfg(debug_assertions)]
            // SAFETY: caller contract
            debug: unsafe { (*T::rc_debug_data(raw_ptr)).acquire(ret_addr) },
        }
    }
}

impl<T: AnyRefCounted> Clone for RefPtr<T> {
    /// Bumps the intrusive refcount and returns a new `RefPtr` to the same
    /// allocation. Equivalent to [`dupe_ref`](Self::dupe_ref).
    #[inline]
    fn clone(&self) -> Self {
        self.dupe_ref()
    }
}

impl<T: AnyRefCounted> core::ops::Deref for RefPtr<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.data()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ScopedRef
// ──────────────────────────────────────────────────────────────────────────

/// RAII scope guard for an intrusive refcount: bumps on construction, derefs
/// on `Drop`. Use to bracket a `ref_()`/`deref()` pair that protects `*T`
/// across a re-entrant call.
///
/// Unlike [`RefPtr`] this is not a smart-pointer handle (no `Deref`, not
/// stored in fields) — it exists solely so the paired deref runs on every
/// exit path. Requires `DestructorCtx: Default` (the common unit case).
#[must_use = "dropping immediately releases the ref"]
pub struct ScopedRef<T: AnyRefCounted>(NonNull<T>)
where
    T::DestructorCtx: Default;

impl<T: AnyRefCounted> ScopedRef<T>
where
    T::DestructorCtx: Default,
{
    /// Bump the intrusive refcount and return a guard that derefs on `Drop`.
    ///
    /// # Safety
    /// `ptr` must point to a live `T` and remain a valid allocation until the
    /// guard is dropped (the guard's own ref keeps it alive past that point).
    #[inline]
    pub unsafe fn new(ptr: *mut T) -> Self {
        // SAFETY: caller contract — `ptr` is live.
        unsafe { T::rc_ref(ptr) };
        // SAFETY: caller contract — `ptr` is non-null.
        Self(unsafe { NonNull::new_unchecked(ptr) })
    }

    /// Adopt an already-held ref: does **not** bump on construction, but still
    /// derefs on `Drop`. Use when the matching `ref()` was taken earlier (e.g.
    /// by an in-flight async op) and this scope is responsible for releasing
    /// it.
    ///
    /// # Safety
    /// `ptr` must point to a live `T` for which the caller owns one outstanding
    /// ref that this guard will consume.
    #[inline]
    pub unsafe fn adopt(ptr: *mut T) -> Self {
        // SAFETY: caller contract — `ptr` is non-null and live.
        Self(unsafe { NonNull::new_unchecked(ptr) })
    }

    /// Defuse the guard without derefing, handing the ref to whatever adopts
    /// it next. Inverse of [`adopt`](Self::adopt).
    #[inline]
    pub fn forget(self) {
        let _ = core::mem::ManuallyDrop::new(self);
    }
}

impl<T: AnyRefCounted> Drop for ScopedRef<T>
where
    T::DestructorCtx: Default,
{
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `new` took a ref, so the pointee is live until this deref.
        unsafe { T::rc_deref(self.0.as_ptr()) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TrackedRef / TrackedDeref
// ──────────────────────────────────────────────────────────────────────────

#[cfg(debug_assertions)]
struct TrackedRef {
    acquired_at: StoredTrace,
}

/// Not an index, just a unique identifier for the debug data.
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct TrackedRefId(u32);

#[cfg(debug_assertions)]
impl TrackedRefId {
    #[inline]
    const fn new(n: u32) -> Self {
        Self(n)
    }
}

#[cfg(debug_assertions)]
struct TrackedDeref;

// ──────────────────────────────────────────────────────────────────────────
// DebugData
// ──────────────────────────────────────────────────────────────────────────

/// Dyn-safe surface of `DebugData<Count>` so `RefPtr<T>` can interact with it
/// without knowing whether `Count` is `Cell<u32>` or `AtomicU32`.
#[cfg(debug_assertions)]
pub trait DebugDataOps {
    fn assert_valid_dyn(&self);
    fn acquire(&mut self, return_address: usize) -> TrackedRefId;
    fn release(&mut self, id: TrackedRefId, return_address: usize);
}

#[cfg(debug_assertions)]
const MAGIC_VALID: u128 = 0x2f84_e51d;

/// Provides Ref tracking. This is not generic over the pointer T to reduce
/// analysis complexity.
// Parameterized on the `Count` storage type directly (`Cell<u32>` or
// `AtomicU32`). The lock and `next_id` are made uniformly thread-safe
// (debug-only — perf irrelevant).
#[cfg(debug_assertions)]
pub struct DebugData<Count> {
    magic: u128,
    lock: bun_core::Mutex<()>,
    next_id: AtomicU32,
    map: HashMap<TrackedRefId, TrackedRef>,
    frees: ArrayHashMap<TrackedRefId, TrackedDeref>,
    _count: core::marker::PhantomData<Count>,
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugData<Count> {
    // was `pub const EMPTY` — std HashMap::new() is non-const.
    pub fn empty() -> Self {
        Self {
            magic: MAGIC_VALID,
            lock: bun_core::Mutex::new(()),
            next_id: AtomicU32::new(0),
            map: HashMap::new(),
            frees: ArrayHashMap::new(),
            _count: core::marker::PhantomData,
        }
    }

    fn assert_valid(&self) {
        debug_assert!(self.magic == MAGIC_VALID);
    }

    fn dump(&mut self, type_name: Option<&[u8]>, ptr: *mut c_void, rc: u32) {
        let _guard = self.lock.lock();
        generic_dump(type_name, ptr, rc as usize, &mut self.map);
    }

    fn alloc_id(&self) -> TrackedRefId {
        // Debug-only path; always atomic here.
        TrackedRefId::new(self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    fn release_impl(&mut self, id: TrackedRefId, return_address: usize) {
        // If this triggers ASAN, the RefCounted object is double-freed.
        let _guard = self.lock.lock();
        let _ = return_address;
        if self.map.remove(&id).is_none() {
            return;
        }
        self.frees.insert(id, TrackedDeref);
    }

    fn deinit(&mut self, ret_addr: usize) {
        self.assert_valid();
        self.magic = 0;
        let _guard = self.lock.lock();
        self.map.clear();
        self.map.shrink_to_fit();
        // Clear and release the allocation.
        self.frees.clear();
        self.frees.shrink_to_fit();
        let _ = ret_addr;
    }
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugDataOps for DebugData<Count> {
    fn assert_valid_dyn(&self) {
        self.assert_valid();
    }

    fn acquire(&mut self, return_address: usize) -> TrackedRefId {
        // The dyn surface cannot name `Count`, so we acquire without a count
        // pointer; that is fine because the only leak-dump path
        // (`dump_active_refs`) receives the current count explicitly as a
        // parameter, so nothing reads a stored count pointer.
        let _guard = self.lock.lock();
        let id = self.alloc_id();
        self.map.insert(
            id,
            TrackedRef {
                acquired_at: StoredTrace::capture(Some(return_address)),
            },
        );
        id
    }

    fn release(&mut self, id: TrackedRefId, return_address: usize) {
        self.release_impl(id, return_address);
    }
}

/// Abstracts loading the current count from `Cell<u32>` / `AtomicU32`.
#[cfg(debug_assertions)]
pub trait CountLoad {
    fn load_count(&self) -> u32;
}
#[cfg(debug_assertions)]
impl CountLoad for Cell<u32> {
    fn load_count(&self) -> u32 {
        self.get()
    }
}
#[cfg(debug_assertions)]
impl CountLoad for AtomicU32 {
    fn load_count(&self) -> u32 {
        self.load(Ordering::SeqCst)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// generic_dump
// ──────────────────────────────────────────────────────────────────────────

#[cfg(debug_assertions)]
fn generic_dump(
    type_name: Option<&[u8]>,
    ptr: *mut c_void,
    total_ref_count: usize,
    map: &mut HashMap<TrackedRefId, TrackedRef>,
) {
    let tracked_refs = map.len();
    let untracked_refs = total_ref_count - tracked_refs;
    bun_core::pretty_error!(
        "<blue>{}{}{:x} has ",
        bstr::BStr::new(type_name.unwrap_or(b"")),
        if type_name.is_some() { "@" } else { "" },
        ptr as usize,
    );
    if tracked_refs > 0 {
        bun_core::pretty_error!(
            "{} tracked{}",
            tracked_refs,
            if untracked_refs > 0 { ", " } else { "" },
        );
    }
    if untracked_refs > 0 {
        bun_core::pretty_error!("{} untracked refs<r>\n", untracked_refs);
    } else {
        bun_core::pretty_error!("refs<r>\n");
    }
    let mut i: usize = 0;
    for entry in map.values() {
        bun_core::pretty_error!("<b>RefPtr acquired at:<r>\n");
        dump_stack_hook(Some(&entry.acquired_at), 0);
        i += 1;
        if i >= 3 {
            bun_core::pretty_error!("  {} omitted ...\n", map.len() - i);
            break;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// maybe_assert_no_refs
// ──────────────────────────────────────────────────────────────────────────

/// The trait bound restricts this to ref-counted types; callers with a
/// non-ref-counted T must simply not call this.
pub fn maybe_assert_no_refs<T: AnyRefCounted>(ptr: &T) {
    // SAFETY: `ptr` is a live reference to T
    unsafe { T::rc_assert_no_refs(std::ptr::from_ref::<T>(ptr)) }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
fn return_address() -> usize {
    bun_core::return_address()
}

// The ref-count field name is not known here as a const, but
// `T::get_ref_count` is a pure raw-pointer field projection
// (`&raw mut (*this).field` — no read), so probing an uninitialized stack
// value yields the field offset soundly.

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count<T: RefCounted>() -> usize {
    let mut uninit = core::mem::MaybeUninit::<T>::uninit();
    let base = uninit.as_mut_ptr();
    // SAFETY: `get_ref_count` only projects a field within `base`'s
    // allocation; it never reads `*base`.
    let field = unsafe { T::get_ref_count(base) };
    field as usize - base as usize
}

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count_ts<T: ThreadSafeRefCounted>() -> usize {
    let mut uninit = core::mem::MaybeUninit::<T>::uninit();
    let base = uninit.as_mut_ptr();
    // SAFETY: `get_ref_count` only projects a field within `base`'s
    // allocation; it never reads `*base`.
    let field = unsafe { T::get_ref_count(base) };
    field as usize - base as usize
}

// `const unique_symbol = opaque {};` — type-identity marker for
// compile-time assertion in `RefPtr`. Replaced by `AnyRefCounted` trait bound.

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
        type DestructorCtx = ();
        unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
            // SAFETY: caller contract — `this` is in-bounds of a `Thing`
            // allocation. Pure field projection, no read.
            unsafe { &raw mut (*this).ref_count }
        }
        unsafe fn destructor(this: *mut Self, _: ()) {
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
        assert_eq!(*p.data().payload, 42);

        let q = p.dupe_ref();
        let r = p.clone();
        assert_eq!(p.as_ptr(), q.as_ptr());
        assert_eq!(p.as_ptr(), r.as_ptr());
        r.deref();
        q.deref();
        assert_eq!(drops(), before);

        // `leak` hands the ref off without decrementing; `from_raw` takes it back.
        let raw = p.leak();
        // SAFETY: `raw` still owns the ref `p` gave up.
        let p = unsafe { RefPtr::from_raw(raw) };
        assert_eq!(*p.payload, 42);
        p.deref();
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn scoped_ref_releases_on_drop() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(3);
        {
            // SAFETY: `t` is live; the guard's ref keeps it alive for the scope.
            let _g = unsafe { ScopedRef::new(t) };
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
    fn scoped_ref_adopt_consumes_caller_ref() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(3);
        // SAFETY: `t` is live and we own the one ref the guard will consume.
        drop(unsafe { ScopedRef::adopt(t) });
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn finalize_js_box_releases_one_ref() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(9);
        // SAFETY: `t` is live; simulate the codegen handing `finalize` a Box.
        let boxed: Box<Thing> = unsafe { bun_core::heap::take(t) };
        let seen = std::cell::Cell::new(0u32);
        finalize_js_box(boxed, |thing: &Thing| seen.set(*thing.payload));
        assert_eq!(seen.get(), 9);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn clear_without_destructor_skips_drop() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(1);
        // SAFETY: `t` is live.
        unsafe { (*RefCounted::get_ref_count(t)).clear_without_destructor() };
        // SAFETY: we now own the allocation outright; free it by hand.
        drop(unsafe { bun_core::heap::take(t) });
        assert_eq!(drops(), before + 1);
    }

    // ── ThreadSafeRefCount (atomic, cross-thread) ─────────────────────────

    struct Shared {
        ref_count: ThreadSafeRefCount<Shared>,
        payload: Box<u32>,
    }

    impl Drop for Shared {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl ThreadSafeRefCounted for Shared {
        unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self> {
            // SAFETY: caller contract — pure field projection, no read.
            unsafe { &raw mut (*this).ref_count }
        }
    }

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

    #[test]
    #[cfg(debug_assertions)]
    fn offset_of_ref_count_probes_uninit_without_reading() {
        // `get_ref_count` must be a pure projection: this probes it against a
        // `MaybeUninit<Thing>`, so any read of `*base` is an uninit read Miri
        // would reject.
        assert_eq!(
            offset_of_ref_count::<Thing>(),
            core::mem::offset_of!(Thing, ref_count)
        );
        assert_eq!(
            offset_of_ref_count_ts::<Shared>(),
            core::mem::offset_of!(Shared, ref_count)
        );
    }
}
