mod canonical;
mod find;
mod held_early;
mod private_state;
mod published;
mod quiet;
mod resolve;
mod table;
#[cfg(test)]
mod tests;

pub use self::find::{
    BindingValues, Certainty, FileHelpers, HeldFunction, KnownFunction, KnownReference,
};
use self::held_early::find_files_held_early;
pub use self::private_state::FilePrivateStates;
pub use self::published::{Helper, Shape};
pub use self::quiet::Quiet;
pub use self::resolve::{
    KnownCallee, PrivateFieldAccess, PrivateFieldCall, PrivateMemberKind, PrivateStateKind,
    PrivateStateRole, PrivateStateSite, ResolveInput, ResolvedReference, resolve_callee,
    resolve_private_field_call, resolve_reference,
};

use crate::ir::{InParallel, for_each_mut};
use crate::modules::ModuleGraph;
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{BinOp, ExprId, ExprKind, FnId, NodeData};
use bun_sema::program::{FileId, Files};
use bun_sema::util::FxHashSet;
use std::sync::OnceLock;

pub struct PublishedFunction {
    pub shape: Shape,
    pub text: &'static str,
    pub references: &'static [(&'static str, Reference)],
    pub origin: &'static str,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Reference {
    Helper(Helper),
    Global(&'static [&'static str]),
}

#[derive(Default)]
pub struct KnownHelpers {
    files: Vec<FileHelpers>,
    private_states: Vec<OnceLock<FilePrivateStates>>,
    binding_names: FxHashSet<Atom>,
}

fn find_by_key<K: Ord + Copy, V>(sorted: &[(K, V)], key: K) -> Option<&V> {
    let at = sorted.binary_search_by(|entry| entry.0.cmp(&key));
    at.ok().map(|at| &sorted[at].1)
}

fn reads_private_state(helper: Helper) -> bool {
    matches!(
        helper,
        Helper::ClassPrivateFieldGet | Helper::ClassPrivateFieldSet | Helper::ClassPrivateFieldIn
    )
}

impl KnownHelpers {
    pub fn compute(files: &Files<'_>, in_parallel: InParallel<'_>) -> KnownHelpers {
        let mut found: Vec<(FileId, FileHelpers)> = files
            .compiled_files()
            .iter()
            .map(|&file| (file, FileHelpers::default()))
            .collect();
        let held_early = OnceLock::new();
        for_each_mut(&mut found, in_parallel, &|(file, helpers)| {
            let is_held_early =
                || held_early.get_or_init(|| find_files_held_early(files))[file.idx()];
            *helpers = find::find_in_file(files, *file, &is_held_early);
        });
        let file_count = files.modules.len();
        let mut known = KnownHelpers::default();
        known.files.resize_with(file_count, FileHelpers::default);
        let mut has_private_state = false;
        for (file, helpers) in found {
            let bound = files.bound(file);
            let names = helpers
                .bindings()
                .map(|(symbol, _)| bound.symbol(symbol).name);
            known.binding_names.extend(names);
            has_private_state |= helpers
                .functions()
                .any(|(_, function)| reads_private_state(function.shape.helper()));
            known.files[file.idx()] = helpers;
        }
        if has_private_state {
            known.private_states.resize_with(file_count, OnceLock::new);
        }
        known
    }

    pub fn has_bindings(&self) -> bool {
        !self.binding_names.is_empty()
    }

    pub fn is_binding_name(&self, name: Atom) -> bool {
        self.binding_names.contains(&name)
    }

    pub fn file(&self, file: FileId) -> Option<&FileHelpers> {
        self.files.get(file.idx())
    }

    pub fn has_functions(&self, file: FileId) -> bool {
        let helpers = self.file(file);
        helpers.is_some_and(|helpers| helpers.functions().len() != 0)
    }

    pub fn function(&self, file: FileId, function: FnId) -> Option<&KnownFunction> {
        self.file(file)?.function(function)
    }

    pub fn binding(&self, file: FileId, symbol: SymbolId) -> Option<&BindingValues> {
        self.file(file)?.binding(symbol)
    }

    pub fn private_states(
        &self,
        files: &Files<'_>,
        modules: &ModuleGraph,
        file: FileId,
    ) -> Option<&FilePrivateStates> {
        let states = self.private_states.get(file.idx())?;
        Some(states.get_or_init(|| {
            let input = ResolveInput {
                files,
                modules,
                helpers: self,
            };
            private_state::find_in_file(&input, file)
        }))
    }

    fn find_called_symbol(files: &Files<'_>, file: FileId, callee: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (files.hir(file), files.bound(file));
        let mut callee = hir.skip_type_assertions(callee);
        // `(0, helper)(..)`
        while let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } = hir[callee].kind
        {
            if !matches!(
                hir[hir.skip_type_assertions(left)].kind,
                ExprKind::Number(_)
            ) {
                return None;
            }
            callee = hir.skip_type_assertions(right);
        }
        let is_plain_name = matches!(hir[callee].kind, ExprKind::Ident(_))
            && bound.dynamic_lookup_scope(NodeData::Expr(callee)).is_none();
        match bound.binding(callee) {
            Binding::Symbol(symbol) if is_plain_name => Some(symbol),
            _ => None,
        }
    }

    /// The helper that a callee is whenever the call runs.
    pub fn certain_callee(
        &self,
        files: &Files<'_>,
        file: FileId,
        callee: ExprId,
    ) -> Option<&KnownFunction> {
        let values = self.binding(file, KnownHelpers::find_called_symbol(files, file, callee)?)?;
        let [held] = values.functions[..] else {
            return None;
        };
        let known = self.function(file, held.definition)?;
        (values.holds_from_the_start && known.relies_on_facts).then_some(known)
    }
}
