use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use crate::InternalLoopData;
use crate::Timespec;

#[cfg(windows)]
use bun_libuv_sys as uv;

bun_core::declare_scope!(Loop, visible);

/// A `now_ns` the caller has no reading to share for. The JS park hook takes its own only if
/// it reaches the idle sweep, so passing this costs nothing on the paths that never park.
pub const NOW_NS_UNKNOWN: u64 = 0;

// ───────────────────────────── PosixLoop ─────────────────────────────

// Mirrors C `struct us_loop_t` (packages/bun-usockets/src/internal/eventing/
// epoll_kqueue.h). The C struct has `alignas(LIBUS_EXT_ALIGNMENT /* 16 */)` on
// both `data` and `ready_polls`; Rust cannot align individual fields, so the
// struct head gets `#[repr(C, align(16))]` and `ready_polls` is preceded by a
// zero-sized align(16) field that forces the same offset rounding the C
// `alignas` performs (`libc::epoll_event` is `packed`/align(1) on x86-64
// Linux, so the element type alone would not pad). Layout is verified by the
// static assertions below the struct.
//
// Every field is a `Cell` (see `InternalLoopData`), so a `&Loop` claims nothing about the bytes
// behind it: C and the callbacks it dispatches write them while `tick()` borrows the loop.
#[repr(C, align(16))]
pub struct PosixLoop {
    pub internal_loop_data: InternalLoopData,

    /// Number of non-fallthrough polls in the loop
    pub num_polls: Cell<i32>,

    /// Number of ready polls this iteration
    pub num_ready_polls: Cell<i32>,

    /// Current index in list of ready polls
    pub(crate) current_ready_poll: Cell<i32>,

    /// Loop's own file descriptor
    pub fd: Cell<i32>,

    /// Number of polls owned by Bun
    pub active: Cell<u32>,

    /// Incremented atomically by wakeup(), swapped to 0 before epoll/kqueue.
    /// If non-zero, the event loop will return immediately so we can skip the GC safepoint.
    /// Other threads write it, so Rust never reads it.
    pending_wakeups: Cell<u32>,

    /// Forces `ready_polls` to the next 16-byte boundary, matching the C
    /// `alignas(LIBUS_EXT_ALIGNMENT)` on `us_loop_t::ready_polls`.
    _ready_polls_align: ReadyPollsAlign,

    /// The list of ready polls
    pub(crate) ready_polls: [Cell<EventType>; 1024],
}

/// Zero-sized, 16-byte-aligned marker field type (see `_ready_polls_align`).
/// The zero-length array member keeps `improper_ctypes` satisfied (a
/// field-less struct is rejected in `extern` signatures) without changing
/// size (still 0) or alignment.
#[repr(C, align(16))]
struct ReadyPollsAlign {
    _unused: [u8; 0],
}

// Static layout verification against the C `us_loop_t` rules: scalar fields
// packed after `data`, `ready_polls` at the next 16-byte boundary, struct size
// padded to its 16-byte alignment.
#[cfg(not(windows))]
const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(align_of::<PosixLoop>() == 16);
    assert!(offset_of!(PosixLoop, num_polls) == size_of::<InternalLoopData>());
    assert!(offset_of!(PosixLoop, num_ready_polls) == offset_of!(PosixLoop, num_polls) + 4);
    assert!(offset_of!(PosixLoop, current_ready_poll) == offset_of!(PosixLoop, num_polls) + 8);
    assert!(offset_of!(PosixLoop, fd) == offset_of!(PosixLoop, num_polls) + 12);
    assert!(offset_of!(PosixLoop, active) == offset_of!(PosixLoop, num_polls) + 16);
    assert!(offset_of!(PosixLoop, pending_wakeups) == offset_of!(PosixLoop, num_polls) + 20);
    assert!(
        offset_of!(PosixLoop, ready_polls)
            == (offset_of!(PosixLoop, pending_wakeups) + 4).next_multiple_of(16)
    );
    assert!(
        size_of::<PosixLoop>()
            == (offset_of!(PosixLoop, ready_polls) + 1024 * size_of::<EventType>())
                .next_multiple_of(16)
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
// TODO:
#[cfg(windows)]
pub type EventType = *mut c_void;

/// Loop handler trait with optional `pre`/`post` hooks. Implementors override
/// `PRE`/`POST` if they have them.
pub trait LoopHandler {
    const WAKEUP: unsafe extern "C" fn(*mut Loop);
    const PRE: Option<unsafe extern "C" fn(*mut Loop)> = None;
    const POST: Option<unsafe extern "C" fn(*mut Loop)> = None;
}

// `impl PosixLoop` is posix-only: every method calls into `c::*` whose
// signatures are typed `*mut Loop`, and on Windows `Loop = WindowsLoop` so
// `&mut PosixLoop` does not coerce. Windows callers go through the
// `impl WindowsLoop` block below (same surface, different routing).
#[cfg(not(windows))]
impl PosixLoop {
    /// For C, and for what stores the loop to hand to C later.
    #[inline]
    pub fn as_ptr(&self) -> *mut Loop {
        core::ptr::from_ref(self).cast_mut()
    }

    pub fn update_date(&self) {
        c::uws_loop_date_header_timer_update(self);
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr.get()
    }

    /// The ready-poll event at `current_ready_poll`.
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

    /// This thread's loop, made on the first call.
    pub fn get() -> &'static Loop {
        // SAFETY: never null. Only `free_thread_loop` frees it, whose caller promises that this
        // thread is done with it, and `Loop` is `!Sync`, so the reference stays on this thread.
        unsafe { &*c::uws_get_loop() }
    }

    /// Packetize HTTP/3 stream writes that happened since the last
    /// process_conns. Early-returns when nothing wrote, so safe to call
    /// from drainMicrotasks without per-iteration cost.
    pub fn drain_quic_if_necessary(&self) {
        if !self.internal_loop_data.nq_head.get().is_null() {
            // Full pass with close dispatch deferred to the next loop point.
            c::us_nq_loop_drain(self);
        }
        if self.internal_loop_data.quic_head.get().is_null() {
            return;
        }
        c::us_quic_loop_flush_if_pending(self);
    }

    /// `None` if epoll/kqueue cannot be created (EMFILE).
    pub fn create<H: LoopHandler>() -> Option<OwnedLoop> {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid
        let p = unsafe {
            c::us_create_loop(core::ptr::null_mut(), Some(H::WAKEUP), H::PRE, H::POST, 0)
        };
        NonNull::new(p).map(OwnedLoop)
    }

    /// From the loop's own thread. Another thread has no `&Loop`: it calls [`us_wakeup_loop`].
    pub fn wakeup(&self) {
        // SAFETY: a live loop.
        unsafe { c::us_wakeup_loop(self.as_ptr()) };
    }

    pub fn tick(&self) {
        c::us_loop_run_bun_tick(self, None, NOW_NS_UNKNOWN);
    }

    pub fn tick_without_idle(&self) {
        c::us_loop_run_bun_tick(self, Some(&Timespec { sec: 0, nsec: 0 }), NOW_NS_UNKNOWN);
    }

    /// `now_ns` is the CLOCK_MONOTONIC reading the caller took to pick `timespec` (see
    /// `timer::All::get_timeout`), reused by the JS park hook's idle-sweep rate limit rather
    /// than read again. `NOW_NS_UNKNOWN` if the caller has none to share.
    pub fn tick_with_timeout(&self, timespec: Option<&Timespec>, now_ns: u64) {
        c::us_loop_run_bun_tick(self, timespec, now_ns);
    }

    /// Free everything queued on `loop->data.closed_head` /
    /// `closed_connecting_head`. Normally `loop_post()` does this once per
    /// tick; at process/Worker teardown the loop has stopped, so
    /// `closeAllSocketGroups()` must drain it explicitly or every just-closed
    /// `us_socket_t` (libc-allocated) shows up as an LSAN leak.
    pub fn drain_closed_sockets(&self) {
        c::us_internal_free_closed_sockets(self);
    }

    /// Runs the uWS pre handler, which flushes queued `publish()` batches and leftover corks.
    pub fn flush_pending_writes(&self) {
        c::uws_loop_flush_pending_writes(self);
    }

    /// `us_socket_group_close_all()` on every group currently linked to this
    /// loop — covers Listener/App-owned groups that `RareData`'s static field
    /// list doesn't enumerate. Returns whether any group was linked.
    pub fn close_all_groups(&self) -> bool {
        c::us_loop_close_all_groups(self) != 0
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }
}

// ───────────────────────────── WindowsLoop ─────────────────────────────

#[cfg(windows)]
#[repr(C, align(16))]
pub struct WindowsLoop {
    pub internal_loop_data: InternalLoopData,

    pub uv_loop: Cell<*mut uv::Loop>,
    pub is_default: Cell<c_int>,
    pub pre: Cell<*mut uv::uv_prepare_t>,
    pub check: Cell<*mut uv::uv_check_t>,
    pub idle_sweep_timer: Cell<*mut crate::Timer>,
}

#[cfg(windows)]
impl WindowsLoop {
    /// For C, and for what stores the loop to hand to C later.
    #[inline]
    pub fn as_ptr(&self) -> *mut Loop {
        core::ptr::from_ref(self).cast_mut()
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }

    /// This thread's loop, made on the first call.
    pub fn get() -> &'static WindowsLoop {
        // SAFETY: wraps this thread's libuv loop; never null. Only `free_thread_loop` frees it,
        // whose caller promises that this thread is done with it, and `Loop` is `!Sync`, so the
        // reference stays on this thread.
        unsafe { &*c::uws_get_loop_with_native(uv::Loop::get().as_ptr().cast()) }
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr.get()
    }

    /// The libuv loop this one runs on.
    #[inline]
    pub fn uv(&self) -> &uv::Loop {
        // SAFETY: `us_create_loop` sets `uv_loop`, nothing reassigns it, and it outlives `*self`.
        unsafe { &*self.uv_loop.get() }
    }

    pub fn add_active(&self, val: u32) {
        self.uv().add_active(val);
    }

    pub fn sub_active(&self, val: u32) {
        self.uv().sub_active(val);
    }

    pub fn is_active(&self) -> bool {
        self.uv().is_active()
    }

    /// From the loop's own thread. Another thread has no `&Loop`: it calls [`us_wakeup_loop`].
    pub fn wakeup(&self) {
        // SAFETY: a live loop.
        unsafe { c::us_wakeup_loop(self.as_ptr()) };
    }

    #[inline]
    pub fn wake(&self) {
        self.wakeup();
    }

    /// Signature matches the POSIX impl so callers need no `cfg`. `now_ns` is unused here: on
    /// Windows the park hook is driven from `us_loop_run` (libuv.c), which reads libuv's
    /// already-refreshed clock via `uv_now` rather than taking one of its own.
    pub fn tick_with_timeout(&self, _: Option<&Timespec>, _now_ns: u64) {
        self.run();
    }

    pub fn tick_without_idle(&self) {
        c::us_loop_pump(self);
    }

    pub fn drain_quic_if_necessary(&self) {
        if !self.internal_loop_data.nq_head.get().is_null() {
            // Full pass with close dispatch deferred to the next loop point.
            c::us_nq_loop_drain(self);
        }
        if self.internal_loop_data.quic_head.get().is_null() {
            return;
        }
        c::us_quic_loop_flush_if_pending(self);
    }

    /// `None` if `uv_loop_init` fails (handle exhaustion).
    pub fn create<H: LoopHandler>() -> Option<OwnedLoop> {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid
        let p = unsafe {
            c::us_create_loop(core::ptr::null_mut(), Some(H::WAKEUP), H::PRE, H::POST, 0)
        };
        NonNull::new(p).map(OwnedLoop)
    }

    pub fn run(&self) {
        // SAFETY: a live loop.
        unsafe { c::us_loop_run(self.as_ptr()) };
    }

    // TODO: remove these two aliases
    #[inline]
    pub fn tick(&self) {
        self.run();
    }
    #[inline]
    pub fn wait(&self) {
        self.run();
    }

    pub fn inc(&self) {
        self.uv().inc();
    }

    pub fn dec(&self) {
        self.uv().dec();
    }

    #[inline]
    pub fn ref_(&self) {
        self.inc();
    }
    #[inline]
    pub fn unref(&self) {
        self.dec();
    }

    pub fn drain_closed_sockets(&self) {
        c::us_internal_free_closed_sockets(self);
    }

    pub fn flush_pending_writes(&self) {
        c::uws_loop_flush_pending_writes(self);
    }

    pub fn close_all_groups(&self) -> bool {
        c::us_loop_close_all_groups(self) != 0
    }

    pub fn update_date(&self) {
        c::uws_loop_date_header_timer_update(self);
    }
}

// ───────────────────────────── Loop alias ─────────────────────────────

#[cfg(windows)]
pub type Loop = WindowsLoop;
#[cfg(not(windows))]
pub type Loop = PosixLoop;

/// A loop [`Loop::create`] made. Freed on drop.
pub struct OwnedLoop(NonNull<Loop>);

impl core::ops::Deref for OwnedLoop {
    type Target = Loop;
    #[inline]
    fn deref(&self) -> &Loop {
        // SAFETY: `us_create_loop` returned it and only `drop` frees it.
        unsafe { self.0.as_ref() }
    }
}

impl Drop for OwnedLoop {
    fn drop(&mut self) {
        // SAFETY: as `deref`; nothing borrows `self` any more.
        unsafe { c::us_loop_free(self.0.as_ptr()) };
    }
}

// ───────────────────────────── extern "C" ─────────────────────────────

type LoopCb = unsafe extern "C" fn(*mut Loop);

mod c {
    use super::*;

    // `safe fn` with `&Loop`: every field of `Loop` is a `Cell`, so the reference is neither
    // `noalias` nor `readonly`, and the callbacks the re-entrant callees dispatch (`us_loop_run`,
    // `us_loop_close_all_groups`, …) may reach the same loop through `Loop::get()`.
    unsafe extern "C" {
        pub(super) fn us_create_loop(
            hint: *mut c_void,
            wakeup_cb: Option<LoopCb>,
            pre_cb: Option<LoopCb>,
            post_cb: Option<LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub(super) fn us_loop_free(loop_: *mut Loop);
        pub(super) safe fn us_quic_loop_flush_if_pending(loop_: &Loop);
        pub(super) safe fn us_nq_loop_drain(loop_: &Loop);
        pub fn us_loop_run(loop_: *mut Loop);
        #[cfg(windows)]
        pub(super) safe fn us_loop_pump(loop_: &Loop);
        pub fn us_wakeup_loop(loop_: *mut Loop);
        #[cfg(not(windows))]
        pub(super) safe fn us_loop_run_bun_tick(
            loop_: &Loop,
            timeout_ms: Option<&Timespec>,
            now_ns: u64,
        );
        pub(super) safe fn us_internal_free_closed_sockets(loop_: &Loop);
        pub(super) safe fn us_loop_close_all_groups(loop_: &Loop) -> c_int;
        #[cfg(not(windows))]
        pub(super) safe fn uws_get_loop() -> *mut Loop;
        #[cfg(windows)]
        pub(super) fn uws_get_loop_with_native(native: *mut c_void) -> *mut WindowsLoop;
        pub(super) safe fn uws_loop_date_header_timer_update(loop_: &Loop);
        pub(super) safe fn uws_loop_flush_pending_writes(loop_: &Loop);
    }
}
// For a thread that holds only a `*mut Loop` to another thread's loop (bun_http's
// `HTTPThread::wakeup`, bun_io's `WindowsWaker`, `EventLoop`'s posters).
pub use c::{us_loop_run, us_wakeup_loop};

unsafe extern "C" {
    // safe: no args; frees this thread's lazily-created uws loop if it exists.
    safe fn bun_free_loop_at_thread_exit();
}

/// Frees this thread's uws loop (its socket groups, timers and — where uSockets
/// created it — the native loop). Call when a thread that ran a uws loop (a
/// Worker) exits, after everything registered on the loop is gone. On Windows
/// the loop borrows the thread's libuv loop; close that afterwards.
///
/// # Safety
/// No thread uses a reference [`Loop::get`] returned here, or a pointer to the loop (other threads
/// hold one to wake it), again.
pub unsafe fn free_thread_loop() {
    bun_free_loop_at_thread_exit()
}
