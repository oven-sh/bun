//! `ast.GetSymbolId`.
//!
//! typescript-go numbers a symbol the first time its id is requested. The id of a `unique symbol`'s symbol is part of
//! the name of the property it names (`getESSymbolLikeTypeForNode`). A few messages print that name, and its length
//! counts where a printed type is truncated. So the ids are observable, and each depends on everything that was checked
//! before.
//!
//! The ids aren't reproduced here. Such a property is named after its declaration's location instead. Only the number of
//! digits matters for the length, and that's known: the checker looks up the symbol's links before it needs the id, and
//! `symbolLinkStore` numbers symbols from `BlockIdOffset` (2^48) up.

use super::*;

/// The number of digits in 2^48 and in the 700 trillion ids after it.
const DIGITS: usize = 15;

impl Checker<'_, '_> {
    /// `name` without the id, if a `unique symbol` names the property: `\xFE@description`.
    fn described(&self, name: Atom) -> Option<&[u8]> {
        if !self.atoms().is_symbol_name(name) {
            return None;
        }
        let text = self.atoms().bytes(name);
        Some(match bun_core::strings::last_index_of_char(text, b'@') {
            Some(at) if at >= crate::atom::SYMBOL_NAME_PREFIX.len() => &text[..at],
            // In this checker the name of `[Symbol.iterator]` has no id.
            _ => text,
        })
    }

    /// `len(symbol.Name)` for a property that a `unique symbol` names.
    pub(super) fn length_of_late_bound_name(&self, name: Atom) -> Option<usize> {
        let described = self.described(name)?.len() + 1;
        Some(described + DIGITS)
    }
}
