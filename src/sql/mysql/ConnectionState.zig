pub const ConnectionState = enum {
    disconnected,
    connecting,
    handshaking,
    authenticating,
    authentication_awaiting_pk,
    connected,
    failed,
};
