use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Once, OnceLock};

use bun_core::env_var;
use bun_sys::File;

bun_core::declare_scope!(Postgres, visible);

// Zig used a bare module-level `var file: std.fs.File = undefined;` initialized
// once by `load`. PORTING.md §Concurrency: OnceLock for write-once globals.
static FILE: OnceLock<File> = OnceLock::new();

pub static ENABLED: AtomicBool = AtomicBool::new(false);

// Zig: `pub var check = std.once(load);` — callers do `check.call()`.
// Rust's `Once` does not capture the fn; callers do `CHECK.call_once(load)`.
pub static CHECK: Once = Once::new();

pub fn load() {
    if let Some(monitor) = env_var::BUN_POSTGRES_SOCKET_MONITOR_READER.get() {
        ENABLED.store(true, Ordering::Relaxed);
        // Zig called `std.fs.cwd().createFile(monitor, .{ .truncate = true })`.
        let f = match File::create(bun_sys::Fd::cwd(), monitor, /* truncate = */ true) {
            Ok(f) => f,
            Err(_) => {
                ENABLED.store(false, Ordering::Relaxed);
                return;
            }
        };
        let _ = FILE.set(f);
        bun_core::scoped_log!(Postgres, "duplicating reads to {}", bstr::BStr::new(monitor));
    }
}

pub fn write(data: &[u8]) {
    if let Some(file) = FILE.get() {
        let _ = file.write_all(data);
    }
}

// ported from: src/sql/postgres/DebugSocketMonitorReader.zig
