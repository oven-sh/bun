//! Isolated event loop for spawnSync operations.
//!
//! This provides a completely separate event loop instance to ensure that:
//! - JavaScript timers don't fire during spawnSync
//! - stdin/stdout from the main process aren't affected
//! - The subprocess runs in complete isolation
//! - We don't recursively run the main event loop
//!
//! Implementation approach:
//! - Creates a separate uws.Loop instance with its own kqueue/epoll fd (POSIX) or completion port (Windows)
//! - Wraps it in a full jsc.EventLoop instance whose `uws_loop` is the isolated loop
//! - What the call makes for its child is handed that EventLoop, and so counts on the isolated loop
//! - Nothing else can reach it: a finalizer that runs during the wait finds the thread's own loop
//! - Minimal handler callbacks (wakeup/pre/post are no-ops)
//!
//! Similar to Node.js's approach in vendor/node/src/spawn_sync.cc but adapted for Bun's architecture.

use core::cell::Cell;
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_uws as uws;

// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

// LAYERING: `bun_event_loop` sits below `bun_jsc`, so it cannot name
// `jsc::EventLoop` / `jsc::VirtualMachine`. The bodies live in `bun_jsc` as
// `#[no_mangle]` Rust-ABI fns, declared here as `extern "Rust"` and resolved
// at link time — no vtable, no `AtomicPtr`, no init-order hazard.
// spawnSync is per-process-spawn, not per-tick, so the cross-crate call is fine.
// All bodies are defined as safe `pub fn` in `bun_jsc::event_loop` (the impl
// encapsulates the erased-pointer derefs), so the declarations are `safe fn` —
// no caller-side `unsafe { }` needed.
unsafe extern "Rust" {
    /// Heap-allocate and zero-init a `jsc::EventLoop` bound to `vm`, running
    /// on `uws_loop`. Returns erased `*mut jsc::EventLoop`.
    safe fn __bun_spawn_sync_create_event_loop(vm: *mut (), uws_loop: *mut uws::Loop) -> *mut ();
    safe fn __bun_spawn_sync_destroy_event_loop(el: *mut ());
    /// Re-bind `event_loop.{global, virtual_machine}` to `vm` (prepare path).
    safe fn __bun_spawn_sync_event_loop_set_vm(el: *mut (), vm: *mut ());
    safe fn __bun_spawn_sync_event_loop_tick_tasks_only(el: *mut ());
    /// Swap `vm.suppress_microtask_drain`, return previous.
    safe fn __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm: *mut (), v: bool) -> bool;
}

/// RAII scope that sets `vm.suppress_microtask_drain = true` for its lifetime
/// and restores the prior value on drop.
struct SuppressMicrotaskDrain {
    vm: *mut (),
    prev: bool,
}

impl SuppressMicrotaskDrain {
    /// `vm` is the erased `*mut jsc::VirtualMachine` backref; the swap extern
    /// is a safe `pub fn` (impl encapsulates the deref), so no caller-side
    /// precondition remains here.
    #[inline]
    fn new(vm: *mut ()) -> Self {
        let prev = __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm, true);
        Self { vm, prev }
    }
}

impl Drop for SuppressMicrotaskDrain {
    #[inline]
    fn drop(&mut self) {
        __bun_spawn_sync_vm_swap_suppress_microtask_drain(self.vm, self.prev);
    }
}

/// Shared borrows only once `init` is through: what a tick dispatches finds its way back here while
/// the tick is still on the stack, so whatever changes is in a `Cell`.
pub struct SpawnSyncEventLoop {
    /// Separate JSC EventLoop instance for this spawnSync
    /// This is a FULL event loop, not just a handle
    // SAFETY: erased `*mut jsc::EventLoop`, heap-owned via `__bun_spawn_sync_{create,destroy}_event_loop`.
    event_loop: *mut (),

    /// Erased `*mut jsc::VirtualMachine` backref (set in `init`/`prepare`).
    vm: Cell<*mut ()>,

    /// Completely separate uws.Loop instance - critical for avoiding recursive event loop execution
    // FFI-owned handle created via `uws::Loop::create`, freed in Drop via
    // `Loop::deinit`. Kept as raw because `uws::Loop` is an opaque C type and its address is
    // stored back into `internal_loop_data` (self-referential w.r.t. `event_loop`).
    uws_loop: NonNull<uws::Loop>,
}

/// Minimal handler for the isolated loop
mod handler {
    use super::uws;

    // No-op handlers: the pointer arg is never dereferenced. Safe fn items
    // coerce to the `unsafe extern "C" fn` slots in `uws::LoopHandler` below.
    extern "C" fn wakeup(_loop: *mut uws::Loop) {
        // No-op: we don't need to wake up from another thread for spawnSync
    }

    extern "C" fn pre(_loop: *mut uws::Loop) {
        // No-op: no pre-tick work needed for spawnSync
    }

    extern "C" fn post(_loop: *mut uws::Loop) {
        // No-op: no post-tick work needed for spawnSync
    }

    /// Adapter for `uws::Loop::create<H: LoopHandler>()` — a trait
    /// with associated `const fn`-ptr slots.
    pub(super) struct Handler;
    impl uws::LoopHandler for Handler {
        const WAKEUP: unsafe extern "C" fn(*mut uws::Loop) = wakeup;
        const PRE: Option<unsafe extern "C" fn(*mut uws::Loop)> = Some(pre);
        const POST: Option<unsafe extern "C" fn(*mut uws::Loop)> = Some(post);
    }
}

impl SpawnSyncEventLoop {
    /// `None` if the isolated loop cannot be created.
    pub fn init(vm: *mut () /* SAFETY: erased *mut VirtualMachine */) -> Option<Box<Self>> {
        // `uws::Loop::create` takes a `LoopHandler` impl with associated-const fn ptrs.
        let loop_ = uws::Loop::create::<handler::Handler>()?;

        // A fresh `jsc::EventLoop` whose `uws_loop` is the isolated loop.
        let event_loop = __bun_spawn_sync_create_event_loop(vm, loop_.as_ptr());

        let this = Box::new(Self {
            uws_loop: loop_,
            event_loop,
            vm: Cell::new(vm),
        });

        // Set up the loop's internal data to point to this isolated event loop
        // sys-level API is `set_parent_raw(tag, ptr)`. Tag 1 = JS, tag 2 = mini.
        // `this.event_loop` is the live heap-owned `*mut jsc::EventLoop`
        // returned by `__bun_spawn_sync_create_event_loop` immediately above —
        // never null on a successful create.
        debug_assert!(!this.event_loop.is_null(), "spawn-sync event loop alloc");
        let (tag, ptr) = EventLoopHandle::init(this.event_loop).into_tag_ptr();
        let loop_data = &this.uws_loop().internal_loop_data;
        loop_data.set_parent_raw(tag, ptr);
        loop_data.jsc_vm.set(core::ptr::null());
        Some(this)
    }

    /// Erased `*mut bun_jsc::event_loop::EventLoop` (heap-owned via
    /// `__bun_spawn_sync_create_event_loop`). `bun_event_loop` sits below
    /// `bun_jsc` so the concrete type is opaque here; callers in higher tiers
    /// cast back. See `js_bun_spawn_bindings::spawn_maybe_sync`.
    ///
    /// Intentionally raw-ptr (no `&`-returning variant): the pointee type is
    /// erased at this layer, and the `jsc::EventLoop` is mutated across the
    /// `extern "Rust"` shims while this struct is live.
    #[inline]
    pub fn event_loop_ptr(&self) -> *mut () {
        self.event_loop
    }

    /// The isolated `uws::Loop`. Private: `create` makes it without uWS's `LoopData`, which
    /// `update_date` and `flush_pending_writes` need.
    #[inline]
    fn uws_loop(&self) -> &uws::Loop {
        // SAFETY: set in `init` and freed only in `Drop`.
        unsafe { self.uws_loop.as_ref() }
    }
}

impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
        // Destroy the event loop before the uws loop.
        __bun_spawn_sync_destroy_event_loop(self.event_loop);
        // SAFETY: uws_loop was returned by `us_create_loop` in `init` and not yet freed.
        unsafe { uws::Loop::destroy(self.uws_loop.as_ptr()) };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for a specific VM context, for as long as the result lives.
    pub fn prepare(
        &self,
        vm: *mut (), /* SAFETY: erased *mut VirtualMachine */
    ) -> PreparedSpawnSyncEventLoop<'_> {
        __bun_spawn_sync_event_loop_set_vm(self.event_loop, vm);
        self.vm.set(vm);

        PreparedSpawnSyncEventLoop { inner: self }
    }
}

/// One spawnSync call's use of its thread's [`SpawnSyncEventLoop`].
#[must_use]
pub struct PreparedSpawnSyncEventLoop<'a> {
    inner: &'a SpawnSyncEventLoop,
}

impl core::ops::Deref for PreparedSpawnSyncEventLoop<'_> {
    type Target = SpawnSyncEventLoop;

    #[inline]
    fn deref(&self) -> &SpawnSyncEventLoop {
        self.inner
    }
}

impl Drop for PreparedSpawnSyncEventLoop<'_> {
    fn drop(&mut self) {
        debug_assert!(
            self.uws_loop().num_polls.get() == 0 && self.uws_loop().active.get() == 0,
            "spawnSync left num_polls={} active={} on its loop",
            self.uws_loop().num_polls.get(),
            self.uws_loop().active.get(),
        );
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TickState {
    Timeout,
    Completed,
}

impl PreparedSpawnSyncEventLoop<'_> {
    /// Tick the isolated event loop with an optional timeout
    /// This is similar to the main event loop's tick but completely isolated
    ///
    /// `timeout` is an absolute deadline on the real (never mocked) clock.
    pub fn tick_with_timeout(&self, timeout: Option<&Timespec>) -> TickState {
        let duration_storage: Option<Timespec>;
        let duration: Option<&Timespec> = match timeout {
            Some(ts) => {
                duration_storage =
                    Some(ts.duration(&Timespec::now(TimespecMockMode::ForceRealTime)));
                duration_storage.as_ref()
            }
            None => None,
        };

        // Suppress microtask drain for the entire tick, including the uws loop tick:
        // if any code path in what that dispatches (process exit, pipe I/O)
        // reaches drainMicrotasksWithGlobal, we must already have the flag set.
        let _suppress = SuppressMicrotaskDrain::new(self.vm.get());

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        self.uws_loop()
            .tick_with_timeout(duration, uws::NOW_NS_UNKNOWN);

        let did_timeout = timeout.is_some_and(|ts| {
            Timespec::now(TimespecMockMode::ForceRealTime).order(ts) != core::cmp::Ordering::Less
        });

        __bun_spawn_sync_event_loop_tick_tasks_only(self.event_loop);

        if did_timeout {
            return TickState::Timeout;
        }

        TickState::Completed
    }
}
