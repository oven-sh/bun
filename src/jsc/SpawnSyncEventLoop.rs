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

use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_uws as uws;

use crate::event_loop::EventLoop;
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::IsolatedPoster;

/// RAII scope that sets `vm.suppress_microtask_drain = true` for its lifetime
/// and restores the prior value on drop.
pub(crate) struct SuppressMicrotaskDrain<'a> {
    vm: &'a VirtualMachine,
    prev: bool,
}

impl<'a> SuppressMicrotaskDrain<'a> {
    #[inline]
    pub(crate) fn new(vm: &'a VirtualMachine) -> Self {
        let prev = vm.suppress_microtask_drain.replace(true);
        Self { vm, prev }
    }
}

impl Drop for SuppressMicrotaskDrain<'_> {
    #[inline]
    fn drop(&mut self) {
        self.vm.suppress_microtask_drain.set(self.prev);
    }
}

/// Shared borrows only once `init` is through: what a tick dispatches finds its way back here while
/// the tick is still on the stack.
pub struct SpawnSyncEventLoop {
    /// Separate JSC EventLoop instance for this spawnSync
    /// This is a FULL event loop, not just a handle
    // Boxed: other threads post to it until `Drop`, which borrows `self` exclusively, closes its poster.
    event_loop: Box<EventLoop>,

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
    ///
    /// SAFETY: `vm` is this thread's `VirtualMachine`, and the result is dropped only with it.
    pub(crate) unsafe fn init(vm: &VirtualMachine) -> Option<Box<Self>> {
        // `uws::Loop::create` takes a `LoopHandler` impl with associated-const fn ptrs.
        let uws_loop = uws::Loop::create::<handler::Handler>()?;
        // SAFETY: freed with the VM, and a call takes what it put on the loop off again.
        let loop_ = unsafe { uws_loop.as_ref() };

        let this = Box::new(Self {
            uws_loop,
            event_loop: Box::new(EventLoop::with_uws_loop(vm, loop_)),
        });

        let event_loop = this.event_loop();
        let _ = event_loop
            .isolated_poster
            .set(IsolatedPoster::new(event_loop));
        // Set up the loop's internal data to point to this isolated event loop
        event_loop.as_handle().set_as_parent_of(loop_);
        loop_.internal_loop_data.jsc_vm.set(core::ptr::null());
        Some(this)
    }

    #[inline]
    pub fn event_loop(&self) -> &EventLoop {
        &self.event_loop
    }

    /// The isolated `uws::Loop`.
    #[inline]
    fn uws_loop(&self) -> &uws::Loop {
        // SAFETY: set in `init` and freed only in `Drop`.
        unsafe { self.uws_loop.as_ref() }
    }
}

impl Drop for SpawnSyncEventLoop {
    fn drop(&mut self) {
        // Refuse (and wait out) posts from other threads before the loop goes.
        if let Some(poster) = self.event_loop.isolated_poster.get() {
            poster.close();
        }
        // SAFETY: uws_loop was returned by `us_create_loop` in `init` and not yet freed.
        unsafe { uws::Loop::destroy(self.uws_loop.as_ptr()) };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for one call, for as long as the result lives.
    pub fn prepare(&self) -> PreparedSpawnSyncEventLoop<'_> {
        let vm = self.event_loop.vm_ref();
        self.event_loop.global.set(NonNull::new(vm.global.get()));
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
        #[cfg(windows)]
        debug_assert!(!self.uws_loop().port().has_loop_refs());
        debug_assert!(
            self.uws_loop().poll_count() == 0 && self.uws_loop().active.get() == 0,
            "spawnSync left num_polls={} active={} on its loop",
            self.uws_loop().poll_count(),
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

        // Held for the entire tick, because the uws tick dispatches process exits and pipe I/O.
        let _suppress = SuppressMicrotaskDrain::new(self.event_loop.vm_ref());

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        self.uws_loop()
            .tick_with_timeout(duration, uws::NOW_NS_UNKNOWN);

        let did_timeout = timeout.is_some_and(|ts| {
            Timespec::now(TimespecMockMode::ForceRealTime).order(ts) != core::cmp::Ordering::Less
        });

        self.event_loop.tick_tasks_only();

        if did_timeout {
            return TickState::Timeout;
        }

        TickState::Completed
    }
}
