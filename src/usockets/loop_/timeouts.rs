//! Timeout wheels: 4-second short sweep + minute long sweep over the group
//! lists, folded into the poll deadline (no timerfd); sweep enable is
//! refcounted (`sweep_timer_count`). Implements docs/semantics.md §5
//! (contract C9).

use bun_core::{Timespec, TimespecMockMode};

use crate::LIBUS_TIMEOUT_GRANULARITY;
use crate::dispatch;
use crate::group::SocketGroup;
use crate::loop_::Loop;
use crate::unsafe_core::deref::{with_group, with_loop_data, with_socket};
use crate::unsafe_core::ffi;

/// `LIBUS_TIMEOUT_GRANULARITY_NS` (loop.c:73).
const SWEEP_INTERVAL_NS: i64 = LIBUS_TIMEOUT_GRANULARITY as i64 * 1_000_000_000;

/// Raw CLOCK_MONOTONIC ns (loop.c `us_internal_monotonic_ns`; never mocked —
/// the C sweep clock ignored fake timers).
fn monotonic_ns() -> i64 {
    let ts = Timespec::now(TimespecMockMode::ForceRealTime);
    ts.sec.wrapping_mul(1_000_000_000).wrapping_add(ts.nsec)
}

/// `us_internal_sweep_timeout_ns` (R1.17): -1 when no sweep is armed, else
/// the RELATIVE ns until the next sweep, clamped to >= 0 (poll-fold input for
/// R1.16's min(timeout, sweep delta)).
#[cfg(not(windows))]
pub(crate) fn next_sweep_deadline_ns(loop_: *mut Loop) -> i64 {
    with_loop_data(loop_, |ld| {
        if ld.sweep_next_tick_ns < 0 {
            return -1;
        }
        (ld.sweep_next_tick_ns - monotonic_ns()).max(0)
    })
}

/// `us_internal_sweep_if_due` (R5.8), called after dispatch in both run
/// paths. Re-arms BEFORE sweeping: a timeout handler may unlink the last
/// socket and disarm.
#[cfg(not(windows))]
pub(crate) fn sweep_if_due(loop_: *mut Loop) {
    let due = with_loop_data(loop_, |ld| {
        if ld.sweep_next_tick_ns < 0 {
            return false;
        }
        let now = monotonic_ns();
        if now < ld.sweep_next_tick_ns {
            return false;
        }
        ld.sweep_next_tick_ns = now + SWEEP_INTERVAL_NS;
        true
    });
    if due {
        timer_sweep(loop_);
    }
}

/// `us_internal_timer_sweep` (R5.9, loop.c:227-290). MUST NOT run
/// recursively. One walk per group fires BOTH wheels: short first, long
/// second, on the same dispatch; 255 = disarmed; firing one-shots the byte
/// (R5.10 — the handler must re-arm). Survives handler-driven unlink of the
/// cursor socket (R3.14) and deinit of the current group (R3.12).
pub(crate) fn timer_sweep(loop_: *mut Loop) {
    let mut group = with_loop_data(loop_, |ld| {
        ld.iterator = ld.head;
        ld.iterator
    });
    while !group.is_null() {
        // Bump this group's clocks (R5.4): one long tick = 15 sweeps = 60 s.
        let (short_ticks, long_ticks, mut s) = with_group(group, |g| {
            g.global_tick = g.global_tick.wrapping_add(1);
            g.timestamp = (g.global_tick % 240) as u8;
            g.long_timestamp = ((g.global_tick / 15) % 240) as u8;
            (g.timestamp, g.long_timestamp, g.head_sockets)
        });
        // False once loop_data.iterator was advanced past `group` by
        // unlink_group (R3.12) — `group` may then be freed storage.
        let mut group_alive = true;
        'sockets: while !s.is_null() {
            // Tight scan: seek until a matching timeout byte or list end.
            loop {
                let (timeout, long_timeout, next) =
                    with_socket(s, |h| (h.timeout, h.long_timeout, h.next));
                if short_ticks == timeout || long_ticks == long_timeout {
                    break;
                }
                s = next;
                if s.is_null() {
                    break 'sockets;
                }
            }
            with_group(group, |g| g.iterator = s);
            if with_socket(s, |h| {
                if short_ticks == h.timeout {
                    h.timeout = 255;
                    true
                } else {
                    false
                }
            }) {
                dispatch::dispatch_timeout(s);
            }
            if with_loop_data(loop_, |ld| ld.iterator) != group {
                group_alive = false;
                break 'sockets;
            }
            if with_group(group, |g| g.iterator) == s
                && with_socket(s, |h| {
                    if long_ticks == h.long_timeout {
                        h.long_timeout = 255;
                        true
                    } else {
                        false
                    }
                })
            {
                dispatch::dispatch_long_timeout(s);
            }
            if with_loop_data(loop_, |ld| ld.iterator) != group {
                group_alive = false;
                break 'sockets;
            }
            // Handler-unmodified chain steps by one; otherwise resume from
            // the cursor unlink_socket advanced (R3.10/R3.14).
            let cursor = with_group(group, |g| g.iterator);
            s = if s == cursor {
                with_socket(s, |h| h.next)
            } else {
                cursor
            };
        }
        if group_alive {
            let next = with_group(group, |g| {
                g.iterator = core::ptr::null_mut();
                g.next
            });
            with_loop_data(loop_, |ld| ld.iterator = next);
        }
        group = with_loop_data(loop_, |ld| ld.iterator);
    }
}

/// `us_internal_enable_sweep_timer` (R5.5): EVERY link of a socket or
/// connecting socket bumps the refcount; 0→1 arms the sweep and enables the
/// Date-header timer. Listen sockets do NOT participate (R5.6).
pub(crate) fn sweep_enable(loop_: *mut Loop, _group: *mut SocketGroup) {
    let count = with_loop_data(loop_, |ld| {
        ld.sweep_timer_count += 1;
        ld.sweep_timer_count
    });
    if count == 1 {
        #[cfg(not(windows))]
        with_loop_data(loop_, |ld| {
            ld.sweep_next_tick_ns = monotonic_ns() + SWEEP_INTERVAL_NS;
        });
        #[cfg(windows)]
        ffi::arm_libuv_sweep_timer(loop_);
        ffi::ensure_date_header_timer_is_enabled(loop_);
    }
}

/// `us_internal_disable_sweep_timer` (R5.5): every unlink drops the refcount;
/// →0 disarms the POSIX deadline. On libuv the timer keeps firing forever
/// after the first enable (preserved OQ-16 quirk) — decrement only.
pub(crate) fn sweep_disable(loop_: *mut Loop, _group: *mut SocketGroup) {
    with_loop_data(loop_, |ld| {
        ld.sweep_timer_count -= 1;
        #[cfg(not(windows))]
        if ld.sweep_timer_count == 0 {
            ld.sweep_next_tick_ns = -1;
        }
    });
}
