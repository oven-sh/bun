use core::ffi::{c_int, c_longlong, c_uint, c_void};

use crate::InternalLoopData;
use crate::Timespec;

#[cfg(windows)]
use bun_libuv_sys as uv;

bun_core::declare_scope!(Loop, visible);

// ───────────────────────────── PosixLoop ─────────────────────────────

// TODO(port): Zig has field-level `align(16)` on `internal_loop_data` and
// `ready_polls`. Rust cannot align individual fields directly; `#[repr(C, align(16))]`
// covers the struct head, but `ready_polls` may need explicit padding to match
// the C layout in usockets. Verify with a static size/offset assertion in Phase B.
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

    /// The list of ready polls
    pub ready_polls: [EventType; 1024],
}

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
// TODO(port): Zig had `.wasm => @compileError("Unsupported OS")` — no Rust equivalent needed;
// the missing cfg arm will fail to compile on wasm.

/// Trait replacing Zig's `comptime Handler: anytype` with `@hasDecl` checks for
/// optional `pre`/`post`. Implementors override `PRE`/`POST` if they have them.
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
        // TODO(port): wrap in a safe handle type in bun_uws (higher-level crate)
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
        // TODO(port): wrap in a safe handle type in bun_uws (higher-level crate)
    }

    pub fn wakeup(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_wakeup_loop(self) };
    }

    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    pub fn tick(&mut self) {
        // SAFETY: self is a valid loop pointer
        unsafe { c::us_loop_run_bun_tick(self, core::ptr::null()) };
    }

    pub fn tick_without_idle(&mut self) {
        let timespec = Timespec { sec: 0, nsec: 0 };
        // SAFETY: self is a valid loop pointer; &timespec lives for the call
        unsafe { c::us_loop_run_bun_tick(self, &raw const timespec) };
    }

    pub fn tick_with_timeout(&mut self, timespec: Option<&Timespec>) {
        // SAFETY: self is a valid loop pointer
        unsafe {
            c::us_loop_run_bun_tick(
                self,
                timespec.map_or(core::ptr::null(), |t| std::ptr::from_ref(t)),
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

    // TODO(port): Zig `nextTick` took a `comptime deferCallback: fn(UserType) void` and
    // synthesized a per-callsite `extern "C"` trampoline that casts `*anyopaque` → `UserType`.
    // Rust cannot monomorphize an `extern "C"` fn over a fn-pointer const generic on stable.
    // Callers must provide the C-ABI trampoline directly (or via a `next_tick!` macro in Phase B).
    pub fn next_tick(
        &mut self,
        user_data: *mut c_void,
        defer_callback: unsafe extern "C" fn(*mut c_void),
    ) {
        // SAFETY: self is a valid loop pointer; user_data lifetime is caller's responsibility
        unsafe { c::uws_loop_defer(self, user_data, defer_callback) };
    }

    // TODO(port): same trampoline-synthesis limitation as `next_tick` — callers pass the
    // C-ABI callback directly. The returned `Handler` stores it for later removal.
    //
    // Takes `this: *mut Self` (not `&mut self`) so the stored `Handler.loop_` inherits the
    // long-lived raw-pointer provenance from `us_create_loop`/`uws_get_loop`. Routing through
    // a `&mut self` reborrow would bound the stored pointer's provenance to this call, and any
    // subsequent `&mut`/`&` to the C-owned singleton would invalidate it under Stacked Borrows,
    // making the later FFI write in `Handler::remove_*` UB. Mirrors Zig's `this: *PosixLoop`.
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
        Handler {
            loop_: this,
            ctx,
            callback,
        }
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
        Handler {
            loop_: this,
            ctx,
            callback,
        }
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

/// Replaces Zig `fn NewHandler(comptime UserType, comptime callback_fn) type`.
/// Stores the loop ref and the C-ABI callback so it can be unregistered later.
///
/// Stores `*mut Loop` (not `&Loop`) to mirror Zig's freely-aliasing `loop: *Loop`
/// — the loop is C-owned/heap-allocated and the FFI remove calls mutate it, so a
/// shared `&Loop` would make the `*const → *mut` cast UB when written through.
pub struct Handler {
    pub loop_: *mut Loop,
    ctx: *mut c_void,
    callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
}

impl Handler {
    pub fn remove_post(&self) {
        // SAFETY: `loop_` is the original C-allocated raw pointer (from
        // `us_create_loop`/`uws_get_loop`) stored by `add_*_handler`, with provenance
        // that outlives this Handler and permits mutation; callback was previously registered.
        unsafe { c::uws_loop_removePostHandler(self.loop_, self.ctx, self.callback) };
    }

    pub fn remove_pre(&self) {
        // PORT NOTE: Zig also called `uws_loop_removePostHandler` here (likely a bug
        // upstream); preserving behavior verbatim.
        // SAFETY: `loop_` is the original C-allocated raw pointer (from
        // `us_create_loop`/`uws_get_loop`) stored by `add_*_handler`, with provenance
        // that outlives this Handler and permits mutation; callback was previously registered.
        unsafe { c::uws_loop_removePostHandler(self.loop_, self.ctx, self.callback) };
    }
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
        // TODO(port): wrap in a safe handle type in bun_uws (higher-level crate)
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

    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    pub fn tick_with_timeout(&mut self, _: Option<&Timespec>) {
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
        // TODO(port): wrap in a safe handle type in bun_uws (higher-level crate)
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

    // TODO(port): see PosixLoop::next_tick — same trampoline-synthesis limitation.
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

    // TODO(port): see PosixLoop::add_post_handler — same trampoline-synthesis limitation.
    // Takes `this: *mut Self` (not `&mut self`) so the stored `Handler.loop_` inherits the
    // long-lived raw-pointer provenance from `us_create_loop`/`uws_get_loop_with_native`
    // rather than a transient `&mut` reborrow (which Stacked Borrows would invalidate on the
    // next access to the C-owned singleton). Mirrors Zig's `this: *WindowsLoop`.
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
        Handler {
            loop_: this,
            ctx,
            callback,
        }
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
        Handler {
            loop_: this,
            ctx,
            callback,
        }
    }
}

// ───────────────────────────── Loop alias ─────────────────────────────

#[cfg(windows)]
pub type Loop = WindowsLoop;
#[cfg(not(windows))]
pub type Loop = PosixLoop;

// ───────────────────────────── extern "C" ─────────────────────────────

pub type LoopCb = unsafe extern "C" fn(*mut Loop);
pub type LoopCtxCb = unsafe extern "C" fn(ctx: *mut c_void, loop_: *mut Loop);
pub type DeferCb = unsafe extern "C" fn(ctx: *mut c_void);

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
        pub fn us_create_loop(
            hint: *mut c_void,
            wakeup_cb: Option<LoopCb>,
            pre_cb: Option<LoopCb>,
            post_cb: Option<LoopCb>,
            ext_size: c_uint,
        ) -> *mut Loop;
        pub fn us_loop_free(loop_: *mut Loop);
        pub fn us_loop_ext(loop_: *mut Loop) -> *mut c_void;
        pub fn us_quic_loop_flush_if_pending(loop_: *mut Loop);
        pub fn us_loop_run(loop_: *mut Loop);
        pub fn us_loop_pump(loop_: *mut Loop);
        pub fn us_wakeup_loop(loop_: *mut Loop);
        pub fn us_loop_integrate(loop_: *mut Loop);
        pub fn us_loop_iteration_number(loop_: *mut Loop) -> c_longlong;
        pub fn uws_loop_addPostHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        pub fn uws_loop_removePostHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        pub fn uws_loop_addPreHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        pub fn uws_loop_removePreHandler(loop_: *mut Loop, ctx: *mut c_void, cb: LoopCtxCb);
        pub fn us_loop_run_bun_tick(loop_: *mut Loop, timeout_ms: *const Timespec);
        pub fn us_internal_free_closed_sockets(loop_: *mut Loop);
        pub fn us_loop_close_all_groups(loop_: *mut Loop) -> c_int;
        pub safe fn uws_get_loop() -> *mut Loop;
        #[cfg(windows)]
        pub fn uws_get_loop_with_native(native: *mut c_void) -> *mut WindowsLoop;
        pub fn uws_loop_defer(loop_: *mut Loop, ctx: *mut c_void, cb: DeferCb);
        pub fn uws_res_clear_corked_socket(loop_: *mut Loop);
        pub fn uws_loop_date_header_timer_update(loop_: *mut Loop);
    }
}
// Re-exported raw externs for cross-thread callers (e.g. bun_http's
// `HTTPThread::wakeup`, bun_io's `WindowsWaker`) that hold only a `*mut Loop`
// and MUST NOT form a `&mut Loop` via `Loop::wakeup`/`Loop::run` — see the
// noalias warning on `mod c` above. `us_loop_run` is included because the
// event-loop thread parks inside it while worker threads call
// `us_wakeup_loop` concurrently; routing either through a `&mut self`
// receiver would create two live `&mut Loop` to the same singleton (UB).
pub use c::{us_loop_run, us_wakeup_loop};

// ported from: src/uws_sys/Loop.zig
