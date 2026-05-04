#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Handshaking,
    Authenticating,
    AuthenticationAwaitingPk,
    Connected,
    Failed,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/ConnectionState.zig (9 lines)
//   confidence: high
//   todos:      0
//   notes:      plain enum, no explicit repr in Zig; add #[repr(u8)] if FFI/layout required
// ──────────────────────────────────────────────────────────────────────────
