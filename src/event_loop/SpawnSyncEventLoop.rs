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
//! - Temporarily overrides vm.event_loop_handle to point to the isolated loop
//! - Minimal handler callbacks (wakeup/pre/post are no-ops)
//!
//! Similar to Node.js's approach in vendor/node/src/spawn_sync.cc but adapted for Bun's architecture.

use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_uws as uws;

// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

pub type VmEventLoopHandle = Option<NonNull<uws::Loop>>;

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
    safe fn __bun_spawn_sync_vm_get_event_loop_handle(vm: *mut ()) -> VmEventLoopHandle;
    safe fn __bun_spawn_sync_vm_set_event_loop_handle(vm: *mut (), h: VmEventLoopHandle);
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

pub struct SpawnSyncEventLoop {
    /// Separate JSC EventLoop instance for this spawnSync
    /// This is a FULL event loop, not just a handle
    // SAFETY: erased `*mut jsc::EventLoop`, heap-owned via `__bun_spawn_sync_{create,destroy}_event_loop`.
    event_loop: *mut (),

    /// Erased `*mut jsc::VirtualMachine` backref (set in `init`/`prepare`).
    vm: *mut (),

    /// Completely separate uws.Loop instance - critical for avoiding recursive event loop execution
    // FFI-owned handle created via `uws::Loop::create`, freed in Drop via
    // `Loop::deinit`. Kept as raw because `uws::Loop` is an opaque C type and its address is
    // stored back into `internal_loop_data` (self-referential w.r.t. `event_loop`).
    uws_loop: NonNull<uws::Loop>,

    /// `prepare` overrides the VM's event_loop_handle; the original, restored
    /// by `cleanup`.
    original_event_loop_handle: VmEventLoopHandle,
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
    // In-place init: `self.event_loop` is captured by `setParentEventLoop`
    // below, so `Self` MUST NOT move after `init` returns (no-move invariant
    // upheld by the caller). The caller provides uninitialized storage, hence
    // `MaybeUninit<Self>` (out-param ctor exception). `false` leaves it uninitialized.
    pub fn init(
        this: &mut core::mem::MaybeUninit<Self>,
        vm: *mut (), /* SAFETY: erased *mut VirtualMachine */
    ) -> bool {
        // `uws::Loop::create` takes a `LoopHandler` impl with associated-const fn ptrs.
        let Some(loop_) = uws::Loop::create::<handler::Handler>() else {
            return false;
        };

        // A fresh `jsc::EventLoop` whose `uws_loop` is the isolated loop.
        let event_loop = __bun_spawn_sync_create_event_loop(vm, loop_.as_ptr());

        this.write(Self {
            uws_loop: loop_,
            original_event_loop_handle: None, // overwritten in `prepare`
            event_loop,
            vm,
        });

        // Set up the loop's internal data to point to this isolated event loop
        // SAFETY: `this` was fully written immediately above so `assume_init_mut` is sound.
        let this = unsafe { this.assume_init_mut() };
        // sys-level API is `set_parent_raw(tag, ptr)`. Tag 1 = JS, tag 2 = mini.
        // `this.event_loop` is the live heap-owned `*mut jsc::EventLoop`
        // returned by `__bun_spawn_sync_create_event_loop` immediately above —
        // never null on a successful create.
        debug_assert!(!this.event_loop.is_null(), "spawn-sync event loop alloc");
        let (tag, ptr) = EventLoopHandle::init(this.event_loop).into_tag_ptr();
        let loop_data = &mut this.uws_loop_mut().internal_loop_data;
        loop_data.set_parent_raw(tag, ptr);
        loop_data.jsc_vm = core::ptr::null();
        true
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

    /// Shared borrow of the isolated `uws::Loop`.
    ///
    /// # Safety (invariant)
    /// `uws_loop` is set in `init` and freed only in `Drop`, so it is valid for
    /// all of `self`'s lifetime. The loop is only mutated through `&mut self`
    /// paths (`uws_loop_mut`), so a shared borrow tied to `&self` cannot
    /// overlap a unique borrow.
    #[inline]
    pub fn uws_loop(&self) -> &uws::Loop {
        // SAFETY: see doc invariant above — non-null, owned for `self`'s lifetime,
        // no `&mut` alias while `&self` is held.
        unsafe { self.uws_loop.as_ref() }
    }

    /// Unique borrow of the isolated `uws::Loop`.
    #[inline]
    pub(crate) fn uws_loop_mut(&mut self) -> &mut uws::Loop {
        // SAFETY: `uws_loop` is non-null and exclusively owned by `self` for its
        // entire lifetime (created in `init`, freed in `Drop`). `&mut self`
        // guarantees no other safe borrow of the loop is live.
        unsafe { self.uws_loop.as_mut() }
    }
}

impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
        // Destroy the event loop before the uws loop.
        __bun_spawn_sync_destroy_event_loop(self.event_loop);
        #[cfg(windows)]
        bun_io::windows::close_all_for_loop(self.uws_loop.as_ptr());
        // SAFETY: uws_loop was returned by `us_create_loop` in `init` and not yet freed.
        unsafe { uws::Loop::destroy(self.uws_loop.as_ptr()) };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for a specific VM context
    pub fn prepare(&mut self, vm: *mut () /* SAFETY: erased *mut VirtualMachine */) {
        __bun_spawn_sync_event_loop_set_vm(self.event_loop, vm);
        self.vm = vm;

        self.original_event_loop_handle = __bun_spawn_sync_vm_get_event_loop_handle(vm);
        __bun_spawn_sync_vm_set_event_loop_handle(vm, Some(self.uws_loop));
    }

    /// Restore the original event loop handle after spawnSync completes
    pub fn cleanup(&mut self, vm: *mut () /* SAFETY: erased *mut VirtualMachine */) {
        __bun_spawn_sync_vm_set_event_loop_handle(vm, self.original_event_loop_handle);
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TickState {
    Timeout,
    Completed,
}

impl SpawnSyncEventLoop {
    /// Tick the isolated event loop with an optional timeout
    /// This is similar to the main event loop's tick but completely isolated
    ///
    /// `timeout` is an absolute deadline on the real (never mocked) clock.
    pub fn tick_with_timeout(&mut self, timeout: Option<&Timespec>) -> TickState {
        let duration_storage: Option<Timespec>;
        let duration: Option<&Timespec> = match timeout {
            Some(ts) => {
                let now = Timespec::now(TimespecMockMode::ForceRealTime);
                // A deadline that has passed is a non-blocking tick.
                duration_storage = Some(if now.order(ts) == core::cmp::Ordering::Less {
                    ts.duration(&now)
                } else {
                    Timespec::EPOCH
                });
                duration_storage.as_ref()
            }
            None => None,
        };

        // Suppress microtask drain for the entire tick, including the uws loop tick.
        // Callbacks dispatched from it (process exit, pipe I/O) call onProcessExit →
        // onExit; if any code path in those callbacks reaches
        // drainMicrotasksWithGlobal, we must already have the flag set.
        let _suppress = SuppressMicrotaskDrain::new(self.vm);

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        self.uws_loop_mut()
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
