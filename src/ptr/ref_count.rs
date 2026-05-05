//! Intrusive reference counting (single-threaded and thread-safe) + `RefPtr<T>`
//! debug-tracking wrapper.
//!
//! Ported from `src/ptr/ref_count.zig`. The Zig original uses comptime
//! type-returning functions (`fn RefCount(T, field_name, destructor, opts) type`)
//! as mixins; in Rust this becomes a pair of (embedded struct + trait the host
//! type implements). See `RefCounted` / `ThreadSafeRefCounted`.

use core::cell::Cell;
use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::size_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

use bun_alloc::allocation_scope::{self, AllocationScope};
// MOVE_DOWN(b0): was bun_crash_handler::StoredTrace — type moves to bun_core.
use bun_core::StoredTrace;
use bun_safety::ThreadLock;
// PORT NOTE(b0): was `bun_collections::{ArrayHashMap, HashMap}` (T1 → upward).
// Debug-only diagnostic storage; std HashMap drops insertion order for `frees`
// which is acceptable for leak reports.
use std::collections::HashMap;
type ArrayHashMap<K, V> = HashMap<K, V>;

// ──────────────────────────────────────────────────────────────────────────
// Debug-hook (CYCLEBREAK §Debug-hook registration): set by
// `bun_runtime::init()` → `crash_handler::dump_stack_trace`. Null = no-op.
// ──────────────────────────────────────────────────────────────────────────

/// fn-ptr signature: `unsafe fn(trace: *const StoredTrace /* null = current */, ret_addr: usize)`
pub static DUMP_STACK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

#[inline]
fn dump_stack_hook(trace: *const StoredTrace, ret_addr: usize) {
    let p = DUMP_STACK.load(Ordering::Relaxed);
    if p.is_null() {
        return;
    }
    // SAFETY: `bun_runtime::init()` stores a fn-ptr matching this signature.
    let f: unsafe fn(*const StoredTrace, usize) = unsafe { core::mem::transmute(p) };
    unsafe { f(trace, ret_addr) };
}

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────

/// Options for `RefCount` / `ThreadSafeRefCount`.
///
/// PORT NOTE: Zig's `Options` also carried `destructor_ctx: ?type`. A *type*
/// cannot be a struct field in Rust; it becomes the associated type
/// `RefCounted::DestructorCtx` instead.
#[derive(Default)]
pub struct Options {
    /// Defaults to the type basename.
    pub debug_name: Option<&'static str>,
    // destructor_ctx: see RefCounted::DestructorCtx
}

// ──────────────────────────────────────────────────────────────────────────
// Host-type traits (replace Zig's comptime `field_name` / `destructor` params)
// ──────────────────────────────────────────────────────────────────────────

/// Implemented by types that embed a [`RefCount`] field.
///
/// Replaces the Zig comptime parameters `field_name: []const u8`,
/// `destructor: anytype`, and `options: Options` passed to
/// `RefCount(T, field_name, destructor, options)`.
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
    unsafe fn destructor(this: *mut Self);
}

/// Unifying trait so `RefPtr<T>` works with either ref-count flavor.
///
/// PORT NOTE: Zig's `RefPtr` reflected on `@FieldType(T, "ref_count")` and the
/// private `is_ref_count == unique_symbol` marker to accept either mixin. In
/// Rust the trait bound IS that check.
pub trait AnyRefCounted: Sized {
    type DestructorCtx;

    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_ref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_deref(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn rc_deref_with_context(this: *mut Self, ctx: Self::DestructorCtx);
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
///         drop(unsafe { Box::from_raw(this) });
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
            // TODO(b0-genuine): was dump_current_stack_trace(ret, {frame_count:2, skip:[ref_count.zig]})
            dump_stack_hook(core::ptr::null(), return_address());
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
            // TODO(b0-genuine): was dump_current_stack_trace(ret, {frame_count:2, skip:[ref_count.zig]})
            dump_stack_hook(core::ptr::null(), return_address());
        }
        count.assert_single_threaded();
        count.raw_count.set(count.raw_count.get() - 1);
        if count.raw_count.get() == 0 {
            #[cfg(debug_assertions)]
            {
                // SAFETY: self_ is live; reinterpreting as bytes for debug tracking
                let bytes = unsafe {
                    core::slice::from_raw_parts(self_ as *const u8, size_of::<T>())
                };
                // SAFETY: count is &*get_ref_count(self_); we need &mut for deinit
                unsafe { (*T::get_ref_count(self_)).debug.deinit(bytes, return_address()) };
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
            // SAFETY: self is the `ref_count` field of a live T (Zig: @fieldParentPtr)
            let ptr: *mut T = unsafe {
                (self as *mut Self as *mut u8)
                    .sub(offset_of_ref_count::<T, Self>())
                    .cast::<T>()
            };
            self.debug.dump(
                Some(core::any::type_name::<T>().as_bytes()),
                ptr as *mut c_void,
                self.raw_count.get(),
            );
        }
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        if cfg!(feature = "ci_assert") {
            // TODO(port): bun.Environment.ci_assert → cfg feature name TBD
            debug_assert!(self.raw_count.get() == 0);
        }
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
    unsafe fn rc_deref(this: *mut Self) {
        // Zig's `deref(self)` forwards `{}` (void) and only compiles when
        // `destructor_ctx` is null. Rust cannot conjure a Ctx; callers with a
        // non-unit DestructorCtx must use `rc_deref_with_context`.
        // TODO(port): split blanket impl so this fn is only provided when
        // DestructorCtx = ().
        let _ = this;
        unimplemented!("rc_deref requires DestructorCtx = (); use rc_deref_with_context");
    }
    unsafe fn rc_deref_with_context(this: *mut Self, ctx: Self::DestructorCtx) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { RefCount::<T>::deref_with_context(this, ctx) }
    }
    unsafe fn rc_has_one_ref(this: *const Self) -> bool {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this as *mut Self)).has_one_ref() }
    }
    unsafe fn rc_assert_no_refs(this: *const Self) {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { (*T::get_ref_count(this as *mut Self)).assert_no_refs() }
    }
    #[cfg(debug_assertions)]
    unsafe fn rc_debug_data(this: *mut Self) -> *mut dyn DebugDataOps {
        // SAFETY: caller contract — `this` points to a live T
        unsafe { &mut (*T::get_ref_count(this)).debug as *mut _ }
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
                // SAFETY: self_ is live; reinterpreting as bytes for debug tracking
                let bytes = unsafe {
                    core::slice::from_raw_parts(self_ as *const u8, size_of::<T>())
                };
                // SAFETY: we hold the last ref; exclusive access
                unsafe { (*T::get_ref_count(self_)).debug.deinit(bytes, return_address()) };
            }
            // SAFETY: last ref dropped
            unsafe { T::destructor(self_) };
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
            // SAFETY: self is the `ref_count` field of a live T (Zig: @fieldParentPtr)
            let ptr: *mut T = unsafe {
                (self as *mut Self as *mut u8)
                    .sub(offset_of_ref_count_ts::<T, Self>())
                    .cast::<T>()
            };
            self.debug.dump(
                Some(core::any::type_name::<T>().as_bytes()),
                ptr as *mut c_void,
                self.raw_count.load(Ordering::SeqCst),
            );
        }
    }

    /// The count is 0 after the destructor is called.
    pub fn assert_no_refs(&self) {
        if cfg!(feature = "ci_assert") {
            debug_assert!(self.raw_count.load(Ordering::SeqCst) == 0);
        }
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

    // PORT NOTE: `getRefCount` / `is_ref_count` / `ref_count_options` — see
    // notes on RefCount above.
}

// TODO(port): blanket `impl<T: ThreadSafeRefCounted> AnyRefCounted for T`
// conflicts with the `RefCounted` blanket above (Rust forbids overlapping
// blanket impls). Phase B: either (a) make hosts impl `AnyRefCounted` directly
// via a derive macro, or (b) use a marker-type dispatch. For now only the
// single-threaded blanket is provided; thread-safe hosts must impl
// `AnyRefCounted` by hand.

// ──────────────────────────────────────────────────────────────────────────
// RefPtr
// ──────────────────────────────────────────────────────────────────────────

/// A pointer to an object implementing `RefCount` or `ThreadSafeRefCount`.
/// The benefit of this over `*mut T` is that instances of `RefPtr` are tracked.
///
/// By using this, you gain the following memory debugging tools:
///
/// - `T.ref_count.dump_active_refs()` to dump all active references.
/// - AllocationScope integration via `.new_tracked()` and `.track_all()`
///
/// If you want to enforce usage of RefPtr for memory management, you
/// can remove the forwarded `ref` and `deref` methods from `RefCount`.
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
        // PORT NOTE: Zig re-asserted `is_ref_count == unique_symbol` here;
        // the `T: AnyRefCounted` bound is that assertion.
        // SAFETY: caller contract
        unsafe { Self::unchecked_and_unsafe_init(raw_ptr, return_address()) }
    }

    // NOTE: would be nice to use a const for deref dispatch, but keep two
    // methods for clarity (matches Zig comment).

    /// Decrement the reference count, and destroy the object if the count is 0.
    pub fn deref(&self) {
        self.deref_with_context_impl(None);
    }

    /// Decrement the reference count, and destroy the object if the count is 0.
    pub fn deref_with_context(&self, ctx: T::DestructorCtx) {
        self.deref_with_context_impl(Some(ctx));
    }

    fn deref_with_context_impl(&self, ctx: Option<T::DestructorCtx>) {
        #[cfg(debug_assertions)]
        {
            // SAFETY: data is live (we hold a ref)
            unsafe { (*T::rc_debug_data(self.data.as_ptr())).release(self.debug, return_address()) };
        }
        // SAFETY: data is live (we hold a ref)
        unsafe {
            match ctx {
                Some(c) => T::rc_deref_with_context(self.data.as_ptr(), c),
                None => T::rc_deref(self.data.as_ptr()),
            }
        }
        #[cfg(debug_assertions)]
        {
            // make UAF fail faster (ideally integrate this with ASAN)
            // PORT NOTE: Zig did `@constCast(self).data = undefined`. In Rust
            // we cannot mutate through `&self` without UnsafeCell; and `RefPtr`
            // is consumed-by-value in idiomatic use anyway.
            // TODO(port): consider taking `self` by value and dropping.
        }
    }

    pub fn dupe_ref(&self) -> Self {
        // SAFETY: data is live (we hold a ref)
        unsafe { Self::init_ref(self.data.as_ptr()) }
    }

    /// Allocate a new object, returning a RefPtr to it.
    pub fn new(init_data: T) -> Self {
        // SAFETY: freshly boxed, ref_count == 1
        unsafe { Self::adopt_ref(Box::into_raw(Box::new(init_data))) }
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
        // PORT NOTE: Zig set `self.data = undefined`; taking `self` by value
        // here makes the RefPtr unusable, which is the same intent.
        ptr
    }

    /// This will assert that ALL references are cleaned up by the time the
    /// allocation scope ends.
    pub fn new_tracked(scope: &mut AllocationScope, init_data: T) -> Self {
        let ptr = Self::new(init_data);
        ptr.track_impl(scope, return_address());
        ptr
    }

    /// This will assert that ALL references are cleaned up by the time the
    /// allocation scope ends.
    pub fn track_all(&self, scope: &mut AllocationScope) {
        self.track_impl(scope, return_address());
    }

    fn track_impl(&self, scope: &mut AllocationScope, ret_addr: usize) {
        #[cfg(not(debug_assertions))]
        {
            let _ = (scope, ret_addr);
            return;
        }
        #[cfg(debug_assertions)]
        {
            // SAFETY: data is live (we hold a ref)
            let debug = unsafe { &mut *T::rc_debug_data(self.data.as_ptr()) };
            debug.track_in_scope(scope, self.data.as_ptr() as *mut c_void, size_of::<T>(), ret_addr);
        }
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

// ──────────────────────────────────────────────────────────────────────────
// TrackedRef / TrackedDeref
// ──────────────────────────────────────────────────────────────────────────

struct TrackedRef {
    acquired_at: StoredTrace,
}

/// Not an index, just a unique identifier for the debug data.
// PORT NOTE: Zig used `bun.GenericIndex(u32, TrackedRef)` (opaque type-tag).
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct TrackedRefId(u32);

impl TrackedRefId {
    #[inline]
    const fn new(n: u32) -> Self {
        Self(n)
    }
}

struct TrackedDeref {
    acquired_at: StoredTrace,
    released_at: StoredTrace,
}

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
    fn track_in_scope(
        &mut self,
        scope: &mut AllocationScope,
        data_ptr: *mut c_void,
        data_size: usize,
        ret_addr: usize,
    );
}

const MAGIC_VALID: u128 = 0x2f84_e51d;

/// Provides Ref tracking. This is not generic over the pointer T to reduce
/// analysis complexity.
// PORT NOTE: Zig parameterized on `comptime thread_safe: bool` and selected
// `Count`/`Lock` types accordingly. Rust cannot select a type from a const
// bool without a helper trait; instead we parameterize on the `Count` storage
// type directly (`Cell<u32>` or `AtomicU32`). The lock and `next_id` are made
// uniformly thread-safe (debug-only — perf irrelevant).
#[cfg(debug_assertions)]
pub struct DebugData<Count> {
    // TODO(port): Zig used `align(@alignOf(u32))` to reduce u128 alignment to
    // 4. Rust cannot under-align a field; consider `[u32; 4]` if layout matters.
    magic: u128,
    // TODO(port): Zig used `if (thread_safe) std.debug.SafetyLock else bun.Mutex`.
    lock: bun_core::Mutex,
    next_id: AtomicU32,
    map: HashMap<TrackedRefId, TrackedRef>,
    frees: ArrayHashMap<TrackedRefId, TrackedDeref>,
    // Allocation Scope integration
    // TODO(port): lifetime — LIFETIMES.tsv classifies this BORROW_PARAM (`&'a mut`)
    // but the scope outlives the &mut param passed to `track_in_scope`; Zig stored
    // a raw `*allocation_scope.AllocationScope`. Raw ptr (debug-only) for now.
    allocation_scope: Option<NonNull<AllocationScope>>,
    count_pointer: Option<NonNull<Count>>,
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugData<Count> {
    // PORT NOTE(b0): was `pub const EMPTY` — std HashMap::new() is non-const.
    pub fn empty() -> Self {
        Self {
            magic: MAGIC_VALID,
            lock: bun_core::Mutex::new(),
            next_id: AtomicU32::new(0),
            map: HashMap::new(),
            frees: ArrayHashMap::new(),
            allocation_scope: None,
            count_pointer: None,
        }
    }

    fn assert_valid(&self) {
        debug_assert!(self.magic == MAGIC_VALID);
    }

    fn dump(&mut self, type_name: Option<&[u8]>, ptr: *mut c_void, ref_count: u32) {
        self.lock.lock();
        let _guard = scopeguard::guard(&mut self.lock, |l| l.unlock());

        generic_dump(type_name, ptr, ref_count as usize, &mut self.map);
    }

    fn next_id(&self) -> TrackedRefId {
        // PORT NOTE: Zig branched on `thread_safe` (atomic RMW vs plain ++).
        // Debug-only path; always atomic here.
        TrackedRefId::new(self.next_id.fetch_add(1, Ordering::SeqCst))
    }

    fn acquire_with_count(
        &mut self,
        count_pointer: NonNull<Count>,
        return_address: usize,
    ) -> TrackedRefId {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // PORT NOTE: reshaped for borrowck — guard above borrows lock; below borrows other fields
        // TODO(port): scopeguard captures &mut self.lock disjointly; verify in Phase B
        self.count_pointer = Some(count_pointer);
        let id = self.next_id();
        self.map.insert(
            id,
            TrackedRef {
                acquired_at: StoredTrace::capture(return_address),
            },
        );
        id
    }

    fn release_impl(&mut self, id: TrackedRefId, return_address: usize) {
        self.lock.lock(); // If this triggers ASAN, the RefCounted object is double-freed.
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // TODO(port): scopeguard borrow split — see note in acquire_with_count
        let Some(entry) = self.map.remove(&id) else {
            return;
        };
        self.frees.insert(
            id,
            TrackedDeref {
                acquired_at: entry.acquired_at,
                released_at: StoredTrace::capture(return_address),
            },
        );
    }

    fn deinit(&mut self, data: &[u8], ret_addr: usize) {
        self.assert_valid();
        self.magic = 0; // Zig: `= undefined`
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // TODO(port): scopeguard borrow split — see note in acquire_with_count
        self.map.clear();
        self.map.shrink_to_fit();
        self.frees.clear();
        // TODO(port): ArrayHashMap shrink — Zig clearAndFree
        if let Some(mut scope) = self.allocation_scope {
            // SAFETY: scope was stored from a live `&mut AllocationScope` in
            // `track_in_scope`; debug-only raw backref (see field note).
            let _ = unsafe { scope.as_mut() }.track_external_free(data, ret_addr);
        }
    }

    fn on_allocation_leak(ptr: *mut c_void, data: &mut [u8]) {
        // SAFETY: vtable contract — ptr is &mut DebugData<Count>
        let debug: &mut Self = unsafe { &mut *(ptr.cast::<Self>()) };
        debug.lock.lock();
        let _guard = scopeguard::guard((), |_| debug.lock.unlock());
        // TODO(port): scopeguard borrow split
        // TODO(port): count_pointer not wired through the dyn `acquire` path
        // (only `acquire_with_count` sets it) — this unwrap will panic for
        // refs created via `RefPtr::unchecked_and_unsafe_init`.
        // SAFETY: count_pointer was set in acquire_with_count and points into
        // the sibling raw_count field, which lives as long as self.
        let count = unsafe { debug.count_pointer.unwrap().as_ref() };
        let ref_count = count.load_count();
        debug.dump(None, data.as_mut_ptr() as *mut c_void, ref_count);
    }

    fn get_scope_extra_vtable(&self) -> &'static allocation_scope::ExtraVTable {
        &SCOPE_EXTRA_VTABLE
    }
}

#[cfg(debug_assertions)]
impl<Count: CountLoad> DebugDataOps for DebugData<Count> {
    fn assert_valid_dyn(&self) {
        self.assert_valid();
    }

    fn acquire(&mut self, return_address: usize) -> TrackedRefId {
        // PORT NOTE: Zig's `acquire` took `count_pointer: *Count` because
        // `RefPtr.uncheckedAndUnsafeInit` reached into `raw_ptr.ref_count.raw_count`.
        // The dyn surface cannot name `Count`; the typed call site
        // (RefCount::ref_/ThreadSafeRefCount::ref_) wires the count_pointer
        // separately. Here we acquire without updating count_pointer.
        // TODO(port): plumb count_pointer through AnyRefCounted if leak-dump
        // needs it for RefPtr-created refs.
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        let id = self.next_id();
        self.map.insert(
            id,
            TrackedRef {
                acquired_at: StoredTrace::capture(return_address),
            },
        );
        id
    }

    fn release(&mut self, id: TrackedRefId, return_address: usize) {
        self.release_impl(id, return_address);
    }

    fn track_in_scope(
        &mut self,
        scope: &mut AllocationScope,
        data_ptr: *mut c_void,
        data_size: usize,
        ret_addr: usize,
    ) {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // SAFETY: data_ptr/data_size describe a live T allocation
        let bytes = unsafe { core::slice::from_raw_parts(data_ptr as *const u8, data_size) };
        scope.track_external_allocation(
            bytes,
            ret_addr,
            allocation_scope::Extra {
                ptr: self as *mut Self as *mut c_void,
                vtable: self.get_scope_extra_vtable(),
            },
        );
        // TODO(port): lifetime — TSV says `&'a mut` but the scope outlives this
        // borrow; raw ptr (debug-only). See field note on `allocation_scope`.
        self.allocation_scope = Some(NonNull::from(scope));
    }
}

#[cfg(debug_assertions)]
static SCOPE_EXTRA_VTABLE: allocation_scope::ExtraVTable = allocation_scope::ExtraVTable {
    // TODO(port): on_allocation_leak is generic over Count; a single static
    // vtable cannot name it. Phase B: either monomorphize two statics or
    // erase Count behind the dyn DebugDataOps surface.
    on_allocation_leak: on_allocation_leak_erased,
};

#[cfg(debug_assertions)]
fn on_allocation_leak_erased(_ptr: *mut c_void, _data: &mut [u8]) {
    // TODO(port): see SCOPE_EXTRA_VTABLE note.
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
    bun_core::Output::pretty_error(format_args!(
        "<blue>{}{}{:x} has ",
        bstr::BStr::new(type_name.unwrap_or(b"")),
        if type_name.is_some() { "@" } else { "" },
        ptr as usize,
    ));
    if tracked_refs > 0 {
        bun_core::Output::pretty_error(format_args!(
            "{} tracked{}",
            tracked_refs,
            if untracked_refs > 0 { ", " } else { "" },
        ));
    }
    if untracked_refs > 0 {
        bun_core::Output::pretty_error(format_args!("{} untracked refs<r>\n", untracked_refs));
    } else {
        bun_core::Output::pretty_error(format_args!("refs<r>\n"));
    }
    let mut i: usize = 0;
    for (_, entry) in map.iter() {
        bun_core::Output::pretty_error(format_args!("<b>RefPtr acquired at:<r>\n"));
        // TODO(b0-genuine): was dump_stack_trace(trace, AllocationScope::TRACE_LIMITS)
        dump_stack_hook(&entry.acquired_at, 0);
        i += 1;
        if i >= 3 {
            bun_core::Output::pretty_error(format_args!("  {} omitted ...\n", map.len() - i));
            break;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// maybe_assert_no_refs
// ──────────────────────────────────────────────────────────────────────────

/// Zig used `@hasField(T, "ref_count")` + `@hasDecl(Rc, "assertNoRefs")`
/// reflection to make this a no-op for non-ref-counted types. In Rust the
/// "has ref_count" check IS the trait bound.
// TODO(port): callers that passed non-ref-counted T must simply not call this.
pub fn maybe_assert_no_refs<T: AnyRefCounted>(ptr: &T) {
    // SAFETY: `ptr` is a live reference to T
    unsafe { T::rc_assert_no_refs(ptr as *const T) }
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
fn return_address() -> usize {
    // TODO(port): @returnAddress() — no stable Rust equivalent. Options:
    // (a) `extern "C" { fn __builtin_return_address(level: u32) -> *mut c_void; }`
    //     via a tiny C shim, or (b) inline asm per-arch. Debug-only.
    0
}

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count<T: RefCounted, Rc>() -> usize {
    // TODO(port): Zig used `@fieldParentPtr(field_name, count)`. Without the
    // field name as a const, compute via the trait: feed a dangling aligned T
    // and diff pointers. Phase B: derive macro emits `offset_of!(T, ref_count)`.
    let _ = core::mem::size_of::<Rc>();
    0
}

#[cfg(debug_assertions)]
#[inline(always)]
fn offset_of_ref_count_ts<T: ThreadSafeRefCounted, Rc>() -> usize {
    // TODO(port): see offset_of_ref_count.
    let _ = core::mem::size_of::<Rc>();
    0
}

// PORT NOTE: `const unique_symbol = opaque {};` — type-identity marker for
// comptime assertion in `RefPtr`. Replaced by `AnyRefCounted` trait bound.

bun_core::declare_scope!(ref_count, hidden);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/ref_count.zig (629 lines)
//   confidence: low
//   todos:      23
//   notes:      Heavy comptime mixin → trait reshaping; DebugData.allocation_scope stored as raw NonNull (TSV says BORROW_PARAM but borrow can't outlive param); AnyRefCounted blanket-impl overlap (RefCounted vs ThreadSafeRefCounted) unresolved; rc_deref unimplemented for non-unit DestructorCtx; @returnAddress/@fieldParentPtr stubbed.
// ──────────────────────────────────────────────────────────────────────────
