//! Tick pipeline: pre → wakeups → poll → dispatch → drain → sweep → post.
//! Implements docs/semantics.md §1 (LOOP TICK): iteration_nr++, DNS-ready
//! drain, low-prio budget (5/tick, R1.22), `pre_cb`, quic pre/post hooks,
//! QUIC→sweep timeout folding (R1.10/R1.16), the will_idle GC-safepoint gate
//! (C16), and the closed drain in the outermost postlude only (`tick_depth`
//! guard — R1.14/R1.15, C6).

#[cfg(not(windows))]
use crate::backend;
use crate::backend::Events;
use crate::loop_::Loop;
use crate::unsafe_core::deref::{with_group, with_socket};
use crate::unsafe_core::ffi;

#[cfg(not(windows))]
use crate::loop_::{timeouts, wakeup};
#[cfg(not(windows))]
use crate::unsafe_core::poll_access;
#[cfg(not(windows))]
use bun_core::Timespec;

/// `MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION` (loop.c:295) — spread TLS
/// handshake CPU over iterations, prioritizing open connections (C8).
const MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION: i32 = 5;

#[cfg(not(windows))]
fn timeout_ns(timeout: Option<Timespec>) -> i64 {
    timeout.map_or(-1, |t| {
        t.sec.saturating_mul(1_000_000_000).saturating_add(t.nsec)
    })
}

/// Kernel poll into `loop.ready_polls`. `immediate` = kqueue
/// KEVENT_FLAG_IMMEDIATE (R1.10 step 8); epoll's zero timespec is already a
/// kernel fast path, so the flag has no epoll analog.
#[cfg(not(windows))]
fn poll_wait(loop_: *mut Loop, timeout: Option<Timespec>, immediate: bool) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let _ = immediate;
        poll_access::epoll_wait_ready(loop_, timeout_ns(timeout));
    }
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        poll_access::kevent_wait_ready(loop_, timeout_ns(timeout), immediate);
    }
}

/// `us_loop_run_bun_tick` (R1.10) — one bounded iteration. `timeout == None`
/// parks; a zero timespec returns without idling; otherwise parks at most
/// `timeout`. Effective deadline = min(caller, quic_next_tick_us, sweep),
/// folded in that order (R1.11).
#[cfg(not(windows))]
pub(crate) fn run_bun_tick(loop_: *mut Loop, timeout: Option<&Timespec>) {
    // Step 1: bail before tick_depth++ when nothing is polled.
    if poll_access::num_polls(loop_) == 0 {
        return;
    }
    ffi::ld_tick_depth_add(loop_, 1);
    loop_pre(loop_);

    let mut eff: Option<Timespec> = timeout.copied();

    // Step 3 — QUIC fold: loop_pre ran lsquic process_conns and stored the
    // soonest earliest_adv_tick; NULL-timeout callers (HTTP thread) need it
    // folded here so QUIC retransmit/idle timers fire without other I/O.
    let (quic_head, quic_us) = (ffi::ld_quic_head(loop_), ffi::ld_quic_next_tick_us(loop_));
    if !quic_head.is_null() && quic_us >= 0 {
        let fold = match &eff {
            None => true,
            Some(t) => {
                t.sec
                    .saturating_mul(1_000_000)
                    .saturating_add(t.nsec / 1_000)
                    > quic_us
            }
        };
        if fold {
            eff = Some(Timespec {
                sec: quic_us / 1_000_000,
                nsec: (quic_us % 1_000_000) * 1000,
            });
        }
    }

    // Step 4 — sweep fold (R1.16): min(timeout, sweep delta), ties going to
    // the caller's timeout.
    let sweep_ns = timeouts::next_sweep_deadline_ns(loop_);
    if sweep_ns >= 0 {
        let keep_caller = matches!(&eff, Some(t) if {
            let sweep_sec = sweep_ns / 1_000_000_000;
            let sweep_nsec = sweep_ns % 1_000_000_000;
            t.sec < sweep_sec || (t.sec == sweep_sec && t.nsec <= sweep_nsec)
        });
        if !keep_caller {
            eff = Some(Timespec::from_ns(sweep_ns));
        }
    }

    // Step 5 — ACQUIRE-swap paired with the RELEASE fetch_add in
    // us_wakeup_loop (R10.1). Step 6/7 — the GC safepoint MUST be skipped
    // whenever a cross-thread wakeup is pending or the poll will not block.
    let had_wakeups = wakeup::take_pending_wakeups(loop_);
    let will_idle = had_wakeups == 0 && eff.map_or(true, |t| t.nsec != 0 || t.sec != 0);
    if will_idle {
        let vm = ffi::ld_jsc_vm(loop_);
        if !vm.is_null() {
            ffi::jsc_on_before_wait(vm);
        }
    }

    poll_wait(loop_, eff, !will_idle);
    backend::dispatch_ready_polls(loop_);
    backend::drain_ready_polls(loop_);
    timeouts::sweep_if_due(loop_);
    loop_post(loop_);
    ffi::ld_tick_depth_add(loop_, -1);
}

/// Classic `us_loop_run` (R1.8): iterate until no non-fallthrough polls
/// remain; the blocking poll is clamped only by the sweep deadline.
#[cfg(not(windows))]
pub(crate) fn run(loop_: *mut Loop) {
    while poll_access::num_polls(loop_) != 0 {
        ffi::ld_tick_depth_add(loop_, 1);
        loop_pre(loop_);
        let sweep_ns = timeouts::next_sweep_deadline_ns(loop_);
        let timeout = (sweep_ns >= 0).then(|| Timespec::from_ns(sweep_ns));
        poll_wait(loop_, timeout, false);
        backend::dispatch_ready_polls(loop_);
        backend::drain_ready_polls(loop_);
        timeouts::sweep_if_due(loop_);
        loop_post(loop_);
        ffi::ld_tick_depth_add(loop_, -1);
    }
}

/// Windows `us_loop_run` (libuv.c:214-219): update time, uv_run ONCE —
/// pre/post flow through the uv_prepare/uv_check hooks.
#[cfg(windows)]
pub(crate) fn run(loop_: *mut Loop) {
    crate::backend::libuv::run(loop_);
}

/// `us_loop_pump` (Windows / libuv NOWAIT).
#[cfg(windows)]
pub(crate) fn pump(loop_: *mut Loop) {
    crate::backend::libuv::pump(loop_);
}

/// Loop prelude (R1.13) — order frozen (docs/cabi.md §4.2):
/// iteration_nr++, DNS results, low-prio handling, `pre_cb(loop)`, quic
/// process when `quic_head != null` (flushes JS-task stream writes before
/// the poll blocks).
pub(crate) fn loop_pre(loop_: *mut Loop) {
    ffi::ld_iteration_nr_bump(loop_);
    crate::connecting::drain_dns_ready(loop_);
    drain_low_prio(loop_);
    // C-parity loops always install pre_cb/post_cb (uWS::Loop); None is only
    // reachable for bare-created loops — skipping is a safe superset of the
    // C's unconditional deref (loop.c:396-423).
    if let Some(pre) = ffi::ld_pre_cb(loop_) {
        ffi::invoke_loop_cb(pre, loop_);
    }
    if !ffi::ld_quic_head(loop_).is_null() {
        ffi::quic_loop_process(loop_);
    }
}

/// Loop postlude (R1.14) — order frozen: DNS results (again — results that
/// landed during dispatch), quic process, free closed sockets ONLY when
/// `tick_depth <= 1` (a nested tick must not free memory the outer dispatch
/// may still hold — loop.c:409-421), then `post_cb`.
pub(crate) fn loop_post(loop_: *mut Loop) {
    crate::connecting::drain_dns_ready(loop_);
    if !ffi::ld_quic_head(loop_).is_null() {
        ffi::quic_loop_process(loop_);
    }
    if ffi::ld_tick_depth(loop_) <= 1 {
        drain_closed_sockets(loop_);
    }
    if let Some(post) = ffi::ld_post_cb(loop_) {
        ffi::invoke_loop_cb(post, loop_);
    }
}

/// `us_internal_free_closed_sockets` (R1.15): release, in order, every
/// socket on `closed_head` (zero prev/next, free the detached ext area,
/// `us_poll_free` parity `num_polls--`, slab slot back with a generation
/// bump — the ONLY socket death path, docs/design.md §Strategy 4 / C6), every UDP
/// socket on `closed_udp_head`, every connecting socket on
/// `closed_connecting_head`. No user callbacks run here.
pub(crate) fn drain_closed_sockets(loop_: *mut Loop) {
    let mut s = ffi::ld_take_closed_head(loop_);
    while !s.is_null() {
        let next = with_socket(s, |h| {
            let n = h.next;
            h.prev = core::ptr::null_mut();
            h.next = core::ptr::null_mut();
            n
        });
        crate::group::free_socket_ext(s);
        #[cfg(not(windows))]
        poll_access::num_polls_add(loop_, -1);
        crate::loop_::free_socket(loop_, s);
        s = next;
    }

    crate::udp::free_closed_udp_sockets(loop_);

    let mut c = ffi::ld_take_closed_connecting_head(loop_);
    while !c.is_null() {
        // Field-granular read (ffi.rs conn discipline) — never form
        // `&mut ConnectingSocket` over the whole struct on the loop thread.
        let next = ffi::conn_next(c);
        crate::loop_::free_connecting(loop_, c);
        c = next;
    }
}

/// `us_internal_handle_low_priority_sockets` (R1.22): pop LIFO from
/// `low_prio_head` while budget remains (closed entries consume budget too),
/// relink into the group, re-enable readable, mark state 2 (served — the
/// readable handler resets it to 0, R1.23).
pub(crate) fn drain_low_prio(loop_: *mut Loop) {
    ffi::ld_set_low_prio_budget(loop_, MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION);
    loop {
        let (s, budget) = (ffi::ld_low_prio_head(loop_), ffi::ld_low_prio_budget(loop_));
        if s.is_null() || budget <= 0 {
            break;
        }
        // Unlink the head (C zeroes only `next`; `prev` stays stale — port).
        let next = with_socket(s, |h| {
            let n = h.next;
            h.next = core::ptr::null_mut();
            n
        });
        if !next.is_null() {
            with_socket(next, |h| h.prev = core::ptr::null_mut());
        }
        ffi::ld_set_low_prio_head(loop_, next);
        let group = with_socket(s, |h| h.group);
        with_group(group, |g| g.low_prio_count -= 1);

        if with_socket(s, |h| h.is_closed()) {
            with_socket(s, |h| h.low_prio_state = 2);
        } else {
            crate::group::link_socket(group, s);
            let ev = with_socket(s, |h| h.p.events());
            crate::socket::poll_change(s, ev | Events::READABLE);
            with_socket(s, |h| h.low_prio_state = 2);
        }
        ffi::ld_set_low_prio_budget(loop_, budget - 1);
    }
}
