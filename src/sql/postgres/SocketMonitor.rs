use super::debug_socket_monitor_reader;
use super::debug_socket_monitor_writer;

bun_core::declare_scope!(SocketMonitor, visible);

pub fn write(data: &[u8]) {
    bun_core::scoped_log!(SocketMonitor, "SocketMonitor: write {}", bun_core::fmt::hex_lower(data));
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_writer::CHECK.call_once(debug_socket_monitor_writer::load);
        if debug_socket_monitor_writer::ENABLED.load(core::sync::atomic::Ordering::Relaxed) {
            debug_socket_monitor_writer::write(data);
        }
    }
}

pub fn read(data: &[u8]) {
    bun_core::scoped_log!(SocketMonitor, "SocketMonitor: read {}", bun_core::fmt::hex_lower(data));
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_reader::CHECK.call_once(debug_socket_monitor_reader::load);
        if debug_socket_monitor_reader::ENABLED.load(core::sync::atomic::Ordering::Relaxed) {
            debug_socket_monitor_reader::write(data);
        }
    }
}

// ported from: src/sql/postgres/SocketMonitor.zig
