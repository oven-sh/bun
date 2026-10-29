use super::answers::ObjectMemberKind;
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent, SymbolId};
use crate::check::Program;
use crate::hir::{
    self, BinOp, ClassId, ExprId, ExprKind, ExprTag, FnId, FnKind, MemberKey, PropKey, PropKind,
    StmtId, StmtKind,
};
use crate::program::FileId;
use crate::session::Arena;
use crate::util::FxHashMap;
use std::sync::OnceLock;

pub(in crate::check) struct StoreIndex<'s> {
    this_stores: &'s [ThisStore],
    binding_stores: &'s [BindingStore],
}

fn list_in<'s, T: Copy>(arena: &'s Arena, items: &[T]) -> &'s [T] {
    match items.is_empty() {
        true => &[],
        false => arena.alloc_slice_copy(items),
    }
}

impl<'s> Program<'s> {
    fn aot_store_index(&self, file: FileId) -> &'s OnceLock<StoreIndex<'s>> {
        let of_files: &'s [OnceLock<StoreIndex<'s>>] = *self.aot_store_indexes.get_or_init(|| {
            let arena = self.session.arena();
            &*arena.alloc_slice_fill_default(self.files.modules.len())
        });
        &of_files[file.idx()]
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum ThisOwner {
    Instance(ClassId),
    Static(ClassId),
    Function(FnId),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum StoreForm {
    Plain,
    Logical,
    Compound,
}

#[derive(Copy, Clone)]
pub(super) struct ThisStore {
    pub(super) owner: ThisOwner,
    pub(super) name: Atom,
    pub(super) assign: ExprId,
    pub(super) value: ExprId,
    pub(super) form: StoreForm,
    pub(super) is_in_every_construction: bool,
}

#[derive(Copy, Clone)]
pub(super) enum BindingStoreKind {
    Static,
    Prototype(ObjectMemberKind),
}

#[derive(Copy, Clone)]
pub(super) struct BindingStore {
    pub(super) symbol: SymbolId,
    pub(super) kind: BindingStoreKind,
    pub(super) name: Atom,
    pub(super) source: ExprId,
    pub(super) value: ExprId,
    pub(super) form: StoreForm,
}

impl<'c> StoreIndex<'c> {
    pub(super) fn this_stores_of(&self, owner: ThisOwner) -> &'c [ThisStore] {
        let stores = self.this_stores;
        let start = stores.partition_point(|store| store.owner < owner);
        let len = stores[start..].partition_point(|store| store.owner == owner);
        &stores[start..start + len]
    }

    pub(super) fn binding_stores_of(&self, symbol: SymbolId) -> &'c [BindingStore] {
        let stores = self.binding_stores;
        let start = stores.partition_point(|store| store.symbol < symbol);
        let len = stores[start..].partition_point(|store| store.symbol == symbol);
        &stores[start..start + len]
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn class_and_side_of_member_fn(
        &self,
        file: FileId,
        function: FnId,
    ) -> Option<(ClassId, bool)> {
        let class = self.c.class_of_member_fn(file, function)?;
        let FnOwner::Member(member) = self.c.bound(file).fns[function.idx()].owner else {
            return None;
        };
        Some((
            class,
            self.c.hir(file)[member].flags.contains(hir::Flags::STATIC),
        ))
    }

    pub(super) fn store_index(&mut self, file: FileId) -> &'s StoreIndex<'s> {
        let of_file = self.c.p.aot_store_index(file);
        of_file.get_or_init(|| self.compute_store_index(file))
    }

    fn compute_store_index(&mut self, file: FileId) -> StoreIndex<'s> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let assigns = self.c.exprs_by_kind(file);
        let mut this_stores = Vec::new();
        let mut binding_stores = Vec::new();
        let mut first_exits = FxHashMap::default();
        for &assign in assigns.of(ExprTag::Assign) {
            let ExprKind::Assign { op, target, value } = hir[assign].kind else {
                continue;
            };
            let form = classify_store_form(op);
            let is_unreached = bound.parent_of_expr(assign) == Parent::None;
            if is_unreached || self.c.is_dead_expression(file, assign) {
                continue;
            }
            let (object, name) = match hir.member_key(target) {
                Some((object, MemberKey::Name(name))) if name != known::__proto__ => (object, name),
                Some((object, MemberKey::Computed(key)))
                    if matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::This) =>
                {
                    match self.symbol_member_name(file, key) {
                        Some(name) => (object, name),
                        None => continue,
                    }
                }
                Some((
                    _,
                    MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_),
                ))
                | None => continue,
            };
            let object = hir.skip_type_assertions(object);
            let object = find_prototype_object_held_by(hir, bound, object).unwrap_or(object);
            if let Some(this) = find_this_held_by(hir, bound, object) {
                if let Some(owner) = self.this_owner(file, this) {
                    let is_in_every_construction = form == StoreForm::Plain
                        && self.is_in_every_construction(file, owner, assign, &mut first_exits);
                    this_stores.push(ThisStore {
                        owner,
                        name,
                        assign,
                        value,
                        form,
                        is_in_every_construction,
                    });
                }
            } else if let Some(symbol) = bound_symbol(hir, bound, object) {
                if name != known::prototype {
                    binding_stores.push(BindingStore {
                        symbol,
                        kind: BindingStoreKind::Static,
                        name,
                        source: assign,
                        value,
                        form,
                    });
                } else if form == StoreForm::Plain {
                    add_prototype_literal_stores(hir, symbol, value, &mut binding_stores);
                }
            } else if let Some(symbol) = prototype_object_symbol(hir, bound, object) {
                let member_kind = match form {
                    StoreForm::Plain | StoreForm::Logical => stored_value_kind(hir, value),
                    StoreForm::Compound => ObjectMemberKind::Field,
                };
                binding_stores.push(BindingStore {
                    symbol,
                    kind: BindingStoreKind::Prototype(member_kind),
                    name,
                    source: assign,
                    value,
                    form,
                });
            }
        }
        this_stores
            .sort_unstable_by_key(|store| (store.owner, hir[store.assign].pos, store.assign));
        binding_stores
            .sort_unstable_by_key(|store| (store.symbol, hir[store.source].pos, store.source));
        StoreIndex {
            this_stores: list_in(self.c.arena, &this_stores),
            binding_stores: list_in(self.c.arena, &binding_stores),
        }
    }

    fn this_owner(&self, file: FileId, this: ExprId) -> Option<ThisOwner> {
        let function = match self.c.this_container(file, this)? {
            Err((class, false)) => return Some(ThisOwner::Instance(class)),
            Err((class, true)) => return Some(ThisOwner::Static(class)),
            Ok(function) => function,
        };
        match self.c.hir(file)[function].kind {
            FnKind::Decl | FnKind::Expr => Some(ThisOwner::Function(function)),
            FnKind::StaticBlock => {
                let class = self.c.bound(file).function_class(function)?;
                Some(ThisOwner::Static(class))
            }
            FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                let (class, is_static) = self.class_and_side_of_member_fn(file, function)?;
                Some(match is_static {
                    true => ThisOwner::Static(class),
                    false => ThisOwner::Instance(class),
                })
            }
            _ => None,
        }
    }

    fn is_in_every_construction(
        &self,
        file: FileId,
        owner: ThisOwner,
        assign: ExprId,
        first_exits: &mut FxHashMap<FnId, u32>,
    ) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let Some(statement) = find_statement_always_evaluating(hir, bound, assign) else {
            return false;
        };
        let Parent::FnBody(function) = bound.parent_of_stmt(statement) else {
            return false;
        };
        let is_constructor = match owner {
            ThisOwner::Instance(_) => hir[function].kind == FnKind::Constructor,
            ThisOwner::Function(constructor) => function == constructor,
            ThisOwner::Static(_) => false,
        };
        if !is_constructor {
            return false;
        }
        let first_exit = *first_exits
            .entry(function)
            .or_insert_with(|| self.find_first_exit_with_this(file, function));
        hir[statement].start < first_exit
    }

    fn find_first_exit_with_this(&self, file: FileId, function: FnId) -> u32 {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let returns = bound.ids(bound.fns[function.idx()].returns);
        let exits = returns.filter(|&statement| {
            !self.c.is_dead_statement(file, statement) && !returns_created_object(hir, statement)
        });
        let first = exits.map(|statement| hir[statement].start).min();
        first.unwrap_or(u32::MAX)
    }
}

fn classify_store_form(op: Option<BinOp>) -> StoreForm {
    match op {
        None => StoreForm::Plain,
        Some(BinOp::And | BinOp::Or | BinOp::Nullish) => StoreForm::Logical,
        Some(
            BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr
            | BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::In
            | BinOp::Instanceof
            | BinOp::Comma,
        ) => StoreForm::Compound,
    }
}

fn find_statement_always_evaluating(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut expression: ExprId,
) -> Option<StmtId> {
    loop {
        let parent = match bound.parent_of_expr(expression) {
            Parent::Expr(parent) => parent.some()?,
            Parent::Stmt(statement) => {
                let statement = statement.some()?;
                return matches!(hir[statement].kind, StmtKind::Expr(_)).then_some(statement);
            }
            _ => return None,
        };
        let is_stored_value = matches!(
            hir[parent].kind,
            ExprKind::Assign { op: None, value, .. } if value == expression
        );
        let is_in_sequence = matches!(
            hir[parent].kind,
            ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
        );
        if !is_stored_value && !is_in_sequence {
            return None;
        }
        expression = parent;
    }
}

fn returns_created_object(hir: &hir::File<'_>, statement: StmtId) -> bool {
    let StmtKind::Return(value) = hir[statement].kind else {
        return false;
    };
    let Some(value) = value.some() else {
        return false;
    };
    matches!(
        hir[hir.skip_type_assertions(value)].kind,
        ExprKind::Regex { .. }
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
    )
}

fn stored_value_kind(hir: &hir::File<'_>, value: ExprId) -> ObjectMemberKind {
    match hir[value].kind {
        ExprKind::Fn(function) if hir[function].kind != FnKind::Arrow => ObjectMemberKind::Method,
        _ => ObjectMemberKind::Field,
    }
}

fn add_prototype_literal_stores(
    hir: &hir::File<'_>,
    symbol: SymbolId,
    value: ExprId,
    stores: &mut Vec<BindingStore>,
) {
    let ExprKind::Object(properties) = hir[value].kind else {
        return;
    };
    for id in properties.iter() {
        let property = &hir[id];
        let member_kind = match property.kind {
            PropKind::Spread => continue,
            PropKind::Method => ObjectMemberKind::Method,
            PropKind::Getter => ObjectMemberKind::Getter,
            PropKind::Setter => ObjectMemberKind::Setter,
            PropKind::Init | PropKind::Shorthand => stored_value_kind(hir, property.value),
        };
        match hir.runtime_property_key(id) {
            PropKey::Name(name) if name != known::__proto__ => stores.push(BindingStore {
                symbol,
                kind: BindingStoreKind::Prototype(member_kind),
                name,
                source: property.value,
                value: property.value,
                form: StoreForm::Plain,
            }),
            PropKey::Name(_) | PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {}
        }
    }
}

fn find_this_held_by(hir: &hir::File<'_>, bound: &Bound<'_>, object: ExprId) -> Option<ExprId> {
    if matches!(hir[object].kind, ExprKind::This) {
        return Some(object);
    }
    let variable = bound_symbol(hir, bound, object)?;
    if !bound.is_stable_binding(variable) {
        return None;
    }
    let BindingInitializer::Expression(value) = bound.binding_initializer(hir, variable) else {
        return None;
    };
    let value = match hir[hir.skip_type_assertions(value)].kind {
        ExprKind::Binary {
            op: BinOp::Or,
            right,
            ..
        } => right,
        _ => value,
    };
    let value = hir.skip_type_assertions(value);
    matches!(hir[value].kind, ExprKind::This).then_some(value)
}

pub(super) fn find_prototype_object_held_by(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<ExprId> {
    let variable = bound_symbol(hir, bound, object)?;
    if !bound.is_stable_binding(variable) {
        return None;
    }
    let BindingInitializer::Expression(value) = bound.binding_initializer(hir, variable) else {
        return None;
    };
    let value = hir.skip_type_assertions(value);
    is_prototype_property(hir, value).then_some(value)
}

pub(super) fn is_prototype_property(hir: &hir::File<'_>, e: ExprId) -> bool {
    matches!(hir.member_key(e), Some((_, MemberKey::Name(name))) if name == known::prototype)
}

fn bound_symbol(hir: &hir::File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<SymbolId> {
    if !matches!(hir[e].kind, ExprKind::Ident(_)) {
        return None;
    }
    match bound.binding(e) {
        Binding::Symbol(symbol) => Some(symbol),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
    }
}

fn prototype_object_symbol(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<SymbolId> {
    match hir.member_key(object)? {
        (root, MemberKey::Name(name)) if name == known::prototype => {
            bound_symbol(hir, bound, hir.skip_type_assertions(root))
        }
        (_, MemberKey::Name(_) | MemberKey::PrivateName(_) | MemberKey::Computed(_)) => None,
    }
}
