#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Handshaking,
    Authenticating,
    AuthenticationAwaitingPk,
    /// Authenticated; waiting for the OK of the session-setup query
    /// (`SET time_zone`) sent before the connection joins the pool.
    SessionSetup,
    Connected,
    Failed,
}
