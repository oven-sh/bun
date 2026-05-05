//! AllocationScope wraps another allocator, providing leak and invalid free assertions.
//! It also allows measuring how much memory a scope has allocated.

use core::ffi::c_void;

use bun_collections::{ArrayHashMap};
use bun_core::Output;
use bun_crash_handler::{self as crash_handler, StoredTrace, WriteStackTraceLimits};
use bun_threading::Guarded;

// TODO(port): `std.mem.Allocator` is Zig's fat-pointer (ptr + vtable) dynamic allocator handle.
// `bun_alloc` must expose an equivalent (`crate::StdAllocator` here) for the parent-allocator
// plumbing below. Phase B: define `StdAllocator { ptr: *mut c_void, vtable: &'static AllocatorVTable }`
// or replace with `&'static dyn crate::Allocator`.
use crate::StdAllocator;

/// An allocation scope with a dynamically typed parent allocator. Prefer using a concrete type,
/// like `AllocationScopeIn<bun_alloc::DefaultAllocator>`.
pub type AllocationScope = AllocationScopeIn<StdAllocator>;

pub struct Allocation {
    pub allocated_at: StoredTrace,
    pub len: usize,
    pub extra: Extra,
}

pub struct Free {
    pub allocated_at: StoredTrace,
    pub freed_at: StoredTrace,
}

pub struct Extra {
    pub ptr: *mut (),
    pub vtable: Option<&'static ExtraVTable>,
}

impl Extra {
    pub const NONE: Extra = Extra { ptr: core::ptr::null_mut(), vtable: None };
}

pub struct ExtraVTable {
    pub on_allocation_leak: fn(*mut (), &mut [u8]),
}

pub struct Stats {
    pub total_memory_allocated: usize,
    pub num_allocations: usize,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FreeError {
    /// Tried to free memory that wasn't allocated by this `AllocationScope`, or was already freed.
    #[error("NotAllocated")]
    NotAllocated,
}

impl From<FreeError> for bun_core::Error {
    fn from(e: FreeError) -> Self {
        match e {
            FreeError::NotAllocated => bun_core::err!("NotAllocated"),
        }
    }
}

// TODO(port): `bun.Environment.enableAllocScopes` — map to a cargo feature; Phase B wires the flag.
pub const ENABLED: bool = cfg!(feature = "alloc_scopes");
pub const MAX_FREE_TRACKING: usize = 2048 - 1;

#[derive(Default)]
struct History {
    total_memory_allocated: usize,
    /// Allocated by `State.parent`.
    // TODO(port): Zig keys on `[*]const u8` (raw many-pointer). Using `*const u8` here; ensure
    // `bun_collections::HashMap` accepts raw-pointer keys (wyhash on address bits).
    allocations: HashMap<*const u8, Allocation>,
    /// Allocated by `State.parent`.
    frees: ArrayHashMap<*const u8, Free>,
    /// Once `frees` fills up, entries are overwritten from start to end.
    // Zig: `std.math.IntFittingRange(0, max_free_tracking + 1)` → fits in u16 (range 0..=2048).
    free_overwrite_index: u16,
}

// `History.deinit(allocator)` in Zig only frees the two maps via `parent`. In Rust the maps own
// their storage (global mimalloc) and drop automatically — no explicit Drop body needed.

struct LockedState<'a> {
    /// Should be the same as `State.parent`.
    parent: StdAllocator,
    history: &'a mut History,
}

impl<'a> LockedState<'a> {
    fn alloc(&mut self, len: usize, alignment: usize, ret_addr: usize) -> Result<*mut u8, crate::AllocError> {
        // TODO(port): `self.parent.rawAlloc/rawFree` — call through the bun_alloc dynamic-allocator
        // vtable (`StdAllocator::raw_alloc` / `raw_free`).
        let result = self.parent.raw_alloc(len, alignment, ret_addr).ok_or(crate::AllocError)?;
        // PORT NOTE: reshaped for borrowck — copy `parent` out so the errdefer guard doesn't hold
        // `&self` across the `&mut self` call to `track_allocation`.
        let parent = self.parent;
        let guard = scopeguard::guard((), |_| {
            // SAFETY: `result` was just returned by `raw_alloc` for `len` bytes at `alignment`.
            unsafe { parent.raw_free(core::slice::from_raw_parts_mut(result, len), alignment, ret_addr) };
        });
        // SAFETY: `result` points to `len` valid bytes just allocated.
        self.track_allocation(unsafe { core::slice::from_raw_parts(result, len) }, ret_addr, Extra::NONE)?;
        scopeguard::ScopeGuard::into_inner(guard);
        Ok(result)
    }

    fn free(&mut self, buf: &mut [u8], alignment: usize, ret_addr: usize) {
        let success = match self.track_free(buf, ret_addr) {
            Ok(()) => true,
            Err(FreeError::NotAllocated) => false,
        };
        // TODO(port): `bun.Environment.enable_asan` → cargo feature / cfg.
        if success || cfg!(feature = "asan") {
            self.parent.raw_free(buf, alignment, ret_addr);
        }
        if !success {
            // If asan did not catch the free, panic now.
            panic!("Invalid free: {:p}", buf.as_ptr());
        }
    }

    // TODO(port): Zig `ptr: anytype` dispatched on `@typeInfo(..).pointer.size` (one/many/c vs slice
    // with len-0 early return). Rust callers must pass the base `*const u8` and handle the empty-slice
    // short-circuit themselves; revisit with a small `AsBytePtr` trait if call sites need ergonomics.
    fn assert_owned(&self, cast_ptr: *const u8) {
        if !self.history.allocations.contains_key(&cast_ptr) {
            panic!("this pointer was not owned by the allocation scope");
        }
    }

    fn assert_unowned(&self, cast_ptr: *const u8) {
        if let Some(owned) = self.history.allocations.get(&cast_ptr) {
            Output::warn("Owned pointer allocated here:");
            crash_handler::dump_stack_trace(owned.allocated_at.trace(), TRACE_LIMITS, TRACE_LIMITS);
            panic!("this pointer was owned by the allocation scope when it was not supposed to be");
        }
    }

    fn track_allocation(&mut self, buf: &[u8], ret_addr: usize, extra: Extra) -> Result<(), crate::AllocError> {
        let trace = StoredTrace::capture(ret_addr);
        // TODO(port): `putNoClobber` asserts the key is new. `bun_collections::HashMap` should expose
        // an equivalent; using `insert` + debug_assert for now.
        let prev = self.history.allocations.insert(
            buf.as_ptr(),
            Allocation { allocated_at: trace, len: buf.len(), extra },
        );
        debug_assert!(prev.is_none());
        self.history.total_memory_allocated += buf.len();
        Ok(())
    }

    fn track_free(&mut self, buf: &[u8], ret_addr: usize) -> Result<(), FreeError> {
        let Some(entry) = self.history.allocations.remove(&buf.as_ptr()) else {
            Output::err_generic(format_args!("Invalid free, pointer {:p}, len {}", buf.as_ptr(), buf.len()));

            if let Some(free_entry) = self.history.frees.get(&buf.as_ptr()) {
                Output::print_errorln(format_args!("Pointer allocated here:"));
                crash_handler::dump_stack_trace(free_entry.allocated_at.trace(), TRACE_LIMITS);
                Output::print_errorln(format_args!("Pointer first freed here:"));
                crash_handler::dump_stack_trace(free_entry.freed_at.trace(), FREE_TRACE_LIMITS);
            }

            // do not panic because address sanitizer will catch this case better.
            // the log message is in case there is a situation where address
            // sanitizer does not catch the invalid free.
            return Err(FreeError::NotAllocated);
        };

        self.history.total_memory_allocated -= entry.len;

        // Store a limited amount of free entries
        if self.history.frees.len() >= MAX_FREE_TRACKING {
            let i = self.history.free_overwrite_index;
            self.history.free_overwrite_index =
                (self.history.free_overwrite_index + 1) % (MAX_FREE_TRACKING as u16);
            self.history.frees.swap_remove_at(usize::from(i));
        }

        // Zig: `catch |err| bun.handleOom(err)` — Rust HashMap insert aborts on OOM by default.
        self.history.frees.insert(
            buf.as_ptr(),
            Free { allocated_at: entry.allocated_at, freed_at: StoredTrace::capture(ret_addr) },
        );
        Ok(())
    }
}

struct State {
    /// This field should not be modified. Therefore, it doesn't need to be protected by the mutex.
    parent: StdAllocator,
    history: Guarded<History>,
}

impl State {
    fn init(parent_alloc: StdAllocator) -> Self {
        Self { parent: parent_alloc, history: Guarded::init(History::default()) }
    }

    fn lock(&self) -> LockedState<'_> {
        LockedState { parent: self.parent, history: self.history.lock() }
    }

    fn unlock(&self) {
        self.history.unlock();
    }

    fn track_external_allocation(&self, ptr: &[u8], ret_addr: Option<usize>, extra: Extra) {
        let mut locked = self.lock();
        let _g = scopeguard::guard((), |_| self.unlock());
        // Zig: `catch |err| bun.handleOom(err)` — abort-on-OOM is the Rust default.
        let _ = locked.track_allocation(ptr, ret_addr.unwrap_or_else(return_address), extra);
    }

    // TODO(port): Zig `slice: anytype` accepted `[]u8` and `[:sentinel]u8`, widening sentinel slices
    // by +1 to include the terminator. Rust callers pass `&[u8]`; sentinel handling must happen at
    // the call site (e.g. `&buf[..len + 1]`).
    fn track_external_free(&self, ptr: &[u8], ret_addr: Option<usize>) -> Result<(), FreeError> {
        // Empty slice usually means invalid pointer
        if ptr.is_empty() {
            return Ok(());
        }
        let mut locked = self.lock();
        let _g = scopeguard::guard((), |_| self.unlock());
        locked.track_free(ptr, ret_addr.unwrap_or_else(return_address))
    }

    fn set_pointer_extra(&self, ptr: *mut c_void, extra: Extra) {
        let mut locked = self.lock();
        let _g = scopeguard::guard((), |_| self.unlock());
        let allocation = locked
            .history
            .allocations
            .get_mut(&(ptr as *const u8))
            .unwrap_or_else(|| panic!("Pointer not owned by allocation scope"));
        allocation.extra = extra;
    }
}

impl Drop for State {
    fn drop(&mut self) {
        let history = self.history.into_unprotected();

        let count = history.allocations.len();
        if count == 0 {
            return;
        }
        Output::err_generic(format_args!(
            "Allocation scope leaked {} allocations ({})",
            count,
            bun_core::fmt::size(history.total_memory_allocated, Default::default()),
        ));

        let mut n: usize = 0;
        for (key, value) in history.allocations.iter() {
            if n >= 10 {
                Output::pretty_errorln(format_args!("(only showing first 10 leaks)"));
                break;
            }
            Output::pretty_errorln(format_args!("- {:p}, len {}, at:", *key, value.len));
            crash_handler::dump_stack_trace(value.allocated_at.trace(), TRACE_LIMITS);
            let extra = &value.extra;
            if let Some(extra_vtable) = extra.vtable {
                // SAFETY: key is the original allocation base pointer for `value.len` bytes,
                // still live (it leaked).
                let data = unsafe { core::slice::from_raw_parts_mut(*key as *mut u8, value.len) };
                (extra_vtable.on_allocation_leak)(extra.ptr, data);
            }
            n += 1;
        }

        Output::panic(format_args!(
            "Allocation scope leaked {}",
            bun_core::fmt::size(history.total_memory_allocated, Default::default()),
        ));
    }
}

/// An allocation scope that uses a specific kind of parent allocator.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
//
// Zig: `pub fn AllocationScopeIn(comptime Allocator: type) type { return struct { ... } }`
// with a nested `BorrowedScope = struct { ... }` accessible as `AllocationScope.Borrowed`.
pub struct AllocationScopeIn<A> {
    parent: A,
    // Zig: `if (enabled) Owned(*State) else void` — Rust can't branch a field type on a const bool;
    // gate the field on the same cfg that defines ENABLED.
    #[cfg(feature = "alloc_scopes")]
    state: Box<State>,
    #[cfg(not(feature = "alloc_scopes"))]
    state: (),
}

/// Borrowed version of `AllocationScope`, returned by `AllocationScope::borrow`.
/// Using this type makes it clear who actually owns the `AllocationScope`, and prevents
/// `deinit` from being called twice.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub struct Borrowed<'a, A> {
    parent: crate::Borrowed<A>,
    #[cfg(feature = "alloc_scopes")]
    state: &'a State,
    #[cfg(not(feature = "alloc_scopes"))]
    state: core::marker::PhantomData<&'a ()>,
}

impl<'a, A> Borrowed<'a, A> {
    pub fn allocator(&self) -> StdAllocator {
        #[cfg(feature = "alloc_scopes")]
        {
            // TODO(port): construct the `StdAllocator { ptr: self.state, vtable: &VTABLE }` fat
            // pointer once `StdAllocator`'s shape is fixed in Phase B.
            StdAllocator::from_raw(self.state as *const State as *mut c_void, &VTABLE)
        }
        #[cfg(not(feature = "alloc_scopes"))]
        {
            crate::as_std(&self.parent)
        }
    }

    pub fn parent(&self) -> crate::Borrowed<A> {
        self.parent
    }

    // Zig `deinit` only forwarded to `bun.memory.deinit(&self.#parent)` (a "call deinit if it has
    // one" helper) and poisoned `self`. In Rust, `crate::Borrowed<A>` drops itself; nothing to do.

    pub fn stats(&self) -> Stats {
        #[cfg(not(feature = "alloc_scopes"))]
        {
            // Zig: `@compileError("AllocationScope must be enabled")`
            // TODO(port): no direct equivalent for a compile-error-on-call in Rust without making
            // this fn cfg-gated entirely. Panic at runtime in disabled builds.
            unreachable!("AllocationScope must be enabled");
        }
        #[cfg(feature = "alloc_scopes")]
        {
            let state = self.state.lock();
            let _g = scopeguard::guard((), |_| self.state.unlock());
            Stats {
                total_memory_allocated: state.history.total_memory_allocated,
                num_allocations: state.history.allocations.len(),
            }
        }
    }

    pub fn assert_owned<T: ?Sized>(&self, ptr: *const T) {
        #[cfg(feature = "alloc_scopes")]
        {
            // TODO(port): see LockedState::assert_owned note re: anytype slice handling.
            let state = self.state.lock();
            let _g = scopeguard::guard((), |_| self.state.unlock());
            state.assert_owned(ptr as *const u8);
        }
        #[cfg(not(feature = "alloc_scopes"))]
        let _ = ptr;
    }

    pub fn assert_unowned<T: ?Sized>(&self, ptr: *const T) {
        #[cfg(feature = "alloc_scopes")]
        {
            let state = self.state.lock();
            let _g = scopeguard::guard((), |_| self.state.unlock());
            state.assert_unowned(ptr as *const u8);
        }
        #[cfg(not(feature = "alloc_scopes"))]
        let _ = ptr;
    }

    pub fn track_external_allocation(&self, ptr: &[u8], ret_addr: Option<usize>, extra: Extra) {
        #[cfg(feature = "alloc_scopes")]
        self.state.track_external_allocation(ptr, ret_addr, extra);
        #[cfg(not(feature = "alloc_scopes"))]
        let _ = (ptr, ret_addr, extra);
    }

    pub fn track_external_free(&self, slice: &[u8], ret_addr: Option<usize>) -> Result<(), FreeError> {
        #[cfg(feature = "alloc_scopes")]
        {
            return self.state.track_external_free(slice, ret_addr);
        }
        #[cfg(not(feature = "alloc_scopes"))]
        {
            let _ = (slice, ret_addr);
            Ok(())
        }
    }

    pub fn set_pointer_extra(&self, ptr: *mut c_void, extra: Extra) {
        #[cfg(feature = "alloc_scopes")]
        self.state.set_pointer_extra(ptr, extra);
        #[cfg(not(feature = "alloc_scopes"))]
        let _ = (ptr, extra);
    }

    fn downcast_impl(
        std_alloc: StdAllocator,
        // Zig: `if (Allocator == std.mem.Allocator) ?BorrowedAllocator else BorrowedAllocator`
        // TODO(port): type-equality dispatch on `A == StdAllocator` has no direct Rust spelling.
        // Phase B: specialize via a sealed trait or split into two inherent fns per concrete `A`.
        parent_alloc: Option<crate::Borrowed<A>>,
    ) -> Self {
        #[cfg(feature = "alloc_scopes")]
        let state: &'a State = 'blk: {
            debug_assert!(
                std_alloc.vtable() == &VTABLE,
                "allocator is not an allocation scope (has vtable {:p})",
                std_alloc.vtable(),
            );
            // SAFETY: vtable check above proves `std_alloc.ptr` is a `*State` we boxed in `init`.
            break 'blk unsafe { &*(std_alloc.ptr() as *const State) };
        };

        #[cfg(feature = "alloc_scopes")]
        let current_std_parent = state.parent;
        #[cfg(not(feature = "alloc_scopes"))]
        let current_std_parent = std_alloc;

        // TODO(port): `Allocator == std.mem.Allocator` branch collapsed; see note on parent_alloc.
        let new_parent = parent_alloc.unwrap_or_else(|| {
            // Only valid when A == StdAllocator; Phase B specialization enforces this.
            // TODO(port): unreachable for non-StdAllocator A.
            // SAFETY: only reachable when `A == StdAllocator` (Phase B specialization enforces);
            // `transmute_copy` is then `StdAllocator → crate::Borrowed<StdAllocator>`, same layout.
            unsafe { core::mem::transmute_copy(&current_std_parent) }
        });

        let new_std_parent = crate::as_std(&new_parent);
        // TODO(port): `bun.safety.alloc.assertEqFmt` — debug-only allocator-equality check.
        bun_safety::alloc::assert_eq_fmt::alloc::assert_eq_fmt(
            current_std_parent,
            new_std_parent,
            "tried to downcast allocation scope with wrong parent allocator",
        );
        Self {
            parent: new_parent,
            #[cfg(feature = "alloc_scopes")]
            state,
            #[cfg(not(feature = "alloc_scopes"))]
            state: core::marker::PhantomData,
        }
    }

    /// Converts an `std.mem.Allocator` into a borrowed allocation scope, with a given parent
    /// allocator.
    ///
    /// Requirements:
    ///
    /// * `std_alloc` must have come from `AllocationScopeIn<A>::allocator` (or the
    ///   equivalent method on a `Borrowed` instance).
    ///
    /// * `parent_alloc` must be equivalent to the (borrowed) parent allocator of the original
    ///   allocation scope (that is, the return value of `AllocationScopeIn<A>::parent`).
    ///   In particular, `bun_alloc::as_std` must return the same value for each allocator.
    pub fn downcast_in(std_alloc: StdAllocator, parent_alloc: crate::Borrowed<A>) -> Self {
        Self::downcast_impl(std_alloc, Some(parent_alloc))
    }

    /// Converts an `std.mem.Allocator` into a borrowed allocation scope.
    ///
    /// Requirements:
    ///
    /// * `std_alloc` must have come from `AllocationScopeIn<A>::allocator` (or the
    ///   equivalent method on a `Borrowed` instance).
    ///
    /// * One of the following must be true:
    ///
    ///   1. `A` is `StdAllocator`.
    ///
    ///   2. The parent allocator of the original allocation scope is equivalent to a
    ///      default-initialized borrowed `A`, as returned by
    ///      `bun_core::memory::init_default::<crate::Borrowed<A>>()`. This is the case
    ///      for `bun_alloc::DefaultAllocator`.
    pub fn downcast(std_alloc: StdAllocator) -> Self
    where
        crate::Borrowed<A>: Default,
    {
        // TODO(port): Zig branched on `Allocator == std.mem.Allocator` to pass `null` here.
        // Collapsed to the `initDefault` path; Phase B specializes for `A = StdAllocator`.
        Self::downcast_impl(std_alloc, Some(crate::memory::init_default::init_default::<crate::Borrowed<A>>()))
    }
}

impl<A> AllocationScopeIn<A> {
    pub const ENABLED: bool = ENABLED;

    pub fn init(parent_alloc: A) -> Self {
        #[cfg(feature = "alloc_scopes")]
        let state = Box::new(State::init(crate::as_std(&parent_alloc)));
        Self {
            parent: parent_alloc,
            #[cfg(feature = "alloc_scopes")]
            state,
            #[cfg(not(feature = "alloc_scopes"))]
            state: (),
        }
    }

    pub fn init_default() -> Self
    where
        A: Default,
    {
        Self::init(crate::memory::init_default::init_default::<A>())
    }

    /// Borrows this `AllocationScope`. Use this method instead of copying `self`, as that makes
    /// it hard to know who owns the `AllocationScope`, and could lead to `deinit` being called
    /// twice.
    pub fn borrow(&self) -> Borrowed<'_, A> {
        Borrowed {
            parent: self.parent(),
            #[cfg(feature = "alloc_scopes")]
            state: &*self.state,
            #[cfg(not(feature = "alloc_scopes"))]
            state: core::marker::PhantomData,
        }
    }

    pub fn allocator(&self) -> StdAllocator {
        self.borrow().allocator()
    }

    // Zig `deinit`: `bun.memory.deinit(&self.#parent)` + `self.#state.deinit()`. Both are handled
    // by Rust's field Drop (`A` drops itself if it owns anything; `Box<State>` drops `State` which
    // runs the leak report). No explicit `impl Drop` needed beyond what fields provide.

    pub fn parent(&self) -> crate::Borrowed<A> {
        crate::borrow(&self.parent)
    }

    pub fn stats(&self) -> Stats {
        self.borrow().stats()
    }

    pub fn assert_owned<T: ?Sized>(&self, ptr: *const T) {
        self.borrow().assert_owned(ptr);
    }

    pub fn assert_unowned<T: ?Sized>(&self, ptr: *const T) {
        self.borrow().assert_unowned(ptr);
    }

    /// Track an arbitrary pointer. Extra data can be stored in the allocation, which will be
    /// printed when a leak is detected.
    pub fn track_external_allocation(&self, ptr: &[u8], ret_addr: Option<usize>, extra: Extra) {
        self.borrow().track_external_allocation(ptr, ret_addr, extra);
    }

    /// Call when the pointer from `track_external_allocation` is freed.
    pub fn track_external_free(&self, slice: &[u8], ret_addr: Option<usize>) -> Result<(), FreeError> {
        self.borrow().track_external_free(slice, ret_addr)
    }

    pub fn set_pointer_extra(&self, ptr: *mut c_void, extra: Extra) {
        self.borrow().set_pointer_extra(ptr, extra)
    }

    pub fn leak_slice(&self, memory: &[u8]) {
        #[cfg(feature = "alloc_scopes")]
        {
            // Zig asserted `@typeInfo(..).pointer` at comptime; Rust signature already enforces slice.
            self.track_external_free(memory, None)
                .unwrap_or_else(|_| panic!("tried to free memory that was not allocated by the allocation scope"));
        }
        #[cfg(not(feature = "alloc_scopes"))]
        let _ = memory;
    }
}

// TODO(port): `std.mem.Allocator.VTable` — Phase B defines `crate::AllocatorVTable` matching the
// Zig allocator interface (alloc/resize/remap/free). `noResize`/`noRemap` are stock no-op impls.
static VTABLE: crate::AllocatorVTable = crate::AllocatorVTable {
    alloc: vtable_alloc,
    resize: crate::no_resize,
    remap: crate::no_remap,
    free: vtable_free,
};

// Smaller traces since AllocationScope prints so many
pub const TRACE_LIMITS: WriteStackTraceLimits = WriteStackTraceLimits {
    frame_count: 6,
    stop_at_jsc_llint: true,
    skip_stdlib: true,
};

pub const FREE_TRACE_LIMITS: WriteStackTraceLimits = WriteStackTraceLimits {
    frame_count: 3,
    stop_at_jsc_llint: true,
    skip_stdlib: true,
};

extern "C" fn vtable_alloc(ctx: *mut c_void, len: usize, alignment: usize, ret_addr: usize) -> *mut u8 {
    // SAFETY: `ctx` is the `*State` we stored in `Borrowed::allocator()`; vtable is only ever
    // paired with that pointer.
    let raw_state: &State = unsafe { &*(ctx as *const State) };
    let mut state = raw_state.lock();
    let _g = scopeguard::guard((), |_| raw_state.unlock());
    state.alloc(len, alignment, ret_addr).unwrap_or(core::ptr::null_mut())
}

extern "C" fn vtable_free(ctx: *mut c_void, buf_ptr: *mut u8, buf_len: usize, alignment: usize, ret_addr: usize) {
    // SAFETY: see `vtable_alloc`.
    let raw_state: &State = unsafe { &*(ctx as *const State) };
    let mut state = raw_state.lock();
    let _g = scopeguard::guard((), |_| raw_state.unlock());
    // SAFETY: caller (allocator interface) guarantees `buf_ptr[..buf_len]` was returned by
    // `vtable_alloc` and is being freed exactly once.
    let buf = unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) };
    state.free(buf, alignment, ret_addr);
}

#[inline]
pub fn is_instance(allocator: StdAllocator) -> bool {
    ENABLED && core::ptr::eq(allocator.vtable(), &VTABLE)
}

#[inline]
fn return_address() -> usize {
    // TODO(port): `@returnAddress()` — no stable Rust intrinsic. Phase B: thread `Location::caller()`
    // via `#[track_caller]` or capture from `StoredTrace` directly. Returning 0 disables the
    // ret_addr-based frame skip but keeps traces functional.
    0
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/allocation_scope.zig (561 lines)
//   confidence: medium
//   todos:      18
//   notes:      StdAllocator/AllocatorVTable shape + `A == StdAllocator` specialization deferred; `if(enabled) T else void` mapped to cfg(feature="alloc_scopes"); anytype ptr/slice params narrowed to *const u8 / &[u8]; LockedState mutators take &mut self (no raw-ptr borrowck escape)
// ──────────────────────────────────────────────────────────────────────────
