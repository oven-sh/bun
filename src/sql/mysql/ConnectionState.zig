pub const ConnectionState = enum {
    disconnected,
    connecting,
    handshaking,
    authenticating,
    connected,
    failed,
};
