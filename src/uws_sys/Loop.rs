use core::ffi::{c_int, c_uint, c_void};

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
#[repr(C, align(16))]
pub struct PosixLoop {
    pub internal_loop_data: InternalLoopData,

    /// Number of non-fallthrough polls in the loop
    pub num_polls: i32,

    /// Number of ready polls this iteration
    pub num_ready_polls: i32,

    /// Current index in list of ready polls
    pub current_ready_poll: i32,

    /// Loop's own file descriptor
    pub fd: i32,

    /// Number of polls owned by Bun
    pub active: u32,

    /// Incremented atomically by wakeup(), swapped to 0 before epoll/kqueue.
    /// If non-zero, the event loop will return immediately so we can skip the GC safepoint.
    pub pending_wakeups: u32,

    /// Forces `ready_polls` to the next 16-byte boundary, matching the C
    /// `alignas(LIBUS_EXT_ALIGNMENT)` on `us_loop_t::ready_polls`.
    _ready_polls_align: ReadyPollsAlign,

    /// The list of ready polls
    pub ready_polls: [EventType; 1024],
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
    pub fn uncork(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::uws_res_clear_corked_socket(self) };
    }

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
    #[inline]
    pub fn current_ready_event(&self) -> EventType {
        let idx = usize::try_from(self.current_ready_poll).expect("int cast");
        self.ready_polls[idx]
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
        if self.internal_loop_data.quic_head.is_null() {
            return;
        }
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_quic_loop_flush_if_pending(self) };
    }

    pub fn create<H: LoopHandler>() -> *mut Loop {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid
        let p = unsafe {
            c::us_create_loop(core::ptr::null_mut(), Some(H::WAKEUP), H::PRE, H::POST, 0)
        };
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_wakeup_loop(self) };
    }

    /// Nanoseconds this loop has spent parked, for eventLoopUtilization().
    /// `&self`: a parent thread reads this while the worker holds its own
    /// `&mut` — the body is one atomic load, so it must not alias mutably.
    pub fn idle_ns(&self) -> u64 {
        // SAFETY: self is a valid loop pointer; the counter is read atomically.
        unsafe { c::us_loop_idle_ns(core::ptr::from_ref(self).cast_mut()) }
    }

    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
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

    /// `now_ns` is the CLOCK_MONOTONIC reading the caller took to pick `timespec` (see
    /// `timer::All::get_timeout`), reused by the JS park hook's idle-sweep rate limit rather
    /// than read again. `NOW_NS_UNKNOWN` if the caller has none to share.
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

    // Rust cannot monomorphize an `extern "C"` fn over a fn-pointer const generic on stable,
    // so callers provide the C-ABI trampoline directly.
    pub fn next_tick(
        &mut self,
        user_data: *mut c_void,
        defer_callback: unsafe extern "C" fn(*mut c_void),
    ) {
        // SAFETY: self is a valid loop pointer; user_data lifetime is caller's responsibility
        unsafe { c::uws_loop_defer(self, user_data, defer_callback) };
    }

    // Same trampoline-synthesis limitation as `next_tick` — callers pass the
    // C-ABI callback directly. The returned `Handler` stores it for later removal.
    //
    // Takes `this: *mut Self` (not `&mut self`) so the stored `Handler.loop_` inherits the
    // long-lived raw-pointer provenance from `us_create_loop`/`uws_get_loop`. Routing through
    // a `&mut self` reborrow would bound the stored pointer's provenance to this call, and any
    // subsequent `&mut`/`&` to the C-owned singleton would invalidate it under Stacked Borrows,
    // making the later FFI write in `Handler::remove_*` UB.
    /// # Safety
    /// `this` must be the live C-allocated loop pointer returned by
    /// `us_create_loop`/`uws_get_loop` (not derived from a `&mut` reborrow).
    pub unsafe fn add_post_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        // SAFETY: `this` is the live C-allocated loop pointer per fn contract.
        unsafe { c::uws_loop_addPostHandler(this, ctx, callback) };
        Handler { loop_: this }
    }

    /// # Safety
    /// `this` must be the live C-allocated loop pointer returned by
    /// `us_create_loop`/`uws_get_loop` (not derived from a `&mut` reborrow).
    pub unsafe fn add_pre_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        // SAFETY: `this` is the live C-allocated loop pointer per fn contract.
        unsafe { c::uws_loop_addPreHandler(this, ctx, callback) };
        Handler { loop_: this }
    }

    pub fn run(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_run(self) };
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
    pub unsafe fn destroy(this: *mut PosixLoop) {
        // SAFETY: `this` was returned by us_create_loop/uws_get_loop and not yet freed
        unsafe { c::us_loop_free(this) };
    }
}

/// Stores the loop ref and the C-ABI callback so it can be unregistered later.
///
/// Stores `*mut Loop` (not `&Loop`)
/// — the loop is C-owned/heap-allocated and the FFI remove calls mutate it, so a
/// shared `&Loop` would make the `*const → *mut` cast UB when written through.
pub struct Handler {
    pub loop_: *mut Loop,
}

// ───────────────────────────── WindowsLoop ─────────────────────────────

#[cfg(windows)]
#[repr(C, align(16))]
pub struct WindowsLoop {
    pub internal_loop_data: InternalLoopData,

    pub uv_loop: *mut uv::Loop,
    pub is_default: c_int,
    pub pre: *mut uv::uv_prepare_t,
    pub check: *mut uv::uv_check_t,
}

#[cfg(windows)]
impl WindowsLoop {
    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }

    pub fn uncork(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::uws_res_clear_corked_socket(self) };
    }

    pub fn get() -> *mut WindowsLoop {
        // SAFETY: uv::Loop::get() returns the libuv default loop; uws wraps it
        unsafe { c::uws_get_loop_with_native(uv::Loop::get() as *mut c_void) }
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr
    }

    /// Shared borrow of the backing libuv loop.
    ///
    /// `uv_loop` is a back-reference set once by C `us_create_loop` and never
    /// reassigned for the `WindowsLoop`'s lifetime, so projecting `&uv::Loop`
    /// from `&self` is sound. Consolidates the `unsafe { (*self.uv_loop).… }`
    /// pattern (one `unsafe`, N safe callers).
    #[inline]
    pub fn uv(&self) -> &uv::Loop {
        // SAFETY: `uv_loop` is non-null after `us_create_loop` and remains
        // valid for the entire lifetime of `*self`; `&self` bounds the
        // returned borrow so it cannot outlive the wrapper.
        unsafe { &*self.uv_loop }
    }

    /// Exclusive borrow of the backing libuv loop. Used only for the
    /// `active_handles` bookkeeping field (Bun-private; libuv itself only
    /// reads it inside `uv__loop_alive`). `&mut self` provides exclusivity
    /// over the wrapper; the `uv_loop_t` is the per-thread singleton so no
    /// other Rust `&mut` to it is live on this thread.
    #[inline]
    fn uv_mut(&mut self) -> &mut uv::Loop {
        // SAFETY: see `uv()` for liveness; `&mut self` is the sole Rust
        // borrow path to the wrapper, and the only mutation performed via
        // this accessor is the `active_handles` counter.
        unsafe { &mut *self.uv_loop }
    }

    pub fn add_active(&mut self, val: u32) {
        self.uv_mut().add_active(val);
    }

    pub fn sub_active(&mut self, val: u32) {
        self.uv_mut().sub_active(val);
    }

    pub fn is_active(&self) -> bool {
        self.uv().is_active()
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_wakeup_loop(self) };
    }

    /// Nanoseconds this loop has spent parked, for eventLoopUtilization().
    /// `&self`: a parent thread reads this while the worker holds its own
    /// `&mut` — the body is one atomic load, so it must not alias mutably.
    pub fn idle_ns(&self) -> u64 {
        // SAFETY: self is a valid loop pointer; the counter is read atomically.
        unsafe { c::us_loop_idle_ns(core::ptr::from_ref(self).cast_mut()) }
    }

    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    /// Signature matches the POSIX impl so callers need no `cfg`. `now_ns` is unused here: on
    /// Windows the park hook is driven from `us_loop_run` (libuv.c), which reads libuv's
    /// already-refreshed clock via `uv_now` rather than taking one of its own.
    pub fn tick_with_timeout(&mut self, _: Option<&Timespec>, _now_ns: u64) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_run(self) };
    }

    pub fn tick_without_idle(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_pump(self) };
    }

    pub fn drain_quic_if_necessary(&mut self) {
        if self.internal_loop_data.quic_head.is_null() {
            return;
        }
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_quic_loop_flush_if_pending(self) };
    }

    pub fn create<H: LoopHandler>() -> *mut WindowsLoop {
        // SAFETY: us_create_loop allocates and returns a new loop; null hint is valid
        let p = unsafe {
            c::us_create_loop(core::ptr::null_mut(), Some(H::WAKEUP), H::PRE, H::POST, 0)
        };
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    pub fn run(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_run(self) };
    }

    // TODO: remove these two aliases
    #[inline]
    pub fn tick(&mut self) {
        self.run();
    }
    #[inline]
    pub fn wait(&mut self) {
        self.run();
    }

    pub fn inc(&mut self) {
        self.uv_mut().inc();
    }

    pub fn dec(&mut self) {
        self.uv_mut().dec();
    }

    #[inline]
    pub fn ref_(&mut self) {
        self.inc();
    }
    #[inline]
    pub fn unref(&mut self) {
        self.dec();
    }

    pub fn drain_closed_sockets(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_internal_free_closed_sockets(self) };
    }

    pub fn close_all_groups(&mut self) -> bool {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_close_all_groups(self) != 0 }
    }

    // See PosixLoop::next_tick — same trampoline-synthesis limitation.
    pub fn next_tick(
        &mut self,
        user_data: *mut c_void,
        defer_callback: unsafe extern "C" fn(*mut c_void),
    ) {
        // SAFETY: self is a valid loop pointer; user_data lifetime is caller's responsibility
        unsafe { c::uws_loop_defer(self, user_data, defer_callback) };
    }

    pub fn update_date(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::uws_loop_date_header_timer_update(self) };
    }

    /// # Safety
    /// `this` must have been returned by `us_create_loop`/`uws_get_loop_with_native`
    /// and not yet freed.
    pub unsafe fn destroy(this: *mut WindowsLoop) {
        // SAFETY: `this` was returned by us_create_loop/uws_get_loop_with_native and not yet freed
        unsafe { c::us_loop_free(this) };
    }

    // See PosixLoop::add_post_handler — same trampoline-synthesis limitation.
    // Takes `this: *mut Self` (not `&mut self`) so the stored `Handler.loop_` inherits the
    // long-lived raw-pointer provenance from `us_create_loop`/`uws_get_loop_with_native`
    // rather than a transient `&mut` reborrow (which Stacked Borrows would invalidate on the
    // next access to the C-owned singleton).
    /// # Safety
    /// `this` must be the live C-allocated loop pointer returned by
    /// `us_create_loop`/`uws_get_loop_with_native` (not derived from a `&mut` reborrow).
    pub unsafe fn add_post_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        // SAFETY: `this` is the live C-allocated loop pointer per fn contract.
        unsafe { c::uws_loop_addPostHandler(this, ctx, callback) };
        Handler { loop_: this }
    }

    /// # Safety
    /// `this` must be the live C-allocated loop pointer returned by
    /// `us_create_loop`/`uws_get_loop_with_native` (not derived from a `&mut` reborrow).
    pub unsafe fn add_pre_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        // SAFETY: `this` is the live C-allocated loop pointer per fn contract.
        unsafe { c::uws_loop_addPreHandler(this, ctx, callback) };
        Handler { loop_: this }
    }
}

// ───────────────────────────── Loop alias ─────────────────────────────

#[cfg(windows)]
pub type Loop = WindowsLoop;
#[cfg(not(windows))]
pub type Loop = PosixLoop;

// ───────────────────────────── extern "C" ─────────────────────────────

pub(crate) type LoopCb = unsafe extern "C" fn(*mut Loop);
pub(crate) type LoopCtxCb = unsafe extern "C" fn(ctx: *mut c_void, loop_: *mut Loop);
pub(crate) type DeferCb = unsafe extern "C" fn(ctx: *mut c_void);

#[allow(non_snake_case)]
mod c {
    use super::*;

    // `Loop` (= `PosixLoop`/`WindowsLoop`) is a sized `#[repr(C)]` mirror of the
    // C struct (NOT an opaque ZST with `UnsafeCell`), so the safe-fn-with-`&mut`
    // pattern does not apply: `&mut Loop` at the FFI boundary would emit LLVM
    // `noalias` over real fields, and the reentrant callees (`us_loop_run`,
    // `us_loop_close_all_groups`, …) dispatch Rust callbacks that touch the same
    // loop via `Loop::get()`. Keep all loop-taking decls as raw `*mut Loop`.
    unsafe extern "C" {
        pub(super) fn us_create_loop(
            hint: *mut c_void,
            wakeup_cb: Option<LoopCb>,
            pre_cb: Option<LoopCb>,
            post_cb: Option<LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub(super) fn us_loop_free(loop_: *mut Loop);
        pub(super) fn us_quic_loop_flush_if_pending(loop_: *mut Loop);
        pub fn us_loop_run(loop_: *mut Loop);
        #[cfg(windows)]
        pub(super) fn us_loop_pump(loop_: *mut Loop);
        pub fn us_wakeup_loop(loop_: *mut Loop);
        pub fn us_loop_idle_ns(loop_: *mut Loop) -> u64;
        pub(super) fn uws_loop_addPostHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        pub(super) fn uws_loop_addPreHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        #[cfg(not(windows))]
        pub(super) fn us_loop_run_bun_tick(
            loop_: *mut Loop,
            timeout_ms: *const Timespec,
            now_ns: u64,
        );
        pub(super) fn us_internal_free_closed_sockets(loop_: *mut Loop);
        pub(super) fn us_loop_close_all_groups(loop_: *mut Loop) -> c_int;
        #[cfg(not(windows))]
        pub(super) safe fn uws_get_loop() -> *mut Loop;
        #[cfg(windows)]
        pub(super) fn uws_get_loop_with_native(native: *mut c_void) -> *mut WindowsLoop;
        pub(super) fn uws_loop_defer(loop_: *mut Loop, ctx: *mut c_void, cb: DeferCb);
        pub(super) fn uws_res_clear_corked_socket(loop_: *mut Loop);
        pub(super) fn uws_loop_date_header_timer_update(loop_: *mut Loop);
    }
}
// Re-exported raw externs for cross-thread callers (e.g. bun_http's
// `HTTPThread::wakeup`, bun_io's `WindowsWaker`) that hold only a `*mut Loop`
// and MUST NOT form a `&mut Loop` via `Loop::wakeup`/`Loop::run` — see the
// noalias warning on `mod c` above. `us_loop_run` is included because the
// event-loop thread parks inside it while worker threads call
// `us_wakeup_loop` concurrently; routing either through a `&mut self`
// receiver would create two live `&mut Loop` to the same singleton (UB).
pub use c::{us_loop_idle_ns, us_loop_run, us_wakeup_loop};

unsafe extern "C" {
    // safe: no args; clears the C side's thread-local loop pointer — no preconditions.
    safe fn bun_clear_loop_at_thread_exit();
}

/// Clears the C side's thread-local loop pointer. Call when a thread that ran
/// a uws loop (e.g. a Worker thread) exits.
pub fn on_thread_exit() {
    bun_clear_loop_at_thread_exit()
}
