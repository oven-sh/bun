//! Intrusive reference counting (single-threaded and thread-safe) + the handles
//! over it: `OwnedRef<T>` (owns one ref, releases on drop), `ScopedRef<T>`
//! (holds one ref for a scope) and `RefPtr<T>` (owns one ref, released by
//! hand; carries the debug tracking).
//!
//! Each ref-count mixin is a pair of (embedded struct + trait the host
//! type implements). See `RefCounted` / `ThreadSafeRefCounted`.

use core::cell::Cell;
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
    pub(crate) unsafe fn deref_with_context(self_: *mut T, ctx: T::DestructorCtx) {
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

    // utility functions

    pub fn get(&self) -> u32 {
        self.raw_count.load(Ordering::SeqCst)
    }

    pub fn has_one_ref(&self) -> bool {
        #[cfg(debug_assertions)]
        self.debug.assert_valid();
        self.get() == 1
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        assert!(self.raw_count.load(Ordering::SeqCst) == 0);
    }

    /// Type-erased accessor for the embedded debug tracker. Exposed (rather
    /// than the private `debug` field) so `#[derive(ThreadSafeRefCounted)]`
    /// can emit [`AnyRefCounted::rc_debug_data`] from outside this crate.
    #[cfg(debug_assertions)]
    #[doc(hidden)]
    #[inline]
    pub fn debug_data_ptr(&self) -> *mut dyn DebugDataOps {
        // Only `&self` methods are ever called through this pointer; it is
        // spelled `*mut` because `rc_debug_data`'s signature is.
        core::ptr::from_ref::<dyn DebugDataOps>(&self.debug).cast_mut()
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
/// [`AnyRefCounted`] bridge (so [`OwnedRef`] / [`RefPtr`] / [`ScopedRef`] accept the type)
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

    /// Safe [`ref_`](Self::ref_) for a `NonNull<Self>` handle.
    ///
    /// The `unsafe trait` contract guarantees `this` points to a live
    /// intrusively-refcounted `Self`; [`BackRef`](crate::BackRef) turns that
    /// into a shared borrow without the caller spelling `unsafe`.
    #[inline]
    fn ref_nn(this: NonNull<Self>) {
        crate::BackRef::from(this).ref_();
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

/// Run `before(&*this)` then reclaim `this` as a `Box<T>` and drop it.
///
/// Intended as the body of a `#[ref_count(destroy = …)]` target, where the
/// wrapper needs to detach/invalidate itself before field `Drop` impls run.
/// The raw-pointer deref is audited here once so per-type `destroy` bodies in
/// callers stay `unsafe`-free.
///
/// Callers must only pass a pointer that originated from
/// `Box::into_raw` / `heap::into_raw` and is the sole remaining owner — the
/// same precondition as [`CellRefCounted::destroy`], which is the only
/// sanctioned call site.
#[inline]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn destroy_box_with<T>(this: *mut T, before: impl FnOnce(&T)) {
    debug_assert!(!this.is_null());
    // SAFETY: `CellRefCounted::destroy` contract — `this` is the sole live
    // owner of a `Box`-allocated `T`; `before` only observes it shared.
    unsafe {
        before(&*this);
        drop(Box::from_raw(this));
    }
}

/// No-op [`DebugDataOps`] for [`CellRefCounted`] types — they carry no
/// `DebugData` field, so [`RefPtr`]'s acquire/release tracking degrades to
/// a stub.
#[cfg(debug_assertions)]
#[doc(hidden)]
struct NoopDebugData;

#[cfg(debug_assertions)]
impl DebugDataOps for NoopDebugData {
    fn assert_valid_dyn(&self) {}
    fn acquire(&self, _return_address: usize) -> TrackedRefId {
        TrackedRefId::new(0)
    }
    fn release(&self, _id: TrackedRefId, _return_address: usize) {}
}

#[cfg(debug_assertions)]
#[doc(hidden)]
pub fn noop_debug_data() -> *mut dyn DebugDataOps {
    static NOOP: NoopDebugData = NoopDebugData;
    // Every `DebugDataOps` method takes `&self`, so the `*mut` spelling of
    // this pointer (fixed by `rc_debug_data`'s signature) is never written
    // through.
    core::ptr::from_ref::<dyn DebugDataOps>(&NOOP).cast_mut()
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
/// which of its owners' methods discharges this obligation. For a field or a
/// container element, prefer [`OwnedRef`], which releases on drop; `RefPtr`
/// is for the call sites that need to release by hand.
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
    pub(crate) fn deref_with_context(&self, ctx: T::DestructorCtx) {
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

    /// Turn this handle into an [`OwnedRef`] holding the same ref, so that it
    /// is released by drop instead of by a `deref()` call. The count is
    /// untouched; this handle's debug tracking entry is closed by `leak`.
    #[inline]
    pub fn into_owned(self) -> OwnedRef<T>
    where
        T::DestructorCtx: Default,
    {
        // SAFETY: `leak` hands over the ref this handle owned on a live `T`,
        // through the pointer it was created with.
        unsafe { OwnedRef::from_raw(self.leak()) }
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
    pub(crate) unsafe fn take_ref(raw_ptr: *mut T) -> Self {
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
    pub(crate) unsafe fn unchecked_and_unsafe_init(raw_ptr: *mut T, ret_addr: usize) -> Self {
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
// OwnedRef
// ──────────────────────────────────────────────────────────────────────────

/// Exactly one intrusive ref on a `T`, released when this value is dropped.
///
/// This is the owning handle to store in fields and containers. The pointee
/// is live for as long as the `OwnedRef` exists, so it derefs to `&T` without
/// any `unsafe` at the use site; `clone()` takes another ref; and dropping it,
/// whether explicitly, by `Option::take()`, by popping it out of a queue or by
/// the holder being destroyed, is what releases the ref. A ref held this way
/// cannot be released twice, and cannot be forgotten without naming
/// [`into_raw`](Self::into_raw).
///
/// How it relates to the other handles in this module:
/// - [`ScopedRef`] is the same `rc_ref` / `rc_deref` pair, but holds the ref
///   for one scope and cannot be dereferenced or stored; it brackets a
///   re-entrant call. `OwnedRef` is that ref as a value that can be moved.
/// - [`RefPtr`] owns a ref too, but has no `Drop` impl, so every holder has to
///   call `deref()` by hand on every path; in exchange it records each holder
///   in the debug ref tracker. Use `OwnedRef` unless a call site needs that;
///   [`RefPtr::into_owned`] converts an existing handle.
///
/// Constructors: [`new`](Self::new) allocates a `T` and owns its initial ref,
/// [`acquire`](Self::acquire) takes a ref on an existing `T`, and
/// [`from_raw`](Self::from_raw) takes over a ref the caller already owns (the
/// inverse of `into_raw`, which hands a ref to code that will release it some
/// other way, typically a C or C++ callback calling back into `deref`).
/// Inside a callback that already has a [`ThisPtr`](crate::ThisPtr),
/// [`ThisPtr::owned_ref`](crate::ThisPtr::owned_ref) is the safe way to take
/// one.
///
/// For a `T` that hands out refs to itself while an operation is in flight
/// (a socket, a timer, a queued request), the natural shape is a field of
/// type `Cell<Option<OwnedRef<Self>>>` that is filled when the operation
/// starts and `take()`n when it completes: dropping the taken value is the
/// release, and because the count cannot reach zero while the field is
/// filled, `T`'s destructor only ever sees the field empty.
///
/// Threads: an `OwnedRef<T>` is `Send` and `Sync` under the same bounds as
/// `Arc<T>` (`T: Send + Sync`), so a task can carry the ref it holds on a
/// [`ThreadSafeRefCounted`] host to the work pool and release it there. Hosts
/// of the two single-threaded counts can never meet those bounds, because
/// `RefCount` and `CellRefCounted`'s `Cell<u32>` are `!Sync`.
#[must_use = "dropping immediately releases the ref"]
pub struct OwnedRef<T: AnyRefCounted>(NonNull<T>)
where
    T::DestructorCtx: Default;

impl<T: AnyRefCounted> OwnedRef<T>
where
    T::DestructorCtx: Default,
{
    /// Allocate `value` on the heap and own its initial ref. `value`'s count
    /// must start at 1 (`RefCount::init()` and friends), since that is the ref
    /// this handle releases; anything above it could never be released.
    pub fn new(value: T) -> Self {
        let ptr = bun_core::heap::into_raw(Box::new(value));
        // SAFETY: freshly boxed, so live, with the full allocation's provenance.
        debug_assert!(unsafe { T::rc_has_one_ref(ptr) });
        // SAFETY: as above; the initial ref is the one this handle takes over.
        unsafe { Self::from_raw(ptr) }
    }

    /// Take a new ref on `*ptr`; whatever ref the caller holds is untouched.
    ///
    /// # Safety
    /// `ptr` must point to a live `T`, with the provenance the host's
    /// `deref()` requires (the pointer the allocation was created with, or one
    /// derived from it), since the returned value may be the one that ends up
    /// destroying `*ptr`.
    #[inline]
    pub unsafe fn acquire(ptr: *mut T) -> Self {
        // SAFETY: caller contract — `ptr` is live.
        unsafe { T::rc_ref(ptr) };
        // SAFETY: caller contract; the ref just taken is the one this handle owns.
        unsafe { Self::from_raw(ptr) }
    }

    /// Take over a ref that the caller already owns, without touching the
    /// count. Inverse of [`into_raw`](Self::into_raw).
    ///
    /// # Safety
    /// As for [`acquire`](Self::acquire), and additionally the caller must own
    /// one ref on `*ptr` that nothing else will release: this value now owns it.
    #[inline]
    pub unsafe fn from_raw(ptr: *mut T) -> Self {
        // SAFETY: caller contract — a live `T` is not at address zero.
        Self(unsafe { NonNull::new_unchecked(ptr) })
    }

    /// Give up the ref without releasing it and return the pointer. Whoever
    /// receives the pointer now owns the ref and must eventually release it,
    /// normally by passing it back to [`from_raw`](Self::from_raw).
    #[inline]
    pub fn into_raw(self) -> *mut T {
        core::mem::ManuallyDrop::new(self).0.as_ptr()
    }

    /// The pointee's address, for identity comparisons and for APIs that take
    /// a raw pointer. Holding this pointer does not hold a ref: it is valid
    /// only while this `OwnedRef` (or another ref) is alive.
    #[inline]
    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }

    /// [`as_ptr`](Self::as_ptr) as a `NonNull`, for the call sites that key
    /// or compare on one.
    #[inline]
    pub fn as_non_null(&self) -> NonNull<T> {
        self.0
    }

    /// A [`ThisPtr`](crate::ThisPtr) to the pointee, for the FFI-shaped call
    /// sites that take one. Valid while this `OwnedRef` (or another ref) is
    /// alive.
    #[inline]
    pub fn this_ptr(&self) -> crate::ThisPtr<T> {
        // SAFETY: we own a ref, so the pointee is live and non-null.
        unsafe { crate::ThisPtr::new(self.0.as_ptr()) }
    }
}

impl<T: AnyRefCounted> Clone for OwnedRef<T>
where
    T::DestructorCtx: Default,
{
    /// Takes another ref on the same pointee.
    #[inline]
    fn clone(&self) -> Self {
        // SAFETY: our own ref keeps the pointee live, and `self.0` is the
        // pointer a ref was taken through, so it has the provenance `acquire`
        // asks for.
        unsafe { Self::acquire(self.0.as_ptr()) }
    }
}

impl<T: AnyRefCounted> core::ops::Deref for OwnedRef<T>
where
    T::DestructorCtx: Default,
{
    type Target = T;

    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: holding an `OwnedRef` means holding a ref, so the pointee is
        // live for as long as `&self` is. Hosts are interior-mutable behind
        // `&T` (single-threaded counts are `!Sync`, thread-safe hosts
        // synchronise their own fields), so no `&mut T` is ever formed from one.
        unsafe { self.0.as_ref() }
    }
}

impl<T: AnyRefCounted> Drop for OwnedRef<T>
where
    T::DestructorCtx: Default,
{
    #[inline]
    fn drop(&mut self) {
        // SAFETY: this value owns one ref (taken in `acquire` or handed over in
        // `from_raw`), and `Drop` is the one place it is released; `into_raw`
        // moves `self` into a `ManuallyDrop` so the two never both run.
        unsafe { T::rc_deref(self.0.as_ptr()) };
    }
}

// SAFETY: the `Arc<T>` argument. Moving an `OwnedRef<T>` to another thread
// moves a `&T` there (`T: Sync`) and may make that thread the one that runs
// `T`'s destructor (`T: Send`). Everything this type does to the count is
// `rc_ref` / `rc_deref`, and the only count that can be embedded in a host
// meeting these bounds is the atomic `ThreadSafeRefCount` (`RefCount` and the
// `Cell<u32>` behind `CellRefCounted` are `!Sync`, so hosts embedding them
// never qualify). A `RefPtr` to the same object held by some other thread
// is also fine: its debug tracking goes through `&self` methods and a lock,
// so nothing forms a `&mut` to the count while this thread uses it.
unsafe impl<T: AnyRefCounted + Send + Sync> Send for OwnedRef<T> where T::DestructorCtx: Default {}
// SAFETY: `&OwnedRef<T>` only yields `&T` (needs `T: Sync`) and clones, which
// are atomic increments for the hosts these bounds admit (see above).
unsafe impl<T: AnyRefCounted + Send + Sync> Sync for OwnedRef<T> where T::DestructorCtx: Default {}

// ──────────────────────────────────────────────────────────────────────────
// TrackedRef / TrackedDeref
// ──────────────────────────────────────────────────────────────────────────

#[cfg(debug_assertions)]
struct TrackedRef;

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
    /// Records a new holder. Takes `&self` because holders of a thread-safe
    /// count come and go on several threads at once, while other threads may
    /// be reading the count through a shared borrow.
    fn acquire(&self, return_address: usize) -> TrackedRefId;
    fn release(&self, id: TrackedRefId, return_address: usize);
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
    next_id: AtomicU32,
    holders: bun_core::Mutex<Holders>,
    _count: core::marker::PhantomData<Count>,
}

/// The tables behind [`DebugData`]'s lock: the refs currently held, and the
/// ids that have been released (so a double release can be told apart from a
/// release of an id that was never issued).
#[cfg(debug_assertions)]
struct Holders {
    live: HashMap<TrackedRefId, TrackedRef>,
    frees: ArrayHashMap<TrackedRefId, TrackedDeref>,
}

#[cfg(debug_assertions)]
impl<Count> DebugData<Count> {
    // was `pub const EMPTY` — std HashMap::new() is non-const.
    pub(crate) fn empty() -> Self {
        Self {
            magic: MAGIC_VALID,
            next_id: AtomicU32::new(0),
            holders: bun_core::Mutex::new(Holders {
                live: HashMap::new(),
                frees: ArrayHashMap::new(),
            }),
            _count: core::marker::PhantomData,
        }
    }

    fn assert_valid(&self) {
        debug_assert!(self.magic == MAGIC_VALID);
    }

    fn alloc_id(&self) -> TrackedRefId {
        // Debug-only path; always atomic here.
        TrackedRefId::new(self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    /// Runs on the last release, so nothing else can still reach `self`.
    fn deinit(&mut self, ret_addr: usize) {
        self.assert_valid();
        self.magic = 0;
        let holders = self.holders.get_mut();
        holders.live.clear();
        holders.live.shrink_to_fit();
        // Clear and release the allocation.
        holders.frees.clear();
        holders.frees.shrink_to_fit();
        let _ = ret_addr;
    }
}

#[cfg(debug_assertions)]
impl<Count> DebugDataOps for DebugData<Count> {
    fn assert_valid_dyn(&self) {
        self.assert_valid();
    }

    fn acquire(&self, return_address: usize) -> TrackedRefId {
        let id = self.alloc_id();
        let _ = return_address;
        self.holders.lock().live.insert(id, TrackedRef);
        id
    }

    fn release(&self, id: TrackedRefId, return_address: usize) {
        // If this triggers ASAN, the RefCounted object is double-freed.
        let _ = return_address;
        let mut holders = self.holders.lock();
        if holders.live.remove(&id).is_none() {
            return;
        }
        holders.frees.insert(id, TrackedDeref);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
fn return_address() -> usize {
    bun_core::return_address()
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

    /// Current count of a live `Thing`.
    fn count(t: *mut Thing) -> u32 {
        // SAFETY: callers pass a `Thing` they still hold a ref on.
        unsafe { (*RefCounted::get_ref_count(t)).get() }
    }

    #[test]
    fn owned_ref_new_takes_a_ref_and_drop_releases_it() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(5);
        {
            // SAFETY: `t` is live (we hold its initial ref).
            let owned = unsafe { OwnedRef::acquire(t) };
            assert_eq!(count(t), 2);
            assert_eq!(*owned.payload, 5);
            assert_eq!(owned.as_ptr(), t);
            assert_eq!(owned.as_non_null().as_ptr(), t);
            assert_eq!(owned.this_ptr().as_ptr(), t);
        }
        assert_eq!(count(t), 1);
        assert_eq!(drops(), before);
        // SAFETY: releasing the initial ref destroys it.
        unsafe { RefCount::<Thing>::deref(t) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn owned_ref_last_one_out_destroys() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(6);
        // SAFETY: `t` is live and this adopts its initial ref, so from here on
        // every ref is held by an `OwnedRef`.
        let first = unsafe { OwnedRef::from_raw(t) };
        let second = first.clone();
        let held: Vec<OwnedRef<Thing>> = (0..3).map(|_| first.clone()).collect();
        assert_eq!(count(t), 5);

        drop(held);
        assert_eq!(count(t), 2);
        drop(second);
        assert_eq!(count(t), 1);
        assert_eq!(drops(), before);
        drop(first);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn owned_ref_into_raw_hands_the_ref_off_and_from_raw_takes_it_back() {
        let _serial = serial();
        let before = drops();
        let owned = OwnedRef::new(Thing {
            ref_count: RefCount::init(),
            payload: Box::new(8),
        });
        let raw = owned.into_raw();
        // The ref survived `into_raw`: nothing was released or destroyed.
        assert_eq!(count(raw), 1);
        assert_eq!(drops(), before);
        // SAFETY: `raw` carries the ref `into_raw` handed off.
        let owned = unsafe { OwnedRef::from_raw(raw) };
        assert_eq!(*owned.payload, 8);
        drop(owned);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn owned_ref_option_take_releases_exactly_once() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(9);
        // The in-flight-operation shape: a slot that is filled while something
        // holds a ref and emptied, releasing it, when that something finishes.
        // SAFETY: `t` is live.
        let slot: Cell<Option<OwnedRef<Thing>>> = Cell::new(Some(unsafe { OwnedRef::acquire(t) }));
        assert_eq!(count(t), 2);
        drop(slot.take());
        assert_eq!(count(t), 1);
        // A second take finds nothing, so nothing is released twice.
        assert!(slot.take().is_none());
        assert_eq!(count(t), 1);
        assert_eq!(drops(), before);
        // SAFETY: releasing the initial ref destroys it.
        unsafe { RefCount::<Thing>::deref(t) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_into_owned_keeps_the_count_and_releases_on_drop() {
        let _serial = serial();
        let before = drops();
        let p = RefPtr::new(Thing {
            ref_count: RefCount::init(),
            payload: Box::new(10),
        });
        let t = p.as_ptr();
        let owned = p.into_owned();
        assert_eq!(count(t), 1);
        assert_eq!(*owned.payload, 10);
        assert_eq!(drops(), before);
        drop(owned);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn this_ptr_owned_ref_outlives_the_callback_that_took_it() {
        let _serial = serial();
        let before = drops();
        let t = Thing::new(12);
        // What a dispatch callback does: wrap the incoming pointer, park a ref
        // somewhere that outlives the callback frame.
        let parked = {
            // SAFETY: `t` is live for the whole block (we hold its initial ref).
            let this = unsafe { crate::ThisPtr::new(t) };
            this.owned_ref()
        };
        assert_eq!(count(t), 2);
        // SAFETY: releasing the initial ref; `parked` keeps it alive.
        unsafe { RefCount::<Thing>::deref(t) };
        assert_eq!(drops(), before);
        assert_eq!(*parked.payload, 12);
        drop(parked);
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn owned_ref_option_uses_the_null_niche() {
        assert_eq!(
            size_of::<Option<OwnedRef<Thing>>>(),
            size_of::<OwnedRef<Thing>>()
        );
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

    // What `#[derive(ThreadSafeRefCounted)]` emits for real hosts; spelled out
    // because the derive expands to `::bun_ptr::` paths that do not resolve
    // inside this crate.
    impl AnyRefCounted for Shared {
        type DestructorCtx = ();
        unsafe fn rc_ref(this: *mut Self) {
            // SAFETY: caller contract.
            unsafe { ThreadSafeRefCount::<Shared>::ref_(this) }
        }
        unsafe fn rc_deref_with_context(this: *mut Self, (): ()) {
            // SAFETY: caller contract.
            unsafe { ThreadSafeRefCount::<Shared>::deref(this) }
        }
        unsafe fn rc_has_one_ref(this: *const Self) -> bool {
            // SAFETY: caller contract.
            unsafe { (*ThreadSafeRefCounted::get_ref_count(this.cast_mut())).has_one_ref() }
        }
        unsafe fn rc_assert_no_refs(this: *const Self) {
            // SAFETY: caller contract.
            unsafe { (*ThreadSafeRefCounted::get_ref_count(this.cast_mut())).assert_no_refs() }
        }
        #[cfg(debug_assertions)]
        unsafe fn rc_debug_data(this: *mut Self) -> *mut dyn DebugDataOps {
            // SAFETY: caller contract.
            unsafe { (*ThreadSafeRefCounted::get_ref_count(this)).debug_data_ptr() }
        }
    }

    // SAFETY: what a real thread-safe host declares. The count is atomic and
    // `payload` is only ever read, so `&Shared` can be used from any thread
    // and the last thread out may run the destructor.
    unsafe impl Send for Shared {}
    // SAFETY: as above.
    unsafe impl Sync for Shared {}

    #[test]
    fn owned_ref_clones_cross_threads_and_the_last_one_destroys() {
        let _serial = serial();
        let before = drops();
        let main_ref = OwnedRef::new(Shared {
            ref_count: ThreadSafeRefCount::init(),
            payload: Box::new(5),
        });

        // Each thread is handed its own clone and releases it by dropping it;
        // `OwnedRef<Shared>: Send` is what lets the clone move into the closure.
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let theirs = main_ref.clone();
                std::thread::spawn(move || *theirs.payload)
            })
            .collect();
        for worker in workers {
            assert_eq!(worker.join().unwrap(), 5);
        }
        assert_eq!(drops(), before);
        // SAFETY: we still hold `main_ref`.
        assert!(unsafe { <Shared as AnyRefCounted>::rc_has_one_ref(main_ref.as_ptr()) });

        // The destroying release may also happen off the creating thread.
        std::thread::spawn(move || drop(main_ref)).join().unwrap();
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn ref_ptr_tracking_coexists_with_owned_refs_on_other_threads() {
        let _serial = serial();
        let before = drops();
        let tracked = RefPtr::new(Shared {
            ref_count: ThreadSafeRefCount::init(),
            payload: Box::new(7),
        });
        // SAFETY: `tracked` holds a ref, and `as_ptr` is the allocation's pointer.
        let owned = unsafe { OwnedRef::acquire(tracked.as_ptr()) };
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let theirs = owned.clone();
                std::thread::spawn(move || *theirs.payload)
            })
            .collect();
        // Meanwhile this thread keeps driving the tracked handle: each
        // `dupe_ref` / `deref` pair records and releases a holder entry.
        for _ in 0..16 {
            tracked.dupe_ref().deref();
        }
        for worker in workers {
            assert_eq!(worker.join().unwrap(), 7);
        }
        drop(owned);
        assert_eq!(drops(), before);
        tracked.deref();
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
