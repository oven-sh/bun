use std::iter::successors;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::File;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::{FileLowering, LoweringOptions, SourceKind};
use crate::ir::StringId;
use crate::load::test_runner_names::written_name_of_local;

#[derive(Default)]
pub(super) struct ShownNames {
    shortens_bindings: bool,
    scopes_around_evals: Vec<ScopeId>,
    short_binding_names: Vec<Option<StringId>>,
    short_function_names: Option<FxHashMap<SymbolId, StringId>>,
    pub(super) written_function_names: Vec<u8>,
}

impl ShownNames {
    pub(super) fn new(
        options: LoweringOptions,
        source: SourceKind,
        hir: &File<'_>,
        bound: &Bound<'_>,
    ) -> ShownNames {
        let is_with = |kind| matches!(kind, ScopeKind::With(_));
        if !(options.minifies_identifiers || options.obfuscates)
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
            short_binding_names: vec![None; FIRST_CHARACTERS.len()],
            short_function_names: options.minifies_identifiers.then(FxHashMap::default),
            written_function_names: Vec::new(),
        }
    }
}

const FIRST_CHARACTERS: &[u8; 54] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const LATER_CHARACTERS: &[u8; 64] =
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$0123456789";

fn append_number(mut number: usize, text: &mut SmallVec<[u8; 24]>) {
    text.push(FIRST_CHARACTERS[number % FIRST_CHARACTERS.len()]);
    number /= FIRST_CHARACTERS.len();
    while number > 0 {
        number -= 1;
        text.push(LATER_CHARACTERS[number % LATER_CHARACTERS.len()]);
        number /= LATER_CHARACTERS.len();
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn names_functions_by_keys(&self) -> bool {
        !self.inputs.options.obfuscates
    }

    #[inline]
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

    pub(crate) fn short_binding_name(&mut self, binding: Binding) -> Option<StringId> {
        let symbol = self.find_shortened_symbol(binding)?;
        let number = symbol.idx() % FIRST_CHARACTERS.len();
        if let Some(name) = self.shown_names.short_binding_names[number] {
            return Some(name);
        }
        let name = self.intern_bytes(&[FIRST_CHARACTERS[number]]);
        self.shown_names.short_binding_names[number] = Some(name);
        Some(name)
    }

    pub(crate) fn append_short_binding_name(&self, binding: Binding, text: &mut Vec<u8>) -> bool {
        let symbol = self.find_shortened_symbol(binding);
        if let Some(symbol) = symbol {
            text.push(FIRST_CHARACTERS[symbol.idx() % FIRST_CHARACTERS.len()]);
        }
        symbol.is_some()
    }

    pub(crate) fn default_export_name(&mut self) -> Option<StringId> {
        Some(self.intern_atom(known::default))
    }

    pub(crate) fn intern_function_name(&mut self, binding: Binding, written: Atom) -> StringId {
        match self.short_function_name(binding) {
            Some(name) => name,
            None => self.intern_written_name(written),
        }
    }

    pub(crate) fn intern_variable_name(&mut self, symbol: SymbolId) -> StringId {
        match self.short_function_name(Binding::Symbol(symbol)) {
            Some(name) => name,
            None => self.intern_atom(self.bound.symbol(symbol).name),
        }
    }

    pub(crate) fn short_function_name(&mut self, binding: Binding) -> Option<StringId> {
        let names = self.shown_names.short_function_names.as_ref()?;
        let symbol = self.find_shortened_symbol(binding)?;
        if let Some(&name) = names.get(&symbol) {
            return Some(name);
        }
        let mut text = SmallVec::new();
        append_number(
            symbol.idx() * self.inputs.files.len() + self.file.idx(),
            &mut text,
        );
        let name = self.intern_bytes(&text);
        let written = self.queries.atom_bytes(self.bound.symbol(symbol).name);
        let listed = &mut self.shown_names.written_function_names;
        for part in [&text[..], written_name_of_local(written)] {
            listed.extend_from_slice(part);
            listed.push(0);
        }
        let names = self.shown_names.short_function_names.as_mut()?;
        names.insert(symbol, name);
        Some(name)
    }
}
