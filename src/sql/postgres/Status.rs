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

impl Status {
    pub fn is_closed(self) -> bool {
        matches!(self, Status::Disconnected | Status::Failed)
    }
}
