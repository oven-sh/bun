bun_core::declare_scope!(SocketMonitor, visible);

#[cfg(debug_assertions)]
macro_rules! debug_socket_monitor {
    ($env:path, $msg:literal) => {
        use core::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Once, OnceLock};

        use bun_sys::File;

        bun_core::declare_scope!(Postgres, visible);

        // Zig used a bare module-level `var file: std.fs.File = undefined;`
        // initialized once by `load`. PORTING.md §Concurrency: OnceLock for
        // write-once globals.
        static FILE: OnceLock<File> = OnceLock::new();

        pub(crate) static ENABLED: AtomicBool = AtomicBool::new(false);

        // Zig: `pub var check = std.once(load);` — callers do `check.call()`.
        // Rust's `Once` does not capture the fn; callers do `CHECK.call_once(load)`.
        pub(crate) static CHECK: Once = Once::new();

        pub(crate) fn load() {
            if let Some(monitor) = $env.get() {
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
                bun_core::scoped_log!(Postgres, $msg, bstr::BStr::new(monitor));
            }
        }

        pub(crate) fn write(data: &[u8]) {
            if let Some(file) = FILE.get() {
                let _ = file.write_all(data);
            }
        }
    };
}

#[cfg(debug_assertions)]
mod debug_socket_monitor_writer {
    debug_socket_monitor!(
        bun_core::env_var::BUN_POSTGRES_SOCKET_MONITOR,
        "writing to {}"
    );
}

#[cfg(debug_assertions)]
mod debug_socket_monitor_reader {
    debug_socket_monitor!(
        bun_core::env_var::BUN_POSTGRES_SOCKET_MONITOR_READER,
        "duplicating reads to {}"
    );
}

pub fn write(data: &[u8]) {
    bun_core::scoped_log!(
        SocketMonitor,
        "SocketMonitor: write {}",
        bun_core::fmt::hex_lower(data)
    );
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_writer::CHECK.call_once(debug_socket_monitor_writer::load);
        if debug_socket_monitor_writer::ENABLED.load(core::sync::atomic::Ordering::Relaxed) {
            debug_socket_monitor_writer::write(data);
        }
    }
}

pub fn read(data: &[u8]) {
    bun_core::scoped_log!(
        SocketMonitor,
        "SocketMonitor: read {}",
        bun_core::fmt::hex_lower(data)
    );
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_reader::CHECK.call_once(debug_socket_monitor_reader::load);
        if debug_socket_monitor_reader::ENABLED.load(core::sync::atomic::Ordering::Relaxed) {
            debug_socket_monitor_reader::write(data);
        }
    }
}

// ported from: src/sql/postgres/SocketMonitor.zig
// ported from: src/sql/postgres/DebugSocketMonitorReader.zig
// ported from: src/sql/postgres/DebugSocketMonitorWriter.zig
