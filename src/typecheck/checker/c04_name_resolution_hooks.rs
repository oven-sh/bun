// checker.go:1505-2200 (layer N-RESOLVE): the functions of 2182-2200: the symbol of a name in a symbol table for a meaning, through merged symbols and alias targets.
use crate::ast::{SymbolFlags, SymbolId, SymbolTableId};
use crate::checker::Checker;

impl<'a> Checker<'a> {
    pub fn get_symbol(
        &mut self,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        let a = self.ast;
        if meaning.intersects(SymbolFlags::ALL) {
            let symbol = self.get_merged_symbol(a.table_get(symbols, name));
            if !symbol.is_nil() {
                if a.sym(symbol).flags.intersects(meaning) {
                    return symbol;
                }
                if a.sym(symbol).flags.intersects(SymbolFlags::ALIAS) {
                    let target_flags = self.get_symbol_flags(symbol);
                    // `targetFlags` will be `SymbolFlags.All` if an error occurred in alias resolution; this avoids cascading errors
                    if target_flags.intersects(meaning) {
                        return symbol;
                    }
                }
            }
        }
        // return nil if we can't find a symbol
        SymbolId::NIL
    }
}
