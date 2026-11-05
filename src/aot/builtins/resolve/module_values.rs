use super::BuiltinPath;
use super::resolver::{ExprState, HolderKind, Resolver};
use crate::builtins::table::{self, BuiltinId, Mutability};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, Parent, has_mapped_arguments};
use bun_sema::hir::{ExprId, ExprKind, NodeData, StmtKind};
use bun_sema::module_format::ModuleFormat;

pub fn commonjs_variable_builtin(variable: CommonJsVariable) -> Option<BuiltinId> {
    match variable {
        CommonJsVariable::Require => Some(BuiltinId::ModuleRequire),
        CommonJsVariable::Module => Some(BuiltinId::ModuleObject),
        CommonJsVariable::Exports => Some(BuiltinId::ModuleObjectExports),
        CommonJsVariable::Filename => Some(BuiltinId::ImportMetaPath),
        CommonJsVariable::Dirname => Some(BuiltinId::ImportMetaDir),
    }
}

fn import_meta_location(variable: CommonJsVariable) -> Option<BuiltinId> {
    match variable {
        CommonJsVariable::Require => Some(BuiltinId::ImportMetaRequire),
        CommonJsVariable::Filename => Some(BuiltinId::ImportMetaPath),
        CommonJsVariable::Dirname => Some(BuiltinId::ImportMetaDir),
        CommonJsVariable::Module | CommonJsVariable::Exports => None,
    }
}

impl Resolver<'_, '_> {
    pub(super) fn resolve_commonjs_variables(&mut self) {
        match self.input.module_format {
            ModuleFormat::CommonJs => self.resolve_wrapper_parameters(),
            ModuleFormat::Esm => self.resolve_import_meta_reads(),
        }
    }

    fn resolve_wrapper_parameters(&mut self) {
        let input = self.input;
        let mut stores_module = false;
        let mut stores_exports = false;
        let mut stores_require = false;
        let mut stores_filename = false;
        let mut stores_dirname = false;
        for &(target, _) in input.bound.runtime.unbound_name_stores() {
            if input.decisions.is_dead_expr(target) {
                continue;
            }
            match input.bound.binding(target) {
                Binding::CommonJs(CommonJsVariable::Module) => stores_module = true,
                Binding::CommonJs(CommonJsVariable::Exports) => {
                    stores_exports = true;
                    self.stores_to_exports.push(target);
                }
                Binding::CommonJs(CommonJsVariable::Require) => stores_require = true,
                Binding::CommonJs(CommonJsVariable::Filename) => stores_filename = true,
                Binding::CommonJs(CommonJsVariable::Dirname) => stores_dirname = true,
                Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => {}
            }
        }
        let direct_evals = input.bound.runtime.eval_scopes();
        let has_direct_eval = direct_evals
            .iter()
            .any(|&(call, _)| !input.decisions.is_dead_expr(call));
        let uses_arguments = input
            .bound
            .ident_bindings()
            .iter()
            .any(|&(ident, binding)| {
                binding == Binding::Arguments(CodeUnit::File)
                    && !input.decisions.is_dead_expr(ident)
            });
        let is_mapped = uses_arguments && has_mapped_arguments(input.hir, CodeUnit::File);
        for (variable, is_stored) in [
            (CommonJsVariable::Module, stores_module),
            (CommonJsVariable::Exports, stores_exports),
            (CommonJsVariable::Require, stores_require),
            (CommonJsVariable::Filename, stores_filename),
            (CommonJsVariable::Dirname, stores_dirname),
        ] {
            let mutability = match is_stored || has_direct_eval || is_mapped {
                true => Mutability::ConstantUnlessWritten,
                false => Mutability::AlwaysLocked,
            };
            let id = commonjs_variable_builtin(variable);
            let id = id.filter(|&id| table::exists_on(id, input.platform));
            self.commonjs
                .set(variable, id.map(|id| BuiltinPath { id, mutability }));
            if has_direct_eval || uses_arguments {
                self.expose_commonjs_variable(variable);
            }
            // The body of such a file is entered with all five values. What a store to `exports` is shows once `module.exports` is resolved.
            self.exposes_own_module_object |= is_stored && variable != CommonJsVariable::Exports;
        }
        for &(_, variable) in input.bound.runtime.redeclared_commonjs_variables() {
            self.expose_commonjs_variable(variable);
        }
    }

    fn is_stored_with_module_exports(&self, target: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Parent::Expr(outer) = bound.parent_of_expr(target) else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target: stored,
            value,
        } = hir[outer].kind
        else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target: inner,
            ..
        } = hir[hir.skip_type_assertions(value)].kind
        else {
            return false;
        };
        let Parent::Stmt(statement) = bound.parent_of_expr(outer) else {
            return false;
        };
        let names_module_exports = hir.member_key(inner).is_some()
            && matches!(self.state(inner), ExprState::Builtin(value)
                if value.kind == HolderKind::Object && value.path.id == BuiltinId::ModuleObjectExports);
        stored == target
            && names_module_exports
            && matches!(hir[statement].kind, StmtKind::Expr(_))
            && bound.parent_of_stmt(statement) == Parent::File
    }

    // Any other store to `exports` can only be said of a function that has the five names as parameters.
    pub(super) fn classify_stores_to_exports(&mut self) {
        for target in core::mem::take(&mut self.stores_to_exports) {
            match self.is_stored_with_module_exports(target) {
                true => self.output.stores_with_module_exports.push(target),
                false => self.exposes_own_module_object = true,
            }
        }
    }

    fn resolve_import_meta_reads(&mut self) {
        let platform = self.input.platform;
        let holder_mutability = table::entry(BuiltinId::ImportMeta).mutability;
        for variable in [
            CommonJsVariable::Require,
            CommonJsVariable::Filename,
            CommonJsVariable::Dirname,
        ] {
            let location = import_meta_location(variable);
            let location = location.filter(|&location| table::exists_on(location, platform));
            let id = commonjs_variable_builtin(variable);
            let id = id.filter(|&id| table::exists_on(id, platform));
            let path = location.zip(id).map(|(location, id)| BuiltinPath {
                id,
                mutability: holder_mutability.min(table::entry(location).mutability),
            });
            self.commonjs.set(variable, path);
        }
    }

    pub(super) fn expose_commonjs_variable(&mut self, variable: CommonJsVariable) {
        if let Some(path) = self.commonjs.get(variable) {
            self.exposes_own_module_object |= path.id == BuiltinId::ModuleObject;
            self.output.mentioned.push(path.id);
            self.expose(path.id);
        }
    }

    pub(super) fn compute_commonjs_state(
        &mut self,
        expr: ExprId,
        variable: CommonJsVariable,
        name: Atom,
    ) -> ExprState {
        let input = self.input;
        match (input.module_format, variable) {
            (ModuleFormat::Esm, CommonJsVariable::Module | CommonJsVariable::Exports) => {
                return self.compute_free_name_state(expr, name);
            }
            (
                ModuleFormat::Esm,
                CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
            )
            | (
                ModuleFormat::CommonJs,
                CommonJsVariable::Module
                | CommonJsVariable::Exports
                | CommonJsVariable::Require
                | CommonJsVariable::Filename
                | CommonJsVariable::Dirname,
            ) => {}
        }
        if input
            .bound
            .dynamic_lookup_scope(NodeData::Expr(expr))
            .is_some()
        {
            self.expose_commonjs_variable(variable);
            return ExprState::Unresolved;
        }
        ExprState::of_path(self.commonjs.get(variable))
    }

    pub(super) fn compute_import_meta_state(&self) -> ExprState {
        ExprState::of_path(Some(BuiltinPath {
            id: BuiltinId::ImportMeta,
            mutability: table::entry(BuiltinId::ImportMeta).mutability,
        }))
    }
}
