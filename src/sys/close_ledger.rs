//! Debug-only (`debug_assertions`) diagnostics for double closes.
//!
//! Every successful `close(2)` issued through `bun_sys` records the calling
//! thread and a frame-pointer stack trace, keyed by fd number. When a later
//! close of the same number fails with `EBADF` (a use-after-close, or a second
//! owner closing a descriptor it does not own), the reporter prints the code
//! path that closed it first. Traces are printed as raw return addresses
//! (symbolize them against the binary with llvm-symbolizer).
#![allow(clippy::print_stderr)]

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_core::{DumpStackTraceOptions, StoredTrace};

#[derive(Clone, Copy)]
struct Slot {
    /// 0 = never recorded.
    seq: u64,
    tid: i64,
    trace: StoredTrace,
}

impl Slot {
    const EMPTY: Slot = Slot {
        seq: 0,
        tid: 0,
        trace: StoredTrace::EMPTY,
    };
}

const MAX_TRACKED_FD: usize = 4096;

static LEDGER: Mutex<[Slot; MAX_TRACKED_FD]> = Mutex::new([Slot::EMPTY; MAX_TRACKED_FD]);
static SEQ: AtomicU64 = AtomicU64::new(1);

pub fn current_tid() -> i64 {
    // SAFETY: SYS_gettid takes no arguments and cannot fail.
    unsafe { libc::syscall(libc::SYS_gettid) as i64 }
}

/// Record that `fd` was just closed successfully by the current thread.
pub fn record_closed(fd: i32) {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return;
    }
    let slot = Slot {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        tid: current_tid(),
        trace: StoredTrace::capture(None),
    };
    let mut ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    ledger[fd as usize] = slot;
}

fn last_close(fd: i32) -> Option<Slot> {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return None;
    }
    let ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    let slot = ledger[fd as usize];
    (slot.seq != 0).then_some(slot)
}

/// Print an EBADF report for a close attempt of `fd` made by `what`: the
/// current stack, then the stack that closed `fd` last.
pub fn report_ebadf(what: &str, fd: i32) {
    let now = StoredTrace::capture(None);
    eprintln!("\n==================== close({fd}) = EBADF ({what}) ====================");
    eprintln!("this close attempt is on tid {} at:", current_tid());
    bun_core::dump_stack_trace(&now.trace(), DumpStackTraceOptions::default());
    match last_close(fd) {
        Some(slot) => {
            eprintln!(
                "fd {fd} was last closed successfully (close #{}) on tid {} at:",
                slot.seq, slot.tid
            );
            bun_core::dump_stack_trace(&slot.trace.trace(), DumpStackTraceOptions::default());
        }
        None => eprintln!(
            "fd {fd}: no successful close recorded through bun_sys (closed by C/C++ code, or never closed)"
        ),
    }
    eprintln!("======================================================================\n");
}
