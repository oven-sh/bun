//! Isolated event loop for spawnSync operations.
//!
//! This provides a completely separate event loop instance to ensure that:
//! - JavaScript timers don't fire during spawnSync
//! - stdin/stdout from the main process aren't affected
//! - The subprocess runs in complete isolation
//! - We don't recursively run the main event loop
//!
//! Implementation approach:
//! - Creates a separate uws.Loop instance with its own kqueue/epoll fd (POSIX) or libuv loop (Windows)
//! - Wraps it in a full jsc.EventLoop instance
//! - On POSIX: temporarily overrides vm.event_loop_handle to point to isolated loop
//! - On Windows: stores isolated loop pointer in EventLoop.uws_loop
//! - Minimal handler callbacks (wakeup/pre/post are no-ops)
//!
//! Similar to Node.js's approach in vendor/node/src/spawn_sync.cc but adapted for Bun's architecture.

use core::cell::Cell;
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_uws as uws;

// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

/// `?*uws.Loop` on every platform — the wrapper *is* the platform loop
/// (`bun_io::Loop` aliases it; the Windows engine loop lives behind it).
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
    /// Heap-allocate and zero-init a `jsc::EventLoop` bound to `vm`, with
    /// `uws_loop` as its loop on Windows. Returns erased `*mut jsc::EventLoop`.
    safe fn __bun_spawn_sync_create_event_loop(vm: *mut (), uws_loop: *mut uws::Loop) -> *mut ();
    safe fn __bun_spawn_sync_destroy_event_loop(el: *mut ());
    /// Re-bind `event_loop.{global, virtual_machine}` to `vm` (prepare path).
    safe fn __bun_spawn_sync_event_loop_set_vm(el: *mut (), vm: *mut ());
    safe fn __bun_spawn_sync_event_loop_tick_tasks_only(el: *mut ());
    safe fn __bun_spawn_sync_vm_get_event_loop_handle(vm: *mut ()) -> VmEventLoopHandle;
    safe fn __bun_spawn_sync_vm_set_event_loop_handle(vm: *mut (), h: VmEventLoopHandle);
    /// `vm.event_loop = prev` (cleanup path).
    safe fn __bun_spawn_sync_vm_set_event_loop(vm: *mut (), el: *mut ());
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

    /// On POSIX, we need to temporarily override the VM's event_loop_handle
    /// Store the original so we can restore it
    original_event_loop_handle: VmEventLoopHandle,

    /// Engine timeout-timer slot (index handle; the slot lives inside the
    /// engine loop and dies with it — no close handshake needed).
    #[cfg(windows)]
    timer: bun_iocp::Timer,
    // ALIASING: `Cell` because on Windows the engine timer callback writes this
    // field re-entrantly from inside `tick_with_timeout`'s uws tick while that frame still holds
    // `&mut self` (LLVM `noalias`). The field must be
    // interior-mutable so the re-entrant write is sound under Stacked Borrows.
    did_timeout: Cell<bool>,
}

/// The engine loop behind the isolated uws wrapper (Windows).
///
/// # Safety
/// `loop_` must be the live wrapper created in `init`.
#[cfg(windows)]
unsafe fn engine_loop(loop_: NonNull<uws::Loop>) -> *mut bun_iocp::Loop {
    // SAFETY: forwarded fn contract — a live `us_loop_t`.
    unsafe { bun_iocp::usockets::native_loop(loop_.as_ptr().cast()) }
}

/// Minimal handler for the isolated loop
mod handler {
    use super::uws;

    // No-op handlers: the pointer arg is never dereferenced. Safe fn items
    // coerce to the `unsafe extern "C" fn` slots in `uws::LoopHandler` below.
    pub(super) extern "C" fn wakeup(_loop: *mut uws::Loop) {
        // No-op: we don't need to wake up from another thread for spawnSync
    }

    pub(super) extern "C" fn pre(_loop: *mut uws::Loop) {
        // No-op: no pre-tick work needed for spawnSync
    }

    pub(super) extern "C" fn post(_loop: *mut uws::Loop) {
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
    // `MaybeUninit<Self>` (out-param ctor exception).
    pub fn init(
        this: &mut core::mem::MaybeUninit<Self>,
        vm: *mut (), /* SAFETY: erased *mut VirtualMachine */
    ) {
        // `uws::Loop::create` takes a `LoopHandler` impl with associated-const fn ptrs.
        let loop_ = uws::Loop::create::<handler::Handler>();

        let loop_ =
            NonNull::new(loop_).expect("uws::Loop::create never returns null (asserts on OOM)");

        // Initialize the JSC EventLoop with empty state.
        // CRITICAL: On Windows, the impl stores our isolated loop pointer in `uws_loop`.
        let event_loop = __bun_spawn_sync_create_event_loop(vm, loop_.as_ptr());

        this.write(Self {
            uws_loop: loop_,
            original_event_loop_handle: None, // overwritten in `prepare`
            #[cfg(windows)]
            timer: bun_iocp::Timer::new(),
            did_timeout: Cell::new(false),
            event_loop,
            vm,
        });

        // Set up the loop's internal data to point to this isolated event loop
        // SAFETY: `this` was fully written immediately above so `assume_init_mut` is sound.
        let this = unsafe { this.assume_init_mut() };
        // sys-level API is `set_parent_raw(tag, ptr)`; the typed
        // `set_parent_event_loop` lives in a higher tier. Tag 1 = JS, tag 2 = mini.
        // `this.event_loop` is the live heap-owned `*mut jsc::EventLoop`
        // returned by `__bun_spawn_sync_create_event_loop` immediately above —
        // never null on a successful create.
        debug_assert!(!this.event_loop.is_null(), "spawn-sync event loop alloc");
        let (tag, ptr) = EventLoopHandle::init(this.event_loop).into_tag_ptr();
        let loop_data = &mut this.uws_loop_mut().internal_loop_data;
        loop_data.set_parent_raw(tag, ptr);
        loop_data.jsc_vm = core::ptr::null();
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

    /// Erased `*mut jsc::VirtualMachine` backref (set in `init`/`prepare`).
    ///
    /// Intentionally raw-ptr (no `&`-returning variant): the pointee type is
    /// erased at this layer, and the VM is mutated re-entrantly during
    /// `tick_with_timeout` (subprocess callbacks → JS) — a `&VirtualMachine`
    /// here would alias under Stacked Borrows.
    #[inline]
    pub fn vm_ptr(&self) -> *mut () {
        self.vm
    }

    /// Shared borrow of the isolated `uws::Loop`.
    ///
    /// # Safety (invariant)
    /// `uws_loop` is created in `init` via `uws::Loop::create` (asserts
    /// non-null) and freed only in `Drop`, so it is valid for all of `self`'s
    /// lifetime. The loop is only mutated through `&mut self` paths
    /// (`uws_loop_mut`), so a shared borrow tied to `&self` cannot overlap a
    /// unique borrow.
    #[inline]
    pub fn uws_loop(&self) -> &uws::Loop {
        // SAFETY: see doc invariant above — non-null, owned for `self`'s lifetime,
        // no `&mut` alias while `&self` is held.
        unsafe { self.uws_loop.as_ref() }
    }

    /// Unique borrow of the isolated `uws::Loop`.
    ///
    /// Re-entrancy hazard: do **NOT** call this between the Windows
    /// `timer.data = self as *mut Self` store and the uws tick in
    /// `tick_with_timeout`. The `&mut self` receiver reborrow here is a Unique
    /// retag over all of `*self` under Stacked Borrows, which pops the raw
    /// pointer's tag at `did_timeout`'s bytes and makes the re-entrant
    /// `on_uv_timer` write UB. `tick_with_timeout` therefore copies
    /// `self.uws_loop` out *before* that store and ticks via the raw pointer
    /// directly. This accessor is for non-re-entrant call sites (e.g. `init`).
    #[inline]
    pub fn uws_loop_mut(&mut self) -> &mut uws::Loop {
        // SAFETY: `uws_loop` is non-null and exclusively owned by `self` for its
        // entire lifetime (created in `init`, freed in `Drop`). `&mut self`
        // guarantees no other safe borrow of the loop is live.
        unsafe { self.uws_loop.as_mut() }
    }
}

impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
        // (Windows) The engine timer slot lives inside the loop and dies with
        // it below — no per-timer teardown.

        // Destroy the event loop before the uws loop.
        __bun_spawn_sync_destroy_event_loop(self.event_loop);
        // SAFETY: uws_loop was returned by `us_create_loop` in `init` and not yet freed.
        unsafe { uws::Loop::destroy(self.uws_loop.as_ptr()) };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for a specific VM context
    pub fn prepare(&mut self, vm: *mut () /* SAFETY: erased *mut VirtualMachine */) {
        __bun_spawn_sync_event_loop_set_vm(self.event_loop, vm);
        self.did_timeout.set(false);
        self.vm = vm;

        self.original_event_loop_handle = __bun_spawn_sync_vm_get_event_loop_handle(vm);
        // The wrapper IS the platform loop on every target now.
        let new_handle: VmEventLoopHandle = Some(self.uws_loop);
        __bun_spawn_sync_vm_set_event_loop_handle(vm, new_handle);
    }

    /// Restore the original event loop handle after spawnSync completes
    pub fn cleanup(
        &mut self,
        vm: *mut (),              /* SAFETY: erased *mut VirtualMachine */
        prev_event_loop: *mut (), /* SAFETY: erased *mut jsc::EventLoop */
    ) {
        __bun_spawn_sync_vm_set_event_loop_handle(vm, self.original_event_loop_handle);
        __bun_spawn_sync_vm_set_event_loop(vm, prev_event_loop);

        #[cfg(windows)]
        {
            let loop_ = self.uws_loop;
            // SAFETY: the wrapper is live for `self`'s lifetime (created in
            // `init`, destroyed only in `Drop`).
            unsafe { (*engine_loop(loop_)).timer_stop(&mut self.timer) };
        }
    }

    /// Get an EventLoopHandle for this isolated loop
    pub fn handle(&mut self) -> EventLoopHandle {
        // `self.event_loop` is the live heap-owned `*mut jsc::EventLoop`
        // created in `init` and freed only in `Drop` — never null while `self` exists.
        debug_assert!(!self.event_loop.is_null(), "spawn-sync event loop");
        EventLoopHandle::init(self.event_loop)
    }
}

/// Engine timeout callback.
///
/// ALIASING: fires re-entrantly from inside `tick_with_timeout`'s uws tick
/// while that frame still holds `&mut self` (LLVM `noalias`). We must not
/// materialize a second `&mut SpawnSyncEventLoop` here — touch only
/// `did_timeout` (a `Cell`, interior-mutable) and stop the re-lent loop.
#[cfg(windows)]
unsafe fn on_timeout(lp: &mut bun_iocp::Loop, data: *mut core::ffi::c_void) {
    // SAFETY: `data` was armed in `tick_with_timeout` with `self`'s address;
    // the SpawnSyncEventLoop outlives the tick that dispatches this.
    unsafe { (*data.cast::<SpawnSyncEventLoop>()).did_timeout.set(true) };
    lp.stop();
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TickState {
    Timeout,
    Completed,
}

impl SpawnSyncEventLoop {
    /// Tick the isolated event loop with an optional timeout
    /// This is similar to the main event loop's tick but completely isolated
    pub fn tick_with_timeout(&mut self, timeout: Option<&Timespec>) -> TickState {
        let duration_storage: Option<Timespec>;
        let duration: Option<&Timespec> = match timeout {
            Some(ts) => {
                duration_storage =
                    Some(ts.duration(&Timespec::now(TimespecMockMode::AllowMockedTime)));
                duration_storage.as_ref()
            }
            None => None,
        };

        // Suppress microtask drain for the entire tick, including the uws loop tick.
        // On Windows, the engine tick fires callbacks inline (process exit, pipe I/O)
        // which call onProcessExit → onExit. If any code path in those callbacks
        // reaches drainMicrotasksWithGlobal, we must already have the flag set.
        // On POSIX, the uws tick only polls I/O; callbacks are dispatched later
        // via the task queue, but we set the flag here uniformly for safety.
        let _suppress = SuppressMicrotaskDrain::new(self.vm);

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        //
        // ALIASING: hoist the `uws_loop` pointer *before* arming the timer with `*mut Self`
        // below, so that between that arm and the re-entrant `on_timeout` callback we only
        // touch `self.timer`'s bytes (a field-projection retag) — never `did_timeout`'s. Do
        // NOT route the tick through `self.uws_loop_mut()` here: its `&mut self` receiver
        // reborrow is a Unique retag over the full extent of `*self` under Stacked Borrows,
        // which would pop the armed raw pointer's tag at `did_timeout`'s bytes — making the
        // callback's `(*this).did_timeout.set(true)` UB. The `uws::Loop` lives in a separate
        // allocation, so forming `&mut uws::Loop` from the copied `NonNull` does not touch
        // `*self`'s borrow stacks.
        let loop_ = self.uws_loop;
        #[cfg(windows)]
        if let Some(ts) = duration {
            // ALIASING: `data` derives from *this* frame's `&mut self`; the
            // `&mut self.timer` projection below retags only `timer`'s bytes,
            // so the raw tag at `did_timeout`'s bytes survives.
            let data: *mut core::ffi::c_void = core::ptr::from_mut(self).cast();
            // SAFETY: the wrapper (and its engine loop) is live for `self`'s
            // lifetime; the timer slot is owned by this struct.
            unsafe {
                (*engine_loop(loop_)).timer_start(
                    &mut self.timer,
                    on_timeout,
                    data,
                    ts.ms_unsigned(),
                    0,
                );
            }
        }
        // SAFETY: `uws_loop` is non-null and exclusively owned by `self` (created in `init`,
        // freed in `Drop`); `&mut self` guarantees no other safe borrow of the loop is live.
        unsafe { (*loop_.as_ptr()).tick_with_timeout(duration) };

        if let Some(ts) = timeout {
            #[cfg(windows)]
            let _ = ts;
            #[cfg(windows)]
            {
                // The re-entrant `on_timeout` callback can only fire from
                // inside the uws tick above; once that returns, disarm so a
                // later un-timed tick cannot observe a stale deadline.
                // SAFETY: wrapper live (see above).
                unsafe { (*engine_loop(loop_)).timer_stop(&mut self.timer) };
            }
            #[cfg(not(windows))]
            {
                self.did_timeout.set(
                    Timespec::now(TimespecMockMode::AllowMockedTime).order(ts)
                        != core::cmp::Ordering::Less,
                );
            }
        }

        __bun_spawn_sync_event_loop_tick_tasks_only(self.event_loop);

        let did_timeout = self.did_timeout.replace(false);

        if did_timeout {
            return TickState::Timeout;
        }

        TickState::Completed
    }

    /// Check if the loop has any active handles
    pub fn is_active(&self) -> bool {
        self.uws_loop().is_active()
    }
}
