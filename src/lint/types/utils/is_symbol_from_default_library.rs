//! `isSymbolFromDefaultLibrary.ts`

use crate::types::TsSymbol;

/// `isSymbolFromDefaultLibrary(program, symbol)`: one of its declarations is in a `lib.*.d.ts` of
/// TypeScript. Takes a symbol or an `Option` of one.
pub fn is_symbol_from_default_library<'a>(symbol: impl Into<Option<TsSymbol<'a>>>) -> bool {
    let Some(symbol) = symbol.into() else {
        return false;
    };
    symbol
        .declarations()
        .any(|declaration| declaration.get_source_file().is_default_library())
}
