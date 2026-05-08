use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, OnceLock};

use bun_sys::File;

bun_core::declare_scope!(Postgres, visible);

// Zig: `var file: std.fs.File = undefined;` — module-level mutable, initialized
// once by `load`. PORTING.md §Concurrency: OnceLock for write-once globals.
static FILE: OnceLock<File> = OnceLock::new();

pub static ENABLED: AtomicBool = AtomicBool::new(false);

// Zig: `pub var check = std.once(load);` — callers invoke `check.call()`.
// Rust callers: `CHECK.call_once(load)`.
pub static CHECK: Once = Once::new();

pub fn write(data: &[u8]) {
    if let Some(f) = FILE.get() {
        let _ = f.write_all(data);
    }
}

pub fn load() {
    if let Some(monitor) = bun_core::env_var::BUN_POSTGRES_SOCKET_MONITOR.get() {
        ENABLED.store(true, Ordering::Relaxed);
        // Zig used `std.fs.cwd().createFile(monitor, .{ .truncate = true })`.
        let f = match File::create(bun_sys::Fd::cwd(), monitor, /* truncate = */ true) {
            Ok(f) => f,
            Err(_) => {
                ENABLED.store(false, Ordering::Relaxed);
                return;
            }
        };
        let _ = FILE.set(f);
        bun_core::scoped_log!(Postgres, "writing to {}", bstr::BStr::new(monitor));
    }
}

// ported from: src/sql/postgres/DebugSocketMonitorWriter.zig
