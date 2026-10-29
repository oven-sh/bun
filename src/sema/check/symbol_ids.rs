//! `ast.GetSymbolId`.
//!
//! typescript-go numbers a symbol the first time its id is requested: by the binder for the class of an `#x`, by the
//! checker for some cache keys (`keyBuilder.writeSymbol`, `enumRelation`), by the node builder for the symbols it
//! prints. The id of a `unique symbol`'s symbol is part of the name of the property it names
//! (`getESSymbolLikeTypeForNode`). A few messages print that name, and its length counts where a printed type is
//! truncated. So the ids are observable, and each depends on everything that was checked before.
//!
//! The ids aren't reproduced here. Such a property is named after its declaration's location instead, and its id is
//! assumed to have `ASSUMED_DIGITS` digits.

use super::*;

/// The assumed number of digits in an id.
const ASSUMED_DIGITS: usize = 4;

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
        Some(described + ASSUMED_DIGITS)
    }
}
