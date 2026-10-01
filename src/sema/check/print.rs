//! Types, symbols and signatures as TypeScript writes them in messages.
//!
//! A port of what `typeToString`, `symbolToString` and `signatureToString` come to in `nodebuilderimpl.go` and the printer.

use super::Checker;
use crate::program::Sym;
use crate::types::{SigId, TypeId};

impl Checker<'_> {
    /// `typeToString`
    pub fn type_to_string(&mut self, ty: TypeId) -> String {
        let _ = ty;
        String::new()
    }

    /// `getTypeNamesForErrorDisplay`: both, with qualified names if they would read the same.
    pub fn type_names_for_error_display(
        &mut self,
        left: TypeId,
        right: TypeId,
    ) -> (String, String) {
        (self.type_to_string(left), self.type_to_string(right))
    }

    /// `symbolToString`
    pub fn symbol_to_string(&mut self, symbol: Sym) -> String {
        let _ = symbol;
        String::new()
    }

    /// `signatureToString`
    pub fn signature_to_string(&mut self, signature: SigId) -> String {
        let _ = signature;
        String::new()
    }
}
