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
//! - A type that says nothing, `any`, `unknown`, `object`: every layout that has escaped, see `escape_closure`. An object gets to such a place
//!   in no other way.
//! - `Readonly<T>`, `Partial<T>`, `T & {}`: as `T`.
//! - Any other type that depends on a type parameter, `T[K]`: every layout.
//!
//! A call is known by where its signature is declared, whatever the callee is called. So where the built-in goes somewhere as a value:
//! - A place of its own type, `const ObjectFreeze = Object.freeze`: nothing. What is in such a place is known when it is called.
//! - A place of another function type, `list.forEach(Object.freeze)`: as an operand of the type of the first parameter.
//! - A place that says nothing: as an operand of which nothing is said.
//!
//! What is noted is sets and sums: it is absorbed in any order. It is closed where the subtype sets are begun, but for what rests on the
//! escape closure, which `Subtypes::finish` adds.

use std::hash::Hash;

use rustc_hash::{FxHashMap, FxHashSet};

use super::escape_closure::TypeParameter;
use super::flows::{Membership, Place};
use crate::atom::Atom;
use crate::check::Checker;
use crate::bind::Decl;
use crate::hir::{ExprId, ExprKind, ExprTag, FileKind, FnKind, PropKey, PropKind, UnOp};
use crate::program::FileId;
use crate::types::{Origin, SigId, TypeData, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(super) enum Alteration {
    /// `Object.freeze`, `Object.seal`, `Object.preventExtensions`, `Reflect.preventExtensions`.
    IntegrityLevel,
    /// `Object.setPrototypeOf`, `Reflect.setPrototypeOf`, a store to `__proto__`. Not to `null`, which the run time lets any record go to.
    Prototype,
}

impl Alteration {
    pub(super) const ALL: [Alteration; 2] = [Alteration::IntegrityLevel, Alteration::Prototype];
}

/// What is known of an operand by its type. The order of `Alterations::sites`.
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
/// By alteration, by whether the file is JavaScript, by `FORMS`, by `AROUND`.
type UntypedPlaces = [[[[u32; AROUND.len()]; FORMS.len()]; 2]; 2];
type Widest = [[Option<Place>; 2]; 2];

/// The places that define a property or delete one. For the numbers.
const KEYS: [&str; 2] = ["a constant key", "another key"];
const DESCRIPTORS: [&str; 6] = ["`value` and `writable: true`", "`value`", "`get` or `set`", "a literal with none of these, a spread or a computed name", "no literal", "delete"];
/// What is known of the operand: by its type, and where that says nothing by its form.
const OPERANDS_OF_DOORS: [&str; 13] = [
    "an object type", "a type parameter", "another type that depends on one", "no layout",
    "this", "a parameter", "a variable", "`.prototype`", "`exports`", "another member", "what a call yields", "a literal", "another form",
];
/// By whether the file is JavaScript, by `KEYS`, by `DESCRIPTORS`, by `OPERANDS_OF_DOORS`.
type Doors = [[[[u32; OPERANDS_OF_DOORS.len()]; DESCRIPTORS.len()]; KEYS.len()]; 2];

pub(crate) struct Alterations<T = TypeId> {
    of_types: FxHashSet<(Alteration, T)>,
    of_parameters: FxHashSet<(Alteration, TypeParameter)>,
    /// By alteration.
    of_untyped: [bool; 2],
    of_anything: [bool; 2],
    /// A value of the object type enters a place of the type parameter.
    enters: FxHashSet<(TypeParameter, T)>,
    /// A value of the second type parameter enters a place of the first.
    parameter_enters: FxHashSet<(TypeParameter, TypeParameter)>,
    untyped_enters: FxHashSet<TypeParameter>,
    /// A value of a type that depends on a type parameter in another way, `T[K]`: it is not followed.
    anything_enters: FxHashSet<TypeParameter>,
    /// By alteration and `Operand`: how many places in the source.
    sites: [[u32; OPERANDS]; 2],
    /// By alteration: the first place in the source that marks all that has escaped, and the first that marks every layout.
    widest: Widest,
    untyped_places: UntypedPlaces,
    doors: Doors,
}

impl<T> Default for Alterations<T> {
    fn default() -> Alterations<T> {
        Alterations {
            of_types: FxHashSet::default(),
            of_parameters: FxHashSet::default(),
            of_untyped: [false; 2],
            of_anything: [false; 2],
            enters: FxHashSet::default(),
            parameter_enters: FxHashSet::default(),
            untyped_enters: FxHashSet::default(),
            anything_enters: FxHashSet::default(),
            sites: [[0; OPERANDS]; 2],
            widest: Default::default(),
            untyped_places: Default::default(),
            doors: Default::default(),
        }
    }
}

/// See `Alterations::closed`.
pub(super) struct Altered<T> {
    /// In no order.
    pub(super) types: Vec<T>,
    /// Every layout that has escaped as well.
    pub(super) is_untyped: bool,
    /// Every layout.
    pub(super) is_anything: bool,
}

impl<T: Copy + Eq + Hash> Alterations<T> {
    fn note_widest(&mut self, alteration: Alteration, is_anything: bool, at: Place) {
        let first = &mut self.widest[alteration as usize][usize::from(is_anything)];
        *first = Some(first.map_or(at, |first| first.min(at)));
    }

    pub(super) fn absorb(&mut self, other: Alterations<T>) {
        self.of_types.extend(other.of_types);
        self.of_parameters.extend(other.of_parameters);
        self.enters.extend(other.enters);
        self.parameter_enters.extend(other.parameter_enters);
        self.untyped_enters.extend(other.untyped_enters);
        self.anything_enters.extend(other.anything_enters);
        for (mine, theirs) in self.doors.as_flattened_mut().as_flattened_mut().as_flattened_mut().iter_mut().zip(other.doors.as_flattened().as_flattened().as_flattened()) {
            *mine += theirs;
        }
        for alteration in 0..2 {
            self.of_untyped[alteration] |= other.of_untyped[alteration];
            self.of_anything[alteration] |= other.of_anything[alteration];
            for how in 0..2 {
                self.widest[alteration][how] = [self.widest[alteration][how], other.widest[alteration][how]].into_iter().flatten().min();
            }
            for operand in 0..OPERANDS {
                self.sites[alteration][operand] += other.sites[alteration][operand];
            }
            for (language, form, around) in (0..2).flat_map(|language| (0..FORMS.len()).flat_map(move |form| (0..AROUND.len()).map(move |around| (language, form, around)))) {
                self.untyped_places[alteration][language][form][around] += other.untyped_places[alteration][language][form][around];
            }
        }
    }

    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Alterations<U> {
        Alterations {
            of_types: self.of_types.into_iter().filter_map(|(alteration, ty)| Some((alteration, rename(ty)?))).collect(),
            of_parameters: self.of_parameters,
            of_untyped: self.of_untyped,
            of_anything: self.of_anything,
            enters: self.enters.into_iter().filter_map(|(parameter, ty)| Some((parameter, rename(ty)?))).collect(),
            parameter_enters: self.parameter_enters,
            untyped_enters: self.untyped_enters,
            anything_enters: self.anything_enters,
            sites: self.sites,
            widest: self.widest,
            untyped_places: self.untyped_places,
            doors: self.doors,
        }
    }

    /// The types of the objects that may be the operand, type parameters followed back to what enters them.
    pub(super) fn closed(&self, alteration: Alteration) -> Altered<T> {
        let mut entering: FxHashMap<TypeParameter, Vec<TypeParameter>> = FxHashMap::default();
        for &(into, from) in &self.parameter_enters {
            entering.entry(into).or_default().push(from);
        }
        let mut pending: Vec<TypeParameter> = self.of_parameters.iter().filter(|altered| altered.0 == alteration).map(|altered| altered.1).collect();
        let mut reached: FxHashSet<TypeParameter> = pending.iter().copied().collect();
        while let Some(into) = pending.pop() {
            for &from in entering.get(&into).into_iter().flatten() {
                if reached.insert(from) {
                    pending.push(from);
                }
            }
        }
        let of_types = self.of_types.iter().filter(|altered| altered.0 == alteration).map(|altered| altered.1);
        Altered {
            types: of_types.chain(self.enters.iter().filter(|enters| reached.contains(&enters.0)).map(|enters| enters.1)).collect(),
            is_untyped: self.of_untyped[alteration as usize] || reached.iter().any(|parameter| self.untyped_enters.contains(parameter)),
            is_anything: self.of_anything[alteration as usize] || reached.iter().any(|parameter| self.anything_enters.contains(parameter)),
        }
    }
}

/// The objects that a value of a type may be, as far as the type goes.
#[derive(Default)]
struct ObjectsOf {
    /// `laid_out_as`.
    types: Vec<TypeId>,
    parameters: Vec<TypeParameter>,
    is_untyped: bool,
    depends_on_type_parameter: bool,
}

impl<'p, 's> Checker<'p, 's> {
    fn alterations_noted(&mut self) -> &mut Alterations {
        &mut self.escapes_noted().alterations
    }

    fn add_objects_of(&mut self, ty: TypeId, found: &mut ObjectsOf) {
        let ty = self.reduced(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            if part.is_never() || self.has_primitive_flag(part) {
                continue;
            }
            if self.says_nothing_of_objects(part) {
                found.is_untyped = true;
                continue;
            }
            match *self.data(part) {
                TypeData::TypeParam(file, parameter, _) => found.parameters.push((file, parameter)),
                // The objects of the class and of what extends it.
                TypeData::ThisParam(_) => {
                    let bound = self.base_constraint(part);
                    self.add_objects_of(bound, found);
                }
                // It is of every constituent, so those that say something say enough: `T & {}`.
                TypeData::Intersection(_) => {
                    let constituents: Vec<TypeId> = self.constituents(part).to_vec();
                    let mut of_all = ObjectsOf::default();
                    for constituent in constituents {
                        self.add_objects_of(constituent, &mut of_all);
                    }
                    if !self.is_instantiable(part) && !self.is_generic(part) && self.element_of_array_subtype(part).is_none() {
                        of_all.types.push(self.laid_out_as(part));
                    }
                    let says_something = !of_all.types.is_empty() || !of_all.parameters.is_empty();
                    found.is_untyped |= of_all.is_untyped && !says_something;
                    found.depends_on_type_parameter |= of_all.depends_on_type_parameter && !says_something;
                    found.types.append(&mut of_all.types);
                    found.parameters.append(&mut of_all.parameters);
                }
                // `Readonly<T>`, `Partial<T>`: places of it and places of `T` are taken for the same.
                TypeData::Anon { origin: Origin::Mapped(file, node), mapper } if self.is_generic(part) => match self.homomorphic_type_variable(file, node, mapper) {
                    Some(variable) => self.add_objects_of(variable, found),
                    None => found.depends_on_type_parameter = true,
                },
                _ if self.is_instantiable(part) || self.is_generic(part) => found.depends_on_type_parameter = true,
                // An array, a function and the like have no layout.
                _ if self.says_properties(part) && !self.is_array_or_tuple(part) && self.element_of_array_subtype(part).is_none() => found.types.push(self.laid_out_as(part)),
                _ => {}
            }
        }
    }

    /// A value of type `source` enters a place of type `target`, which may be one of a type parameter.
    pub(super) fn note_entering_type_parameters(&mut self, source: TypeId, target: TypeId) {
        if !self.aot.escape_closure.entered.insert((source, target)) {
            return;
        }
        let mut into = ObjectsOf::default();
        self.add_objects_of(target, &mut into);
        if into.parameters.is_empty() {
            return;
        }
        let mut from = ObjectsOf::default();
        self.add_objects_of(source, &mut from);
        let noted = self.alterations_noted();
        for parameter in into.parameters {
            noted.enters.extend(from.types.iter().map(|&ty| (parameter, ty)));
            noted.parameter_enters.extend(from.parameters.iter().filter(|&&other| other != parameter).map(|&other| (parameter, other)));
            if from.is_untyped {
                noted.untyped_enters.insert(parameter);
            }
            if from.depends_on_type_parameter {
                noted.anything_enters.insert(parameter);
            }
        }
    }

    /// `operand`: `None` if the built-in is named at `at` and not called.
    fn note_untyped_place(&mut self, alteration: Alteration, file: FileId, operand: Option<ExprId>, at: ExprId) {
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
        self.alterations_noted().untyped_places[alteration as usize][language][form][around] += 1;
    }

    fn note_altered(&mut self, alteration: Alteration, types: &[TypeId], file: FileId, of_operand: ExprId) {
        let mut operand = ObjectsOf::default();
        for &ty in types {
            self.add_objects_of(ty, &mut operand);
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
            self.note_untyped_place(alteration, file, Some(of_operand), of_operand);
        }
        let at = Place { file, pos: self.hir(file)[of_operand].pos };
        let noted = self.alterations_noted();
        if operand.depends_on_type_parameter || operand.is_untyped {
            noted.note_widest(alteration, operand.depends_on_type_parameter, at);
        }
        noted.sites[alteration as usize][kind as usize] += 1;
        noted.of_types.extend(types.into_iter().map(|ty| (alteration, ty)));
        noted.of_parameters.extend(operand.parameters.into_iter().map(|parameter| (alteration, parameter)));
        noted.of_untyped[alteration as usize] |= operand.is_untyped;
        noted.of_anything[alteration as usize] |= operand.depends_on_type_parameter;
    }

    fn alteration_named(&self, name: Atom) -> Option<Alteration> {
        if name.is_none() {
            return None;
        }
        match self.atoms().bytes(name) {
            b"freeze" | b"seal" | b"preventExtensions" => Some(Alteration::IntegrityLevel),
            b"setPrototypeOf" => Some(Alteration::Prototype),
            _ => None,
        }
    }

    /// Whether `e` reads one of the built-ins by its name, where nothing else is known of it.
    fn alteration_named_by(&mut self, file: FileId, e: ExprId) -> Option<Alteration> {
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = self.hir(file)[e].kind else { return None };
        self.alteration_named(name)
    }

    /// What a call by the signature does: `Object.freeze`, or what a package declares by that name, which can only do it by the built-in.
    /// It is known by the name it is declared under and by where that is.
    fn alteration_by_signature(&self, signature: SigId) -> Option<Alteration> {
        let (declared_in, func, _) = self.sig_decl(signature)?;
        let hir = self.hir(declared_in);
        if hir.kind != FileKind::Declaration {
            return None;
        }
        self.alteration_named(hir[func].name)
    }

    /// `Object.freeze.call(undefined, o)`, `Object.freeze.apply(undefined, [o])`: what the built-in does, and whether the arguments are in a list.
    fn built_in_called_through(&mut self, file: FileId, callee: ExprId) -> Option<(Alteration, bool)> {
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
        signatures.into_iter().find_map(|signature| self.alteration_by_signature(signature)).map(|alteration| (alteration, is_list))
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

    fn operand_of_door(&mut self, file: FileId, mut operand: ExprId) -> usize {
        let hir = self.hir(file);
        if !self.is_untyped_file(file) {
            let mut objects = ObjectsOf::default();
            let of_operand = self.type_of_expr(file, operand);
            self.add_objects_of(of_operand, &mut objects);
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

    fn descriptor_of_door(&mut self, file: FileId, descriptor: ExprId) -> usize {
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

    fn count_door_at(&mut self, file: FileId, operand: ExprId, is_constant_key: bool, descriptor: usize) {
        let language = usize::from(self.is_untyped_file(file));
        let operand = self.operand_of_door(file, operand);
        self.alterations_noted().doors[language][usize::from(!is_constant_key)][descriptor][operand] += 1;
    }

    fn is_key_of_door_constant(&mut self, file: FileId, key: ExprId) -> bool {
        matches!(self.hir(file)[key].kind, ExprKind::String(_) | ExprKind::Number(_)) || self.name_of_key(file, key).is_some()
    }

    /// For the numbers: `e` defines a property of an object or deletes one.
    fn count_door(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Call(call) => {
                let ExprKind::Dot { obj: receiver, name, .. } = hir[hir[call].callee].kind else { return };
                if name.is_none() {
                    return;
                }
                let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                let door = match self.atoms().bytes(name) {
                    b"defineProperty" => 0,
                    b"defineProperties" => 1,
                    b"__defineGetter__" | b"__defineSetter__" => 2,
                    b"deleteProperty" => 3,
                    _ => return,
                };
                match (door, &arguments[..]) {
                    (0, &[operand, key, descriptor, ..]) => {
                        let (is_constant, descriptor) = (self.is_key_of_door_constant(file, key), self.descriptor_of_door(file, descriptor));
                        self.count_door_at(file, operand, is_constant, descriptor);
                    }
                    (1, &[operand, descriptors, ..]) => match hir[descriptors].kind {
                        ExprKind::Object(members) => {
                            for member in members.iter() {
                                let member = &hir[member];
                                let is_constant = matches!(member.key, PropKey::Name(_)) && member.kind != PropKind::Spread;
                                let descriptor = if member.kind == PropKind::Init { self.descriptor_of_door(file, member.value) } else { 4 };
                                self.count_door_at(file, operand, is_constant, descriptor);
                            }
                        }
                        _ => self.count_door_at(file, operand, false, 4),
                    },
                    (2, &[key, ..]) => {
                        let is_constant = self.is_key_of_door_constant(file, key);
                        self.count_door_at(file, receiver, is_constant, 2);
                    }
                    (3, &[operand, key, ..]) => {
                        let is_constant = self.is_key_of_door_constant(file, key);
                        self.count_door_at(file, operand, is_constant, 5);
                    }
                    _ => {}
                }
            }
            ExprKind::Unary { op: UnOp::Delete, operand } => match hir[operand].kind {
                ExprKind::Dot { obj, .. } => self.count_door_at(file, obj, true, 5),
                ExprKind::Index { obj, index, .. } => {
                    let is_constant = self.is_key_of_door_constant(file, index);
                    self.count_door_at(file, obj, is_constant, 5);
                }
                _ => {}
            },
            _ => {}
        }
    }

    /// If `e` is a call of one of the built-ins, or a store to `__proto__`: takes note of what the operand is.
    pub(super) fn note_alteration_by(&mut self, file: FileId, e: ExprId) {
        self.count_door(file, e);
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Call(call) => {
                let through = self.built_in_called_through(file, hir[call].callee);
                let signature = if through.is_some() { None } else { self.resolved_signature(file, e).sig };
                let Some(alteration) = (match (through, signature) {
                    (Some((alteration, _)), _) => Some(alteration),
                    (None, Some(signature)) => self.alteration_by_signature(signature),
                    (None, None) => self.alteration_named_by(file, hir[call].callee),
                }) else {
                    return;
                };
                let mut arguments = hir.ids(hir[call].args).skip(usize::from(through.is_some()));
                let Some(operand) = arguments.next() else { return };
                if through.is_some_and(|(_, is_list)| is_list) || matches!(hir[operand].kind, ExprKind::Spread(_) | ExprKind::Missing) {
                    let at = Place { file, pos: hir[e].pos };
                    let noted = self.alterations_noted();
                    noted.sites[alteration as usize][Operand::DependsOnTypeParameter as usize] += 1;
                    noted.of_anything[alteration as usize] = true;
                    noted.note_widest(alteration, true, at);
                    return;
                }
                if alteration == Alteration::Prototype && arguments.next().is_some_and(|prototype| matches!(hir[prototype].kind, ExprKind::Null)) {
                    self.alterations_noted().sites[alteration as usize][Operand::ToNull as usize] += 1;
                    return;
                }
                // A literal is made as what it is checked against, which is the type of the parameter, where that says something:
                // `setPrototypeOf(o: any, ..)` does not.
                let of_parameter = signature.and_then(|signature| {
                    let parameters = self.sig_params(signature);
                    self.param_type_at(&parameters, 0).filter(|&of_parameter| !self.says_nothing_of_objects(of_parameter))
                });
                let types: Vec<TypeId> = [Some(self.type_of_expr(file, operand)), of_parameter].into_iter().flatten().collect();
                self.note_altered(alteration, &types, file, operand);
            }
            ExprKind::Assign { target, value, .. } => {
                let Some(operand) = self.is_proto_access(file, target) else { return };
                if matches!(hir[value].kind, ExprKind::Null) {
                    self.alterations_noted().sites[Alteration::Prototype as usize][Operand::ToNull as usize] += 1;
                    return;
                }
                let of_operand = self.type_of_expr(file, operand);
                self.note_altered(Alteration::Prototype, &[of_operand], file, operand);
            }
            _ => {}
        }
    }

    /// `e` goes to a place of the type `target` as a value, or to one of which nothing is said. If it is one of the built-ins: see the top.
    pub(super) fn note_built_in_as_value(&mut self, file: FileId, e: ExprId, target: Option<TypeId>) {
        let of_built_in = self.type_of_expr(file, e);
        let own: Vec<SigId> = self.signatures(of_built_in, false).iter().copied().collect();
        let Some(alteration) = own.into_iter().find_map(|signature| self.alteration_by_signature(signature)) else { return };
        let of_place: Vec<SigId> = target.map_or(Vec::new(), |target| self.signatures(target, false).iter().copied().collect());
        if !of_place.is_empty() && of_place.iter().all(|&signature| self.alteration_by_signature(signature) == Some(alteration)) {
            return;
        }
        self.alterations_noted().sites[alteration as usize][Operand::BuiltInAsValue as usize] += 1;
        if of_place.is_empty() {
            self.note_untyped_place(alteration, file, None, e);
            let at = Place { file, pos: self.hir(file)[e].pos };
            let noted = self.alterations_noted();
            noted.of_untyped[alteration as usize] = true;
            noted.note_widest(alteration, false, at);
        }
        for signature in of_place {
            let parameters = self.sig_params(signature);
            if let Some(of_operand) = self.param_type_at(&parameters, 0) {
                self.note_altered(alteration, &[of_operand], file, e);
            }
        }
    }

    /// In JavaScript nothing is known of an operand, nor of what a name stands for.
    pub(super) fn note_alterations_by_javascript(&mut self, file: FileId) {
        let hir = self.hir(file);
        let mut called: FxHashSet<ExprId> = FxHashSet::default();
        let calls: Vec<ExprId> = self.exprs_by_kind_of(file).of(ExprTag::Call).to_vec();
        let unary: Vec<ExprId> = self.exprs_by_kind_of(file).of(ExprTag::Unary).to_vec();
        for e in unary {
            self.count_door(file, e);
        }
        for e in calls {
            self.count_door(file, e);
            let ExprKind::Call(call) = hir[e].kind else { continue };
            if let Some(alteration) = self.alteration_named_by(file, hir[call].callee) {
                called.insert(hir[call].callee);
                self.note_untyped_place(alteration, file, hir.ids(hir[call].args).next(), e);
            }
        }
        for tag in [ExprTag::Dot, ExprTag::Ident] {
            let named: Vec<ExprId> = self.exprs_by_kind_of(file).of(tag).to_vec();
            for e in named {
                if let Some(alteration) = self.alteration_named_by(file, e) {
                    if !called.contains(&e) {
                        self.note_untyped_place(alteration, file, None, e);
                    }
                    let at = Place { file, pos: hir[e].pos };
                    let noted = self.alterations_noted();
                    noted.sites[alteration as usize][Operand::Untyped as usize] += 1;
                    noted.of_untyped[alteration as usize] = true;
                    noted.note_widest(alteration, false, at);
                }
            }
        }
        let stores: Vec<ExprId> = self.exprs_by_kind_of(file).of(ExprTag::Assign).to_vec();
        for e in stores {
            if let ExprKind::Assign { target, .. } = hir[e].kind
                && let Some(operand) = self.is_proto_access(file, target)
            {
                self.note_untyped_place(Alteration::Prototype, file, Some(operand), e);
                let noted = self.alterations_noted();
                noted.sites[Alteration::Prototype as usize][Operand::Untyped as usize] += 1;
                noted.of_untyped[Alteration::Prototype as usize] = true;
            }
        }
    }

    /// `--aot-explain=alterations`. Numbers alone.
    pub fn explain_alterations(&mut self, membership: &Membership) -> Vec<String> {
        let allocated: Vec<&super::flows::Reach> = membership.views.iter().filter(|reach| reach.is_allocated).collect();
        let escaped = membership.views.iter().zip(&membership.escaped).filter(|(reach, escaped)| reach.is_allocated && escaped.is_some()).count();
        let mut lines = vec![format!("alterations: {} allocated layouts, {escaped} of them have escaped", allocated.len())];
        for (alteration, what) in Alteration::ALL.into_iter().zip(["integrity level", "prototype"]) {
            let [object_type, type_parameter, untyped, depends, no_layout, as_value, to_null] = membership.alteration_sites[alteration as usize];
            lines.push(format!(
                "alterations: {what}: places by the type of the operand: an object type {object_type}, a type parameter {type_parameter}, nothing said {untyped}, another type that depends on a type parameter or a spread {depends}, no layout {no_layout}; the built-in as a value {as_value}; to null {to_null}"
            ));
            let marked = allocated.iter().filter(|reach| if alteration == Alteration::IntegrityLevel { reach.may_be_frozen } else { reach.may_have_other_prototype }).count();
            let [by_types, with_escaped, is_anything] = membership.altered_by[alteration as usize];
            for (language, places) in ["TypeScript", "JavaScript"].into_iter().zip(membership.untyped_alterations[alteration as usize]) {
                let by_form: Vec<String> = FORMS.iter().zip(places).filter(|of_form| of_form.1 != [0; AROUND.len()]).map(|(form, by_around)| format!("{form} {by_around:?}")).collect();
                lines.push(format!("alterations: {what}: nothing said, {language}, by the form of the operand, each {AROUND:?}: {}", by_form.join(", ")));
            }
            lines.push(format!("alterations: {what}: {marked} allocated layouts are marked: {by_types} by types and type parameters, {with_escaped} with those that have escaped, every layout: {}", is_anything != 0));
            for (which, first) in ["all that has escaped", "every layout"].into_iter().zip(membership.widest_alterations[alteration as usize]) {
                if let Some(first) = first {
                    lines.push(format!("alterations: {what}: where: the first place that marks {which}: {}", self.place_for_people(first)));
                }
            }
        }
        lines.push(format!("alterations: properties defined and deleted: places by the operand: {OPERANDS_OF_DOORS:?}"));
        for (language, by_key) in ["TypeScript", "JavaScript"].into_iter().zip(membership.doors) {
            for (key, by_descriptor) in KEYS.into_iter().zip(by_key) {
                for (descriptor, by_operand) in DESCRIPTORS.into_iter().zip(by_descriptor).filter(|of_descriptor| of_descriptor.1 != [0; OPERANDS_OF_DOORS.len()]) {
                    lines.push(format!("alterations: {language}, {key}, {descriptor}: {by_operand:?}"));
                }
            }
        }
        lines
    }
}

impl<T> Alterations<T> {
    pub(super) fn sites(&self) -> [[u32; OPERANDS]; 2] {
        self.sites
    }

    pub(super) fn untyped_places(&self) -> UntypedPlaces {
        self.untyped_places
    }

    pub(super) fn doors(&self) -> Doors {
        self.doors
    }

    pub(super) fn widest(&self) -> Widest {
        self.widest
    }
}

pub(super) const NUMBER_OF_OPERANDS: usize = OPERANDS;
pub(super) type UntypedAlterations = UntypedPlaces;
pub(super) type DoorsCounted = Doors;
pub(super) type WidestAlterations = Widest;
