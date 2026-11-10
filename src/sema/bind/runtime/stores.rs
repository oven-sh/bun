use super::bits::{has_bit, insert_bit};
use super::queries::find_entry;
use super::references::ReferencePass;
use super::{Binding, StoreKind, SymbolStore};
use crate::atom::{Intern, known};
use crate::bind::{BoundBuilder, Parent, SymbolId};
use crate::fold::{DefinePath, DefineRoot};
use crate::hir::*;

impl ReferencePass<'_, '_> {
    pub(super) fn collect_stores(&mut self) {
        let (hir, bound, atoms) = (self.lookup.hir, self.lookup.bound, self.atoms);
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId(index as u32);
            match expr.kind {
                ExprKind::Assign { op, target, .. } => {
                    if bound.parent_of_expr(e) == Parent::None {
                        continue;
                    }
                    let is_pattern_default = bound.is_shorthand_property_assignment(hir, e)
                        || bound.get_assignment_target(hir, e).is_some();
                    if !is_pattern_default {
                        let kind = op.map_or(StoreKind::Assign, StoreKind::CompoundAssign);
                        self.collect_store_targets(target, kind);
                    }
                }
                ExprKind::Unary {
                    op: op @ (UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
                    operand,
                } => {
                    if bound.parent_of_expr(e) != Parent::None {
                        self.collect_store_targets(operand, StoreKind::Update(op));
                    }
                }
                ExprKind::ImportMeta => {
                    self.has_import_meta = true;
                    if bound.parent_of_expr(e) != Parent::None
                        && may_modify_import_meta(hir, bound, atoms, e)
                    {
                        self.import_meta_may_be_modified = true;
                    }
                }
                _ => {}
            }
        }
        for (index, stmt) in hir.stmts.iter().enumerate() {
            let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = stmt.kind else {
                continue;
            };
            if bound.parent_of_stmt(StmtId(index as u32)) == Parent::None {
                continue;
            }
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
        let mut targets = Vec::new();
        let mut next = Some((root, root_kind));
        while let Some((target, kind)) = next.take().or_else(|| targets.pop()) {
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
                } => next = Some((expr, kind)),
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
        let binding = self.evaluated_ident_binding(target);
        if self.is_first_name_of_path_in_place(target, binding) {
            return;
        }
        insert_bit(&mut self.references.store_targets, target.idx());
        match binding {
            Binding::Symbol(symbol) => {
                let symbol = self.find_binding_that_takes_store(target, symbol);
                self.references.stores.push(SymbolStore {
                    symbol,
                    target,
                    kind,
                });
            }
            Binding::Free | Binding::CommonJs(_) | Binding::Arguments(_) => {
                self.references.unbound_name_stores.push((target, kind));
            }
        }
    }

    fn is_first_name_of_path_in_place(&self, ident: ExprId, binding: Binding) -> bool {
        let (hir, bound) = (self.lookup.hir, self.lookup.bound);
        let (ExprKind::Ident(name), Binding::Symbol(symbol)) = (hir[ident].kind, binding) else {
            return false;
        };
        let written = DefinePath {
            root: DefineRoot::Global(name),
            members: &[],
        };
        let mut names_in_place = self.names_in_place.iter();
        names_in_place.any(|it| !it.is_one_name && it.path == written)
            && bound.symbols[symbol.idx()].name != name
    }

    fn find_binding_that_takes_store(&mut self, target: ExprId, named: SymbolId) -> SymbolId {
        let Some(own) = self.lookup.bound.own_binding_of_decorated_class(named) else {
            return named;
        };
        let bindings = &mut self.references.ident_bindings;
        match bindings.binary_search_by_key(&target, |entry| entry.0) {
            Ok(index) => bindings[index].1 = Binding::Symbol(own),
            Err(index) => bindings.insert(index, (target, Binding::Symbol(own))),
        }
        own
    }

    fn evaluated_ident_binding(&self, ident: ExprId) -> Binding {
        let binding = find_entry(&self.references.ident_bindings, ident).copied();
        binding.unwrap_or_else(|| self.lookup.bound.default_binding(ident))
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

pub(super) fn is_object_of_element(hir: &File<'_>, bound: &BoundBuilder, object: ExprId) -> bool {
    let object = find_outermost_cast(hir, bound, object);
    match bound.parent_of_expr(object) {
        Parent::Expr(parent) if parent.is_some() => {
            matches!(hir[parent].kind, ExprKind::Index { obj, .. } if obj == object)
        }
        _ => false,
    }
}

pub(super) fn is_object_of_own_member_of_arguments(
    hir: &File<'_>,
    bound: &BoundBuilder,
    object: ExprId,
) -> bool {
    let object = find_outermost_cast(hir, bound, object);
    let Parent::Expr(access) = bound.parent_of_expr(object) else {
        return false;
    };
    match hir.exprs.get(access.idx()).map(|access| access.kind) {
        Some(ExprKind::Dot { obj, name, .. }) => {
            obj == object && (name == known::length || name == known::callee)
        }
        Some(ExprKind::Index { obj, index, .. }) => {
            obj == object && matches!(hir[index].kind, ExprKind::Number(_))
        }
        _ => false,
    }
}

pub(super) fn is_object_of_read(hir: &File<'_>, bound: &BoundBuilder, object: ExprId) -> bool {
    let object = find_outermost_cast(hir, bound, object);
    let access = match bound.parent_of_expr(object) {
        Parent::Expr(parent) if parent.is_some() => parent,
        _ => return false,
    };
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[access].kind else {
        return false;
    };
    if obj != object {
        return false;
    }
    let access = find_outermost_cast(hir, bound, access);
    if bound.get_assignment_target(hir, access).is_some() {
        return false;
    }
    let Parent::Expr(user) = bound.parent_of_expr(access) else {
        return true;
    };
    match hir.exprs.get(user.idx()).map(|user| user.kind) {
        Some(ExprKind::Unary {
            op: UnOp::Delete, ..
        }) => false,
        Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) => hir[call].callee != access,
        _ => true,
    }
}

fn may_modify_import_meta(
    hir: &File<'_>,
    bound: &BoundBuilder,
    atoms: &dyn Intern,
    import_meta: ExprId,
) -> bool {
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
        Some(ExprKind::Unary {
            op: UnOp::Delete, ..
        }) => true,
        Some(ExprKind::TaggedTemplate(call)) => hir[call].callee == access,
        Some(ExprKind::Call(call)) if hir[call].callee == access => !name.is_some_and(|name| {
            name == known::require || name == known::resolve || atoms.bytes(name) == b"resolveSync"
        }),
        _ => false,
    }
}
