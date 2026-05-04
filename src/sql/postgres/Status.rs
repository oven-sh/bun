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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/Status.zig (9 lines)
//   confidence: high
//   todos:      0
//   notes:      plain enum; no explicit repr in Zig source
// ──────────────────────────────────────────────────────────────────────────
