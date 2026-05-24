// PORT NOTE: Zig source is `enum(u8) { ..., _ }` — a *non-exhaustive* enum, meaning any
// u8 value is valid storage (the `_` arm). A Rust `#[repr(u8)] enum` would be UB for
// values outside {I, T, E}, so this is ported as a transparent u8 newtype with
// associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct TransactionStatusIndicator(pub u8);

impl TransactionStatusIndicator {
    /// if idle (not in a transaction block)
    pub(crate) const I: Self = Self(b'I');
}

// ported from: src/sql/postgres/protocol/TransactionStatusIndicator.zig
