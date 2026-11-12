use super::answers::{FunctionRef, MemberForm, ObjectMemberKind};
use super::prototype_links::{NamedValue, PrototypeOperation, list_in};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingInitializer, Bound, FnOwner, Parent, SymbolId};
use crate::check::{Checker, Program};
use crate::hir::{
    self, BinOp, CallId, ClassId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, MemberKey,
    PatKind, PropKey, PropKind, StmtId, StmtKind,
};
use crate::program::FileId;
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use smallvec::SmallVec;
use std::sync::OnceLock;

#[derive(Copy, Clone)]
pub(in crate::check) struct StoreIndex<'s> {
    this_stores: &'s [ThisStore],
    binding_stores: &'s [BindingStore],
}

#[derive(Copy, Clone)]
pub(in crate::check) struct WrittenStores<'s> {
    names_stored_into_this: &'s [(FnId, Atom)],
    binding_stores: &'s [BindingStore],
    prototype_functions: &'s [(FnId, SymbolId)],
}

impl<'s> Program<'s> {
    fn aot_store_index(&self, file: FileId) -> &'s OnceLock<StoreIndex<'s>> {
        let of_files: &'s [OnceLock<StoreIndex<'s>>] = *self.aot_store_indexes.get_or_init(|| {
            let arena = self.session.arena();
            &*arena.alloc_slice_fill_default(self.files.modules.len())
        });
        &of_files[file.idx()]
    }

    fn aot_written_stores_of(&self, file: FileId) -> &'s OnceLock<WrittenStores<'s>> {
        let of_files: &'s [OnceLock<WrittenStores<'s>>] =
            *self.aot_written_stores.get_or_init(|| {
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
    pub(super) defined: MemberForm,
    pub(super) is_stored_by_callee: bool,
    pub(super) birth: u32,
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
        find_stores_of_binding(self.binding_stores, symbol)
    }
}

impl<'s> WrittenStores<'s> {
    pub(super) fn names_stored_into_this_of(&self, function: FnId) -> &'s [(FnId, Atom)] {
        let names = self.names_stored_into_this;
        let start = names.partition_point(|stored| stored.0 < function);
        let len = names[start..].partition_point(|stored| stored.0 == function);
        &names[start..start + len]
    }

    pub(super) fn binding_stores_of(&self, symbol: SymbolId) -> &'s [BindingStore] {
        find_stores_of_binding(self.binding_stores, symbol)
    }

    fn find_only_constructor_of(&self, function: FnId) -> Option<SymbolId> {
        let functions = self.prototype_functions;
        let start = functions.partition_point(|held| held.0 < function);
        let len = functions[start..].partition_point(|held| held.0 == function);
        match functions[start..start + len] {
            [(_, constructor)] => Some(constructor),
            _ => None,
        }
    }
}

fn find_stores_of_binding(stores: &[BindingStore], symbol: SymbolId) -> &[BindingStore] {
    let start = stores.partition_point(|store| store.symbol < symbol);
    let len = stores[start..].partition_point(|store| store.symbol == symbol);
    &stores[start..start + len]
}

impl<'s> Checker<'_, 's> {
    pub(super) fn written_stores(&mut self, file: FileId) -> WrittenStores<'s> {
        if let Some(&stores) = self.p.aot_written_stores_of(file).get() {
            return stores;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let expressions = self.exprs_by_kind(file);
        let mut stored_into_this = Vec::new();
        let mut binding_stores = Vec::new();
        for &assign in expressions.of(ExprTag::Assign) {
            let ExprKind::Assign { op, target, value } = hir[assign].kind else {
                continue;
            };
            let is_unreached = bound.parent_of_expr(assign) == Parent::None;
            if is_unreached || self.is_dead_expression(file, assign) {
                continue;
            }
            let Some((object, MemberKey::Name(name))) = hir.member_key(target) else {
                continue;
            };
            if name == known::__proto__ {
                continue;
            }
            let form = classify_store_form(op);
            let object = hir.skip_type_assertions(object);
            let object = find_prototype_object_held_by(hir, bound, object).unwrap_or(object);
            if let Some(this) = find_this_held_by(hir, bound, object) {
                if let Some(Ok(function)) = self.this_container(file, this)
                    && !matches!(bound.fns[function.idx()].owner, FnOwner::Member(_))
                {
                    stored_into_this.push((function, hir[assign].pos, name));
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
        stored_into_this
            .shared_sort_unstable_by_key(|&(function, position, _)| (function, position));
        let mut listed = FxHashSet::default();
        let names_stored_into_this: Vec<(FnId, Atom)> = stored_into_this
            .into_iter()
            .map(|(function, _, name)| (function, name))
            .filter(|&stored| listed.insert(stored))
            .collect();
        binding_stores.shared_sort_unstable_by_key(|store| {
            (store.symbol, hir[store.source].pos, store.source)
        });
        let mut prototype_functions: Vec<(FnId, SymbolId)> = binding_stores
            .iter()
            .filter(|store| matches!(store.kind, BindingStoreKind::Prototype(_)))
            .filter_map(|store| {
                Some((find_stored_function(hir, bound, store.value)?, store.symbol))
            })
            .collect();
        prototype_functions.shared_sort_unstable_by_key(|&held| held);
        prototype_functions.dedup();
        *self
            .p
            .aot_written_stores_of(file)
            .get_or_init(|| WrittenStores {
                names_stored_into_this: list_in(self.arena, &names_stored_into_this),
                binding_stores: list_in(self.arena, &binding_stores),
                prototype_functions: list_in(self.arena, &prototype_functions),
            })
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn find_constructor_of_prototype_function(
        &mut self,
        function: FunctionRef,
    ) -> Option<SymbolId> {
        let FunctionRef { file, function } = function;
        self.c
            .written_stores(file)
            .find_only_constructor_of(function)
    }

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

    pub(super) fn store_index(&mut self, file: FileId) -> StoreIndex<'c> {
        let of_file = self.c.p.aot_store_index(file);
        if let Some(&index) = of_file.get() {
            return index;
        }
        if let Some(&index) = self.kept.store_indexes.get(&file) {
            return index;
        }
        self.compute_store_index(file)
    }

    fn compute_store_index(&mut self, file: FileId) -> StoreIndex<'c> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let assigns = self.c.exprs_by_kind(file);
        let mut this_stores = Vec::new();
        let mut first_exits = FxHashMap::default();
        let mut first_returns = FxHashMap::default();
        let mut has_asked_checker = false;
        let handed_this = self.find_parameters_handed_this(file, &mut first_exits);
        for &assign in assigns.of(ExprTag::Assign) {
            let ExprKind::Assign { op, target, value } = hir[assign].kind else {
                continue;
            };
            let form = classify_store_form(op);
            let is_unreached = bound.parent_of_expr(assign) == Parent::None;
            if is_unreached || self.c.is_dead_expression(file, assign) {
                continue;
            }
            let (object, names) = match hir.member_key(target) {
                Some((object, MemberKey::Name(name))) if name != known::__proto__ => {
                    (object, SmallVec::from_slice(&[name]))
                }
                Some((object, MemberKey::Computed(key))) => {
                    let is_this =
                        matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::This);
                    let name = match self.find_constant_name(file, key) {
                        None if is_this => {
                            has_asked_checker = true;
                            self.symbol_member_name(file, key)
                        }
                        name => name,
                    };
                    match name {
                        Some(name) => (object, SmallVec::from_slice(&[name])),
                        None => {
                            let mentions = assigns.of(ExprTag::Ident);
                            (object, self.find_listed_names(file, assign, key, mentions))
                        }
                    }
                }
                Some((_, MemberKey::Name(_) | MemberKey::PrivateName(_))) | None => continue,
            };
            let object = hir.skip_type_assertions(object);
            let object = find_prototype_object_held_by(hir, bound, object).unwrap_or(object);
            for name in names {
                let handing =
                    owners_handing_this_to(&handed_this, bound_symbol(hir, bound, object));
                for (owner, birth, helper) in handing {
                    let birth =
                        match self.is_always_evaluated_in(file, helper, assign, &mut first_returns)
                        {
                            true => birth,
                            false => u32::MAX,
                        };
                    this_stores.push(ThisStore {
                        owner,
                        name,
                        assign,
                        value,
                        form,
                        is_in_every_construction: false,
                        defined: MemberForm::default(),
                        is_stored_by_callee: true,
                        birth,
                    });
                }
                if let Some(this) = find_this_held_by(hir, bound, object)
                    && let Some(owner) = self.this_owner(file, this)
                {
                    let is_in_every_construction = form == StoreForm::Plain
                        && self.is_in_every_construction(file, owner, assign, &mut first_exits);
                    this_stores.push(ThisStore {
                        owner,
                        name,
                        assign,
                        value,
                        form,
                        is_in_every_construction,
                        defined: MemberForm::default(),
                        is_stored_by_callee: false,
                        birth: match is_in_every_construction {
                            true => hir[assign].pos,
                            false => u32::MAX,
                        },
                    });
                }
            }
        }
        self.add_definitions_on_this(
            file,
            &handed_this,
            &mut first_exits,
            &mut first_returns,
            &mut this_stores,
        );
        this_stores.shared_sort_unstable_by_key(|store| {
            (store.owner, hir[store.assign].pos, store.assign)
        });
        let binding_stores = self.c.written_stores(file).binding_stores;
        if has_asked_checker {
            let index = StoreIndex {
                this_stores: list_in(self.arena, &this_stores),
                binding_stores,
            };
            self.kept.store_indexes.insert(file, index);
            return index;
        }
        *self.c.p.aot_store_index(file).get_or_init(|| StoreIndex {
            this_stores: list_in(self.c.arena, &this_stores),
            binding_stores,
        })
    }

    fn find_constant_name(&self, file: FileId, key: ExprId) -> Option<Atom> {
        if !matches!(self.c.hir(file)[key].kind, ExprKind::Ident(_)) {
            return None;
        }
        let name = self.c.constant_string(file, key)?;
        let text = self.atom_bytes(name);
        let may_be_index = text.first().is_some_and(u8::is_ascii_digit);
        (name != known::__proto__ && !may_be_index).then_some(name)
    }

    fn find_listed_names(
        &self,
        file: FileId,
        assign: ExprId,
        key: ExprId,
        mentions: &[ExprId],
    ) -> SmallVec<[Atom; 4]> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let ExprKind::Index { obj: list, .. } = hir[key].kind else {
            return SmallVec::new();
        };
        match self.find_written_names(hir, bound, list) {
            Some(names)
                if is_in_loop_of_function_body(hir, bound, assign)
                    && is_only_read_by_index(hir, bound, list, mentions) =>
            {
                names
            }
            _ => SmallVec::new(),
        }
    }

    fn find_written_names(
        &self,
        hir: &hir::File<'_>,
        bound: &Bound<'_>,
        list: ExprId,
    ) -> Option<SmallVec<[Atom; 4]>> {
        let written = find_stable_initializer(hir, bound, list)?;
        let ExprKind::Array(elements) = hir[hir.skip_type_assertions(written)].kind else {
            return None;
        };
        hir.ids(elements)
            .map(|element| match hir[element].kind {
                ExprKind::String(name) if name != known::__proto__ => {
                    let first = self.atom_bytes(name).first();
                    first.is_some_and(|it| !it.is_ascii_digit()).then_some(name)
                }
                _ => None,
            })
            .collect()
    }

    fn find_parameters_handed_this(
        &mut self,
        file: FileId,
        first_exits: &mut FxHashMap<FnId, u32>,
    ) -> Vec<(SymbolId, ThisOwner, u32, FnId)> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        let mut handed = Vec::new();
        if expressions.of(ExprTag::This).is_empty() {
            return handed;
        }
        let mut holders = Vec::new();
        for &site in expressions.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[site].kind else {
                continue;
            };
            holders.clear();
            for (index, operand) in hir.ids(hir[call].args).enumerate() {
                if matches!(hir[operand].kind, ExprKind::Spread(_)) {
                    break;
                }
                let operand = hir.skip_type_assertions(operand);
                if let Some(this) = find_this_that_may_be_held_by(hir, bound, operand) {
                    holders.push((
                        index,
                        this,
                        find_this_held_by(hir, bound, operand).is_some(),
                    ));
                }
            }
            if holders.is_empty() || self.is_never_evaluated(file, site) {
                continue;
            }
            let callee = self
                .inputs
                .named_values
                .find_named_value(file, hir[call].callee);
            let Some(NamedValue::Function(callee)) = callee else {
                continue;
            };
            if callee.file != file {
                continue;
            }
            for &(index, this, is_surely_this) in &holders {
                let owner = self.this_owner(file, this);
                let parameter = find_plain_parameter(hir, bound, callee.function, index);
                if let (Some(owner @ (ThisOwner::Instance(_) | ThisOwner::Function(_))), Some(it)) =
                    (owner, parameter)
                {
                    let is_at_birth = is_surely_this
                        && self.is_in_every_construction(file, owner, site, first_exits);
                    let birth = match is_at_birth {
                        true => hir[site].pos,
                        false => u32::MAX,
                    };
                    handed.push((it, owner, birth, callee.function));
                }
            }
        }
        handed.sort_unstable();
        handed.dedup_by_key(|&mut (parameter, owner, ..)| (parameter, owner));
        handed
    }

    fn is_never_evaluated(&self, file: FileId, expression: ExprId) -> bool {
        self.c.bound(file).parent_of_expr(expression) == Parent::None
            || self.c.is_dead_expression(file, expression)
    }

    fn add_definitions_on_this(
        &mut self,
        file: FileId,
        handed_this: &[(SymbolId, ThisOwner, u32, FnId)],
        first_exits: &mut FxHashMap<FnId, u32>,
        first_returns: &mut FxHashMap<FnId, u32>,
        this_stores: &mut Vec<ThisStore>,
    ) {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        for &site in expressions.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[site].kind else {
                continue;
            };
            let is_given_this = hir.ids(hir[call].args).any(|operand| {
                let operand = hir.skip_type_assertions(operand);
                find_this_that_may_be_held_by(hir, bound, operand).is_some()
                    || owners_handing_this_to(handed_this, bound_symbol(hir, bound, operand))
                        .next()
                        .is_some()
            });
            if !is_given_this {
                continue;
            }
            let callee = self
                .inputs
                .named_values
                .find_named_value(file, hir[call].callee);
            let Some(NamedValue::PrototypeOperation(PrototypeOperation::DefineProperty {
                object,
                key,
                descriptor,
            })) = callee
            else {
                continue;
            };
            let operands = [object, key, descriptor].map(|at| find_operand_at(hir, call, at));
            let [Some(object), Some(key), Some(descriptor)] = operands else {
                continue;
            };
            let ExprKind::String(name) = hir[key].kind else {
                continue;
            };
            let Some((defined, value)) = find_written_data_descriptor(hir, bound, descriptor)
            else {
                continue;
            };
            if name == known::__proto__ || self.is_never_evaluated(file, site) {
                continue;
            }
            let own = find_this_that_may_be_held_by(hir, bound, object)
                .and_then(|this| self.this_owner(file, this))
                .filter(|owner| !matches!(owner, ThisOwner::Static(_)));
            let handed = owners_handing_this_to(handed_this, bound_symbol(hir, bound, object));
            let own = own.map(|owner| {
                match self.is_in_every_construction(file, owner, site, first_exits) {
                    true => (owner, hir[site].pos, None),
                    false => (owner, u32::MAX, None),
                }
            });
            let handed = handed.map(|(owner, birth, helper)| (owner, birth, Some(helper)));
            for (owner, birth, helper) in own.into_iter().chain(handed) {
                let birth = match helper {
                    Some(helper)
                        if !self.is_always_evaluated_in(file, helper, site, first_returns) =>
                    {
                        u32::MAX
                    }
                    Some(_) | None => birth,
                };
                this_stores.push(ThisStore {
                    owner,
                    name,
                    assign: site,
                    value,
                    form: StoreForm::Plain,
                    is_in_every_construction: false,
                    defined,
                    is_stored_by_callee: helper.is_some(),
                    birth,
                });
            }
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

    fn is_always_evaluated_in(
        &self,
        file: FileId,
        function: FnId,
        expression: ExprId,
        first_returns: &mut FxHashMap<FnId, u32>,
    ) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return false;
        }
        let Some(statement) = find_statement_always_evaluating(hir, bound, expression) else {
            return false;
        };
        if bound.parent_of_stmt(statement) != Parent::FnBody(function) {
            return false;
        }
        let first_return = *first_returns.entry(function).or_insert_with(|| {
            let returns = bound.ids(bound.fns[function.idx()].returns);
            let live = returns.filter(|&statement| !self.c.is_dead_statement(file, statement));
            live.map(|statement| hir[statement].start)
                .min()
                .unwrap_or(u32::MAX)
        });
        hir[statement].start < first_return
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

fn find_stored_function(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> Option<FnId> {
    let value = hir.skip_type_assertions(value);
    let function = match hir[value].kind {
        ExprKind::Fn(function) => function,
        ExprKind::Ident(_) => {
            let symbol = bound_symbol(hir, bound, value)?;
            if !bound.is_stable_binding(symbol) {
                return None;
            }
            match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Function(function) => function,
                BindingInitializer::Expression(initializer) => {
                    match hir[hir.skip_type_assertions(initializer)].kind {
                        ExprKind::Fn(function) => function,
                        _ => return None,
                    }
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    (hir[function].kind != FnKind::Arrow).then_some(function)
}

fn is_in_loop_of_function_body(hir: &hir::File<'_>, bound: &Bound<'_>, expression: ExprId) -> bool {
    let Some(mut body) = find_statement_always_evaluating(hir, bound, expression) else {
        return false;
    };
    if let Parent::Stmt(block) = bound.parent_of_stmt(body)
        && block.is_some()
        && matches!(hir[block].kind, StmtKind::Block(_))
    {
        body = block;
    }
    let Parent::Stmt(around) = bound.parent_of_stmt(body) else {
        return false;
    };
    around.is_some()
        && matches!(hir[around].kind, StmtKind::For { .. })
        && matches!(bound.parent_of_stmt(around), Parent::FnBody(_))
}

fn is_only_read_by_index(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    list: ExprId,
    mentions: &[ExprId],
) -> bool {
    let binding = bound.binding(list);
    let is_read = |&mention: &ExprId| {
        let Parent::Expr(access) = bound.parent_of_expr(mention) else {
            return false;
        };
        let is_access = match hir[access].kind {
            ExprKind::Index { obj, .. } => obj == mention,
            ExprKind::Dot { obj, name, .. } => obj == mention && name == known::length,
            _ => false,
        };
        is_access && is_read_as_value(hir, bound, access)
    };
    mentions
        .iter()
        .filter(|&&mention| bound.binding(mention) == binding)
        .all(is_read)
}

fn is_read_as_value(hir: &hir::File<'_>, bound: &Bound<'_>, access: ExprId) -> bool {
    match bound.parent_of_expr(access) {
        Parent::Expr(parent) => match hir[parent].kind {
            ExprKind::Index { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Template { .. }
            | ExprKind::Cond { .. } => true,
            ExprKind::Assign { target, .. } => target != access,
            ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != access,
            _ => false,
        },
        Parent::VarInit(_) => true,
        Parent::Stmt(statement) => {
            statement.is_some() && !matches!(hir[statement].kind, StmtKind::Expr(_))
        }
        _ => false,
    }
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

fn find_this_that_may_be_held_by(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<ExprId> {
    if matches!(hir[object].kind, ExprKind::This) {
        return Some(object);
    }
    let value = find_stable_initializer(hir, bound, object)?;
    if let Some(this) = find_this_in_initializer(hir, value) {
        return Some(this);
    }
    let ExprKind::Cond { branches, .. } = hir[hir.skip_type_assertions(value)].kind else {
        return None;
    };
    let hir::Branches { yes, no } = hir.branches(branches);
    let mut arms = [yes, no]
        .into_iter()
        .map(|arm| hir.skip_type_assertions(arm));
    arms.find(|&arm| matches!(hir[arm].kind, ExprKind::This))
}

fn owners_handing_this_to(
    handed_this: &[(SymbolId, ThisOwner, u32, FnId)],
    parameter: Option<SymbolId>,
) -> impl Iterator<Item = (ThisOwner, u32, FnId)> + '_ {
    let of_parameter = match parameter {
        Some(parameter) => {
            let start = handed_this.partition_point(|&(symbol, ..)| symbol < parameter);
            let len = handed_this[start..].partition_point(|&(symbol, ..)| symbol == parameter);
            &handed_this[start..start + len]
        }
        None => &[],
    };
    of_parameter
        .iter()
        .map(|&(_, owner, birth, helper)| (owner, birth, helper))
}

fn find_plain_parameter(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
    index: usize,
) -> Option<SymbolId> {
    let written = &hir[hir[function].params.iter().nth(index)?];
    let is_plain_name = matches!(hir[written.pat].kind, PatKind::Ident(_))
        && written.default.is_none()
        && !written.flags.contains(Flags::REST);
    let symbol = bound.pat_symbol[written.pat.idx()];
    (is_plain_name && bound.is_stable_binding(symbol)).then_some(symbol)
}

fn find_operand_at(hir: &hir::File<'_>, call: CallId, index: u32) -> Option<ExprId> {
    let mut operands = hir.ids(hir[call].args).take(index as usize + 1);
    if operands
        .clone()
        .any(|operand| matches!(hir[operand].kind, ExprKind::Spread(_)))
    {
        return None;
    }
    Some(hir.skip_type_assertions(operands.nth(index as usize)?))
}

fn find_written_data_descriptor(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    descriptor: ExprId,
) -> Option<(MemberForm, ExprId)> {
    let (literal, is_in_place) = match hir[descriptor].kind {
        ExprKind::Object(_) => (descriptor, true),
        _ => {
            let holder = bound_symbol(hir, bound, descriptor)?;
            if !bound.is_stable_binding(holder) {
                return None;
            }
            let BindingInitializer::Expression(held) = bound.binding_initializer(hir, holder)
            else {
                return None;
            };
            (hir.skip_type_assertions(held), false)
        }
    };
    let ExprKind::Object(properties) = hir[literal].kind else {
        return None;
    };
    let mut form = MemberForm {
        is_read_only: true,
        is_not_enumerable: true,
        is_not_configurable: true,
    };
    let mut value = ExprId::NONE;
    for id in properties.iter() {
        let property = &hir[id];
        let (PropKind::Init, PropKey::Name(name)) = (property.kind, hir.runtime_property_key(id))
        else {
            return None;
        };
        if name == known::value {
            value = property.value;
            continue;
        }
        let is_set = match hir[hir.skip_type_assertions(property.value)].kind {
            ExprKind::True => true,
            ExprKind::False => false,
            _ => return None,
        };
        if name == known::writable {
            form.is_read_only = !is_set;
        } else if name == known::enumerable {
            form.is_not_enumerable = !is_set;
        } else if name == known::configurable {
            form.is_not_configurable = !is_set;
        } else {
            return None;
        }
    }
    Some((form, if is_in_place { value } else { ExprId::NONE }))
}

fn find_this_held_by(hir: &hir::File<'_>, bound: &Bound<'_>, object: ExprId) -> Option<ExprId> {
    if matches!(hir[object].kind, ExprKind::This) {
        return Some(object);
    }
    find_this_in_initializer(hir, find_stable_initializer(hir, bound, object)?)
}

fn find_stable_initializer(
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
    Some(value)
}

fn find_this_in_initializer(hir: &hir::File<'_>, value: ExprId) -> Option<ExprId> {
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
