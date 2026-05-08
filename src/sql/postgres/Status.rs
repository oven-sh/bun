#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status {
    Disconnected,
    Connecting,
    // Prevent sending the startup message multiple times.
    // Particularly relevant for TLS connections.
    SentStartupMessage,
    Connected,
    Failed,
}

// ported from: src/sql/postgres/Status.zig
