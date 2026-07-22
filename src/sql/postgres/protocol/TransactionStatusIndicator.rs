// Any u8 value is valid storage (the wire can carry bytes outside {I, T, E}).
// A Rust `#[repr(u8)] enum` would be UB for such values, so this is a
// transparent u8 newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct TransactionStatusIndicator(pub(crate) u8);

impl TransactionStatusIndicator {
}
