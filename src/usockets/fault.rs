//! Syscall fault injection for tests. Implements docs/semantics.md §11
//! (FAULT INJECTION) — same `us_fault_*` API and rule shape as
//! fault_inject.c. Whole module gated on the `socket_fault_injection`
//! feature (never in release builds).
#![cfg(feature = "socket_fault_injection")]

use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub const RECV: c_int = 0;
pub const SEND: c_int = 1;
pub const WRITEV: c_int = 2;
pub const SENDMSG: c_int = 3;
pub const RECVMSG: c_int = 4;
pub const CONNECT: c_int = 5;
pub const ACCEPT: c_int = 6;
pub const SOCKET: c_int = 7;
pub const CLOSE: c_int = 8;
pub const SHUTDOWN: c_int = 9;
/// Not a syscall: the per-loop TLS plaintext buffer allocation.
pub const SSL_LOOP_BUFFER: c_int = 10;

pub const US_FAULT_COUNT: usize = 11;

pub const ACTION_NONE: c_int = 0;
pub const ACTION_ERRNO: c_int = 1;
pub const ACTION_SHORT: c_int = 2;
pub const ACTION_ZERO: c_int = 3;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct UsFaultRule {
    pub action: c_int,
    pub errno_value: c_int,
    pub clamp_bytes: c_int,
    pub after_n_calls: c_int,
    pub repeat: c_int,
    pub target_fd: c_int,
}

const NO_RULE: UsFaultRule = UsFaultRule {
    action: ACTION_NONE,
    errno_value: 0,
    clamp_bytes: 0,
    after_n_calls: 0,
    repeat: 0,
    target_fd: -1,
};

#[derive(Clone, Copy)]
struct Slot {
    rule: UsFaultRule,
    calls_seen: c_int,
    fired: c_int,
}

const EMPTY_SLOT: Slot = Slot { rule: NO_RULE, calls_seen: 0, fired: 0 };

/// Lock-free hot-path flag; release-stored under the state lock whenever any
/// rule is non-NONE, acquire-loaded by `check` (R11.4).
static ARMED: AtomicBool = AtomicBool::new(false);

/// Process-global so rules armed on the JS thread also affect HTTP/worker
/// threads; per-socket isolation via `target_fd` (R11.4).
static STATE: Mutex<[Slot; US_FAULT_COUNT]> = Mutex::new([EMPTY_SLOT; US_FAULT_COUNT]);

fn recompute_armed(slots: &[Slot; US_FAULT_COUNT]) {
    let any = slots.iter().any(|s| s.rule.action != ACTION_NONE);
    ARMED.store(any, Ordering::Release);
}

pub fn us_fault_set(syscall: c_int, rule: &UsFaultRule) {
    let Ok(idx) = usize::try_from(syscall) else { return };
    if idx >= US_FAULT_COUNT {
        return;
    }
    let mut slots = STATE.lock().unwrap();
    slots[idx] = Slot { rule: *rule, calls_seen: 0, fired: 0 };
    recompute_armed(&slots);
}

pub fn us_fault_clear(syscall: c_int) {
    let Ok(idx) = usize::try_from(syscall) else { return };
    if idx >= US_FAULT_COUNT {
        return;
    }
    let mut slots = STATE.lock().unwrap();
    slots[idx] = EMPTY_SLOT;
    recompute_armed(&slots);
}

pub fn us_fault_clear_all() {
    let mut slots = STATE.lock().unwrap();
    for slot in slots.iter_mut() {
        slot.rule.action = ACTION_NONE;
    }
    ARMED.store(false, Ordering::Release);
}

/// What a fired rule wants the hook site to do.
pub(crate) enum Fault {
    /// Return failure with this errno (`-errno` in the negative-errno return
    /// convention of `unsafe_core::io`).
    Errno(c_int),
    /// Return 0 (recv: peer closed; send: backpressure).
    Zero,
    /// Clamp the operation length to this and run the real syscall.
    Clamp(usize),
}

/// Hook entry (R11.5). `len` is the operation length for SHORT clamping; pass
/// 0 for length-less hooks (connect/accept/writev — clamp is then a no-op,
/// matching the C `unused` lvalue). Returns None when the call proceeds as-is.
pub(crate) fn check(syscall: c_int, fd: c_int, len: usize) -> Option<Fault> {
    if !ARMED.load(Ordering::Acquire) {
        return None;
    }
    let idx = usize::try_from(syscall).ok()?;
    if idx >= US_FAULT_COUNT {
        return None;
    }
    let mut slots = STATE.lock().unwrap();
    // Snapshot under the lock; the action dispatch below runs on the snapshot
    // after unlock so a concurrent re-arm cannot tear the rule (R11.4).
    let rule = slots[idx].rule;
    if rule.action == ACTION_NONE || (rule.target_fd >= 0 && rule.target_fd != fd) {
        return None;
    }
    let seen = slots[idx].calls_seen;
    slots[idx].calls_seen += 1;
    if seen < rule.after_n_calls {
        return None;
    }
    let fired = slots[idx].fired;
    slots[idx].fired += 1;
    if rule.repeat >= 0 && fired >= rule.repeat {
        slots[idx].rule.action = ACTION_NONE;
        recompute_armed(&slots);
        return None;
    }
    drop(slots);
    match rule.action {
        ACTION_ERRNO => Some(Fault::Errno(rule.errno_value)),
        ACTION_ZERO => Some(Fault::Zero),
        ACTION_SHORT => {
            if rule.clamp_bytes >= 0 && len > rule.clamp_bytes as usize {
                Some(Fault::Clamp(rule.clamp_bytes as usize))
            } else {
                None
            }
        }
        _ => None,
    }
}
