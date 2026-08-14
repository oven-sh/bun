//! Debug-only (`debug_assertions`) diagnostics for double closes.
//!
//! Every successful `close(2)` issued through `bun_sys` records the calling
//! thread and a backtrace, keyed by fd number. When a later close of the same
//! number fails with `EBADF` (a use-after-close, or a second owner closing a
//! descriptor it does not own), the reporter can name the code path that
//! closed it first.
#![allow(clippy::print_stderr)]

use std::backtrace::Backtrace;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

struct Entry {
    seq: u64,
    thread: String,
    backtrace: Backtrace,
}

const MAX_TRACKED_FD: usize = 8192;

static LEDGER: Mutex<Vec<Option<Entry>>> = Mutex::new(Vec::new());
static SEQ: AtomicU64 = AtomicU64::new(0);

fn thread_label() -> String {
    let t = std::thread::current();
    match t.name() {
        Some(name) => format!("{name} ({:?})", t.id()),
        None => format!("{:?}", t.id()),
    }
}

/// Record that `fd` was just closed successfully by the current thread.
pub fn record_closed(fd: i32) {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return;
    }
    let entry = Entry {
        seq: SEQ.fetch_add(1, Ordering::Relaxed),
        thread: thread_label(),
        backtrace: Backtrace::force_capture(),
    };
    let mut ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    let idx = fd as usize;
    if ledger.len() <= idx {
        ledger.resize_with(idx + 1, || None);
    }
    ledger[idx] = Some(entry);
}

/// Human-readable description of the most recent successful close of `fd`.
pub fn describe_last_close(fd: i32) -> String {
    if fd < 0 || fd as usize >= MAX_TRACKED_FD {
        return format!("fd {fd}: out of ledger range");
    }
    let ledger = match LEDGER.lock() {
        Ok(l) => l,
        Err(poisoned) => poisoned.into_inner(),
    };
    match ledger.get(fd as usize).and_then(|e| e.as_ref()) {
        Some(entry) => format!(
            "fd {fd} was last closed successfully (close #{}) on thread {}:\n{}",
            entry.seq, entry.thread, entry.backtrace
        ),
        None => format!("fd {fd}: no successful close recorded through bun_sys (closed by C/C++ code, or never closed)"),
    }
}

/// Print an EBADF report for a close attempt of `fd` made by `what`.
pub fn report_ebadf(what: &str, fd: i32) {
    let now = Backtrace::force_capture();
    eprintln!(
        "\n==================== close({fd}) = EBADF ({what}) ====================\n\
         current thread: {}\n\
         this close attempt came from:\n{now}\n\
         {}\n\
         ======================================================================\n",
        thread_label(),
        describe_last_close(fd),
    );
}
