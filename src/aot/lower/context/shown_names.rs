use std::iter::successors;

use bun_builtin_sources::BundledName;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::File;
use rustc_hash::FxHashMap;

use super::{FileLowering, LoweringOptions, SourceKind};
use crate::ir::StringId;

/// Under --minify-identifiers a binding that a bundle renames has a short name wherever its name is only shown: in `name` of a function, in a frame, in a message.
/// An obfuscated executable shows no name of a function, and its source map takes those as they are written: only its messages have the short names.
#[derive(Default)]
pub(super) struct ShownNames {
    shortens_bindings: bool,
    /// In order. A direct eval finds what they declare by what is written.
    scopes_around_evals: Vec<ScopeId>,
    /// Those handed out so far. None: a function is shown by the name that is written.
    short_function_names: Option<FxHashMap<SymbolId, StringId>>,
    /// Of a module of Bun's own. In order of position.
    bundled: &'static [BundledName],
}

impl ShownNames {
    pub(super) fn new(
        options: LoweringOptions,
        source: SourceKind,
        hir: &File<'_>,
        bound: &Bound<'_>,
        bundled: &'static [BundledName],
    ) -> ShownNames {
        let is_with = |kind| matches!(kind, ScopeKind::With(_));
        if !(options.minifies_identifiers || options.obfuscates)
            || source != SourceKind::Program
            || bound.scopes.iter().any(|scope| is_with(scope.kind))
        {
            return ShownNames {
                bundled,
                ..ShownNames::default()
            };
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
            short_function_names: options.minifies_identifiers.then(FxHashMap::default),
            bundled,
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

    fn find_bundled_name(&self, position: u32) -> Option<&'static BundledName> {
        let names = self.shown_names.bundled;
        let found = names.binary_search_by_key(&position, |name| name.position);
        Some(&names[found.ok()?])
    }

    /// Of a function or a class that has its name from the identifier at `position`. None: the name is what is written.
    pub(crate) fn shown_function_name(
        &mut self,
        binding: Binding,
        position: u32,
    ) -> Option<StringId> {
        match self.find_bundled_name(position) {
            Some(BundledName { name, .. }) => Some(self.intern_bytes(name.as_deref()?)),
            None => self.short_function_name(binding),
        }
    }

    /// Of an anonymous function or class behind the `export default` at `position`. None: it has no name.
    pub(crate) fn default_export_name(&mut self, position: u32) -> Option<StringId> {
        match self.find_bundled_name(position) {
            Some(BundledName { name, .. }) => Some(self.intern_bytes(name.as_deref()?)),
            None => Some(self.intern_atom(known::default)),
        }
    }

    /// No variable or property gives an anonymous function its name behind the `export default` at `position`: it has the name from the start.
    pub(crate) fn is_default_export_name_its_own(&self, position: u32) -> bool {
        self.find_bundled_name(position)
            .is_none_or(|name| name.is_own_name)
    }

    /// The function whose own name is written at `position` is an anonymous one in a variable in the text that `bun run` evaluates.
    pub(crate) fn is_anonymous_in_bundle(&self, position: u32) -> bool {
        let name = self.find_bundled_name(position);
        name.is_some_and(|name| !name.is_own_name)
    }

    pub(crate) fn intern_function_name(
        &mut self,
        binding: Binding,
        written: Atom,
        position: u32,
    ) -> StringId {
        match self.shown_function_name(binding, position) {
            Some(name) => name,
            None => self.intern_atom(written),
        }
    }

    /// No two bindings of the program give one name: a table with such names for keys holds.
    fn short_function_name(&mut self, binding: Binding) -> Option<StringId> {
        let names = self.shown_names.short_function_names.as_ref()?;
        let symbol = self.find_shortened_symbol(binding)?;
        if let Some(&name) = names.get(&symbol) {
            return Some(name);
        }
        let mut text = Vec::new();
        append_number(
            symbol.idx() * self.inputs.files.len() + self.file.idx(),
            &mut text,
        );
        let name = self.intern_bytes(&text);
        let names = self.shown_names.short_function_names.as_mut()?;
        names.insert(symbol, name);
        Some(name)
    }
}
