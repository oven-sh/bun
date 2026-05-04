use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

use bun_core::env_var;
use bun_sys::File;

bun_output::declare_scope!(Postgres, visible);

// TODO(port): Zig used a bare module-level `var file: std.fs.File = undefined;`.
// Rust statics cannot be left uninitialized; wrap in Option and guard with CHECK/Once.
static mut FILE: Option<File> = None;

pub static ENABLED: AtomicBool = AtomicBool::new(false);

// Zig: `pub var check = std.once(load);` — callers do `check.call()`.
// Rust's `Once` does not capture the fn; callers do `CHECK.call_once(load)`.
pub static CHECK: Once = Once::new();

pub fn load() {
    if let Some(monitor) = env_var::BUN_POSTGRES_SOCKET_MONITOR_READER.get() {
        ENABLED.store(true, Ordering::Relaxed);
        // TODO(port): Zig called `std.fs.cwd().createFile(monitor, .{ .truncate = true })`.
        // std::fs is banned; map to bun_sys open-for-write+truncate. Exact bun_sys API TBD in Phase B.
        let f = match File::create(bun_sys::Fd::cwd(), monitor, /* truncate = */ true) {
            Ok(f) => f,
            Err(_) => {
                ENABLED.store(false, Ordering::Relaxed);
                return;
            }
        };
        // SAFETY: only mutated inside CHECK.call_once(load); no concurrent access.
        unsafe {
            FILE = Some(f);
        }
        bun_output::scoped_log!(Postgres, "duplicating reads to {}", bstr::BStr::new(monitor));
    }
}

pub fn write(data: &[u8]) {
    // SAFETY: FILE is only written once under Once; reads happen after ENABLED is observed true.
    unsafe {
        if let Some(file) = FILE.as_ref() {
            let _ = file.write_all(data);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/DebugSocketMonitorReader.zig (23 lines)
//   confidence: medium
//   todos:      2
//   notes:      static-mut File + Once replaces Zig module vars; bun_sys::File::create signature needs Phase B verification; ENABLED is AtomicBool (callers must .load())
// ──────────────────────────────────────────────────────────────────────────
