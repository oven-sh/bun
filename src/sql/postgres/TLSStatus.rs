#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum TLSStatus {
    None,
    Pending,

    /// Number of bytes sent of the 8-byte SSL request message.
    /// Since we may send a partial message, we need to know how many bytes were sent.
    MessageSent(u8),

    SslNotAvailable,
    SslOk,
}

// ported from: src/sql/postgres/TLSStatus.zig
