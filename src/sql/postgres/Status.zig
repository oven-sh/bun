pub const Status = enum {
    disconnected,
    connecting,
    // Prevent sending the startup message multiple times.
    // Particularly relevant for TLS connections.
    sent_startup_message,
    connected,
    failed,

    pub fn hasPendingActivity(this: Status) bool {
        return switch (this) {
            .connected => false,
            .connecting => true,
            .sent_startup_message => true,
            .failed => false,
            .disconnected => false,
        };
    }
};
