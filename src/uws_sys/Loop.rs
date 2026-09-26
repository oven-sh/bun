use core::ffi::{c_int, c_uint};
use core::ptr::NonNull;

use crate::InternalLoopData;
use crate::Timespec;

bun_core::declare_scope!(Loop, visible);

/// A `now_ns` the caller has no reading to share for. The tick takes its own only if
/// it reaches the idle sweep, so passing this costs nothing on the paths that never park.
pub const NOW_NS_UNKNOWN: u64 = 0;

// Mirrors C `struct us_loop_t` (packages/bun-usockets/src/internal/eventing/
// epoll_kqueue.h, and iocp.h on Windows, which keeps the same leading fields
// in the same order). The C struct has `alignas(LIBUS_EXT_ALIGNMENT /* 16 */)`
// on both `data` and `ready_polls`; Rust cannot align individual fields, so the
// struct head gets `#[repr(C, align(16))]` and `ready_polls` is preceded by a
// zero-sized align(16) field that forces the same offset rounding the C
// `alignas` performs (`libc::epoll_event` is `packed`/align(1) on x86-64
// Linux, so the element type alone would not pad). Layout is verified by the
// static assertions below the struct.
//
// The loop is allocated and freed by C and only ever used behind a pointer.
// On Windows the mirror stops after the fields Rust reads; the C struct goes
// on (AFD helper handles, the wait timer, the dequeued completion packets).
#[repr(C, align(16))]
pub struct Loop {
    pub internal_loop_data: InternalLoopData,

    /// Number of non-fallthrough polls in the loop
    pub num_polls: i32,

    /// Number of ready polls this iteration
    pub num_ready_polls: i32,

    /// Current index in list of ready polls
    pub(crate) current_ready_poll: i32,

    /// Loop's own file descriptor
    #[cfg(not(windows))]
    pub fd: i32,

    /// The loop's I/O completion port
    #[cfg(windows)]
    pub iocp: *mut core::ffi::c_void,

    /// Number of polls owned by Bun
    pub active: u32,

    /// Incremented atomically by wakeup(), swapped to 0 before the loop waits.
    /// If non-zero, the event loop will return immediately so we can skip the GC safepoint.
    #[cfg(not(windows))]
    pub pending_wakeups: u32,

    /// Readiness of the Bun-owned socket poll being dispatched.
    #[cfg(windows)]
    current_ready_events: c_int,
    #[cfg(windows)]
    current_ready_error: c_int,
    #[cfg(windows)]
    current_ready_eof: c_int,

    /// Forces `ready_polls` to the next 16-byte boundary, matching the C
    /// `alignas(LIBUS_EXT_ALIGNMENT)` on `us_loop_t::ready_polls`.
    #[cfg(not(windows))]
    _ready_polls_align: ReadyPollsAlign,

    /// The list of ready polls
    #[cfg(not(windows))]
    pub(crate) ready_polls: [EventType; 1024],
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
#[cfg(not(windows))]
const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(align_of::<Loop>() == 16);
    assert!(offset_of!(Loop, num_polls) == size_of::<InternalLoopData>());
    assert!(offset_of!(Loop, num_ready_polls) == offset_of!(Loop, num_polls) + 4);
    assert!(offset_of!(Loop, current_ready_poll) == offset_of!(Loop, num_polls) + 8);
    assert!(offset_of!(Loop, fd) == offset_of!(Loop, num_polls) + 12);
    assert!(offset_of!(Loop, active) == offset_of!(Loop, num_polls) + 16);
    assert!(offset_of!(Loop, pending_wakeups) == offset_of!(Loop, num_polls) + 20);
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
/// What a Bun-owned socket poll is told when it is dispatched: `LIBUS_SOCKET_*`
/// readiness bits, whether the poll failed, and whether the peer sent FIN.
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct EventType {
    pub events: c_int,
    pub error: bool,
    pub eof: bool,
}

#[cfg(windows)]
const _: () = {
    use core::mem::offset_of;
    // `HANDLE iocp` is pointer-aligned, so it sits 4 bytes later than `int fd`.
    assert!(offset_of!(Loop, iocp) == offset_of!(Loop, num_polls) + 16);
    assert!(offset_of!(Loop, active) == offset_of!(Loop, num_polls) + 24);
    assert!(offset_of!(Loop, current_ready_events) == offset_of!(Loop, num_polls) + 28);
};

/// Loop handler trait with optional `pre`/`post` hooks. Implementors override
/// `PRE`/`POST` if they have them.
pub trait LoopHandler {
    const WAKEUP: unsafe extern "C" fn(*mut Loop);
    const PRE: Option<unsafe extern "C" fn(*mut Loop)> = None;
    const POST: Option<unsafe extern "C" fn(*mut Loop)> = None;
}

impl Loop {
    pub fn update_date(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::uws_loop_date_header_timer_update(self) };
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr
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
        let idx = usize::try_from(self.current_ready_poll).expect("int cast");
        self.ready_polls[idx]
    }

    #[cfg(windows)]
    #[inline]
    pub fn current_ready_event(&self) -> EventType {
        EventType {
            events: self.current_ready_events,
            error: self.current_ready_error != 0,
            eof: self.current_ready_eof != 0,
        }
    }

    pub fn inc(&mut self) {
        bun_core::scoped_log!(Loop, "inc {} + 1 = {}", self.num_polls, self.num_polls + 1);
        self.num_polls += 1;
    }

    pub fn dec(&mut self) {
        bun_core::scoped_log!(Loop, "dec {} - 1 = {}", self.num_polls, self.num_polls - 1);
        self.num_polls -= 1;
    }

    pub fn ref_(&mut self) {
        bun_core::scoped_log!(
            Loop,
            "ref {} + 1 = {} | {} + 1 = {}",
            self.num_polls,
            self.num_polls + 1,
            self.active,
            self.active + 1
        );
        self.num_polls += 1;
        self.active += 1;
    }

    pub fn unref(&mut self) {
        bun_core::scoped_log!(
            Loop,
            "unref {} - 1 = {} | {} - 1 = {}",
            self.num_polls,
            self.num_polls - 1,
            self.active,
            self.active.saturating_sub(1)
        );
        self.num_polls -= 1;
        self.active = self.active.saturating_sub(1);
    }

    pub fn is_active(&self) -> bool {
        self.active > 0
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn add_active(&mut self, value: u32) {
        bun_core::scoped_log!(
            Loop,
            "add {} + {} = {}",
            self.active,
            value,
            self.active.saturating_add(value)
        );
        self.active = self.active.saturating_add(value);
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn sub_active(&mut self, value: u32) {
        bun_core::scoped_log!(
            Loop,
            "sub {} - {} = {}",
            self.active,
            value,
            self.active.saturating_sub(value)
        );
        self.active = self.active.saturating_sub(value);
    }

    pub fn unref_count(&mut self, count: i32) {
        bun_core::scoped_log!(Loop, "unref x {}", count);
        self.num_polls -= count;
        self.active = self
            .active
            .saturating_sub(u32::try_from(count).expect("int cast"));
    }

    pub fn get() -> *mut Loop {
        c::uws_get_loop()
    }

    /// Packetize HTTP/3 stream writes that happened since the last
    /// process_conns. Early-returns when nothing wrote, so safe to call
    /// from drainMicrotasks without per-iteration cost.
    pub fn drain_quic_if_necessary(&mut self) {
        if !self.internal_loop_data.nq_head.is_null() {
            // Full pass with close dispatch deferred to the next loop point.
            // SAFETY: self is a valid loop pointer
            unsafe { c::us_nq_loop_drain(self) };
        }
        if self.internal_loop_data.quic_head.is_null() {
            return;
        }
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_quic_loop_flush_if_pending(self) };
    }

    /// `None` if the loop's kernel objects cannot be created (e.g. EMFILE).
    pub fn create<H: LoopHandler>() -> Option<NonNull<Loop>> {
        // SAFETY: us_create_loop allocates and returns a new loop
        let p = unsafe { c::us_create_loop(Some(H::WAKEUP), H::PRE, H::POST, 0) };
        NonNull::new(p)
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_wakeup_loop(self) };
    }

    pub fn tick(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_run_bun_tick(self, core::ptr::null(), NOW_NS_UNKNOWN) };
    }

    pub fn tick_without_idle(&mut self) {
        let timespec = Timespec { sec: 0, nsec: 0 };
        // SAFETY: self is a valid loop pointer; &timespec lives for the call
        unsafe { c::us_loop_run_bun_tick(self, &raw const timespec, NOW_NS_UNKNOWN) };
    }

    /// `now_ns` is the monotonic-clock reading the caller took to pick `timespec` (see
    /// `timer::All::get_timeout`), reused by the tick's idle-sweep rate limit rather
    /// than read again; on Windows `timespec` also counts from it when the wait
    /// timer is armed. `NOW_NS_UNKNOWN` if the caller has none to share.
    pub fn tick_with_timeout(&mut self, timespec: Option<&Timespec>, now_ns: u64) {
        // SAFETY: self is a valid loop pointer
        unsafe {
            c::us_loop_run_bun_tick(
                self,
                timespec.map_or(core::ptr::null(), std::ptr::from_ref),
                now_ns,
            )
        };
    }

    /// Free everything queued on `loop->data.closed_head` /
    /// `closed_connecting_head`. Normally `loop_post()` does this once per
    /// tick; at process/Worker teardown the loop has stopped, so
    /// `closeAllSocketGroups()` must drain it explicitly or every just-closed
    /// `us_socket_t` (libc-allocated) shows up as an LSAN leak.
    pub fn drain_closed_sockets(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_internal_free_closed_sockets(self) };
    }

    /// `us_socket_group_close_all()` on every group currently linked to this
    /// loop — covers Listener/App-owned groups that `RareData`'s static field
    /// list doesn't enumerate. Returns whether any group was linked.
    pub fn close_all_groups(&mut self) -> bool {
        // SAFETY: self is a valid loop pointer
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

#[allow(non_snake_case)]
mod c {
    use super::*;

    // `Loop` is a sized `#[repr(C)]` mirror of the
    // C struct (NOT an opaque ZST with `UnsafeCell`), so the safe-fn-with-`&mut`
    // pattern does not apply: `&mut Loop` at the FFI boundary would emit LLVM
    // `noalias` over real fields, and the reentrant callees (`us_loop_run_bun_tick`,
    // `us_loop_close_all_groups`, …) dispatch Rust callbacks that touch the same
    // loop via `Loop::get()`. Keep all loop-taking decls as raw `*mut Loop`.
    unsafe extern "C" {
        pub(super) fn us_create_loop(
            wakeup_cb: Option<LoopCb>,
            pre_cb: Option<LoopCb>,
            post_cb: Option<LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub(super) fn us_loop_free(loop_: *mut Loop);
        pub(super) fn us_quic_loop_flush_if_pending(loop_: *mut Loop);
        pub(super) fn us_nq_loop_drain(loop_: *mut Loop);
        pub fn us_wakeup_loop(loop_: *mut Loop);
        pub(super) fn us_loop_run_bun_tick(loop_: *mut Loop, timeout: *const Timespec, now_ns: u64);
        pub(super) fn us_internal_free_closed_sockets(loop_: *mut Loop);
        pub(super) fn us_loop_close_all_groups(loop_: *mut Loop) -> c_int;
        pub(super) safe fn uws_get_loop() -> *mut Loop;
        pub(super) fn uws_loop_date_header_timer_update(loop_: *mut Loop);
    }
}
// Raw extern for cross-thread callers (e.g. bun_http's `HTTPThread::wakeup`)
// that hold only a `*mut Loop` and must not form a `&mut Loop` via
// `Loop::wakeup` while the loop's own thread holds one: see the noalias note
// on `mod c`.
pub use c::us_wakeup_loop;

unsafe extern "C" {
    // safe: no args; frees this thread's lazily-created uws loop if it exists.
    safe fn bun_free_loop_at_thread_exit();
}

/// Frees this thread's uws loop (its socket groups and the native loop). Call
/// when a thread that ran a uws loop (a Worker) exits, after everything
/// registered on the loop is gone.
pub fn free_thread_loop() {
    bun_free_loop_at_thread_exit()
}
