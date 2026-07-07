bun_core::declare_scope!(SocketMonitor, visible);

/// Stamps out a debug-only socket-traffic dump module. The reader and writer
/// variants are byte-identical modulo the env var checked and the log message,
/// so `macro_rules!` collapses them into one definition.
#[cfg(debug_assertions)]
macro_rules! debug_socket_monitor {
    ($env:path, $msg:literal) => {
        use core::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Once, OnceLock};

        use bun_sys::File;

        bun_core::declare_scope!(Postgres, visible);

        // Initialized once by `load`; OnceLock for write-once globals.
        static FILE: OnceLock<File> = OnceLock::new();

        pub(crate) static ENABLED: AtomicBool = AtomicBool::new(false);

        // `Once` does not capture the fn; callers do `CHECK.call_once(load)`.
        pub(crate) static CHECK: Once = Once::new();

        pub(crate) fn load() {
            if let Some(monitor) = $env.get() {
                ENABLED.store(true, Ordering::Relaxed);
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
