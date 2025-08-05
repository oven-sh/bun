pub const Status = enum {
    disconnected,
    connecting,
    // Prevent sending the startup message multiple times.
    // Particularly relevant for TLS connections.
    sent_startup_message,
    connected,
    failed,
};
