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

use core::ptr::NonNull;

use bun_jsc::{self as jsc, EventLoop, EventLoopHandle, VirtualMachine};
use bun_uws as uws;
// TODO(port): verify crate path for `bun.timespec` (assuming bun_core)
use bun_core::Timespec;
#[cfg(windows)]
use bun_sys::windows::libuv;

// TODO(port): `@FieldType(jsc.VirtualMachine, "event_loop_handle")` — comptime reflection on a
// foreign struct field. On POSIX this is `?*uws.Loop`, on Windows `?*libuv.Loop`. Phase B should
// expose a public type alias on `bun_jsc::VirtualMachine` (e.g. `VirtualMachine::EventLoopHandlePtr`)
// and use it here verbatim.
#[cfg(unix)]
type VmEventLoopHandle = Option<NonNull<uws::Loop>>;
#[cfg(windows)]
type VmEventLoopHandle = Option<NonNull<libuv::Loop>>;

pub struct SpawnSyncEventLoop {
    /// Separate JSC EventLoop instance for this spawnSync
    /// This is a FULL event loop, not just a handle
    event_loop: jsc::EventLoop,

    /// Completely separate uws.Loop instance - critical for avoiding recursive event loop execution
    // TODO(port): lifetime — FFI-owned handle created via `uws::Loop::create`, freed in Drop via
    // `Loop::deinit`. Kept as raw because `uws::Loop` is an opaque C type and its address is
    // stored back into `internal_loop_data` (self-referential w.r.t. `event_loop`).
    uws_loop: NonNull<uws::Loop>,

    /// On POSIX, we need to temporarily override the VM's event_loop_handle
    /// Store the original so we can restore it
    original_event_loop_handle: VmEventLoopHandle,

    #[cfg(windows)]
    uv_timer: Option<NonNull<libuv::Timer>>,
    did_timeout: bool,
}

/// Minimal handler for the isolated loop
mod handler {
    use super::uws;

    pub extern "C" fn wakeup(_loop: *mut uws::Loop) {
        // No-op: we don't need to wake up from another thread for spawnSync
    }

    pub extern "C" fn pre(_loop: *mut uws::Loop) {
        // No-op: no pre-tick work needed for spawnSync
    }

    pub extern "C" fn post(_loop: *mut uws::Loop) {
        // No-op: no post-tick work needed for spawnSync
    }
}

impl SpawnSyncEventLoop {
    // TODO(port): in-place init — `&self.event_loop` is captured by
    // `setParentEventLoop` below, so `Self` must not move after `init` returns.
    // Zig caller passes `undefined` storage, hence `MaybeUninit<Self>` (out-param ctor exception).
    // Phase B: consider `Pin<&mut Self>` or document the no-move invariant at the caller.
    pub fn init(this: &mut core::mem::MaybeUninit<Self>, vm: &mut VirtualMachine) {
        // TODO(port): Zig passes a comptime `Handler` type with wakeup/pre/post decls.
        // Assuming the Rust wrapper takes three fn pointers; adjust to actual `bun_uws` API.
        let loop_ = uws::Loop::create(handler::wakeup, handler::pre, handler::post);

        // SAFETY: `Loop::create` never returns null (panics/aborts on OOM in uws).
        let loop_ = unsafe { NonNull::new_unchecked(loop_) };

        this.write(Self {
            uws_loop: loop_,
            original_event_loop_handle: None, // = undefined in Zig; overwritten in `prepare`
            #[cfg(windows)]
            uv_timer: None,
            did_timeout: false,

            // Initialize the JSC EventLoop with empty state
            // CRITICAL: On Windows, store our isolated loop pointer
            event_loop: EventLoop {
                tasks: jsc::event_loop::Queue::default(),
                global: vm.global,
                virtual_machine: vm,
                #[cfg(windows)]
                uws_loop: loop_.as_ptr(),
                ..Default::default()
                // TODO(port): Zig uses field defaults for the remaining EventLoop fields; Phase B must
                // ensure `EventLoop: Default` or provide an explicit constructor.
            },
        });

        // Set up the loop's internal data to point to this isolated event loop
        // SAFETY: uws_loop was just created above and is exclusively owned here; `this` was fully
        // written immediately above so `assume_init_mut` is sound.
        unsafe {
            let this = this.assume_init_mut();
            (*this.uws_loop.as_ptr())
                .internal_loop_data
                .set_parent_event_loop(EventLoopHandle::init(&mut this.event_loop));
            (*this.uws_loop.as_ptr()).internal_loop_data.jsc_vm = core::ptr::null_mut();
        }
    }
}

#[cfg(windows)]
extern "C" fn on_close_uv_timer(timer: *mut libuv::Timer) {
    // SAFETY: `timer` was allocated via `Box::into_raw` in `prepare_timer_on_windows`.
    drop(unsafe { Box::from_raw(timer) });
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
                    libuv::uv_close(
                        timer.as_ptr().cast(),
                        // SAFETY: on_close_uv_timer has a compatible signature with uv_close_cb
                        // (takes *mut uv_handle_t; libuv guarantees the same pointer is passed back).
                        Some(core::mem::transmute::<
                            extern "C" fn(*mut libuv::Timer),
                            libuv::uv_close_cb,
                        >(on_close_uv_timer)),
                    );
                }
            }
        }

        // PORT NOTE: Zig order was `event_loop.deinit()` then `uws_loop.deinit()`. Here the
        // FFI `uws_loop` free runs in the Drop body, and `event_loop` (inline field, has its own
        // `impl Drop`) drops afterward in field-declaration order. If event_loop teardown must
        // precede uws_loop free, Phase B should hoist via `ManuallyDrop` — currently believed
        // not load-bearing (uws_loop holds a backref into event_loop, not the reverse).
        // SAFETY: uws_loop is valid and owned; deinit frees it.
        unsafe { (*self.uws_loop.as_ptr()).deinit() };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for a specific VM context
    pub fn prepare(&mut self, vm: &mut VirtualMachine) {
        self.event_loop.global = vm.global;
        self.did_timeout = false;
        self.event_loop.virtual_machine = vm;

        self.original_event_loop_handle = vm.event_loop_handle;
        #[cfg(unix)]
        {
            vm.event_loop_handle = Some(self.uws_loop);
        }
        #[cfg(windows)]
        {
            // SAFETY: uws_loop is valid; uv_loop is a stable interior pointer.
            vm.event_loop_handle =
                Some(unsafe { NonNull::new_unchecked((*self.uws_loop.as_ptr()).uv_loop) });
        }
    }

    /// Restore the original event loop handle after spawnSync completes
    pub fn cleanup(&mut self, vm: &mut VirtualMachine, prev_event_loop: &mut jsc::EventLoop) {
        vm.event_loop_handle = self.original_event_loop_handle;
        vm.event_loop = prev_event_loop;

        #[cfg(windows)]
        {
            if let Some(timer) = self.uv_timer {
                // SAFETY: timer is a live libuv handle.
                unsafe {
                    (*timer.as_ptr()).stop();
                    (*timer.as_ptr()).unref();
                }
            }
        }
    }

    /// Get an EventLoopHandle for this isolated loop
    pub fn handle(&mut self) -> EventLoopHandle {
        EventLoopHandle::init(&mut self.event_loop)
    }
}

#[cfg(windows)]
extern "C" fn on_uv_timer(timer_: *mut libuv::Timer) {
    // SAFETY: `data` was set to `self` in `prepare_timer_on_windows`; the SpawnSyncEventLoop
    // outlives the timer (timer is stopped/closed in `cleanup`/`Drop`).
    let this: &mut SpawnSyncEventLoop = unsafe { &mut *((*timer_).data.cast::<SpawnSyncEventLoop>()) };
    this.did_timeout = true;
    // SAFETY: uws_loop is valid for the lifetime of `this`.
    unsafe { (*(*this.uws_loop.as_ptr()).uv_loop).stop() };
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TickState {
    Timeout,
    Completed,
}

impl SpawnSyncEventLoop {
    #[cfg(windows)]
    fn prepare_timer_on_windows(&mut self, ts: &Timespec) {
        let timer: NonNull<libuv::Timer> = match self.uv_timer {
            Some(t) => t,
            None => 'brk: {
                // SAFETY: all-zero is a valid `libuv::Timer` (C POD, matches `std.mem.zeroes`).
                let uv_timer: Box<libuv::Timer> = Box::new(unsafe { core::mem::zeroed() });
                let uv_timer = Box::into_raw(uv_timer);
                // SAFETY: uv_timer just allocated; uws_loop.uv_loop is valid.
                unsafe { (*uv_timer).init((*self.uws_loop.as_ptr()).uv_loop) };
                // SAFETY: Box::into_raw never returns null.
                break 'brk unsafe { NonNull::new_unchecked(uv_timer) };
            }
        };

        // SAFETY: timer is a valid initialized libuv timer handle.
        unsafe {
            (*timer.as_ptr()).start(ts.ms_unsigned(), 0, on_uv_timer);
            (*timer.as_ptr()).ref_();
            (*timer.as_ptr()).data = (self as *mut Self).cast();
        }
        self.uv_timer = Some(timer);
    }

    /// Tick the isolated event loop with an optional timeout
    /// This is similar to the main event loop's tick but completely isolated
    pub fn tick_with_timeout(&mut self, timeout: Option<&Timespec>) -> TickState {
        let duration_storage: Option<Timespec>;
        let duration: Option<&Timespec> = match timeout {
            Some(ts) => {
                duration_storage = Some(ts.duration(&Timespec::now(Timespec::ALLOW_MOCKED_TIME)));
                duration_storage.as_ref()
            }
            None => None,
        };
        // TODO(port): verify `Timespec::now` API shape (`.allow_mocked_time` enum literal in Zig).

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
        let vm = self.event_loop.virtual_machine;
        // SAFETY: virtual_machine is a valid backref set in `init`/`prepare`; the VM outlives
        // this SpawnSyncEventLoop by construction.
        let vm = unsafe { &mut *vm };
        let prev_suppress = vm.suppress_microtask_drain;
        vm.suppress_microtask_drain = true;
        let _guard = scopeguard::guard((), |_| {
            vm.suppress_microtask_drain = prev_suppress;
        });
        // PORT NOTE: reshaped for borrowck — Zig `defer` restores at scope exit; scopeguard
        // captures `vm` mutably which may conflict with later borrows. Phase B may need to
        // inline the restore after `tick_tasks_only()` instead.

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        // SAFETY: uws_loop is valid and exclusively owned.
        unsafe { (*self.uws_loop.as_ptr()).tick_with_timeout(duration) };

        if let Some(ts) = timeout {
            #[cfg(windows)]
            {
                // SAFETY: uv_timer is Some when timeout is Some (set in prepare_timer_on_windows).
                let t = self.uv_timer.unwrap();
                unsafe {
                    (*t.as_ptr()).unref();
                    (*t.as_ptr()).stop();
                }
            }
            #[cfg(not(windows))]
            {
                self.did_timeout =
                    Timespec::now(Timespec::ALLOW_MOCKED_TIME).order(ts) != core::cmp::Ordering::Less;
            }
        }

        self.event_loop.tick_tasks_only();

        let did_timeout = self.did_timeout;
        self.did_timeout = false;

        if did_timeout {
            return TickState::Timeout;
        }

        TickState::Completed
    }

    /// Check if the loop has any active handles
    pub fn is_active(&self) -> bool {
        // SAFETY: uws_loop is valid for the lifetime of self.
        unsafe { (*self.uws_loop.as_ptr()).is_active() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/SpawnSyncEventLoop.zig (199 lines)
//   confidence: medium
//   todos:      7
//   notes:      Self-referential init (event_loop addr stored in uws_loop) via MaybeUninit out-param; @FieldType reflection on VirtualMachine.event_loop_handle stubbed as platform-conditional alias; Drop order of event_loop vs uws_loop inverted from Zig (see PORT NOTE); heavy raw-ptr FFI on Windows libuv path.
// ──────────────────────────────────────────────────────────────────────────
