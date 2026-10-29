use super::call_sites::{CallForm, expr_kind, find_call_form};
use super::statements::{is_macro_import, value_import_symbols};
use crate::atom::Atom;
use crate::bind::{Binding, Bound, Decl, Parent, SymbolId};
use crate::fold::{Decisions, TreeNode, mark_nodes_below};
use crate::hir::{
    BinOp, Branches, ExprId, ExprKind, File, ImportId, MemberKey, StmtId, StmtKind, VarDeclId,
};
use crate::hir_from_data::HostValue;
use crate::util::{PositionSet, SharedSort};

fn macro_import_symbols(hir: &File<'_>, bound: &Bound<'_>) -> Vec<SymbolId> {
    let mut symbols = Vec::new();
    for index in 0..hir.imports.len() {
        let import = ImportId(index as u32);
        if is_macro_import(hir, import) && !hir[import].type_only {
            symbols.extend(value_import_symbols(hir, bound, import));
        }
    }
    symbols.shared_sort_unstable();
    symbols
}

pub fn macro_callee(
    hir: &File<'_>,
    bound: &Bound<'_>,
    macro_symbols: &[SymbolId],
    call: ExprId,
) -> Option<(SymbolId, Option<Atom>)> {
    if macro_symbols.is_empty() {
        return None;
    }
    let CallForm::Call { callee, .. } = find_call_form(hir, call)? else {
        return None;
    };
    let callee = hir.skip_type_assertions(callee);
    if let Some(symbol) = find_macro_symbol(hir, bound, macro_symbols, callee) {
        return (!is_namespace_import(bound, symbol)).then_some((symbol, None));
    }
    match hir.member_key(callee)? {
        (object, MemberKey::Name(member)) => {
            let object = hir.skip_type_assertions(object);
            let symbol = find_macro_symbol(hir, bound, macro_symbols, object)?;
            is_namespace_import(bound, symbol).then_some((symbol, Some(member)))
        }
        (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => None,
    }
}

fn is_macro_call(
    hir: &File<'_>,
    bound: &Bound<'_>,
    macro_symbols: &[SymbolId],
    call: ExprId,
) -> bool {
    macro_callee(hir, bound, macro_symbols, call).is_some()
}

pub(super) fn find_pending_macro_calls<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'_>,
    host_values: &[(ExprId, HostValue<'_>)],
) -> Vec<ExprId> {
    let macro_symbols = macro_import_symbols(hir, bound);
    if macro_symbols.is_empty() {
        return Vec::new();
    }
    let mut flow = PendingResultFlow::new(hir, bound);
    let mut pending = Vec::new();
    for index in 0..hir.exprs.len() {
        let e = ExprId(index as u32);
        if bound.parent_of_expr(e) == Parent::None || decisions.is_dead_expr(e) {
            continue;
        }
        if is_macro_call(hir, bound, &macro_symbols, e) {
            let host_value = host_values.binary_search_by_key(&e, |entry| entry.0);
            if host_value.is_err() {
                pending.push(e);
                flow.add_dependent_expr(e);
            }
        } else if flow.reads_dependent_variable(e) {
            flow.add_dependent_expr(e);
        }
    }
    let guarded = mark_nodes_below(hir, flow.guarded_nodes).exprs;
    let is_unguarded = |call: &&ExprId| !guarded.contains(call.idx());
    let unguarded_count = pending.iter().skip(1).take_while(is_unguarded).count();
    pending.truncate(1 + unguarded_count);
    pending
}

fn find_macro_symbol(
    hir: &File<'_>,
    bound: &Bound<'_>,
    macro_symbols: &[SymbolId],
    e: ExprId,
) -> Option<SymbolId> {
    if !matches!(expr_kind(hir, e), Some(ExprKind::Ident(_))) {
        return None;
    }
    match bound.binding(e) {
        Binding::Symbol(symbol) => macro_symbols.binary_search(&symbol).ok().map(|_| symbol),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
    }
}

fn is_namespace_import(bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let mut decls = bound.symbol(symbol).decls.iter();
    decls.any(|decl| matches!(decl, Decl::ImportNamespace(_)))
}

struct PendingResultFlow<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    dependent_exprs: PositionSet,
    dependent_variables: PositionSet,
    guarded_nodes: Vec<TreeNode>,
}

impl<'a, 's> PendingResultFlow<'a, 's> {
    fn new(hir: &'a File<'s>, bound: &'a Bound<'s>) -> PendingResultFlow<'a, 's> {
        PendingResultFlow {
            hir,
            bound,
            dependent_exprs: PositionSet::new(hir.exprs.len()),
            dependent_variables: PositionSet::new(bound.symbols.len()),
            guarded_nodes: Vec::new(),
        }
    }

    fn reads_dependent_variable(&self, e: ExprId) -> bool {
        self.bound.is_evaluated_ident(e)
            && matches!(
                self.bound.binding(e),
                Binding::Symbol(symbol) if self.dependent_variables.contains(symbol.idx())
            )
    }

    fn add_dependent_expr(&mut self, mut e: ExprId) {
        while !self.dependent_exprs.contains(e.idx()) {
            self.dependent_exprs.insert(e.idx());
            let enclosing = match self.bound.parent_of_expr(e) {
                Parent::Expr(enclosing) => enclosing,
                Parent::Prop(prop) | Parent::PropKey(prop) | Parent::MethodKey(prop) => {
                    self.bound.prop_owner[prop.idx()]
                }
                Parent::Stmt(stmt) => {
                    self.add_guarded_statements(stmt, e);
                    return;
                }
                Parent::VarInit(declaration) => {
                    self.add_dependent_variable(declaration);
                    return;
                }
                _ => return,
            };
            let Some(enclosing) = enclosing.some() else {
                return;
            };
            self.add_guarded_operands(enclosing, e);
            e = enclosing;
        }
    }

    fn add_guarded_operands(&mut self, parent: ExprId, condition: ExprId) {
        let kind = self.hir[parent].kind;
        if let ExprKind::Cond { test, branches } = kind
            && test == condition
        {
            let Branches { yes, no } = self.hir.branches(branches);
            self.guarded_nodes.extend([yes, no].map(TreeNode::Expr));
        }
        if let ExprKind::Binary { op, left, right } = kind
            && left == condition
            && matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
        {
            self.guarded_nodes.push(TreeNode::Expr(right));
        }
    }

    fn add_guarded_statements(&mut self, parent: StmtId, condition: ExprId) {
        if let StmtKind::If { test, yes, no } = self.hir[parent].kind
            && test == condition
        {
            let arms = [yes, no].into_iter().filter_map(StmtId::some);
            self.guarded_nodes.extend(arms.map(TreeNode::Stmt));
        }
    }

    fn add_dependent_variable(&mut self, declaration: VarDeclId) {
        if let Some(name) = self.hir[declaration].pat.some()
            && let Some(symbol) = self.bound.declared_symbol(Decl::Var(name)).some()
        {
            self.dependent_variables.insert(symbol.idx());
        }
    }
}
