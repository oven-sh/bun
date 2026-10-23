use std::iter::successors;

use bun_sema::bind::{Binding, Bound, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::File;
use rustc_hash::FxHashMap;

use super::{FileLowering, LoweringOptions, SourceKind};
use crate::ir::StringId;

/// Under --minify-identifiers a binding that a bundle renames has a short name wherever its name is only shown: in `name` of a function, in a frame, in a message.
#[derive(Default)]
pub(super) struct ShownNames {
    shortens_bindings: bool,
    /// In order. A direct eval finds what they declare by what is written.
    scopes_around_evals: Vec<ScopeId>,
    interned: FxHashMap<SymbolId, StringId>,
}

impl ShownNames {
    pub(super) fn new(
        options: LoweringOptions,
        source: SourceKind,
        hir: &File<'_>,
        bound: &Bound<'_>,
    ) -> ShownNames {
        let is_with = |kind| matches!(kind, ScopeKind::With(_));
        if !options.minifies_identifiers
            || source != SourceKind::Program
            || bound.scopes.iter().any(|scope| is_with(scope.kind))
        {
            return ShownNames::default();
        }
        let parent_of = |&scope: &ScopeId| bound.runtime_parent_scope(hir, scope).some();
        let evals = bound.runtime.eval_scopes().iter();
        let mut scopes_around_evals: Vec<ScopeId> = evals
            .flat_map(|(_, eval)| successors(eval.scope.some(), parent_of))
            .collect();
        scopes_around_evals.sort_unstable();
        scopes_around_evals.dedup();
        ShownNames {
            shortens_bindings: true,
            scopes_around_evals,
            interned: FxHashMap::default(),
        }
    }
}

const FIRST_CHARACTERS: &[u8; 54] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const LATER_CHARACTERS: &[u8; 64] =
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$0123456789";

fn append_number(mut number: usize, text: &mut Vec<u8>) {
    text.push(FIRST_CHARACTERS[number % FIRST_CHARACTERS.len()]);
    number /= FIRST_CHARACTERS.len();
    while number > 0 {
        number -= 1;
        text.push(LATER_CHARACTERS[number % LATER_CHARACTERS.len()]);
        number /= LATER_CHARACTERS.len();
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_shortened_symbol(&self, binding: Binding) -> Option<SymbolId> {
        let Binding::Symbol(symbol) = binding else {
            return None;
        };
        let names = &self.shown_names;
        let is_shortened = names.shortens_bindings
            && symbol.is_some()
            && self.bound.has_runtime_value(symbol)
            && (names.scopes_around_evals.is_empty() || {
                let scope = self.bound.symbol_scope(symbol);
                scope.is_some() && names.scopes_around_evals.binary_search(&scope).is_err()
            });
        is_shortened.then_some(symbol)
    }

    /// In a message. One of a few names, so that messages are alike as often as under the names of a bundle. None: the name is shown as it is written.
    pub(crate) fn short_binding_name(&mut self, binding: Binding) -> Option<StringId> {
        let mut text = Vec::new();
        self.append_short_binding_name(binding, &mut text)
            .then(|| self.intern_bytes(&text))
    }

    pub(crate) fn append_short_binding_name(&self, binding: Binding, text: &mut Vec<u8>) -> bool {
        let symbol = self.find_shortened_symbol(binding);
        if let Some(symbol) = symbol {
            append_number(symbol.idx() % FIRST_CHARACTERS.len(), text);
        }
        symbol.is_some()
    }

    /// Of a function or a class that has its name from the binding. No two bindings of the program give one name: a table with such names for keys holds. None: the name is what is written.
    pub(crate) fn short_function_name(&mut self, binding: Binding) -> Option<StringId> {
        let symbol = self.find_shortened_symbol(binding)?;
        if let Some(&name) = self.shown_names.interned.get(&symbol) {
            return Some(name);
        }
        let mut text = Vec::new();
        append_number(
            symbol.idx() * self.inputs.files.len() + self.file.idx(),
            &mut text,
        );
        let name = self.intern_bytes(&text);
        self.shown_names.interned.insert(symbol, name);
        Some(name)
    }
}
