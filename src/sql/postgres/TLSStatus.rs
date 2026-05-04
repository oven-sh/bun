pub enum TLSStatus {
    None,
    Pending,

    /// Number of bytes sent of the 8-byte SSL request message.
    /// Since we may send a partial message, we need to know how many bytes were sent.
    MessageSent(u8),

    SslNotAvailable,
    SslOk,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/TLSStatus.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      union(enum) → Rust enum; unit variants + one u8 payload
// ──────────────────────────────────────────────────────────────────────────
