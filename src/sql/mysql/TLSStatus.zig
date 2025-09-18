pub const TLSStatus = union(enum) {
    none,
    pending,

    /// Number of bytes sent of the 8-byte SSL request message.
    /// Since we may send a partial message, we need to know how many bytes were sent.
    message_sent,

    ssl_not_available,
    ssl_failed,
    ssl_ok,
};
