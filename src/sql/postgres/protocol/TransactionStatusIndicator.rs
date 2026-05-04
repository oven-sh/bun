// PORT NOTE: Zig source is `enum(u8) { ..., _ }` — a *non-exhaustive* enum, meaning any
// u8 value is valid storage (the `_` arm). A Rust `#[repr(u8)] enum` would be UB for
// values outside {I, T, E}, so this is ported as a transparent u8 newtype with
// associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct TransactionStatusIndicator(pub u8);

impl TransactionStatusIndicator {
    /// if idle (not in a transaction block)
    pub const I: Self = Self(b'I');

    /// if in a transaction block
    pub const T: Self = Self(b'T');

    /// if in a failed transaction block
    pub const E: Self = Self(b'E');

    #[inline]
    pub const fn from_raw(n: u8) -> Self {
        Self(n)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/TransactionStatusIndicator.zig (12 lines)
//   confidence: high
//   todos:      0
//   notes:      non-exhaustive enum(u8) → #[repr(transparent)] u8 newtype + assoc consts
// ──────────────────────────────────────────────────────────────────────────
