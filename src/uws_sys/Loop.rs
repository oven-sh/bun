use core::cell::Cell;
use core::ffi::{c_int, c_uint};
use core::ptr::NonNull;

use crate::InternalLoopData;
use crate::Timespec;

bun_core::declare_scope!(Loop, visible);

/// A `now_ns` the caller has no reading to share for. The JS park hook takes its own only if
/// it reaches the idle sweep, so passing this costs nothing on the paths that never park.
pub const NOW_NS_UNKNOWN: u64 = 0;

// Mirrors C `struct us_loop_t` (packages/bun-usockets/src/internal/eventing/
// epoll_kqueue.h). On Windows (iocp.h) only its head, which is laid out the same:
// C allocates every loop, and what follows `pending_wakeups` is iocp.c's own.
// The C struct has `alignas(LIBUS_EXT_ALIGNMENT /* 16 */)` on
// both `data` and `ready_polls`; Rust cannot align individual fields, so the
// struct head gets `#[repr(C, align(16))]` and `ready_polls` is preceded by a
// zero-sized align(16) field that forces the same offset rounding the C
// `alignas` performs (`libc::epoll_event` is `packed`/align(1) on x86-64
// Linux, so the element type alone would not pad). Layout is verified by the
// static assertions below the struct.
//
// Every field is a `Cell` (as in `InternalLoopData`), so a `&Loop` claims nothing about the bytes
// behind it: C and the callbacks it dispatches write them while `tick()` borrows the loop.
#[repr(C, align(16))]
pub struct Loop {
    pub internal_loop_data: InternalLoopData,

    /// Number of non-fallthrough polls in the loop
    pub num_polls: Cell<i32>,

    /// Number of ready polls this iteration
    num_ready_polls: Cell<i32>,

    /// Current index in list of ready polls
    current_ready_poll: Cell<i32>,

    /// Loop's own file descriptor. Unused on Windows.
    fd: Cell<i32>,

    /// Number of polls owned by Bun
    pub active: Cell<u32>,

    /// Incremented atomically by wakeup(), swapped to 0 before epoll/kqueue.
    /// If non-zero, the event loop will return immediately so we can skip the GC safepoint.
    /// Other threads write it, so Rust never reads it.
    pending_wakeups: Cell<u32>,

    /// Forces `ready_polls` to the next 16-byte boundary, matching the C
    /// `alignas(LIBUS_EXT_ALIGNMENT)` on `us_loop_t::ready_polls`.
    #[cfg(not(windows))]
    _ready_polls_align: ReadyPollsAlign,

    /// The list of ready polls
    #[cfg(not(windows))]
    ready_polls: [Cell<EventType>; 1024],
}

/// Zero-sized, 16-byte-aligned marker field type (see `_ready_polls_align`).
/// The zero-length array member keeps `improper_ctypes` satisfied (a
/// field-less struct is rejected in `extern` signatures) without changing
/// size (still 0) or alignment.
#[cfg(not(windows))]
#[repr(C, align(16))]
struct ReadyPollsAlign {
    _unused: [u8; 0],
}

// Static layout verification against the C `us_loop_t` rules: scalar fields
// packed after `data`, `ready_polls` at the next 16-byte boundary, struct size
// padded to its 16-byte alignment.
const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(align_of::<Loop>() == 16);
    assert!(offset_of!(Loop, num_polls) == size_of::<InternalLoopData>());
    assert!(offset_of!(Loop, num_ready_polls) == offset_of!(Loop, num_polls) + 4);
    assert!(offset_of!(Loop, current_ready_poll) == offset_of!(Loop, num_polls) + 8);
    assert!(offset_of!(Loop, fd) == offset_of!(Loop, num_polls) + 12);
    assert!(offset_of!(Loop, active) == offset_of!(Loop, num_polls) + 16);
    assert!(offset_of!(Loop, pending_wakeups) == offset_of!(Loop, num_polls) + 20);
};
#[cfg(not(windows))]
const _: () = {
    use core::mem::{offset_of, size_of};
    assert!(
        offset_of!(Loop, ready_polls)
            == (offset_of!(Loop, pending_wakeups) + 4).next_multiple_of(16)
    );
    assert!(
        size_of::<Loop>()
            == (offset_of!(Loop, ready_polls) + 1024 * size_of::<EventType>()).next_multiple_of(16)
    );
};

// Android shares the Linux kernel's epoll ABI (uSockets' `epoll_kqueue.h` only
// branches on `LIBUS_USE_EPOLL` vs `LIBUS_USE_KQUEUE`, not on libc).
#[cfg(any(target_os = "linux", target_os = "android"))]
pub type EventType = libc::epoll_event;
#[cfg(target_os = "macos")]
pub type EventType = libc::kevent64_s;
// usockets aliases kevent64_s → struct kevent on FreeBSD (epoll_kqueue.h),
// so ready_polls is `struct kevent[1024]` there.
#[cfg(target_os = "freebsd")]
pub type EventType = libc::kevent;

/// Loop handler trait with optional `pre`/`post` hooks. Implementors override
/// `PRE`/`POST` if they have them.
pub trait LoopHandler {
    const WAKEUP: unsafe extern "C" fn(*mut Loop);
    const PRE: Option<unsafe extern "C" fn(*mut Loop)> = None;
    const POST: Option<unsafe extern "C" fn(*mut Loop)> = None;
}

impl Loop {
    /// The epoll / kqueue descriptor.
    #[cfg(not(windows))]
    #[inline]
    pub fn fd(&self) -> i32 {
        self.fd.get()
    }

    pub fn update_date(&self) {
        // SAFETY: needs uWS's `LoopData` behind the loop. Every loop has it but spawnSync's, which
        // `create` makes without one and which no safe `pub fn` hands out as a reference.
        unsafe { c::uws_loop_date_header_timer_update(self) };
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr.get()
    }

    /// Copy out the ready-poll event at `current_ready_poll`.
    ///
    /// Safe back-reference accessor consolidating the C-dispatch
    /// `(*loop_).ready_polls[(*loop_).current_ready_poll]` raw-deref pattern
    /// into one short-lived `&self` borrow. `EventType` is POD (`epoll_event`
    /// / `kevent64_s` / `kevent` — all `Copy` in `libc`), so the by-value
    /// return is a stack copy the caller may borrow across re-entrant handler
    /// dispatch without aliasing the loop.
    #[cfg(not(windows))]
    #[inline]
    pub fn current_ready_event(&self) -> EventType {
        let idx = usize::try_from(self.current_ready_poll.get()).expect("int cast");
        self.ready_polls[idx].get()
    }

    pub fn inc(&self) {
        let num_polls = self.num_polls.get();
        bun_core::scoped_log!(Loop, "inc {} + 1 = {}", num_polls, num_polls + 1);
        self.num_polls.set(num_polls + 1);
    }

    pub fn dec(&self) {
        let num_polls = self.num_polls.get();
        bun_core::scoped_log!(Loop, "dec {} - 1 = {}", num_polls, num_polls - 1);
        self.num_polls.set(num_polls - 1);
    }

    pub fn ref_(&self) {
        let (num_polls, active) = (self.num_polls.get(), self.active.get());
        bun_core::scoped_log!(
            Loop,
            "ref {} + 1 = {} | {} + 1 = {}",
            num_polls,
            num_polls + 1,
            active,
            active + 1
        );
        self.num_polls.set(num_polls + 1);
        self.active.set(active + 1);
    }

    pub fn unref(&self) {
        let (num_polls, active) = (self.num_polls.get(), self.active.get());
        bun_core::scoped_log!(
            Loop,
            "unref {} - 1 = {} | {} - 1 = {}",
            num_polls,
            num_polls - 1,
            active,
            active.saturating_sub(1)
        );
        self.num_polls.set(num_polls - 1);
        self.active.set(active.saturating_sub(1));
    }

    pub fn is_active(&self) -> bool {
        self.active.get() > 0
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn add_active(&self, value: u32) {
        let active = self.active.get();
        bun_core::scoped_log!(
            Loop,
            "add {} + {} = {}",
            active,
            value,
            active.saturating_add(value)
        );
        self.active.set(active.saturating_add(value));
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn sub_active(&self, value: u32) {
        let active = self.active.get();
        bun_core::scoped_log!(
            Loop,
            "sub {} - {} = {}",
            active,
            value,
            active.saturating_sub(value)
        );
        self.active.set(active.saturating_sub(value));
    }

    pub fn unref_count(&self, count: i32) {
        bun_core::scoped_log!(Loop, "unref x {}", count);
        self.num_polls.set(self.num_polls.get() - count);
        self.active.set(
            self.active
                .get()
                .saturating_sub(u32::try_from(count).expect("int cast")),
        );
    }

    pub fn get() -> *mut Loop {
        c::uws_get_loop()
    }

    /// Packetize HTTP/3 stream writes that happened since the last
    /// process_conns. Early-returns when nothing wrote, so safe to call
    /// from drainMicrotasks without per-iteration cost.
    pub fn drain_quic_if_necessary(&self) {
        if !self.internal_loop_data.nq_head.get().is_null() {
            // Full pass with close dispatch deferred to the next loop point.
            // SAFETY: `self` is this thread's live loop. The walk holds its successor while JS
            // runs, and relies on an endpoint staying rooted until its close is delivered.
            unsafe { c::us_nq_loop_drain(self) };
        }
        if !self.internal_loop_data.has_quic() {
            return;
        }
        // SAFETY: `self` is this thread's live loop. `processing` keeps this out of every lsquic
        // callback but the `on_stream_open` that `us_quic_socket_make_stream` makes, and that one
        // does not flush.
        unsafe { c::us_quic_loop_flush_if_pending(self) };
    }

    /// `None` if the epoll/kqueue descriptor or the completion port cannot be created (EMFILE).
    pub fn create<H: LoopHandler>() -> Option<NonNull<Loop>> {
        NonNull::new(c::us_create_loop(Some(H::WAKEUP), H::PRE, H::POST, 0))
    }

    pub fn wakeup(&self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_wakeup_loop(self) };
    }

    pub fn tick(&self) {
        // SAFETY: as in `tick_with_timeout`.
        unsafe { c::us_loop_run_bun_tick(self, None, NOW_NS_UNKNOWN) };
    }

    pub fn tick_without_idle(&self) {
        // SAFETY: as in `tick_with_timeout`.
        unsafe {
            c::us_loop_run_bun_tick(self, Some(&Timespec { sec: 0, nsec: 0 }), NOW_NS_UNKNOWN)
        };
    }

    /// `now_ns` is the CLOCK_MONOTONIC reading the caller took to pick `timespec` (see
    /// `timer::All::get_timeout`), reused by the JS park hook's idle-sweep rate limit rather
    /// than read again. `NOW_NS_UNKNOWN` if the caller has none to share.
    pub fn tick_with_timeout(&self, timespec: Option<&Timespec>, now_ns: u64) {
        // SAFETY: `self` is this thread's live loop, and `jsc_vm` is null or its live VM. A handler
        // may tick (`tick_depth`), but that refills the receive buffer and can dispatch the same
        // socket again: such a handler is done with what the dispatch lent it.
        unsafe { c::us_loop_run_bun_tick(self, timespec, now_ns) };
    }

    /// Free everything queued on `loop->data.closed_head` /
    /// `closed_connecting_head`. Normally `loop_post()` does this once per
    /// tick; at process/Worker teardown the loop has stopped, so
    /// `closeAllSocketGroups()` must drain it explicitly or every just-closed
    /// `us_socket_t` (libc-allocated) shows up as an LSAN leak.
    pub fn drain_closed_sockets(&self) {
        // SAFETY: nothing up the stack is dispatching this loop's events, so nothing still holds a
        // closed socket: both callers run at teardown, once the loop has stopped.
        unsafe { c::us_internal_free_closed_sockets(self) };
    }

    /// Runs the uWS pre handler, which flushes queued `publish()` batches and leftover corks.
    pub fn flush_pending_writes(&self) {
        // SAFETY: needs uWS's `LoopData` behind the loop. Every loop has it but spawnSync's, which
        // `create` makes without one and which no safe `pub fn` hands out as a reference.
        unsafe { c::uws_loop_flush_pending_writes(self) };
    }

    /// `us_socket_group_close_all()` on every group currently linked to this
    /// loop — covers Listener/App-owned groups that `RareData`'s static field
    /// list doesn't enumerate. Returns whether any group was linked.
    pub fn close_all_groups(&self) -> bool {
        // SAFETY: `self` is this thread's live loop. The walk reads its successor after the close
        // handlers ran, so none may free another group. The one caller runs at teardown, with the
        // owners of the groups stopped and script forbidden.
        unsafe { c::us_loop_close_all_groups(self) != 0 }
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }

    /// FFI-destroy: `us_loop_free` frees the C-allocated loop itself.
    /// Not `impl Drop` because the loop is C-owned (created by `us_create_loop`),
    /// never lives as a Rust-owned value.
    ///
    /// # Safety
    /// `this` must have been returned by `us_create_loop`/`uws_get_loop` and not
    /// yet freed.
    pub unsafe fn destroy(this: *mut Loop) {
        // SAFETY: `this` was returned by us_create_loop/uws_get_loop and not yet freed
        unsafe { c::us_loop_free(this) };
    }
}

// ───────────────────────────── extern "C" ─────────────────────────────

type LoopCb = unsafe extern "C" fn(*mut Loop);

mod c {
    use super::*;

    // `&Loop` is sound for the reentrant callees (`us_loop_run_bun_tick`, `us_loop_close_all_groups`, …),
    // whose callbacks reach the same loop via `Loop::get()`, because every field is a `Cell`.
    // `safe fn` only where a live loop on its own thread is all that C asks for.
    unsafe extern "C" {
        pub(super) safe fn us_create_loop(
            wakeup_cb: Option<LoopCb>,
            pre_cb: Option<LoopCb>,
            post_cb: Option<LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub(super) fn us_loop_free(loop_: *mut Loop);
        pub(super) fn us_quic_loop_flush_if_pending(loop_: &Loop);
        pub(super) fn us_nq_loop_drain(loop_: &Loop);
        pub fn us_wakeup_loop(loop_: *const Loop);
        pub(super) fn us_loop_run_bun_tick(
            loop_: &Loop,
            timeout_ms: Option<&Timespec>,
            now_ns: u64,
        );
        pub(super) fn us_internal_free_closed_sockets(loop_: &Loop);
        pub(super) fn us_loop_close_all_groups(loop_: &Loop) -> c_int;
        pub(super) safe fn uws_get_loop() -> *mut Loop;
        pub(super) fn uws_loop_date_header_timer_update(loop_: &Loop);
        pub(super) fn uws_loop_flush_pending_writes(loop_: &Loop);
    }
}
// Raw, for callers on another thread that hold only a pointer (e.g. bun_http's
// `HTTPThread::wakeup`): `Loop` is `!Sync`.
pub use c::us_wakeup_loop;

unsafe extern "C" {
    // safe: no args; frees this thread's lazily-created uws loop if it exists.
    safe fn bun_free_loop_at_thread_exit();
}

/// Frees this thread's uws loop. Call when a thread that ran a uws loop (a
/// Worker) exits, after everything registered on the loop is gone.
pub fn free_thread_loop() {
    bun_free_loop_at_thread_exit()
}
