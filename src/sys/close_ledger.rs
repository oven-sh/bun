//! Debug-only (`debug_assertions`) diagnostics for double closes.
//!
//! Every successful `close(2)` issued through `bun_sys` records the calling
//! thread, what the descriptor pointed at (`/proc/self/fd/N`), and a
//! frame-pointer stack trace, keyed by fd number (the last few closes of each
//! number are kept). When a later close of the same number fails with `EBADF`
//! (a use-after-close, or a second owner closing a descriptor it does not
//! own), the reporter prints that history. Traces are printed as raw return
//! addresses (symbolize them against the binary with llvm-symbolizer).
#![allow(clippy::print_stderr)]

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_core::{DumpStackTraceOptions, StoredTrace};

/// `readlink("/proc/self/fd/N")`, truncated to a fixed buffer.
#[derive(Clone, Copy)]
pub struct FdDescription {
    len: u8,
    bytes: [u8; 63],
}

impl FdDescription {
    pub const UNKNOWN: FdDescription = FdDescription {
        len: 0,
        bytes: [0; 63],
    };

    /// Describe a currently-open descriptor. Call this *before* closing it.
    pub fn of(fd: i32) -> FdDescription {
        let mut out = FdDescription::UNKNOWN;
        if fd < 0 {
            return out;
        }
        let path = format!("/proc/self/fd/{fd}\0");
        // SAFETY: `path` is NUL-terminated; `bytes` is valid for `bytes.len()` writes.
        let n = unsafe {
            libc::readlink(
                path.as_ptr().cast(),
                out.bytes.as_mut_ptr().cast(),
                out.bytes.len(),
            )
        };
        if n > 0 {
            out.len = n as u8;
        }
        out
    }

    pub fn as_str(&self) -> &str {
        core::str::from_utf8(&self.bytes[..self.len as usize]).unwrap_or("<non-utf8>")
    }
}

#[derive(Clone, Copy)]
struct Slot {
    /// 0 = never recorded.
    seq: u64,
    tid: i64,
    description: FdDescription,
    trace: StoredTrace,
}

impl Slot {
    const EMPTY: Slot = Slot {
        seq: 0,
        tid: 0,
        description: FdDescription::UNKNOWN,
        trace: StoredTrace::EMPTY,
    };
}

const MAX_TRACKED_FD: usize = 4096;
const HISTORY: usize = 3;

static LEDGER: Mutex<[[Slot; HISTORY]; MAX_TRACKED_FD]> =
    Mutex::new([[Slot::EMPTY; HISTORY]; MAX_TRACKED_FD]);
static SEQ: AtomicU64 = AtomicU64::new(1);

pub fn current_tid() -> i64 {
    // SAFETY: SYS_gettid takes no arguments and cannot fail.
    unsafe { libc::syscall(libc::SYS_gettid) as i64 }
}

/// Record that `fd` (which pointed at `description` before the call) was just
/// closed successfully by the current thread.
pub fn record_closed(fd: i32, description: FdDescription) {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return;
    }
    let slot = Slot {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        tid: current_tid(),
        description,
        trace: StoredTrace::capture(None),
    };
    let mut ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    let history = &mut ledger[fd as usize];
    history.copy_within(0..HISTORY - 1, 1);
    history[0] = slot;
}

fn history_of(fd: i32) -> [Slot; HISTORY] {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return [Slot::EMPTY; HISTORY];
    }
    let ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    ledger[fd as usize]
}

/// Print the recorded close history of `fd`, newest first.
pub fn dump_history(fd: i32) {
    let history = history_of(fd);
    if history[0].seq == 0 {
        eprintln!(
            "fd {fd}: no successful close recorded through bun_sys (closed by C/C++ code, or never closed)"
        );
        return;
    }
    for slot in history.iter().filter(|s| s.seq != 0) {
        eprintln!(
            "fd {fd} was closed successfully (close #{}, it was \"{}\") on tid {} at:",
            slot.seq,
            slot.description.as_str(),
            slot.tid
        );
        bun_core::dump_stack_trace(&slot.trace.trace(), DumpStackTraceOptions::default());
    }
}

/// Print an EBADF report for a close attempt of `fd` made by `what`: the
/// current stack, then the close history of `fd`.
pub fn report_ebadf(what: &str, fd: i32) {
    let now = StoredTrace::capture(None);
    eprintln!("\n==================== close({fd}) = EBADF ({what}) ====================");
    eprintln!("this close attempt is on tid {} at:", current_tid());
    bun_core::dump_stack_trace(&now.trace(), DumpStackTraceOptions::default());
    dump_history(fd);
    eprintln!("======================================================================\n");
}

/// Event-loop registration events (epoll add/del) per fd, same shape as the
/// close ledger. `kind` is a free-form label supplied by the event loop.
#[derive(Clone, Copy)]
struct RegSlot {
    seq: u64,
    tid: i64,
    kind: [u8; 32],
    description: FdDescription,
    trace: StoredTrace,
}

impl RegSlot {
    const EMPTY: RegSlot = RegSlot {
        seq: 0,
        tid: 0,
        kind: [0; 32],
        description: FdDescription::UNKNOWN,
        trace: StoredTrace::EMPTY,
    };
}

const REG_HISTORY: usize = 6;

static REGISTRATIONS: Mutex<[[RegSlot; REG_HISTORY]; MAX_TRACKED_FD]> =
    Mutex::new([[RegSlot::EMPTY; REG_HISTORY]; MAX_TRACKED_FD]);

/// Record an event-loop registration event for `fd` (`kind` is truncated to 32 bytes).
pub fn record_registration_event(kind: &str, fd: i32) {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return;
    }
    let mut slot = RegSlot {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        tid: current_tid(),
        kind: [0; 32],
        description: FdDescription::of(fd),
        trace: StoredTrace::capture(None),
    };
    let n = kind.len().min(32);
    slot.kind[..n].copy_from_slice(&kind.as_bytes()[..n]);
    let mut table = match REGISTRATIONS.lock() {
        Ok(t) => t,
        Err(poisoned) => poisoned.into_inner(),
    };
    let history = &mut table[fd as usize];
    history.copy_within(0..REG_HISTORY - 1, 1);
    history[0] = slot;
}

fn dump_registration_events(fd: i32) {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return;
    }
    let history = {
        let table = match REGISTRATIONS.lock() {
            Ok(t) => t,
            Err(poisoned) => poisoned.into_inner(),
        };
        table[fd as usize]
    };
    if history[0].seq == 0 {
        eprintln!("fd {fd}: no event-loop registration events recorded");
        return;
    }
    for slot in history.iter().filter(|s| s.seq != 0) {
        let len = slot
            .kind
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(slot.kind.len());
        eprintln!(
            "fd {fd} registration event #{}: {} (fd was \"{}\") on tid {} at:",
            slot.seq,
            core::str::from_utf8(&slot.kind[..len]).unwrap_or("?"),
            slot.description.as_str(),
            slot.tid
        );
        bun_core::dump_stack_trace(&slot.trace.trace(), DumpStackTraceOptions::default());
    }
}

/// Print the current stack plus what `fd`, stdout and stderr point at, the
/// registration events recorded for `fd`, and its close history. Used to
/// report failures to register `fd` with the event loop.
pub fn report_fd_event(what: &str, fd: i32) {
    let now = StoredTrace::capture(None);
    eprintln!("\n==================== {what} ====================");
    eprintln!(
        "fd {fd} is \"{}\"; fd 1 is \"{}\"; fd 2 is \"{}\"; tid {}",
        FdDescription::of(fd).as_str(),
        FdDescription::of(1).as_str(),
        FdDescription::of(2).as_str(),
        current_tid()
    );
    eprintln!("at:");
    bun_core::dump_stack_trace(&now.trace(), DumpStackTraceOptions::default());
    dump_registration_events(fd);
    dump_history(fd);
    eprintln!("======================================================================\n");
}
