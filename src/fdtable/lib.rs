//! `bun_fdtable` — the JS-visible fd table (the CRT fd table replacement).
//!
//! Node's API hands JS small-integer fds (`fs.openSync` returns a number,
//! `process.stdout.fd === 1`, `fs.close(fd)` → EBADF on stale fds); libuv
//! borrows the MSVCRT fd table for this. Bun deletes the CRT dependency and
//! owns a minimal table instead. The table is NOT optional: Windows recycles
//! HANDLE values immediately, so raw-HANDLE-as-fd would make a JS
//! double-close silently close an unrelated resource — the table's slot
//! states and internal generation tags restore POSIX close semantics.
//!
//! Design contracts are tracked in `src/sys/windows/quirks/`
//! (`// quirk: <ID>` annotations reference ledger entries); the reference
//! implementation is libuv `src/win/fs.c`'s CRT-fd handling, ported per the
//! `fs-open-io.md` ledger area (FSIO-15..20) minus every CRT mechanism: no
//! `_open_osfhandle`, no `_get_osfhandle`, no `_close`, no text-mode
//! machinery — fds are binary-only by construction and no CRT global is ever
//! touched. // quirk: FSIO-20
//!
//! Error policy: this crate traffics in raw `Win32Error` and never produces
//! an errno — consumers translate exactly once at their boundary via
//! `bun_sys::windows::win_error`. // quirk: SOCK-58

pub mod table;

#[cfg(windows)]
pub use table::{FdFlags, FdKind, FdTable, IoDir, PositionedIo, classify_handle, is_initialized, the};
