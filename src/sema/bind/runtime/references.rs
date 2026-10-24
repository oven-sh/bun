use super::bits::insert_bit;
use super::declaration_kinds::{DeclarationKind, declaration_kind, for_each_name};
use super::direct_evals::{DirectEval, compute_dynamic_scopes, find_direct_evals};
use super::lookup::{COMMONJS_VARIABLES, Lookup};
use super::namespace_exports::ExportedBlockBindings;
use super::storage::RuntimeReferencesIn;
use super::type_only_code::TypeOnlyCode;
use super::{Binding, CodeUnit, FunctionFlags, RuntimeBindOptions, RuntimeInput, RuntimeScopes};
use crate::atom::{Atom, Intern, known};
use crate::bind::{BoundBuilder, Decl, Parent, ScopeId, ScopeKind, SymbolId};
use crate::hir::*;

pub(super) fn compute_references(input: &mut RuntimeInput<'_, '_>, scopes: &RuntimeScopes) {
    let (hir, idents, options, atoms) = (input.hir, input.idents, input.options, input.atoms);
    let bound: &BoundBuilder = &*input.bound;
    let type_only = TypeOnlyCode::new(hir, bound);
    let direct_evals = find_direct_evals(hir, bound, idents, scopes, &type_only);
    let has_sloppy_eval = direct_evals.iter().any(|eval| eval.is_sloppy);
    let dynamic_scopes = compute_dynamic_scopes(bound, &direct_evals);
    let exported_block_bindings = ExportedBlockBindings::collect(hir, bound, scopes);
    let mut pass = ReferencePass {
        lookup: Lookup {
            hir,
            bound,
            scopes,
            dynamic_scopes,
        },
        idents,
        options,
        atoms,
        type_only,
        direct_evals,
        first_eval_id: bound.ids.len() as u32,
        eval_symbol_ids: Vec::new(),
        references: RuntimeReferencesIn::<Growable>::default(),
        uses_arguments: Vec::new(),
        has_direct_eval: Vec::new(),
        import_meta_may_be_modified: false,
    };
    pass.resolve_idents();
    pass.collect_eval_scopes();
    pass.resolve_hoisted_vars();
    pass.resolve_arguments_variables();
    pass.find_redeclared_commonjs_variables();
    pass.collect_dynamic_declarators();
    pass.collect_stores();
    pass.resolve_exports();
    pass.resolve_entity_roots();
    pass.resolve_classic_jsx();
    pass.resolve_decorator_metadata();
    pass.collect_jump_targets();
    pass.finish_results();
    let ReferencePass {
        references,
        eval_symbol_ids,
        uses_arguments,
        has_direct_eval,
        import_meta_may_be_modified,
        ..
    } = pass;
    let bound = &mut *input.bound;
    bound.runtime.references = references;
    exported_block_bindings.record(&mut bound.runtime.declarations);
    bound.runtime.depends_on_sloppy_mode |= has_sloppy_eval;
    bound.runtime.import_meta_may_be_modified = import_meta_may_be_modified;
    bound.ids.extend(eval_symbol_ids);
    for unit in uses_arguments {
        match unit {
            CodeUnit::File => bound.runtime.file_uses_arguments = true,
            CodeUnit::Function(function) => {
                bound.runtime.function_flags[function.idx()] |= FunctionFlags::USES_ARGUMENTS;
            }
            CodeUnit::FieldInitializer(_) => {}
        }
    }
    for function in has_direct_eval {
        bound.runtime.function_flags[function.idx()] |= FunctionFlags::HAS_DIRECT_EVAL;
    }
}

pub(super) struct ReferencePass<'a, 's> {
    pub(super) lookup: Lookup<'a, 's>,
    pub(super) idents: &'a [(ExprId, ScopeId)],
    pub(super) options: RuntimeBindOptions,
    pub(super) atoms: &'a dyn Intern,
    pub(super) type_only: TypeOnlyCode,
    pub(super) direct_evals: Vec<DirectEval>,
    pub(super) first_eval_id: u32,
    pub(super) eval_symbol_ids: Vec<u32>,
    pub(super) references: RuntimeReferencesIn<Growable>,
    pub(super) uses_arguments: Vec<CodeUnit>,
    pub(super) has_direct_eval: Vec<FnId>,
    pub(super) import_meta_may_be_modified: bool,
}

impl ReferencePass<'_, '_> {
    fn resolve_idents(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        for &(ident, scope) in self.idents {
            let ExprKind::Ident(name) = hir[ident].kind else {
                continue;
            };
            if self.is_unevaluated_ident(ident, scope, name) {
                continue;
            }
            insert_bit(&mut self.references.evaluated_idents, ident.idx());
            let found = self.lookup.find(scope, name);
            if found.binding != bound.default_binding(ident) {
                self.references.ident_bindings.push((ident, found.binding));
            }
            if let Binding::Arguments(unit) = found.binding {
                self.uses_arguments.push(unit);
            }
            if found.dynamic_scope.is_some() {
                self.references
                    .dynamic_ident_lookups
                    .push((ident, found.dynamic_scope));
            }
        }
        self.references.sort();
    }

    fn is_unevaluated_ident(&self, ident: ExprId, scope: ScopeId, name: Atom) -> bool {
        let bound = self.lookup.bound;
        name == known::empty
            || self.type_only.has_expr(ident, scope)
            || bound.type_query_operands.binary_search(&ident).is_ok()
            || self.is_unresolved_jsx_name(ident, name)
    }

    fn is_unresolved_jsx_name(&self, ident: ExprId, name: Atom) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        if let Parent::Expr(parent) = bound.parent_of_expr(ident)
            && parent.is_some()
            && let ExprKind::Jsx(j) = hir[parent].kind
        {
            let jsx = &hir[j];
            return ident == jsx.close_tag
                || (ident == jsx.tag && is_intrinsic_jsx_name(self.atoms.bytes(name)));
        }
        false
    }

    fn resolve_hoisted_vars(&mut self) {
        let (hir, bound, scopes) = (self.lookup.hir, self.lookup.bound, self.lookup.scopes);
        for &(pat, scope) in bound.hoisted_vars.iter().chain(&scopes.hoisted_requires) {
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let found = self.lookup.find(scope, name);
            if found.binding != Binding::Symbol(self.declared_var_symbol(pat)) {
                self.references
                    .initialized_bindings
                    .push((pat, found.binding));
            }
        }
    }

    fn declared_var_symbol(&self, pat: PatId) -> SymbolId {
        let bound = self.lookup.bound;
        let symbol = bound.declared_pattern_symbol(pat).some();
        symbol.map_or(SymbolId::NONE, |s| {
            bound.export_symbol_of_value_symbol_if_exported(s)
        })
    }

    fn resolve_arguments_variables(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let name = known::arguments;
        for scope in bound.scopes.iter() {
            let Some(local) = bound.find_in_table(scope.locals, name) else {
                continue;
            };
            let binding = self
                .lookup
                .local_binding(scope.kind, ScopeKind::Block, name, local);
            let Some(arguments @ Binding::Arguments(_)) = binding else {
                continue;
            };
            for &decl in bound.symbols[local.idx()].decls.iter() {
                if let Decl::Var(pat) | Decl::Require(pat) = decl
                    && declaration_kind(hir, bound, decl) == DeclarationKind::Var
                {
                    self.references.initialized_bindings.push((pat, arguments));
                }
            }
        }
    }

    fn find_redeclared_commonjs_variables(&mut self) {
        let bound = self.lookup.bound;
        let Some(file_scope) = bound.scopes.first() else {
            return;
        };
        for variable in COMMONJS_VARIABLES {
            if let Some(local) = bound.find_in_table(file_scope.locals, variable.name())
                && self.lookup.scopes.is_scope_binding(bound, local)
                && self.lookup.is_var(local)
            {
                let symbol = bound.export_symbol_of_value_symbol_if_exported(local);
                self.references
                    .redeclared_commonjs_variables
                    .push((symbol, variable));
            }
        }
    }

    fn collect_dynamic_declarators(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        if self.lookup.dynamic_scopes.is_empty() {
            return;
        }
        for (index, decl) in hir.var_decls.iter().enumerate() {
            let stmt = bound.var_stmt[index];
            if decl.kind != VarKind::Var || stmt.is_none() {
                continue;
            }
            let parent = bound.parent_of_stmt(stmt);
            let is_stored = decl.init.is_some() || is_loop_head(hir, parent, stmt);
            if parent == Parent::None || !is_stored {
                continue;
            }
            for_each_name(hir, decl.pat, |pat, name| {
                let scope = bound.stmt_scope[stmt.idx()];
                let dynamic_scope = self.lookup.find(scope, name).dynamic_scope;
                if dynamic_scope.is_some() {
                    let lookup = (pat, dynamic_scope);
                    self.references.dynamic_declarator_lookups.push(lookup);
                }
            });
        }
    }

    fn resolve_exports(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        for (index, export) in hir.exports.iter().enumerate() {
            let scope = bound.export_scope[index];
            if export.has_module_specifier || export.type_only || scope.is_none() {
                continue;
            }
            for spec in export.items.iter().filter(|&spec| !hir[spec].type_only) {
                let binding = self.lookup.find(scope, hir[spec].local).binding;
                self.references.exported_bindings.push((spec, binding));
            }
        }
    }

    fn resolve_entity_roots(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        for (index, import) in hir.import_equals.iter().enumerate() {
            let names = match import.target {
                ImportEqualsTarget::Entity(names) => names,
                ImportEqualsTarget::Require(_) => continue,
            };
            let scope = bound.import_equals_scope[index];
            if import.flags.intersects(Flags::TYPE_ONLY | Flags::AMBIENT)
                || scope.is_none()
                || self.type_only.has_scope(scope)
            {
                continue;
            }
            if let Some(root) = hir.texts(names).next() {
                let binding = self.lookup.find(scope, root).binding;
                let entry = (ImportEqualsId(index as u32), binding);
                self.references.entity_root_bindings.push(entry);
            }
        }
    }

    fn collect_jump_targets(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        if hir.rare_syntax & rare::ODD_JUMP == 0 {
            return;
        }
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let (StmtKind::Break(label) | StmtKind::Continue(label)) = stmt.kind else {
                continue;
            };
            let jump = StmtId(index as u32);
            if label.is_none() || bound.parent_of_stmt(jump) == Parent::None {
                continue;
            }
            if let Some(target) = find_labeled_stmt(hir, bound, jump, label) {
                self.references.jump_targets.push((jump, target));
            }
        }
    }

    fn finish_results(&mut self) {
        self.references.sort();
        self.references
            .initialized_bindings
            .dedup_by_key(|entry| entry.0);
    }
}

pub(super) fn is_loop_head(hir: &File<'_>, parent: Parent, stmt: StmtId) -> bool {
    let Parent::Stmt(owner) = parent else {
        return false;
    };
    hir.stmts.get(owner.idx()).is_some_and(|owner| {
        let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = owner.kind else {
            return false;
        };
        left == stmt
    })
}

fn find_labeled_stmt(
    hir: &File<'_>,
    bound: &BoundBuilder,
    jump: StmtId,
    label: Atom,
) -> Option<StmtId> {
    let mut parent = bound.parent_of_stmt(jump);
    while let Parent::Stmt(stmt) = parent {
        stmt.some()?;
        if matches!(hir[stmt].kind, StmtKind::Labeled { label: name, .. } if name == label) {
            return Some(stmt);
        }
        parent = bound.parent_of_stmt(stmt);
    }
    None
}
