#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum TLSStatus {
    None,
    Pending,

    /// Number of bytes sent of the 8-byte SSL request message.
    /// Since we may send a partial message, we need to know how many bytes were sent.
    MessageSent,

    SslNotAvailable,
    SslFailed,
    SslOk,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/TLSStatus.zig (12 lines)
//   confidence: high
//   todos:      0
//   notes:      union(enum) with unit-only variants → plain Rust enum
// ──────────────────────────────────────────────────────────────────────────
