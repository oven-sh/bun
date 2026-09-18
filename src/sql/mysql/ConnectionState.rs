#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Handshaking,
    Authenticating,
    AuthenticationAwaitingPk,
    /// Authenticated; awaiting the OK of the session-setup `SET time_zone`.
    SessionSetup,
    Connected,
    Failed,
}
