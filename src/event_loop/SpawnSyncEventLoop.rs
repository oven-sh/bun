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
//! - Wraps it in a full jsc.EventLoop instance whose `uws_loop` is the isolated loop
//! - What the call makes for its child is handed that EventLoop, and so counts on the isolated loop
//! - Nothing else can reach it: a finalizer that runs during the wait finds the thread's own loop
//!   (Windows still overrides vm.event_loop_handle, where a libuv handle keeps the loop it was made on)
//! - Minimal handler callbacks (wakeup/pre/post are no-ops)
//!
//! Similar to Node.js's approach in vendor/node/src/spawn_sync.cc but adapted for Bun's architecture.

use core::cell::Cell;
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_sys::windows::libuv;
#[cfg(windows)]
// `ref_`/`unref`/`close` are `UvHandle` default trait methods; bring it into
// scope so method resolution finds them on `Timer`.
use bun_sys::windows::libuv::UvHandle as _;
use bun_uws as uws;

// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

#[cfg(windows)]
pub type VmEventLoopHandle = Option<NonNull<libuv::Loop>>;

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
    #[cfg(windows)]
    safe fn __bun_spawn_sync_vm_get_event_loop_handle(vm: *mut ()) -> VmEventLoopHandle;
    #[cfg(windows)]
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

    #[cfg(windows)]
    uv_timer: Cell<Option<NonNull<libuv::Timer>>>,
    did_timeout: Cell<bool>,
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
            #[cfg(windows)]
            uv_timer: Cell::new(None),
            did_timeout: Cell::new(false),
            event_loop,
            vm: Cell::new(vm),
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

    /// Shared borrow of the isolated `uws::Loop`. Not to be held across a tick, which borrows it uniquely.
    #[inline]
    pub fn uws_loop(&self) -> &uws::Loop {
        // SAFETY: set in `init` and freed only in `Drop`.
        unsafe { self.uws_loop.as_ref() }
    }

    /// Unique borrow of the isolated `uws::Loop`, for `init`.
    #[inline]
    fn uws_loop_mut(&mut self) -> &mut uws::Loop {
        // SAFETY: set in `init` and freed only in `Drop`; `&mut self` rules out a tick.
        unsafe { self.uws_loop.as_mut() }
    }

    /// Runs `f` on the libuv timeout timer, if a call has needed one yet. Not from under `uv_run`.
    #[cfg(windows)]
    #[inline]
    fn with_uv_timer(&self, f: impl FnOnce(&mut libuv::Timer)) {
        if let Some(timer) = self.uv_timer.get() {
            // SAFETY: allocated in `prepare_timer_on_windows`, freed only by the close callback that
            // `Drop` schedules. libuv touches the handle inside `uv_run` alone, and `f` cannot get back here.
            f(unsafe { &mut *timer.as_ptr() });
        }
    }
}

#[cfg(windows)]
extern "C" fn on_close_uv_timer(timer: *mut libuv::Timer) {
    // SAFETY: `timer` was allocated via `heap::alloc` in `prepare_timer_on_windows`.
    drop(unsafe { bun_core::heap::take(timer) });
}

impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            if let Some(timer) = self.uv_timer.take() {
                // SAFETY: timer is a live libuv handle owned by this struct.
                unsafe {
                    (*timer.as_ptr()).stop();
                    (*timer.as_ptr()).unref();
                    // `UvHandle::close` already does the `*mut Timer` →
                    // `*mut uv_handle_t` cb cast internally.
                    (*timer.as_ptr()).close(on_close_uv_timer);
                }
            }
        }

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
        self.did_timeout.set(false);
        self.vm.set(vm);

        #[cfg(windows)]
        let original_event_loop_handle = __bun_spawn_sync_vm_get_event_loop_handle(vm);
        #[cfg(windows)]
        __bun_spawn_sync_vm_set_event_loop_handle(
            vm,
            Some(
                NonNull::new(self.uws_loop().uv_loop)
                    .expect("uv_loop is set by us_create_loop for the loop's lifetime"),
            ),
        );

        PreparedSpawnSyncEventLoop {
            inner: self,
            #[cfg(windows)]
            original_event_loop_handle,
        }
    }
}

/// One spawnSync call's use of its thread's [`SpawnSyncEventLoop`].
#[must_use]
pub struct PreparedSpawnSyncEventLoop<'a> {
    inner: &'a SpawnSyncEventLoop,
    /// The VM's event_loop_handle, which `prepare` overrode.
    #[cfg(windows)]
    original_event_loop_handle: VmEventLoopHandle,
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
        #[cfg(unix)]
        debug_assert!(
            self.uws_loop().num_polls == 0 && self.uws_loop().active == 0,
            "spawnSync left num_polls={} active={} on its loop",
            self.uws_loop().num_polls,
            self.uws_loop().active,
        );
        #[cfg(windows)]
        {
            __bun_spawn_sync_vm_set_event_loop_handle(
                self.vm.get(),
                self.original_event_loop_handle,
            );
            self.with_uv_timer(|timer| {
                timer.stop();
                timer.unref();
            });
        }
    }
}

#[cfg(windows)]
extern "C" fn on_uv_timer(timer_: *mut libuv::Timer) {
    // SAFETY: `data` is the `SpawnSyncEventLoop` whose tick this fires under, set in `prepare_timer_on_windows`.
    // That tick borrows the `uws::Loop` uniquely, so the uv loop comes from the handle instead.
    unsafe {
        (*(*timer_).data.cast::<SpawnSyncEventLoop>())
            .did_timeout
            .set(true);
        (*libuv::uv_handle_get_loop(timer_.cast())).stop();
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TickState {
    Timeout,
    Completed,
}

impl PreparedSpawnSyncEventLoop<'_> {
    #[cfg(windows)]
    fn prepare_timer_on_windows(&self, ts: &Timespec) {
        if self.uv_timer.get().is_none() {
            let uv_timer: Box<libuv::Timer> = Box::new(bun_core::ffi::zeroed());
            // Leak to raw *before* `uv_timer_init` so libuv's stored handle
            // pointer derives from the post-`into_raw` provenance (not a
            // `Box`-`noalias` reborrow that `into_raw` would later pop).
            self.uv_timer
                .set(Some(bun_core::heap::into_raw_nn(uv_timer)));
            let uv_loop = self.uws_loop().uv_loop;
            // The loop is boxed by `RareData` and outlives its timer.
            let data = core::ptr::from_ref::<SpawnSyncEventLoop>(self.inner)
                .cast_mut()
                .cast();
            self.with_uv_timer(|timer| {
                timer.init(uv_loop);
                timer.data = data;
            });
        }

        // Refresh the loop's cached clock: this loop only runs while a spawnSync call is in
        // flight, so `loop->time` (which `uv_timer_start` computes the due time from) can be
        // staler than the timeout, which would make the timer fire immediately.
        // SAFETY: `uv_loop` is the live initialized loop owned by `self.uws_loop`.
        unsafe { libuv::uv_update_time(self.uws_loop().uv_loop) };

        self.with_uv_timer(|timer| {
            timer.start(ts.ms_unsigned(), 0, Some(on_uv_timer));
            timer.ref_();
        });
    }

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

        #[cfg(windows)]
        {
            if let Some(ts) = duration {
                self.prepare_timer_on_windows(ts);
            }
        }

        // Suppress microtask drain for the entire tick, including the uws loop tick.
        // On Windows, uv_run() fires callbacks inline (e.g. uv_process exit, pipe I/O)
        // which call onProcessExit → onExit. If any code path in those callbacks
        // reaches drainMicrotasksWithGlobal, we must already have the flag set.
        // On POSIX, the uws tick only polls I/O; callbacks are dispatched later
        // via the task queue, but we set the flag here uniformly for safety.
        let _suppress = SuppressMicrotaskDrain::new(self.vm.get());

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        // SAFETY: set in `init` and freed only in `Drop`; a call ticks its loop from one place, this one.
        unsafe { (*self.uws_loop.as_ptr()).tick_with_timeout(duration, uws::NOW_NS_UNKNOWN) };

        if let Some(ts) = timeout {
            #[cfg(windows)]
            let _ = ts;
            #[cfg(windows)]
            {
                self.with_uv_timer(|timer| {
                    timer.unref();
                    timer.stop();
                });
            }
            #[cfg(not(windows))]
            {
                self.did_timeout.set(
                    Timespec::now(TimespecMockMode::ForceRealTime).order(ts)
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
}
