use super::bits::{has_bit, insert_bit};
use super::queries::find_entry;
use super::references::ReferencePass;
use super::{Binding, ImplicitReferenceKind, StoreKind, SymbolStore};
use crate::atom::known;
use crate::bind::{BoundBuilder, Parent, ScopeKind};
use crate::fold::{DefineHead, DefineRoot};
use crate::hir::*;

impl ReferencePass<'_, '_> {
    pub(super) fn collect_stores(&mut self) {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId(index as u32);
            self.has_import_meta |= matches!(expr.kind, ExprKind::ImportMeta);
            if bound.parent_of_expr(e) == Parent::None {
                continue;
            }
            if let ExprKind::Assign { op, target, .. } = expr.kind {
                let is_pattern_default = bound.is_shorthand_property_assignment(hir, e)
                    || bound.get_assignment_target(hir, e).is_some();
                if !is_pattern_default {
                    let kind = op.map_or(StoreKind::Assign, StoreKind::CompoundAssign);
                    self.collect_store_targets(target, kind);
                }
            } else if let ExprKind::Unary { op, operand } = expr.kind
                && matches!(
                    op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                )
            {
                self.collect_store_targets(operand, StoreKind::Update(op));
            } else if matches!(expr.kind, ExprKind::ImportMeta)
                && may_modify_import_meta(hir, bound, e)
            {
                self.import_meta_may_be_modified = true;
            }
        }
        for (index, stmt) in hir.stmts.iter().enumerate() {
            if bound.parent_of_stmt(StmtId(index as u32)) == Parent::None {
                continue;
            }
            let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = stmt.kind else {
                continue;
            };
            if let StmtKind::Expr(target) = hir[left].kind {
                let is_for_in = matches!(stmt.kind, StmtKind::ForIn { .. });
                let kind = if is_for_in {
                    StoreKind::ForIn
                } else {
                    StoreKind::ForOf
                };
                self.collect_store_targets(target, kind);
            }
        }
    }

    fn collect_store_targets(&mut self, root: ExprId, root_kind: StoreKind) {
        let hir = self.lookup.hir;
        let mut targets = vec![(root, root_kind)];
        while let Some((target, kind)) = targets.pop() {
            match hir[target].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr)
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::Spread(expr)
                | ExprKind::Assign {
                    op: None,
                    target: expr,
                    ..
                } => targets.push((expr, kind)),
                ExprKind::Ident(_) => self.record_store(target, kind),
                ExprKind::Array(items) => {
                    let items = hir.ids(items);
                    targets.extend(items.map(|item| (item, StoreKind::Destructure)));
                }
                ExprKind::Object(props) => {
                    let values = props.iter().map(|prop| hir[prop].value);
                    let values = values.filter(|value| value.is_some());
                    targets.extend(values.map(|value| (value, StoreKind::Destructure)));
                }
                ExprKind::Missing
                | ExprKind::PrivateIdentifier(_)
                | ExprKind::This
                | ExprKind::Super
                | ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex { .. }
                | ExprKind::Template { .. }
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Unary { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Assign { op: Some(_), .. }
                | ExprKind::Cond { .. }
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::Jsx(_)
                | ExprKind::ImportCall { .. }
                | ExprKind::ImportMeta
                | ExprKind::NewTarget(_)
                | ExprKind::JsxText(_) => {}
            }
        }
    }

    fn record_store(&mut self, target: ExprId, kind: StoreKind) {
        if !has_bit(&self.references.evaluated_idents, target.idx()) {
            return;
        }
        insert_bit(&mut self.references.store_targets, target.idx());
        match self.evaluated_ident_binding(target) {
            Binding::Symbol(symbol) => self.references.stores.push(SymbolStore {
                symbol,
                target,
                kind,
            }),
            Binding::Free | Binding::CommonJs(_) | Binding::Arguments(_) => {
                self.references.unbound_name_stores.push((target, kind));
            }
        }
    }

    fn evaluated_ident_binding(&self, ident: ExprId) -> Binding {
        let binding = find_entry(&self.references.ident_bindings, ident).copied();
        binding.unwrap_or_else(|| self.lookup.bound.default_binding(ident))
    }

    /// `bun build` writes the one name of a define in place of an identifier, so a store to the identifier is a store to what that name is there.
    pub(super) fn collect_stores_through_defines(&mut self) {
        let heads = self.define_heads;
        if !heads.iter().any(|entry| entry.renames_root) {
            return;
        }
        let hir = self.lookup.hir;
        for reference in &self.references.implicit_references {
            let (ImplicitReferenceKind::DefineHead, NodeData::Expr(root), Binding::Symbol(symbol)) =
                (reference.kind, reference.node, reference.binding)
            else {
                continue;
            };
            let ExprKind::Ident(name) = hir[root].kind else {
                continue;
            };
            let renames_root = |entry: &DefineHead| {
                entry.renames_root
                    && entry.root == DefineRoot::Global(name)
                    && entry.head == reference.name
            };
            if !has_bit(&self.references.store_targets, root.idx())
                || !heads.iter().any(renames_root)
                || self.is_in_with_scope(root)
            {
                continue;
            }
            // The identifier itself names no symbol, so `record_store` has listed its store among those to unbound names.
            let mut unbound = self.references.unbound_name_stores.iter();
            if let Some(&(target, kind)) = unbound.find(|store| store.0 == root) {
                self.references.stores.push(SymbolStore {
                    symbol,
                    target,
                    kind,
                });
            }
        }
    }

    // What `is_in_with_scope` of `import_sites` answers once the file is bound. The fold applies no define to such an identifier.
    fn is_in_with_scope(&self, ident: ExprId) -> bool {
        let scopes = &self.lookup.bound.scopes;
        let mut scope = find_entry(&self.references.dynamic_ident_lookups, ident).copied();
        while let Some(at) = scope {
            let data = &scopes[at.idx()];
            if matches!(data.kind, ScopeKind::With(_)) {
                return true;
            }
            scope = data.parent.some();
        }
        false
    }
}

pub(super) fn find_outermost_cast(hir: &File<'_>, bound: &BoundBuilder, e: ExprId) -> ExprId {
    let mut outermost = e;
    while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
        && hir.type_assertion_operand(parent).is_some()
    {
        outermost = parent;
    }
    outermost
}

fn may_modify_import_meta(hir: &File<'_>, bound: &BoundBuilder, import_meta: ExprId) -> bool {
    let object = find_outermost_cast(hir, bound, import_meta);
    let access = match bound.parent_of_expr(object) {
        Parent::Expr(parent) if parent.is_some() => parent,
        Parent::VarInit(declaration) => {
            return !matches!(hir[hir[declaration].pat].kind, PatKind::Object(_));
        }
        _ => return true,
    };
    let name = match hir[access].kind {
        ExprKind::Dot { obj, name, .. } if obj == object => Some(name),
        ExprKind::Index { obj, .. } if obj == object => None,
        _ => return true,
    };
    let access = find_outermost_cast(hir, bound, access);
    if bound.get_assignment_target(hir, access).is_some() {
        return true;
    }
    let Parent::Expr(user) = bound.parent_of_expr(access) else {
        return false;
    };
    match hir.exprs.get(user.idx()).map(|user| user.kind) {
        Some(
            ExprKind::Unary {
                op: UnOp::Delete, ..
            }
            | ExprKind::TaggedTemplate(_),
        ) => true,
        Some(ExprKind::Call(call)) if hir[call].callee == access => {
            !name.is_some_and(|name| name == known::require || name == known::resolve)
        }
        _ => false,
    }
}
