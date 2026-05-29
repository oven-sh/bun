//! Intrusive reference counting (single-threaded and thread-safe) + `RefPtr<T>`
//! debug-tracking wrapper.
//!
//! Ported from `src/ptr/ref_count.zig`. The Zig original uses comptime
//! type-returning functions (`fn RefCount(T, field_name, destructor, opts) type`)
//! as mixins; in Rust this becomes a pair of (embedded struct + trait the host
//! type implements). See `RefCounted` / `ThreadSafeRefCounted`.

use core::cell::Cell;
#[cfg(debug_assertions)]
use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::StoredTrace;
use bun_core::ThreadLock;

// PORT NOTE(b0): was `bun_collections::{ArrayHashMap, HashMap}` (T1 → upward).
// Debug-only diagnostic storage; std HashMap drops insertion order for `frees`
// which is acceptable for leak reports.
#[cfg(debug_assertions)]
use std::collections::HashMap;
#[cfg(debug_assertions)]
type ArrayHashMap<K, V> = HashMap<K, V>;

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

#[derive(Default)]
pub struct Options {
    /// Defaults to the type basename.
    pub debug_name: Option<&'static str>,
    // destructor_ctx: see RefCounted::DestructorCtx
}

// ──────────────────────────────────────────────────────────────────────────
// Host-type traits (replace Zig's comptime `field_name` / `destructor` params)
// ──────────────────────────────────────────────────────────────────────────

pub trait RefCounted: Sized {
    /// Zig: `options.destructor_ctx orelse void`.
    type DestructorCtx;

    /// Zig: `options.debug_name orelse bun.meta.typeBaseName(@typeName(T))`.
    fn debug_name() -> &'static str {
        // TODO(port): bun.meta.typeBaseName — strip module path from type_name
        core::any::type_name::<Self>()
    }

    /// Zig: `&@field(self, field_name)` — locate the embedded `RefCount` field.
    ///
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self>;

    /// Zig: the `destructor` fn pointer passed to `RefCount(...)`.
    ///
    /// # Safety
    /// `this` must point to a live `Self` with `raw_count == 0`.
    unsafe fn destructor(this: *mut Self, ctx: Self::DestructorCtx);
}

/// Implemented by types that embed a [`ThreadSafeRefCount`] field.
pub trait ThreadSafeRefCounted: Sized {
    /// Zig: `options.debug_name orelse bun.meta.typeBaseName(@typeName(T))`.
    fn debug_name() -> &'static str {
        core::any::type_name::<Self>()
    }

    /// Zig: `&@field(self, field_name)`.
    ///
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self>;

    /// Zig: the `destructor: fn (*T) void` parameter.
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

pub trait AnyRefCounted: Sized {
    type DestructorCtx;

    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_ref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_deref_with_context(this: *mut Self, ctx: Self::DestructorCtx);
    /// Zig's `deref(self)` forwards `{}` (void) as the ctx — equivalent to
    /// `Default::default()`. Types with a non-unit `DestructorCtx` must call
    /// `rc_deref_with_context` explicitly (matches Zig's compile error when
    /// `destructor_ctx != null`).
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

    // PORT NOTE: `ref` is a Rust keyword; renamed to `ref_`.
    /// # Safety
    /// `self_` must point to a live `T`.
    pub unsafe fn ref_(self_: *mut T) {
        // SAFETY: caller contract
        let count = unsafe { &*T::get_ref_count(self_) };
        #[cfg(debug_assertions)]
        {
            count.debug.assert_valid();
        }
        // TODO(port): per-type scoped logging — Zig used
        // `bun.Output.Scoped(debug_name, .hidden)` keyed on T's name. The
        // `bun_core::scoped_log!` macro expects a static scope ident.
        bun_core::scoped_log!(
            ref_count,
            "0x{:x}   ref {} -> {}:",
            self_ as usize,
            count.raw_count.get(),
            count.raw_count.get() + 1,
        );
        if DEBUG_STACK_TRACE {
            // TODO(port): was dump_current_stack_trace(ret, {frame_count:2, skip:[ref_count.zig]})
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
            // TODO(port): was dump_current_stack_trace(ret, {frame_count:2, skip:[ref_count.zig]})
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
                bun_core::container_of::<T, Self>(std::ptr::from_mut(self), offset_of_ref_count())
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
        // Zig: gated on `bun.Environment.ci_assert`.
        assert!(self.raw_count.get() == 0);
    }

    pub fn clear_without_destructor(&self) {
        self.assert_single_threaded();
        self.raw_count.set(0);
    }

    fn assert_single_threaded(&self) {
        self.thread.lock_or_assert();
    }

    // PORT NOTE: `getRefCount(self: *T) *@This()` is the trait method
    // `T::get_ref_count` above; not duplicated here.

    // PORT NOTE: `is_ref_count = unique_symbol` and `ref_count_options` were
    // comptime-reflection markers for `RefPtr`; replaced by the `AnyRefCounted`
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
                    offset_of_ref_count_ts(),
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
        // Zig: gated on `bun.Environment.ci_assert`.
        assert!(self.raw_count.load(Ordering::SeqCst) == 0);
    }

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

    // PORT NOTE: `getRefCount` / `is_ref_count` / `ref_count_options` — see
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

// ──────────────────────────────────────────────────────────────────────────
// RefPtr
// ──────────────────────────────────────────────────────────────────────────

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
        // PORT NOTE: Zig re-asserted `is_ref_count == unique_symbol` here;
        // the `T: AnyRefCounted` bound is that assertion.
        // SAFETY: caller contract
        unsafe { Self::unchecked_and_unsafe_init(raw_ptr, return_address()) }
    }

    // NOTE: would be nice to use a const for deref dispatch, but keep two
    // methods for clarity (matches Zig comment).

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

    #[inline]
    pub fn as_ptr(&self) -> *mut T {
        self.data.as_ptr()
    }

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

    pub fn leak(self) -> *mut T {
        let ptr = self.data.as_ptr();
        #[cfg(debug_assertions)]
        {
            // mark debug tracking as released without actually derefing
            // SAFETY: data is live (we hold a ref)
            unsafe { (*T::rc_debug_data(ptr)).release(self.debug, return_address()) };
        }
        // PORT NOTE: Zig set `self.data = undefined`; taking `self` by value
        // here makes the RefPtr unusable, which is the same intent.
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
    /// it (Zig: `defer this.deref();` with no preceding `this.ref()`).
    ///
    /// # Safety
    /// `ptr` must point to a live `T` for which the caller owns one outstanding
    /// ref that this guard will consume.
    #[inline]
    pub unsafe fn adopt(ptr: *mut T) -> Self {
        // SAFETY: caller contract — `ptr` is non-null and live.
        Self(unsafe { NonNull::new_unchecked(ptr) })
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
// PORT NOTE: Zig used `bun.GenericIndex(u32, TrackedRef)` (opaque type-tag).
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

#[cfg(debug_assertions)]
pub struct DebugData<Count> {
    // TODO(port): Zig used `align(@alignOf(u32))` to reduce u128 alignment to
    // 4. Rust cannot under-align a field; consider `[u32; 4]` if layout matters.
    magic: u128,
    // TODO(port): Zig used `if (thread_safe) std.debug.SafetyLock else bun.Mutex`.
    // Debug-only — always `bun_core::Mutex<()>` (poison-free `std::sync`) here for simplicity.
    lock: bun_core::Mutex<()>,
    next_id: AtomicU32,
    map: HashMap<TrackedRefId, TrackedRef>,
    frees: ArrayHashMap<TrackedRefId, TrackedDeref>,
    _count: core::marker::PhantomData<Count>,
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugData<Count> {
    // PORT NOTE(b0): was `pub const EMPTY` — std HashMap::new() is non-const.
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
        // PORT NOTE: Zig branched on `thread_safe` (atomic RMW vs plain ++).
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

    // PORT NOTE: Zig `deinit` took `std.mem.asBytes(self)` as `data: []const u8`
    // but never read it; the Rust port dropped the parameter to avoid forming a
    // `&[u8]` over `T` (which may contain padding/uninit bytes — UB to read).
    fn deinit(&mut self, ret_addr: usize) {
        self.assert_valid();
        self.magic = 0; // Zig: `= undefined`
        let _guard = self.lock.lock();
        self.map.clear();
        self.map.shrink_to_fit();
        self.frees.clear();
        // TODO(port): ArrayHashMap shrink — Zig clearAndFree
        let _ = ret_addr;
    }
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugDataOps for DebugData<Count> {
    fn assert_valid_dyn(&self) {
        self.assert_valid();
    }

    fn acquire(&mut self, return_address: usize) -> TrackedRefId {
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

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count() -> usize {
    // TODO(port): Zig used `@fieldParentPtr(field_name, count)`. Without the
    // field name as a const, compute via the trait: feed a dangling aligned T
    // and diff pointers. The derive macro could emit `offset_of!(T, ref_count)`.
    0
}

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count_ts() -> usize {
    // TODO(port): see offset_of_ref_count.
    0
}

// PORT NOTE: `const unique_symbol = opaque {};` — type-identity marker for
// comptime assertion in `RefPtr`. Replaced by `AnyRefCounted` trait bound.

bun_core::declare_scope!(ref_count, hidden);

// ported from: src/ptr/ref_count.zig
