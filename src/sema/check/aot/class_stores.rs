use super::answers::{FunctionRef, MemberForm, ObjectMemberKind};
use super::constructor_evidence::find_named_literal;
use super::prototype_links::{NamedValue, PrototypeOperation, list_in};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingInitializer, Bound, Decl, FnOwner, Parent, PatParent, SymbolId};
use crate::check::shared_indexes::SharedIndexes;
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
    defined_names: &'s [DefinedName],
}

/// `Object.defineProperty(Class.prototype, "name", { get() { .. }, set(value) { .. } })`,
/// `__decorate([observable], Class.prototype, "name", void 0)`
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) struct DefinedName {
    pub(super) owner: ThisOwner,
    pub(super) name: Atom,
    pub(super) is_accessor: bool,
    pub(super) setter: Option<FnId>,
}

struct FirstExits {
    mentions_of_super: Vec<u32>,
    of_functions: FxHashMap<FnId, u32>,
}

impl FirstExits {
    fn find_super_behind(&self, start: u32) -> u32 {
        let behind = self
            .mentions_of_super
            .partition_point(|&place| place <= start);
        self.mentions_of_super.get(behind).copied().unwrap_or(0)
    }
}

#[derive(Copy, Clone)]
pub(in crate::check) struct WrittenStores<'s> {
    names_stored_into_this: &'s [(FnId, Atom)],
    binding_stores: &'s [BindingStore],
    prototype_functions: &'s [(FnId, SymbolId)],
    /// Literals that become prototype objects by a name: `methods` of `constructor.prototype = methods`.
    named_prototype_literals: &'s [ExprId],
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

impl ThisOwner {
    fn is_constructed_by(self, hir: &hir::File<'_>, function: FnId) -> bool {
        match self {
            ThisOwner::Instance(_) => hir[function].kind == FnKind::Constructor,
            ThisOwner::Function(constructor) => function == constructor,
            ThisOwner::Static(_) => false,
        }
    }
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
    pub(super) fn all_this_stores(&self) -> &'c [ThisStore] {
        self.this_stores
    }

    pub(super) fn this_stores_of(&self, owner: ThisOwner) -> &'c [ThisStore] {
        let stores = self.this_stores;
        let start = stores.partition_point(|store| store.owner < owner);
        let len = stores[start..].partition_point(|store| store.owner == owner);
        &stores[start..start + len]
    }

    pub(super) fn names_defined_on_prototype_of(&self, owner: ThisOwner) -> &'c [DefinedName] {
        let names = self.defined_names;
        let start = names.partition_point(|it| it.owner < owner);
        let len = names[start..].partition_point(|it| it.owner == owner);
        &names[start..start + len]
    }

    pub(super) fn binding_stores_of(&self, symbol: SymbolId) -> &'c [BindingStore] {
        find_stores_of_binding(self.binding_stores, symbol)
    }
}

impl<'s> WrittenStores<'s> {
    pub(super) fn is_named_prototype_literal(&self, literal: ExprId) -> bool {
        self.named_prototype_literals
            .binary_search(&literal)
            .is_ok()
    }

    pub(super) fn names_stored_into_this_of(&self, function: FnId) -> &'s [(FnId, Atom)] {
        let names = self.names_stored_into_this;
        let start = names.partition_point(|stored| stored.0 < function);
        let len = names[start..].partition_point(|stored| stored.0 == function);
        &names[start..start + len]
    }

    pub(super) fn binding_stores_of(&self, symbol: SymbolId) -> &'s [BindingStore] {
        find_stores_of_binding(self.binding_stores, symbol)
    }

    pub(super) fn all_binding_stores(&self) -> &'s [BindingStore] {
        self.binding_stores
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
        let mut named_prototype_literals = Vec::new();
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
            let mut value = value;
            if name == known::prototype
                && form == StoreForm::Plain
                && let Some(literal) = find_named_literal(hir, bound, value)
            {
                named_prototype_literals.push(literal);
                value = literal;
            }
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
        named_prototype_literals.sort_unstable();
        named_prototype_literals.dedup();
        *self
            .p
            .aot_written_stores_of(file)
            .get_or_init(|| WrittenStores {
                names_stored_into_this: list_in(self.arena, &names_stored_into_this),
                binding_stores: list_in(self.arena, &binding_stores),
                prototype_functions: list_in(self.arena, &prototype_functions),
                named_prototype_literals: list_in(self.arena, &named_prototype_literals),
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
        if let Some(indexes) = self.c.indexes_of_parts(file)
            && let Some(&index) = indexes.store_index.get()
        {
            self.kept.store_indexes.insert(file, index);
            return index;
        }
        self.compute_store_index(file)
    }

    /// The checkers of the other parts of the file find it there.
    pub(super) fn share_store_index(&mut self, indexes: &SharedIndexes<'s>) {
        let index = self.store_index(self.file);
        let binding_stores = self.c.written_stores(self.file).binding_stores;
        let _ = indexes.store_index.set(StoreIndex {
            this_stores: list_in(self.c.arena, index.this_stores),
            binding_stores,
            defined_names: list_in(self.c.arena, index.defined_names),
        });
    }

    fn compute_store_index(&mut self, file: FileId) -> StoreIndex<'c> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let assigns = self.c.exprs_by_kind(file);
        // Whatever holds `this` got it from such an expression.
        if assigns.of(ExprTag::This).is_empty() {
            let binding_stores = self.c.written_stores(file).binding_stores;
            return *self.c.p.aot_store_index(file).get_or_init(|| StoreIndex {
                this_stores: &[],
                binding_stores,
                defined_names: &[],
            });
        }
        let mut this_stores = Vec::new();
        let mut defined_names = Vec::new();
        let mentions_of_super = assigns.of(ExprTag::Super).iter();
        let mut mentions_of_super: Vec<u32> = mentions_of_super.map(|&it| hir[it].pos).collect();
        mentions_of_super.sort_unstable();
        let mut first_exits = FirstExits {
            mentions_of_super,
            of_functions: FxHashMap::default(),
        };
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
            &mut defined_names,
        );
        defined_names.shared_sort_unstable_by_key(|it| (it.owner, it.name.0));
        this_stores.shared_sort_unstable_by_key(|store| {
            (store.owner, hir[store.assign].pos, store.assign)
        });
        let binding_stores = self.c.written_stores(file).binding_stores;
        if has_asked_checker {
            let index = StoreIndex {
                this_stores: list_in(self.arena, &this_stores),
                binding_stores,
                defined_names: list_in(self.arena, &defined_names),
            };
            self.kept.store_indexes.insert(file, index);
            return index;
        }
        *self.c.p.aot_store_index(file).get_or_init(|| StoreIndex {
            this_stores: list_in(self.c.arena, &this_stores),
            binding_stores,
            defined_names: list_in(self.c.arena, &defined_names),
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

    /// The names of a list that `object[names[i]] = v` goes over in a loop of a function's body.
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
        first_exits: &mut FirstExits,
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
        first_exits: &mut FirstExits,
        first_returns: &mut FxHashMap<FnId, u32>,
        this_stores: &mut Vec<ThisStore>,
        defined_names: &mut Vec<DefinedName>,
    ) {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let expressions = self.c.exprs_by_kind(file);
        for &site in expressions.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[site].kind else {
                continue;
            };
            if let Some(name) = find_name_defined_on_prototype(hir, bound, call)
                && !self.is_never_evaluated(file, site)
            {
                defined_names.push(name);
            }
            let is_given_this = hir.ids(hir[call].args).any(|operand| {
                let operand = hir.skip_type_assertions(operand);
                find_this_that_may_be_held_by(hir, bound, operand).is_some()
                    || find_this_held_by(hir, bound, operand).is_some()
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
            if let Some(NamedValue::PrototypeOperation(PrototypeOperation::DefineField {
                object,
                key,
                value,
            })) = callee
            {
                let operands = [object, key, value].map(|at| find_operand_at(hir, call, at));
                this_stores.extend(self.find_field_defined_by(file, site, operands, first_exits));
                continue;
            }
            if let Some(NamedValue::PrototypeOperation(PrototypeOperation::CopyProperties {
                target,
            })) = callee
            {
                self.add_fields_assigned_by(file, site, call, target, first_exits, this_stores);
                continue;
            }
            let Some((object, definitions)) = find_written_definitions(hir, bound, call, callee)
            else {
                continue;
            };
            if self.is_never_evaluated(file, site) {
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
                // Only the constructor of a class without a parent allocates the object that it fills.
                let fills_new_object = helper.is_none()
                    && birth != u32::MAX
                    && matches!(owner, ThisOwner::Instance(class) if hir[class].extends.is_none());
                let listed = (definitions.iter()).filter(|it| !it.is_accessor || fills_new_object);
                this_stores.extend(listed.map(|it| ThisStore {
                    owner,
                    name: it.name,
                    assign: it.descriptor.unwrap_or(site),
                    value: it.value,
                    form: StoreForm::Plain,
                    is_in_every_construction: false,
                    defined: it.form,
                    is_stored_by_callee: helper.is_some(),
                    birth,
                }));
            }
        }
    }

    /// `Object.assign(this, { a, b: 1 })`, which the lowering stores name by name.
    fn add_fields_assigned_by(
        &self,
        file: FileId,
        site: ExprId,
        call: CallId,
        target: u32,
        first_exits: &mut FirstExits,
        this_stores: &mut Vec<ThisStore>,
    ) {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let Some(object) = find_operand_at(hir, call, target) else {
            return;
        };
        let owner = find_this_held_by(hir, bound, object)
            .and_then(|this| self.this_owner(file, this))
            .filter(|owner| !matches!(owner, ThisOwner::Static(_)));
        let Some(owner) = owner.filter(|_| !self.is_never_evaluated(file, site)) else {
            return;
        };
        let is_in_every_construction =
            self.is_in_every_construction(file, owner, site, first_exits);
        for source in hir.ids(hir[call].args).skip(target as usize + 1) {
            let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind else {
                continue;
            };
            let names = properties.iter().map(|id| {
                let property = hir[id];
                let is_plain = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
                match hir.runtime_property_key(id) {
                    PropKey::Name(name) if is_plain && name != known::__proto__ => {
                        Some((name, property.value))
                    }
                    _ => None,
                }
            });
            let Some(names) = names.collect::<Option<SmallVec<[(Atom, ExprId); 8]>>>() else {
                continue;
            };
            this_stores.extend(names.into_iter().map(|(name, value)| ThisStore {
                owner,
                name,
                assign: value,
                value,
                form: StoreForm::Plain,
                is_in_every_construction,
                defined: MemberForm::default(),
                is_stored_by_callee: false,
                birth: match is_in_every_construction {
                    true => hir[site].pos,
                    false => u32::MAX,
                },
            }));
        }
    }

    /// The statement of a constructor's body that defines a field of `this`: the only place where the lowering leaves the helper out.
    fn find_field_defined_by(
        &self,
        file: FileId,
        site: ExprId,
        operands: [Option<ExprId>; 3],
        first_exits: &mut FirstExits,
    ) -> Option<ThisStore> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let [Some(object), Some(key), value] = operands else {
            return None;
        };
        let ExprKind::String(name) = hir[key].kind else {
            return None;
        };
        let this = find_this_held_by(hir, bound, object)?;
        if name == known::__proto__ || self.is_never_evaluated(file, site) {
            return None;
        }
        let statement = find_statement_always_evaluating(hir, bound, site)?;
        let Parent::FnBody(constructor) = bound.parent_of_stmt(statement) else {
            return None;
        };
        let owner = self.this_owner(file, this)?;
        if !owner.is_constructed_by(hir, constructor) {
            return None;
        }
        let is_in_every_construction =
            self.is_in_every_construction(file, owner, site, first_exits);
        Some(ThisStore {
            owner,
            name,
            assign: site,
            value: value.unwrap_or(ExprId::NONE),
            form: StoreForm::Plain,
            is_in_every_construction,
            defined: MemberForm::default(),
            is_stored_by_callee: false,
            birth: match is_in_every_construction {
                true => hir[site].pos,
                false => u32::MAX,
            },
        })
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
            FnKind::Method
                if is_setter_of_descriptor(self.c.hir(file), self.c.bound(file), function) =>
            {
                Some(ThisOwner::Function(function))
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

    pub(super) fn is_evaluated_in_every_construction(
        &self,
        constructor: FunctionRef,
        call: ExprId,
    ) -> bool {
        let mut first_exits = FirstExits {
            mentions_of_super: Vec::new(),
            of_functions: FxHashMap::default(),
        };
        let owner = ThisOwner::Function(constructor.function);
        self.is_in_every_construction(constructor.file, owner, call, &mut first_exits)
    }

    /// The caller may drop what the function returns.
    pub(super) fn is_evaluated_before_returns(
        &self,
        function: FunctionRef,
        expression: ExprId,
    ) -> bool {
        let mut first_returns = FxHashMap::default();
        self.is_always_evaluated_in(
            function.file,
            function.function,
            expression,
            &mut first_returns,
        )
    }

    fn is_in_every_construction(
        &self,
        file: FileId,
        owner: ThisOwner,
        assign: ExprId,
        first_exits: &mut FirstExits,
    ) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let Some(statement) = find_statement_always_evaluating(hir, bound, assign) else {
            return false;
        };
        let Parent::FnBody(function) = bound.parent_of_stmt(statement) else {
            return false;
        };
        if !owner.is_constructed_by(hir, function) {
            return false;
        }
        let first_super = match owner {
            ThisOwner::Instance(class) if hir[class].extends.is_some() => {
                first_exits.find_super_behind(hir[function].start)
            }
            _ => 0,
        };
        let first_exit = *first_exits
            .of_functions
            .entry(function)
            .or_insert_with(|| self.find_first_exit_with_this(file, function, first_super));
        hir[statement].start <= first_exit
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
        hir[statement].start <= first_return
    }

    fn find_first_exit_with_this(&self, file: FileId, function: FnId, first_super: u32) -> u32 {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let returns = bound.ids(bound.fns[function.idx()].returns);
        let exits = returns.filter(|&statement| {
            !self.c.is_dead_statement(file, statement)
                && !returns_created_object(hir, statement)
                && !exits_before(hir, bound, statement, first_super)
        });
        let first = exits.map(|statement| hir[statement].start).min();
        first.unwrap_or(u32::MAX)
    }
}

/// `if (isMatrix(rows)) return rows.clone(); super(rows);`: what leaves a derived constructor in front of `super` leaves no instance behind.
fn exits_before(hir: &hir::File<'_>, bound: &Bound<'_>, statement: StmtId, place: u32) -> bool {
    let end = match hir[statement].kind {
        StmtKind::Return(value) if value.is_some() => hir[value].end,
        _ => hir[statement].start,
    };
    if end >= place {
        return false;
    }
    let mut around = bound.parent_of_stmt(statement);
    while let Parent::Stmt(outer) = around {
        if outer.is_none() {
            return false;
        }
        let comes_round = matches!(
            hir[outer].kind,
            StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::Try { .. }
        );
        if comes_round {
            return false;
        }
        around = bound.parent_of_stmt(outer);
    }
    matches!(around, Parent::FnBody(_))
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
                let is_evaluated =
                    matches!(hir[statement].kind, StmtKind::Expr(_) | StmtKind::Return(_));
                return is_evaluated.then_some(statement);
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
        // `Base.call(this) || this`
        let is_left_operand = matches!(
            hir[parent].kind,
            ExprKind::Binary { left, .. } if left == expression
        );
        if !is_stored_value && !is_in_sequence && !is_left_operand {
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

/// What the copy of a factory creates and returns.
fn find_function_of_copied_factory(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    sequence: ExprId,
) -> Option<FnId> {
    let ExprKind::Fn(copy) = hir[hir.copied_factory_of(sequence)?.function].kind else {
        return None;
    };
    let value = match hir[copy].body {
        hir::FnBody::None => return None,
        hir::FnBody::Expr(value) => value,
        hir::FnBody::Block(_) => {
            let first = bound.ids(bound.fns[copy.idx()].returns).next()?;
            match hir[first].kind {
                StmtKind::Return(value) => value.some()?,
                _ => return None,
            }
        }
    };
    find_stored_function(hir, bound, value)
}

pub(super) fn find_stored_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    value: ExprId,
) -> Option<FnId> {
    let value = hir.skip_type_assertions(value);
    let function = match hir[value].kind {
        ExprKind::Fn(function) => function,
        ExprKind::Binary { .. } => return find_function_of_copied_factory(hir, bound, value),
        ExprKind::Ident(_) => {
            let symbol = bound_symbol(hir, bound, value)?;
            if !bound.is_stable_beside_evals(symbol) {
                return None;
            }
            match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Function(function) => function,
                BindingInitializer::Expression(initializer) => {
                    let initializer = hir.skip_type_assertions(initializer);
                    match hir[initializer].kind {
                        ExprKind::Fn(function) => function,
                        ExprKind::Binary { .. } => {
                            return find_function_of_copied_factory(hir, bound, initializer);
                        }
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
    if !matches!(hir[body].kind, StmtKind::Expr(_)) {
        return false;
    }
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

struct WrittenDefinition {
    name: Atom,
    is_accessor: bool,
    /// The entry of a map of descriptors.
    descriptor: Option<ExprId>,
    form: MemberForm,
    value: ExprId,
}

/// `Object.defineProperty(object, "name", { value: v })` and `Object.defineProperties(object, { name: { value: v } })`.
fn find_written_definitions(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    call: CallId,
    callee: Option<NamedValue>,
) -> Option<(ExprId, SmallVec<[WrittenDefinition; 1]>)> {
    match callee {
        Some(NamedValue::PrototypeOperation(PrototypeOperation::DefineProperty {
            object,
            key,
            descriptor,
        })) => {
            let operands = [object, key, descriptor].map(|at| find_operand_at(hir, call, at));
            let [Some(object), Some(key), Some(descriptor)] = operands else {
                return None;
            };
            let ExprKind::String(name) = hir[key].kind else {
                return None;
            };
            if name == known::__proto__ {
                return None;
            }
            let written = find_written_data_descriptor(hir, bound, descriptor);
            let is_accessor = written.is_none() && is_written_accessor_descriptor(hir, descriptor);
            let (form, value) = match is_accessor {
                true => (MemberForm::default(), ExprId::NONE),
                false => written?,
            };
            let definition = WrittenDefinition {
                name,
                is_accessor,
                descriptor: None,
                form,
                value,
            };
            Some((object, SmallVec::from_buf([definition])))
        }
        Some(NamedValue::PrototypeOperation(PrototypeOperation::DefineProperties {
            object,
            descriptors,
        })) => {
            let operands = [object, descriptors].map(|at| find_operand_at(hir, call, at));
            let [Some(object), Some(descriptors)] = operands else {
                return None;
            };
            let ExprKind::Object(entries) = hir[descriptors].kind else {
                return None;
            };
            let definitions = entries.iter().filter_map(|entry| {
                let (PropKind::Init, PropKey::Name(name)) =
                    (hir[entry].kind, hir.runtime_property_key(entry))
                else {
                    return None;
                };
                let descriptor = hir.skip_type_assertions(hir[entry].value);
                if name == known::__proto__ || !matches!(hir[descriptor].kind, ExprKind::Object(_))
                {
                    return None;
                }
                let (form, value) = find_written_data_descriptor(hir, bound, descriptor)?;
                Some(WrittenDefinition {
                    name,
                    is_accessor: false,
                    descriptor: Some(descriptor),
                    form,
                    value,
                })
            });
            Some((object, definitions.collect()))
        }
        _ => None,
    }
}

/// `{ get() { .. }, set(v) { .. } }`
fn is_written_accessor_descriptor(hir: &hir::File<'_>, descriptor: ExprId) -> bool {
    let ExprKind::Object(properties) = hir[descriptor].kind else {
        return false;
    };
    let mut has_half = false;
    for id in properties.iter() {
        let property = &hir[id];
        let PropKey::Name(name) = hir.runtime_property_key(id) else {
            return false;
        };
        let value = hir[hir.skip_type_assertions(property.value)].kind;
        match name {
            known::get | known::set => {
                if !matches!(property.kind, PropKind::Init | PropKind::Method)
                    || !matches!(value, ExprKind::Fn(_))
                {
                    return false;
                }
                has_half = true;
            }
            known::enumerable | known::configurable => {
                if property.kind != PropKind::Init
                    || !matches!(value, ExprKind::True | ExprKind::False)
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    has_half
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
    let held = match hir[object].kind {
        ExprKind::This => return Some(object),
        ExprKind::Assign {
            op: None, value, ..
        } => value,
        ExprKind::Call(_) => object,
        _ => find_stable_initializer(hir, bound, object)
            .or_else(|| find_only_stored_value(hir, bound, object))?,
    };
    if let Some(this) = find_this_in_initializer(hir, held) {
        return Some(this);
    }
    let ExprKind::Call(call) = hir[hir.skip_type_assertions(held)].kind else {
        return None;
    };
    let first = find_operand_at(hir, call, 0)?;
    let is_this = matches!(hir[first].kind, ExprKind::This);
    let passed = match hir[object].kind {
        _ if is_this => Some(first),
        ExprKind::Call(_) => find_this_held_by(hir, bound, first),
        _ => None,
    };
    passed.filter(|_| {
        answers_first_operand(hir, bound, hir[call].callee, 3)
            || (is_this && calls_function_returning_receiver(hir, bound, hir[call].callee))
    })
}

/// `function f(object, other) { return other || object; }`: the calls answer what they are handed first, or another object.
fn answers_first_operand(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
    depth: u32,
) -> bool {
    let Some(function) = find_function_held_by(hir, bound, callee) else {
        return false;
    };
    let Some(parameter) = find_plain_parameter(hir, bound, function, 0) else {
        return false;
    };
    let mut returns = bound.ids(bound.fns[function.idx()].returns);
    returns.any(|statement| match hir[statement].kind {
        StmtKind::Return(value) if value.is_some() => {
            may_answer(hir, bound, value, parameter, depth)
        }
        _ => false,
    })
}

/// `f.call(this)` of `var f = make(..)`, where `make` answers a function that answers its `this`.
fn calls_function_returning_receiver(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
) -> bool {
    let callee = hir.skip_type_assertions(callee);
    let Some((object, MemberKey::Name(known::call | known::apply))) = hir.member_key(callee) else {
        return false;
    };
    let Some(made) = find_stable_initializer(hir, bound, hir.skip_type_assertions(object)) else {
        return false;
    };
    let ExprKind::Call(site) = hir[hir.skip_type_assertions(made)].kind else {
        return false;
    };
    let Some(maker) = find_function_held_by(hir, bound, hir[site].callee) else {
        return false;
    };
    let answers_receiver = |function: FnId| {
        let mut returns = bound.ids(bound.fns[function.idx()].returns);
        returns.any(|statement| {
            let StmtKind::Return(value) = hir[statement].kind else {
                return false;
            };
            if value.is_none() {
                return false;
            }
            let ExprKind::Call(call) = hir[hir.skip_type_assertions(value)].kind else {
                return false;
            };
            find_operand_at(hir, call, 0)
                .is_some_and(|first| matches!(hir[first].kind, ExprKind::This))
                && answers_first_operand(hir, bound, hir[call].callee, 2)
        })
    };
    let mut made = bound.ids(bound.fns[maker.idx()].returns);
    made.any(|statement| match hir[statement].kind {
        StmtKind::Return(value) if value.is_some() => {
            match hir[hir.skip_type_assertions(value)].kind {
                ExprKind::Fn(function) => answers_receiver(function),
                _ => false,
            }
        }
        _ => false,
    })
}

fn find_function_held_by(hir: &hir::File<'_>, bound: &Bound<'_>, callee: ExprId) -> Option<FnId> {
    let symbol = bound_symbol(hir, bound, hir.skip_type_assertions(callee))?;
    if !bound.is_stable_beside_evals(symbol) {
        return None;
    }
    let function = match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Function(function) => function,
        BindingInitializer::Expression(value) => match hir[value].kind {
            ExprKind::Fn(function) => function,
            _ => return None,
        },
        _ => return None,
    };
    let runs_whole = !hir[function]
        .flags
        .intersects(Flags::ASYNC | Flags::GENERATOR);
    runs_whole.then_some(function)
}

fn may_answer(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    value: ExprId,
    parameter: SymbolId,
    depth: u32,
) -> bool {
    let value = hir.skip_type_assertions(value);
    match hir[value].kind {
        ExprKind::Ident(_) => bound_symbol(hir, bound, value) == Some(parameter),
        ExprKind::Cond { branches, .. } => {
            let hir::Branches { yes, no } = hir.branches(branches);
            [yes, no]
                .into_iter()
                .any(|arm| may_answer(hir, bound, arm, parameter, depth))
        }
        ExprKind::Binary {
            op: BinOp::Or | BinOp::Comma,
            right,
            ..
        } => may_answer(hir, bound, right, parameter, depth),
        ExprKind::Call(call) if depth > 0 => {
            find_operand_at(hir, call, 0)
                .is_some_and(|first| bound_symbol(hir, bound, first) == Some(parameter))
                && answers_first_operand(hir, bound, hir[call].callee, depth - 1)
        }
        _ => false,
    }
}

/// `var t; t = value;` without another store into `t`.
fn find_only_stored_value(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
) -> Option<ExprId> {
    let variable = bound_symbol(hir, bound, object)?;
    let &[Decl::Var(pattern)] = bound.symbol(variable).decls else {
        return None;
    };
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let [store] = bound.stores_to(variable) else {
        return None;
    };
    if hir[declaration].init.is_some() || bound.is_visible_to_eval(variable) {
        return None;
    }
    let Parent::Expr(around) = bound.parent_of_expr(store.target) else {
        return None;
    };
    match hir[around.some()?].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } if target == store.target => Some(value),
        _ => None,
    }
}

pub(super) fn find_stable_initializer(
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

/// The method of `{ set(value) { .. } }`
fn is_setter_of_descriptor(hir: &hir::File<'_>, bound: &Bound<'_>, function: FnId) -> bool {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return false;
    };
    let Parent::Prop(property) = bound.parent_of_expr(expression) else {
        return false;
    };
    matches!(hir.runtime_property_key(property), PropKey::Name(name) if name == known::set)
}

fn find_name_defined_on_prototype(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    call: CallId,
) -> Option<DefinedName> {
    let mut operands = hir.ids(hir[call].args);
    let mut before = operands.next()?;
    let (symbol, name) = loop {
        let operand = operands.next()?;
        if let ExprKind::String(name) = hir[operand].kind
            && let Some(symbol) = prototype_object_symbol(hir, bound, before)
        {
            break (symbol, name);
        }
        before = operand;
    };
    let owner = find_owner_held_by(hir, bound, symbol)?;
    let descriptor = operands.next()?;
    let ExprKind::Object(properties) = hir[descriptor].kind else {
        return Some(DefinedName {
            owner,
            name,
            is_accessor: false,
            setter: None,
        });
    };
    if !is_written_accessor_descriptor(hir, descriptor) {
        return None;
    }
    let is_setter = |&property: &_| matches!(hir.runtime_property_key(property), PropKey::Name(name) if name == known::set);
    let setter = properties.iter().find(is_setter).and_then(|property| {
        match hir[hir.skip_type_assertions(hir[property].value)].kind {
            ExprKind::Fn(function) => Some(function),
            _ => None,
        }
    });
    Some(DefinedName {
        owner,
        name,
        is_accessor: true,
        setter,
    })
}

fn find_owner_held_by(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<ThisOwner> {
    match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Class(class) => Some(ThisOwner::Instance(class)),
        BindingInitializer::Function(function) => Some(ThisOwner::Function(function)),
        BindingInitializer::Expression(value) => match hir[hir.skip_type_assertions(value)].kind {
            ExprKind::Class(class) => Some(ThisOwner::Instance(class)),
            ExprKind::Fn(function) => Some(ThisOwner::Function(function)),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn bound_symbol(hir: &hir::File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<SymbolId> {
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
