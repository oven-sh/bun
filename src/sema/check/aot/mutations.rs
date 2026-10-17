//! Which objects a built-in may freeze, seal or make non-extensible, and of which it may replace the prototype.
//!
//! Compiled code is ready for either only where the layout says that it may happen, and the run time refuses it for an object of any other
//! layout. So a layout too many costs a test at each store, and a layout too few is a `TypeError` in a correct program: every rule here
//! errs towards more.
//!
//! By the type of the operand:
//! - An object type: its subtypes.
//! - A type parameter: all that enters a place of it, at a call or in an instantiation, through other type parameters. At
//!   `seal({ a: 1 })` with `function seal<T extends object>(value: T) { return Object.freeze(value); }` that is the type of the literal.
//! - A type that says nothing, `any`, `unknown`, `object`: every layout. What `escape_closure` finds to have escaped is not all that gets to
//!   such a place.
//! - `Readonly<T>`, `Partial<T>`, `T & {}`: as `T`.
//! - Any other type that depends on a type parameter: as what it is bounded by, `Events[E]` as `Events[keyof Events]`. Bounded by nothing, `T[K]`: every layout.
//!
//! A call is known by where its signature is declared, whatever the callee is called. So where the built-in goes somewhere as a value:
//! - A place of its own type, `const ObjectFreeze = Object.freeze`: nothing. What is in such a place is known when it is called.
//! - A place of another function type, `list.forEach(Object.freeze)`: as an operand of the type of the first parameter.
//! - A place that says nothing: as an operand of which nothing is said.
//!
//! What is noted is sets and sums: it is absorbed in any order. It is closed where the subtype sets are begun, but for "every layout",
//! which `Subtypes::finish` adds.

use std::hash::Hash;
use std::rc::Rc;

use rustc_hash::{FxHashMap, FxHashSet};

use super::escape_closure::TypeParameter;
use super::type_caches::is_published;
use super::flows::{Membership, NoteKind, ParameterNote, ParameterNoteKind, Place};
use crate::atom::Atom;
use crate::check::Checker;
use crate::bind::Decl;
use crate::hir::{ExprId, ExprKind, ExprTag, FileKind, FnKind, PropKey, PropKind, UnOp};
use crate::program::FileId;
use crate::types::{Origin, SigId, TypeData, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(super) enum Mutation {
    /// `Object.freeze`, `Object.seal`, `Object.preventExtensions`, `Reflect.preventExtensions`.
    IntegrityLevel,
    /// `Object.setPrototypeOf`, `Reflect.setPrototypeOf`, a store to `__proto__`. Not to `null`, which the run time lets any record go to.
    Prototype,
    Redefinition,
}

impl Mutation {
    pub(super) const ALL: [Mutation; 2] = [Mutation::IntegrityLevel, Mutation::Prototype];
}

/// What is known of an operand by its type. The order of `Mutations::sites`.
#[derive(Copy, Clone)]
enum Operand {
    ObjectType,
    TypeParameter,
    Untyped,
    DependsOnTypeParameter,
    /// An array, a function, a primitive.
    NoLayout,
    /// The built-in is not called here: it goes somewhere as a value.
    BuiltInAsValue,
    /// The new prototype is `null`.
    ToNull,
}

const OPERANDS: usize = 7;

/// Of a place whose operand nothing is said of: the form of the operand, and what is around the place. For the numbers.
const FORMS: [&str; 8] = ["this", "a parameter", "a variable", "a member", "what a call yields", "a literal", "another form", "named and not called"];
const AROUND: [&str; 3] = ["in the constructor of a class", "in another function", "in no function"];
/// By mutation, by whether the file is JavaScript, by `FORMS`, by `AROUND`.
type UntypedSites = [[[[u32; AROUND.len()]; FORMS.len()]; 2]; 2];
type Widest = [[Option<Place>; 2]; 2];

/// The places that define a property or delete one. For the numbers.
const KEYS: [&str; 2] = ["a constant key", "another key"];
const DESCRIPTORS: [&str; 6] = ["`value` and `writable: true`", "`value`", "`get` or `set`", "a literal with none of these, a spread or a computed name", "no literal", "delete"];
/// What is known of the operand: by its type, and where that says nothing by its form.
const REDEFINITION_OPERANDS: [&str; 13] = [
    "an object type", "a type parameter", "another type that depends on one", "no layout",
    "this", "a parameter", "a variable", "`.prototype`", "`exports`", "another member", "what a call yields", "a literal", "another form",
];
/// By whether the file is JavaScript, by `KEYS`, by `DESCRIPTORS`, by `REDEFINITION_OPERANDS`.
type RedefinitionCounts = [[[[u32; REDEFINITION_OPERANDS.len()]; DESCRIPTORS.len()]; KEYS.len()]; 2];

pub(crate) struct Mutations<T = TypeId> {
    of_types: FxHashSet<(Mutation, T)>,
    parameter_mutations: FxHashSet<(Mutation, TypeParameter)>,
    /// By mutation.
    on_untyped: [bool; 2],
    on_anything: [bool; 2],
    /// A value of the object type enters a place of the type parameter.
    enters: FxHashSet<(TypeParameter, T)>,
    /// A value of the second type parameter enters a place of the first.
    parameter_inflows: FxHashSet<(TypeParameter, TypeParameter)>,
    untyped_inflows: FxHashSet<TypeParameter>,
    /// A value of a type that depends on a type parameter in another way, `T[K]`: it is not followed.
    any_inflows: FxHashSet<TypeParameter>,
    escaped_instances: FxHashSet<T>,
    escaped_parameters: FxHashSet<TypeParameter>,
    instances_receiving_untyped: FxHashSet<T>,
    parameters_receiving_untyped: FxHashSet<TypeParameter>,
    instances_receiving_untyped_if_escaped: FxHashSet<T>,
    parameters_receiving_untyped_if_escaped: FxHashSet<TypeParameter>,
    escaped_types: FxHashSet<T>,
    type_inflows: FxHashSet<(T, T)>,
    instances_flowing_into_types: FxHashSet<T>,
    /// By mutation and `Operand`: how many places in the source.
    sites: [[u32; OPERANDS]; 2],
    /// By mutation: the first place in the source that marks all that has escaped, and the first that marks every layout.
    widest: Widest,
    untyped_sites: UntypedSites,
    redefinition_counts: RedefinitionCounts,
}

impl<T> Default for Mutations<T> {
    fn default() -> Mutations<T> {
        Mutations {
            of_types: FxHashSet::default(),
            parameter_mutations: FxHashSet::default(),
            on_untyped: [false; 2],
            on_anything: [false; 2],
            enters: FxHashSet::default(),
            parameter_inflows: FxHashSet::default(),
            untyped_inflows: FxHashSet::default(),
            any_inflows: FxHashSet::default(),
            escaped_instances: FxHashSet::default(),
            escaped_parameters: FxHashSet::default(),
            instances_receiving_untyped: FxHashSet::default(),
            parameters_receiving_untyped: FxHashSet::default(),
            instances_receiving_untyped_if_escaped: FxHashSet::default(),
            parameters_receiving_untyped_if_escaped: FxHashSet::default(),
            escaped_types: FxHashSet::default(),
            type_inflows: FxHashSet::default(),
            instances_flowing_into_types: FxHashSet::default(),
            sites: [[0; OPERANDS]; 2],
            widest: Default::default(),
            untyped_sites: Default::default(),
            redefinition_counts: Default::default(),
        }
    }
}

/// See `Mutations::closed`.
pub(super) struct Altered<T> {
    /// In no order.
    pub(super) types: Vec<T>,
    /// Every layout: nothing is said of an operand.
    pub(super) is_untyped: bool,
    /// Every layout.
    pub(super) is_any_layout: bool,
}

impl<T: Copy + Eq + Hash> Mutations<T> {
    fn record_widest(&mut self, mutation: Mutation, is_any_layout: bool, at: Place) {
        let first = &mut self.widest[mutation as usize][usize::from(is_any_layout)];
        *first = Some(first.map_or(at, |first| first.min(at)));
    }

    pub(super) fn absorb(&mut self, other: Mutations<T>) {
        self.of_types.extend(other.of_types);
        self.parameter_mutations.extend(other.parameter_mutations);
        self.enters.extend(other.enters);
        self.parameter_inflows.extend(other.parameter_inflows);
        self.untyped_inflows.extend(other.untyped_inflows);
        self.any_inflows.extend(other.any_inflows);
        self.escaped_instances.extend(other.escaped_instances);
        self.escaped_parameters.extend(other.escaped_parameters);
        self.instances_receiving_untyped.extend(other.instances_receiving_untyped);
        self.parameters_receiving_untyped.extend(other.parameters_receiving_untyped);
        self.instances_receiving_untyped_if_escaped.extend(other.instances_receiving_untyped_if_escaped);
        self.parameters_receiving_untyped_if_escaped.extend(other.parameters_receiving_untyped_if_escaped);
        self.escaped_types.extend(other.escaped_types);
        self.type_inflows.extend(other.type_inflows);
        self.instances_flowing_into_types.extend(other.instances_flowing_into_types);
        for (mine, theirs) in self.redefinition_counts.as_flattened_mut().as_flattened_mut().as_flattened_mut().iter_mut().zip(other.redefinition_counts.as_flattened().as_flattened().as_flattened()) {
            *mine += theirs;
        }
        for mutation in 0..2 {
            self.on_untyped[mutation] |= other.on_untyped[mutation];
            self.on_anything[mutation] |= other.on_anything[mutation];
            for how in 0..2 {
                self.widest[mutation][how] = [self.widest[mutation][how], other.widest[mutation][how]].into_iter().flatten().min();
            }
            for operand in 0..OPERANDS {
                self.sites[mutation][operand] += other.sites[mutation][operand];
            }
            for (language, form, around) in (0..2).flat_map(|language| (0..FORMS.len()).flat_map(move |form| (0..AROUND.len()).map(move |around| (language, form, around)))) {
                self.untyped_sites[mutation][language][form][around] += other.untyped_sites[mutation][language][form][around];
            }
        }
    }

    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Mutations<U> {
        Mutations {
            of_types: self.of_types.into_iter().filter_map(|(mutation, ty)| Some((mutation, rename(ty)?))).collect(),
            parameter_mutations: self.parameter_mutations,
            on_untyped: self.on_untyped,
            on_anything: self.on_anything,
            enters: self.enters.into_iter().filter_map(|(parameter, ty)| Some((parameter, rename(ty)?))).collect(),
            parameter_inflows: self.parameter_inflows,
            untyped_inflows: self.untyped_inflows,
            any_inflows: self.any_inflows,
            escaped_instances: self.escaped_instances.into_iter().filter_map(&mut *rename).collect(),
            escaped_parameters: self.escaped_parameters,
            instances_receiving_untyped: self.instances_receiving_untyped.into_iter().filter_map(&mut *rename).collect(),
            parameters_receiving_untyped: self.parameters_receiving_untyped,
            instances_receiving_untyped_if_escaped: self.instances_receiving_untyped_if_escaped.into_iter().filter_map(&mut *rename).collect(),
            parameters_receiving_untyped_if_escaped: self.parameters_receiving_untyped_if_escaped,
            escaped_types: self.escaped_types.into_iter().filter_map(&mut *rename).collect(),
            type_inflows: self.type_inflows.into_iter().filter_map(|(view, instance)| Some((rename(view)?, rename(instance)?))).collect(),
            instances_flowing_into_types: self.instances_flowing_into_types.into_iter().filter_map(&mut *rename).collect(),
            sites: self.sites,
            widest: self.widest,
            untyped_sites: self.untyped_sites,
            redefinition_counts: self.redefinition_counts,
        }
    }

    pub(super) fn add_note(&mut self, kind: NoteKind, first: T, second: T, at: Place) {
        match kind {
            NoteKind::EntersParameter => {
                self.enters.insert(((at.file, crate::hir::TypeParamId(at.pos)), first));
            }
            NoteKind::InstanceEscapes => {
                self.escaped_instances.insert(first);
            }
            NoteKind::InstanceReceivesUntyped => {
                self.instances_receiving_untyped.insert(first);
            }
            NoteKind::InstanceReceivesUntypedIfEscapes => {
                self.instances_receiving_untyped_if_escaped.insert(first);
            }
            NoteKind::TypeEscapes => {
                self.escaped_types.insert(first);
            }
            NoteKind::FlowsIntoType => {
                self.type_inflows.insert((first, second));
            }
            NoteKind::InstanceFlowsIntoTypes => {
                self.instances_flowing_into_types.insert(first);
            }
            _ => {}
        }
    }

    pub(super) fn add_parameter_note(&mut self, (kind, first, second): ParameterNote) {
        match kind {
            ParameterNoteKind::Enters => {
                self.parameter_inflows.insert((first, second));
            }
            ParameterNoteKind::Escaped => {
                self.escaped_parameters.insert(first);
            }
            ParameterNoteKind::ReceivesUntyped => {
                self.parameters_receiving_untyped.insert(first);
            }
            ParameterNoteKind::ReceivesUntypedIfEscapes => {
                self.parameters_receiving_untyped_if_escaped.insert(first);
            }
            ParameterNoteKind::UntypedInflow => {
                self.untyped_inflows.insert(first);
            }
            ParameterNoteKind::AnyInflow => {
                self.any_inflows.insert(first);
            }
        }
    }

    pub(super) fn absorb_untyped_object_evidence(&mut self, other: &Mutations<T>) {
        self.enters.extend(other.enters.iter().copied());
        self.parameter_inflows.extend(other.parameter_inflows.iter().copied());
        self.escaped_instances.extend(other.escaped_instances.iter().copied());
        self.escaped_parameters.extend(other.escaped_parameters.iter().copied());
        self.instances_receiving_untyped.extend(other.instances_receiving_untyped.iter().copied());
        self.parameters_receiving_untyped.extend(other.parameters_receiving_untyped.iter().copied());
        self.instances_receiving_untyped_if_escaped.extend(other.instances_receiving_untyped_if_escaped.iter().copied());
        self.parameters_receiving_untyped_if_escaped.extend(other.parameters_receiving_untyped_if_escaped.iter().copied());
        self.escaped_types.extend(other.escaped_types.iter().copied());
        self.type_inflows.extend(other.type_inflows.iter().copied());
        self.instances_flowing_into_types.extend(other.instances_flowing_into_types.iter().copied());
    }

    pub(super) fn all_with_untyped_object_evidence(&self) -> Vec<T> {
        let instances: FxHashSet<T> = self.escaped_instances.iter().chain(&self.instances_receiving_untyped).chain(&self.instances_receiving_untyped_if_escaped).chain(&self.instances_flowing_into_types).copied().collect();
        let parameters: FxHashSet<TypeParameter> = self.escaped_parameters.iter().chain(&self.parameters_receiving_untyped).chain(&self.parameters_receiving_untyped_if_escaped).copied().collect();
        self.transitive_closure(&instances, &parameters)
    }

    pub(super) fn receiving_untyped(&self) -> Vec<T> {
        self.transitive_closure(&self.instances_receiving_untyped, &self.parameters_receiving_untyped)
    }

    pub(super) fn receiving_untyped_if_escaped(&self) -> Vec<T> {
        self.transitive_closure(&self.instances_receiving_untyped_if_escaped, &self.parameters_receiving_untyped_if_escaped)
    }

    pub(super) fn escaped(&self) -> Vec<T> {
        let mut entering: FxHashMap<T, Vec<T>> = FxHashMap::default();
        for &(view, from) in &self.type_inflows {
            entering.entry(view).or_default().push(from);
        }
        let mut pending: Vec<T> = self.escaped_types.iter().copied().collect();
        let mut reached: FxHashSet<T> = pending.iter().copied().collect();
        while let Some(view) = pending.pop() {
            for &from in entering.get(&view).into_iter().flatten() {
                if reached.insert(from) {
                    pending.push(from);
                }
            }
        }
        let instances: FxHashSet<T> = self.escaped_instances.union(&reached).copied().collect();
        self.transitive_closure(&instances, &self.escaped_parameters)
    }

    fn transitive_closure(&self, instances: &FxHashSet<T>, parameters: &FxHashSet<TypeParameter>) -> Vec<T> {
        let mut entering: FxHashMap<TypeParameter, Vec<TypeParameter>> = FxHashMap::default();
        for &(into, from) in &self.parameter_inflows {
            entering.entry(into).or_default().push(from);
        }
        let mut pending: Vec<TypeParameter> = parameters.iter().copied().collect();
        let mut reached: FxHashSet<TypeParameter> = pending.iter().copied().collect();
        while let Some(into) = pending.pop() {
            for &from in entering.get(&into).into_iter().flatten() {
                if reached.insert(from) {
                    pending.push(from);
                }
            }
        }
        instances.iter().copied().chain(self.enters.iter().filter(|enters| reached.contains(&enters.0)).map(|enters| enters.1)).collect()
    }

    /// The types of the objects that may be the operand, type parameters followed back to what enters them.
    pub(super) fn closed(&self, mutation: Mutation) -> Altered<T> {
        let mut entering: FxHashMap<TypeParameter, Vec<TypeParameter>> = FxHashMap::default();
        for &(into, from) in &self.parameter_inflows {
            entering.entry(into).or_default().push(from);
        }
        let mut pending: Vec<TypeParameter> = self.parameter_mutations.iter().filter(|altered| altered.0 == mutation).map(|altered| altered.1).collect();
        let mut reached: FxHashSet<TypeParameter> = pending.iter().copied().collect();
        while let Some(into) = pending.pop() {
            for &from in entering.get(&into).into_iter().flatten() {
                if reached.insert(from) {
                    pending.push(from);
                }
            }
        }
        let of_types = self.of_types.iter().filter(|altered| altered.0 == mutation).map(|altered| altered.1);
        Altered {
            types: of_types.chain(self.enters.iter().filter(|enters| reached.contains(&enters.0)).map(|enters| enters.1)).collect(),
            is_untyped: self.on_untyped.get(mutation as usize).copied().unwrap_or(false) || reached.iter().any(|parameter| self.untyped_inflows.contains(parameter)),
            is_any_layout: self.on_anything.get(mutation as usize).copied().unwrap_or(false) || reached.iter().any(|parameter| self.any_inflows.contains(parameter)),
        }
    }
}

/// The objects that a value of a type may be, as far as the type goes.
#[derive(Default, Clone)]
pub(super) struct ObjectTypes {
    /// `layout_defining_type`.
    types: Vec<TypeId>,
    parameters: Vec<TypeParameter>,
    is_untyped: bool,
    depends_on_type_parameter: bool,
}

impl<'p, 's> Checker<'p, 's> {
    fn recorded_mutations(&mut self) -> &mut Mutations {
        self.recorded_escapes().mutations.get_or_insert_with(Default::default)
    }

    fn add_object_types(&mut self, ty: TypeId, found: &mut ObjectTypes) {
        if self.results_are_provisional() {
            return self.find_object_types(ty, found);
        }
        let known = match self.aot.flows.without_primitives.get(&ty) {
            Some(known) => Rc::clone(known),
            None => self.object_types_on_cache_miss(ty),
        };
        found.types.extend_from_slice(&known.types);
        found.parameters.extend_from_slice(&known.parameters);
        found.is_untyped |= known.is_untyped;
        found.depends_on_type_parameter |= known.depends_on_type_parameter;
    }

    fn object_types_on_cache_miss(&mut self, ty: TypeId) -> Rc<ObjectTypes> {
        let caches = self.type_caches().filter(|_| is_published(ty));
        if let Some(known) = caches.and_then(|caches| caches.object_types.get_as(ty, |known| known.clone())) {
            let known = Rc::new(known);
            self.aot.flows.without_primitives.insert(ty, Rc::clone(&known));
            return known;
        }
        let careful_before = (self.stack_half_used_count(), self.aot.flows.unknown_count);
        let mut of_type = ObjectTypes::default();
        let ((), is_cacheable) = self.compute_cacheable(|c| c.find_object_types(ty, &mut of_type));
        let of_type = Rc::new(of_type);
        if careful_before == (self.stack_half_used_count(), self.aot.flows.unknown_count) {
            self.aot.flows.without_primitives.insert(ty, Rc::clone(&of_type));
            let is_task_independent = is_cacheable && of_type.types.iter().all(|&found| is_published(found));
            if let Some(caches) = caches.filter(|_| is_task_independent && !self.has_order_dependent_results()) {
                caches.object_types.insert(ty, (*of_type).clone());
            }
        }
        of_type
    }

    fn find_object_types(&mut self, ty: TypeId, found: &mut ObjectTypes) {
        let ty = self.reduced(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            if part.is_never() || self.has_primitive_flag(part) {
                continue;
            }
            if self.is_untyped_for_objects(part) {
                found.is_untyped = true;
                continue;
            }
            match *self.data(part) {
                TypeData::TypeParam(file, parameter, _) => found.parameters.push((file, parameter)),
                // The objects of the class and of what extends it.
                TypeData::ThisParam(_) => {
                    let bound = self.base_constraint(part);
                    self.add_object_types(bound, found);
                }
                // It is of every constituent, so those that say something say enough: `T & {}`.
                TypeData::Intersection(_) => {
                    let constituents: Vec<TypeId> = self.constituents(part).to_vec();
                    let mut of_all = ObjectTypes::default();
                    for constituent in constituents {
                        self.add_object_types(constituent, &mut of_all);
                    }
                    if !self.is_instantiable(part) && !self.is_generic(part) && self.array_subtype_element(part).is_none() {
                        of_all.types.push(self.layout_defining_type(part));
                    }
                    let is_informative = !of_all.types.is_empty() || !of_all.parameters.is_empty();
                    found.is_untyped |= of_all.is_untyped && !is_informative;
                    found.depends_on_type_parameter |= of_all.depends_on_type_parameter && !is_informative;
                    found.types.append(&mut of_all.types);
                    found.parameters.append(&mut of_all.parameters);
                }
                // `Readonly<T>`, `Partial<T>`: places of it and places of `T` are taken for the same.
                TypeData::Anon { origin: Origin::Mapped(file, node), mapper } if self.is_generic(part) => match self.homomorphic_type_variable(file, node, mapper) {
                    Some(variable) => self.add_object_types(variable, found),
                    None => found.depends_on_type_parameter = true,
                },
                _ if self.is_array_or_tuple(part) => {}
                _ if self.is_instantiable(part) => {
                    let bound = self.base_constraint(part);
                    if bound == part || self.is_untyped_for_objects(bound) {
                        found.depends_on_type_parameter = true;
                    } else {
                        self.add_object_types(bound, found);
                    }
                }
                _ if self.is_generic(part) => found.depends_on_type_parameter = true,
                // An array, a function and the like have no layout.
                _ if self.declares_properties(part) && !self.is_array_or_tuple(part) && self.array_subtype_element(part).is_none() => found.types.push(self.layout_defining_type(part)),
                _ => {}
            }
        }
    }

    pub(super) fn record_type_accepts_untyped(&mut self, target: TypeId, only_if_let_out: bool) {
        let mut found = ObjectTypes::default();
        self.add_object_types(target, &mut found);
        let types = std::mem::take(&mut found.types);
        let instances: Vec<TypeId> = types.into_iter().filter(|&ty| self.is_instance_type(ty)).collect();
        if instances.is_empty() && found.parameters.is_empty() {
            return;
        }
        let (instance_predictions, parameter_mutations) = match only_if_let_out {
            true => (NoteKind::InstanceReceivesUntypedIfEscapes, ParameterNoteKind::ReceivesUntypedIfEscapes),
            false => (NoteKind::InstanceReceivesUntyped, ParameterNoteKind::ReceivesUntyped),
        };
        let noted = self.notes();
        noted.add_all(instance_predictions, &instances);
        noted.add_parameters(parameter_mutations, &found.parameters);
    }

    pub(super) fn record_type_escapes(&mut self, view: TypeId) {
        let view = self.layout_defining_type(view);
        self.notes().add_all(NoteKind::TypeEscapes, &[view]);
    }

    pub(super) fn record_instances_flowing_into_types(&mut self, own: TypeId, target: TypeId) {
        if own == target || !self.aot.escape_closure.visited_type_inflows.insert((own, target)) {
            return;
        }
        let (mut from, mut into) = (ObjectTypes::default(), ObjectTypes::default());
        self.add_object_types(target, &mut into);
        let views: Vec<TypeId> = into.types.into_iter().filter(|&ty| !self.is_instance_type(ty)).collect();
        if views.is_empty() {
            return;
        }
        self.add_object_types(own, &mut from);
        if from.types.is_empty() {
            return;
        }
        let instances: Vec<TypeId> = from.types.iter().copied().filter(|&ty| self.is_instance_type(ty)).collect();
        let noted = self.notes();
        noted.add_all(NoteKind::InstanceFlowsIntoTypes, &instances);
        for &entering in &from.types {
            for &view in views.iter().filter(|&&view| view != entering) {
                noted.add_pair(NoteKind::FlowsIntoType, view, entering);
            }
        }
    }

    pub(super) fn record_escaping_types(&mut self, own: TypeId, target: Option<TypeId>) {
        if let Some(target) = target {
            let mut into = ObjectTypes::default();
            self.add_object_types(target, &mut into);
            if !into.is_untyped {
                return;
            }
        }
        let mut found = ObjectTypes::default();
        self.add_object_types(own, &mut found);
        let types = std::mem::take(&mut found.types);
        let instances: Vec<TypeId> = types.into_iter().filter(|&ty| self.is_instance_type(ty)).collect();
        if instances.is_empty() && found.parameters.is_empty() {
            return;
        }
        let noted = self.notes();
        noted.add_all(NoteKind::InstanceEscapes, &instances);
        noted.add_parameters(ParameterNoteKind::Escaped, &found.parameters);
    }

    /// A value of type `source` enters a place of type `target`, which may be one of a type parameter.
    pub(super) fn record_type_parameter_inflow(&mut self, source: TypeId, target: TypeId) {
        if !self.aot.escape_closure.entered.insert((source, target)) {
            return;
        }
        let mut into = ObjectTypes::default();
        self.add_object_types(target, &mut into);
        if into.parameters.is_empty() {
            return;
        }
        let mut from = ObjectTypes::default();
        self.add_object_types(source, &mut from);
        let noted = self.notes();
        for parameter in into.parameters {
            noted.add_entering_parameter(parameter, &from.types);
            for &other in from.parameters.iter().filter(|&&other| other != parameter) {
                noted.add_parameter_pair(ParameterNoteKind::Enters, parameter, other);
            }
            if from.is_untyped {
                noted.add_parameters(ParameterNoteKind::UntypedInflow, &[parameter]);
            }
            if from.depends_on_type_parameter {
                noted.add_parameters(ParameterNoteKind::AnyInflow, &[parameter]);
            }
        }
    }

    /// `operand`: `None` if the built-in is named at `at` and not called.
    fn record_untyped_site(&mut self, mutation: Mutation, file: FileId, operand: Option<ExprId>, at: ExprId) {
        let hir = self.hir(file);
        let form = match operand {
            None => 7,
            Some(mut operand) => {
                while let ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::NonNull(inner) = hir[operand].kind {
                    operand = inner;
                }
                match hir[operand].kind {
                    ExprKind::This => 0,
                    ExprKind::Ident(name) => {
                        let declared = self.resolve_identifier(file, operand, name, true).ok().flatten();
                        let is_parameter = declared.is_some_and(|sym| self.files.decls_of(sym).iter().any(|declared| matches!(declared.1, Decl::Param(_))));
                        if is_parameter { 1 } else { 2 }
                    }
                    ExprKind::Dot { .. } | ExprKind::Index { .. } => 3,
                    ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Await(_) => 4,
                    ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_) => 5,
                    _ => 6,
                }
            }
        };
        // `this` of an arrow function is that of what is around it.
        let mut function = self.enclosing_fn_of_expr(file, at);
        while let Some(arrow) = function.filter(|&function| hir[function].kind == FnKind::Arrow) {
            function = Some(self.bound(file).fns[arrow.idx()].enclosing).filter(|enclosing| enclosing.is_some());
        }
        let around = match function {
            Some(function) if hir[function].kind == FnKind::Constructor => 0,
            Some(_) => 1,
            None => 2,
        };
        let language = usize::from(self.is_untyped_file(file));
        self.recorded_mutations().untyped_sites[mutation as usize][language][form][around] += 1;
    }

    fn created_in_place(&self, file: FileId, mut operand: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        while let ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::AsConst(inner) = hir[operand].kind {
            operand = inner;
        }
        matches!(hir[operand].kind, ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_)).then_some(operand)
    }

    fn is_this_in_class_constructor(&self, file: FileId, operand: ExprId) -> bool {
        let hir = self.hir(file);
        if !matches!(hir[operand].kind, ExprKind::This) {
            return false;
        }
        let mut function = self.enclosing_fn_of_expr(file, operand);
        while let Some(arrow) = function.filter(|&function| hir[function].kind == FnKind::Arrow) {
            function = Some(self.bound(file).fns[arrow.idx()].enclosing).filter(|enclosing| enclosing.is_some());
        }
        function.is_some_and(|function| hir[function].kind == FnKind::Constructor)
    }

    fn record_mutated(&mut self, mutation: Mutation, types: &[TypeId], file: FileId, of_operand: ExprId) {
        let mut operand = ObjectTypes::default();
        for &ty in types {
            self.add_object_types(ty, &mut operand);
        }
        if let Some(made) = self.created_in_place(file, of_operand) {
            let hir = self.hir(file);
            let mut layer = of_operand;
            while layer != made {
                let (ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::AsConst(inner)) = hir[layer].kind else { break };
                layer = inner;
                let of_layer = self.type_of_expr(file, layer);
                self.add_object_types(of_layer, &mut operand);
            }
            if matches!(hir[made].kind, ExprKind::Object(_))
                && let Some(expected) = self.contextual_type_of_literal(file, made)
            {
                self.add_object_types(expected, &mut operand);
            }
            operand.is_untyped = false;
        }
        let types = operand.types;
        let kind = if operand.depends_on_type_parameter {
            Operand::DependsOnTypeParameter
        } else if operand.is_untyped {
            Operand::Untyped
        } else if !operand.parameters.is_empty() {
            Operand::TypeParameter
        } else if !types.is_empty() {
            Operand::ObjectType
        } else {
            Operand::NoLayout
        };
        if matches!(kind, Operand::Untyped) {
            self.record_untyped_site(mutation, file, Some(of_operand), of_operand);
        }
        let at = Place { file, pos: self.hir(file)[of_operand].pos };
        let noted = self.recorded_mutations();
        if operand.depends_on_type_parameter || operand.is_untyped {
            noted.record_widest(mutation, operand.depends_on_type_parameter, at);
        }
        noted.sites[mutation as usize][kind as usize] += 1;
        noted.of_types.extend(types.into_iter().map(|ty| (mutation, ty)));
        noted.parameter_mutations.extend(operand.parameters.into_iter().map(|parameter| (mutation, parameter)));
        noted.on_untyped[mutation as usize] |= operand.is_untyped;
        noted.on_anything[mutation as usize] |= operand.depends_on_type_parameter;
    }

    fn mutation_for_name(&self, name: Atom) -> Option<Mutation> {
        if name.is_none() {
            return None;
        }
        match self.atoms().bytes(name) {
            b"freeze" | b"seal" | b"preventExtensions" => Some(Mutation::IntegrityLevel),
            b"setPrototypeOf" => Some(Mutation::Prototype),
            _ => None,
        }
    }

    /// Whether `e` reads one of the built-ins by its name, where nothing else is known of it.
    fn mutation_for_expr(&mut self, file: FileId, e: ExprId) -> Option<Mutation> {
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = self.hir(file)[e].kind else { return None };
        self.mutation_for_name(name)
    }

    /// What a call by the signature does: `Object.freeze`, or what a package declares by that name, which can only do it by the built-in.
    /// It is known by the name it is declared under and by where that is.
    fn mutation_for_signature(&self, signature: SigId) -> Option<Mutation> {
        let (declared_in, func, _) = self.sig_decl(signature)?;
        let hir = self.hir(declared_in);
        if hir.kind != FileKind::Declaration {
            return None;
        }
        self.mutation_for_name(hir[func].name)
    }

    fn redefines_members(&self, signature: SigId) -> Option<bool> {
        let (declared_in, func, _) = self.sig_decl(signature)?;
        let hir = self.hir(declared_in);
        if hir.kind != FileKind::Declaration || hir[func].name.is_none() {
            return None;
        }
        match self.atoms().bytes(hir[func].name) {
            b"defineProperty" => Some(false),
            b"defineProperties" => Some(true),
            _ => None,
        }
    }

    fn is_representable_as_field(&self, file: FileId, descriptor: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Object(members) = hir[descriptor].kind else { return false };
        members.iter().all(|member| {
            let member = &hir[member];
            match member.key {
                PropKey::Name(name) if member.kind == PropKind::Init => match self.atoms().bytes(name) {
                    b"value" => true,
                    b"writable" | b"enumerable" | b"configurable" => matches!(hir[member.value].kind, ExprKind::True),
                    _ => false,
                },
                _ => false,
            }
        })
    }

    /// `Object.freeze.call(undefined, o)`, `Object.freeze.apply(undefined, [o])`: what the built-in does, and whether the arguments are in a list.
    fn built_in_called_through(&mut self, file: FileId, callee: ExprId) -> Option<(Mutation, bool)> {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[callee].kind else { return None };
        if name.is_none() {
            return None;
        }
        let is_list = match self.atoms().bytes(name) {
            b"call" => false,
            b"apply" => true,
            _ => return None,
        };
        let of_function = self.type_of_expr(file, obj);
        let signatures: Vec<SigId> = self.signatures(of_function, false).iter().copied().collect();
        signatures.into_iter().find_map(|signature| self.mutation_for_signature(signature)).map(|mutation| (mutation, is_list))
    }

    fn is_proto_access(&mut self, file: FileId, target: ExprId) -> Option<ExprId> {
        match self.hir(file)[target].kind {
            ExprKind::Dot { obj, name, .. } if name.is_some() && self.atoms().bytes(name) == b"__proto__" => Some(obj),
            ExprKind::Index { obj, index, .. } => {
                let name = self.name_of_key(file, index);
                (name.is_some() && self.atoms().bytes(name) == b"__proto__").then_some(obj)
            }
            _ => None,
        }
    }

    fn redefinition_operand_kind(&mut self, file: FileId, mut operand: ExprId) -> usize {
        let hir = self.hir(file);
        if !self.is_untyped_file(file) {
            let mut objects = ObjectTypes::default();
            let of_operand = self.type_of_expr(file, operand);
            self.add_object_types(of_operand, &mut objects);
            if objects.depends_on_type_parameter {
                return 2;
            }
            if !objects.is_untyped {
                return if !objects.parameters.is_empty() { 1 } else if !objects.types.is_empty() { 0 } else { 3 };
            }
        }
        while let ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::NonNull(inner) = hir[operand].kind {
            operand = inner;
        }
        match hir[operand].kind {
            ExprKind::This => 4,
            ExprKind::Ident(name) if name.is_some() && self.atoms().bytes(name) == b"exports" => 8,
            ExprKind::Ident(name) => {
                let declared = self.resolve_identifier(file, operand, name, true).ok().flatten();
                let is_parameter = declared.is_some_and(|sym| self.files.decls_of(sym).iter().any(|declared| matches!(declared.1, Decl::Param(_))));
                if is_parameter { 5 } else { 6 }
            }
            ExprKind::Dot { name, .. } if name.is_some() && self.atoms().bytes(name) == b"prototype" => 7,
            ExprKind::Dot { name, .. } if name.is_some() && self.atoms().bytes(name) == b"exports" => 8,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => 9,
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Await(_) => 10,
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_) => 11,
            _ => 12,
        }
    }

    fn redefinition_descriptor_kind(&mut self, file: FileId, descriptor: ExprId) -> usize {
        let hir = self.hir(file);
        let ExprKind::Object(members) = hir[descriptor].kind else { return 4 };
        let (mut has_value, mut is_writable, mut is_accessor, mut is_open) = (false, false, false, false);
        for member in members.iter() {
            let member = &hir[member];
            match member.key {
                PropKey::Name(name) if member.kind != PropKind::Spread => match self.atoms().bytes(name) {
                    b"value" => has_value = true,
                    b"writable" => is_writable = matches!(hir[member.value].kind, ExprKind::True),
                    b"get" | b"set" => is_accessor = true,
                    _ => {}
                },
                _ => is_open = true,
            }
        }
        if is_open {
            3
        } else if is_accessor {
            2
        } else if has_value {
            if is_writable { 0 } else { 1 }
        } else {
            3
        }
    }

    fn count_redefinition_at(&mut self, file: FileId, operand: ExprId, is_constant_key: bool, descriptor: usize) {
        let language = usize::from(self.is_untyped_file(file));
        let operand = self.redefinition_operand_kind(file, operand);
        self.recorded_mutations().redefinition_counts[language][usize::from(!is_constant_key)][descriptor][operand] += 1;
    }

    fn is_redefinition_key_constant(&mut self, file: FileId, key: ExprId) -> bool {
        matches!(self.hir(file)[key].kind, ExprKind::String(_) | ExprKind::Number(_)) || self.name_of_key(file, key).is_some()
    }

    /// For the numbers: `e` defines a property of an object or deletes one.
    fn count_redefinition(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Call(call) => {
                let ExprKind::Dot { obj: receiver, name, .. } = hir[hir[call].callee].kind else { return };
                if name.is_none() {
                    return;
                }
                let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                let redefinition_kind = match self.atoms().bytes(name) {
                    b"defineProperty" => 0,
                    b"defineProperties" => 1,
                    b"__defineGetter__" | b"__defineSetter__" => 2,
                    b"deleteProperty" => 3,
                    _ => return,
                };
                match (redefinition_kind, &arguments[..]) {
                    (0, &[operand, key, descriptor, ..]) => {
                        let (is_constant, descriptor) = (self.is_redefinition_key_constant(file, key), self.redefinition_descriptor_kind(file, descriptor));
                        self.count_redefinition_at(file, operand, is_constant, descriptor);
                    }
                    (1, &[operand, descriptors, ..]) => match hir[descriptors].kind {
                        ExprKind::Object(members) => {
                            for member in members.iter() {
                                let member = &hir[member];
                                let is_constant = matches!(member.key, PropKey::Name(_)) && member.kind != PropKind::Spread;
                                let descriptor = if member.kind == PropKind::Init { self.redefinition_descriptor_kind(file, member.value) } else { 4 };
                                self.count_redefinition_at(file, operand, is_constant, descriptor);
                            }
                        }
                        _ => self.count_redefinition_at(file, operand, false, 4),
                    },
                    (2, &[key, ..]) => {
                        let is_constant = self.is_redefinition_key_constant(file, key);
                        self.count_redefinition_at(file, receiver, is_constant, 2);
                    }
                    (3, &[operand, key, ..]) => {
                        let is_constant = self.is_redefinition_key_constant(file, key);
                        self.count_redefinition_at(file, operand, is_constant, 5);
                    }
                    _ => {}
                }
            }
            ExprKind::Unary { op: UnOp::Delete, operand } => match hir[operand].kind {
                ExprKind::Dot { obj, .. } => self.count_redefinition_at(file, obj, true, 5),
                ExprKind::Index { obj, index, .. } => {
                    let is_constant = self.is_redefinition_key_constant(file, index);
                    self.count_redefinition_at(file, obj, is_constant, 5);
                }
                _ => {}
            },
            _ => {}
        }
    }

    /// If `e` is a call of one of the built-ins, or a store to `__proto__`: takes note of what the operand is.
    pub(super) fn record_mutation_by(&mut self, file: FileId, e: ExprId) {
        self.count_redefinition(file, e);
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Call(call) => {
                let through = self.built_in_called_through(file, hir[call].callee);
                let signature = if through.is_some() { None } else { self.resolved_signature(file, e).sig };
                if let Some(is_of_several) = signature.and_then(|signature| self.redefines_members(signature)) {
                    let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                    let Some((&operand, rest)) = arguments.split_first() else { return };
                    let (mut names, mut is_any_name): (Vec<Atom>, bool) = (Vec::new(), false);
                    match (is_of_several, rest) {
                        (false, &[key, descriptor, ..]) => {
                            if !self.is_representable_as_field(file, descriptor) {
                                names = self.key_literal_names(file, key);
                                is_any_name = names.is_empty();
                            }
                        }
                        (true, &[descriptors, ..]) => match hir[descriptors].kind {
                            ExprKind::Object(members) => {
                                for member in members.iter() {
                                    let member = &hir[member];
                                    match member.key {
                                        PropKey::Name(name) if member.kind == PropKind::Init => {
                                            if !self.is_representable_as_field(file, member.value) {
                                                names.push(name);
                                            }
                                        }
                                        _ => is_any_name = true,
                                    }
                                }
                            }
                            _ => is_any_name = true,
                        },
                        _ => is_any_name = true,
                    }
                    if names.is_empty() && !is_any_name {
                        return;
                    }
                    let of_operand = self.type_of_expr(file, operand);
                    let mut objects = ObjectTypes::default();
                    self.add_object_types(of_operand, &mut objects);
                    let noted = self.recorded_mutations();
                    noted.parameter_mutations.extend(objects.parameters.into_iter().map(|parameter| (Mutation::Redefinition, parameter)));
                    return;
                }
                let Some(mutation) = (match (through, signature) {
                    (Some((mutation, _)), _) => Some(mutation),
                    (None, Some(signature)) => self.mutation_for_signature(signature),
                    (None, None) => self.mutation_for_expr(file, hir[call].callee),
                }) else {
                    return;
                };
                let mut arguments = hir.ids(hir[call].args).skip(usize::from(through.is_some()));
                let Some(operand) = arguments.next() else { return };
                if through.is_some_and(|(_, is_list)| is_list) || matches!(hir[operand].kind, ExprKind::Spread(_) | ExprKind::Missing) {
                    let at = Place { file, pos: hir[e].pos };
                    let noted = self.recorded_mutations();
                    noted.sites[mutation as usize][Operand::DependsOnTypeParameter as usize] += 1;
                    noted.on_anything[mutation as usize] = true;
                    noted.record_widest(mutation, true, at);
                    return;
                }
                if mutation == Mutation::Prototype && arguments.next().is_some_and(|prototype| matches!(hir[prototype].kind, ExprKind::Null)) {
                    self.recorded_mutations().sites[mutation as usize][Operand::ToNull as usize] += 1;
                    return;
                }
                // A literal is made as what it is checked against, which is the type of the parameter, where that says something:
                // `setPrototypeOf(o: any, ..)` does not.
                let of_parameter = signature.and_then(|signature| {
                    let parameters = self.sig_params(signature);
                    self.param_type_at(&parameters, 0).filter(|&of_parameter| !self.is_untyped_for_objects(of_parameter))
                });
                let types: Vec<TypeId> = [Some(self.type_of_expr(file, operand)), of_parameter].into_iter().flatten().collect();
                self.record_mutated(mutation, &types, file, operand);
            }
            ExprKind::Assign { target, value, .. } => {
                let Some(operand) = self.is_proto_access(file, target) else { return };
                if matches!(hir[value].kind, ExprKind::Null) {
                    self.recorded_mutations().sites[Mutation::Prototype as usize][Operand::ToNull as usize] += 1;
                    return;
                }
                let of_operand = self.type_of_expr(file, operand);
                self.record_mutated(Mutation::Prototype, &[of_operand], file, operand);
            }
            _ => {}
        }
    }

    /// `e` goes to a place of the type `target` as a value, or to one of which nothing is said. If it is one of the built-ins: see the top.
    fn has_mutating_builtin_signature(&mut self, ty: TypeId) -> bool {
        if self.cached_type_flag(ty, super::rows::HAS_NO_MUTATING_BUILTIN_SIGNATURE, 0).is_some() {
            return false;
        }
        let (found, is_cacheable) = self.compute_cacheable(|c| {
            let signatures = c.signatures(ty, false);
            signatures.iter().any(|&signature| c.mutation_for_signature(signature).is_some())
        });
        if !found && is_cacheable && !self.is_warming_up() && !self.has_order_dependent_results() {
            self.cache_type_flag(ty, super::rows::HAS_NO_MUTATING_BUILTIN_SIGNATURE, 0, false);
        }
        found
    }

    pub(super) fn record_built_in_as_value(&mut self, file: FileId, e: ExprId, target: Option<TypeId>) {
        let builtin_operand = self.type_of_expr(file, e);
        if !self.has_mutating_builtin_signature(builtin_operand) {
            return;
        }
        let own: Vec<SigId> = self.signatures(builtin_operand, false).iter().copied().collect();
        let Some(mutation) = own.into_iter().find_map(|signature| self.mutation_for_signature(signature)) else { return };
        let of_place: Vec<SigId> = target.map_or(Vec::new(), |target| self.signatures(target, false).iter().copied().collect());
        if !of_place.is_empty() && of_place.iter().all(|&signature| self.mutation_for_signature(signature) == Some(mutation)) {
            return;
        }
        self.recorded_mutations().sites[mutation as usize][Operand::BuiltInAsValue as usize] += 1;
        if of_place.is_empty() {
            self.record_untyped_site(mutation, file, None, e);
            let at = Place { file, pos: self.hir(file)[e].pos };
            let noted = self.recorded_mutations();
            noted.on_untyped[mutation as usize] = true;
            noted.record_widest(mutation, false, at);
        }
        for signature in of_place {
            let parameters = self.sig_params(signature);
            if let Some(of_operand) = self.param_type_at(&parameters, 0) {
                self.record_mutated(mutation, &[of_operand], file, e);
            }
        }
    }

    /// In JavaScript nothing is known of an operand, nor of what a name stands for.
    pub(super) fn record_javascript_mutations(&mut self, file: FileId) {
        let hir = self.hir(file);
        let (mut called, mut without_layout): (FxHashSet<ExprId>, FxHashSet<ExprId>) = Default::default();
        let calls: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::Call).to_vec();
        let unary: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::Unary).to_vec();
        for e in unary {
            self.count_redefinition(file, e);
        }
        for e in calls {
            self.count_redefinition(file, e);
            let ExprKind::Call(call) = hir[e].kind else { continue };
            if let Some(mutation) = self.mutation_for_expr(file, hir[call].callee) {
                called.insert(hir[call].callee);
                let operand = hir.ids(hir[call].args).next();
                if operand.is_some_and(|operand| self.created_in_place(file, operand).is_some() || mutation == Mutation::Prototype && self.is_this_in_class_constructor(file, operand)) {
                    without_layout.insert(hir[call].callee);
                    self.recorded_mutations().sites[mutation as usize][Operand::NoLayout as usize] += 1;
                    continue;
                }
                self.record_untyped_site(mutation, file, operand, e);
            }
        }
        for tag in [ExprTag::Dot, ExprTag::Ident] {
            let named: Vec<ExprId> = self.file_exprs_by_kind(file).of(tag).to_vec();
            for e in named {
                if let Some(mutation) = self.mutation_for_expr(file, e).filter(|_| !without_layout.contains(&e)) {
                    if !called.contains(&e) {
                        self.record_untyped_site(mutation, file, None, e);
                    }
                    let at = Place { file, pos: hir[e].pos };
                    let noted = self.recorded_mutations();
                    noted.sites[mutation as usize][Operand::Untyped as usize] += 1;
                    noted.on_untyped[mutation as usize] = true;
                    noted.record_widest(mutation, false, at);
                }
            }
        }
        let stores: Vec<ExprId> = self.file_exprs_by_kind(file).of(ExprTag::Assign).to_vec();
        for e in stores {
            if let ExprKind::Assign { target, .. } = hir[e].kind
                && let Some(operand) = self.is_proto_access(file, target)
            {
                self.record_untyped_site(Mutation::Prototype, file, Some(operand), e);
                let noted = self.recorded_mutations();
                noted.sites[Mutation::Prototype as usize][Operand::Untyped as usize] += 1;
                noted.on_untyped[Mutation::Prototype as usize] = true;
            }
        }
    }

    /// `--aot-explain=mutations`. Numbers alone.
    pub fn explain_mutations(&mut self, membership: &Membership) -> Vec<String> {
        let allocated: Vec<&super::flows::Reach> = membership.views.iter().filter(|reach| reach.is_allocated).collect();
        let mut lines = vec![format!("mutations: {} allocated layouts", allocated.len())];
        for (mutation, what) in Mutation::ALL.into_iter().zip(["integrity level", "prototype"]) {
            let [object_type, type_parameter, untyped, depends, no_layout, as_value, to_null] = membership.mutation_sites[mutation as usize];
            lines.push(format!(
                "mutations: {what}: places by the type of the operand: an object type {object_type}, a type parameter {type_parameter}, nothing said {untyped}, another type that depends on a type parameter or a spread {depends}, no layout {no_layout}; the built-in as a value {as_value}; to null {to_null}"
            ));
            let marked = allocated.iter().filter(|reach| if mutation == Mutation::IntegrityLevel { reach.may_be_frozen } else { reach.may_have_other_prototype }).count();
            let [by_types, in_all, marks_every_layout] = membership.mutated_by[mutation as usize];
            for (language, places) in ["TypeScript", "JavaScript"].into_iter().zip(membership.untyped_mutations[mutation as usize]) {
                let by_form: Vec<String> = FORMS.iter().zip(places).filter(|of_form| of_form.1 != [0; AROUND.len()]).map(|(form, by_around)| format!("{form} {by_around:?}")).collect();
                lines.push(format!("mutations: {what}: nothing said, {language}, by the form of the operand, each {AROUND:?}: {}", by_form.join(", ")));
            }
            lines.push(format!("mutations: {what}: {marked} allocated layouts are marked: {by_types} by types and type parameters, {in_all} in all, every layout: because an operand depends on a type parameter: {}, because nothing is said of an operand: {}", marks_every_layout & 1 != 0, marks_every_layout & 2 != 0));
            for (which, first) in ["every layout, nothing being said of the operand", "every layout"].into_iter().zip(membership.widest_mutations[mutation as usize]) {
                if let Some(first) = first {
                    lines.push(format!("mutations: {what}: where: the first place that marks {which}: {}", self.display_location(first)));
                }
            }
        }
        let [records, giving_up, escaped, records_kept_in, instances_kept_in] = membership.mutation_evidence;
        lines.push(format!("mutations: of the allocated layouts: {records} are records; {giving_up} records may give up their layout when they are altered; {escaped} layouts are seen to be let out to a place that says nothing; neither: {records_kept_in} records, {instances_kept_in} classes"));
        let (every, since, mutable, all) = self.explain_mutable_prototypes();
        lines.push(format!("mutations: constructor functions: what is done to a function that is not known goes for every one: {every}"));
        lines.push(format!("mutations: constructor functions: {mutable} of {all} have a prototype object that may be replaced or got hold of"));
        let ([other, constructor, unknown], listed) = self.explain_prototype_property_names();
        lines.push(format!(
            "mutations: constructor functions: places that define a property on a prototype object, by what the function is: no constructor function {other}, a constructor function {constructor}, not known {unknown}; names listed: {listed}"
        ));
        let (ended, of) = self.explain_first_stores_cut_by_prototype_names();
        lines.push(format!("mutations: constructor functions: first stores end at a listed name: {ended} of {of}"));
        if let Some(since) = since {
            lines.push(format!("mutations: constructor functions: where: the first place that goes for every one: {}", self.display_location(since)));
        }
        lines.push(format!("mutations: first stores: a construction has been left out, so nothing is known of any record: {}", membership.constructions_are_incomplete));
        lines.append(&mut self.explain_taint());
        lines.push(format!("mutations: properties defined and deleted: places by the operand: {REDEFINITION_OPERANDS:?}"));
        for (language, by_key) in ["TypeScript", "JavaScript"].into_iter().zip(membership.redefinition_counts) {
            for (key, by_descriptor) in KEYS.into_iter().zip(by_key) {
                for (descriptor, by_operand) in DESCRIPTORS.into_iter().zip(by_descriptor).filter(|of_descriptor| of_descriptor.1 != [0; REDEFINITION_OPERANDS.len()]) {
                    lines.push(format!("mutations: {language}, {key}, {descriptor}: {by_operand:?}"));
                }
            }
        }
        lines
    }
}

impl<T> Mutations<T> {
    pub(super) fn sites(&self) -> [[u32; OPERANDS]; 2] {
        self.sites
    }

    pub(super) fn untyped_sites(&self) -> UntypedSites {
        self.untyped_sites
    }

    pub(super) fn redefinition_counts(&self) -> RedefinitionCounts {
        self.redefinition_counts
    }

    pub(super) fn widest(&self) -> Widest {
        self.widest
    }
}

pub(super) const NUMBER_OF_OPERANDS: usize = OPERANDS;
pub(super) type UntypedMutations = UntypedSites;
pub(super) type CountedRedefinitions = RedefinitionCounts;
pub(super) type WidestMutations = Widest;
