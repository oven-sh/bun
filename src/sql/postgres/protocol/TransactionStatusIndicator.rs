// Any u8 value is valid storage (the wire can carry bytes outside {I, T, E}).
// A Rust `#[repr(u8)] enum` would be UB for such values, so this is a
// transparent u8 newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct TransactionStatusIndicator(pub u8);

impl TransactionStatusIndicator {
    /// if idle (not in a transaction block)
    pub(crate) const I: Self = Self(b'I');
}
