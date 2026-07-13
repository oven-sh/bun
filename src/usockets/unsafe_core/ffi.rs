//! FFI boundary helpers: bssl-sys / libuv / lsquic edges, plus the reverse
//! hooks the deleted C used to import (docs/cabi.md §2 — Bun__lock/unlock
//! on the loop mutex, Bun__addrinfo_* DNS bridge, quic pre/post hooks).
//! Everything crossing OUT of the crate lives here or in cabi.rs.

use core::ffi::c_void;

use crate::loop_::Loop;

#[allow(improper_ctypes)]
unsafe extern "C" {
    /// `bun_threading::Mutex` exports (src/threading/Mutex.rs:399-412); the
    /// pointee is the `LoopDataMutex` word embedded in `InternalLoopData`.
    fn Bun__lock(ptr: *mut c_void);
    fn Bun__unlock(ptr: *mut c_void);
    static Bun__lock__size: usize;
}

/// Lock the loop's defer mutex (`Bun__lock`-compatible word). Callable from
/// ANY thread (R10.6 — dns_ready is the only mutex-guarded loop state).
pub(crate) fn lock_loop_mutex(loop_: *mut Loop) {
    // SAFETY: raw field projection to the mutex word (zero-init == unlocked;
    // the loop is calloc'd); `Bun__lock` is the canonical accessor (R1.4).
    unsafe { Bun__lock((&raw mut (*loop_).internal_loop_data.mutex).cast()) }
}

pub(crate) fn unlock_loop_mutex(loop_: *mut Loop) {
    // SAFETY: this thread holds the lock taken via `lock_loop_mutex`.
    unsafe { Bun__unlock((&raw mut (*loop_).internal_loop_data.mutex).cast()) }
}

/// R1.4 ABI check: the embedded mutex word must be exactly what `Bun__lock`
/// expects (mirrors the C ASSERT_ENABLED panic, loop.c:138-142).
pub(crate) fn assert_mutex_abi() {
    if cfg!(debug_assertions) {
        // SAFETY: plain read of an extern static usize.
        let expected = unsafe { Bun__lock__size };
        assert!(
            core::mem::size_of::<crate::loop_::LoopDataMutex>() == expected,
            "The size of the mutex must match the size of the lock"
        );
    }
}

#[allow(improper_ctypes)]
unsafe extern "C" {
    /// quic.c (survives; this crate is its platform layer — docs/cabi.md §6).
    fn us_quic_loop_process(loop_: *mut Loop);
}

/// quic.c hook: `us_quic_loop_process(loop)` when `quic_head != null`, from
/// both loop pre and post (docs/cabi.md §2.2/§6).
pub(crate) fn quic_loop_process(loop_: *mut Loop) {
    // SAFETY: loop-thread call; quic.c walks only its own quic_head state.
    unsafe { us_quic_loop_process(loop_) }
}

/// Sweep refcount 0→1 hook (docs/semantics.md R12.9/R5.5): keeps Bun.serve's
/// Date-header timer running while sockets exist.
pub(crate) fn ensure_date_header_timer_is_enabled(loop_: *mut Loop) {
    #[allow(improper_ctypes)]
    unsafe extern "C" {
        fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut Loop);
    }
    // SAFETY: symbol defined in bun_runtime (timer/DateHeaderTimer.rs); the
    // loop is live for the duration of the call.
    unsafe { Bun__internal_ensureDateHeaderTimerIsEnabled(loop_) }
}

/// libuv sweep-timer arm on refcount 0→1 (R5.5 libuv arm): repeating 4000 ms
/// `us_timer_set(sweep_timer, timer_sweep cb)`. Re-arms after the first enable
/// early-return per the preserved OQ-16 quirk (timer never actually stops).
#[cfg(windows)]
pub(crate) fn arm_libuv_sweep_timer(loop_: *mut Loop) {
    let sweep_timer = ld_sweep_timer(loop_).cast::<crate::backend::libuv::Timer>();
    crate::backend::libuv::Timer::set(
        sweep_timer,
        Some(crate::backend::libuv::sweep_timer_cb),
        4000,
        4000,
    );
}

// ── cabi delegation seams ────────────────────────────────────────────────────
// Only caller: cabi.rs. Contracts mirror the deleted C (docs/cabi.md §1).

use core::ffi::{c_char, c_int};

use crate::handle::ListenSocket;
use crate::socket::us_socket_t;
use crate::tls::context::SslCtx;

// ── loop allocation block ───────────────────────────────────────────────
// Layout: [16-byte prefix holding the total block size][Loop][ext bytes].
// The prefix keeps `us_loop_ext(loop) == loop + 1` (cabi contract) while
// letting `free_loop_block` rebuild the dealloc Layout without a size arg.

const LOOP_BLOCK_PREFIX: usize = crate::LIBUS_EXT_ALIGNMENT;

fn loop_block_layout(total: usize) -> core::alloc::Layout {
    core::alloc::Layout::from_size_align(total, crate::LIBUS_EXT_ALIGNMENT).expect("loop layout")
}

/// Zeroed `Loop` + trailing ext allocation. All-zero is valid for every field
/// except the slabs, which the caller `ptr::write`s before use.
fn alloc_loop_block(ext_size: usize) -> *mut Loop {
    let total = LOOP_BLOCK_PREFIX + core::mem::size_of::<Loop>() + ext_size;
    // SAFETY: non-zero layout; prefix write stays inside the allocation.
    unsafe {
        let base = std::alloc::alloc_zeroed(loop_block_layout(total));
        if base.is_null() {
            bun_core::out_of_memory();
        }
        base.cast::<usize>().write(total);
        base.add(LOOP_BLOCK_PREFIX).cast::<Loop>()
    }
}

fn free_loop_block(loop_: *mut Loop) {
    // SAFETY: `loop_` came from `alloc_loop_block`; the prefix holds the
    // exact size the block was allocated with.
    unsafe {
        let base = loop_.cast::<u8>().sub(LOOP_BLOCK_PREFIX);
        let total = base.cast::<usize>().read();
        std::alloc::dealloc(base, loop_block_layout(total));
    }
}

/// malloc-parity byte buffer for `recv_buf`/`send_buf` (16-aligned for the
/// SIMD unmask over-read contract).
fn alloc_loop_buf(len: usize) -> *mut u8 {
    // SAFETY: non-zero fixed-size layout.
    unsafe {
        let p = std::alloc::alloc(
            core::alloc::Layout::from_size_align(len, crate::LIBUS_EXT_ALIGNMENT).expect("buf"),
        );
        if p.is_null() {
            // R1.4: a NULL recv_buf would make every read fail with EFAULT
            // for the life of the process (loop.c:131-133).
            bun_core::out_of_memory();
        }
        p
    }
}

fn free_loop_buf(p: *mut u8, len: usize) {
    if p.is_null() {
        return;
    }
    // SAFETY: allocated by `alloc_loop_buf` with the same layout.
    unsafe {
        std::alloc::dealloc(
            p,
            core::alloc::Layout::from_size_align(len, crate::LIBUS_EXT_ALIGNMENT).expect("buf"),
        );
    }
}

const RECV_BUF_BYTES: usize =
    crate::LIBUS_RECV_BUFFER_LENGTH + 2 * crate::LIBUS_RECV_BUFFER_PADDING;

/// `us_create_loop` (epoll_kqueue.c:157): zero-alloc `size_of::<Loop>() +
/// ext_size` at LIBUS_EXT_ALIGNMENT, create the backend poller (`Loop.fd`),
/// init loop data (recv/send bufs, wakeup poll carrying `wakeup_cb`, mutex,
/// pre/post cbs). `hint` = existing native loop (libuv) or null.
///
/// # Safety
/// Callbacks must be valid for the loop's lifetime.
pub(crate) unsafe fn create_loop_raw(
    hint: *mut c_void,
    wakeup_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    ext_size: usize,
) -> *mut Loop {
    let loop_ = alloc_loop_block(ext_size);
    // SAFETY: fresh zeroed block — the slab Vecs must be written (all-zero
    // Vec is invalid); every other field's zero state is its init value.
    unsafe {
        core::ptr::write(
            &raw mut (*loop_).sockets,
            crate::unsafe_core::slab::ChunkedSlab::new(),
        );
        core::ptr::write(
            &raw mut (*loop_).connectings,
            crate::unsafe_core::slab::ChunkedSlab::new(),
        );
        core::ptr::write(
            &raw mut (*loop_).polls,
            crate::unsafe_core::slab::ChunkedSlab::new(),
        );
    }

    #[cfg(not(windows))]
    {
        let _ = hint;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = {
            let fd = crate::unsafe_core::poll_access::epoll_create_cloexec();
            crate::unsafe_core::poll_access::probe_epoll_pwait2();
            fd
        };
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let fd = crate::unsafe_core::poll_access::kqueue_create();
        // SAFETY: exclusive access — the loop is not yet published.
        unsafe {
            (*loop_).fd = fd;
            (*loop_).internal_loop_data.sweep_next_tick_ns = -1;
        }
    }

    #[cfg(windows)]
    {
        if crate::backend::libuv::loop_init(loop_, hint) != 0 {
            free_loop_block(loop_);
            return core::ptr::null_mut();
        }
        // SAFETY: exclusive access — the loop is not yet published.
        unsafe {
            // R1.4 libuv arm: sweep timer created up front (fallthrough).
            (*loop_).internal_loop_data.sweep_timer = timer_create(loop_, true, 0).cast::<c_void>();
        }
    }

    // SAFETY: exclusive access; buffers are owned by the loop until
    // free_loop_raw.
    unsafe {
        let ld = &raw mut (*loop_).internal_loop_data;
        (*ld).recv_buf = alloc_loop_buf(RECV_BUF_BYTES);
        (*ld).send_buf = alloc_loop_buf(crate::udp::LIBUS_SEND_BUFFER_LENGTH);
        (*ld).pre_cb = pre_cb;
        (*ld).post_cb = post_cb;
    }
    assert_mutex_abi();

    // Wakeup async last — its registration targets the live poller fd.
    #[cfg(not(windows))]
    let wakeup_async = crate::loop_::wakeup::create_async(loop_, wakeup_cb);
    #[cfg(windows)]
    let wakeup_async = crate::backend::libuv::create_wakeup_async(
        loop_,
        wakeup_cb.expect("us_create_loop requires a wakeup_cb"),
    );
    // SAFETY: exclusive access — still unpublished.
    unsafe {
        (*loop_).internal_loop_data.wakeup_async = wakeup_async;
    }
    loop_
}

/// Safe creation front-door for `'static` fn-item callbacks (`LoopHandler`
/// consts) — the only lifetime obligation `create_loop_raw` carries.
pub(crate) fn create_loop_static(
    wakeup_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    pre_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    post_cb: Option<unsafe extern "C" fn(*mut Loop)>,
    ext_size: usize,
) -> *mut Loop {
    // SAFETY: fn items are 'static; no other precondition exists.
    unsafe { create_loop_raw(core::ptr::null_mut(), wakeup_cb, pre_cb, post_cb, ext_size) }
}

/// `us_loop_free` (loop.c:155): close `quic_timer` if armed (libuv), free
/// loop-data buffers + wakeup poll, free the loop+ext block from
/// [`create_loop_raw`]. C++ ran `LoopData::~LoopData()` on the ext already.
///
/// # Safety
/// `loop_` must come from [`create_loop_raw`] and not be freed twice.
pub(crate) unsafe fn free_loop_raw(loop_: *mut Loop) {
    // libuv head (libuv.c:191-199): stop + close the prepare/check hooks
    // before loop-data teardown.
    #[cfg(windows)]
    crate::backend::libuv::loop_close_hooks(loop_);

    // us_internal_loop_data_free (loop.c:145-158).
    // SAFETY: loop-thread teardown; nothing else references the loop.
    unsafe {
        let ld = &raw mut (*loop_).internal_loop_data;
        let ssl_data = core::ptr::replace(&raw mut (*ld).ssl_data, core::ptr::null_mut());
        if !ssl_data.is_null() {
            // LoopTlsShared::drop frees the parked plaintext scratch.
            drop(Box::from_raw(
                ssl_data.cast::<crate::tls::state::LoopTlsShared>(),
            ));
        }
        free_loop_buf((*ld).recv_buf, RECV_BUF_BYTES);
        free_loop_buf((*ld).send_buf, crate::udp::LIBUS_SEND_BUFFER_LENGTH);
        #[cfg(windows)]
        {
            let sweep = (*ld).sweep_timer.cast::<crate::backend::libuv::Timer>();
            if !sweep.is_null() {
                timer_close(sweep, false);
            }
            let quic = (*ld).quic_timer.cast::<crate::backend::libuv::Timer>();
            if !quic.is_null() {
                timer_close(quic, false);
            }
            crate::backend::libuv::wakeup_async_close((*ld).wakeup_async);
        }
        #[cfg(not(windows))]
        crate::loop_::wakeup::close_async(loop_, (*ld).wakeup_async);
        (*ld).wakeup_async = core::ptr::null_mut();
    }

    #[cfg(not(windows))]
    // SAFETY: the poller fd is owned by the loop and closed exactly once.
    unsafe {
        libc::close((*loop_).fd);
    }
    // Owned uv loops get one NOWAIT drain (fires the pending close
    // callbacks queued above) then deletion; hint loops survive.
    #[cfg(windows)]
    crate::backend::libuv::loop_teardown(loop_);

    // Poll-registry two-phase teardown: take every registered poll's owner word
    // and free its slot while the slab is intact; release the refs only
    // after the slab borrow ends — an owner destructor may re-enter PollRef
    // methods (all stale no-ops now) or even `register` anew (the arm fails
    // on the closed fd and self-unwinds), so loop until the slab quiesces.
    loop {
        let mut live: Vec<core::ptr::NonNull<crate::loop_::poll_registry::RegisteredPoll>> =
            Vec::new();
        // SAFETY: loop-thread teardown; the borrow covers only the `polls`
        // field place and ends before any owner ref is released.
        unsafe { (*loop_).polls.for_each_occupied(|p| live.push(p)) };
        if live.is_empty() {
            break;
        }
        let mut owners = Vec::with_capacity(live.len());
        for p in live {
            owners.push(crate::loop_::poll_registry::take_owner_for_teardown(p));
            // SAFETY: `p` is an occupied slot of THIS loop's poll slab; its
            // owner word was just taken, so the value drop releases nothing.
            unsafe { (*loop_).polls.free(p) };
        }
        for (ops, word) in owners {
            super::trampolines::teardown_poll_owner(ops, word);
        }
    }

    // Drop the slabs in place (releases every remaining slot value + chunk).
    // SAFETY: fields were ptr::written at creation; dropped exactly once.
    // The polls slab is quiesced (loop above), so no owner code can run
    // under `ChunkedSlab::drop`'s exclusive borrow.
    unsafe {
        core::ptr::drop_in_place(&raw mut (*loop_).sockets);
        core::ptr::drop_in_place(&raw mut (*loop_).connectings);
        core::ptr::drop_in_place(&raw mut (*loop_).polls);
    }
    free_loop_block(loop_);
}

// ── slab access (only callers: loop_/mod.rs alloc_*/free_*) ─────────────────

/// Allocate a socket slot straight off the raw slab place — never forms
/// `&mut Loop`, so the span excludes `pending_wakeups`, which other threads
/// `fetch_add` concurrently (R10.1, C17). `ext_capacity` picks the size
/// class carrying that many inline ext bytes after the header (docs/design.md §Ext storage).
pub(crate) fn slab_alloc_socket(
    loop_: *mut Loop,
    value: us_socket_t,
    ext_capacity: usize,
) -> *mut us_socket_t {
    // SAFETY: loop-thread call on a live loop; the autoref borrow covers only
    // the `sockets` field place.
    unsafe {
        (*loop_)
            .sockets
            .alloc_with_ext(value, ext_capacity)
            .0
            .as_ptr()
    }
}

/// Connecting-slab twin of [`slab_alloc_socket`] (same aliasing rationale).
pub(crate) fn slab_alloc_connecting(
    loop_: *mut Loop,
    value: crate::connecting::ConnectingSocket,
) -> *mut crate::connecting::ConnectingSocket {
    // SAFETY: see `slab_alloc_socket`.
    unsafe { (*loop_).connectings.alloc(value).0.as_ptr() }
}

/// Return a socket slot to the loop's slab, bumping its generation (the ONLY
/// socket death path — docs/design.md §Strategy 4, C6).
pub(crate) fn slab_free_socket(loop_: *mut Loop, s: *mut us_socket_t) {
    let nn = core::ptr::NonNull::new(s).expect("null socket slot");
    // SAFETY: `s` was allocated from THIS loop's socket slab and is freed
    // exactly once (drain postlude / failed-registration unwind).
    unsafe { (*loop_).sockets.free(nn) }
}

/// Return a connecting slot to the loop's slab (tick postlude, R1.15).
pub(crate) fn slab_free_connecting(loop_: *mut Loop, c: *mut crate::connecting::ConnectingSocket) {
    let nn = core::ptr::NonNull::new(c).expect("null connecting slot");
    // SAFETY: `c` was allocated from THIS loop's connecting slab and is
    // freed exactly once (closed_connecting drain).
    unsafe { (*loop_).connectings.free(nn) }
}

/// Registered-poll twin of [`slab_alloc_socket`] (poll registry; same aliasing
/// rationale — never forms `&mut Loop`).
pub(crate) fn slab_alloc_poll(
    loop_: *mut Loop,
    value: crate::loop_::poll_registry::RegisteredPoll,
) -> *mut crate::loop_::poll_registry::RegisteredPoll {
    // SAFETY: see `slab_alloc_socket`.
    unsafe { (*loop_).polls.alloc(value).0.as_ptr() }
}

/// Return a registered-poll slot (generation bump; kernel disarm precedes
/// this — disarm-before-free). Callers must take the owner word out FIRST — the ref
/// release runs outside the slab borrow (RegisteredPoll has no Drop).
pub(crate) fn slab_free_poll(
    loop_: *mut Loop,
    p: *mut crate::loop_::poll_registry::RegisteredPoll,
) {
    let nn = core::ptr::NonNull::new(p).expect("null registered-poll slot");
    // SAFETY: `p` was allocated from THIS loop's poll slab and is freed
    // exactly once (unregister / failed-registration unwind).
    unsafe { (*loop_).polls.free(nn) }
}

// ── loop-thread callback invocation + cross-thread wakeup reads ─────────

/// Invoke a loop-shaped callback (`pre_cb`/`post_cb`/wakeup). May re-enter
/// the loop (C17) — callers must hold no loop borrows.
pub(crate) fn invoke_loop_cb(cb: unsafe extern "C" fn(*mut Loop), loop_: *mut Loop) {
    // SAFETY: `cb` was installed at loop creation with loop-lifetime validity.
    unsafe { cb(loop_) }
}

/// Raw read of `loop.data.wakeup_async` — set once at creation, so the read
/// is safe from ANY thread (no reference formed).
pub(crate) fn read_wakeup_async(loop_: *mut Loop) -> *mut crate::loop_::WakeupAsync {
    // SAFETY: immutable-after-create field; plain read through a raw place.
    unsafe { *core::ptr::addr_of!((*loop_).internal_loop_data.wakeup_async) }
}

/// GC safepoint before an idle park (R1.10 step 7; C16).
pub(crate) fn jsc_on_before_wait(jsc_vm: *const c_void) {
    unsafe extern "C" {
        fn Bun__JSC_onBeforeWait(vm: *const c_void);
    }
    // SAFETY: `jsc_vm` is the non-null VM slot the runtime stored on the loop.
    unsafe { Bun__JSC_onBeforeWait(jsc_vm) }
}

// ── InternalLoopData raw-place field access (tick path — R10.6, C17) ─────────
// `dns_ready_head` is written by resolver threads under Bun__lock and
// `wakeup_async` is raw-read by async_send, so the tick path must never form
// `&mut InternalLoopData` — field-granular raw places only (conn_* twin).
// SAFETY (all helpers below): live loop, loop-thread only, single raw field
// read/modify/write, no reference formed.

macro_rules! ld_get {
    ($($get:ident, $field:ident, $ty:ty);* $(;)?) => {$(
        pub(crate) fn $get(loop_: *mut Loop) -> $ty {
            // SAFETY: see section comment above.
            unsafe { *core::ptr::addr_of!((*loop_).internal_loop_data.$field) }
        }
    )*};
}
macro_rules! ld_set {
    ($($set:ident, $field:ident, $ty:ty);* $(;)?) => {$(
        pub(crate) fn $set(loop_: *mut Loop, v: $ty) {
            // SAFETY: see section comment above.
            unsafe {
                *core::ptr::addr_of_mut!((*loop_).internal_loop_data.$field) = v;
            }
        }
    )*};
}

ld_get! {
    ld_tick_depth, tick_depth, core::ffi::c_int;
    ld_quic_head, quic_head, *mut c_void;
    ld_quic_next_tick_us, quic_next_tick_us, i64;
    ld_jsc_vm, jsc_vm, *const c_void;
    ld_pre_cb, pre_cb, Option<unsafe extern "C" fn(*mut Loop)>;
    ld_post_cb, post_cb, Option<unsafe extern "C" fn(*mut Loop)>;
    ld_low_prio_head, low_prio_head, *mut us_socket_t;
    ld_low_prio_budget, low_prio_budget, i32;
    ld_group_head, head, *mut crate::group::SocketGroup;
    ld_closed_head, closed_head, *mut us_socket_t;
    ld_closed_udp_head, closed_udp_head, *mut crate::udp::Socket;
    ld_iterator, iterator, *mut crate::group::SocketGroup;
    ld_sweep_timer_count, sweep_timer_count, i32;
    ld_send_buf, send_buf, *mut u8;
    ld_recv_buf, recv_buf, *mut u8;
}
ld_set! {
    ld_set_low_prio_head, low_prio_head, *mut us_socket_t;
    ld_set_low_prio_budget, low_prio_budget, i32;
    ld_set_group_head, head, *mut crate::group::SocketGroup;
    ld_set_closed_head, closed_head, *mut us_socket_t;
    ld_set_closed_udp_head, closed_udp_head, *mut crate::udp::Socket;
    ld_set_iterator, iterator, *mut crate::group::SocketGroup;
    ld_set_sweep_timer_count, sweep_timer_count, i32;
}

#[cfg(not(windows))]
pub(crate) fn ld_sweep_next_tick_ns(loop_: *mut Loop) -> i64 {
    // SAFETY: see section comment above.
    unsafe { *core::ptr::addr_of!((*loop_).internal_loop_data.sweep_next_tick_ns) }
}

#[cfg(not(windows))]
pub(crate) fn ld_set_sweep_next_tick_ns(loop_: *mut Loop, v: i64) {
    // SAFETY: see section comment above.
    unsafe { *core::ptr::addr_of_mut!((*loop_).internal_loop_data.sweep_next_tick_ns) = v }
}

#[cfg(windows)]
pub(crate) fn ld_sweep_timer(loop_: *mut Loop) -> *mut c_void {
    // SAFETY: see section comment above.
    unsafe { *core::ptr::addr_of!((*loop_).internal_loop_data.sweep_timer) }
}

pub(crate) fn ld_tick_depth_add(loop_: *mut Loop, delta: core::ffi::c_int) {
    // SAFETY: see section comment above.
    unsafe { *core::ptr::addr_of_mut!((*loop_).internal_loop_data.tick_depth) += delta }
}

pub(crate) fn ld_iteration_nr_bump(loop_: *mut Loop) {
    // SAFETY: see section comment above.
    unsafe { *core::ptr::addr_of_mut!((*loop_).internal_loop_data.iteration_nr) += 1 }
}

/// Detach the whole closed-socket list (tick postlude drain, R1.15).
pub(crate) fn ld_take_closed_head(loop_: *mut Loop) -> *mut us_socket_t {
    // SAFETY: see section comment above.
    unsafe {
        core::ptr::replace(
            core::ptr::addr_of_mut!((*loop_).internal_loop_data.closed_head),
            core::ptr::null_mut(),
        )
    }
}

/// Detach the closed-UDP list (tick postlude drain, C6/C15).
pub(crate) fn ld_take_closed_udp_head(loop_: *mut Loop) -> *mut crate::udp::Socket {
    // SAFETY: see section comment above.
    unsafe {
        core::ptr::replace(
            core::ptr::addr_of_mut!((*loop_).internal_loop_data.closed_udp_head),
            core::ptr::null_mut(),
        )
    }
}

/// Detach the closed-connecting list (tick postlude drain, R6.11).
pub(crate) fn ld_take_closed_connecting_head(
    loop_: *mut Loop,
) -> *mut crate::connecting::ConnectingSocket {
    // SAFETY: see section comment above.
    unsafe {
        core::ptr::replace(
            core::ptr::addr_of_mut!((*loop_).internal_loop_data.closed_connecting_head),
            core::ptr::null_mut(),
        )
    }
}

// ── surviving uWS C++ / quic.c shim entry points ────────────────────────
// These symbols live in libuwsockets.cpp / bun-uws Loop.h / quic.c, all of
// which SURVIVE the rewrite (docs/cabi.md §7). The C++ defer queues and
// pre/post handler maps stay C++-owned in the loop ext (LoopData).

#[allow(improper_ctypes)]
unsafe extern "C" {
    #[cfg(not(windows))]
    fn uws_get_loop() -> *mut Loop;
    #[cfg(windows)]
    fn uws_get_loop_with_native(native: *mut c_void) -> *mut Loop;
    fn uws_loop_defer(loop_: *mut Loop, ctx: *mut c_void, cb: unsafe extern "C" fn(*mut c_void));
    fn uws_loop_addPostHandler(
        loop_: *mut Loop,
        ctx: *mut c_void,
        cb: unsafe extern "C" fn(*mut c_void, *mut Loop),
    );
    fn uws_loop_addPreHandler(
        loop_: *mut Loop,
        ctx: *mut c_void,
        cb: unsafe extern "C" fn(*mut c_void, *mut Loop),
    );
    fn uws_loop_removePostHandler(loop_: *mut Loop, key: *mut c_void);
    fn uws_res_clear_corked_socket(loop_: *mut Loop);
    fn uws_loop_date_header_timer_update(loop_: *mut Loop);
    fn us_quic_loop_flush_if_pending(loop_: *mut Loop);
    fn bun_clear_loop_at_thread_exit();
}

/// This thread's lazily-created default loop (C++ `uWS::Loop::get`, which
/// placement-news `LoopData` in the ext and routes creation back through
/// `us_create_loop`).
#[cfg(not(windows))]
pub(crate) fn default_loop() -> *mut Loop {
    // SAFETY: no arguments; thread-local lookup/create in the C++ shim.
    unsafe { uws_get_loop() }
}

/// Windows default loop bound to an existing native (libuv) loop.
#[cfg(windows)]
pub(crate) fn default_loop_with_native(native: *mut c_void) -> *mut Loop {
    // SAFETY: `native` is this thread's live uv loop (or null).
    unsafe { uws_get_loop_with_native(native) }
}

/// `uws_loop_defer`: run `cb(ctx)` once on the loop thread next iteration.
/// Cross-thread-safe — the C++ deferMutex/deferQueues own the queueing and
/// `us_wakeup_loop` provides the kick (R10.5: the Rust core adds NO queue).
pub(crate) fn loop_defer(
    loop_: *mut Loop,
    ctx: *mut c_void,
    cb: unsafe extern "C" fn(*mut c_void),
) {
    // SAFETY: `cb`/`ctx` outlive the deferred call per the caller's contract.
    unsafe { uws_loop_defer(loop_, ctx, cb) }
}

pub(crate) fn loop_add_post_handler(
    loop_: *mut Loop,
    ctx: *mut c_void,
    cb: unsafe extern "C" fn(*mut c_void, *mut Loop),
) {
    // SAFETY: loop-thread registration; C++ stores (ctx, cb) keyed by ctx.
    unsafe { uws_loop_addPostHandler(loop_, ctx, cb) }
}

pub(crate) fn loop_add_pre_handler(
    loop_: *mut Loop,
    ctx: *mut c_void,
    cb: unsafe extern "C" fn(*mut c_void, *mut Loop),
) {
    // SAFETY: see `loop_add_post_handler`.
    unsafe { uws_loop_addPreHandler(loop_, ctx, cb) }
}

/// Keyed removal. NOTE: `Handler::remove_pre` also routes here — the shim
/// only exports removePostHandler (preserved upstream bug).
pub(crate) fn loop_remove_post_handler(loop_: *mut Loop, key: *mut c_void) {
    // SAFETY: loop-thread removal by key.
    unsafe { uws_loop_removePostHandler(loop_, key) }
}

/// `uws_res_clear_corked_socket` — force-drain both C++ cork slots.
pub(crate) fn clear_corked_socket(loop_: *mut Loop) {
    // SAFETY: loop-thread call into the C++ LoopData in the loop ext.
    unsafe { uws_res_clear_corked_socket(loop_) }
}

/// `uws_loop_date_header_timer_update`.
pub(crate) fn date_header_timer_update(loop_: *mut Loop) {
    // SAFETY: loop-thread call into the C++ LoopData in the loop ext.
    unsafe { uws_loop_date_header_timer_update(loop_) }
}

/// HTTP/3 stream-write packetization since the last process_conns; the
/// caller early-outs on `quic_head == null`.
pub(crate) fn quic_flush_if_pending(loop_: *mut Loop) {
    // SAFETY: loop-thread call; quic.c walks only its own state.
    unsafe { us_quic_loop_flush_if_pending(loop_) }
}

/// Clears the C++ side's thread-local default-loop pointer (Worker exit).
pub(crate) fn clear_loop_at_thread_exit() {
    // SAFETY: no arguments; thread-local clear.
    unsafe { bun_clear_loop_at_thread_exit() }
}

/// `us_poll_change` on a poll-first handle: only UDP handles qualify
/// (cabi::us_poll_fd contract; QUIC send backpressure is the surviving
/// caller — docs/cabi.md §1.2). Preserves the low-bits udata tag and is
/// callable from inside poll dispatch (no borrows formed).
///
/// # Safety
/// `p` must be a live `udp::Socket` registered with `loop_`.
pub(crate) unsafe fn poll_change_raw(p: *mut c_void, loop_: *mut Loop, events: u32) {
    super::io::udp_poll_change(loop_, p.cast::<crate::udp::Socket>(), events)
}

/// `us_socket_close` with the reason-pointer passthrough to on_close (C3);
/// `code` passed verbatim. Idempotent on already-closed; returns the input
/// pointer (in-place design, docs/design.md §Strategy 3).
///
/// # Safety
/// `s` must be a live (possibly mid-dispatch) socket header.
pub(crate) unsafe fn socket_close_raw(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // us_socket_close (R3.16): enum-coded closes route through the TLS-aware
    // path. Errno-coded closes (>2, incl. uWS forceClose's reason-length
    // codes) still send close_notify on TLS sockets, like the C did.
    if (0..=2).contains(&code) {
        crate::socket::socket_close(s, crate::handle::CloseCode::from_c(code), reason);
    } else {
        crate::socket::tls_close_errno(s, code, reason);
    }
    s
}

/// `us_socket_server_name_userdata` (openssl.c:2528): SNI userdata stashed on
/// the socket's negotiated SSL_CTX; null for plain sockets or when none.
///
/// # Safety
/// `s` must be a live socket header.
pub(crate) unsafe fn socket_server_name_userdata(s: *mut us_socket_t) -> *mut c_void {
    crate::socket::server_name_userdata(s)
}

/// `us_listen_socket_find_server_name_ctx`: exact-pattern SNI lookup
/// returning an OWNED SSL_CTX ref — the caller unrefs (docs/cabi.md §1.6).
///
/// # Safety
/// `ls` live and linked; `pattern` NUL-terminated.
pub(crate) unsafe fn listen_socket_find_server_name_ctx(
    ls: *mut ListenSocket,
    pattern: *const c_char,
) -> *mut SslCtx {
    if pattern.is_null() {
        return core::ptr::null_mut();
    }
    // ListenerData is freed at close (group.rs close_listen_socket) — a
    // closed listener has no SNI tree, like C's `if (!ls->sni)` on a freed ls.
    let h = crate::unsafe_core::ext::header_mut(ls.cast());
    if h.is_closed() || h.ext.is_null() {
        return core::ptr::null_mut();
    }
    match crate::group::listener_data(ls).sni.as_ref() {
        // SAFETY: `pattern` NUL-terminated per this fn's contract.
        Some(sni) => sni.find_ctx(unsafe { core::ffi::CStr::from_ptr(pattern) }),
        None => core::ptr::null_mut(),
    }
}

/// `us_create_timer` (libuv only). `fallthrough` = does not keep loop alive.
///
/// # Safety
/// `loop_` must be live.
#[cfg(windows)]
pub(crate) unsafe fn timer_create(
    loop_: *mut Loop,
    fallthrough: bool,
    ext_size: usize,
) -> *mut crate::backend::libuv::Timer {
    uv::timer_create(loop_, fallthrough, ext_size)
}

/// `us_timer_set`: `ms == 0` disarms (regardless of `repeat_ms`, libuv.c:310);
/// `repeat_ms == 0` = one-shot, else repeating.
///
/// # Safety
/// `t` from [`timer_create`]; `cb` valid until close.
#[cfg(windows)]
pub(crate) unsafe fn timer_set(
    t: *mut crate::backend::libuv::Timer,
    cb: Option<unsafe extern "C" fn(*mut crate::backend::libuv::Timer)>,
    ms: c_int,
    repeat_ms: c_int,
) {
    uv::timer_set(t, cb, ms, repeat_ms)
}

/// `us_timer_loop`.
///
/// # Safety
/// `t` must be live.
#[cfg(windows)]
pub(crate) unsafe fn timer_loop(t: *mut crate::backend::libuv::Timer) -> *mut Loop {
    uv::timer_loop(t)
}

/// `us_timer_close`.
///
/// # Safety
/// `t` must be live; not used after this call.
#[cfg(windows)]
pub(crate) unsafe fn timer_close(t: *mut crate::backend::libuv::Timer, fallthrough: bool) {
    // C ignores `fallthrough` and always refs before closing (libuv.c:277-283).
    let _ = fallthrough;
    uv::timer_close(t)
}

/// `us_socket_ref` (libuv arm, socket.c:691): `uv_ref` on the socket's uv
/// poll handle.
///
/// # Safety
/// `s` must be a live socket header.
#[cfg(windows)]
pub(crate) unsafe fn socket_uv_ref(s: *mut us_socket_t) {
    uv::socket_poll_ref(s);
}

/// `us_socket_unref` (libuv arm, socket.c:736): `uv_unref`.
///
/// # Safety
/// `s` must be a live socket header.
#[cfg(windows)]
pub(crate) unsafe fn socket_uv_unref(s: *mut us_socket_t) {
    uv::socket_poll_unref(s);
}

// ── DNS bridge: Bun__addrinfo_* five-fn seam (C13, R6.5) ────────────────────
// Consumed via link-time extern; the Rust dns side (bun_runtime::dns_jsc)
// keeps exporting these `#[no_mangle]`. Signatures mirror the Rust
// definitions at dns.rs (internal.h:140-144 on the C side).

use core::ptr::addr_of_mut;

use crate::connecting::{AddrinfoRequest, AddrinfoResult, ConnectingSocket};

#[allow(improper_ctypes)]
unsafe extern "C" {
    fn Bun__addrinfo_get(
        loop_: *mut Loop,
        host: *const c_char,
        port: u16,
        out: *mut *mut AddrinfoRequest,
    ) -> c_int;
    fn Bun__addrinfo_set(request: *mut AddrinfoRequest, socket: *mut c_void);
    fn Bun__addrinfo_cancel(request: *mut AddrinfoRequest, socket: *mut c_void) -> c_int;
    fn Bun__addrinfo_freeRequest(request: *mut AddrinfoRequest, invalidate: c_int);
    fn Bun__addrinfo_getRequestResult(request: *mut AddrinfoRequest) -> *mut AddrinfoResult;
}

/// Resolve-or-cache lookup; takes one refcount on the returned request either
/// way. Returns `(request, already_resolved)` — `already_resolved` means the
/// result may be read immediately (it can still be a cached ERROR).
pub(crate) fn addrinfo_get(
    loop_: *mut Loop,
    host: *const c_char,
    port: u16,
) -> (*mut AddrinfoRequest, bool) {
    let mut req: *mut AddrinfoRequest = core::ptr::null_mut();
    // SAFETY: loop-thread call; `host` is NUL-terminated per the connect
    // surface; the resolver always writes `req`.
    let rc = unsafe { Bun__addrinfo_get(loop_, host, port, &mut req) };
    (req, rc == 0)
}

/// Register `c` for completion. On an already-resolved request this defers to
/// the loop's dns_ready queue (non-wakeup enqueue) — it never re-enters (R6.5).
pub(crate) fn addrinfo_set(request: *mut AddrinfoRequest, c: *mut ConnectingSocket) {
    // SAFETY: `request` holds a refcount taken by addrinfo_get; `c` is live
    // and owns the pending_resolve_callback state.
    unsafe { Bun__addrinfo_set(request, c.cast()) }
}

/// Try to remove `c` from the request's notify list. `false` means the
/// callback already fired or is committed — expect it and use the `closed`
/// tombstone (linearized under the resolver's cache lock, C13).
pub(crate) fn addrinfo_cancel(request: *mut AddrinfoRequest, c: *mut ConnectingSocket) -> bool {
    // SAFETY: loop-thread call on a request we still hold a refcount on.
    unsafe { Bun__addrinfo_cancel(request, c.cast()) != 0 }
}

/// Drop our refcount; `invalidate` poisons the cache entry (stale addresses /
/// negative results — R6.10 step 5).
pub(crate) fn addrinfo_free_request(request: *mut AddrinfoRequest, invalidate: bool) {
    // SAFETY: balances exactly one addrinfo_get refcount; `request` is not
    // used by this crate after the call.
    unsafe { Bun__addrinfo_freeRequest(request, c_int::from(invalidate)) }
}

/// `(entries_head, error)` — only legal post-notify, when the result is set;
/// the entry chain borrows the request's buffer until [`addrinfo_free_request`].
pub(crate) fn addrinfo_result(request: *mut AddrinfoRequest) -> (*mut bun_dns::addrinfo, c_int) {
    // SAFETY: caller invariant (R6.5): invoked only after the completion
    // callback, when `result` is set; the view is `{ info, err }` repr(C).
    unsafe {
        let r = Bun__addrinfo_getRequestResult(request);
        ((*r).info, (*r).err)
    }
}

/// Next entry of a resolved chain (raw field read; the chain is immutable
/// once published).
pub(crate) fn addrinfo_next(info: *mut bun_dns::addrinfo) -> *mut bun_dns::addrinfo {
    // SAFETY: `info` is a live entry inside the request's result buffer.
    unsafe { *core::ptr::addr_of!((*info).ai_next) }
}

/// Read `c.loop` without forming a reference — the resolver thread's ONLY
/// legal access besides the mutex-guarded ready-list link (R6.1: the field is
/// immutable after create).
pub(crate) fn connecting_loop(c: *mut ConnectingSocket) -> *mut Loop {
    // SAFETY: raw read of an immutable-after-create field; no `&` formed, so
    // no aliasing with the loop thread.
    unsafe { *core::ptr::addr_of!((*c).loop_) }
}

// ── ConnectingSocket raw-place field access (pending window, C13/R6.5) ──────
// While `pending_resolve_callback` is set the resolver thread may write
// `c.next` (dns_ready_push) and raw-read `c.loop_` concurrently, so the loop
// thread must never form `&`/`&mut ConnectingSocket` over the whole struct —
// field-granular raw places are the C-parity access discipline.
// SAFETY (all helpers below): caller passes a live slab-resident connecting
// socket; each touched field is accessed only from the loop thread; single
// raw field read/write, no reference formed.

macro_rules! conn_get {
    ($($get:ident, $field:ident, $ty:ty);* $(;)?) => {$(
        pub(crate) fn $get(c: *mut ConnectingSocket) -> $ty {
            // SAFETY: see section comment above.
            unsafe { *core::ptr::addr_of!((*c).$field) }
        }
    )*};
}
macro_rules! conn_set {
    ($($set:ident, $field:ident, $ty:ty);* $(;)?) => {$(
        pub(crate) fn $set(c: *mut ConnectingSocket, v: $ty) {
            // SAFETY: see section comment above.
            unsafe {
                *addr_of_mut!((*c).$field) = v;
            }
        }
    )*};
}

conn_get! {
    conn_closed, closed, bool;
    conn_shut_down, shut_down, bool;
    conn_error, error, i32;
    conn_dns_error, dns_error, i32;
    conn_pending, pending_resolve_callback, bool;
    conn_group, group, *mut crate::group::SocketGroup;
    conn_addrinfo_req, addrinfo_req, *mut AddrinfoRequest;
    conn_ssl_ctx, ssl_ctx, *mut crate::tls::context::SslCtx;
    conn_next_pending, next_pending, *mut ConnectingSocket;
    conn_prev_pending, prev_pending, *mut ConnectingSocket;
    conn_next, next, *mut ConnectingSocket;
}
conn_set! {
    conn_set_closed, closed, bool;
    conn_set_shut_down, shut_down, bool;
    conn_set_shut_down_read, shut_down_read, bool;
    conn_set_error, error, i32;
    conn_set_pending, pending_resolve_callback, bool;
    conn_set_group, group, *mut crate::group::SocketGroup;
    conn_set_addrinfo_req, addrinfo_req, *mut AddrinfoRequest;
    conn_set_ssl_ctx, ssl_ctx, *mut crate::tls::context::SslCtx;
    conn_set_timeout, timeout, u8;
    conn_set_long_timeout, long_timeout, u8;
    conn_set_ext, ext, *mut core::ffi::c_void;
    conn_set_next_pending, next_pending, *mut ConnectingSocket;
    conn_set_prev_pending, prev_pending, *mut ConnectingSocket;
}

/// Take the whole attempt array (close teardown, R6.10 step 2).
pub(crate) fn conn_take_attempts(
    c: *mut ConnectingSocket,
) -> [*mut crate::socket::us_socket_t; crate::connecting::CONCURRENT_CONNECTIONS] {
    // SAFETY: see section comment above.
    unsafe {
        core::ptr::replace(
            addr_of_mut!((*c).attempts),
            [core::ptr::null_mut(); crate::connecting::CONCURRENT_CONNECTIONS],
        )
    }
}

/// Place pointer of the 8-byte ext word (typed access is the caller's).
pub(crate) fn conn_ext_place(c: *mut ConnectingSocket) -> *mut *mut core::ffi::c_void {
    // SAFETY: in-bounds field projection; no reference formed.
    unsafe { addr_of_mut!((*c).ext) }
}

// ── dns_ready / closed_connecting queues (R6.5, R6.11) ──────────────────────

/// MPSC push onto `loop.data.dns_ready_head`. Callable from any thread; the
/// head AND `c.next` are guarded by the loop mutex (loop.c:324-331). Does not
/// wake the loop.
pub(crate) fn dns_ready_push(loop_: *mut Loop, c: *mut ConnectingSocket) {
    lock_loop_mutex(loop_);
    // SAFETY: mutex held — exclusive access to the list head and to `c.next`
    // (while pending, `c` is owned by exactly one of {notify list, this
    // queue}; the pusher is that owner). Raw ptr ops only: no `&mut Loop` is
    // formed off-thread.
    unsafe {
        let head = addr_of_mut!((*loop_).internal_loop_data.dns_ready_head);
        *addr_of_mut!((*c).next) = *head;
        *head = c;
    }
    unlock_loop_mutex(loop_);
}

/// Swap the whole dns_ready list out under the mutex (loop-pre/post drain).
pub(crate) fn dns_ready_take(loop_: *mut Loop) -> *mut ConnectingSocket {
    lock_loop_mutex(loop_);
    // SAFETY: mutex held; see dns_ready_push.
    let head = unsafe {
        let head = addr_of_mut!((*loop_).internal_loop_data.dns_ready_head);
        core::ptr::replace(head, core::ptr::null_mut())
    };
    unlock_loop_mutex(loop_);
    head
}

/// Loop-thread push onto `closed_connecting_head` (deferred free — the tick
/// postlude releases the slab slot, C6/R6.11). Reuses `c.next`: a connecting
/// socket is never on this list and the dns_ready list at once.
pub(crate) fn closed_connecting_push(loop_: *mut Loop, c: *mut ConnectingSocket) {
    debug_assert!(!loop_.is_null() && !c.is_null());
    // SAFETY: loop thread only; `c` was just detached, so this list is the
    // sole remaining owner.
    unsafe {
        let head = addr_of_mut!((*loop_).internal_loop_data.closed_connecting_head);
        *addr_of_mut!((*c).next) = *head;
        *head = c;
    }
}

// ── libuv edge (Windows backend, docs/semantics.md §2 libuv arm) ─────────────

/// Ownership contract: every heap block created here is freed ONLY by the
/// uv_close callback registered at close time (deferred-free protocol, R2.4).
#[cfg(windows)]
pub(crate) mod uv {
    use core::ffi::{c_int, c_void};
    use core::mem;

    use bun_libuv_sys as sys;
    use sys::UvHandle;

    use crate::backend::libuv::Timer;
    use crate::backend::{Events, PollState};
    use crate::loop_::{Loop, WakeupAsync};
    use crate::socket::us_socket_t;

    #[inline]
    fn uv_loop_of(loop_: *mut Loop) -> *mut sys::Loop {
        // SAFETY: `loop_` is a live WindowsLoop; `uv_loop` is set once at
        // creation and never reassigned for the loop's lifetime.
        unsafe { (*loop_).uv_loop.cast::<sys::Loop>() }
    }

    // ── uv_loop lifecycle ────────────────────────────────────────────────────

    /// `us_create_loop` libuv head (libuv.c:162-175): `hint ? hint :
    /// uv_loop_new()` (`is_default` = externally-owned, never deleted here),
    /// then the unreffed prepare/check hooks. Fills the WindowsLoop
    /// `uv_loop`/`is_default`/`pre`/`check` fields. −1 on create failure.
    pub(crate) fn loop_init(loop_: *mut Loop, hint: *mut c_void) -> i32 {
        let uv_loop: *mut c_void = if !hint.is_null() {
            hint
        } else {
            // SAFETY: plain constructor call.
            unsafe { sys::uv_loop_new().cast() }
        };
        if uv_loop.is_null() {
            return -1;
        }
        // SAFETY: `loop_` is the freshly allocated WindowsLoop; fields are
        // set exactly once here, before any uv callback can observe them.
        unsafe {
            (*loop_).uv_loop = uv_loop;
            (*loop_).is_default = c_int::from(!hint.is_null());
            let (pre, check) = hooks_create(loop_);
            (*loop_).pre = pre;
            (*loop_).check = check;
        }
        0
    }

    /// `us_loop_free` head (libuv.c:191-199): close down prepare and check.
    /// The caller frees loop data between this and [`loop_teardown`].
    pub(crate) fn loop_close_hooks(loop_: *mut Loop) {
        // SAFETY: live loop from `loop_init`; fields nulled so a double call
        // is a no-op.
        unsafe {
            if (*loop_).pre.is_null() {
                return;
            }
            hooks_close((*loop_).pre, (*loop_).check);
            (*loop_).pre = core::ptr::null_mut();
            (*loop_).check = core::ptr::null_mut();
        }
    }

    /// `us_loop_free` tail (libuv.c:203-208): owned loops get one NOWAIT run
    /// to flush close callbacks, then deletion; default (hint) loops don't.
    pub(crate) fn loop_teardown(loop_: *mut Loop) {
        // SAFETY: live loop; every handle this crate put on an owned uv loop
        // has already been uv_close'd by the caller (C teardown order).
        unsafe {
            if (*loop_).is_default == 0 {
                let uv_loop = uv_loop_of(loop_);
                let _ = sys::uv_run(uv_loop, sys::RunMode::NoWait);
                sys::uv_loop_delete(uv_loop);
            }
            (*loop_).uv_loop = core::ptr::null_mut();
        }
    }

    /// `us_loop_run` (libuv.c:214-219): update time, run ONCE
    /// (`us_loop_integrate` is a no-op, R1.6).
    pub(crate) fn loop_run_once(loop_: *mut Loop) {
        let uv_loop = uv_loop_of(loop_);
        // SAFETY: live loop on its own thread; dispatch re-enters Rust only
        // through raw-pointer entries (no `&mut Loop` held across this call).
        unsafe {
            sys::uv_update_time(uv_loop);
            let _ = sys::uv_run(uv_loop, sys::RunMode::Once);
        }
    }

    /// `us_loop_pump` (libuv.c:150-152): run NOWAIT.
    pub(crate) fn loop_pump(loop_: *mut Loop) {
        // SAFETY: see `loop_run_once`.
        unsafe {
            let _ = sys::uv_run(uv_loop_of(loop_), sys::RunMode::NoWait);
        }
    }

    // ── active-handle proxying ───────────────
    // `uv_loop.active_handles` is the Bun-private keep-alive counter libuv
    // reads in `uv__loop_alive`; saturating like the old uws_sys wrapper.

    pub(crate) fn add_active(loop_: *mut Loop, value: u32) {
        // SAFETY: live loop; counter-only mutation. The uv loop is this
        // thread's singleton — no other `&mut` to it is live here.
        unsafe { (*uv_loop_of(loop_)).add_active(value) }
    }

    pub(crate) fn sub_active(loop_: *mut Loop, value: u32) {
        // SAFETY: see `add_active`.
        unsafe { (*uv_loop_of(loop_)).sub_active(value) }
    }

    pub(crate) fn unref_count_active(loop_: *mut Loop, count: i32) {
        // SAFETY: see `add_active`.
        unsafe { (*uv_loop_of(loop_)).unref_count(count) }
    }

    pub(crate) fn loop_alive(loop_: *mut Loop) -> bool {
        // SAFETY: live loop.
        unsafe { sys::uv_loop_alive(uv_loop_of(loop_)) != 0 }
    }

    pub(crate) fn active_count(loop_: *mut Loop) -> u32 {
        // SAFETY: see `add_active` — counter-only read on a live loop.
        unsafe { (*uv_loop_of(loop_)).active_handles }
    }

    // ── prepare/check hooks (libuv.c:154-186) ────────────────────────────────

    unsafe extern "C" fn prepare_cb(p: *mut sys::uv_prepare_t) {
        // SAFETY: `data` was pointed at the owning Loop in `hooks_create`.
        crate::loop_::tick::loop_pre(unsafe { (*p).data.cast::<Loop>() });
    }

    /// libuv timers execute AFTER this post callback (libuv.c:36).
    unsafe extern "C" fn check_cb(p: *mut sys::uv_check_t) {
        // SAFETY: `data` was pointed at the owning Loop in `hooks_create`.
        crate::loop_::tick::loop_post(unsafe { (*p).data.cast::<Loop>() });
    }

    unsafe extern "C" fn close_free_prepare(h: *mut sys::uv_prepare_t) {
        // SAFETY: `data` was re-pointed at the handle box by `hooks_close` —
        // sole owner, freed exactly once (close_cb_free port).
        drop(unsafe { Box::from_raw((*h).data.cast::<sys::uv_prepare_t>()) });
    }

    unsafe extern "C" fn close_free_check(h: *mut sys::uv_check_t) {
        // SAFETY: see `close_free_prepare`.
        drop(unsafe { Box::from_raw((*h).data.cast::<sys::uv_check_t>()) });
    }

    /// Create + start the pre (uv_prepare) / post (uv_check) hooks, both
    /// unreffed, `data = loop_`. Returns (pre, check) for the WindowsLoop
    /// mirror fields. Per-handle call order ports libuv.c:165-175 verbatim.
    fn hooks_create(loop_: *mut Loop) -> (*mut c_void, *mut c_void) {
        // SAFETY: fresh zeroed POD boxes; init/start on this thread's loop;
        // ownership parks in the handles until `hooks_close`.
        unsafe {
            let pre: *mut sys::uv_prepare_t = Box::into_raw(Box::new(mem::zeroed()));
            let _ = sys::uv_prepare_init(uv_loop_of(loop_), pre);
            let _ = sys::uv_prepare_start(pre, Some(prepare_cb));
            (*pre).unref();
            (*pre).data = loop_.cast();

            let check: *mut sys::uv_check_t = Box::into_raw(Box::new(mem::zeroed()));
            let _ = sys::uv_check_init(uv_loop_of(loop_), check);
            (*check).unref();
            let _ = sys::uv_check_start(check, Some(check_cb));
            (*check).data = loop_.cast();

            (pre.cast(), check.cast())
        }
    }

    /// Ref, stop, re-point data at the handle itself, uv_close with the
    /// freeing callback (libuv.c:191-199).
    fn hooks_close(pre: *mut c_void, check: *mut c_void) {
        // SAFETY: `pre`/`check` came from `hooks_create`, not yet closed; the
        // close callbacks are the sole free of each box.
        unsafe {
            let pre = pre.cast::<sys::uv_prepare_t>();
            (*pre).ref_();
            let _ = sys::uv_prepare_stop(pre);
            (*pre).data = pre.cast();
            (*pre).close(close_free_prepare);

            let check = check.cast::<sys::uv_check_t>();
            (*check).ref_();
            let _ = sys::uv_check_stop(check);
            (*check).data = check.cast();
            (*check).close(close_free_check);
        }
    }

    // ── uv_poll wrapping ─────────────────────────────────────────────────────
    // The C `us_poll_t.uv_p` field is `SocketHeader.uv_p`: one heap uv_poll
    // wrapper per armed socket, owned by the header from first arm until
    // `socket_poll_stop_close` nulls the field; the pending uv_close callback
    // frees the box (deferred free, R2.4 — collapsed to single-owner form:
    // the C two-free dance existed only because poll memory and uv handle
    // memory had separate owners, and slab slots outlive the uv handle here).

    /// `uv.data` carries the slab SocketHeader pointer (the C `uv_p->data =
    /// p` wiring, libuv.c:226).
    #[repr(C)]
    pub(crate) struct UvPollHandle {
        /// MUST stay first: `*mut UvPollHandle` doubles as the uv handle ptr.
        uv: sys::uv_poll_t,
    }

    unsafe extern "C" fn poll_cb(p: *mut sys::uv_poll_t, status: c_int, events: c_int) {
        // SAFETY: `data` points into the slab (never returned to the OS while
        // the loop lives), and libuv fires no poll_cb after uv_poll_stop —
        // the dispatcher's slot-generation check drops stale slots (OQ-4).
        let poll = unsafe { (*p).data.cast::<PollState>() };
        // libuv.c:26-29: status<0 && !=UV_EOF → error; ==UV_EOF → eof.
        let error = status < 0 && status != sys::UV_EOF;
        let eof = status == sys::UV_EOF;
        crate::backend::dispatch_ready_poll(poll, error, eof, Events(events as u32));
    }

    unsafe extern "C" fn poll_close_cb(h: *mut sys::uv_poll_t) {
        // SAFETY: sole owner post-close; box leaked in `socket_poll_first_arm`.
        drop(unsafe { Box::from_raw(h.cast::<UvPollHandle>()) });
    }

    pub(crate) fn socket_poll_is_armed(s: *mut us_socket_t) -> bool {
        // SAFETY: live header; raw field read.
        unsafe { !(*s).uv_p.is_null() }
    }

    /// `us_poll_start` kernel half (libuv.c:99-104): alloc the wrapper,
    /// `uv_poll_init_socket` + always-unref (keep-alive is Bun's
    /// `Async.KeepAlive`, not usockets), `data = s`, start. `false` on init
    /// error — the socket stays unarmed (C ignores the rc and proceeds).
    pub(crate) fn socket_poll_first_arm(
        loop_: *mut Loop,
        s: *mut us_socket_t,
        events: Events,
    ) -> bool {
        // SAFETY: fresh zeroed POD box; init on this thread's loop; on init
        // failure the box is reclaimed here (uv registered nothing). On
        // success the box is owned by `s.uv_p` until `socket_poll_stop_close`.
        unsafe {
            debug_assert!(
                (*s).uv_p.is_null(),
                "double first-arm would leak the old uv_poll"
            );
            let h: *mut UvPollHandle = Box::into_raw(Box::new(mem::zeroed()));
            if sys::uv_poll_init_socket(uv_loop_of(loop_), &raw mut (*h).uv, (*s).fd) != 0 {
                drop(Box::from_raw(h));
                return false;
            }
            (*h).uv.unref();
            (*h).uv.data = s.cast();
            (*s).uv_p = h.cast();
            let _ = sys::uv_poll_start(&raw mut (*h).uv, events.0 as c_int, Some(poll_cb));
            true
        }
    }

    /// `us_poll_change` kernel half (libuv.c:119): restart with the new event
    /// set; rc discarded (R2.13). Caller checked `socket_poll_is_armed`.
    pub(crate) fn socket_poll_rearm(s: *mut us_socket_t, events: Events) {
        // SAFETY: `uv_p` is live — non-null means not yet stopped.
        unsafe {
            let h = (*s).uv_p.cast::<UvPollHandle>();
            let _ = sys::uv_poll_start(&raw mut (*h).uv, events.0 as c_int, Some(poll_cb));
        }
    }

    /// `us_poll_stop` (libuv.c:123-133): stop, null the owner field, then
    /// uv_close; only `poll_close_cb` touches the wrapper afterwards.
    /// No-op when never armed / already stopped.
    pub(crate) fn socket_poll_stop_close(s: *mut us_socket_t) {
        // SAFETY: live header; the taken wrapper (if any) is live and
        // ownership moves to the pending close callback.
        unsafe {
            let h = (*s).uv_p.cast::<UvPollHandle>();
            if h.is_null() {
                return;
            }
            (*s).uv_p = core::ptr::null_mut();
            let _ = sys::uv_poll_stop(&raw mut (*h).uv);
            (*h).uv.close(poll_close_cb);
        }
    }

    /// `us_socket_ref` = uv_ref on the socket's uv_poll (R3.26, libuv only).
    pub(crate) fn socket_poll_ref(s: *mut us_socket_t) {
        // SAFETY: live header; non-null `uv_p` is live until poll stop.
        unsafe {
            let h = (*s).uv_p.cast::<UvPollHandle>();
            if !h.is_null() {
                (*h).uv.ref_();
            }
        }
    }

    /// `us_socket_unref` = uv_unref (R3.26, libuv only).
    pub(crate) fn socket_poll_unref(s: *mut us_socket_t) {
        // SAFETY: see `socket_poll_ref`.
        unsafe {
            let h = (*s).uv_p.cast::<UvPollHandle>();
            if !h.is_null() {
                (*h).uv.unref();
            }
        }
    }

    // ── us_timer_t (libuv.c:252-322) ─────────────────────────────────────────

    /// `us_internal_callback_t` + embedded uv_timer_t + ext, one allocation.
    /// `*mut Timer` (opaque) == `*mut TimerBlob`. Freed only by uv_close cb.
    #[repr(C)]
    struct TimerBlob {
        loop_: *mut Loop,
        cb: Option<unsafe extern "C" fn(*mut Timer)>,
        /// Sweep-timer one-shot guard (libuv.c:300-305; OQ-16 preserved).
        has_added_timer_to_event_loop: bool,
        /// Trailing ext byte count — dealloc needs the full layout back.
        ext_size: usize,
        uv: sys::Timer,
        // ext bytes follow.
    }

    const TIMER_EXT_OFFSET: usize = mem::size_of::<TimerBlob>();

    fn timer_layout(ext_size: usize) -> core::alloc::Layout {
        core::alloc::Layout::from_size_align(
            TIMER_EXT_OFFSET + ext_size,
            mem::align_of::<TimerBlob>(),
        )
        .expect("timer layout")
    }

    unsafe extern "C" fn timer_cb(t: *mut sys::Timer) {
        // SAFETY: `data` points at the owning TimerBlob until close; `cb` was
        // set by `timer_set` before any arm. C passes the callback struct
        // pointer, which IS the us_timer_t (libuv.c:55-58).
        unsafe {
            let blob = (*t).data.cast::<TimerBlob>();
            if let Some(cb) = (*blob).cb {
                cb(blob.cast::<Timer>());
            }
        }
    }

    unsafe extern "C" fn timer_close_cb(t: *mut sys::Timer) {
        // SAFETY: `data` was re-pointed at the blob in `timer_close`; sole
        // owner post-close; layout reconstructed from the stashed ext_size.
        unsafe {
            let blob = (*t).data.cast::<TimerBlob>();
            let ext_size = (*blob).ext_size;
            std::alloc::dealloc(blob.cast(), timer_layout(ext_size));
        }
    }

    /// `us_create_timer` (libuv.c:252-270): calloc blob, init embedded
    /// uv_timer, `data = blob`, unref iff fallthrough.
    pub(crate) fn timer_create(loop_: *mut Loop, fallthrough: bool, ext_size: usize) -> *mut Timer {
        // SAFETY: zeroed blob is valid POD; uv_timer_init on this thread's
        // loop; the blob is freed only by `timer_close_cb`.
        unsafe {
            let blob = std::alloc::alloc_zeroed(timer_layout(ext_size)).cast::<TimerBlob>();
            if blob.is_null() {
                bun_core::out_of_memory();
            }
            (*blob).loop_ = loop_;
            (*blob).ext_size = ext_size;
            let _ = sys::uv_timer_init(uv_loop_of(loop_), &raw mut (*blob).uv);
            (*blob).uv.data = blob.cast();
            if fallthrough {
                (*blob).uv.unref();
            }
            blob.cast()
        }
    }

    /// `us_timer_set` (libuv.c:291-315): sweep one-shot guard first, then
    /// `uv_timer_start(ms, repeat_ms)`; `ms == 0` → stop.
    pub(crate) fn timer_set(
        t: *mut Timer,
        cb: Option<unsafe extern "C" fn(*mut Timer)>,
        ms: c_int,
        repeat_ms: c_int,
    ) {
        let blob = t.cast::<TimerBlob>();
        // SAFETY: `t` is a live timer from `timer_create`, not yet closed.
        unsafe {
            if (*(*blob).loop_).internal_loop_data.sweep_timer == t.cast() {
                if (*blob).has_added_timer_to_event_loop {
                    return;
                }
                (*blob).has_added_timer_to_event_loop = true;
            }
            (*blob).cb = cb;
            if ms == 0 {
                let _ = sys::uv_timer_stop(&raw mut (*blob).uv);
            } else {
                // C converts `int` → `uint64_t` (sign-extends); port exactly.
                let _ = sys::uv_timer_start(
                    &raw mut (*blob).uv,
                    Some(timer_cb),
                    ms as i64 as u64,
                    repeat_ms as i64 as u64,
                );
            }
        }
    }

    /// `us_timer_close` (libuv.c:277-289): always ref before closing, stop,
    /// then uv_close with the freeing callback.
    pub(crate) fn timer_close(t: *mut Timer) {
        let blob = t.cast::<TimerBlob>();
        // SAFETY: `t` is live; after this call only `timer_close_cb` may
        // touch the blob.
        unsafe {
            (*blob).uv.ref_();
            let _ = sys::uv_timer_stop(&raw mut (*blob).uv);
            (*blob).uv.data = blob.cast();
            (*blob).uv.close(timer_close_cb);
        }
    }

    pub(crate) fn timer_loop(t: *mut Timer) -> *mut Loop {
        // SAFETY: `t` is live.
        unsafe { (*t.cast::<TimerBlob>()).loop_ }
    }

    /// `us_timer_ext` (libuv.c:272-275): ext bytes follow the blob.
    pub(crate) fn timer_ext(t: *mut Timer) -> *mut c_void {
        // SAFETY: pointer stays within the single blob allocation.
        unsafe { t.cast::<u8>().add(TIMER_EXT_OFFSET).cast() }
    }

    // ── wakeup async (libuv.c:325-366, R10.4 libuv arm) ──────────────────────

    /// uv_async, unreffed; the callback receives the LOOP pointer (the
    /// `cb_expects_the_loop` port). Freed only by its uv_close callback.
    #[repr(C)]
    struct AsyncBlob {
        /// MUST stay first: `*mut AsyncBlob` doubles as the uv handle ptr.
        uv: sys::uv_async_t,
        loop_: *mut Loop,
        cb: unsafe extern "C" fn(*mut Loop),
    }

    unsafe extern "C" fn async_cb(a: *mut sys::uv_async_t) {
        // SAFETY: `a` is the first field of a live AsyncBlob; fields were set
        // before uv_async_init made the handle reachable.
        unsafe {
            let blob = a.cast::<AsyncBlob>();
            ((*blob).cb)((*blob).loop_)
        }
    }

    unsafe extern "C" fn async_close_cb(a: *mut sys::uv_async_t) {
        // SAFETY: sole owner post-close.
        drop(unsafe { Box::from_raw(a.cast::<AsyncBlob>()) });
    }

    pub(crate) fn wakeup_async_create(
        loop_: *mut Loop,
        cb: unsafe extern "C" fn(*mut Loop),
    ) -> *mut WakeupAsync {
        // SAFETY: only `uv` is zeroed and it is POD (Option callbacks / raw
        // pointers); the non-nullable `cb` fn pointer is built initialized.
        // Init on this thread's loop.
        unsafe {
            let blob: *mut AsyncBlob = Box::into_raw(Box::new(AsyncBlob {
                uv: mem::zeroed(),
                loop_,
                cb,
            }));
            let _ = sys::uv_async_init(uv_loop_of(loop_), &raw mut (*blob).uv, Some(async_cb));
            (*blob).uv.unref();
            (*blob).uv.data = blob.cast();
            blob.cast()
        }
    }

    /// `us_wakeup_loop` on libuv: just uv_async_send — no `pending_wakeups`
    /// consumption on this backend (R10.1).
    pub(crate) fn wakeup_async_send(a: *mut WakeupAsync) {
        // SAFETY: `a` is a live AsyncBlob; uv_async_send is thread-safe.
        unsafe {
            let _ = sys::uv_async_send(&raw mut (*a.cast::<AsyncBlob>()).uv);
        }
    }

    /// `us_internal_async_close` (libuv.c:335-345): ref, then close+free.
    pub(crate) fn wakeup_async_close(a: *mut WakeupAsync) {
        let blob = a.cast::<AsyncBlob>();
        // SAFETY: `a` is live; only `async_close_cb` touches it afterwards.
        unsafe {
            (*blob).uv.ref_();
            (*blob).uv.data = blob.cast();
            (*blob).uv.close(async_close_cb);
        }
    }
}

// ──────────────── TLS engine edges (tls/state.rs — per-socket SSL) ───────────
// CTX construction, the ex_data registry, verify plumbing and session/keylog
// parking live in unsafe_core/bssl.rs; this section adds only the per-socket
// engine primitives that file lacks: SSL lifecycle, the custom BIO pair, and
// the read/write/handshake/shutdown calls (docs/tls.md §1-§5).

use core::ffi::{CStr, c_long};
use core::sync::atomic::{AtomicI32, AtomicUsize, Ordering};
use std::sync::Once;

use crate::handle::CloseCode;
use crate::tls::SSL;
use crate::tls::state::{BioCtl, LoopTlsShared};
use crate::unsafe_core::bssl::{BIO, BIO_METHOD, X509_STORE, X509_STORE_CTX};
use crate::{LIBUS_RECV_BUFFER_LENGTH, LIBUS_RECV_BUFFER_PADDING};

// Values verified against vendor/boringssl/include/openssl/{ssl,bio}.h.
const BIO_CTRL_FLUSH: c_int = 11;
const SSL_SENT_SHUTDOWN: c_int = 1;
const SSL_RECEIVED_SHUTDOWN: c_int = 2;
const SSL_ERROR_NONE: c_int = 0;
const SSL_ERROR_SSL: c_int = 1;
const SSL_ERROR_WANT_READ: c_int = 2;
const SSL_ERROR_WANT_WRITE: c_int = 3;
const SSL_ERROR_SYSCALL: c_int = 5;
const SSL_ERROR_ZERO_RETURN: c_int = 6;
const SSL_ERROR_PENDING_CERTIFICATE: c_int = 12;
const SSL_ERROR_WANT_RENEGOTIATE: c_int = 19;
/// `enum ssl_renegotiate_mode_t` (ssl.h:5170-5174).
const SSL_RENEGOTIATE_NEVER: c_int = 0;
const SSL_RENEGOTIATE_EXPLICIT: c_int = 4;

type BioCreateCb = unsafe extern "C" fn(*mut BIO) -> c_int;
type BioWriteCb = unsafe extern "C" fn(*mut BIO, *const c_char, c_int) -> c_int;
type BioReadCb = unsafe extern "C" fn(*mut BIO, *mut c_char, c_int) -> c_int;
type BioCtrlCb = unsafe extern "C" fn(*mut BIO, c_int, c_long, *mut c_void) -> c_long;
type SslVerifyCb = unsafe extern "C" fn(c_int, *mut X509_STORE_CTX) -> c_int;

unsafe extern "C" {
    fn SSL_new(ctx: *mut SslCtx) -> *mut SSL;
    fn SSL_free(ssl: *mut SSL);
    fn SSL_set_bio(ssl: *mut SSL, rbio: *mut BIO, wbio: *mut BIO);
    fn SSL_set_connect_state(ssl: *mut SSL);
    fn SSL_set_accept_state(ssl: *mut SSL);
    fn SSL_set_renegotiate_mode(ssl: *mut SSL, mode: c_int);
    fn SSL_set_tlsext_host_name(ssl: *mut SSL, name: *const c_char) -> c_int;
    fn SSL_set_verify(ssl: *mut SSL, mode: c_int, cb: Option<SslVerifyCb>);
    fn SSL_set0_verify_cert_store(ssl: *mut SSL, store: *mut X509_STORE) -> c_int;
    fn SSL_do_handshake(ssl: *mut SSL) -> c_int;
    fn SSL_read(ssl: *mut SSL, buf: *mut c_void, num: c_int) -> c_int;
    fn SSL_write(ssl: *mut SSL, buf: *const c_void, num: c_int) -> c_int;
    fn SSL_shutdown(ssl: *mut SSL) -> c_int;
    fn SSL_renegotiate(ssl: *mut SSL) -> c_int;
    fn SSL_get_error(ssl: *const SSL, ret: c_int) -> c_int;
    fn SSL_get_shutdown(ssl: *const SSL) -> c_int;
    fn SSL_is_init_finished(ssl: *const SSL) -> c_int;
    fn SSL_in_init(ssl: *const SSL) -> c_int;
    fn SSL_get_quiet_shutdown(ssl: *const SSL) -> c_int;
    fn BIO_meth_new(ty: c_int, name: *const c_char) -> *mut BIO_METHOD;
    fn BIO_meth_set_create(m: *mut BIO_METHOD, cb: Option<BioCreateCb>) -> c_int;
    fn BIO_meth_set_write(m: *mut BIO_METHOD, cb: Option<BioWriteCb>) -> c_int;
    fn BIO_meth_set_read(m: *mut BIO_METHOD, cb: Option<BioReadCb>) -> c_int;
    fn BIO_meth_set_ctrl(m: *mut BIO_METHOD, cb: Option<BioCtrlCb>) -> c_int;
    fn BIO_new(method: *const BIO_METHOD) -> *mut BIO;
    fn BIO_free(bio: *mut BIO) -> c_int;
    fn BIO_set_data(bio: *mut BIO, data: *mut c_void);
    fn BIO_get_data(bio: *mut BIO) -> *mut c_void;
    fn BIO_set_init(bio: *mut BIO, init: c_int);
    fn BIO_clear_retry_flags(bio: *mut BIO);
    fn BIO_set_retry_read(bio: *mut BIO);
    fn BIO_set_retry_write(bio: *mut BIO);
    fn BIO_method_type(bio: *const BIO) -> c_int;
    fn BIO_get_new_index() -> c_int;
}

/// Decomposed `SSL_get_error` result.
#[derive(Copy, Clone, Debug)]
pub(crate) enum SslErr {
    None,
    WantRead,
    WantWrite,
    WantRenegotiate,
    PendingCertificate,
    ZeroReturn,
    Ssl,
    Syscall,
    Other(c_int),
}

// ── scoped borrows ────────────────────────────────────────────────────────────

/// Scoped access to a live `BioCtl`. Contract: `f` must not re-enter
/// BoringSSL on the owning SSL and must not run dispatch callbacks — the BIO
/// hooks form their own `&mut BioCtl` while BoringSSL runs, and this borrow
/// must be gone by then.
pub(crate) fn with_ctl<R>(ctl: *mut BioCtl, f: impl FnOnce(&mut BioCtl) -> R) -> R {
    // SAFETY: `ctl` is the Box allocation owned by a live TlsState (freed only
    // in TlsState::drop, after SSL_free); the borrow is confined to `f`.
    f(unsafe { &mut *ctl })
}

/// The loop's lazily-created shared TLS state, stored in `ssl_data` (C
/// `us_internal_init_loop_ssl_data`); freed only by `free_loop_raw`.
pub(crate) fn tls_shared_ptr(loop_: *mut Loop) -> *mut LoopTlsShared {
    // SAFETY: loop-thread access to the single owning pointer slot.
    unsafe {
        let slot = &raw mut (*loop_).internal_loop_data.ssl_data;
        if (*slot).is_null() {
            *slot = Box::into_raw(Box::new(LoopTlsShared::new())).cast();
        }
        (*slot).cast()
    }
}

/// Scoped access to the loop-shared TLS state — same borrow contract as
/// [`with_ctl`] (must end before any SSL call or dispatch).
pub(crate) fn with_shared<R>(sh: *mut LoopTlsShared, f: impl FnOnce(&mut LoopTlsShared) -> R) -> R {
    // SAFETY: `sh` is the loop-owned Box from `tls_shared_ptr` (freed only in
    // free_loop_raw, after every socket); the borrow is confined to `f`.
    f(unsafe { &mut *sh })
}

pub(crate) fn with_tls_shared<R>(loop_: *mut Loop, f: impl FnOnce(&mut LoopTlsShared) -> R) -> R {
    with_shared(tls_shared_ptr(loop_), f)
}

/// Close entry for the TLS deferred-close epilogue (docs/tls.md §1.4): the
/// caller's `&mut TlsState` must not be touched again after this returns.
pub(crate) fn socket_close(s: *mut us_socket_t, code: CloseCode) {
    // SAFETY: `s` is a live slab-resident header (deref::with_socket contract).
    unsafe { (*s).close(code) }
}

/// Frees a `BioCtl` allocated via `Box::into_raw` (TlsState::drop only).
pub(crate) fn ctl_free(ctl: *mut BioCtl) {
    // SAFETY: single owner (TlsState) frees exactly once, after SSL_free —
    // no BIO hook can run afterwards.
    drop(unsafe { Box::from_raw(ctl) });
}

// ── custom BIO pair (per socket; docs/tls.md §1.3) ─────────────────────────

// One-time BIO method registration at first SSL creation (pthread_once
// shape, like the C's ex-index init): `BIO_INIT` orders the two plain-latch
// writes below before any reader.
static BIO_INIT: Once = Once::new();
static BIO_METHOD_PTR: AtomicUsize = AtomicUsize::new(0);
static BIO_METHOD_TYPE: AtomicI32 = AtomicI32::new(0);

fn bio_init() {
    BIO_INIT.call_once(|| {
        // SAFETY: one-time process init; BIO_meth_* on a fresh method object.
        unsafe {
            let ty = BIO_get_new_index();
            assert!(ty > 0, "BIO_get_new_index exhausted");
            let m = BIO_meth_new(ty, c"bun BIO".as_ptr());
            assert!(!m.is_null(), "BIO_meth_new failed");
            BIO_meth_set_create(m, Some(bio_create_cb));
            BIO_meth_set_write(m, Some(bio_write_cb));
            BIO_meth_set_read(m, Some(bio_read_cb));
            BIO_meth_set_ctrl(m, Some(bio_ctrl_cb));
            BIO_METHOD_TYPE.store(ty, Ordering::Relaxed);
            BIO_METHOD_PTR.store(m as usize, Ordering::Relaxed);
        }
    });
}

/// Unique BIO type index: identifies OUR BIOs (data == BioCtl) vs foreign
/// ones (SSLWrapper's BIO_s_mem stores a BUF_MEM*, docs/tls.md §6.2).
fn bio_type() -> c_int {
    bio_init();
    BIO_METHOD_TYPE.load(Ordering::Relaxed)
}

fn bio_method() -> *const BIO_METHOD {
    bio_init();
    BIO_METHOD_PTR.load(Ordering::Relaxed) as *const BIO_METHOD
}

unsafe extern "C" fn bio_create_cb(bio: *mut BIO) -> c_int {
    // SAFETY: fresh BIO owned by this method.
    unsafe { BIO_set_init(bio, 1) };
    1
}

unsafe extern "C" fn bio_ctrl_cb(
    _bio: *mut BIO,
    cmd: c_int,
    _num: c_long,
    _ptr: *mut c_void,
) -> c_long {
    if cmd == BIO_CTRL_FLUSH { 1 } else { 0 }
}

unsafe extern "C" fn bio_read_cb(bio: *mut BIO, out: *mut c_char, len: c_int) -> c_int {
    // SAFETY: BIO_set_data pointed at the live BioCtl; no with_ctl borrow is
    // active while BoringSSL runs (with_ctl contract).
    let c = unsafe { &mut *BIO_get_data(bio).cast::<BioCtl>() };
    // SAFETY: retry-flag ops on the live BIO.
    unsafe { BIO_clear_retry_flags(bio) };
    if len <= 0 {
        return 0;
    }
    if c.read_len == 0 {
        // Empty window → SSL_ERROR_WANT_READ.
        // SAFETY: live BIO.
        unsafe { BIO_set_retry_read(bio) };
        return -1;
    }
    let n = c.read_len.min(len as usize);
    // SAFETY: `read_ptr[read_off..read_off+read_len]` is the caller's live
    // ciphertext window (set_window contract); `out[..len]` is BoringSSL's.
    unsafe {
        core::ptr::copy_nonoverlapping(c.read_ptr.add(c.read_off), out.cast::<u8>(), n);
    }
    c.read_off += n;
    c.read_len -= n;
    n as c_int
}

unsafe extern "C" fn bio_write_cb(bio: *mut BIO, data: *const c_char, len: c_int) -> c_int {
    // SAFETY: see bio_read_cb.
    let c = unsafe { &mut *BIO_get_data(bio).cast::<BioCtl>() };
    // SAFETY: retry-flag ops on the live BIO.
    unsafe { BIO_clear_retry_flags(bio) };
    if len <= 0 {
        return 0;
    }
    // A JS callback destroyed the socket mid-handshake/read: swallow and
    // report written so the state machine finishes its error path without
    // touching a dying fd (drops the fatal alert — §1.3.1, SNI abort §2.6).
    if c.pending_detach {
        return len;
    }
    // SAFETY: BoringSSL guarantees `data[..len]` for the duration of the call.
    let bytes = unsafe { core::slice::from_raw_parts(data.cast::<u8>(), len as usize) };
    // SAFETY: `shared` is the loop-owned LoopTlsShared, live for every socket
    // on the loop; distinct allocation from `c`, no with_* borrow is active.
    let sh = unsafe { &mut *c.shared };
    if sh.batching {
        // Append the sealed record to the loop batch. Report full length so
        // BoringSSL seals the next record instead of parking a partial one;
        // alloc failure → fatal, still report written (record sequence
        // numbers already advanced — §1.3.2).
        if sh.batch.try_reserve(bytes.len()).is_err() {
            c.fatal = true;
            return len;
        }
        sh.batch.extend_from_slice(bytes);
        return len;
    }
    let written = crate::write::raw_write(c.s, bytes);
    if written <= 0 {
        // SAFETY: live BIO.
        unsafe { BIO_set_retry_write(bio) };
        return -1;
    }
    written
}

// ── SSL lifecycle ─────────────────────────────────────────────────────────────

/// `SSL_new` + per-socket custom BIO pair (both refs transferred via
/// SSL_set_bio, so SSL_free frees them). Null on allocation failure.
pub(crate) fn ssl_new_attached(ctx: *mut SslCtx, ctl: *mut BioCtl) -> *mut SSL {
    if ctx.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: fresh SSL/BIOs; SSL_set_bio consumes both BIO refs (per-socket
    // pair — no BIO_up_ref sharing, unlike the C loop-shared design).
    unsafe {
        let ssl = SSL_new(ctx);
        if ssl.is_null() {
            return core::ptr::null_mut();
        }
        let rbio = BIO_new(bio_method());
        let wbio = BIO_new(bio_method());
        if rbio.is_null() || wbio.is_null() {
            if !rbio.is_null() {
                BIO_free(rbio);
            }
            if !wbio.is_null() {
                BIO_free(wbio);
            }
            SSL_free(ssl);
            return core::ptr::null_mut();
        }
        BIO_set_data(rbio, ctl.cast());
        BIO_set_data(wbio, ctl.cast());
        SSL_set_bio(ssl, rbio, wbio);
        ssl
    }
}

pub(crate) fn ssl_free(ssl: *mut SSL) {
    // SAFETY: single owner (TlsState) frees exactly once; frees the BIO pair.
    unsafe { SSL_free(ssl) }
}

pub(crate) fn ssl_set_connect_state(ssl: *mut SSL) {
    // SAFETY: live SSL (all wrappers below share this contract: `ssl` is
    // TlsState's live handle, nulled before free).
    unsafe { SSL_set_connect_state(ssl) }
}

pub(crate) fn ssl_set_accept_state(ssl: *mut SSL) {
    // SAFETY: live SSL.
    unsafe { SSL_set_accept_state(ssl) }
}

/// explicit=true → ssl_renegotiate_explicit (client); false → never (server).
pub(crate) fn ssl_set_reneg_mode(ssl: *mut SSL, explicit: bool) {
    // SAFETY: live SSL.
    unsafe {
        SSL_set_renegotiate_mode(
            ssl,
            if explicit {
                SSL_RENEGOTIATE_EXPLICIT
            } else {
                SSL_RENEGOTIATE_NEVER
            },
        )
    }
}

pub(crate) fn ssl_set_tlsext_host_name(ssl: *mut SSL, name: &CStr) {
    // SAFETY: live SSL; NUL-terminated name copied by BoringSSL.
    unsafe {
        let _ = SSL_set_tlsext_host_name(ssl, name.as_ptr());
    }
}

unsafe extern "C" fn verify_always_ok(_preverify_ok: c_int, _ctx: *mut X509_STORE_CTX) -> c_int {
    // Never abort mid-handshake: the verdict travels in us_bun_verify_error_t
    // and fail-closed lives in the consumer (docs/tls.md §2.4).
    1
}

/// Per-SSL `SSL_VERIFY_PEER` with the always-continue callback (§2.1).
pub(crate) fn ssl_set_verify_permissive(ssl: *mut SSL) {
    // SAFETY: live SSL.
    unsafe {
        SSL_set_verify(
            ssl,
            crate::unsafe_core::bssl::SSL_VERIFY_PEER,
            Some(verify_always_ok),
        )
    }
}

/// `SSL_set0_verify_cert_store` — consumes the caller's store ref.
pub(crate) fn ssl_set0_verify_cert_store(ssl: *mut SSL, store: *mut X509_STORE) {
    // SAFETY: live SSL; set0 transfers the (up-ref'd) store ownership.
    unsafe {
        let _ = SSL_set0_verify_cert_store(ssl, store);
    }
}

// ── handshake / IO ────────────────────────────────────────────────────────────

pub(crate) fn ssl_do_handshake(ssl: *mut SSL) -> c_int {
    // SAFETY: live SSL; BIO hooks run under the with_ctl contract.
    unsafe { SSL_do_handshake(ssl) }
}

pub(crate) fn ssl_read(ssl: *mut SSL, buf: &mut [u8]) -> c_int {
    let len = c_int::try_from(buf.len()).unwrap_or(c_int::MAX);
    // SAFETY: live SSL; `buf` valid for `len`.
    unsafe { SSL_read(ssl, buf.as_mut_ptr().cast(), len) }
}

pub(crate) fn ssl_write(ssl: *mut SSL, data: &[u8]) -> c_int {
    let len = c_int::try_from(data.len()).unwrap_or(c_int::MAX);
    // SAFETY: live SSL; `data` valid for `len`.
    unsafe { SSL_write(ssl, data.as_ptr().cast(), len) }
}

/// Zero-length SSL_write: seals no record but flushes deferred post-handshake
/// data (TLS1.3 NewSessionTickets) through the BIO (docs/tls.md §2.7).
pub(crate) fn ssl_write_zero(ssl: *mut SSL) {
    let zero: u8 = 0;
    // SAFETY: live SSL; pointer valid (unused for len 0 but non-null like C).
    unsafe {
        let _ = SSL_write(ssl, (&raw const zero).cast(), 0);
    }
}

pub(crate) fn ssl_shutdown(ssl: *mut SSL) -> c_int {
    // SAFETY: live SSL.
    unsafe { SSL_shutdown(ssl) }
}

pub(crate) fn ssl_renegotiate(ssl: *mut SSL) -> bool {
    // SAFETY: live SSL.
    unsafe { SSL_renegotiate(ssl) != 0 }
}

pub(crate) fn ssl_is_init_finished(ssl: *mut SSL) -> bool {
    // SAFETY: live SSL.
    unsafe { SSL_is_init_finished(ssl) != 0 }
}

pub(crate) fn ssl_in_init(ssl: *mut SSL) -> bool {
    // SAFETY: live SSL.
    unsafe { SSL_in_init(ssl) != 0 }
}

pub(crate) fn ssl_get_quiet_shutdown(ssl: *mut SSL) -> bool {
    // SAFETY: live SSL.
    unsafe { SSL_get_quiet_shutdown(ssl) != 0 }
}

/// `(sent_shutdown, received_shutdown)` bits.
pub(crate) fn ssl_get_shutdown(ssl: *mut SSL) -> (bool, bool) {
    if ssl.is_null() {
        return (false, false);
    }
    // SAFETY: live SSL.
    let bits = unsafe { SSL_get_shutdown(ssl) };
    (
        bits & SSL_SENT_SHUTDOWN != 0,
        bits & SSL_RECEIVED_SHUTDOWN != 0,
    )
}

/// Must be called immediately after the failing SSL_* call, before any other
/// SSL/queue operation (docs/tls.md §8.4).
pub(crate) fn ssl_get_error(ssl: *mut SSL, ret: c_int) -> SslErr {
    // SAFETY: live SSL.
    let e = unsafe { SSL_get_error(ssl, ret) };
    match e {
        SSL_ERROR_NONE => SslErr::None,
        SSL_ERROR_WANT_READ => SslErr::WantRead,
        SSL_ERROR_WANT_WRITE => SslErr::WantWrite,
        SSL_ERROR_WANT_RENEGOTIATE => SslErr::WantRenegotiate,
        SSL_ERROR_PENDING_CERTIFICATE => SslErr::PendingCertificate,
        SSL_ERROR_ZERO_RETURN => SslErr::ZeroReturn,
        SSL_ERROR_SSL => SslErr::Ssl,
        SSL_ERROR_SYSCALL => SslErr::Syscall,
        other => SslErr::Other(other),
    }
}

// ── loop plaintext scratch (loop-shared — docs/design.md) ─────────────

const SCRATCH_BYTES: usize = LIBUS_RECV_BUFFER_LENGTH + 2 * LIBUS_RECV_BUFFER_PADDING;

pub(crate) fn scratch_alloc() -> *mut c_void {
    // US_FAULT_SSL_LOOP_BUFFER (R11.2): simulate the one-shot TLS loop-buffer
    // allocation failure, surfaced as OOM like the C (openssl.c:682-696).
    #[cfg(feature = "socket_fault_injection")]
    if crate::fault::check(crate::fault::SSL_LOOP_BUFFER, -1, 0).is_some() {
        bun_core::out_of_memory();
    }
    let buf = vec![0u8; SCRATCH_BYTES].into_boxed_slice();
    Box::into_raw(buf).cast::<u8>().cast()
}

pub(crate) fn scratch_free(buf: *mut c_void) {
    // SAFETY: allocated by scratch_alloc with the constant length.
    unsafe {
        drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
            buf.cast::<u8>(),
            SCRATCH_BYTES,
        )));
    }
}

/// Borrow the scratch bytes. Caller (LoopScratch) exclusively holds `buf` for
/// the borrow's duration; re-entrant nesting gets a distinct allocation.
pub(crate) fn scratch_slice<'a>(buf: *mut c_void) -> &'a mut [u8] {
    // SAFETY: scratch_alloc'd region, exclusively held via LoopScratch.
    unsafe { core::slice::from_raw_parts_mut(buf.cast::<u8>(), SCRATCH_BYTES) }
}

// ── loop shared recv buffer view (R3.22c) ──────────────────────

/// Fresh `&mut` view of the loop's shared 512 KiB recv area (padding offset
/// applied). Aliasing contract (C17, inherited from the C design): the slice
/// is re-derived per use and never held across a dispatch that can re-enter.
pub(crate) fn loop_recv_area<'a>(loop_: *mut Loop) -> &'a mut [u8] {
    // SAFETY: recv_buf is a live LIBUS_RECV_BUFFER_LENGTH + 2*PADDING
    // allocation owned by the loop; each call derives a fresh borrow from the
    // raw base pointer per the contract above.
    unsafe {
        let base = (*loop_).internal_loop_data.recv_buf;
        debug_assert!(!base.is_null());
        core::slice::from_raw_parts_mut(
            base.add(crate::LIBUS_RECV_BUFFER_PADDING),
            crate::LIBUS_RECV_BUFFER_LENGTH,
        )
    }
}

// ── SNI certificate selection (docs/tls.md §2.6; openssl.c:2317-2454) ──────
// Registered on listener default contexts: `sni_cb` when the first server
// name is added (us_listen_socket_add_server_name), `select_cert_cb` when a
// dynamic resolver is set (us_listen_socket_on_server_name). A same-socket
// write from the resolver's JS clears this handshake's read window, so the C
// save/restore bracket (openssl.c:2385-2389) is kept as the §1.4 RAII guard.

use crate::unsafe_core::bssl;

const SSL_TLSEXT_ERR_OK: c_int = 0;
const SSL_TLSEXT_ERR_NOACK: c_int = 3;

/// NUL-terminated hostname parsed from the raw ClientHello (cap 256 incl NUL).
struct HostName([u8; 256]);

impl HostName {
    fn as_ptr(&self) -> *const c_char {
        self.0.as_ptr().cast()
    }

    fn as_cstr(&self) -> &CStr {
        CStr::from_bytes_until_nul(&self.0).unwrap_or(c"")
    }
}

/// Raw server_name extension parse — NOT `SSL_get_servername`; only the
/// early-callback contract guarantees the raw hello (docs/tls.md §2.6.2).
fn hello_servername(hello: *const bun_bssl::SSL_CLIENT_HELLO) -> Option<HostName> {
    let mut data: *const u8 = core::ptr::null();
    let mut len: usize = 0;
    // SAFETY: live hello for the callback's duration; outputs written on 1.
    let ok = unsafe {
        bun_bssl::SSL_early_callback_ctx_extension_get(
            hello,
            bun_bssl::TLSEXT_TYPE_server_name as u16,
            &mut data,
            &mut len,
        )
    };
    if ok == 0 || data.is_null() {
        return None;
    }
    // SAFETY: extension bytes readable for `len` while the hello is live.
    let ext = unsafe { core::slice::from_raw_parts(data, len) };
    let mut out = [0u8; 256];
    let n = crate::tls::sni::client_hello_servername(ext, &mut out);
    (n != 0).then_some(HostName(out))
}

/// Wildcard tree lookup + install. The tree ref is BORROWED —
/// `SSL_set_SSL_CTX` takes its own (openssl.c:2418-2424).
fn static_tree_select(ssl: *mut SSL, ls: *mut ListenSocket, host: &HostName) {
    if let Some(sni) = crate::group::listener_data(ls).sni.as_ref() {
        if let Some((ctx, _user)) = sni.resolve(host.as_cstr()) {
            if !ctx.is_null() {
                // SAFETY: live ssl mid-handshake; ctx is a live tree entry.
                unsafe { bun_bssl::SSL_set_SSL_CTX(ssl, ctx) };
            }
        }
    }
}

/// The `BioCtl` behind the socket's write BIO (C's
/// `BIO_get_data(SSL_get_wbio(ssl))->ssl_socket` analog); null pre-attach.
pub(crate) fn ssl_wbio_ctl(ssl: *mut SSL) -> *mut BioCtl {
    // SAFETY: live ssl; only wbios carrying our unique BIO type hold a
    // BioCtl in their data slot — foreign BIOs (BIO_s_mem) return null.
    unsafe {
        let wbio = bun_bssl::SSL_get_wbio(ssl);
        if wbio.is_null() || BIO_method_type(wbio.cast()) != bio_type() {
            core::ptr::null_mut()
        } else {
            BIO_get_data(wbio.cast()).cast()
        }
    }
}

/// `us_select_cert_cb` (openssl.c:2317-2425): async-capable certificate
/// selector; suspends via `SniSuspension` in SSL ex_data, resumed by
/// `tls::state::sni_resolve` re-driving the handshake.
pub(crate) unsafe extern "C" fn select_cert_cb(
    hello: *const bun_bssl::SSL_CLIENT_HELLO,
) -> bun_bssl::ssl_select_cert_result_t {
    use bun_bssl::{
        ssl_select_cert_result_t_ssl_select_cert_error as CERT_ERROR,
        ssl_select_cert_result_t_ssl_select_cert_retry as CERT_RETRY,
        ssl_select_cert_result_t_ssl_select_cert_success as CERT_SUCCESS,
    };
    // SAFETY: BoringSSL passes a live hello for the callback's duration.
    let ssl = unsafe { (*hello).ssl };
    if ssl.is_null() {
        return CERT_SUCCESS;
    }
    // Still waiting on the JS resolver (spurious re-drive): keep suspending.
    if bssl::sni_is_waiting(ssl) {
        return CERT_RETRY;
    }
    match bssl::sni_take(ssl) {
        Some(bssl::SniSuspension::Resolved(ctx)) if !ctx.is_null() => {
            // Owned ref from sni_resolve: SSL_set_SSL_CTX takes its own.
            // SAFETY: live ssl mid-handshake; ctx carries our owned ref.
            unsafe { bun_bssl::SSL_set_SSL_CTX(ssl, ctx) };
            bssl::ssl_ctx_free(ctx);
            return CERT_SUCCESS;
        }
        Some(bssl::SniSuspension::Resolved(_)) => {
            // Async cb(null, null): fall through to the static tree exactly
            // like a sync resolver returning null (openssl.c:2333-2352).
            let ls = crate::tls::context::listener_backref(ssl).cast::<ListenSocket>();
            if !ls.is_null() {
                if let Some(host) = hello_servername(hello) {
                    static_tree_select(ssl, ls, &host);
                }
            }
            return CERT_SUCCESS;
        }
        Some(bssl::SniSuspension::Error) => return CERT_ERROR,
        Some(bssl::SniSuspension::Waiting) | None => {}
    }

    // First call. Backref is wiped at listener close, so non-null == live.
    let ls = crate::tls::context::listener_backref(ssl).cast::<ListenSocket>();
    if ls.is_null() {
        return CERT_SUCCESS;
    }
    let Some(resolver) = crate::group::listener_data(ls).on_server_name else {
        return CERT_SUCCESS;
    };
    let Some(host) = hello_servername(hello) else {
        return CERT_SUCCESS;
    };

    // Resume handle for an async SNICallback: the socket driving this hello.
    let ctl = ssl_wbio_ctl(ssl);
    let cb_socket: *mut us_socket_t = if ctl.is_null() {
        core::ptr::null_mut()
    } else {
        with_ctl(ctl, |c| c.s)
    };

    // Dynamic resolver runs FIRST — a user SNICallback replaces default SNI
    // handling entirely (openssl.c:2371-2389). Non-null return is OWNED.
    let mut abort_handshake: c_int = 0;
    // §1.4 nesting trigger 1: the resolver runs user JS from inside
    // SSL_do_handshake/SSL_read — save/restore the read window around it.
    let dyn_ctx = {
        let _window = crate::tls::SslWindowGuard::save(ssl);
        // SAFETY: resolver is the registered cb; host is NUL-terminated.
        unsafe { resolver(ls, host.as_ptr(), &mut abort_handshake, cb_socket) }
    };
    match abort_handshake {
        1 => {
            // Drop without a TLS alert: mark deferred detach so the BIO
            // swallows the handshake_failure alert (openssl.c:2391-2400).
            if !ctl.is_null() {
                with_ctl(ctl, |c| {
                    c.pending_detach = true;
                    c.pending_close_code = 0;
                });
            }
            CERT_ERROR
        }
        2 => {
            // Async pending: suspend until sni_resolve (openssl.c:2401-2411).
            bssl::sni_set(ssl, bssl::SniSuspension::Waiting);
            CERT_RETRY
        }
        _ if !dyn_ctx.is_null() => {
            // SAFETY: live ssl; dyn_ctx is the resolver's owned ref.
            unsafe { bun_bssl::SSL_set_SSL_CTX(ssl, dyn_ctx) };
            bssl::ssl_ctx_free(dyn_ctx);
            CERT_SUCCESS
        }
        _ => {
            // Re-read: the resolver's JS may have closed the listener
            // (backref wiped at close; the C's deferred-freed ls->sni read
            // safely saw NULL — openssl.c:2333-2352 fallthrough parity).
            let ls = crate::tls::context::listener_backref(ssl).cast::<ListenSocket>();
            if !ls.is_null() {
                static_tree_select(ssl, ls, &host);
            }
            CERT_SUCCESS
        }
    }
}

/// `sni_cb` (openssl.c:2427-2454): static-tree-only servername stage; no-op
/// when a dynamic resolver exists (the early cb already selected).
pub(crate) unsafe extern "C" fn sni_cb(ssl: *mut SSL, _al: *mut c_int, _arg: *mut c_void) -> c_int {
    if ssl.is_null() {
        return SSL_TLSEXT_ERR_NOACK;
    }
    let ls = crate::tls::context::listener_backref(ssl).cast::<ListenSocket>();
    if ls.is_null() || crate::group::listener_data(ls).on_server_name.is_some() {
        return SSL_TLSEXT_ERR_OK;
    }
    // SAFETY: live ssl inside the servername callback.
    let hostname =
        unsafe { bun_bssl::SSL_get_servername(ssl, bun_bssl::TLSEXT_NAMETYPE_host_name) };
    if !hostname.is_null() {
        // SAFETY: BoringSSL returns a NUL-terminated servername.
        let host = unsafe { CStr::from_ptr(hostname) };
        if !host.is_empty() {
            if let Some(sni) = crate::group::listener_data(ls).sni.as_ref() {
                if let Some((ctx, _user)) = sni.resolve(host) {
                    if !ctx.is_null() {
                        // SAFETY: live ssl; borrowed tree ctx (own ref taken).
                        unsafe { bun_bssl::SSL_set_SSL_CTX(ssl, ctx) };
                    }
                }
            }
        }
    }
    SSL_TLSEXT_ERR_OK
}

/// Register `sni_cb` on the listener's default ctx (first add_server_name;
/// idempotent across listeners sharing the ctx — openssl.c:2462-2467).
pub(crate) fn register_servername_cb(ctx: *mut SslCtx) {
    // SAFETY: live ctx; registration-only FFI.
    unsafe { bun_bssl::SSL_CTX_set_tlsext_servername_callback(ctx, Some(sni_cb)) };
}

/// Register `select_cert_cb` on the listener's default ctx
/// (us_listen_socket_on_server_name — openssl.c:2515-2526).
pub(crate) fn register_select_cert_cb(ctx: *mut SslCtx) {
    // SAFETY: live ctx; registration-only FFI.
    unsafe { bun_bssl::SSL_CTX_set_select_certificate_cb(ctx, Some(select_cert_cb)) };
}

// ── UpgradedDuplex / WindowsNamedPipe cycle-break shims ───────
// The real implementations live in `bun_runtime::socket` and are exported
// with #[no_mangle]; link-time dispatch avoids an upward dep (same pattern as
// the old uws_sys/lib.rs:175-348). Signatures must stay in sync with
// src/runtime/socket/{UpgradedDuplex.rs, WindowsNamedPipe.rs}.

pub(crate) mod duplex {
    use core::ffi::{c_uint, c_void};

    use crate::handle::UpgradedDuplex;
    use crate::tls::context::us_bun_verify_error_t;

    unsafe extern "C" {
        fn UpgradedDuplex__ssl_error(this: *mut UpgradedDuplex) -> us_bun_verify_error_t;
        fn UpgradedDuplex__is_established(this: *mut UpgradedDuplex) -> bool;
        fn UpgradedDuplex__is_closed(this: *mut UpgradedDuplex) -> bool;
        fn UpgradedDuplex__is_shutdown(this: *mut UpgradedDuplex) -> bool;
        fn UpgradedDuplex__ssl(this: *mut UpgradedDuplex) -> *mut c_void;
        fn UpgradedDuplex__set_timeout(this: *mut UpgradedDuplex, seconds: c_uint);
        fn UpgradedDuplex__flush(this: *mut UpgradedDuplex);
        fn UpgradedDuplex__encode_and_write(
            this: *mut UpgradedDuplex,
            ptr: *const u8,
            len: usize,
        ) -> i32;
        fn UpgradedDuplex__raw_write(this: *mut UpgradedDuplex, ptr: *const u8, len: usize) -> i32;
        fn UpgradedDuplex__shutdown(this: *mut UpgradedDuplex);
        fn UpgradedDuplex__shutdown_read(this: *mut UpgradedDuplex);
        fn UpgradedDuplex__close(this: *mut UpgradedDuplex);
    }

    // SAFETY (all wrappers): `d` is the live opaque handle the runtime crate
    // handed out; the callee only reads the borrowed (ptr,len) region.
    pub(crate) fn ssl_error(d: *mut UpgradedDuplex) -> us_bun_verify_error_t {
        unsafe { UpgradedDuplex__ssl_error(d) }
    }
    pub(crate) fn is_established(d: *mut UpgradedDuplex) -> bool {
        unsafe { UpgradedDuplex__is_established(d) }
    }
    pub(crate) fn is_closed(d: *mut UpgradedDuplex) -> bool {
        unsafe { UpgradedDuplex__is_closed(d) }
    }
    pub(crate) fn is_shutdown(d: *mut UpgradedDuplex) -> bool {
        unsafe { UpgradedDuplex__is_shutdown(d) }
    }
    pub(crate) fn ssl(d: *mut UpgradedDuplex) -> *mut c_void {
        unsafe { UpgradedDuplex__ssl(d) }
    }
    pub(crate) fn set_timeout(d: *mut UpgradedDuplex, seconds: c_uint) {
        unsafe { UpgradedDuplex__set_timeout(d, seconds) }
    }
    pub(crate) fn flush(d: *mut UpgradedDuplex) {
        unsafe { UpgradedDuplex__flush(d) }
    }
    pub(crate) fn encode_and_write(d: *mut UpgradedDuplex, data: &[u8]) -> i32 {
        unsafe { UpgradedDuplex__encode_and_write(d, data.as_ptr(), data.len()) }
    }
    pub(crate) fn raw_write(d: *mut UpgradedDuplex, data: &[u8]) -> i32 {
        unsafe { UpgradedDuplex__raw_write(d, data.as_ptr(), data.len()) }
    }
    pub(crate) fn shutdown(d: *mut UpgradedDuplex) {
        unsafe { UpgradedDuplex__shutdown(d) }
    }
    pub(crate) fn shutdown_read(d: *mut UpgradedDuplex) {
        unsafe { UpgradedDuplex__shutdown_read(d) }
    }
    pub(crate) fn close(d: *mut UpgradedDuplex) {
        unsafe { UpgradedDuplex__close(d) }
    }
}

#[cfg(windows)]
pub(crate) mod named_pipe {
    use core::ffi::{c_uint, c_void};

    use crate::handle::WindowsNamedPipe;
    use crate::tls::context::us_bun_verify_error_t;

    unsafe extern "C" {
        fn WindowsNamedPipe__ssl_error(this: *mut WindowsNamedPipe) -> us_bun_verify_error_t;
        fn WindowsNamedPipe__is_established(this: *mut WindowsNamedPipe) -> bool;
        fn WindowsNamedPipe__is_closed(this: *mut WindowsNamedPipe) -> bool;
        fn WindowsNamedPipe__is_shutdown(this: *mut WindowsNamedPipe) -> bool;
        fn WindowsNamedPipe__ssl(this: *mut WindowsNamedPipe) -> *mut c_void;
        fn WindowsNamedPipe__set_timeout(this: *mut WindowsNamedPipe, seconds: c_uint);
        fn WindowsNamedPipe__flush(this: *mut WindowsNamedPipe);
        fn WindowsNamedPipe__encode_and_write(
            this: *mut WindowsNamedPipe,
            ptr: *const u8,
            len: usize,
        ) -> i32;
        fn WindowsNamedPipe__raw_write(
            this: *mut WindowsNamedPipe,
            ptr: *const u8,
            len: usize,
        ) -> i32;
        fn WindowsNamedPipe__shutdown(this: *mut WindowsNamedPipe);
        fn WindowsNamedPipe__shutdown_read(this: *mut WindowsNamedPipe);
        fn WindowsNamedPipe__close(this: *mut WindowsNamedPipe);
        fn WindowsNamedPipe__pause_stream(this: *mut WindowsNamedPipe) -> bool;
        fn WindowsNamedPipe__resume_stream(this: *mut WindowsNamedPipe) -> bool;
    }

    // SAFETY (all wrappers): live opaque handle; borrowed (ptr,len) only read.
    pub(crate) fn ssl_error(p: *mut WindowsNamedPipe) -> us_bun_verify_error_t {
        unsafe { WindowsNamedPipe__ssl_error(p) }
    }
    pub(crate) fn is_established(p: *mut WindowsNamedPipe) -> bool {
        unsafe { WindowsNamedPipe__is_established(p) }
    }
    pub(crate) fn is_closed(p: *mut WindowsNamedPipe) -> bool {
        unsafe { WindowsNamedPipe__is_closed(p) }
    }
    pub(crate) fn is_shutdown(p: *mut WindowsNamedPipe) -> bool {
        unsafe { WindowsNamedPipe__is_shutdown(p) }
    }
    pub(crate) fn ssl(p: *mut WindowsNamedPipe) -> *mut c_void {
        unsafe { WindowsNamedPipe__ssl(p) }
    }
    pub(crate) fn set_timeout(p: *mut WindowsNamedPipe, seconds: c_uint) {
        unsafe { WindowsNamedPipe__set_timeout(p, seconds) }
    }
    pub(crate) fn flush(p: *mut WindowsNamedPipe) {
        unsafe { WindowsNamedPipe__flush(p) }
    }
    pub(crate) fn encode_and_write(p: *mut WindowsNamedPipe, data: &[u8]) -> i32 {
        unsafe { WindowsNamedPipe__encode_and_write(p, data.as_ptr(), data.len()) }
    }
    pub(crate) fn raw_write(p: *mut WindowsNamedPipe, data: &[u8]) -> i32 {
        unsafe { WindowsNamedPipe__raw_write(p, data.as_ptr(), data.len()) }
    }
    pub(crate) fn shutdown(p: *mut WindowsNamedPipe) {
        unsafe { WindowsNamedPipe__shutdown(p) }
    }
    pub(crate) fn shutdown_read(p: *mut WindowsNamedPipe) {
        unsafe { WindowsNamedPipe__shutdown_read(p) }
    }
    pub(crate) fn close(p: *mut WindowsNamedPipe) {
        unsafe { WindowsNamedPipe__close(p) }
    }
    pub(crate) fn pause_stream(p: *mut WindowsNamedPipe) -> bool {
        unsafe { WindowsNamedPipe__pause_stream(p) }
    }
    pub(crate) fn resume_stream(p: *mut WindowsNamedPipe) -> bool {
        unsafe { WindowsNamedPipe__resume_stream(p) }
    }
}

// ── raw lowering helpers ─────────────────────────────────────────

/// Borrow one `UsIoVec` as a byte slice (duplex/pipe raw_writev lowering).
/// Contract: base/len reference caller-owned memory for the call's duration.
pub(crate) fn iovec_as_slice<'a>(v: &crate::write::UsIoVec) -> &'a [u8] {
    if v.base.is_null() || v.len == 0 {
        return &[];
    }
    // SAFETY: UsIoVec contract — base is readable for len bytes.
    unsafe { core::slice::from_raw_parts(v.base.cast::<u8>(), v.len) }
}

/// Frozen erased `on_server_name` registration shape → the typed
/// `sni::OnServerName` (pointer-for-pointer, ABI-identical; the cabi side
/// performs the inverse transmute — docs/cabi.md §4.3).
pub(crate) fn server_name_cb_from_erased(
    cb: extern "C" fn(
        *mut ListenSocket,
        *const c_char,
        *mut c_int,
        *mut core::ffi::c_void,
    ) -> *mut core::ffi::c_void,
) -> crate::tls::sni::OnServerName {
    // SAFETY: identical arity and pointer-sized params/return.
    unsafe { core::mem::transmute(cb) }
}
