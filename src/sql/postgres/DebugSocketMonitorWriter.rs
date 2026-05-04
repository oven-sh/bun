use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

use bun_sys::File;

bun_output::declare_scope!(Postgres, visible);

// Zig: `var file: std.fs.File = undefined;` — module-level mutable, initialized once by `load`.
// SAFETY: written exactly once under `CHECK` (std::sync::Once) before `ENABLED` flips true;
// callers gate on `ENABLED` before calling `write`, so no data race in practice.
static mut FILE: Option<File> = None;

pub static ENABLED: AtomicBool = AtomicBool::new(false);

// Zig: `pub var check = std.once(load);` — callers invoke `check.call()`.
// Rust callers: `CHECK.call_once(load)`.
pub static CHECK: Once = Once::new();

pub fn write(data: &[u8]) {
    // SAFETY: see FILE above — only reached after CHECK has run and ENABLED is true.
    unsafe {
        if let Some(f) = (&raw mut FILE).as_mut().unwrap().as_mut() {
            let _ = f.write_all(data);
        }
    }
}

pub fn load() {
    if let Some(monitor) = bun_core::env_var::BUN_POSTGRES_SOCKET_MONITOR.get() {
        ENABLED.store(true, Ordering::Relaxed);
        // TODO(port): Zig used `std.fs.cwd().createFile(monitor, .{ .truncate = true })`.
        // bun_sys::File API for create+truncate may differ; verify in Phase B.
        let f = match File::create(monitor) {
            bun_sys::Result::Ok(f) => f,
            bun_sys::Result::Err(_) => {
                ENABLED.store(false, Ordering::Relaxed);
                return;
            }
        };
        // SAFETY: only called once via CHECK.call_once(load); no concurrent writer.
        unsafe {
            FILE = Some(f);
        }
        bun_output::scoped_log!(Postgres, "writing to {}", bstr::BStr::new(monitor));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/DebugSocketMonitorWriter.zig (23 lines)
//   confidence: medium
//   todos:      1
//   notes:      module-level mutable file → static mut Option<File> guarded by Once; std.fs replaced with bun_sys::File
// ──────────────────────────────────────────────────────────────────────────
