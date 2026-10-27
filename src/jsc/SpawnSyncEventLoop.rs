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
use core::marker::PhantomPinned;
use core::pin::Pin;
#[cfg(windows)]
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_sys::windows::libuv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;
use bun_uws as uws;

use crate::event_loop::{EventLoop, EventLoopHandle};
use crate::virtual_machine::VirtualMachine;

/// Sets `vm.suppress_microtask_drain` for its lifetime and restores the prior value on drop.
struct SuppressMicrotaskDrain {
    prev: bool,
}

impl SuppressMicrotaskDrain {
    #[inline]
    fn new() -> Self {
        Self {
            prev: VirtualMachine::get().suppress_microtask_drain.replace(true),
        }
    }
}

impl Drop for SuppressMicrotaskDrain {
    #[inline]
    fn drop(&mut self) {
        VirtualMachine::get()
            .suppress_microtask_drain
            .set(self.prev);
    }
}

/// Shared borrows only: what a tick dispatches finds its way back here while
/// the tick is still on the stack, so whatever changes is in a `Cell`.
pub struct SpawnSyncEventLoop {
    /// Separate JSC EventLoop instance for this spawnSync
    /// This is a FULL event loop, not just a handle.
    /// Before `uws_loop`, the loop it runs on, so that it is dropped first.
    event_loop: Pin<Box<EventLoop>>,

    /// Completely separate uws.Loop instance - critical for avoiding recursive event loop execution
    uws_loop: uws::OwnedLoop,

    #[cfg(windows)]
    uv_timer: Cell<Option<NonNull<libuv::Timer>>>,
    did_timeout: Cell<bool>,
    /// The libuv timer's `data` is this address.
    _pinned: PhantomPinned,
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
    /// `None` if the uws loop cannot be created.
    pub(crate) fn new() -> Option<Pin<Box<Self>>> {
        let uws_loop = uws::Loop::create::<handler::Handler>()?;
        // SAFETY: `event_loop` is declared before `uws_loop`, so it is dropped first.
        let event_loop = unsafe { EventLoop::new_isolated(&uws_loop) };

        let (tag, ptr) = EventLoopHandle::js_tag_ptr(event_loop.as_erased_ptr());
        uws_loop.internal_loop_data.set_parent_raw(tag, ptr);
        uws_loop.internal_loop_data.jsc_vm.set(core::ptr::null());

        Some(Box::pin(Self {
            event_loop,
            uws_loop,
            #[cfg(windows)]
            uv_timer: Cell::new(None),
            did_timeout: Cell::new(false),
            _pinned: PhantomPinned,
        }))
    }

    #[inline]
    pub fn event_loop(&self) -> &EventLoop {
        &self.event_loop
    }

    #[inline]
    pub fn uws_loop(&self) -> &uws::Loop {
        &self.uws_loop
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

#[cfg(windows)]
impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
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
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for one call, for as long as the result lives.
    pub fn prepare(&self) -> PreparedSpawnSyncEventLoop<'_> {
        let vm = VirtualMachine::get();
        self.event_loop.set_global(vm.global());
        self.did_timeout.set(false);

        // SAFETY: `RareData` makes the only one and keeps it until the VM is destroyed, after the
        // last use of `event_loop_handle`.
        #[cfg(windows)]
        let uv_loop: &'static libuv::Loop = unsafe { &*core::ptr::from_ref(self.uws_loop.uv()) };
        #[cfg(windows)]
        let original_event_loop_handle = vm.event_loop_handle.replace(Some(uv_loop));

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
    original_event_loop_handle: Option<&'static libuv::Loop>,
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
            self.uws_loop().num_polls.get() == 0 && self.uws_loop().active.get() == 0,
            "spawnSync left num_polls={} active={} on its loop",
            self.uws_loop().num_polls.get(),
            self.uws_loop().active.get(),
        );
        #[cfg(windows)]
        {
            VirtualMachine::get()
                .event_loop_handle
                .set(self.original_event_loop_handle);
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
            let uv_loop = self.uws_loop().uv_loop.get();
            // Pinned, and outlives its timer.
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
        unsafe { libuv::uv_update_time(self.uws_loop().uv_loop.get()) };

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
        let _suppress = SuppressMicrotaskDrain::new();

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        self.uws_loop
            .tick_with_timeout(duration, uws::NOW_NS_UNKNOWN);

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

        self.event_loop.tick_tasks_only();

        let did_timeout = self.did_timeout.replace(false);

        if did_timeout {
            return TickState::Timeout;
        }

        TickState::Completed
    }
}
