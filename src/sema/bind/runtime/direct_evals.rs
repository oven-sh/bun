use super::bits::{has_bit, insert_bit};
use super::declarations::is_var_scope;
use super::lookup::is_appended_visible;
use super::references::ReferencePass;
use super::stores::find_outermost_cast;
use super::type_only_code::TypeOnlyCode;
use super::{Binding, BindingKind, CodeUnit, EvalScope, RuntimeScopes};
use crate::atom::{Atom, known};
use crate::bind::{BoundBuilder, Parent, ScopeId, ScopeKind, SymbolId};
use crate::hir::*;
use crate::util::{FxHashMap, FxHashSet, SharedSort};

#[derive(Copy, Clone)]
pub(super) struct DirectEval {
    call: ExprId,
    scope: ScopeId,
    pub is_sloppy: bool,
}

pub(super) fn find_direct_evals(
    hir: &File<'_>,
    bound: &BoundBuilder,
    idents: &[(ExprId, ScopeId)],
    scopes: &RuntimeScopes,
    type_only: &TypeOnlyCode,
) -> Vec<DirectEval> {
    let mut direct_evals = Vec::new();
    for &(ident, scope) in idents {
        if !matches!(hir[ident].kind, ExprKind::Ident(name) if name == known::eval)
            || type_only.has_expr(ident, scope)
        {
            continue;
        }
        if let Some(call) = find_direct_eval_call(hir, bound, ident) {
            direct_evals.push(DirectEval {
                call,
                scope,
                is_sloppy: !has_bit(&scopes.strict_scopes, scope.idx()),
            });
        }
    }
    direct_evals
}

fn find_direct_eval_call(hir: &File<'_>, bound: &BoundBuilder, ident: ExprId) -> Option<ExprId> {
    let callee = find_outermost_cast(hir, bound, ident);
    let Parent::Expr(parent) = bound.parent_of_expr(callee) else {
        return None;
    };
    let ExprKind::Call(c) = hir[parent.some()?].kind else {
        return None;
    };
    let call = &hir[c];
    (call.callee == callee && call.chain == Chain::No).then_some(parent)
}

pub(super) fn compute_dynamic_scopes(
    bound: &BoundBuilder,
    direct_evals: &[DirectEval],
) -> Vec<u64> {
    let mut dynamic_scopes = Vec::new();
    for (index, scope) in bound.scopes.iter().enumerate() {
        if matches!(scope.kind, ScopeKind::With(_)) {
            insert_bit(&mut dynamic_scopes, index);
        }
    }
    for eval in direct_evals.iter().filter(|eval| eval.is_sloppy) {
        let mut at = eval.scope;
        while at.is_some() && !is_var_scope(bound.scopes[at.idx()].kind) {
            at = bound.scopes[at.idx()].parent;
        }
        if at.is_some() {
            insert_bit(&mut dynamic_scopes, at.idx());
        }
    }
    dynamic_scopes
}

impl ReferencePass<'_, '_> {
    pub(super) fn collect_eval_scopes(&mut self) {
        if self.direct_evals.is_empty() {
            return;
        }
        let bindings = self.lookup.scopes.appended_bindings.iter();
        let mut appended: Vec<_> = bindings.map(|(key, entry)| (key.0, entry.0)).collect();
        appended.shared_sort_unstable();
        let mut symbol_lists: FxHashMap<ScopeId, IdList<SymbolId>> = FxHashMap::default();
        for index in 0..self.direct_evals.len() {
            let eval = self.direct_evals[index];
            let symbols = *symbol_lists
                .entry(eval.scope)
                .or_insert_with(|| self.append_eval_symbols(eval, &appended));
            let eval_scope = EvalScope {
                scope: eval.scope,
                symbols,
                is_sloppy: eval.is_sloppy,
            };
            self.references.eval_scopes.push((eval.call, eval_scope));
            self.note_eval_functions(eval.scope);
        }
    }

    fn append_eval_symbols(
        &mut self,
        eval: DirectEval,
        appended: &[(ScopeId, SymbolId)],
    ) -> IdList<SymbolId> {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let first = self.eval_symbol_ids.len();
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        let (mut at, mut from) = (eval.scope, ScopeKind::Block);
        while at.is_some() {
            let scope = &bound.scopes[at.idx()];
            for &(name, local) in bound.table(scope.locals) {
                if let Some(binding) = self.lookup.local_binding(scope.kind, from, name, local)
                    && !seen.contains(&name)
                {
                    let is_passed_by_declarations =
                        eval.is_sloppy && self.is_simple_catch_parameter(binding);
                    if !is_passed_by_declarations {
                        seen.insert(name);
                    }
                    self.list_eval_binding(binding);
                }
            }
            let first_appended = appended.partition_point(|entry| entry.0 < at);
            for &(_, symbol) in appended[first_appended..].iter().take_while(|e| e.0 == at) {
                if is_appended_visible(from) && seen.insert(bound.symbols[symbol.idx()].name) {
                    self.list_eval_binding(Binding::Symbol(symbol));
                }
            }
            from = scope.kind;
            at = bound.runtime_parent_scope(hir, at);
        }
        let count = self.eval_symbol_ids.len() - first;
        IdList::new(self.first_eval_id + first as u32, count as u32)
    }

    fn is_simple_catch_parameter(&self, binding: Binding) -> bool {
        let Binding::Symbol(symbol) = binding else {
            return false;
        };
        let kinds = &self.lookup.bound.runtime.declarations.binding_kinds;
        kinds.get(symbol.idx()) == Some(&BindingKind::SimpleCatchParameter)
    }

    fn list_eval_binding(&mut self, binding: Binding) {
        let bound = self.lookup.bound;
        let Binding::Symbol(symbol) = binding else {
            return;
        };
        let parent = bound.symbols[symbol.idx()].parent;
        if parent.is_some() && parent != bound.file_symbol {
            return;
        }
        self.eval_symbol_ids.push(symbol.0);
        insert_bit(&mut self.references.eval_visible_symbols, symbol.idx());
    }

    fn note_eval_functions(&mut self, start: ScopeId) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let mut at = start;
        while at.is_some() {
            let scope = &bound.scopes[at.idx()];
            match scope.kind {
                ScopeKind::Fn(f) => {
                    self.has_direct_eval.push(f);
                    if hir[f].kind != FnKind::Arrow {
                        if bound.has_arguments(hir, f) {
                            self.uses_arguments.push(CodeUnit::Function(f));
                        }
                        return;
                    }
                }
                ScopeKind::File => {
                    self.uses_arguments.push(CodeUnit::File);
                    return;
                }
                ScopeKind::FieldInitializer(_) => return,
                ScopeKind::Module(_)
                | ScopeKind::Block
                | ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::TypeAlias(_)
                | ScopeKind::TypeParams
                | ScopeKind::Enum(_)
                | ScopeKind::TypeParamList(_)
                | ScopeKind::Param(_)
                | ScopeKind::ReturnType(_)
                | ScopeKind::Extends
                | ScopeKind::InferConstraint
                | ScopeKind::StaticMember
                | ScopeKind::ComputedName
                | ScopeKind::BaseExpression
                | ScopeKind::FunctionName(_)
                | ScopeKind::PropertyDeclaration(..)
                | ScopeKind::PropertyType(..)
                | ScopeKind::With(_)
                | ScopeKind::ClassDecorators(_)
                | ScopeKind::ImplicitBlock(_) => {}
            }
            at = bound.runtime_parent_scope(hir, at);
        }
    }
}
