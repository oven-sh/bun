use super::binding_kinds::variable_binding_kind;
use super::bits::insert_bit;
use super::declaration_kinds::{
    Declaration, DeclarationKind, declaration_kind, declaration_symbol, is_block_level,
    needs_unique_parameters, pattern_scope,
};
use super::declarations::{Declarations, append_symbol, is_var_scope};
use super::{BindingKind, EarlyRedeclaration, FunctionFlags, ParameterVarCopy};
use crate::atom::Atom;
use crate::bind::{Decl, ScopeId, ScopeKind, SymFlags, SymbolId};
use crate::hir::*;
use crate::util::SharedSort;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Conflict {
    No,
    Always,
    OnlyInModule,
}

struct NameDeclarations {
    scope: ScopeId,
    name: Atom,
    binding: Option<SymbolId>,
    first_by_kind: SmallVec<[Declaration; 4]>,
}

impl NameDeclarations {
    fn add(&mut self, binding: SymbolId, declaration: Declaration) {
        self.binding.get_or_insert(binding);
        if !self
            .first_by_kind
            .iter()
            .any(|first| first.kind == declaration.kind)
        {
            self.first_by_kind.push(declaration);
        }
    }
}

impl Declarations<'_, '_> {
    pub(super) fn merge_declarations(&mut self) {
        let mut rejected: Vec<usize> = (0..self.bound.redeclarations.len()).collect();
        rejected.shared_sort_by_key(|&index| self.bound.redeclarations[index].symbol);
        for index in 0..self.bound.scopes.len() {
            let table = self.bound.scopes[index].locals;
            for position in 0..self.bound.table(table).len() {
                let symbol = self.bound.table(table)[position].1;
                let redeclarations = &self.bound.redeclarations;
                let start = rejected.partition_point(|&r| redeclarations[r].symbol < symbol);
                let end = rejected.partition_point(|&r| redeclarations[r].symbol <= symbol);
                let decls = &self.bound.symbols[symbol.idx()].decls[..];
                if start != end || decls.len() > 1 || matches!(decls, [Decl::Require(_)]) {
                    let scope = ScopeId(index as u32);
                    self.merge_symbol_declarations(scope, symbol, &rejected[start..end]);
                }
            }
        }
    }

    fn merge_symbol_declarations(&mut self, scope: ScopeId, symbol: SymbolId, rejected: &[usize]) {
        let table_symbol = &self.bound.symbols[symbol.idx()];
        let name = table_symbol.name;
        let accepted: SmallVec<[Decl; 4]> = table_symbol.decls.iter().copied().collect();
        let mut names = NameDeclarations {
            scope,
            name,
            binding: None,
            first_by_kind: SmallVec::new(),
        };
        if let Some(&(appended, first)) = self.scopes.appended_bindings.get(&(scope, name)) {
            names.add(appended, first);
        }
        let mut has_inner_declaration = false;
        for decl in accepted {
            let declaration = Declaration::new(self.hir, self.bound, decl);
            if declaration.kind.binds_in_table_scope() {
                self.record_hoisted_require(declaration);
                self.record_first_conflict(&names, declaration);
                names.add(symbol, declaration);
            } else {
                self.declare_block_scoped_require(name, declaration);
                has_inner_declaration |= declaration.kind != DeclarationKind::NoBinding;
            }
        }
        if has_inner_declaration && names.binding != Some(symbol) {
            insert_bit(&mut self.scopes.hidden_symbols, symbol.idx());
        }
        for &index in rejected {
            self.merge_rejected(&mut names, index);
        }
    }

    fn merge_rejected(&mut self, names: &mut NameDeclarations, index: usize) {
        let decl = self.bound.redeclarations[index].decl;
        let declaration = Declaration::new(self.hir, self.bound, decl);
        if !declaration.kind.binds_in_table_scope() {
            self.declare_block_scoped_require(names.name, declaration);
            return;
        }
        self.record_hoisted_require(declaration);
        if self.record_first_conflict(names, declaration) == Conflict::Always {
            let early_errors = &mut self.bound.runtime.early_error_redeclarations;
            early_errors.push(index as u32);
            return;
        }
        let Some(binding) = names.binding else {
            if let Some(own) = declaration_symbol(self.bound, decl).some() {
                let key = (names.scope, names.name);
                self.scopes
                    .appended_bindings
                    .insert(key, (own, declaration));
                names.add(own, declaration);
            } else if declaration.kind == DeclarationKind::Import {
                let own = self.append_import(names.scope, names.name, declaration);
                names.add(own, declaration);
            }
            return;
        };
        names.add(binding, declaration);
        if matches!(
            declaration.kind,
            DeclarationKind::Var | DeclarationKind::Parameter | DeclarationKind::TopLevelFunction
        ) {
            self.record_same_binding(names.scope, binding, declaration);
        }
    }

    fn append_import(&mut self, scope: ScopeId, name: Atom, declaration: Declaration) -> SymbolId {
        let (flags, kind) = (SymFlags::ALIAS, BindingKind::Import);
        let symbol = self.append_binding(scope, name, flags, kind, declaration);
        let declarations = &mut self.bound.runtime.declarations;
        match declaration.decl {
            Decl::ImportDefault(import) => {
                declarations.import_default_symbols[import.idx()] = symbol
            }
            Decl::ImportNamespace(import) => {
                declarations.import_namespace_symbols[import.idx()] = symbol;
            }
            Decl::ImportSpec(spec) => declarations.import_spec_symbols[spec.idx()] = symbol,
            _ => {}
        }
        symbol
    }

    fn record_first_conflict(&mut self, names: &NameDeclarations, later: Declaration) -> Conflict {
        for earlier in &names.first_by_kind {
            let conflict = self.conflict(names.scope, earlier.kind, later.kind);
            let pair = EarlyRedeclaration {
                earlier: earlier.decl,
                later: later.decl,
            };
            match conflict {
                Conflict::No => continue,
                Conflict::Always => self.redeclarations.push(pair),
                Conflict::OnlyInModule => self.module_only_redeclarations.push(pair),
            }
            return conflict;
        }
        Conflict::No
    }

    fn declare_block_scoped_require(&mut self, name: Atom, declaration: Declaration) {
        let (DeclarationKind::BlockScopedRequire, Decl::Require(pat)) =
            (declaration.kind, declaration.decl)
        else {
            return;
        };
        let (decl, scope) = (declaration.decl, pattern_scope(self.bound, pat));
        if let Some((_, earlier)) = self.visible_binding(scope, name) {
            let (earlier, later) = (earlier.decl, decl);
            self.redeclarations
                .push(EarlyRedeclaration { earlier, later });
            return;
        }
        let kind = DeclarationKind::Lexical;
        let flags = SymFlags::BLOCK_SCOPED_VARIABLE;
        let binding_kind = variable_binding_kind(self.hir, self.bound, pat);
        let declaration = Declaration { decl, kind };
        let symbol = self.append_binding(scope, name, flags, binding_kind, declaration);
        self.bound
            .runtime
            .declarations
            .declared_symbols
            .push((Decl::Var(pat), symbol));
    }

    fn record_hoisted_require(&mut self, declaration: Declaration) {
        let Decl::Require(pat) = declaration.decl else {
            return;
        };
        let scope = pattern_scope(self.bound, pat);
        if declaration.kind == DeclarationKind::Var && is_block_level(self.bound, scope) {
            self.scopes.hoisted_requires.push((pat, scope));
        }
    }

    fn record_same_binding(&mut self, scope: ScopeId, binding: SymbolId, later: Declaration) {
        let flags = self.bound.symbols[binding.idx()].flags;
        let is_body_declaration = later.kind != DeclarationKind::Parameter
            && flags.contains(SymFlags::PARAMETER)
            && self.has_body_variables(scope);
        let target = if is_body_declaration {
            if matches!(later.decl, Decl::Fn(_)) {
                self.parameters_with_body_function.insert(binding);
            }
            self.body_variable(scope, binding, later.decl)
        } else {
            self.bound
                .export_symbol_of_value_symbol_if_exported(binding)
        };
        let key = match later.decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            Decl::Fn(_) => later.decl,
            _ => return,
        };
        let declarations = &mut self.bound.runtime.declarations;
        declarations.declared_symbols.push((key, target));
    }

    fn has_body_variables(&self, scope: ScopeId) -> bool {
        matches!(self.bound.scopes[scope.idx()].kind, ScopeKind::Fn(f)
            if self.bound.runtime.function_flags[f.idx()]
                .contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS)
                && matches!(self.hir[f].body, FnBody::Block(_)))
    }

    fn var_declarations(&self, symbol: SymbolId) -> SmallVec<[(Decl, PatId); 2]> {
        let (hir, bound) = (self.hir, &*self.bound);
        let decls = bound.symbols[symbol.idx()].decls.iter();
        let vars = decls.filter_map(|&decl| match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat)
                if declaration_kind(hir, bound, decl) == DeclarationKind::Var =>
            {
                Some((decl, pat))
            }
            _ => None,
        });
        vars.collect()
    }

    fn body_variable(&mut self, scope: ScopeId, parameter: SymbolId, decl: Decl) -> SymbolId {
        if let Some(&variable) = self.body_variable_symbols.get(&parameter) {
            return variable;
        }
        let name = self.bound.symbols[parameter.idx()].name;
        let first_var = self
            .var_declarations(parameter)
            .first()
            .map(|entry| entry.0);
        let (flags, decl) = (
            SymFlags::FUNCTION_SCOPED_VARIABLE,
            first_var.unwrap_or(decl),
        );
        let variable = append_symbol(self.bound, name, flags, BindingKind::Var, decl, scope);
        self.body_variable_symbols.insert(parameter, variable);
        variable
    }

    fn conflict(
        &mut self,
        scope: ScopeId,
        earlier: DeclarationKind,
        later: DeclarationKind,
    ) -> Conflict {
        use DeclarationKind as Kind;
        match (earlier, later) {
            (
                Kind::NoBinding
                | Kind::TypeScriptValue
                | Kind::ImplicitBlockFunction
                | Kind::BlockScopedRequire,
                _,
            )
            | (
                _,
                Kind::NoBinding
                | Kind::TypeScriptValue
                | Kind::ImplicitBlockFunction
                | Kind::BlockScopedRequire,
            ) => Conflict::No,
            (Kind::Import, _) | (_, Kind::Import) if !self.hir.is_js => Conflict::No,
            (Kind::Parameter, Kind::Parameter) => self.parameter_conflict(scope),
            (Kind::TopLevelFunction, Kind::Var) | (Kind::Var, Kind::TopLevelFunction)
                if matches!(self.bound.scopes[scope.idx()].kind, ScopeKind::File) =>
            {
                Conflict::OnlyInModule
            }
            (
                Kind::Var | Kind::Parameter | Kind::TopLevelFunction,
                Kind::Var | Kind::Parameter | Kind::TopLevelFunction,
            )
            | (Kind::BlockFunction, Kind::BlockFunction) => Conflict::No,
            (
                Kind::BlockFunction | Kind::Lexical | Kind::Import | Kind::SimpleCatchParameter,
                _,
            )
            | (
                _,
                Kind::BlockFunction | Kind::Lexical | Kind::Import | Kind::SimpleCatchParameter,
            ) => Conflict::Always,
        }
    }

    fn parameter_conflict(&mut self, scope: ScopeId) -> Conflict {
        let ScopeKind::Fn(f) = self.bound.scopes[scope.idx()].kind else {
            return Conflict::No;
        };
        if needs_unique_parameters(self.hir, f)
            || !self.is_sloppy(scope)
            || self.hir.has_parameters_read_as_strict(f)
        {
            Conflict::Always
        } else {
            Conflict::No
        }
    }

    pub(super) fn check_hoisted_vars(&mut self) {
        for index in 0..self.bound.hoisted_vars.len() {
            let (pat, scope) = self.bound.hoisted_vars[index];
            self.check_hoisted_var(Decl::Var(pat), pat, scope);
        }
        for index in 0..self.scopes.hoisted_requires.len() {
            let (pat, scope) = self.scopes.hoisted_requires[index];
            self.check_hoisted_var(Decl::Require(pat), pat, scope);
        }
    }

    fn check_hoisted_var(&mut self, later: Decl, pat: PatId, start: ScopeId) {
        let PatKind::Ident(name) = self.hir[pat].kind else {
            return;
        };
        let mut scope = start;
        while scope.is_some() && !is_var_scope(self.bound.scopes[scope.idx()].kind) {
            if let Some((_, earlier)) = self.visible_binding(scope, name)
                && earlier.kind != DeclarationKind::SimpleCatchParameter
            {
                let earlier = earlier.decl;
                self.redeclarations
                    .push(EarlyRedeclaration { earlier, later });
                return;
            }
            scope = self.bound.scopes[scope.idx()].parent;
        }
    }

    pub(super) fn check_catch_parameters(&mut self) {
        let hir = self.hir;
        for index in 0..hir.stmts.len() {
            let StmtKind::Try { param, handler, .. } = hir.stmts[index].kind else {
                continue;
            };
            let catch_scope = self.bound.scope_of_stmt(handler);
            if param.is_none() || catch_scope.is_none() {
                continue;
            }
            let handler_scope = self.bound.runtime.declarations.created_scope(handler);
            if handler_scope.is_none() {
                continue;
            }
            let table = self.bound.scopes[catch_scope.idx()].locals;
            for position in 0..self.bound.table(table).len() {
                let (name, parameter) = self.bound.table(table)[position];
                if let Some(earlier) = self.first_table_scope_binding(parameter)
                    && let Some((_, later)) = self.visible_binding(handler_scope, name)
                {
                    let (earlier, later) = (earlier.decl, later.decl);
                    self.redeclarations
                        .push(EarlyRedeclaration { earlier, later });
                }
            }
        }
    }

    pub(super) fn create_body_variables(&mut self) {
        for index in 0..self.hir.fns.len() {
            let scope = self.bound.fns[index].scope;
            if scope.is_none() || !self.has_body_variables(scope) {
                continue;
            }
            let table = self.bound.scopes[scope.idx()].locals;
            for position in 0..self.bound.table(table).len() {
                let symbol = self.bound.table(table)[position].1;
                if self.bound.symbols[symbol.idx()]
                    .flags
                    .contains(SymFlags::PARAMETER)
                {
                    self.create_body_variable(FnId(index as u32), scope, symbol);
                }
            }
        }
    }

    fn create_body_variable(&mut self, function: FnId, scope: ScopeId, parameter: SymbolId) {
        let vars = self.var_declarations(parameter);
        let has_function = self.parameters_with_body_function.contains(&parameter);
        let variable = match vars.first() {
            Some(&(first, _)) => self.body_variable(scope, parameter, first),
            None if has_function => self.body_variable_symbols[&parameter],
            None => return,
        };
        let declarations = &mut self.bound.runtime.declarations;
        for (_, pat) in vars {
            declarations
                .declared_symbols
                .push((Decl::Var(pat), variable));
        }
        self.scopes.body_variables.push((parameter, variable));
        if !has_function {
            declarations.parameter_var_copies.push(ParameterVarCopy {
                function,
                parameter,
                variable,
            });
        }
    }
}
