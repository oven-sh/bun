use super::binding_kinds::record_binding_kind;
use super::bits::{has_bit, insert_bit};
use super::declaration_kinds::{
    Declaration, DeclarationKind, FunctionPosition, declaration_kind, function_position,
};
use super::declarations::{Declarations, is_var_scope};
use super::{AnnexBFunction, BindingKind};
use crate::bind::{BoundBuilder, ClassOwner, Decl, FnOwner, ScopeId, SymFlags, SymbolId};
use crate::hir::*;

pub(super) fn has_sloppy_labeled_function(
    hir: &File<'_>,
    bound: &BoundBuilder,
    strict_scopes: &[u64],
) -> bool {
    if hir.rare_syntax & rare::DECLARATION_AS_BODY == 0 {
        return false;
    }
    hir.stmts
        .iter()
        .zip(bound.stmt_scope.iter())
        .any(|(statement, &scope)| {
            let StmtKind::Labeled { body, .. } = statement.kind else {
                return false;
            };
            let body = hir.stmts.get(body.idx());
            body.is_some_and(|body| matches!(body.kind, StmtKind::Fn(_)))
                && scope.is_some()
                && !has_bit(strict_scopes, scope.idx())
        })
}

pub(super) fn is_block_function_declaration(hir: &File<'_>, f: FnId) -> bool {
    let func = &hir[f];
    func.kind == FnKind::Decl
        && !matches!(func.body, FnBody::None)
        && func.name.is_some()
        && !func.flags.contains(Flags::AMBIENT)
}

impl Declarations<'_, '_> {
    pub(super) fn hoist_block_functions(&mut self) {
        for index in 0..self.hir.fns.len() {
            let f = FnId(index as u32);
            let Some((scope, position)) = self.function_declaration_position(f) else {
                continue;
            };
            let (block_symbol, start) = match position {
                FunctionPosition::TopLevel => continue,
                FunctionPosition::Block => (
                    self.bound.fn_symbol[index],
                    self.bound.scopes[scope.idx()].parent,
                ),
                FunctionPosition::ImplicitBlock => (self.create_implicit_block_symbol(f), scope),
            };
            let is_plain = !self.hir[f]
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR);
            if is_plain
                && self.is_sloppy(scope)
                && !self.hir.follows_dropped_directive(self.hir.node(f))
                && let Some(var_symbol) = self.find_annex_b_var(f, start)
            {
                record_binding_kind(self.bound, var_symbol, BindingKind::Var);
                let hoisted = AnnexBFunction {
                    function: f,
                    block_symbol,
                    var_symbol,
                };
                self.bound
                    .runtime
                    .declarations
                    .annex_b_functions
                    .push(hoisted);
            }
        }
    }

    fn function_declaration_position(&self, f: FnId) -> Option<(ScopeId, FunctionPosition)> {
        if !is_block_function_declaration(self.hir, f) {
            return None;
        }
        let FnOwner::Stmt(statement) = self.bound.fns[f.idx()].owner else {
            return None;
        };
        let scope = self.bound.scope_of_stmt(statement).some()?;
        Some((scope, function_position(self.hir, self.bound, f)))
    }

    fn create_implicit_block_symbol(&mut self, f: FnId) -> SymbolId {
        let name = self.hir[f].name;
        let scope = self.implicit_block_scope(f);
        debug_assert!(
            scope.is_some(),
            "the binder creates the block with the function"
        );
        let (decl, kind) = (Decl::Fn(f), DeclarationKind::BlockFunction);
        let (flags, declaration) = (SymFlags::FUNCTION, Declaration { decl, kind });
        let kind = BindingKind::Function;
        let block_symbol = self.append_binding(scope, name, flags, kind, declaration);
        self.bound
            .runtime
            .declarations
            .declared_symbols
            .push((decl, block_symbol));
        let declared = self.bound.fn_symbol[f.idx()];
        if self.bound.symbols[declared.idx()].decls.len() == 1 {
            insert_bit(&mut self.scopes.hidden_symbols, declared.idx());
        }
        block_symbol
    }

    fn blocks_annex_b_var(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, &*self.bound);
        let existing = &bound.symbols[symbol.idx()];
        existing.flags.contains(SymFlags::PARAMETER)
            || existing.decls.iter().any(|&decl| {
                let kind = declaration_kind(hir, bound, decl);
                matches!(kind, DeclarationKind::Lexical | DeclarationKind::Import)
            })
    }

    fn find_annex_b_var(&mut self, f: FnId, start: ScopeId) -> Option<SymbolId> {
        let name = self.hir[f].name;
        let mut scope = start;
        while !is_var_scope(self.bound.scopes.get(scope.idx())?.kind) {
            if let Some((_, binding)) = self.visible_binding(scope, name)
                && binding.kind != DeclarationKind::SimpleCatchParameter
            {
                return None;
            }
            scope = self.bound.scopes[scope.idx()].parent;
        }
        if let Some((symbol, _)) = self.visible_binding(scope, name) {
            return (!self.blocks_annex_b_var(symbol))
                .then(|| self.bound.export_symbol_of_value_symbol_if_exported(symbol));
        }
        let (decl, kind) = (Decl::Fn(f), DeclarationKind::Var);
        let flags = SymFlags::FUNCTION_SCOPED_VARIABLE;
        let declaration = Declaration { decl, kind };
        Some(self.append_binding(scope, name, flags, BindingKind::Var, declaration))
    }

    pub(super) fn create_class_bindings(&mut self) {
        let hir = self.hir;
        for (index, class) in hir.classes.iter().enumerate() {
            let scope = self.bound.class_scope[index];
            if scope.is_none() || class.name.is_none() || class.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let id = ClassId(index as u32);
            let inner = match self.bound.class_owner[index] {
                ClassOwner::Stmt(_) => {
                    let (decl, kind) = (Decl::Class(id), DeclarationKind::Lexical);
                    let (flags, declaration) = (SymFlags::CLASS, Declaration { decl, kind });
                    let kind = BindingKind::ClassInnerName;
                    self.append_binding(scope, class.name, flags, kind, declaration)
                }
                ClassOwner::Expr(_) => {
                    let inner = self.bound.class_symbol[index];
                    record_binding_kind(self.bound, inner, BindingKind::ClassInnerName);
                    inner
                }
            };
            self.bound
                .runtime
                .declarations
                .inner_class_symbols
                .push((id, inner));
        }
    }
}
