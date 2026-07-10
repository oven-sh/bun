#![cfg(windows)]

//! The uSockets Windows eventing backend — the C-ABI surface that replaces
//! `packages/bun-usockets/src/eventing/libuv.c` at the rewire flip.
//!
//! NORMATIVE spec: `USOCKETS_EVENTING_CONTRACT.md` (worktree root). The C-side
//! struct definitions live in `packages/bun-usockets/src/internal/eventing/
//! bun_iocp.h`; the layout constants below and that header's static_asserts
//! must agree — both pin the shared `us_internal_loop_data_t` so the third
//! mirror (`src/uws_sys/InternalLoopData.rs`) cannot drift unnoticed.
//!
//! Composition: every exported entry point is a thin adapter over the crate's
//! building blocks — [`Loop`] (tick/hooks/timers/keep-alive) and [`AfdPoll`]
//! (socket readiness). Backend-private state lives in an opaque blob at the
//! tail of `us_loop_t` ([`Backend`]) and in a heap-split [`NativePoll`] per
//! `us_poll_t` (the `uv_poll_t` analogue). Shared C (loop.c, socket.c, …)
//! stays in C; the functions it provides are declared at the bottom and
//! test-doubled in `c_shims` so the crate's natively-linkable test binary
//! still links.
//!
//! Deliberate fixes over libuv.c (per contract instruction, not parity):
//! - hazard 5: the sweep-timer one-shot guard is dropped — `us_timer_set`
//!   on the sweep timer arms/disarms like POSIX, so disable actually stops
//!   it and re-enable re-arms it.
//! - hazard 6: `tick_depth` is maintained (++/-- around every tick) so
//!   nested ticks defer `us_internal_free_closed_sockets` correctly.
//! - hazard 12: timers dispatch INSIDE the pre/post bracket (POSIX order;
//!   `Loop::tick` already converged — // quirk: LOOP-28).
//!
//! Documented deviations (each called out at its site): the QUIC deadline is
//! folded at tick entry (not after pre), the wakeup exchange happens before
//! pre, `us_timer_close`/`us_internal_async_close` free synchronously (POSIX
//! semantics; libuv defers), and saturation re-polling is per-tick batched
//! (libuv parity) rather than POSIX's 48-round drain.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::{offset_of, size_of};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_windows_sys::Win32Error;
use bun_windows_sys::ws2_32::{SOCKET, SOL_SOCKET, WSAGetLastError, WSASetLastError, getsockopt};

use crate::afd::{AfdPoll, PollCloseCb};
use crate::event_loop::Loop;
use crate::timer::Timer;

/// `SO_ERROR` (`winsock2.h`). Local because it is only consumed by
/// `us_socket_get_error` below.
const SO_ERROR: c_int = 0x1007;

// `internal/internal.h:84-100` — poll-type bits stored in `us_poll_t.poll_type`.
const POLL_TYPE_POLLING_OUT: u8 = 8;
const POLL_TYPE_POLLING_IN: u8 = 16;
const POLL_TYPE_KIND_MASK: u8 = 0b111;
const POLL_TYPE_POLLING_MASK: u8 = 0b11000;

/// `LIBUS_SOCKET_READABLE` / `LIBUS_SOCKET_WRITABLE` (backend-chosen, 1/2 —
/// matches kqueue's values and, bit-for-bit, `afd::POLL_READABLE/WRITABLE`).
const LIBUS_SOCKET_READABLE: c_int = 1;
const LIBUS_SOCKET_WRITABLE: c_int = 2;

// ───────────────────────────── C layout mirrors ─────────────────────────────

/// Mirror of `us_internal_loop_data_t` (`internal/loop_data.h`). Tier-0 cannot
/// import the `bun_uws_sys::InternalLoopData` mirror, so the field list is
/// repeated here; all three copies are pinned by the static_asserts in
/// `internal/eventing/bun_iocp.h` and the `const _` block below.
#[repr(C)]
pub struct LoopData {
    pub sweep_timer: *mut UsInternalCallback,
    pub sweep_timer_count: c_int,
    pub wakeup_async: *mut UsInternalCallback,
    pub head: *mut c_void,
    pub quic_head: *mut c_void,
    pub quic_next_tick_us: i64,
    pub quic_timer: *mut c_void,
    pub iterator: *mut c_void,
    pub recv_buf: *mut u8,
    pub send_buf: *mut u8,
    pub ssl_data: *mut c_void,
    pub pre_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    pub post_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    pub closed_udp_head: *mut c_void,
    pub closed_head: *mut c_void,
    pub low_prio_head: *mut c_void,
    pub low_prio_budget: c_int,
    pub dns_ready_head: *mut c_void,
    pub closed_connecting_head: *mut c_void,
    /// `zig_mutex_t` = `void*` (SRWLOCK) on Windows.
    pub mutex: *mut c_void,
    pub parent_ptr: *mut c_void,
    pub parent_tag: c_char,
    pub iteration_nr: u64,
    pub jsc_vm: *const c_void,
    pub tick_depth: c_int,
}

/// Backend-private loop state, the opaque `void *bun_backend[4]` tail of the
/// C `us_loop_t`. Written only by this module; calloc-zero is a valid initial
/// state for every field except `native` (set before any callback can run).
#[repr(C)]
struct Backend {
    /// The native loop. Owned (`Box::into_raw`) when `is_default == 0`,
    /// borrowed from the embedder (`us_create_loop` hint) otherwise —
    /// `is_default` means "borrowed", contract hazard 13.
    native: *mut Loop,
    /// Intrusive list of registered asyncs (each links through its
    /// `AsyncNative.next`), fired from the post trampoline.
    async_head: *mut UsInternalCallback,
    /// GC-safepoint callback installed via `us_loop_set_on_before_wait`;
    /// invoked with `data.jsc_vm` when a bun tick is about to idle (B.4
    /// step 7). The JSC wiring happens at the rewire.
    on_before_wait: Option<unsafe extern "C" fn(*mut c_void)>,
    is_default: c_int,
    /// Set for the duration of one `us_loop_run_bun_tick` whose
    /// will-idle precheck passed (B.4 step 6); read by the before-wait
    /// trampoline, which `Loop::tick` only runs when actually about to block.
    tick_will_idle: bool,
}

/// Mirror of the new C `us_loop_t` (`internal/eventing/bun_iocp.h`).
/// `data` at offset 0 and total size are hard ABI: `us_loop_ext()` in shared
/// loop.c computes `loop + 1` — contract hazard 1.
#[repr(C, align(16))]
pub struct UsLoop {
    pub data: LoopData,
    /// Incremented by shared `us_wakeup_loop` (loop.c, BY NAME, any thread);
    /// exchanged to 0 at the top of every bun tick (B.4 step 6).
    pub pending_wakeups: AtomicU32,
    backend: Backend,
}

/// Mirror of the new C `us_poll_t` (heap-split, libuv-shaped): the native
/// watcher state is a separately-allocated [`NativePoll`] so `us_poll_resize`
/// can move the `us_poll_t` block while I/O is in flight — contract hazard 2.
#[repr(C)]
pub struct UsPoll {
    backend_handle: *mut NativePoll,
    fd: SOCKET,
    poll_type: u8,
}

/// Mirror of `us_internal_callback_t` (`internal/internal.h:365-372`,
/// non-Apple). The first two fields (`p`, `loop_`) are hard ABI: shared
/// loop.c:326 reads `cb->loop` through a `us_timer_t*` cast — contract
/// hazard 3. The rest is backend-written only.
#[repr(C, align(16))]
pub struct UsInternalCallback {
    pub p: UsPoll,
    pub loop_: *mut UsLoop,
    pub cb_expects_the_loop: c_int,
    pub leave_poll_ready: c_int,
    /// Stored with the unary-pointer ABI all callers share; shared C casts
    /// between `us_timer_t*`/`us_internal_async*`/`us_loop_t*` signatures
    /// freely (loop.c:56,64,79) — contract hazard 14.
    pub cb: Option<unsafe extern "C" fn(*mut UsInternalCallback)>,
    pub has_added_timer_to_event_loop: c_uint,
}

/// Backend storage of a timer block: `[UsInternalCallback][TimerNative][ext]`.
#[repr(C)]
struct TimerNative {
    timer: Timer,
    /// Whether create-time `fallthrough == 0` took a keep-alive ref — the
    /// only us-object that holds the loop open (contract hazard 7). The
    /// close-time `fallthrough` parameter is ignored, like libuv.c.
    non_fallthrough: bool,
}

/// Backend storage of an async block: `[UsInternalCallback][AsyncNative][ext]`.
#[repr(C)]
struct AsyncNative {
    /// Intrusive link in `Backend::async_head` (linked at `async_set`).
    next: *mut UsInternalCallback,
    /// Set by `us_internal_async_wakeup` (any thread), consumed by the post
    /// trampoline on the loop thread.
    fired: AtomicBool,
    non_fallthrough: bool,
}

/// Heap-split native poll state — the `uv_poll_t` analogue. Allocated by
/// `us_create_poll`, it outlives `us_poll_t` block moves (resize) and is the
/// stable `data` pointer handed to [`AfdPoll`], so in-flight completions
/// route through `data` to whichever block currently owns the poll.
/// `repr(C)` only because `UsPoll` (an FFI struct) points to it; C never
/// dereferences the pointer.
#[repr(C)]
struct NativePoll {
    /// Owning `us_poll_t` block. Rebound by resize (hazard 2); nulled by
    /// `us_poll_stop` (the libuv `uv_p->data = 0` move) and repointed by a
    /// subsequent `us_poll_free` so the close callback frees both blocks.
    data: *mut UsPoll,
    /// Null until the first successful `us_poll_start`; nulled again by the
    /// close callback once both request slots have drained.
    afd: *mut AfdPoll,
    /// An `AfdPoll::close` has been issued; the close callback will run.
    closing: bool,
}

/// `bun_core::util::Timespec` layout (`{ sec: i64, nsec: i64 }`). The only
/// Windows callers of `us_loop_run_bun_tick` are Rust (uws_sys/Loop.rs)
/// passing exactly this type; ucrt's `struct timespec` (4-byte `tv_nsec`) is
/// NOT compatible and must never be passed from C — documented in the header.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}

// Layout constants shared with the C header's static_asserts. A mismatch on
// either side is a compile error there and here.
const LOOP_DATA_SIZE: usize = 200;
const US_LOOP_SIZE: usize = 240;
const US_POLL_SIZE: usize = 24;
const US_CALLBACK_SIZE: usize = 64;

const _: () = {
    assert!(size_of::<LoopData>() == LOOP_DATA_SIZE);
    assert!(offset_of!(LoopData, sweep_timer) == 0);
    assert!(offset_of!(LoopData, quic_head) == 32);
    assert!(offset_of!(LoopData, quic_next_tick_us) == 40);
    assert!(offset_of!(LoopData, quic_timer) == 48);
    assert!(offset_of!(LoopData, pre_cb) == 88);
    assert!(offset_of!(LoopData, iteration_nr) == 176);
    assert!(offset_of!(LoopData, jsc_vm) == 184);
    assert!(offset_of!(LoopData, tick_depth) == 192);

    assert!(offset_of!(UsLoop, data) == 0); // hazard 1
    assert!(offset_of!(UsLoop, pending_wakeups) == LOOP_DATA_SIZE);
    assert!(size_of::<Backend>() == 32);
    assert!(size_of::<UsLoop>() == US_LOOP_SIZE);
    assert!(align_of::<UsLoop>() == 16);

    assert!(size_of::<UsPoll>() == US_POLL_SIZE);
    assert!(offset_of!(UsPoll, fd) == 8);
    assert!(offset_of!(UsPoll, poll_type) == 16);

    assert!(size_of::<UsInternalCallback>() == US_CALLBACK_SIZE);
    assert!(offset_of!(UsInternalCallback, loop_) == 24); // hazard 3
    assert!(offset_of!(UsInternalCallback, cb) == 40);

    assert!(size_of::<TimerNative>() == 16);
    assert!(size_of::<AsyncNative>() == 16);
    assert!(size_of::<Timespec>() == 16);
};

// ───────────────────────────── allocation (CRT) ─────────────────────────────

// The `us_loop_t`/`us_poll_t`/callback blocks use the CRT allocator, matching
// the `us_malloc`/`us_calloc`/`us_free` macros the C backends use. Every
// block has exactly one named owner (documented per type above); this module
// both allocates and frees, so the pairing never crosses an allocator.
unsafe extern "C" {
    fn malloc(size: usize) -> *mut c_void;
    fn calloc(count: usize, size: usize) -> *mut c_void;
    fn free(ptr: *mut c_void);
}

/// OOM is a controlled crash (panic in `extern "C"` aborts), never a null
/// deref later — libuv.c/epoll_kqueue.c would AV instead.
fn oom() -> ! {
    panic!("bun_iocp usockets: out of memory");
}

// ───────────────────────────── shared-C imports ─────────────────────────────

// Provided by packages/bun-usockets/src/loop.c in the full bun build; the
// crate's own test binary provides behavior-faithful doubles in `c_shims`.
// `improper_ctypes`: the flagged pointees (`NativePoll` → `AfdPoll` →
// `HandleCore`, `Backend` → `Loop`) are backend-private and opaque to C —
// C only stores/passes the pointers; everything C dereferences is repr(C)
// and layout-asserted.
#[allow(improper_ctypes)]
unsafe extern "C" {
    fn us_internal_loop_data_init(
        loop_: *mut UsLoop,
        wakeup_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
        pre_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
        post_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    );
    fn us_internal_loop_data_free(loop_: *mut UsLoop);
    fn us_internal_loop_pre(loop_: *mut UsLoop);
    fn us_internal_loop_post(loop_: *mut UsLoop);
    fn us_loop_integrate(loop_: *mut UsLoop);
    fn us_internal_dispatch_ready_poll(p: *mut UsPoll, error: c_int, eof: c_int, events: c_int);
}

// ───────────────────────────── small helpers ─────────────────────────────

/// # Safety
/// `loop_` must point at a live `us_loop_t` created by [`us_create_loop`].
#[inline]
unsafe fn backend(loop_: *mut UsLoop) -> *mut Backend {
    // SAFETY: fn contract — `loop_` is live; field projection only.
    unsafe { &raw mut (*loop_).backend }
}

/// Native loop of a `us_loop_t` — the bridge consumers (signal/fs-event/
/// tty/process handles) use to reach the bun_iocp loop the VM runs.
///
/// # Safety
/// `loop_` must point at a live `us_loop_t` created by [`us_create_loop`].
#[inline]
pub unsafe fn native_loop(loop_: *mut core::ffi::c_void) -> *mut Loop {
    // SAFETY: caller contract — same liveness requirement as `native`.
    unsafe { native(loop_.cast()) }
}

/// # Safety
/// `loop_` must point at a live `us_loop_t` created by [`us_create_loop`].
#[inline]
unsafe fn native(loop_: *mut UsLoop) -> *mut Loop {
    // SAFETY: fn contract; `native` is set before `us_create_loop` returns
    // and is immutable afterwards (also read cross-thread by async_wakeup).
    unsafe { (*backend(loop_)).native }
}

/// Trailing [`TimerNative`] storage of a timer block (`icb + 1` is exactly
/// `US_CALLBACK_SIZE` bytes in, and the block's calloc alignment ≥ 8).
///
/// # Safety
/// `icb` must point at a block allocated by [`us_create_timer`].
#[inline]
unsafe fn timer_native(icb: *mut UsInternalCallback) -> *mut TimerNative {
    // SAFETY: fn contract — the block is `[callback][TimerNative][ext]`.
    unsafe { icb.add(1).cast::<TimerNative>() }
}

/// Trailing [`AsyncNative`] storage of an async block.
///
/// # Safety
/// `icb` must point at a block allocated by [`us_internal_create_async`].
#[inline]
unsafe fn async_native(icb: *mut UsInternalCallback) -> *mut AsyncNative {
    // SAFETY: fn contract — the block is `[callback][AsyncNative][ext]`.
    unsafe { icb.add(1).cast::<AsyncNative>() }
}

fn polling_bits(events: c_int) -> u8 {
    let mut bits = 0u8;
    if events & LIBUS_SOCKET_READABLE != 0 {
        bits |= POLL_TYPE_POLLING_IN;
    }
    if events & LIBUS_SOCKET_WRITABLE != 0 {
        bits |= POLL_TYPE_POLLING_OUT;
    }
    bits
}

/// Caller timeout → milliseconds for `Loop::tick`. Null = infinite. Rounded
/// UP so the wait can never end before the requested deadline (the tick's
/// own re-arm guarantees never-early — // quirk: LOOP-02); negatives clamp
/// to 0 (validate-at-boundary).
///
/// # Safety
/// `ts`, when non-null, must point at a readable [`Timespec`].
unsafe fn timeout_ms(ts: *const Timespec) -> Option<u64> {
    if ts.is_null() {
        return None;
    }
    // SAFETY: fn contract — non-null `ts` is readable.
    let (sec, nsec) = unsafe { ((*ts).sec, (*ts).nsec) };
    let sec = u64::try_from(sec).unwrap_or(0);
    let nsec = u64::try_from(nsec).unwrap_or(0);
    Some(
        sec.saturating_mul(1000)
            .saturating_add(nsec.div_ceil(1_000_000)),
    )
}

// ───────────────────────────── loop trampolines ─────────────────────────────

/// `Loop` pre hook → shared `us_internal_loop_pre` (DNS drain, low-prio,
/// `iteration_nr++` — exactly once per iteration, contract hazard 15).
unsafe fn pre_trampoline(_l: &mut Loop, ctx: *mut c_void) {
    // SAFETY: ctx was installed as the owning us_loop_t, which outlives its
    // native loop hooks (uninstalled in us_loop_free before teardown).
    unsafe { us_internal_loop_pre(ctx.cast::<UsLoop>()) };
}

/// `Loop` post hook: deliver pending async callbacks (the POSIX poller would
/// have dispatched them during the poll phase; post — after dispatch, before
/// closed-socket free — is the equivalent slot here), then shared
/// `us_internal_loop_post`.
unsafe fn post_trampoline(_l: &mut Loop, ctx: *mut c_void) {
    let loop_ = ctx.cast::<UsLoop>();
    // SAFETY: ctx is the live owning us_loop_t (see pre_trampoline).
    unsafe {
        fire_pending_asyncs(loop_);
        us_internal_loop_post(loop_);
    }
}

/// `Loop` before-wait hook — the GC-safepoint slot (B.4 step 7). Only fires
/// when the current bun tick's will-idle precheck passed, a safepoint
/// callback is installed, and `data.jsc_vm` is set; `Loop::tick` already
/// guarantees the tick is actually about to block.
unsafe fn before_wait_trampoline(_l: &mut Loop, ctx: *mut c_void) {
    let loop_ = ctx.cast::<UsLoop>();
    // SAFETY: ctx is the live owning us_loop_t (see pre_trampoline).
    unsafe {
        let b = backend(loop_);
        if !(*b).tick_will_idle {
            return;
        }
        let Some(f) = (*b).on_before_wait else {
            return;
        };
        let vm = (*loop_).data.jsc_vm;
        if vm.is_null() {
            return;
        }
        f(vm.cast_mut());
    }
}

/// Fire every async whose `fired` flag is set, at most one fire per async
/// per pass. Re-walks from the head after each callback because a callback
/// may close/create asyncs (re-entrancy, contract hazard 9); the pass bound
/// prevents a callback that re-wakes itself from livelocking the tick (the
/// posted wakeup packet makes the next tick prompt instead).
///
/// # Safety
/// `loop_` must be the live us_loop_t; runs on the loop thread only.
unsafe fn fire_pending_asyncs(loop_: *mut UsLoop) {
    // SAFETY: loop-thread-only walk of the intrusive list; every linked block
    // is live until us_internal_async_close unlinks it (same thread).
    unsafe {
        let mut budget: usize = 0;
        let mut cur = (*backend(loop_)).async_head;
        while !cur.is_null() {
            budget += 1;
            cur = (*async_native(cur)).next;
        }
        while budget > 0 {
            budget -= 1;
            let mut cur = (*backend(loop_)).async_head;
            let mut found: Option<unsafe extern "C" fn(*mut UsInternalCallback)> = None;
            while !cur.is_null() {
                if let Some(f) = (*cur).cb
                    && (*async_native(cur)).fired.swap(false, Ordering::Acquire)
                {
                    found = Some(f);
                    break;
                }
                cur = (*async_native(cur)).next;
            }
            let Some(f) = found else {
                break;
            };
            // The wakeup async callback receives the LOOP, not the async —
            // contract hazard 4 (libuv.c:60-64, loop.c:79).
            f(loop_.cast::<UsInternalCallback>());
        }
    }
}

// ───────────────────────────── loop surface ─────────────────────────────

/// `hint` = existing native `bun_iocp::Loop` to borrow (the VM's loop), or
/// NULL to own a fresh one. Returns NULL on native-loop creation failure.
///
/// # Safety
/// C ABI. `hint`, when non-null, must be a pinned `*mut bun_iocp::Loop` that
/// outlives the returned loop; the surface owns the native hook slots from
/// here on (the embedder must not install its own).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_loop(
    hint: *mut c_void,
    wakeup_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    pre_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    post_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    ext_size: c_uint,
) -> *mut UsLoop {
    // SAFETY: fresh calloc'd block sized us_loop_t + ext (hazard 1: callers
    // place ext at loop+1, so the allocation size is ABI); blob fields are
    // written before us_internal_loop_data_init can call back into exports
    // that read them.
    unsafe {
        let loop_ = calloc(1, US_LOOP_SIZE + ext_size as usize).cast::<UsLoop>();
        if loop_.is_null() {
            oom();
        }
        let nl: *mut Loop = if hint.is_null() {
            match Loop::new() {
                Ok(boxed) => Box::into_raw(boxed),
                Err(_) => {
                    free(loop_.cast::<c_void>());
                    return ptr::null_mut();
                }
            }
        } else {
            hint.cast::<Loop>()
        };
        let b = backend(loop_);
        (*b).native = nl;
        (*b).is_default = c_int::from(!hint.is_null()); // hazard 13: = borrowed
        (*nl).set_pre_hook(Some((pre_trampoline, loop_.cast::<c_void>())));
        (*nl).set_post_hook(Some((post_trampoline, loop_.cast::<c_void>())));
        (*nl).set_before_wait_hook(Some((before_wait_trampoline, loop_.cast::<c_void>())));
        // Calls back into us_create_timer + us_internal_create_async/set.
        us_internal_loop_data_init(loop_, wakeup_cb, pre_cb, post_cb);
        if !hint.is_null() {
            us_loop_integrate(loop_);
        }
        loop_
    }
}

/// # Safety
/// C ABI. `loop_` must be live and quiescent (no live polls/timers/asyncs
/// beyond the loop-data ones; cross-thread wakeups must have ceased).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_free(loop_: *mut UsLoop) {
    // SAFETY: fn contract; teardown order mirrors libuv.c — hooks off first
    // (libuv closes uv_pre/uv_check before the final turn, so pre/post do not
    // run during teardown), then loop-data teardown (closes sweep timer, quic
    // timer, wakeup async — all freed synchronously here), then one no-wait
    // turn so deferred poll close-frees (endgames) execute, then destroy.
    unsafe {
        let nl = native(loop_);
        (*nl).set_pre_hook(None);
        (*nl).set_post_hook(None);
        (*nl).set_before_wait_hook(None);
        us_internal_loop_data_free(loop_);
        if (*backend(loop_)).is_default == 0 {
            // Closing handles complete asynchronously (CancelIoEx posts the
            // cancellation later; one GQCSEx dequeues at most a batch; a
            // slow-path poll worker may be parked in select()). Drain with a
            // bounded number of short waits; if work is STILL live, leak the
            // loop instead of freeing it — libuv's uv_loop_close reported
            // EBUSY here and the embedder leaked, and a leak is strictly
            // better than freeing state in-flight kernel completions still
            // reference (the port must outlive any worker that may post).
            let mut drains: u32 = 16;
            while (*nl).alive() && drains > 0 {
                (*nl).tick(Some(1));
                drains -= 1;
            }
            if (*nl).alive() {
                return;
            }
            (*nl).tick(Some(0));
            // Owned native loop: created by us_create_loop, destroyed exactly
            // here. Borrowed (is_default) loops belong to the embedder.
            drop(Box::from_raw(nl));
        }
        free(loop_.cast::<c_void>());
    }
}

/// One BLOCKING iteration (libuv `uv_run(UV_RUN_ONCE)` semantics: returns
/// immediately, without callbacks, when nothing is alive).
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run(loop_: *mut UsLoop) {
    // SAFETY: fn contract.
    unsafe {
        let nl = native(loop_);
        if !(*nl).alive() {
            return;
        }
        // hazard 6: bracket every iteration, like the POSIX backend.
        (*loop_).data.tick_depth += 1;
        (*nl).tick(None);
        (*loop_).data.tick_depth -= 1;
    }
}

/// One non-blocking turn. No C declaration — Rust-extern only; the symbol
/// name is ABI (contract hazard 17).
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_pump(loop_: *mut UsLoop) {
    // SAFETY: fn contract.
    unsafe {
        let nl = native(loop_);
        // No ref gate here (same class as the bun-tick gate): ref state must
        // not stop completion collection — an unref'd child's posted exit
        // packet still needs dequeuing, and this pump never idles anyway
        // (zero timeout). // quirk: PROC-45
        (*loop_).data.tick_depth += 1;
        (*nl).tick(Some(0));
        (*loop_).data.tick_depth -= 1;
    }
}

/// One loop iteration honoring `timeout` (NULL = block until work, `{0,0}` =
/// non-blocking) — epoll_kqueue.c:352-415 reproduced on `Loop::tick`.
///
/// Deviations from the POSIX sequence (both benign, both deliberate):
/// - The QUIC deadline is folded at entry rather than after `pre`; the value
///   is produced by the previous tick's post/`drainMicrotasks` (loop_data.h
///   documents getTimeout as the intended reader) and the JS thread already
///   folds it before calling here.
/// - `pending_wakeups` is exchanged before `pre` instead of after; a wakeup
///   arriving during `pre` still ends the upcoming wait via its posted
///   packet — the exchange only gates the GC safepoint.
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only. Re-entrant (a dispatch
/// callback may call back in — contract hazards 6 and 9).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run_bun_tick(loop_: *mut UsLoop, timeout: *const Timespec) {
    // SAFETY: fn contract; all loop borrows are short-lived raw derefs so a
    // nested tick from a callback re-derives rather than aliasing.
    unsafe {
        let nl = native(loop_);
        // B.4 step 1 — POSIX parity is a num_polls gate (registered event
        // sources), NOT a ref gate: a loop with only unref'd work (e.g. an
        // unref'd child whose exit packet is already posted) must still
        // dequeue ready completions or the packet rots in the port. When
        // nothing holds a ref we collect with ZERO timeout — never idle on
        // unref'd work, exactly libuv's uv_run(NOWAIT) shape.
        // // quirk: PROC-45
        if !(*nl).alive() {
            (*loop_).data.tick_depth += 1;
            (*nl).tick(Some(0));
            (*loop_).data.tick_depth -= 1;
            return;
        }
        // B.4 step 2 / hazard 6: nesting depth for the closed-socket-free
        // guard in shared us_internal_loop_post.
        (*loop_).data.tick_depth += 1;
        // B.4 step 3 (vestigial integrate-once check, kqueue shape).
        let sweep = (*loop_).data.sweep_timer;
        if !sweep.is_null() && (*sweep).cb.is_none() {
            us_loop_integrate(loop_);
        }
        // B.4 step 5: fold the QUIC deadline into the wait.
        let mut wait = timeout_ms(timeout);
        if !(*loop_).data.quic_head.is_null() && (*loop_).data.quic_next_tick_us >= 0 {
            let quic_ms = u64::try_from((*loop_).data.quic_next_tick_us)
                .unwrap_or(0)
                .div_ceil(1000);
            wait = Some(wait.map_or(quic_ms, |t| t.min(quic_ms)));
        }
        // B.4 step 6: consume wakeups; decide whether this tick may idle.
        let had_wakeups = (*loop_).pending_wakeups.swap(0, Ordering::Acquire);
        (*backend(loop_)).tick_will_idle = had_wakeups == 0 && wait != Some(0);
        // Steps 4 + 7..10 happen inside the tick: pre hook → before-wait
        // hook (GC safepoint) → wait → dispatch → timers → post hook →
        // endgames. Saturation re-polling is per-tick batched (libuv parity)
        // rather than POSIX's 48-round drain — queued completions survive in
        // the port and the next tick collects them immediately.
        (*nl).tick(wait);
        (*backend(loop_)).tick_will_idle = false;
        (*loop_).data.tick_depth -= 1;
    }
}

/// Install the GC-safepoint callback invoked with `data.jsc_vm` when a bun
/// tick is about to idle — `Bun__JSC_onBeforeWait`'s slot. A setter (rather
/// than a direct extern) keeps this crate's test binary linkable; the rewire
/// calls this once per VM loop after setting `data.jsc_vm`.
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_set_on_before_wait(
    loop_: *mut UsLoop,
    cb: Option<unsafe extern "C" fn(*mut c_void)>,
) {
    // SAFETY: fn contract.
    unsafe { (*backend(loop_)).on_before_wait = cb };
}

// ───────────────────────────── ref API ─────────────────────────────
// The real keep-alive API replacing the `loop->uv_loop->active_handles`
// pokes (context.c:623/716, socket.c:221/237) and the Rust-side mirrors —
// contract hazard 7: one coherent refcount.

/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_add_active(loop_: *mut UsLoop, count: c_uint) {
    // SAFETY: fn contract.
    unsafe {
        let nl = native(loop_);
        for _ in 0..count {
            (*nl).add_active();
        }
    }
}

/// # Safety
/// C ABI. `loop_` must be live; loop thread only; `count` must not exceed
/// the units previously added.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_sub_active(loop_: *mut UsLoop, count: c_uint) {
    // SAFETY: fn contract.
    unsafe {
        let nl = native(loop_);
        for _ in 0..count {
            (*nl).sub_active();
        }
    }
}

/// The coherent refcount, read as `numPolls` by getActiveTasks diagnostics.
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_active_count(loop_: *mut UsLoop) -> c_uint {
    // SAFETY: fn contract.
    unsafe { (*native(loop_)).active_handles() }
}

// ───────────────────────────── poll surface ─────────────────────────────

/// [`AfdPoll`] event trampoline. `data` is the stable [`NativePoll`];
/// `native.data` is read at dispatch time so resize reroutes in-flight
/// completions (hazard 2). Events are masked to the subscription at dispatch
/// time and errors dispatch even when the mask is empty (hazard 8); `eof` is
/// always 0 on Windows — EOF is discovered by `recv() == 0` in shared loop.c.
unsafe fn poll_event(_l: &mut Loop, data: *mut c_void, events: u8, error: Win32Error) {
    let np = data.cast::<NativePoll>();
    // SAFETY: `np` is the live NativePoll (freed only after AfdPoll's close
    // callback, which cannot race a delivery — same thread, and AfdPoll
    // swallows deliveries once closing).
    unsafe {
        let p = (*np).data;
        if p.is_null() {
            // Stopped: the poll is conceptually gone for shared C.
            return;
        }
        if error != Win32Error::SUCCESS {
            // Error is a normalized boolean (epoll_kqueue.c:209 rationale);
            // the real code is fetched via us_socket_get_error by loop.c.
            us_internal_dispatch_ready_poll(p, 1, 0, 0);
            return;
        }
        let ev = c_int::from(events) & us_poll_events(p);
        if ev != 0 {
            us_internal_dispatch_ready_poll(p, 0, 0, ev);
        }
    }
}

/// [`AfdPoll`] close trampoline (runs from the endgame drain at the end of
/// the same tick — hazard 2's "loop_post frees closed sockets the SAME
/// tick"). Frees the AfdPoll always; frees the `us_poll_t` block and the
/// NativePoll only when `us_poll_free` already ran (repointed `data`) —
/// otherwise the NativePoll stays (with `afd` nulled) so a later
/// `us_poll_free` takes the synchronous free mode.
unsafe fn poll_closed(_l: &mut Loop, data: *mut c_void) {
    let np = data.cast::<NativePoll>();
    // SAFETY: `np` is the live NativePoll; the AfdPoll has fully drained
    // (close-callback contract — // quirk: POLL-35) so its box is releasable.
    unsafe {
        let afd = core::mem::replace(&mut (*np).afd, ptr::null_mut());
        debug_assert!(!afd.is_null());
        drop(Box::from_raw(afd));
        let p = (*np).data;
        if !p.is_null() {
            free(p.cast::<c_void>());
            drop(Box::from_raw(np));
        }
    }
}

/// Allocates the poll block (+ ext, uninitialized like both C backends) and
/// its heap-split native handle. Does NOT register anything.
///
/// # Safety
/// C ABI. `loop_` (unused, libuv parity) must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_poll(
    _loop: *mut UsLoop,
    _fallthrough: c_int,
    ext_size: c_uint,
) -> *mut UsPoll {
    // SAFETY: fresh malloc'd block; only the header fields are written (ext
    // stays uninitialized — callers placement-init it, as with libuv/epoll).
    unsafe {
        let p = malloc(US_POLL_SIZE + ext_size as usize).cast::<UsPoll>();
        if p.is_null() {
            oom();
        }
        (*p).backend_handle = Box::into_raw(Box::new(NativePoll {
            data: p,
            afd: ptr::null_mut(),
            closing: false,
        }));
        (*p).fd = 0;
        (*p).poll_type = 0;
        p
    }
}

/// # Safety
/// C ABI. `p` must be a live poll from [`us_create_poll`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_init(p: *mut UsPoll, fd: SOCKET, poll_type: c_int) {
    // SAFETY: fn contract.
    unsafe {
        (*p).fd = fd;
        (*p).poll_type = poll_type as u8;
    }
}

/// Registers the watcher (creating it on first start) and arms `events`.
/// Returns 0 on success or the raw nonzero Win32 code on watcher-creation
/// failure (also stored via `WSASetLastError` so `LIBUS_ERR` reads it) —
/// contract hazard 10: this stops lying; the failed poll is freeable via the
/// never-started mode of [`us_poll_free`].
///
/// # Safety
/// C ABI. `p` live + initialized; `loop_` live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start_rc(
    p: *mut UsPoll,
    loop_: *mut UsLoop,
    events: c_int,
) -> c_int {
    // SAFETY: fn contract; NativePoll/AfdPoll are loop-thread-owned.
    unsafe {
        let np = (*p).backend_handle;
        if np.is_null() {
            return 0; // resized away — libuv `!p->uv_p` parity
        }
        (*p).poll_type = ((*p).poll_type & !POLL_TYPE_POLLING_MASK) | polling_bits(events);
        if (*np).closing {
            debug_assert!(false, "us_poll_start on a stopped poll");
            return 0;
        }
        if (*np).afd.is_null() {
            match AfdPoll::init(native(loop_), (*p).fd) {
                Ok(mut watcher) => {
                    // uSockets polls never hold the loop open (hazard 7);
                    // close still does, until the close callback.
                    watcher.unref();
                    (*np).afd = Box::into_raw(watcher);
                }
                Err(err) => {
                    WSASetLastError(c_int::from(err.0));
                    // Consumers (context.c listen/connect) read CRT errno;
                    // values are SystemErrno (Linux-numbered) — the space the
                    // Rust error path interprets. Inline per SOCK-58.
                    let crt_errno: c_int = match err.0 {
                        10038 /* WSAENOTSOCK */ => 88,   // ENOTSOCK
                        10022 /* WSAEINVAL */ => 22,     // EINVAL
                        8 /* NOT_ENOUGH_MEMORY */ | 14 /* OUTOFMEMORY */ => 12, // ENOMEM
                        6 /* INVALID_HANDLE */ => 9,     // EBADF
                        _ => 22,                         // EINVAL
                    };
                    unsafe extern "C" {
                        fn _errno() -> *mut c_int;
                    }
                    // MSVCRT thread-local errno slot (enclosing unsafe fn).
                    *_errno() = crt_errno;
                    return c_int::from(err.0);
                }
            }
        }
        (*(*np).afd).set((events & 0b11) as u8, poll_event, np.cast::<c_void>());
        0
    }
}

/// # Safety
/// C ABI. Same contract as [`us_poll_start_rc`] (failures swallowed,
/// libuv-shaped).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start(p: *mut UsPoll, loop_: *mut UsLoop, events: c_int) {
    // SAFETY: fn contract.
    unsafe {
        us_poll_start_rc(p, loop_, events);
    }
}

/// Re-arm with a new event mask; no-op when unchanged or never started.
///
/// # Safety
/// C ABI. `p` live; `loop_` live; loop thread only. Safe to call from inside
/// a poll callback (// quirk: POLL-27).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_change(p: *mut UsPoll, loop_: *mut UsLoop, events: c_int) {
    let _ = loop_;
    // SAFETY: fn contract.
    unsafe {
        let np = (*p).backend_handle;
        if np.is_null() || (*np).afd.is_null() || (*np).closing {
            return;
        }
        if us_poll_events(p) != events {
            (*p).poll_type = ((*p).poll_type & !POLL_TYPE_POLLING_MASK) | polling_bits(events);
            (*(*np).afd).set((events & 0b11) as u8, poll_event, np.cast::<c_void>());
        }
    }
}

/// Deregister: detaches the poll (`native.data = 0`) and begins the deferred
/// close of the watcher. The fd is safe to close immediately afterwards
/// (every shared-C caller does — AfdPoll::close kicks the in-flight IRPs;
/// // quirk: POLL-32/POLL-36). Stop is terminal: shared C never restarts a
/// stopped poll (verified against every us_poll_stop site).
///
/// # Safety
/// C ABI. `p` live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_stop(p: *mut UsPoll, loop_: *mut UsLoop) {
    let _ = loop_;
    // SAFETY: fn contract.
    unsafe {
        let np = (*p).backend_handle;
        if np.is_null() {
            return;
        }
        if !(*np).afd.is_null() && !(*np).closing {
            (*np).data = ptr::null_mut();
            (*np).closing = true;
            (*(*np).afd).close(Some(poll_closed as PollCloseCb));
        }
    }
}

/// Three free modes (libuv-shaped, contract section b), every started mode
/// routed through the close callback so no in-flight completion can dangle:
/// - resized away (`backend_handle == NULL`): free the block only.
/// - never started / start failed / already drained (`afd == NULL`): free
///   block + native handle synchronously (fixes libuv.c's uninitialized
///   `uv_is_closing` read on never-started polls).
/// - started: repoint `native.data` so the close callback frees both; if no
///   stop preceded, issue the close here.
///
/// # Safety
/// C ABI. `p` live and owned by the caller; loop thread only. The block is
/// freed (possibly deferred to the end of the current tick) — no further use.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_free(p: *mut UsPoll, loop_: *mut UsLoop) {
    let _ = loop_;
    // SAFETY: fn contract.
    unsafe {
        let np = (*p).backend_handle;
        if np.is_null() {
            free(p.cast::<c_void>());
            return;
        }
        if (*np).afd.is_null() {
            drop(Box::from_raw(np));
            free(p.cast::<c_void>());
            return;
        }
        (*np).data = p;
        if !(*np).closing {
            (*np).closing = true;
            (*(*np).afd).close(Some(poll_closed as PollCloseCb));
        }
    }
}

/// Grow-only block move (only caller: context.c adopt). The new block takes
/// the native handle; in-flight events route to it from the next dispatch
/// (hazard 2); the old block is freed separately by the caller via
/// [`us_poll_free`] (resized-away mode).
///
/// # Safety
/// C ABI. `p` live; sizes must describe its actual allocation; loop thread
/// only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_resize(
    p: *mut UsPoll,
    loop_: *mut UsLoop,
    old_ext_size: c_uint,
    ext_size: c_uint,
) -> *mut UsPoll {
    let _ = loop_;
    // SAFETY: fn contract; the copy covers exactly the old allocation.
    unsafe {
        let np = (*p).backend_handle;
        if np.is_null() {
            return p; // does not own the native handle — libuv parity
        }
        let old_size = US_POLL_SIZE + old_ext_size as usize;
        let new_size = US_POLL_SIZE + ext_size as usize;
        if new_size <= old_size {
            return p;
        }
        let new_p = calloc(1, new_size).cast::<UsPoll>();
        if new_p.is_null() {
            oom();
        }
        ptr::copy_nonoverlapping(p.cast::<u8>(), new_p.cast::<u8>(), old_size);
        (*np).data = new_p;
        (*p).backend_handle = ptr::null_mut();
        new_p
    }
}

/// # Safety
/// C ABI. `p` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_events(p: *mut UsPoll) -> c_int {
    // SAFETY: fn contract.
    unsafe {
        let t = (*p).poll_type;
        (if t & POLL_TYPE_POLLING_IN != 0 {
            LIBUS_SOCKET_READABLE
        } else {
            0
        }) | (if t & POLL_TYPE_POLLING_OUT != 0 {
            LIBUS_SOCKET_WRITABLE
        } else {
            0
        })
    }
}

/// # Safety
/// C ABI. `p` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_fd(p: *mut UsPoll) -> SOCKET {
    // SAFETY: fn contract.
    unsafe { (*p).fd }
}

/// # Safety
/// C ABI. `p` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_type(p: *mut UsPoll) -> c_int {
    // SAFETY: fn contract.
    unsafe { c_int::from((*p).poll_type & POLL_TYPE_KIND_MASK) }
}

/// Preserves the POLLING bits (read-modify-write, like both C backends).
///
/// # Safety
/// C ABI. `p` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_set_type(p: *mut UsPoll, poll_type: c_int) {
    // SAFETY: fn contract.
    unsafe {
        (*p).poll_type = (poll_type as u8) | ((*p).poll_type & POLL_TYPE_POLLING_MASK);
    }
}

/// Ext storage of a poll block (`p + 1`). Zero callers on the Windows TU set
/// today; exported so the POSIX-shared declaration keeps resolving.
///
/// # Safety
/// C ABI. `p` must be live and allocated with a non-zero ext size.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_ext(p: *mut UsPoll) -> *mut c_void {
    // SAFETY: fn contract — ext begins right past the header.
    unsafe { p.add(1).cast::<c_void>() }
}

/// Callback-poll accept hook: nothing to drain on Windows (timers/asyncs do
/// not route through the poller) — libuv.c parity, returns 0.
///
/// # Safety
/// C ABI. `p` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_accept_poll_event(p: *mut UsPoll) -> usize {
    let _ = p;
    0
}

// ───────────────────────────── timer surface ─────────────────────────────

/// Timer-fire trampoline: the user callback receives THE TIMER (contract
/// hazard 4), which is the callback block itself.
unsafe fn timer_fired(_l: &mut Loop, data: *mut c_void) {
    let icb = data.cast::<UsInternalCallback>();
    // SAFETY: the block is live while its bun_iocp timer slot is armed
    // (us_timer_close releases the slot before freeing).
    unsafe {
        if let Some(f) = (*icb).cb {
            f(icb);
        }
    }
}

/// Single block `[callback][TimerNative][ext]`. A non-fallthrough timer is
/// the only us-object that keeps the loop alive (contract hazard 7).
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_timer(
    loop_: *mut UsLoop,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut UsInternalCallback {
    // SAFETY: fresh calloc'd block; TimerNative is written before use
    // (calloc zero is NOT a valid Timer — its empty slot is usize::MAX).
    unsafe {
        let block = calloc(
            1,
            US_CALLBACK_SIZE + size_of::<TimerNative>() + ext_size as usize,
        )
        .cast::<UsInternalCallback>();
        if block.is_null() {
            oom();
        }
        (*block).loop_ = loop_;
        timer_native(block).write(TimerNative {
            timer: Timer::new(),
            non_fallthrough: fallthrough == 0,
        });
        if fallthrough == 0 {
            (*native(loop_)).add_active();
        }
        block
    }
}

/// Ext storage skips the callback header and the backend's native storage
/// (libuv.c:272-275 shape, backend-sized).
///
/// # Safety
/// C ABI. `t` must be a live timer from [`us_create_timer`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_ext(t: *mut UsInternalCallback) -> *mut c_void {
    // SAFETY: fn contract — block layout `[callback][TimerNative][ext]`.
    unsafe {
        t.cast::<u8>()
            .add(US_CALLBACK_SIZE + size_of::<TimerNative>())
            .cast::<c_void>()
    }
}

/// Arm (`ms > 0`, then every `repeat_ms`) or stop (`ms == 0`); re-arming
/// replaces the deadline (QUIC re-arms constantly — contract hazard 16).
///
/// Contract hazard 5, fixed to POSIX semantics: there is NO sweep-timer
/// early-return — disable (`ms == 0`) really disarms and a later re-enable
/// really re-arms. The `has_added_timer_to_event_loop` flag write is kept
/// for layout/debug parity (written-never-read).
///
/// # Safety
/// C ABI. `t` live; loop thread only. `cb`'s real C signature is
/// `void (*)(us_timer_t*)` — same ABI as the stored unary-pointer type
/// (contract hazard 14).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_set(
    t: *mut UsInternalCallback,
    cb: Option<unsafe extern "C" fn(*mut UsInternalCallback)>,
    ms: c_int,
    repeat_ms: c_int,
) {
    // SAFETY: fn contract.
    unsafe {
        let loop_ = (*t).loop_;
        if ptr::eq((*loop_).data.sweep_timer, t) && (*t).has_added_timer_to_event_loop == 0 {
            (*t).has_added_timer_to_event_loop = 1;
        }
        (*t).cb = cb;
        let tn = timer_native(t);
        let nl = native(loop_);
        if ms <= 0 {
            (*nl).timer_stop(&mut (*tn).timer);
        } else {
            (*nl).timer_start(
                &mut (*tn).timer,
                timer_fired,
                t.cast::<c_void>(),
                ms as u64,
                repeat_ms.max(0) as u64,
            );
        }
    }
}

/// Frees the whole block synchronously (POSIX semantics; safe with the
/// crate's tombstoning timers even from inside the timer's own callback —
/// the loop holds no pointer into the block once the slot is released).
/// The `fallthrough` parameter is ignored (libuv parity; the create-time
/// value decides the keep-alive release).
///
/// # Safety
/// C ABI. `t` live; loop thread only; no further use of `t`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_close(t: *mut UsInternalCallback, fallthrough: c_int) {
    let _ = fallthrough;
    // SAFETY: fn contract.
    unsafe {
        let nl = native((*t).loop_);
        let tn = timer_native(t);
        (*nl).timer_release(&mut (*tn).timer);
        if (*tn).non_fallthrough {
            (*nl).sub_active();
        }
        free(t.cast::<c_void>());
    }
}

/// # Safety
/// C ABI. `t` must be a live timer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_timer_loop(t: *mut UsInternalCallback) -> *mut UsLoop {
    // SAFETY: fn contract — reads the hard-ABI `loop` field (hazard 3).
    unsafe { (*t).loop_ }
}

// ───────────────────────────── async surface ─────────────────────────────

/// Single block `[callback][AsyncNative][ext]`; not registered until
/// [`us_internal_async_set`]. The wakeup async never holds the loop open.
///
/// # Safety
/// C ABI. `loop_` must be live; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_create_async(
    loop_: *mut UsLoop,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut UsInternalCallback {
    // SAFETY: fresh calloc'd block; AsyncNative written before use.
    unsafe {
        let block = calloc(
            1,
            US_CALLBACK_SIZE + size_of::<AsyncNative>() + ext_size as usize,
        )
        .cast::<UsInternalCallback>();
        if block.is_null() {
            oom();
        }
        (*block).loop_ = loop_;
        (*block).cb_expects_the_loop = 1; // parity; written-never-read (hazard 4)
        async_native(block).write(AsyncNative {
            next: ptr::null_mut(),
            fired: AtomicBool::new(false),
            non_fallthrough: fallthrough == 0,
        });
        if fallthrough == 0 {
            (*native(loop_)).add_active();
        }
        block
    }
}

/// Registers the callback (delivered with THE LOOP as its argument —
/// contract hazard 4) and links the async into the loop's delivery list.
///
/// # Safety
/// C ABI. `a` live and not yet registered; loop thread only.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_set(
    a: *mut UsInternalCallback,
    cb: Option<unsafe extern "C" fn(*mut UsInternalCallback)>,
) {
    // SAFETY: fn contract; list mutation is loop-thread-only.
    unsafe {
        let b = backend((*a).loop_);
        debug_assert!(
            (*async_native(a)).next.is_null() && !ptr::eq((*b).async_head, a),
            "async registered twice"
        );
        (*a).cb = cb;
        (*async_native(a)).next = (*b).async_head;
        (*b).async_head = a;
    }
}

/// Unlinks and frees the block synchronously (POSIX semantics; libuv
/// defers). Any not-yet-delivered fired flag dies with the block; the
/// stray wakeup packet, if one is in flight, is a harmless null-effect
/// dequeue (// quirk: LOOP-32 is about the packet memory, which lives in
/// the native loop, not here).
///
/// # Safety
/// C ABI. `a` live; loop thread only; cross-thread wakeups for `a` must
/// have ceased; no further use of `a`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_close(a: *mut UsInternalCallback) {
    // SAFETY: fn contract.
    unsafe {
        let b = backend((*a).loop_);
        let mut link: *mut *mut UsInternalCallback = &raw mut (*b).async_head;
        while !(*link).is_null() {
            if ptr::eq(*link, a) {
                *link = (*async_native(a)).next;
                break;
            }
            link = &raw mut (*async_native(*link)).next;
        }
        let an = async_native(a);
        if (*an).non_fallthrough {
            (*native((*a).loop_)).sub_active();
        }
        free(a.cast::<c_void>());
    }
}

/// THREAD-SAFE — the only cross-thread entry point (contract section b).
/// Marks the async fired and wakes the loop; delivery happens from the post
/// trampoline of the next iteration. Reads only create-time-immutable fields
/// (`a->loop`, `backend.native`) plus atomics.
///
/// # Safety
/// C ABI. `a` and its loop must be live (the embedder's teardown ordering
/// guarantees no wakeup races `us_internal_async_close`/`us_loop_free`).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_wakeup(a: *mut UsInternalCallback) {
    // SAFETY: fn contract.
    unsafe {
        (*async_native(a)).fired.store(true, Ordering::Release);
        Loop::wake(native((*a).loop_));
    }
}

// ───────────────────────────── socket error ─────────────────────────────

/// `getsockopt(SO_ERROR)` for the dispatch error paths. Deviation from
/// libuv.c (which returns stale CRT `errno` when getsockopt itself fails):
/// the WSA error is returned instead — the Windows-correct channel
/// (`LIBUS_ERR` is `WSAGetLastError()`). // quirk: SOCK-58
///
/// # Safety
/// C ABI. `s` must be a live `us_socket_t` (its poll embeds at offset 0).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_error(s: *mut c_void) -> c_int {
    // SAFETY: fn contract — us_socket_t.p at offset 0 (internal.h:249).
    unsafe {
        let fd = (*s.cast::<UsPoll>()).fd;
        let mut error: c_int = 0;
        let mut len = size_of::<c_int>() as c_int;
        if getsockopt(
            fd,
            SOL_SOCKET,
            SO_ERROR,
            (&raw mut error).cast::<u8>(),
            &raw mut len,
        ) != 0
        {
            return WSAGetLastError();
        }
        error
    }
}

// ───────────────────────────── test doubles ─────────────────────────────

/// Behavior-faithful doubles of the shared-C (loop.c) functions the surface
/// calls, so the crate's natively-linkable test binary links and the C-ABI
/// surface is exercisable end-to-end. Real builds link the C originals;
/// these exist only in `cargo test -p bun_iocp`.
#[cfg(test)]
pub(crate) mod c_shims {
    use std::cell::RefCell;

    use super::*;

    thread_local! {
        /// Every `us_internal_dispatch_ready_poll` as `(poll, error, eof, events)`.
        pub(crate) static DISPATCHED: RefCell<Vec<(usize, c_int, c_int, c_int)>> =
            const { RefCell::new(Vec::new()) };
        /// Optional action run on each dispatch (after recording).
        #[expect(clippy::type_complexity)]
        pub(crate) static DISPATCH_HOOK: RefCell<Option<Box<dyn FnMut(*mut UsPoll, c_int, c_int, c_int)>>> =
            const { RefCell::new(None) };
        /// `data.tick_depth` observed at each post callback.
        pub(crate) static POST_DEPTHS: RefCell<Vec<c_int>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn reset() {
        DISPATCHED.with_borrow_mut(Vec::clear);
        DISPATCH_HOOK.with_borrow_mut(|h| *h = None);
        POST_DEPTHS.with_borrow_mut(Vec::clear);
    }

    /// loop.c:69-85 — stores the hooks, creates the two fallthrough handles
    /// (calling BACK into the exports under test). recv/send bufs are left
    /// null; the free shim tolerates that.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_internal_loop_data_init(
        loop_: *mut UsLoop,
        wakeup_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
        pre_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
        post_cb: Option<unsafe extern "C" fn(*mut UsLoop)>,
    ) {
        // SAFETY: mirrors loop.c with a live calloc'd loop.
        unsafe {
            (*loop_).data.sweep_timer = us_create_timer(loop_, 1, 0);
            (*loop_).data.sweep_timer_count = 0;
            (*loop_).data.pre_cb = pre_cb;
            (*loop_).data.post_cb = post_cb;
            (*loop_).data.wakeup_async = us_internal_create_async(loop_, 1, 0);
            // loop.c:79 casts the loop-taking wakeup_cb to the async cb type.
            let cast: Option<unsafe extern "C" fn(*mut UsInternalCallback)> =
                core::mem::transmute::<
                    Option<unsafe extern "C" fn(*mut UsLoop)>,
                    Option<unsafe extern "C" fn(*mut UsInternalCallback)>,
                >(wakeup_cb);
            us_internal_async_set((*loop_).data.wakeup_async, cast);
        }
    }

    /// loop.c:87-98.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_internal_loop_data_free(loop_: *mut UsLoop) {
        // SAFETY: mirrors loop.c; sweep timer / wakeup async were created by
        // the init shim above.
        unsafe {
            us_timer_close((*loop_).data.sweep_timer, 0);
            us_internal_async_close((*loop_).data.wakeup_async);
        }
    }

    /// loop.c:334-345 — `iteration_nr++` then the embedder's pre callback.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_internal_loop_pre(loop_: *mut UsLoop) {
        // SAFETY: live loop per surface contract.
        unsafe {
            (*loop_).data.iteration_nr += 1;
            if let Some(f) = (*loop_).data.pre_cb {
                f(loop_);
            }
        }
    }

    /// loop.c:347-361 — records tick_depth (the hazard-6 observable; the
    /// real function frees closed sockets only when `tick_depth <= 1`).
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_internal_loop_post(loop_: *mut UsLoop) {
        // SAFETY: live loop per surface contract.
        unsafe {
            POST_DEPTHS.with_borrow_mut(|v| v.push((*loop_).data.tick_depth));
            if let Some(f) = (*loop_).data.post_cb {
                f(loop_);
            }
        }
    }

    /// loop.c:858-860 — no-op.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_loop_integrate(_loop: *mut UsLoop) {}

    /// loop.c:369-855 — the test double records and forwards to the
    /// installed hook (which may re-enter the surface, like the real
    /// dispatcher's socket handlers do).
    #[unsafe(no_mangle)]
    unsafe extern "C" fn us_internal_dispatch_ready_poll(
        p: *mut UsPoll,
        error: c_int,
        eof: c_int,
        events: c_int,
    ) {
        DISPATCHED.with_borrow_mut(|v| v.push((p.addr(), error, eof, events)));
        let hook = DISPATCH_HOOK.with_borrow_mut(Option::take);
        if let Some(mut hook) = hook {
            hook(p, error, eof, events);
            DISPATCH_HOOK.with_borrow_mut(|h| {
                if h.is_none() {
                    *h = Some(hook);
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::time::Instant;

    use bun_windows_sys::ws2_32::{
        AF_INET, INVALID_SOCKET, IPPROTO_TCP, SOCK_STREAM, WSA_FLAG_NO_HANDLE_INHERIT,
        WSA_FLAG_OVERLAPPED, WSADATA, WSASocketW, WSAStartup, accept, bind, closesocket, connect,
        getsockname, in_addr, listen, send, sockaddr_in,
    };

    use super::c_shims::{DISPATCH_HOOK, DISPATCHED, POST_DEPTHS, reset};
    use super::*;
    use crate::test_sync::serial;

    thread_local! {
        /// Wakeup-cb arguments (must be the LOOP — hazard 4).
        static WAKEUPS: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
        /// Timer-cb arguments (must be the TIMER — hazard 4).
        static TIMER_ARGS: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
        /// before-wait (GC safepoint) arguments.
        static BEFORE_WAITS: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
        /// The loop under test, for callbacks that re-enter the surface.
        static TEST_LOOP: RefCell<usize> = const { RefCell::new(0) };
    }

    unsafe extern "C" fn record_wakeup(loop_: *mut UsLoop) {
        WAKEUPS.with_borrow_mut(|v| v.push(loop_.addr()));
    }
    unsafe extern "C" fn noop_loop_cb(_loop: *mut UsLoop) {}
    unsafe extern "C" fn record_timer(t: *mut UsInternalCallback) {
        TIMER_ARGS.with_borrow_mut(|v| v.push(t.addr()));
    }
    unsafe extern "C" fn record_before_wait(vm: *mut c_void) {
        BEFORE_WAITS.with_borrow_mut(|v| v.push(vm.addr()));
    }
    /// Timer cb that re-enters the surface with a nested non-blocking bun
    /// tick (the waitForPromise shape — contract hazard 6).
    unsafe extern "C" fn nesting_timer(t: *mut UsInternalCallback) {
        TIMER_ARGS.with_borrow_mut(|v| v.push(t.addr()));
        let loop_ = TEST_LOOP.with_borrow(|l| *l) as *mut UsLoop;
        let zero = Timespec { sec: 0, nsec: 0 };
        // SAFETY: TEST_LOOP holds the live loop under test.
        unsafe { us_loop_run_bun_tick(loop_, &raw const zero) };
    }

    fn fresh_state() {
        reset();
        WAKEUPS.with_borrow_mut(Vec::clear);
        TIMER_ARGS.with_borrow_mut(Vec::clear);
        BEFORE_WAITS.with_borrow_mut(Vec::clear);
        TEST_LOOP.with_borrow_mut(|l| *l = 0);
    }

    fn create_loop() -> *mut UsLoop {
        fresh_state();
        // SAFETY: standard creation; recorders are valid for the process.
        let loop_ = unsafe {
            us_create_loop(
                ptr::null_mut(),
                Some(record_wakeup),
                Some(noop_loop_cb),
                Some(noop_loop_cb),
                0,
            )
        };
        assert!(!loop_.is_null());
        TEST_LOOP.with_borrow_mut(|l| *l = loop_.addr());
        loop_
    }

    /// One bounded blocking-ish tick through the surface.
    fn tick_ms(loop_: *mut UsLoop, ms: i64) {
        let ts = Timespec {
            sec: ms / 1000,
            nsec: (ms % 1000) * 1_000_000,
        };
        // SAFETY: `loop_` is the live loop under test.
        unsafe { us_loop_run_bun_tick(loop_, &raw const ts) };
    }

    // ── winsock helpers (local copies; afd.rs's are test-private there) ──

    fn wsa_startup() {
        use std::sync::Once;
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let mut data = core::mem::MaybeUninit::<WSADATA>::zeroed();
            // SAFETY: valid out-pointer; winsock 2.2 always available.
            let r = unsafe { WSAStartup(0x0202, data.as_mut_ptr()) };
            assert_eq!(r, 0);
        });
    }

    fn tcp_socket() -> SOCKET {
        // SAFETY: no pointers besides the null protocol info.
        let s = unsafe {
            WSASocketW(
                AF_INET,
                SOCK_STREAM,
                IPPROTO_TCP,
                ptr::null_mut(),
                0,
                WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT,
            )
        };
        assert_ne!(s, INVALID_SOCKET);
        s
    }

    /// Connected loopback TCP pair `(accepted, client)`.
    fn loopback_pair() -> (SOCKET, SOCKET) {
        wsa_startup();
        // SAFETY: standard winsock loopback plumbing over valid locals.
        unsafe {
            let listener = tcp_socket();
            let mut addr = sockaddr_in {
                sin_family: AF_INET as u16,
                sin_port: 0,
                sin_addr: in_addr {
                    s_addr: 0x7f00_0001u32.to_be(),
                },
                sin_zero: [0; 8],
            };
            let addr_len = size_of::<sockaddr_in>() as c_int;
            assert_eq!(bind(listener, (&raw const addr).cast(), addr_len), 0);
            let mut len = addr_len;
            assert_eq!(
                getsockname(listener, (&raw mut addr).cast(), &raw mut len),
                0
            );
            assert_eq!(listen(listener, 1), 0);
            let client = tcp_socket();
            assert_eq!(connect(client, (&raw const addr).cast(), addr_len), 0);
            let accepted = accept(listener, ptr::null_mut(), ptr::null_mut());
            assert_ne!(accepted, INVALID_SOCKET);
            closesocket(listener);
            (accepted, client)
        }
    }

    fn send_byte(s: SOCKET) {
        // SAFETY: one-byte send from a static buffer.
        let n = unsafe { send(s, b"x".as_ptr().cast::<c_void>(), 1, 0) };
        assert_eq!(n, 1);
    }

    /// Tick until `cond` or `ms` elapsed.
    fn tick_until(loop_: *mut UsLoop, ms: u64, mut cond: impl FnMut() -> bool) {
        let deadline = Instant::now() + std::time::Duration::from_millis(ms);
        while !cond() && Instant::now() < deadline {
            tick_ms(loop_, 25);
        }
    }

    /// The numbers the C header static_asserts (internal/eventing/
    /// bun_iocp.h) — asserted here against the same literals so the two
    /// sides cannot drift apart, plus the ext-addressing arithmetic shared C
    /// performs (`us_loop_ext` = loop + 1, `us_timer_ext` skip, hazard 1/3).
    #[test]
    fn abi_layout_is_frozen() {
        let _guard = serial();
        assert_eq!(size_of::<LoopData>(), 200);
        assert_eq!(offset_of!(UsLoop, data), 0);
        assert_eq!(offset_of!(UsLoop, pending_wakeups), 200);
        assert_eq!(size_of::<UsLoop>(), 240);
        assert_eq!(size_of::<UsPoll>(), 24);
        assert_eq!(offset_of!(UsPoll, fd), 8);
        assert_eq!(offset_of!(UsPoll, poll_type), 16);
        assert_eq!(size_of::<UsInternalCallback>(), 64);
        assert_eq!(offset_of!(UsInternalCallback, loop_), 24);
        assert_eq!(offset_of!(LoopData, tick_depth), 192);
        assert_eq!(offset_of!(LoopData, jsc_vm), 184);

        fresh_state();
        // ext area = loop + 1: calloc'd (zeroed) and writable.
        // SAFETY: creation with ext_size 64; recorders process-valid.
        let loop_ = unsafe {
            us_create_loop(
                ptr::null_mut(),
                Some(record_wakeup),
                Some(noop_loop_cb),
                Some(noop_loop_cb),
                64,
            )
        };
        TEST_LOOP.with_borrow_mut(|l| *l = loop_.addr());
        // SAFETY: ext_size 64 was allocated past the struct.
        unsafe {
            let ext = loop_.add(1).cast::<u8>();
            assert_eq!(ext.addr() - loop_.addr(), 240);
            for i in 0..64 {
                assert_eq!(*ext.add(i), 0, "ext byte {i} not zeroed");
            }
            ext.write_bytes(0xAB, 64);
        }

        // Timer block: cb->loop readable through the timer cast (hazard 3),
        // ext placed past [callback][native storage].
        // SAFETY: loop_ is live.
        unsafe {
            let t = us_create_timer(loop_, 1, 8);
            assert_eq!(us_timer_loop(t), loop_);
            let ext = us_timer_ext(t);
            assert_eq!(ext.addr() - t.addr(), 80);
            ext.cast::<usize>().write(0xDEAD_BEEF);
            assert_eq!(ext.cast::<usize>().read(), 0xDEAD_BEEF);
            us_timer_close(t, 1);
        }

        // Poll ext = p + 1.
        // SAFETY: poll created and freed without starting (free mode B).
        unsafe {
            let p = us_create_poll(loop_, 0, 16);
            assert_eq!(us_poll_ext(p).addr() - p.addr(), 24);
            us_poll_init(p, 1234, 3);
            assert_eq!(us_poll_fd(p), 1234);
            assert_eq!(us_internal_poll_type(p), 3);
            us_internal_poll_set_type(p, 0);
            assert_eq!(us_internal_poll_type(p), 0);
            us_poll_free(p, loop_);
            us_loop_free(loop_);
        }
    }

    /// Hazard 7: add/sub_active hold the loop; an unref'd-but-open poll does
    /// not; ticks gate on aliveness (B.4 step 1).
    #[test]
    fn ref_api_holds_loop_and_gates_ticks() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout.
        unsafe {
            assert_eq!(us_loop_active_count(loop_), 0);
            // Gate: nothing REF'D → bun tick still collects ready
            // completions with ZERO timeout (POSIX num_polls parity; an
            // unref'd child's posted exit packet must not rot in the
            // port) — but it must never idle-wait the caller's timeout.
            let start = Instant::now();
            tick_ms(loop_, 1_000);
            assert!(
                start.elapsed().as_millis() < 500,
                "inactive loop must not block"
            );

            us_loop_add_active(loop_, 2);
            assert_eq!(us_loop_active_count(loop_), 2);
            us_loop_sub_active(loop_, 1);
            assert_eq!(us_loop_active_count(loop_), 1);

            // An open, started, unref'd poll contributes nothing (hazard 7).
            let (a, b) = loopback_pair();
            let p = us_create_poll(loop_, 0, 0);
            us_poll_init(p, a, 0);
            assert_eq!(us_poll_start_rc(p, loop_, LIBUS_SOCKET_READABLE), 0);
            assert_eq!(us_loop_active_count(loop_), 1, "polls are always unref'd");

            us_poll_stop(p, loop_);
            us_poll_free(p, loop_);
            tick_until(loop_, 5_000, || us_loop_active_count(loop_) == 1);
            assert_eq!(us_loop_active_count(loop_), 1, "close drained");
            us_loop_sub_active(loop_, 1);
            closesocket(a);
            closesocket(b);
            us_loop_free(loop_);
        }
    }

    /// An unref'd child's exit packet must dequeue through the PUBLIC bun
    /// tick even when nothing refs the loop — the num_polls-parity gate.
    /// Regression: the old ref-based gate returned before GQCS and the
    /// posted exit packet rotted in the port forever. // quirk: PROC-45
    #[test]
    fn unrefd_exit_packet_dequeues_via_bun_tick() {
        let _guard = serial();
        let loop_ = create_loop();
        struct Ctx {
            fired: core::cell::Cell<bool>,
            closed: core::cell::Cell<bool>,
        }
        unsafe extern "C" {}
        unsafe fn on_exit(_l: &mut Loop, data: *mut c_void, code: i64, _sig: i32) {
            // SAFETY: data is the test's live Ctx.
            unsafe {
                assert_eq!(code, 7);
                (*data.cast::<Ctx>()).fired.set(true);
            }
        }
        unsafe fn on_close(_l: &mut Loop, data: *mut c_void) {
            // SAFETY: data is the test's live Ctx.
            unsafe { (*data.cast::<Ctx>()).closed.set(true) };
        }
        let ctx = Box::new(Ctx {
            fired: core::cell::Cell::new(false),
            closed: core::cell::Cell::new(false),
        });
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        let file: Vec<u8> = comspec.into_bytes();
        let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"7"];
        let options = crate::process::ProcessOptions {
            file: &file,
            args,
            env: None,
            cwd: None,
            flags: crate::process::PROCESS_VERBATIM_ARGUMENTS,
            stdio: &[],
            pseudoconsole: None,
        };
        // SAFETY: loop and ctx outlive the handle; standard spawn contract.
        let mut child = unsafe {
            crate::process::ProcessHandle::spawn(
                native(loop_),
                &options,
                Some(on_exit),
                core::ptr::from_ref(&*ctx) as *mut c_void,
            )
        }
        .expect("spawn");
        child.unref();
        // SAFETY: loop_ live.
        unsafe {
            assert!(
                !(*native(loop_)).alive(),
                "unref'd child must not ref the loop"
            )
        };
        let start = Instant::now();
        while !ctx.fired.get() {
            assert!(
                start.elapsed().as_secs() < 20,
                "exit packet never dequeued through us_loop_run_bun_tick"
            );
            tick_ms(loop_, 16);
        }
        child.close(Some(on_close), core::ptr::from_ref(&*ctx) as *mut c_void);
        while !ctx.closed.get() {
            assert!(start.elapsed().as_secs() < 20, "close never completed");
            tick_ms(loop_, 16);
        }
        // SAFETY: all handles drained above.
        unsafe { us_loop_free(loop_) };
    }

    /// Timer callbacks receive THE TIMER (hazard 4); repeat repeats; ms == 0
    /// stops; close releases the non-fallthrough keep-alive.
    #[test]
    fn timer_cb_receives_timer_repeat_and_disable() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout.
        unsafe {
            let t = us_create_timer(loop_, 0, 0);
            assert_eq!(us_loop_active_count(loop_), 1, "non-fallthrough timer refs");
            us_timer_set(t, Some(record_timer), 10, 10);
            tick_until(loop_, 5_000, || TIMER_ARGS.with_borrow(|v| v.len() >= 3));
            let fired = TIMER_ARGS.with_borrow(Vec::clone);
            assert!(fired.len() >= 3, "repeat timer kept firing: {fired:?}");
            assert!(
                fired.iter().all(|&arg| arg == t.addr()),
                "timer cb must receive the TIMER pointer"
            );

            // Disable; a bounded window must produce no further fires.
            us_timer_set(t, Some(record_timer), 0, 0);
            let baseline = TIMER_ARGS.with_borrow(Vec::len);
            for _ in 0..6 {
                tick_ms(loop_, 25);
            }
            assert_eq!(
                TIMER_ARGS.with_borrow(Vec::len),
                baseline,
                "stopped timer fired"
            );

            us_timer_close(t, 0);
            assert_eq!(us_loop_active_count(loop_), 0);
            us_loop_free(loop_);
        }
    }

    /// Contract hazard 5 regression (the fix, not libuv's bug): a later
    /// `us_timer_set` on the SWEEP timer is honored — disable stops it and
    /// re-enable starts it again.
    #[test]
    fn sweep_timer_disable_stops_and_reenable_fires() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout.
        unsafe {
            us_loop_add_active(loop_, 1);
            let sweep = (*loop_).data.sweep_timer;
            // Enable (us_internal_enable_sweep_timer shape).
            us_timer_set(sweep, Some(record_timer), 10, 10);
            tick_until(loop_, 5_000, || TIMER_ARGS.with_borrow(|v| !v.is_empty()));
            assert!(
                TIMER_ARGS.with_borrow(|v| !v.is_empty()),
                "enabled sweep timer never fired"
            );
            // Disable (us_internal_disable_sweep_timer shape): must actually
            // stop — libuv.c's guard ignored this forever.
            us_timer_set(sweep, Some(record_timer), 0, 0);
            // One tick to drain a possibly already-due fire, then observe.
            tick_ms(loop_, 25);
            let baseline = TIMER_ARGS.with_borrow(Vec::len);
            for _ in 0..6 {
                tick_ms(loop_, 25);
            }
            assert_eq!(
                TIMER_ARGS.with_borrow(Vec::len),
                baseline,
                "disabled sweep timer kept firing (hazard 5)"
            );
            // Re-enable: must fire again (libuv's has_added guard would have
            // ignored this set too).
            us_timer_set(sweep, Some(record_timer), 10, 10);
            tick_until(loop_, 5_000, || {
                TIMER_ARGS.with_borrow(|v| v.len() > baseline)
            });
            assert!(
                TIMER_ARGS.with_borrow(Vec::len) > baseline,
                "re-enabled sweep timer never fired"
            );
            us_timer_set(sweep, Some(record_timer), 0, 0);
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// Hazard 4: the wakeup async callback receives the LOOP; cross-thread
    /// wakes coalesce to one delivery per tick and re-arm afterwards.
    #[test]
    fn async_cb_receives_loop_and_coalesces() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout; the worker only touches the
        // thread-safe wakeup entry point and joins before teardown.
        unsafe {
            us_loop_add_active(loop_, 1);
            let async_ = (*loop_).data.wakeup_async;
            let async_addr = async_.addr();
            // std thread: bun_threading would break this crate's natively-
            // linkable test binary (see Cargo.toml); test-only, joined below.
            #[expect(clippy::disallowed_methods)]
            let handle = std::thread::spawn(move || {
                let a = ptr::with_exposed_provenance_mut::<UsInternalCallback>(async_addr);
                // SAFETY: the loop (and async block) outlive the join below;
                // wakeup is the documented cross-thread entry point.
                us_internal_async_wakeup(a);
                us_internal_async_wakeup(a);
            });
            handle.join().unwrap();
            tick_ms(loop_, 1_000);
            let after_first = WAKEUPS.with_borrow(Vec::clone);
            assert_eq!(
                after_first,
                vec![loop_.addr()],
                "exactly one coalesced delivery, carrying the LOOP"
            );
            // Re-armed: a later wakeup delivers again.
            us_internal_async_wakeup(async_);
            tick_ms(loop_, 1_000);
            assert_eq!(WAKEUPS.with_borrow(Vec::len), 2);
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// B.4 steps 6-7: the GC-safepoint hook fires only when the tick may
    /// idle — pending wakeups or a missing jsc_vm suppress it.
    #[test]
    fn before_wait_gates_on_wakeups_and_jsc_vm() {
        let _guard = serial();
        let loop_ = create_loop();
        let fake_vm: u32 = 0;
        // SAFETY: loop_ live throughout; fake_vm outlives its uses.
        unsafe {
            us_loop_add_active(loop_, 1);
            us_loop_set_on_before_wait(loop_, Some(record_before_wait));

            // jsc_vm unset → no safepoint.
            tick_ms(loop_, 20);
            assert!(BEFORE_WAITS.with_borrow(Vec::is_empty));

            (*loop_).data.jsc_vm = (&raw const fake_vm).cast::<c_void>();
            tick_ms(loop_, 20);
            assert_eq!(
                BEFORE_WAITS.with_borrow(Vec::clone),
                vec![(&raw const fake_vm).addr()],
                "idle tick with jsc_vm runs the safepoint with the vm"
            );

            // Pending wakeup → had_wakeups → no safepoint, but the wakeup
            // callback is delivered.
            (*loop_).pending_wakeups.fetch_add(1, Ordering::Release);
            us_internal_async_wakeup((*loop_).data.wakeup_async);
            tick_ms(loop_, 20);
            assert_eq!(BEFORE_WAITS.with_borrow(Vec::len), 1, "safepoint skipped");
            assert_eq!(WAKEUPS.with_borrow(Vec::len), 1);

            // Non-blocking tick ({0,0}) never runs the safepoint.
            tick_ms(loop_, 0);
            assert_eq!(BEFORE_WAITS.with_borrow(Vec::len), 1);

            (*loop_).data.jsc_vm = ptr::null();
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// The bun tick honors its timeout and never returns early
    /// (// quirk: LOOP-02 through the C surface).
    #[test]
    fn bun_tick_timeout_never_early() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout.
        unsafe {
            us_loop_add_active(loop_, 1);
            for timeout in [20u64, 50] {
                let start = Instant::now();
                tick_ms(loop_, timeout as i64);
                let elapsed = start.elapsed().as_millis() as u64;
                assert!(
                    elapsed >= timeout,
                    "bun_tick({timeout}ms) returned after {elapsed}ms"
                );
            }
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// Contract hazard 6: tick_depth brackets every tick and nests — a
    /// re-entrant bun tick from a timer callback observes depth 2, the outer
    /// tick depth 1 (the shared-C guard `tick_depth <= 1` then defers
    /// closed-socket freeing to the outermost tick).
    #[test]
    fn bun_tick_depth_nests() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ live throughout.
        unsafe {
            let t = us_create_timer(loop_, 0, 0);
            us_timer_set(t, Some(nesting_timer), 10, 0);
            tick_until(loop_, 5_000, || TIMER_ARGS.with_borrow(|v| !v.is_empty()));
            assert_eq!(TIMER_ARGS.with_borrow(Vec::len), 1);
            let depths = POST_DEPTHS.with_borrow(Vec::clone);
            assert!(
                depths.windows(2).any(|w| w == [2, 1]),
                "expected a nested post at depth 2 followed by the outer at 1, got {depths:?}"
            );
            assert_eq!((*loop_).data.tick_depth, 0, "depth restored");
            us_timer_close(t, 0);
            us_loop_free(loop_);
        }
    }

    /// Poll lifecycle through the C surface on real sockets: delivery is
    /// masked to the subscription, change re-arms, resize reroutes in-flight
    /// completions to the NEW block (hazard 2), and all three free modes
    /// complete without leaks or dangling completions.
    #[test]
    fn poll_lifecycle_three_free_modes_and_resize_reroute() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_, sockets, and polls live for the scopes used below.
        unsafe {
            us_loop_add_active(loop_, 1);

            // Mode B: create + free without ever starting.
            let p0 = us_create_poll(loop_, 0, 8);
            us_poll_init(p0, INVALID_SOCKET, 0);
            us_poll_free(p0, loop_);

            // Start + deliver, masked to subscription.
            let (a, b) = loopback_pair();
            let p = us_create_poll(loop_, 0, size_of::<usize>() as c_uint);
            us_poll_init(p, a, 0);
            us_poll_ext(p).cast::<usize>().write(0x5151_5151);
            assert_eq!(us_poll_start_rc(p, loop_, LIBUS_SOCKET_READABLE), 0);
            assert_eq!(us_poll_events(p), LIBUS_SOCKET_READABLE);
            send_byte(b);
            tick_until(loop_, 5_000, || DISPATCHED.with_borrow(|v| !v.is_empty()));
            let first = DISPATCHED.with_borrow(Vec::clone);
            assert!(!first.is_empty(), "no readiness dispatched");
            assert_eq!(
                first[0],
                (p.addr(), 0, 0, LIBUS_SOCKET_READABLE),
                "delivery must be masked to the subscribed READABLE only \
                 (socket is also writable)"
            );

            // Resize while the re-armed IRP is in flight: subsequent events
            // must land on the NEW block (hazard 2).
            let new_p = us_poll_resize(p, loop_, size_of::<usize>() as c_uint, 64);
            assert_ne!(new_p, p, "grow must move the block");
            assert_eq!(us_poll_ext(new_p).cast::<usize>().read(), 0x5151_5151);
            assert_eq!(us_poll_fd(new_p), a);
            DISPATCHED.with_borrow_mut(Vec::clear);
            send_byte(b);
            tick_until(loop_, 5_000, || DISPATCHED.with_borrow(|v| !v.is_empty()));
            let rerouted = DISPATCHED.with_borrow(Vec::clone);
            assert!(!rerouted.is_empty(), "no event after resize");
            assert!(
                rerouted.iter().all(|&(addr, ..)| addr == new_p.addr()),
                "in-flight events must route to the NEW block: {rerouted:?}"
            );

            // Mode A: the old block is freed separately (resized away).
            us_poll_free(p, loop_);

            // Change to WRITABLE: an idle-but-writable socket reports W only.
            DISPATCHED.with_borrow_mut(Vec::clear);
            us_poll_change(new_p, loop_, LIBUS_SOCKET_WRITABLE);
            assert_eq!(us_poll_events(new_p), LIBUS_SOCKET_WRITABLE);
            tick_until(loop_, 5_000, || DISPATCHED.with_borrow(|v| !v.is_empty()));
            let writable = DISPATCHED.with_borrow(Vec::clone);
            assert!(!writable.is_empty(), "no writable event after change");
            assert_eq!(writable[0], (new_p.addr(), 0, 0, LIBUS_SOCKET_WRITABLE));

            // Mode C: stop then free in the same tick; both blocks are
            // released via the close callback at tick end.
            us_poll_stop(new_p, loop_);
            us_poll_free(new_p, loop_);
            closesocket(a);
            tick_until(loop_, 5_000, || us_loop_active_count(loop_) == 1);
            assert_eq!(us_loop_active_count(loop_), 1, "poll close drained");
            closesocket(b);

            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// Re-entrancy (contract hazard 9): the dispatch callback stops and
    /// frees the dispatched poll from INSIDE the callback chain; the close
    /// drains the same tick and nothing dangles.
    #[test]
    fn poll_close_from_inside_dispatch_callback() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_, sockets, and the poll live until drained below.
        unsafe {
            us_loop_add_active(loop_, 1);
            let (a, b) = loopback_pair();
            let p = us_create_poll(loop_, 0, 0);
            us_poll_init(p, a, 0);
            assert_eq!(us_poll_start_rc(p, loop_, LIBUS_SOCKET_READABLE), 0);
            let loop_addr = loop_.addr();
            DISPATCH_HOOK.with_borrow_mut(|h| {
                *h = Some(Box::new(move |poll, _error, _eof, _events| {
                    let l = ptr::with_exposed_provenance_mut::<UsLoop>(loop_addr);
                    // SAFETY: the dispatched poll is live (its free below is
                    // deferred to the close callback); `l` is the test loop.
                    us_poll_stop(poll, l);
                    us_poll_free(poll, l);
                }));
            });
            send_byte(b);
            tick_until(loop_, 5_000, || DISPATCHED.with_borrow(|v| !v.is_empty()));
            assert_eq!(DISPATCHED.with_borrow(Vec::len), 1);
            DISPATCH_HOOK.with_borrow_mut(|h| *h = None);
            tick_until(loop_, 5_000, || us_loop_active_count(loop_) == 1);
            assert_eq!(us_loop_active_count(loop_), 1, "in-callback close drained");
            // The freed poll must receive nothing further.
            send_byte(b);
            for _ in 0..4 {
                tick_ms(loop_, 25);
            }
            assert_eq!(
                DISPATCHED.with_borrow(Vec::len),
                1,
                "freed poll must not be dispatched again"
            );
            closesocket(a);
            closesocket(b);
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }

    /// Hazard 10: a dead target socket makes `us_poll_start_rc` return a
    /// real nonzero code (and the poll stays freeable via the never-started
    /// mode) instead of libuv.c's unconditional 0.
    #[test]
    fn poll_start_rc_reports_real_errors() {
        let _guard = serial();
        let loop_ = create_loop();
        // SAFETY: loop_ and the poll block live for the scope below.
        unsafe {
            us_loop_add_active(loop_, 1);
            let (a, b) = loopback_pair();
            closesocket(a);
            let p = us_create_poll(loop_, 0, 0);
            us_poll_init(p, a, 0);
            let rc = us_poll_start_rc(p, loop_, LIBUS_SOCKET_READABLE);
            assert_ne!(rc, 0, "dead socket must fail the start");
            assert_eq!(WSAGetLastError(), rc, "code readable via LIBUS_ERR");
            // The failed poll frees through the never-started mode.
            us_poll_free(p, loop_);
            closesocket(b);
            us_loop_sub_active(loop_, 1);
            us_loop_free(loop_);
        }
    }
}
