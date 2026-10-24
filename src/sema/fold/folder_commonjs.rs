use super::folder::{Effects, Folded, Folder};
use crate::atom::{Atom, known};
use crate::bind::{Binding, Bound, CodeUnit, CommonJsVariable, has_mapped_arguments};
use crate::hir::{ExprId, ExprKind, File};
use crate::import_sites::is_free_common_js;
use crate::module_format::{EsmSyntax, collect_this_of_file, file_esm_syntax};

const VARIABLE_COUNT: usize = 5;

/// What the text of a file can do to `module`, `exports`, `require`, `__filename` and `__dirname`.
pub(super) struct LoaderNames {
    esm_syntax: EsmSyntax,
    is_stored: [bool; VARIABLE_COUNT],
    // A direct `eval` names them, and the mapped `arguments` of the function around a CommonJS file are their other names.
    is_stored_out_of_sight: bool,
}

impl LoaderNames {
    fn of(hir: &File<'_>, bound: &Bound<'_>) -> LoaderNames {
        let mut is_stored = [false; VARIABLE_COUNT];
        for &(target, _) in bound.runtime.unbound_name_stores() {
            if let Binding::CommonJs(variable) = bound.binding(target) {
                is_stored[variable as usize] = true;
            }
        }
        let names_mapped_arguments =
            bound.file_uses_arguments() && has_mapped_arguments(hir, CodeUnit::File);
        LoaderNames {
            esm_syntax: file_esm_syntax(hir),
            is_stored,
            is_stored_out_of_sight: names_mapped_arguments
                || !bound.runtime.eval_scopes().is_empty(),
        }
    }
}

fn type_of(variable: CommonJsVariable) -> Atom {
    match variable {
        CommonJsVariable::Module | CommonJsVariable::Exports => known::object,
        CommonJsVariable::Require => known::function,
        CommonJsVariable::Filename | CommonJsVariable::Dirname => known::string,
    }
}

impl<'s> Folder<'_, 's> {
    fn loader_names(&self) -> &LoaderNames {
        self.loader_names
            .get_or_init(|| LoaderNames::of(self.hir, self.bound))
    }

    pub(super) fn is_replaced_by_define(&self, e: ExprId) -> bool {
        let state = self.path_states.get(&e);
        state.is_some_and(|&state| self.inputs.value_of(state).is_some())
    }

    /// The one of the five names that `e` reads, where it holds what the loader has put there in every run.
    pub(super) fn find_loader_name(&self, e: ExprId) -> Option<CommonJsVariable> {
        let Binding::CommonJs(variable) = self.bound.binding(e) else {
            return None;
        };
        if !is_free_common_js(self.hir, self.bound, e, variable) || self.is_replaced_by_define(e) {
            return None;
        }
        let names = self.loader_names();
        let is_name_of_commonjs_alone = match variable {
            CommonJsVariable::Module | CommonJsVariable::Exports => true,
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
                false
            }
        };
        let is_unchanged = !names.is_stored[variable as usize]
            && !names.is_stored_out_of_sight
            && !(is_name_of_commonjs_alone && names.esm_syntax == EsmSyntax::ExportOrTopLevelAwait);
        is_unchanged.then_some(variable)
    }

    /// A live `this` of the file makes a file without ES module syntax a CommonJS module, whose body is called on its exports object.
    fn is_this_of_commonjs_file(&self, e: ExprId) -> bool {
        matches!(self.hir[e].kind, ExprKind::This)
            && self.loader_names().esm_syntax == EsmSyntax::None
            && self
                .this_of_file
                .get_or_init(|| collect_this_of_file(self.hir))
                .contains(e.idx())
    }

    // An object, a function or a path: true in a test, and reading it does nothing.
    pub(super) fn note_loader_value(&mut self, e: ExprId) -> Folded {
        self.conditions.insert(e, true);
        self.effects[e.idx()] = Effects::None;
        Folded::UNKNOWN
    }

    pub(super) fn fold_loader_name(&mut self, e: ExprId) -> Folded {
        match self.find_loader_name(e) {
            Some(_) => self.note_loader_value(e),
            None => Folded::UNKNOWN,
        }
    }

    pub(super) fn fold_this(&mut self, e: ExprId) -> Folded {
        match self.is_this_of_commonjs_file(e) {
            true => self.note_loader_value(e),
            false => Folded::UNKNOWN,
        }
    }

    /// What `typeof` answers for one of the five names and for the `this` of a CommonJS file: every UMD header asks.
    pub(super) fn find_type_of_loader_value(&self, operand: ExprId) -> Option<Atom> {
        let operand = self.hir.skip_type_assertions(operand);
        if self.is_this_of_commonjs_file(operand) {
            return Some(known::object);
        }
        self.find_loader_name(operand).map(type_of)
    }

    /// Whether `e` is true in a test and evaluating it does nothing, although the build does not know the value.
    pub(super) fn is_truthy_without_effects(&self, e: ExprId) -> bool {
        self.conditions.get(&e) == Some(&true) && self.effects[e.idx()] == Effects::None
    }

    pub(super) fn copy_loader_value(&mut self, e: ExprId, source: ExprId) {
        if self.is_truthy_without_effects(source) {
            self.note_loader_value(e);
        }
    }
}
