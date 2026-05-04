use super::debug_socket_monitor_reader;
use super::debug_socket_monitor_writer;

bun_output::declare_scope!(SocketMonitor, visible);

pub fn write(data: &[u8]) {
    // TODO(port): Zig `{x}` formats the slice as contiguous lowercase hex; verify
    // `bun_core::fmt::hex` matches that output exactly.
    bun_output::scoped_log!(SocketMonitor, "SocketMonitor: write {}", bun_core::fmt::hex(data));
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_writer::CHECK.call();
        if debug_socket_monitor_writer::enabled() {
            debug_socket_monitor_writer::write(data);
        }
    }
}

pub fn read(data: &[u8]) {
    bun_output::scoped_log!(SocketMonitor, "SocketMonitor: read {}", bun_core::fmt::hex(data));
    #[cfg(debug_assertions)]
    {
        debug_socket_monitor_reader::CHECK.call();
        if debug_socket_monitor_reader::enabled() {
            debug_socket_monitor_reader::write(data);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/SocketMonitor.zig (25 lines)
//   confidence: medium
//   todos:      1
//   notes:      `check`/`enabled` shape depends on sibling DebugSocketMonitor* ports; hex fmt helper assumed in bun_core::fmt
// ──────────────────────────────────────────────────────────────────────────
