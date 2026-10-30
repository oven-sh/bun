use super::answers::{
    ClassDeclaration, ClassMember, ClassMemberSource, ClassRef, ClassShape, FunctionRef, GaveUp,
    MemberName, ObjectMemberKind, PositionTypes,
};
use super::class_stores::{
    BindingStore, BindingStoreKind, StoreForm, StoreIndex, ThisOwner,
    find_prototype_object_held_by, is_prototype_property,
};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Bound, Decl, FnOwner, Parent, SymbolId};
use crate::hir::{
    self, ClassId, ExprId, ExprKind, Flags, FnId, FnKind, MemberId, MemberKind, ModifierKind,
    PatKind, PropKey, TypeNodeId, has_body,
};
use crate::program::{FileId, Sym};
use crate::types::TypeId;
use crate::util::FxHashSet;

#[derive(Copy, Clone, PartialEq, Eq)]
enum StorePlace {
    Instance,
    Prototype,
    Class,
}

struct StoreCandidate {
    name: Atom,
    kind: ObjectMemberKind,
    place: StorePlace,
    store: ExprId,
    value: ExprId,
    form: StoreForm,
    is_in_every_construction: bool,
}

impl StoreCandidate {
    fn source(&self) -> ClassMemberSource {
        match self.place {
            StorePlace::Instance => ClassMemberSource::ThisStore(self.store),
            StorePlace::Prototype => ClassMemberSource::PrototypeStore(self.store),
            StorePlace::Class => ClassMemberSource::StaticStore(self.store),
        }
    }

    fn is_of_constructor_function(&self) -> bool {
        match self.place {
            StorePlace::Instance => self.form == StoreForm::Plain,
            StorePlace::Prototype => true,
            StorePlace::Class => false,
        }
    }
}

struct StoreCandidates {
    stores: Vec<StoreCandidate>,
    prototype_accessor_names: FxHashSet<Atom>,
}

#[derive(Default)]
struct ComputedNames {
    has_instance_name: bool,
    has_static_name: bool,
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn compute_class_shape(&mut self, class: ClassRef) -> &'c ClassShape<'c> {
        let declaration = ClassDeclaration::Class(class);
        let ClassRef { file, class } = class;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let mut members = Vec::new();
        self.add_parameter_properties(file, class, &mut members);
        let computed = self.add_written_members(file, class, &mut members);
        let mut names_stored_in_prototype = Vec::new();
        if bound.runtime.is_computed() {
            let index = self.store_index(file);
            let candidates = store_candidates(
                hir,
                bound,
                index,
                &[ThisOwner::Instance(class), ThisOwner::Static(class)],
                bound.declared_symbol(Decl::Class(class)).some(),
                bound.inner_class_symbol(class).some(),
            );
            names_stored_in_prototype = self.names_stored_in_prototype(&candidates);
            self.add_stores(file, &mut members, candidates);
        }
        self.arena.alloc(ClassShape {
            declaration,
            members: self.list(&members),
            names_stored_in_prototype: self.list(&names_stored_in_prototype),
            has_computed_instance_name: computed.has_instance_name,
            has_computed_static_name: computed.has_static_name,
        })
    }

    pub(super) fn compute_constructor_function_shape(
        &mut self,
        function: FunctionRef,
    ) -> Option<&'c ClassShape<'c>> {
        let declaration = ClassDeclaration::Function(function);
        let FunctionRef { file, function } = function;
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if !can_be_constructor_function(&hir[function]) || !bound.runtime.is_computed() {
            return None;
        }
        if is_written_as_method(hir, bound, function) {
            return None;
        }
        let index = self.store_index(file);
        let candidates = store_candidates(
            hir,
            bound,
            index,
            &[ThisOwner::Function(function)],
            bound.declared_symbol(Decl::Fn(function)).some(),
            None,
        );
        if !candidates
            .stores
            .iter()
            .any(StoreCandidate::is_of_constructor_function)
        {
            return None;
        }
        let mut members = Vec::new();
        let names_stored_in_prototype = self.names_stored_in_prototype(&candidates);
        self.add_stores(file, &mut members, candidates);
        let is_constructor = members.iter().any(|member| {
            matches!(
                member.source,
                ClassMemberSource::ThisStore(_) | ClassMemberSource::PrototypeStore(_)
            )
        });
        if !is_constructor {
            return None;
        }
        let shape: &'c ClassShape<'c> = self.arena.alloc(ClassShape {
            declaration,
            members: self.list(&members),
            names_stored_in_prototype: self.list(&names_stored_in_prototype),
            has_computed_instance_name: false,
            has_computed_static_name: false,
        });
        Some(shape)
    }

    fn names_stored_in_prototype(&self, candidates: &StoreCandidates) -> Vec<MemberName> {
        let stores = candidates.stores.iter();
        let stored = stores
            .filter(|store| store.place == StorePlace::Prototype)
            .map(|store| store.name);
        let mut names: Vec<Atom> = stored
            .chain(candidates.prototype_accessor_names.iter().copied())
            .collect();
        names.sort_unstable_by_key(|&name| self.atom_bytes(name));
        names.dedup();
        names
            .into_iter()
            .map(|name| self.member_name(name))
            .collect()
    }

    fn add_parameter_properties(
        &mut self,
        file: FileId,
        class: ClassId,
        members: &mut Vec<ClassMember>,
    ) {
        let hir = self.c.hir(file);
        let constructor = hir[class].members.iter().find(|&member| {
            hir.runtime_member_kind(member) == MemberKind::Constructor
                && has_body(&hir[hir[member].func])
        });
        let Some(constructor) = constructor else {
            return;
        };
        for parameter in hir[hir[constructor].func].params.iter() {
            let flags = hir[parameter].flags;
            if !flags.contains(Flags::PARAMETER_PROPERTY) {
                continue;
            }
            let PatKind::Ident(name) = hir[hir[parameter].pat].kind else {
                continue;
            };
            let types = self.declared_position(file, hir[parameter].ty, |queries| {
                let ty = queries.c.type_of_param(file, parameter);
                queries.resolved(ty)
            });
            members.push(ClassMember {
                name: self.member_name(name),
                kind: ObjectMemberKind::Field,
                source: ClassMemberSource::ParameterProperty(parameter),
                types,
                is_static: false,
                is_optional: flags.contains(Flags::OPTIONAL),
            });
        }
    }

    fn add_written_members(
        &mut self,
        file: FileId,
        class: ClassId,
        members: &mut Vec<ClassMember>,
    ) -> ComputedNames {
        let hir = self.c.hir(file);
        let mut computed = ComputedNames::default();
        for id in hir[class].members.iter() {
            let member = &hir[id];
            match hir.runtime_member_key(id) {
                PropKey::None => {}
                PropKey::Computed(_) if member.flags.contains(Flags::STATIC) => {
                    computed.has_static_name = true;
                }
                PropKey::Computed(key) => {
                    let is_field = member.kind == MemberKind::Property
                        && !member.flags.contains(Flags::ACCESSOR);
                    match is_field
                        .then(|| self.symbol_member_name(file, key))
                        .flatten()
                    {
                        Some(name) => {
                            members.extend(self.written_member(ClassRef { file, class }, id, name));
                        }
                        None => computed.has_instance_name = true,
                    }
                }
                PropKey::Name(name) | PropKey::Private(name) => {
                    members.extend(self.written_member(ClassRef { file, class }, id, name));
                }
            }
        }
        computed
    }

    fn written_member(&mut self, class: ClassRef, id: MemberId, name: Atom) -> Option<ClassMember> {
        let file = class.file;
        let hir = self.c.hir(file);
        let member = &hir[id];
        let is_static = member.flags.contains(Flags::STATIC);
        let (kind, types, is_optional) = match member.kind {
            MemberKind::Property => (
                if member.flags.contains(Flags::ACCESSOR) {
                    ObjectMemberKind::GetterAndSetter
                } else {
                    ObjectMemberKind::Field
                },
                self.declared_position(file, member.ty, |queries| {
                    queries.checked_member_type(class, name, is_static)
                }),
                member
                    .flags
                    .intersects(Flags::OPTIONAL | Flags::AMBIENT | Flags::ABSTRACT),
            ),
            MemberKind::Method if has_body(&hir[member.func]) => (
                ObjectMemberKind::Method,
                PositionTypes::unwritten(
                    self.ask(|queries| queries.checked_member_type(class, name, is_static)),
                ),
                false,
            ),
            MemberKind::Getter if has_body(&hir[member.func]) => (
                ObjectMemberKind::Getter,
                self.declared_position(file, hir[member.func].ret, |queries| {
                    let ty = queries.c.return_type_of_fn(file, member.func);
                    queries.resolved(ty)
                }),
                false,
            ),
            MemberKind::Setter if has_body(&hir[member.func]) => {
                let node = hir[member.func].effective_set_accessor_type_annotation_node(hir);
                let value = hir[member.func].set_accessor_value_parameter().some();
                let types = self.declared_position(file, node, |queries| {
                    let ty = queries
                        .c
                        .type_of_param(file, value.ok_or(GaveUp::ErrorType)?);
                    queries.resolved(ty)
                });
                (ObjectMemberKind::Setter, types, false)
            }
            _ => return None,
        };
        Some(ClassMember {
            name: self.member_name(name),
            kind,
            source: ClassMemberSource::Member(id),
            types,
            is_static,
            is_optional,
        })
    }

    fn declared_position(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        checked: impl FnOnce(&mut Self) -> Result<TypeId, GaveUp>,
    ) -> PositionTypes {
        PositionTypes {
            written: self.ask_written(|queries| queries.compute_written_type(file, node)),
            checked: self.ask(checked),
        }
    }

    fn checked_member_type(
        &mut self,
        class: ClassRef,
        name: Atom,
        is_static: bool,
    ) -> Result<TypeId, GaveUp> {
        if self.c.bound(class.file).class_symbol[class.class.idx()].is_none() {
            return Err(GaveUp::UnreachedNode);
        }
        let symbol = self.c.class_sym(class.file, class.class);
        let receiver = match is_static {
            true => self.c.type_of_symbol(symbol),
            false => self.c.declared_type(symbol),
        };
        let receiver = self.resolved(receiver)?;
        let Some((prop, mapper)) = self.c.get_property_of_type(receiver, name) else {
            return Err(GaveUp::Unresolved);
        };
        let ty = self.c.type_of_prop(prop, mapper);
        self.resolved(ty)
    }

    fn add_stores(
        &mut self,
        file: FileId,
        members: &mut Vec<ClassMember>,
        candidates: StoreCandidates,
    ) {
        let StoreCandidates {
            stores,
            prototype_accessor_names,
        } = candidates;
        let mut declared: FxHashSet<(MemberName, bool)> = members
            .iter()
            .map(|member| (member.name, member.is_static))
            .collect();
        let mut added_accessors = FxHashSet::default();
        let in_every_construction = stores.iter().filter(|store| store.is_in_every_construction);
        let in_every_construction: FxHashSet<Atom> =
            in_every_construction.map(|store| store.name).collect();
        for candidate in &stores {
            let name = self.member_name(candidate.name);
            let is_static = candidate.place == StorePlace::Class;
            let is_new = if is_getter_or_setter(candidate.kind) {
                !declared.contains(&(name, is_static))
                    && added_accessors.insert((name, candidate.kind))
            } else {
                let is_accessor = !is_static && prototype_accessor_names.contains(&candidate.name);
                !is_accessor && declared.insert((name, is_static))
            };
            if !is_new {
                continue;
            }
            let checked = match find_stored_value(&stores, candidate) {
                Some(value) if file == self.file => self.ask(|queries| {
                    let ty = queries.c.type_of_expr(file, value);
                    let ty = queries.c.widen_literal(ty);
                    queries.resolved(ty)
                }),
                Some(_) => Err(GaveUp::Unresolved),
                None => Ok(TypeId::ANY),
            };
            let is_always_stored = candidate.place == StorePlace::Instance
                && in_every_construction.contains(&candidate.name);
            members.push(ClassMember {
                name,
                kind: candidate.kind,
                source: candidate.source(),
                types: PositionTypes::unwritten(checked),
                is_static,
                is_optional: !is_always_stored,
            });
        }
    }

    pub(super) fn compute_class_of_binding(&self, symbol: Sym) -> Option<ClassRef> {
        let class = self.compiled_class(symbol)?;
        let declarations = self.files().decls_of(symbol);
        let has_only_class_merges = declarations
            .iter()
            .all(|&(_, decl)| can_merge_with_class(decl));
        let (hir, bound) = (self.c.hir(class.file), self.c.bound(class.file));
        let mut modifiers = hir[class.class].modifiers.iter();
        let is_decorated =
            modifiers.any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)));
        let is_stable = bound.is_stable_binding(bound.declared_symbol(Decl::Class(class.class)));
        (has_only_class_merges && !is_decorated && is_stable).then_some(class)
    }
}

fn can_merge_with_class(decl: Decl) -> bool {
    matches!(decl, Decl::Class(_) | Decl::Interface(_) | Decl::Module(_))
}

fn can_be_constructor_function(function: &hir::Func) -> bool {
    match function.kind {
        FnKind::Decl | FnKind::Expr => !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR),
        _ => false,
    }
}

pub(super) fn is_prototype_object(hir: &hir::File<'_>, bound: &Bound<'_>, object: ExprId) -> bool {
    let object = hir.skip_type_assertions(object);
    is_prototype_property(hir, object)
        || find_prototype_object_held_by(hir, bound, object).is_some()
}

fn is_stored_into(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    value: ExprId,
    is_place: impl Fn(ExprId) -> bool,
) -> bool {
    let Parent::Expr(parent) = bound.parent_of_expr(value) else {
        return false;
    };
    let Some(parent) = parent.some() else {
        return false;
    };
    matches!(
        hir[parent].kind,
        ExprKind::Assign { op: None, target, value: stored } if stored == value && is_place(target)
    )
}

fn is_written_as_method(hir: &hir::File<'_>, bound: &Bound<'_>, function: FnId) -> bool {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return false;
    };
    if let Parent::Prop(property) = bound.parent_of_expr(expression) {
        let is_accessor_of_descriptor = matches!(
            hir.runtime_property_key(property),
            PropKey::Name(name) if name == known::get || name == known::set
        );
        let literal = bound.prop_owner[property.idx()];
        return is_accessor_of_descriptor
            || is_stored_into(hir, bound, literal, |place| {
                is_prototype_property(hir, hir.skip_type_assertions(place))
            });
    }
    is_stored_into(
        hir,
        bound,
        expression,
        |place| matches!(hir.member_key(place), Some((object, _)) if is_prototype_object(hir, bound, object)),
    )
}

fn store_candidates(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    index: &StoreIndex<'_>,
    this_owners: &[ThisOwner],
    outer: Option<SymbolId>,
    inner: Option<SymbolId>,
) -> StoreCandidates {
    let mut stores = Vec::new();
    for &owner in this_owners {
        let place = match owner {
            ThisOwner::Instance(_) | ThisOwner::Function(_) => StorePlace::Instance,
            ThisOwner::Static(_) => StorePlace::Class,
        };
        let this_stores = index.this_stores_of(owner).iter();
        stores.extend(this_stores.map(|store| StoreCandidate {
            name: store.name,
            kind: ObjectMemberKind::Field,
            place,
            store: store.assign,
            value: store.value,
            form: store.form,
            is_in_every_construction: store.is_in_every_construction,
        }));
    }
    let inner = inner.filter(|&inner| outer != Some(inner));
    let binding_stores = [outer, inner]
        .into_iter()
        .flatten()
        .flat_map(|symbol| index.binding_stores_of(symbol));
    let prototype_accessor_names = binding_stores
        .clone()
        .filter(|store| match store.kind {
            BindingStoreKind::Prototype(kind) => is_getter_or_setter(kind),
            BindingStoreKind::Static => false,
        })
        .map(|store| store.name)
        .collect();
    let is_binding_stable = outer.is_none_or(|outer| bound.is_stable_binding(outer));
    if is_binding_stable {
        stores.extend(binding_stores.map(binding_candidate));
    }
    stores.sort_unstable_by_key(|candidate| (hir[candidate.store].pos, candidate.store));
    StoreCandidates {
        stores,
        prototype_accessor_names,
    }
}

fn binding_candidate(store: &BindingStore) -> StoreCandidate {
    let (kind, place) = match store.kind {
        BindingStoreKind::Static => (ObjectMemberKind::Field, StorePlace::Class),
        BindingStoreKind::Prototype(kind) => (kind, StorePlace::Prototype),
    };
    StoreCandidate {
        name: store.name,
        kind,
        place,
        store: store.source,
        value: store.value,
        form: store.form,
        is_in_every_construction: false,
    }
}

fn find_stored_value(stores: &[StoreCandidate], candidate: &StoreCandidate) -> Option<ExprId> {
    match candidate.form {
        StoreForm::Plain | StoreForm::Logical => Some(candidate.value),
        StoreForm::Compound => {
            let mut to_same_place = stores
                .iter()
                .filter(|other| other.name == candidate.name && other.place == candidate.place);
            let other = to_same_place.find(|other| other.form != StoreForm::Compound)?;
            Some(other.value)
        }
    }
}

fn is_getter_or_setter(kind: ObjectMemberKind) -> bool {
    match kind {
        ObjectMemberKind::Getter | ObjectMemberKind::Setter => true,
        ObjectMemberKind::Field | ObjectMemberKind::Method | ObjectMemberKind::GetterAndSetter => {
            false
        }
    }
}
