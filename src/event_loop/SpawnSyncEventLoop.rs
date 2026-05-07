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

use bun_uws as uws;
use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_sys::windows::libuv;

// MOVE-IN: EventLoopHandle relocated from bun_jsc — see AnyEventLoop.rs.
use crate::EventLoopHandle;

// TODO(port): `@FieldType(jsc.VirtualMachine, "event_loop_handle")` — comptime reflection on a
// foreign struct field. On POSIX this is `?*uws.Loop`, on Windows `?*libuv.Loop`.
#[cfg(unix)]
pub type VmEventLoopHandle = Option<NonNull<uws::Loop>>;
#[cfg(windows)]
pub type VmEventLoopHandle = Option<NonNull<libuv::Loop>>;

// LAYERING: `bun_event_loop` sits below `bun_jsc`, so it cannot name
// `jsc::EventLoop` / `jsc::VirtualMachine`. Zig (`SpawnSyncEventLoop.zig`) did
// inline field access. The bodies live in `bun_jsc` as `#[no_mangle]` Rust-ABI
// fns, declared here as `extern "Rust"` and resolved at link time — no vtable,
// no `AtomicPtr`, no init-order hazard. PERF(port): was inline field access —
// spawnSync is per-process-spawn, not per-tick, so the cross-crate call is fine.
unsafe extern "Rust" {
    /// Heap-allocate and zero-init a `jsc::EventLoop` bound to `vm`, with
    /// `uws_loop` as its loop on Windows. Returns erased `*mut jsc::EventLoop`.
    fn __bun_spawn_sync_create_event_loop(vm: *mut (), uws_loop: *mut uws::Loop) -> *mut ();
    fn __bun_spawn_sync_destroy_event_loop(el: *mut ());
    /// Re-bind `event_loop.{global, virtual_machine}` to `vm` (prepare path).
    fn __bun_spawn_sync_event_loop_set_vm(el: *mut (), vm: *mut ());
    fn __bun_spawn_sync_event_loop_tick_tasks_only(el: *mut ());
    fn __bun_spawn_sync_vm_get_event_loop_handle(vm: *mut ()) -> VmEventLoopHandle;
    fn __bun_spawn_sync_vm_set_event_loop_handle(vm: *mut (), h: VmEventLoopHandle);
    /// `vm.event_loop = prev` (cleanup path).
    fn __bun_spawn_sync_vm_set_event_loop(vm: *mut (), el: *mut ());
    /// Swap `vm.suppress_microtask_drain`, return previous.
    fn __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm: *mut (), v: bool) -> bool;
}

/// RAII scope that sets `vm.suppress_microtask_drain = true` for its lifetime
/// and restores the prior value on drop (mirrors Zig's
/// `defer vm.suppress_microtask_drain = prev`).
struct SuppressMicrotaskDrain {
    vm: *mut (),
    prev: bool,
}

impl SuppressMicrotaskDrain {
    /// # Safety
    /// `vm` must be a valid `*mut jsc::VirtualMachine` that outlives the guard.
    #[inline]
    unsafe fn new(vm: *mut ()) -> Self {
        // SAFETY: caller guarantees `vm` is valid.
        let prev = unsafe { __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm, true) };
        Self { vm, prev }
    }
}

impl Drop for SuppressMicrotaskDrain {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `vm` was valid at construction and outlives this guard by contract.
        unsafe { __bun_spawn_sync_vm_swap_suppress_microtask_drain(self.vm, self.prev) };
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
    // TODO(port): lifetime — FFI-owned handle created via `uws::Loop::create`, freed in Drop via
    // `Loop::deinit`. Kept as raw because `uws::Loop` is an opaque C type and its address is
    // stored back into `internal_loop_data` (self-referential w.r.t. `event_loop`).
    uws_loop: NonNull<uws::Loop>,

    /// On POSIX, we need to temporarily override the VM's event_loop_handle
    /// Store the original so we can restore it
    original_event_loop_handle: VmEventLoopHandle,

    #[cfg(windows)]
    uv_timer: Option<NonNull<libuv::Timer>>,
    // ALIASING: `Cell` because on Windows the libuv timer callback (`on_uv_timer`) writes this
    // field re-entrantly from inside `tick_with_timeout`'s uws tick while that frame still holds
    // `&mut self` (LLVM `noalias`). Zig's `*T` freely aliases; in Rust the field must be
    // interior-mutable so the re-entrant write is sound under Stacked Borrows.
    did_timeout: Cell<bool>,
}

/// Minimal handler for the isolated loop
mod handler {
    use super::uws;

    pub(super) unsafe extern "C" fn wakeup(_loop: *mut uws::Loop) {
        // No-op: we don't need to wake up from another thread for spawnSync
    }

    pub(super) unsafe extern "C" fn pre(_loop: *mut uws::Loop) {
        // No-op: no pre-tick work needed for spawnSync
    }

    pub(super) unsafe extern "C" fn post(_loop: *mut uws::Loop) {
        // No-op: no post-tick work needed for spawnSync
    }

    /// Adapter for `uws::Loop::create<H: LoopHandler>()` — Zig's
    /// `comptime Handler` with `wakeup`/`pre`/`post` decls maps to a trait
    /// with associated `const fn`-ptr slots.
    pub(super) struct Handler;
    impl uws::LoopHandler for Handler {
        const WAKEUP: unsafe extern "C" fn(*mut uws::Loop) = wakeup;
        const PRE: Option<unsafe extern "C" fn(*mut uws::Loop)> = Some(pre);
        const POST: Option<unsafe extern "C" fn(*mut uws::Loop)> = Some(post);
    }
}

impl SpawnSyncEventLoop {
    // TODO(port): in-place init — `self.event_loop` is captured by
    // `setParentEventLoop` below, so `Self` must not move after `init` returns.
    // Zig caller passes `undefined` storage, hence `MaybeUninit<Self>` (out-param ctor exception).
    // Phase B: consider `Pin<&mut Self>` or document the no-move invariant at the caller.
    pub fn init(
        this: &mut core::mem::MaybeUninit<Self>,
        vm: *mut (), /* SAFETY: erased *mut VirtualMachine */
    ) {
        // PORT NOTE: Zig passes a comptime `Handler` type with wakeup/pre/post decls.
        // The Rust wrapper takes a `LoopHandler` impl with associated-const fn ptrs.
        let loop_ = uws::Loop::create::<handler::Handler>();

        // SAFETY: `Loop::create` never returns null (asserts on OOM in uws).
        let loop_ = unsafe { NonNull::new_unchecked(loop_) };

        // Initialize the JSC EventLoop with empty state.
        // CRITICAL: On Windows, the impl stores our isolated loop pointer in `uws_loop`.
        // SAFETY: heap-allocates a fresh EventLoop bound to vm.
        let event_loop = unsafe { __bun_spawn_sync_create_event_loop(vm, loop_.as_ptr()) };

        this.write(Self {
            uws_loop: loop_,
            original_event_loop_handle: None, // = undefined in Zig; overwritten in `prepare`
            #[cfg(windows)]
            uv_timer: None,
            did_timeout: Cell::new(false),
            event_loop,
            vm,
        });

        // Set up the loop's internal data to point to this isolated event loop
        // SAFETY: uws_loop was just created above and is exclusively owned here; `this` was fully
        // written immediately above so `assume_init_mut` is sound.
        unsafe {
            let this = this.assume_init_mut();
            // PORT NOTE: sys-level API is `set_parent_raw(tag, ptr)`; the typed
            // `set_parent_event_loop` lives in a higher tier. Tag 1 = JS, tag 2 = mini.
            let (tag, ptr) = EventLoopHandle::init(this.event_loop).into_tag_ptr();
            (*this.uws_loop.as_ptr())
                .internal_loop_data
                .set_parent_raw(tag, ptr);
            (*this.uws_loop.as_ptr()).internal_loop_data.jsc_vm = core::ptr::null();
        }
    }

    /// Erased `*mut bun_jsc::event_loop::EventLoop` (heap-owned via
    /// `__bun_spawn_sync_create_event_loop`). `bun_event_loop` sits below
    /// `bun_jsc` so the concrete type is opaque here; callers in higher tiers
    /// cast back. See `js_bun_spawn_bindings::spawn_maybe_sync` (Zig:
    /// `&jsc_vm.rareData().spawnSyncEventLoop(jsc_vm).event_loop`).
    #[inline]
    pub fn event_loop_ptr(&self) -> *mut () {
        self.event_loop
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

        // PORT NOTE: Zig order was `event_loop.deinit()` then `uws_loop.deinit()`.
        // SAFETY: frees the heap-allocated EventLoop from `init`.
        unsafe { __bun_spawn_sync_destroy_event_loop(self.event_loop) };
        // SAFETY: uws_loop was returned by `us_create_loop` in `init` and not yet freed.
        unsafe { uws::Loop::destroy(self.uws_loop.as_ptr()) };
    }
}

impl SpawnSyncEventLoop {
    /// Configure the event loop for a specific VM context
    pub fn prepare(&mut self, vm: *mut () /* SAFETY: erased *mut VirtualMachine */) {
        // SAFETY: `vm` is the live per-thread VM; `event_loop` is the heap-owned isolated loop.
        unsafe { __bun_spawn_sync_event_loop_set_vm(self.event_loop, vm) };
        self.did_timeout.set(false);
        self.vm = vm;

        // SAFETY: `vm` is the live per-thread VM.
        self.original_event_loop_handle = unsafe { __bun_spawn_sync_vm_get_event_loop_handle(vm) };
        #[cfg(unix)]
        let new_handle: VmEventLoopHandle = Some(self.uws_loop);
        #[cfg(windows)]
        // SAFETY: uws_loop is valid; uv_loop is a stable interior pointer.
        let new_handle: VmEventLoopHandle =
            Some(unsafe { NonNull::new_unchecked((*self.uws_loop.as_ptr()).uv_loop) });
        // SAFETY: `vm` is the live per-thread VM.
        unsafe { __bun_spawn_sync_vm_set_event_loop_handle(vm, new_handle) };
    }

    /// Restore the original event loop handle after spawnSync completes
    pub fn cleanup(
        &mut self,
        vm: *mut (),             /* SAFETY: erased *mut VirtualMachine */
        prev_event_loop: *mut (), /* SAFETY: erased *mut jsc::EventLoop */
    ) {
        // SAFETY: `vm` is the live per-thread VM.
        unsafe {
            __bun_spawn_sync_vm_set_event_loop_handle(vm, self.original_event_loop_handle);
            __bun_spawn_sync_vm_set_event_loop(vm, prev_event_loop);
        }

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
        EventLoopHandle::init(self.event_loop)
    }
}

#[cfg(windows)]
extern "C" fn on_uv_timer(timer_: *mut libuv::Timer) {
    // SAFETY: `data` was set to `self` in `tick_with_timeout` immediately before the uws tick;
    // the SpawnSyncEventLoop outlives the timer (timer is stopped/closed in `cleanup`/`Drop`).
    //
    // ALIASING: this callback fires re-entrantly from inside `tick_with_timeout`'s uws tick
    // (uv_run) while that frame still holds `&mut self` (LLVM `noalias`) AND a live
    // `&mut uws::Loop` (Loop::tick_with_timeout takes `&mut self`). Zig's `*T` freely aliases,
    // but in Rust we must not:
    //   (a) materialize a second `&mut SpawnSyncEventLoop` here, nor
    //   (b) read `(*this).uws_loop` — the outer frame's `&mut self` access to `uws_loop` at the
    //       tick call popped the raw `*mut Self`'s Stacked-Borrows tag at those bytes, and the
    //       `&mut uws::Loop` it produced is still live around us.
    // So: touch only `(*this).did_timeout` (a `Cell`, interior-mutable), and obtain the uv loop
    // from the timer handle itself rather than routing through `*this`.
    unsafe {
        let this: *mut SpawnSyncEventLoop = (*timer_).data.cast::<SpawnSyncEventLoop>();
        (*this).did_timeout.set(true);
        (*libuv::uv_handle_get_loop(timer_.cast())).stop();
    }
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
        // NOTE: `timer.data` is assigned later in `tick_with_timeout`, immediately before the
        // uws tick, so the stored `*mut Self` derives directly from that frame's live `&mut self`
        // (not from this function's reborrow, which would be invalidated on return).
        unsafe {
            (*timer.as_ptr()).start(ts.ms_unsigned(), 0, on_uv_timer);
            (*timer.as_ptr()).ref_();
        }
        self.uv_timer = Some(timer);
    }

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
        // SAFETY: `self.vm` is a valid backref set in `init`/`prepare`;
        // the VM outlives this SpawnSyncEventLoop by construction.
        let _suppress = unsafe { SuppressMicrotaskDrain::new(self.vm) };
        // PORT NOTE: Zig `defer` restores at scope exit; RAII Drop mirrors that.

        // Tick the isolated uws loop with the specified timeout
        // This will only process I/O related to this subprocess
        // and will NOT interfere with the main event loop
        //
        // PORT NOTE: `bun_core::Timespec` and `bun_uws::Timespec` are distinct
        // nominal types but layout-identical (`#[repr(C)] {sec: i64, nsec: i64}`,
        // both mirroring `bun.timespec`). The C ABI only sees `*const timespec`,
        // so re-express the borrow as a `uws::Timespec` for `tick_with_timeout`.
        let uws_ts = duration.map(|ts| uws::Timespec { sec: ts.sec, nsec: ts.nsec });
        #[cfg(windows)]
        if let Some(t) = self.uv_timer {
            // ALIASING: store `*mut Self` here (not in `prepare_timer_on_windows`) so its
            // provenance is a direct child of *this* frame's `&mut self`. Between this store and
            // the re-entrant `on_uv_timer` callback, the only `self` field accessed is `uws_loop`
            // (next line), which the callback never reads — so the raw tag at `did_timeout`'s
            // bytes survives under Stacked Borrows.
            // SAFETY: `t` is a valid initialized libuv timer handle owned by `self`.
            unsafe { (*t.as_ptr()).data = (self as *mut Self).cast() };
        }
        // SAFETY: uws_loop is valid and exclusively owned.
        unsafe { (*self.uws_loop.as_ptr()).tick_with_timeout(uws_ts.as_ref()) };

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
                self.did_timeout.set(
                    Timespec::now(TimespecMockMode::AllowMockedTime).order(ts)
                        != core::cmp::Ordering::Less,
                );
            }
        }

        // SAFETY: `event_loop` is the live heap-owned isolated loop.
        unsafe { __bun_spawn_sync_event_loop_tick_tasks_only(self.event_loop) };

        let did_timeout = self.did_timeout.replace(false);

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
