// Scratch: the signature of binder/binder.rs:519.
use crate::ast::{Ast, SymbolId};
use crate::core::Text;
pub fn get_symbol_name_for_private_identifier<'a>(
    a: Ast<'a>,
    containing_class_symbol: SymbolId,
    description: &[u8],
) -> Text<'a> {
    unimplemented!()
}
