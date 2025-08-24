pub const ConnectionState = enum {
    disconnected,
    connecting,
    handshaking,
    authenticating,
    authentication_awaiting_pk,
    connected,
    failed,

    pub fn hasPendingActivity(this: ConnectionState) bool {
        return switch (this) {
            .connected => false,
            .connecting => true,
            .handshaking => true,
            .authenticating => true,
            .authentication_awaiting_pk => true,
            .failed => false,
            .disconnected => false,
        };
    }
};
