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

// ported from: src/sql/mysql/ConnectionState.zig
