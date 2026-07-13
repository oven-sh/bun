//! The event loop — native struct (no longer a C mirror). Field set and
//! method surface preserved from the replaced crates; tick semantics per
//! docs/semantics.md §1. Cross-thread/re-entrancy contract: `wakeup`/`defer`/
//! the tick family/`run` take `*mut Loop`, never `&mut` (ticks re-enter Rust
//! callbacks that re-fetch the same loop — a nested tick through a `&mut`
//! receiver would alias the outer frame's exclusive borrow, C17/R1.12).

pub mod poll_registry;
pub mod tick;
pub mod timeouts;
pub mod wakeup;

pub use poll_registry::{PollEvents, PollProtocol, PollRef, PollSource};

use core::ffi::{c_char, c_int, c_void};

use crate::Timespec;
#[cfg(not(windows))]
use crate::backend::EventType;
use crate::connecting::ConnectingSocket;
use crate::group::SocketGroup;
use crate::socket::us_socket_t;
use crate::udp;
use crate::unsafe_core::deref;
use crate::unsafe_core::ffi;
#[cfg(not(windows))]
use crate::unsafe_core::poll_access;
use crate::unsafe_core::slab::ChunkedSlab;

bun_core::declare_scope!(Loop, visible);

/// Layout/semantics placeholder for the cross-thread defer mutex. Locked via
/// `bun_threading` (`Bun__lock`-compatible word): futex u32 on Linux/FreeBSD,
/// os_unfair_lock u32 on macOS, SRWLOCK (pointer) on Windows. Size is
/// ABI-checked against `Bun__lock__size` at loop creation (R1.4).
#[cfg(windows)]
pub(crate) type LoopDataMutex = *mut c_void;
#[cfg(not(windows))]
pub(crate) type LoopDataMutex = u32;

/// Opaque wakeup primitive. POSIX: a Box'd `backend::CallbackPoll`
/// (eventfd / EVFILT_MACHPORT / EVFILT_USER — loop_/wakeup.rs). Windows: an
/// unreffed uv_async blob (`ffi::uv::AsyncBlob`).
#[repr(C)]
pub struct WakeupAsync {
    _opaque: [u8; 0],
}

/// `us_internal_loop_data_t` — now the canonical definition (the C mirror in
/// `src/uws_sys/InternalLoopData.rs` is deleted with the C core; quic.c gets
/// a checked C header or accessors per docs/cabi.md §9.2.5).
#[repr(C)]
pub struct InternalLoopData {
    #[cfg(windows)]
    pub sweep_timer: *mut c_void,
    #[cfg(not(windows))]
    pub sweep_next_tick_ns: i64,
    pub sweep_timer_count: i32,
    pub wakeup_async: *mut WakeupAsync,
    pub head: *mut SocketGroup,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
    #[cfg(windows)]
    pub quic_timer: *mut c_void,
    pub iterator: *mut SocketGroup,
    pub recv_buf: *mut u8,
    pub send_buf: *mut u8,
    /// Lazily-created `tls::state::LoopTlsShared` (C `loop_ssl_data`):
    /// loop-shared ciphertext batch + single spill slot + fatal-reason
    /// scratch + plaintext read scratch. Freed by `free_loop_raw`.
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pub closed_udp_head: *mut udp::Socket,
    pub closed_head: *mut us_socket_t,
    pub low_prio_head: *mut us_socket_t,
    pub low_prio_budget: i32,
    pub dns_ready_head: *mut ConnectingSocket,
    pub closed_connecting_head: *mut ConnectingSocket,
    pub mutex: LoopDataMutex,
    pub parent_ptr: *mut c_void,
    /// 1 = `jsc::EventLoop`, 2 = `MiniEventLoop`.
    pub parent_tag: c_char,
    pub iteration_nr: u64,
    /// Erased `Option<&'static jsc::VM>` — this tier cannot name jsc types.
    pub jsc_vm: *const c_void,
    pub tick_depth: c_int,
}

impl InternalLoopData {
    pub fn should_enable_date_header_timer(&self) -> bool {
        self.sweep_timer_count > 0
    }

    #[inline]
    pub fn set_parent_raw(&mut self, tag: c_char, ptr: *mut c_void) {
        self.parent_tag = tag;
        self.parent_ptr = ptr;
    }

    #[inline]
    pub fn get_parent_raw(&self) -> (c_char, *mut c_void) {
        if self.parent_ptr.is_null() {
            panic!("Parent loop not set - pointer is null");
        }
        if self.parent_tag == 0 {
            panic!("Parent loop not set - tag is zero");
        }
        (self.parent_tag, self.parent_ptr)
    }
}

/// Loop handler trait with optional `pre`/`post` hooks.
pub trait LoopHandler {
    const WAKEUP: unsafe extern "C" fn(*mut Loop);
    const PRE: Option<unsafe extern "C" fn(*mut Loop)> = None;
    const POST: Option<unsafe extern "C" fn(*mut Loop)> = None;
}

/// Forces `ready_polls` to the next 16-byte boundary (LIBUS_EXT_ALIGNMENT).
#[repr(C, align(16))]
struct ReadyPollsAlign {
    _unused: [u8; 0],
}

/// `us_loop_t` (POSIX). The C-visible PREFIX (through `ready_polls`) keeps its layout so
/// quic.c can keep reading through its checked header; the slabs appended
/// after it are crate-private (ext still starts at `loop + 1`, i.e. after
/// them — computed only by `us_loop_ext`).
#[cfg(not(windows))]
#[repr(C, align(16))]
pub struct PosixLoop {
    pub internal_loop_data: InternalLoopData,

    /// Number of non-fallthrough polls in the loop.
    pub num_polls: i32,

    /// Number of ready polls this iteration.
    pub(crate) num_ready_polls: i32,

    /// Current index in the list of ready polls.
    pub(crate) current_ready_poll: i32,

    /// The epoll/kqueue fd.
    pub fd: i32,

    /// Number of polls owned by Bun.
    pub active: u32,

    /// Incremented atomically by wakeup(), swapped to 0 before epoll/kqueue.
    /// Non-zero → the tick returns immediately (GC-safepoint skip). C16.
    pub pending_wakeups: u32,

    _ready_polls_align: ReadyPollsAlign,

    /// Kernel ready-event buffer (crate-internal; the old ready-poll back-channel
    /// exposure is gone, but the C-visible prefix layout is preserved).
    pub(crate) ready_polls: [EventType; 1024],

    /// Per-loop socket slab (docs/design.md §Strategy 1) — slot addresses are stable
    /// and generation-bumped; released only by the tick postlude drain.
    pub(crate) sockets: ChunkedSlab<us_socket_t>,
    /// Per-loop connecting-socket slab (same rules; R6.11 deferred free).
    pub(crate) connectings: ChunkedSlab<ConnectingSocket>,
    /// Per-loop registered-poll slab (non-socket registrations).
    pub(crate) polls: ChunkedSlab<poll_registry::RegisteredPoll>,
}

/// Windows: uv_loop-backed loop. Prefix mirrors the libuv `us_loop_t`; the
/// slab tail is crate-private (see `PosixLoop`). Per-socket uv_poll handles
/// live on `SocketHeader.uv_p`, not the loop.
#[cfg(windows)]
#[repr(C, align(16))]
pub struct WindowsLoop {
    pub internal_loop_data: InternalLoopData,
    pub uv_loop: *mut c_void,
    pub is_default: c_int,
    pub pre: *mut c_void,
    pub check: *mut c_void,
    pub(crate) sockets: ChunkedSlab<us_socket_t>,
    pub(crate) connectings: ChunkedSlab<ConnectingSocket>,
    /// Registered-poll slab. Registration is vestigial on Windows
    /// (uv-driven readiness stays outside the registry for now).
    pub(crate) polls: ChunkedSlab<poll_registry::RegisteredPoll>,
}

#[cfg(windows)]
pub type Loop = WindowsLoop;
#[cfg(not(windows))]
pub type Loop = PosixLoop;

// ── slab access (the loop OWNS all socket storage — docs/design.md §Strategy 1) ──────

/// Allocate a socket slot with `ext_capacity` inline ext bytes (size-class
/// pick; 0 for Rust kinds). The returned address is stable until the
/// loop is freed; the slot itself recycles with a generation bump at the
/// drain. Raw field projection only — waker threads fetch_add
/// `pending_wakeups` concurrently, so no `&mut Loop` may span the call
/// (R10.1, C17).
pub(crate) fn alloc_socket(
    loop_: *mut Loop,
    value: us_socket_t,
    ext_capacity: usize,
) -> *mut us_socket_t {
    ffi::slab_alloc_socket(loop_, value, ext_capacity)
}

/// Return a socket slot to the slab (generation bump). Callers: the closed
/// drain (tick.rs) and failed-registration unwinds.
pub(crate) fn free_socket(loop_: *mut Loop, s: *mut us_socket_t) {
    ffi::slab_free_socket(loop_, s);
}

/// Same as [`free_socket`] — kept under the name group.rs's registration
/// unwinds use (never-linked, never-polled slots).
pub(crate) fn free_unstarted_socket(loop_: *mut Loop, s: *mut us_socket_t) {
    free_socket(loop_, s);
}

pub(crate) fn alloc_connecting(loop_: *mut Loop, value: ConnectingSocket) -> *mut ConnectingSocket {
    ffi::slab_alloc_connecting(loop_, value)
}

/// Tick-postlude release of a `closed_connecting_head` entry (R1.15/R6.11).
pub(crate) fn free_connecting(loop_: *mut Loop, c: *mut ConnectingSocket) {
    ffi::slab_free_connecting(loop_, c);
}

/// Stores the loop ref and the C-ABI callback so it can be unregistered.
pub struct Handler {
    pub loop_: *mut Loop,
    ctx: *mut c_void,
    callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
}

impl Handler {
    pub fn remove_post(&self) {
        let _ = self.callback;
        ffi::loop_remove_post_handler(self.loop_, self.ctx);
    }

    /// Intentionally removes from the POST list (preserved upstream bug:
    /// the shim never exported a pre-removal).
    pub fn remove_pre(&self) {
        ffi::loop_remove_post_handler(self.loop_, self.ctx);
    }
}

/// `us_loop_close_all_groups` (R3.30): walk `loop.data.head`; close every
/// group with live sockets / connecting sockets / low-prio parkees. Listen
/// sockets are deliberately NOT closed (their owner holds a raw pointer —
/// closing here would UAF). Cache `next` before each call; if it got
/// unlinked during the call, restart from the head. Returns whether anything
/// was closed (rare_data retry loop, C16).
fn close_all_groups_impl(loop_: *mut Loop) -> bool {
    let mut closed_any = false;
    let mut g = ffi::ld_group_head(loop_);
    while !g.is_null() {
        let (busy, next) = deref::with_group(g, |gr| {
            (
                !gr.head_sockets.is_null()
                    || !gr.head_connecting_sockets.is_null()
                    || gr.low_prio_count > 0,
                gr.next,
            )
        });
        if busy {
            crate::group::close_all_ex(g, false);
            closed_any = true;
            if !next.is_null() && deref::with_group(next, |n| n.linked) == 0 {
                g = ffi::ld_group_head(loop_);
                continue;
            }
        }
        g = next;
    }
    closed_any
}

#[cfg(not(windows))]
impl PosixLoop {
    // ── acquisition / lifecycle ─────────────────────────────────────────────

    /// Thread-local lazy default loop (C++ `uWS::Loop::get` — installs the
    /// uWS wakeup/pre/post callbacks and the LoopData ext).
    pub fn get() -> *mut Loop {
        ffi::default_loop()
    }

    /// Explicit creation (spawnSync's isolated loop). No loop ext.
    pub fn create<H: LoopHandler>() -> *mut Loop {
        let p = ffi::create_loop_static(Some(H::WAKEUP), H::PRE, H::POST, 0);
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    /// Frees the loop and its buffers.
    ///
    /// # Safety
    /// `this` must have been returned by `get`/`create` and not yet freed.
    // Item-level allow — the public surface keeps this `unsafe fn`.
    #[allow(unsafe_code)]
    pub unsafe fn destroy(this: *mut PosixLoop) {
        // SAFETY: caller contract — a live loop from get/create, freed once.
        unsafe { ffi::free_loop_raw(this) }
    }

    // ── ticking ─────────────────────────────────────────────────────────────

    /// `us_loop_run_bun_tick(null)` — park until an event or wakeup. Parks
    /// only when `num_polls > 0`; returns immediately when
    /// `pending_wakeups != 0` (C16). Takes `*mut`: a poll callback may
    /// re-enter the tick (R1.12) while this frame is live (C17).
    pub fn tick(this: *mut PosixLoop) {
        tick::run_bun_tick(this, None);
    }

    /// Bun tick with a zero timespec (no idle park).
    pub fn tick_without_idle(this: *mut PosixLoop) {
        tick::run_bun_tick(this, Some(&Timespec::EPOCH));
    }

    pub fn tick_with_timeout(this: *mut PosixLoop, timespec: Option<&Timespec>) {
        tick::run_bun_tick(this, timespec);
    }

    /// Classic `us_loop_run`: blocks until no non-fallthrough polls remain.
    pub fn run(this: *mut PosixLoop) {
        tick::run(this);
    }

    // ── wakeup / deferral ───────────────────────────────────────────────────

    /// LOOP-THREAD convenience only. Other threads must call the raw
    /// [`wakeup::us_wakeup_loop`] — a cross-thread `&mut Loop` here would
    /// alias the parked tick's access (cross-thread `*mut Loop` contract).
    pub fn wakeup(&mut self) {
        wakeup::us_wakeup_loop(self)
    }

    /// Same loop-thread-only contract as [`Self::wakeup`].
    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    /// Run `defer_callback(user_data)` once on the loop thread next iteration;
    /// cross-thread-safe (C++ deferMutex — see loop_/wakeup.rs).
    pub fn next_tick(
        &mut self,
        user_data: *mut c_void,
        defer_callback: unsafe extern "C" fn(*mut c_void),
    ) {
        wakeup::defer(self, user_data, defer_callback);
    }

    /// # Safety
    /// `this` must be the live loop pointer from `get`/`create` (not derived
    /// from a `&mut` reborrow) — the stored `Handler.loop_` inherits its
    /// provenance.
    // Item-level allow — the public surface keeps this `unsafe fn`.
    #[allow(unsafe_code)]
    pub unsafe fn add_post_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        ffi::loop_add_post_handler(this, ctx, callback);
        Handler {
            loop_: this,
            ctx,
            callback,
        }
    }

    /// # Safety
    /// Same contract as [`Self::add_post_handler`].
    // Item-level allow — the public surface keeps this `unsafe fn`.
    #[allow(unsafe_code)]
    pub unsafe fn add_pre_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        ffi::loop_add_pre_handler(this, ctx, callback);
        Handler {
            loop_: this,
            ctx,
            callback,
        }
    }

    // ── poll / keep-alive accounting ────────────────────────────────────────

    /// Raw-place twins of `inc`/`dec`/`ref_`/`unref` for `*mut Loop` callers:
    /// a `&mut Loop` span would cover `pending_wakeups`, which foreign
    /// threads `fetch_add` concurrently (R10.6, C17).
    pub fn inc_raw(this: *mut Self) {
        bun_core::scoped_log!(Loop, "inc_raw -> {}", poll_access::num_polls(this) + 1);
        poll_access::num_polls_add(this, 1);
    }

    pub fn dec_raw(this: *mut Self) {
        bun_core::scoped_log!(Loop, "dec_raw -> {}", poll_access::num_polls(this) - 1);
        poll_access::num_polls_add(this, -1);
    }

    pub fn ref_raw(this: *mut Self) {
        bun_core::scoped_log!(Loop, "ref_raw -> {}", poll_access::num_polls(this) + 1);
        poll_access::loop_ref_raw(this);
    }

    pub fn unref_raw(this: *mut Self) {
        bun_core::scoped_log!(Loop, "unref_raw -> {}", poll_access::num_polls(this) - 1);
        poll_access::loop_unref_raw(this);
    }

    /// Raise `num_polls` to at least `min` — same raw-place rule as
    /// [`Self::inc_raw`] (HTTP daemon keep-alive floor).
    pub fn raise_num_polls_to(this: *mut Self, min: i32) {
        poll_access::num_polls_raise(this, min);
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

    /// Bulk `ref_`: applies `count` queued concurrent refs at once.
    pub fn ref_count(&mut self, count: i32) {
        bun_core::scoped_log!(Loop, "ref x {}", count);
        self.num_polls += count;
        self.active = self
            .active
            .saturating_add(u32::try_from(count).expect("int cast"));
    }

    pub fn unref_count(&mut self, count: i32) {
        bun_core::scoped_log!(Loop, "unref x {}", count);
        self.num_polls -= count;
        self.active = self
            .active
            .saturating_sub(u32::try_from(count).expect("int cast"));
    }

    // ── introspection ───────────────────────────────────────────────────────

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }

    // ── uWS / quic bridges ──────────────────────────────────────────────────

    /// `uws_res_clear_corked_socket` — force-drain both cork slots. Takes
    /// `*mut`: the flush dispatches consumer write callbacks that may
    /// re-derive loop borrows (C17), same as the tick family.
    pub fn uncork(this: *mut PosixLoop) {
        ffi::clear_corked_socket(this);
    }

    /// `uws_loop_date_header_timer_update`.
    pub fn update_date(&mut self) {
        ffi::date_header_timer_update(self);
    }

    /// Packetize HTTP/3 stream writes since the last process_conns.
    /// Early-returns when `quic_head` is null. Takes `*mut`: the flush can
    /// dispatch consumer stream callbacks that re-derive loop borrows (C17).
    pub fn drain_quic_if_necessary(this: *mut PosixLoop) {
        if ffi::ld_quic_head(this).is_null() {
            return;
        }
        ffi::quic_flush_if_pending(this);
    }

    // ── teardown ────────────────────────────────────────────────────────────

    /// Free everything queued on `closed_head`/`closed_connecting_head`.
    /// Normally the tick postlude does this; at process/Worker teardown the
    /// loop has stopped, so shutdown drains explicitly (C6, C16).
    pub fn drain_closed_sockets(&mut self) {
        tick::drain_closed_sockets(self);
    }

    /// `close_all` on every group linked to this loop — the FULL linked list,
    /// reporting whether any group was closed (rare_data retry loop, C16).
    /// Takes `*mut`: on_close dispatches into consumer JS which may re-derive
    /// loop borrows (Bun.connect in a close handler — C17, group.rs re-entry).
    pub fn close_all_groups(this: *mut PosixLoop) -> bool {
        close_all_groups_impl(this)
    }
}

#[cfg(windows)]
impl WindowsLoop {
    // Same consumer surface as `PosixLoop`, routed through libuv (poll
    // accounting proxies into `uv_loop.active_handles`).

    pub fn get() -> *mut Loop {
        ffi::default_loop_with_native(bun_libuv_sys::Loop::get().cast::<c_void>())
    }

    pub fn create<H: LoopHandler>() -> *mut Loop {
        let p = ffi::create_loop_static(Some(H::WAKEUP), H::PRE, H::POST, 0);
        assert!(!p.is_null(), "us_create_loop returned null");
        p
    }

    /// # Safety
    /// `this` must have been returned by `get`/`create` and not yet freed.
    #[allow(unsafe_code)]
    pub unsafe fn destroy(this: *mut WindowsLoop) {
        // SAFETY: caller contract — a live loop from get/create, freed once.
        unsafe { ffi::free_loop_raw(this) }
    }

    /// `us_loop_run` semantics (libuv.c:214-219): uv_run ONCE — parks until
    /// an event or the uv sweep/QUIC timer fires. Takes `*mut`: uv callbacks
    /// may re-enter the tick (C17/R1.12).
    pub fn tick(this: *mut WindowsLoop) {
        tick::run(this);
    }

    /// One `uv_run(UV_RUN_NOWAIT)` pump (`us_loop_pump`) — never parks.
    pub fn tick_without_idle(this: *mut WindowsLoop) {
        tick::pump(this);
    }

    /// The uv timers supply the deadline; uv_run ONCE parks until one fires.
    pub fn tick_with_timeout(this: *mut WindowsLoop, _timespec: Option<&Timespec>) {
        tick::run(this);
    }

    pub fn run(this: *mut WindowsLoop) {
        tick::run(this);
    }

    /// LOOP-THREAD convenience only — see `PosixLoop::wakeup`; cross-thread
    /// wakers use the raw [`wakeup::us_wakeup_loop`].
    pub fn wakeup(&mut self) {
        wakeup::us_wakeup_loop(self)
    }

    /// Same loop-thread-only contract as [`Self::wakeup`].
    #[inline]
    pub fn wake(&mut self) {
        self.wakeup();
    }

    pub fn next_tick(
        &mut self,
        user_data: *mut c_void,
        defer_callback: unsafe extern "C" fn(*mut c_void),
    ) {
        wakeup::defer(self, user_data, defer_callback);
    }

    /// # Safety
    /// `this` must be the live loop pointer from `get`/`create`.
    #[allow(unsafe_code)]
    pub unsafe fn add_post_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        ffi::loop_add_post_handler(this, ctx, callback);
        Handler {
            loop_: this,
            ctx,
            callback,
        }
    }

    /// # Safety
    /// Same contract as [`Self::add_post_handler`].
    #[allow(unsafe_code)]
    pub unsafe fn add_pre_handler(
        this: *mut Self,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut Loop),
    ) -> Handler {
        ffi::loop_add_pre_handler(this, ctx, callback);
        Handler {
            loop_: this,
            ctx,
            callback,
        }
    }

    // Poll/keep-alive accounting proxies (uv active handles keep the loop
    // alive on Windows).

    /// Raw-pointer twins of `inc`/`dec`/`ref_`/`unref` — parity with the
    /// POSIX raw twins so cross-platform callers never form `&mut Loop`.
    pub fn inc_raw(this: *mut Self) {
        crate::backend::libuv::inc_active(this);
    }

    pub fn dec_raw(this: *mut Self) {
        crate::backend::libuv::dec_active(this);
    }

    pub fn ref_raw(this: *mut Self) {
        crate::backend::libuv::inc_active(this);
    }

    pub fn unref_raw(this: *mut Self) {
        crate::backend::libuv::dec_active(this);
    }

    pub fn inc(&mut self) {
        crate::backend::libuv::inc_active(self);
    }

    pub fn dec(&mut self) {
        crate::backend::libuv::dec_active(self);
    }

    pub fn ref_(&mut self) {
        crate::backend::libuv::inc_active(self);
    }

    pub fn unref(&mut self) {
        crate::backend::libuv::dec_active(self);
    }

    pub fn is_active(&self) -> bool {
        let this: *const WindowsLoop = self;
        crate::backend::libuv::is_active(this.cast_mut())
    }

    pub fn add_active(&mut self, value: u32) {
        crate::backend::libuv::add_active(self, value);
    }

    pub fn sub_active(&mut self, value: u32) {
        crate::backend::libuv::sub_active(self, value);
    }

    pub fn unref_count(&mut self, count: i32) {
        crate::backend::libuv::unref_count(self, count);
    }

    pub fn iteration_number(&self) -> u64 {
        self.internal_loop_data.iteration_nr
    }

    pub fn should_enable_date_header_timer(&self) -> bool {
        self.internal_loop_data.should_enable_date_header_timer()
    }

    /// See `PosixLoop::uncork` — `*mut` because the flush can re-enter (C17).
    pub fn uncork(this: *mut WindowsLoop) {
        ffi::clear_corked_socket(this);
    }

    pub fn update_date(&mut self) {
        ffi::date_header_timer_update(self);
    }

    /// See `PosixLoop::drain_quic_if_necessary` — `*mut`, re-entrant (C17).
    pub fn drain_quic_if_necessary(this: *mut WindowsLoop) {
        if ffi::ld_quic_head(this).is_null() {
            return;
        }
        ffi::quic_flush_if_pending(this);
    }

    pub fn drain_closed_sockets(&mut self) {
        tick::drain_closed_sockets(self);
    }

    /// See `PosixLoop::close_all_groups` — `*mut`, on_close re-enters (C17).
    pub fn close_all_groups(this: *mut WindowsLoop) -> bool {
        close_all_groups_impl(this)
    }

    /// `uv_loop.active_handles` — debug-diagnostic keep-alive counter
    /// (FilePoll activate/deactivate scoped logging).
    pub fn active_count(&self) -> u32 {
        let this: *const WindowsLoop = self;
        crate::backend::libuv::active_count(this.cast_mut())
    }
}

/// C++ `bun_clear_loop_at_thread_exit` → `uWS::Loop::clearLoopAtThreadExit`:
/// FREES this thread's lazily-created uWS loop and its 512 KiB recv buffer,
/// then clears the TLS pointer. Workers must call this on exit or leak both.
pub fn on_thread_exit() {
    ffi::clear_loop_at_thread_exit();
}
