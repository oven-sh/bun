//! Which objects are of which types.
//!
//! Compiled code looks at an object as a type says, a view, and tests nothing that the type says. So of every view it has to be known
//! which objects can be in its places: its members, which are types that objects are made as. That is a question about types and not
//! about where values go: **a type that objects are made as is a member of every view it is assignable to.** However an object gets to
//! a place, through `any`, out of a map, by `call`, it is found to be of the type of the place if it is.
//!
//! What has to agree for that is the names and the kinds of the properties. Their types need not, as far as memory goes: a field that
//! several views share is kept as the widest of them says, and a read through a narrower one is tested. So generic code, which is
//! compiled once for all its instantiations, is dealt with by letting a type parameter stand for anything.
//!
//! Not every object is laid out: an array, a function, a `Map`, what the host or a package makes. Those are assignable to types of the
//! program as well, `{ length: number }` for one. A view that such an object is seen to enter, or may enter where the program holds a
//! value to it of which its text says nothing, admits foreign objects, which costs every access through it a test and a general path.
//!
//! Whoever translates the program reports what objects are made as, what is cast to what, what is frozen, and where it has left out a
//! test because the one type is assignable to the other. All of it is sets. What follows is worked out once, when all are in:
//! `questions_about_views`.

use crate::atom::{Atom, known};
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{ClassId, ExprId, ExprKind, FileKind, FnId, MemberKind};
use crate::program::{FileId, Sym};
use crate::types::{ComponentsId, EnumValue, Follow, Intrinsic, MapperId, Origin, Prop, PropFlags, PropSource, Shape, SigId, TypeData, TypeId, Visitor};
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;

/// The classes of the language whose objects the engine makes and tells by what they are.
const CLASSES_OF_THE_ENGINE: [&[u8]; 23] = [
    b"Map",
    b"Set",
    b"WeakMap",
    b"WeakSet",
    b"Promise",
    b"Date",
    b"RegExp",
    b"Error",
    b"DataView",
    b"ArrayBuffer",
    b"SharedArrayBuffer",
    b"Int8Array",
    b"Uint8Array",
    b"Uint8ClampedArray",
    b"Int16Array",
    b"Uint16Array",
    b"Int32Array",
    b"Uint32Array",
    b"Float16Array",
    b"Float32Array",
    b"Float64Array",
    b"BigInt64Array",
    b"BigUint64Array",
];

/// A type in whose own type arguments one declaration is applied more often than this, one application within the other, is not laid out.
const MOST_APPLICATIONS_WITHIN_EACH_OTHER: u32 = 8;

/// Where in the source something has been noted.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Place {
    pub file: FileId,
    pub pos: u32,
}

impl Place {
    const NOWHERE: Place = Place { file: FileId(u32::MAX), pos: 0 };
}

impl Default for Place {
    fn default() -> Place {
        Place::NOWHERE
    }
}

/// What has been noted while a program, or a part of one, was translated. The types are those that say how objects are laid out
/// (`laid_out_as`), but for `frozen` and `not_laid_out`. `T`: what a type is called by. What costs something comes with the first place in
/// the program that it was noted at, so that it can be said why.
pub struct Noted<T = TypeId> {
    /// What objects are made as: by an allocation, or by a cast that turns an object into one or copies plain data into one.
    allocated: FxHashSet<T>,
    /// What plain data is cast to, which makes a copy of it.
    copied_into: FxHashSet<T>,
    /// An object that is looked at as the first type says is looked at as the second says from somewhere on, and no test is made there.
    upcasts: FxHashMap<(T, T), Place>,
    /// An object that is looked at as the first type says is cast to the second, which may turn it into one where it is.
    casts: FxHashSet<(T, T)>,
    /// The types of what is handed to `Object.freeze` and the like.
    frozen: FxHashSet<T>,
    /// An object that is not laid out, of a type that is assignable to this one, is let into a place of it, and no test is made there.
    /// With the type of the object.
    foreign: FxHashMap<T, (Option<T>, Place)>,
    /// The value of an expression whose type says nothing of it, `any`, `unknown`, `object`, `{}`, is held to it.
    untyped_into: FxHashMap<T, Place>,
    /// Types that no declaration names and whose objects are not laid out: `(() => number) & { unit: string }`, `number[] & { tag: string }`.
    not_laid_out: FxHashSet<T>,
}

impl<T> Default for Noted<T> {
    fn default() -> Noted<T> {
        Noted {
            allocated: FxHashSet::default(),
            copied_into: FxHashSet::default(),
            upcasts: FxHashMap::default(),
            casts: FxHashSet::default(),
            frozen: FxHashSet::default(),
            foreign: FxHashMap::default(),
            untyped_into: FxHashMap::default(),
            not_laid_out: FxHashSet::default(),
        }
    }
}

impl<T: Copy + Eq + Hash> Noted<T> {
    /// Adds what has been noted elsewhere, in terms of the same names for the types.
    pub fn absorb(&mut self, other: Noted<T>) {
        self.allocated.extend(other.allocated);
        self.copied_into.extend(other.copied_into);
        self.casts.extend(other.casts);
        self.frozen.extend(other.frozen);
        self.not_laid_out.extend(other.not_laid_out);
        for (upcast, at) in other.upcasts {
            self.add_upcast(upcast, at);
        }
        for (view, (source, at)) in other.foreign {
            self.add_foreign(view, source, at);
        }
        for (view, at) in other.untyped_into {
            self.add_untyped_inflow(view, at);
        }
    }

    fn add_upcast(&mut self, upcast: (T, T), at: Place) {
        let first = self.upcasts.entry(upcast).or_insert(at);
        *first = at.min(*first);
    }

    fn add_foreign(&mut self, view: T, source: Option<T>, at: Place) {
        let first = self.foreign.entry(view).or_insert((source, at));
        if at < first.1 {
            *first = (source, at);
        }
    }

    fn add_untyped_inflow(&mut self, view: T, at: Place) {
        let first = self.untyped_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    /// The same in terms of other names for the types. What `rename` has no name for is left out, a pair if either has none.
    pub fn renamed<U: Copy + Eq + Hash>(self, mut rename: impl FnMut(T) -> Option<U>) -> Noted<U> {
        let mut each = |types: FxHashSet<T>| -> FxHashSet<U> { types.into_iter().filter_map(&mut rename).collect() };
        let (allocated, copied_into, frozen, not_laid_out) = (each(self.allocated), each(self.copied_into), each(self.frozen), each(self.not_laid_out));
        let casts = self.casts.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let upcasts = self.upcasts.into_iter().filter_map(|((from, to), at)| Some(((rename(from)?, rename(to)?), at))).collect();
        let foreign = self.foreign.into_iter().filter_map(|(view, (source, at))| Some((rename(view)?, (source.and_then(&mut rename), at)))).collect();
        let untyped_into = self.untyped_into.into_iter().filter_map(|(view, at)| Some((rename(view)?, at))).collect();
        Noted { allocated, copied_into, upcasts, casts, frozen, foreign, untyped_into, not_laid_out }
    }
}

/// What the objects of a class or an interface are that are not laid out whoever declares it, because of what it extends.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Root {
    None,
    Array,
    /// It extends `Function`, or it can be called or constructed.
    Function,
    /// A class of the engine.
    Class(Sym),
}

/// The same, for whoever describes the type.
pub enum BuiltIn {
    Function,
    /// Objects of this type, which is a class of the engine.
    Instance(TypeId),
}

/// A string or a number that a type names.
#[derive(Copy, Clone, PartialEq)]
pub enum Literal {
    String(Atom),
    Number(f64),
}

#[derive(Default)]
pub(super) struct State {
    noted: Noted,
    /// `is_seen_as`, as far as it has been asked.
    seen_as: FxHashMap<(TypeId, TypeId), bool>,
    /// `root_of`, as far as it has been asked. Arrays, functions and the classes of the engine are in it from the first time on.
    roots: FxHashMap<Sym, Root>,
    /// What is being translated: see `note_place`.
    place: Place,
    /// What `types_held_entering` has been asked.
    held_entering: FxHashSet<(TypeId, TypeId)>,
    /// `find_applications_in`, as far as it has been asked.
    applications: FxHashMap<TypeId, Vec<(Applied, u32)>>,
}

/// What type arguments are applied to.
#[derive(Copy, Clone, PartialEq)]
enum Applied {
    /// A generic class or interface.
    Named(Sym),
    /// A type that is written where type parameters are in scope: the body of a generic alias, a type literal in a generic function.
    Written(Origin),
    Function(FileId, FnId),
    /// A spread, a rest, what a mapped type is inferred from.
    Computed,
    Tuple,
    /// No application: the text of a string literal type, which a template literal type makes longer.
    Text,
}

/// The types and the mappers that the record of a type refers to.
#[derive(Default)]
struct Referred {
    types: Vec<TypeId>,
    mappers: Vec<MapperId>,
}

impl Visitor for Referred {
    fn atom(&mut self, _: Atom) {}
    fn components(&mut self, _: ComponentsId) {}
    fn mapper(&mut self, id: MapperId) {
        self.mappers.push(id);
    }
    fn sig(&mut self, _: SigId) {}
    fn ty(&mut self, id: TypeId) {
        self.types.push(id);
    }
    fn file(&mut self, _: FileId) {}
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

/// What holds of one view. The other types are given by their index in the list of views that was asked about.
#[derive(Default)]
pub struct Reach {
    /// Something makes objects of it.
    pub is_allocated: bool,
    /// Objects that are made as it are of a type that the program freezes or seals objects of.
    pub may_be_frozen: bool,
    /// An object that is not laid out can be in places of this type.
    pub admits_foreign: bool,
    /// The allocated types whose objects can be in places of this type, itself among them if it is allocated. Ascending.
    pub members: Vec<u32>,
    /// What a cast may turn an object into, where it is, that was made as this type. Each is a member of this type. Ascending.
    pub specializations: Vec<u32>,
}

pub struct Membership {
    /// For each of the views that were asked about.
    pub views: Vec<Reach>,
    /// How many pairs of a type and a view were left for the relation to decide, once the names of the properties had been compared. The
    /// type is one that objects are made as, or one of objects that are not laid out.
    pub pairs_asked: usize,
    /// How many members were added that the relation does not find: assignability is not transitive throughout, and what is in a place
    /// of one type gets into places of another untested.
    pub members_added: usize,
    /// For each view that admits foreign objects: why.
    pub why_foreign: Vec<Option<WhyForeign>>,
    /// Over what the members were added. By view, and for each view the most first.
    pub added_over: Vec<AddedOver>,
}

/// Why a view admits objects that are not laid out.
#[derive(Copy, Clone)]
pub enum WhyForeign {
    /// A value of the type `source`, if that is still known, has been let in.
    Seen { source: Option<TypeId>, at: Place },
    /// The value of an expression whose type says nothing has been held to the view, or to one that holds it, and objects of the kind are
    /// of the type of the view.
    Untyped { at: Place, candidate: Candidate },
    /// What is in a place of the view `from` gets into places of this one untested.
    Inherited { from: u32, at: Place },
}

/// A kind of objects that are not laid out. `Checker::name_of_candidate` says which.
#[derive(Copy, Clone)]
pub struct Candidate(Kind);

/// Members that a view has only because a test has been left out.
pub struct AddedOver {
    pub view: u32,
    /// The view whose members they are, and where the upcast from it was noted. `None`: a cast may turn a member into them.
    pub from: Option<(u32, Place)>,
    pub members: u32,
}

/// Types, by their index in a list, and which of them has a property by which name.
#[derive(Default)]
struct Having {
    /// Ascending, as are `indexable` and each list of `by_name`.
    all: Vec<u32>,
    /// Those that a type with an index signature can take: they have one, or are known to have no properties but those they say.
    indexable: Vec<u32>,
    by_name: FxHashMap<Atom, Vec<u32>>,
}

/// What a question is about.
#[derive(Copy, Clone)]
enum Kind {
    /// Objects that are made as the type.
    Made(TypeId),
    /// Objects that are not laid out: arrays, functions, the objects of a class or an interface, a class or a function as a value. With
    /// `any` for type parameters. They are named by what every checker finds for itself, and not by a type that one checker has made.
    Arrays,
    Functions,
    InstancesOf(Sym),
    ValueOf(Sym),
    /// Objects of a type that no declaration names, which whoever has noted it has kept.
    Of(TypeId),
}

/// Whether objects of a kind are of the type of a view. It stands by itself: every checker of the program answers it the same, whatever
/// it has been asked before.
#[derive(Copy, Clone)]
pub struct Question {
    kind: Kind,
    view: TypeId,
    /// The index of the view, and that of the type the objects are made as.
    about: (u32, u32),
}

/// What is left once the names of the properties have been compared: the questions for the relation, and what is known without it.
pub struct Questions {
    questions: Vec<Question>,
    /// How many were answered on the way, about types that only this checker knows.
    answered: usize,
    number_of_views: usize,
    /// By view, and after the views by type that is frozen and no view: the members that are known. Ascending.
    members: Vec<Vec<u32>>,
    why_foreign: Vec<Option<WhyForeign>>,
    /// By view: where something untyped was held to it. `NOWHERE`: nowhere.
    untyped_at: Vec<Place>,
    allocated: Vec<u32>,
    frozen: Vec<u32>,
    upcasts: Vec<(u32, u32, Place)>,
    casts: Vec<(u32, u32)>,
}

/// The numbers of the bits that are set, in ascending order.
fn places_in(row: &[u64]) -> impl Iterator<Item = usize> + '_ {
    row.iter().enumerate().flat_map(|(word, &bits)| {
        std::iter::successors((bits != 0).then_some(bits), |&left| {
            let left = left & (left - 1);
            (left != 0).then_some(left)
        })
        .map(move |left| word * 64 + left.trailing_zeros() as usize)
    })
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is noted ─────────────────────────────

    /// The type that says how objects of type `ty` are laid out. There is one for all instantiations of a class and its `this` type, since
    /// a class is compiled once, and one for the fresh type of an object literal, which the expression has, and the regular one. A mapped
    /// type over a type parameter is the same over what the parameter is bounded by, as the parameter by itself is: where `T extends
    /// Node`, a `Mutable<T>` is a `Mutable<Node>`. `Identifier & BinaryExpression`, which nothing is, going by `kind`, is `never`: no view, no
    /// member, nothing that objects are made as or cast to.
    pub fn laid_out_as(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        match *self.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) if self.files().flags(target).contains(SymFlags::CLASS) => self.declared_type(target),
            TypeData::Anon { origin: Origin::Mapped(file, node), mapper } => {
                let Some((over, _)) = self.mapped_modifiers_source(file, node) else { return ty };
                let over = self.instantiate(over, mapper);
                if !self.is_type_param(over) {
                    return ty;
                }
                let bound = self.base_constraint(over);
                let bounded = self.types().mapper(vec![(over, bound)]);
                let bounded = self.instantiate(ty, bounded);
                if bounded == ty { ty } else { self.laid_out_as(bounded) }
            }
            _ => {
                let ty = self.regular(ty);
                self.regular_type_of_object_literal(ty)
            }
        }
    }

    /// Whether the type is one of a family that need not end, and too far out in it to be laid out: `interface List<T> { next:
    /// List<List<T>> }` has a field of a larger instantiation of itself, which has one of a larger one still. That is read off the type
    /// alone, however it was come by: some declaration is applied too often within its own type arguments, `List<List<List<..>>>`, or,
    /// where `A<T>` has a `B<T[]>` and `B<T>` an `A<T[]>`, `T[][][]..`. A long tuple and a long text count for more, so that what only grows
    /// sideways, `C<[...T, 0]>`, ends as well.
    pub fn is_nested_too_deeply(&mut self, ty: TypeId) -> bool {
        self.find_applications_in(ty);
        self.aot.flows.applications[&ty].iter().any(|&(_, times)| times > MOST_APPLICATIONS_WITHIN_EACH_OTHER)
    }

    /// For each declaration: how often at most it is applied, one application within the other, in `ty` and its type arguments. It goes by
    /// the records of the types, which refer to older records only, so it ends: the arguments of `Json[]` in `type Json = string | Json[]`
    /// are a node there and not the type they resolve to. Types may be nested thousands deep, so it keeps its own list of what is to do.
    fn find_applications_in(&mut self, ty: TypeId) {
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.aot.flows.applications.contains_key(&at) {
                pending.pop();
                continue;
            }
            let mut referred = Referred::default();
            self.data(at).visit(&mut referred);
            for mapper in std::mem::take(&mut referred.mappers) {
                if mapper != MapperId::IDENTITY {
                    referred.types.extend(self.types().mapping(mapper).iter().map(|pair| pair.1));
                }
            }
            // The arguments first.
            let known = pending.len();
            pending.extend(referred.types.iter().copied().filter(|argument| !self.aot.flows.applications.contains_key(argument)));
            if pending.len() > known {
                continue;
            }
            let arguments = referred.types.len() as u32;
            let own = match *self.data(at) {
                TypeData::StringLit { value, .. } => Some((Applied::Text, self.atoms().bytes(value).len() as u32 / 64)),
                _ if arguments == 0 => None,
                TypeData::Ref { target, .. } => Some((Applied::Named(target), 1)),
                TypeData::Anon { origin, .. } => Some((Applied::Written(origin), 1)),
                TypeData::Fns { ref decls, .. } => decls.first().map(|&(file, func)| (Applied::Function(file, func), 1)),
                TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Some((Applied::Computed, 1)),
                TypeData::Tuple { .. } => Some((Applied::Tuple, 1 + arguments / 16)),
                _ => None,
            };
            let mut all: Vec<(Applied, u32)> = Vec::new();
            for argument in &referred.types {
                for &(applied, times) in &self.aot.flows.applications[argument] {
                    match all.iter_mut().find(|known| known.0 == applied) {
                        Some(known) => known.1 = known.1.max(times),
                        None => all.push((applied, times)),
                    }
                }
            }
            if let Some((applied, times)) = own {
                match all.iter_mut().find(|known| known.0 == applied) {
                    Some(known) => known.1 += times,
                    None => all.push((applied, times)),
                }
            }
            self.aot.flows.applications.insert(at, all);
            pending.pop();
        }
    }

    /// `laid_out_as` of the objects of the class.
    pub fn type_of_instances(&mut self, file: FileId, class: ClassId) -> TypeId {
        let class = self.class_sym(file, class);
        self.declared_type(class)
    }

    /// Whether the type is that of the objects of a class.
    pub fn is_type_of_instances(&self, ty: TypeId) -> bool {
        matches!(*self.data(ty), TypeData::Ref { target, .. } if self.files().flags(target).contains(SymFlags::CLASS))
    }

    /// Whether an object that is looked at as `source` says may be looked at as `target` says without a test: whatever is a member of the
    /// one is a member of the other. Both say how objects are laid out.
    ///
    /// That is the assignability relation again, but a type parameter does not stand for the same on both sides. A `Box<T>` is any box,
    /// whatever `T` is bounded by, and a place for a `Box<string>` is not a place for any box: in `source` a type parameter is like nothing
    /// else. Any box will do for a `Box<T>`: in `target` it stands for anything. So on the way out of generic code a test is made, and on
    /// the way in none.
    pub fn is_seen_as(&mut self, source: TypeId, target: TypeId) -> bool {
        if let Some(&known) = self.aot.flows.seen_as.get(&(source, target)) {
            return known;
        }
        let (opaque, any) = (self.restrictive_instantiation(source), self.permissive_instantiation(target));
        let is_seen = self.is_assignable(opaque, any);
        self.aot.flows.seen_as.insert((source, target), is_seen);
        is_seen
    }

    /// An object that is looked at as `source` says is looked at as `target` says, and no test is made: `is_seen_as` has been relied on, or
    /// the object is known to be the same, see `argument_handed_back_by`.
    pub fn note_upcast(&mut self, source: TypeId, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_upcast((source, target), at);
    }

    /// What is translated from here on is at `pos` of `file`. What is noted is noted for that place.
    pub fn note_place(&mut self, file: FileId, pos: u32) {
        self.aot.flows.place = Place { file, pos };
    }

    /// What the parts of the union have in common, which is what an object is looked at as of which it is not known which part it is of.
    /// Each part is seen as that, whatever the relation makes of it.
    pub fn view_of_union(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let view = self.union_as_object(union);
        for &part in self.parts(union) {
            if self.says_properties(part) {
                let part = self.laid_out_as(part);
                self.aot.flows.seen_as.insert((part, view), true);
            }
        }
        view
    }

    /// What an object is looked at as that is of one of the parts of the union, where a property is accessed that not all of them have:
    /// `(node as NamedDeclaration).name`, where the object may be any `Node`. It has a property by every name that one of the parts has.
    /// What some part lacks or need not have, it need not have. Each part is seen as that, whatever the relation makes of it.
    pub fn view_of_either(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let parts: Vec<TypeId> = self.parts(union).iter().copied().filter(|&part| self.says_properties(part)).collect();
        self.view_with_all_names(&parts, None)
    }

    /// What an object is looked at as of which nothing is known and that has been coerced to `target`: one of `target`, if it could be made
    /// one, or whatever it was. It has the properties of `target`, and need not have any. It is a type of its own, so that `target`
    /// stays what it is: a view that has only its members in its places.
    fn view_of_anything_as(&mut self, target: TypeId) -> TypeId {
        let parts: Vec<TypeId> = self.parts(target).to_vec();
        self.view_with_all_names(&parts, Some(target))
    }

    /// Whether the type is a `view_of_anything_as`.
    pub fn is_view_of_anything(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && matches!(shape.spread_of, Some((TypeId::UNKNOWN, _))))
    }

    /// `of_anything`: for `view_of_anything_as`, the type that is meant. It is kept where a spread keeps its operands, with a rank that no
    /// spread has: that tells the type from every other, in every checker.
    fn view_with_all_names(&mut self, parts: &[TypeId], of_anything: Option<TypeId>) -> TypeId {
        let mut of_parts = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            of_parts.extend(self.members(apparent));
        }
        let mut shape = Shape::new_in(self.arena);
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        for members in &of_parts {
            for prop in members.shape().props.iter().filter(|prop| seen.insert(prop.name)) {
                let (mut types, mut is_optional, mut flags) = (Vec::new(), of_anything.is_some(), PropFlags::METHOD);
                for other in &of_parts {
                    let Some(found) = other.resolved.prop(prop.name) else {
                        is_optional = true;
                        continue;
                    };
                    types.push(self.type_of_prop(found, other.mapper));
                    is_optional |= found.flags.contains(PropFlags::OPTIONAL);
                    // A method only if it is one everywhere. What is an accessor somewhere is no field.
                    flags = (flags & found.flags) | (found.flags & PropFlags::ACCESSOR) | (flags & PropFlags::ACCESSOR);
                }
                if is_optional {
                    types.push(TypeId::UNDEFINED);
                    flags |= PropFlags::OPTIONAL;
                }
                let ty = self.union(&types);
                shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY });
            }
        }
        if let Some(target) = of_anything {
            (shape.spread_of, shape.spread_rank) = (Some((TypeId::UNKNOWN, target)), u32::MAX);
        }
        let view = self.synth(shape);
        for &part in parts {
            let part = self.laid_out_as(part);
            self.aot.flows.seen_as.insert((part, view), true);
        }
        view
    }

    /// The type, as a fact, of what `e as T` yields, where `e` is of type `source` and `T` is `target`. `as` coerces, as `ToObject` does, and
    /// does not assert.
    ///
    /// * A primitive becomes one of the primitives of `target`, by the conversions of the language. So those of `source` are gone.
    /// * An object stays the same object. It is made one of `target` if it can be: it is one, it was made as less and has what is
    ///   missing, it is plain data. Otherwise it is what it was. So the result is of `target` or of one of the object types of `source`.
    /// * If nothing is known of `e`, it is of `target` or anything: `view_of_anything_as`. Where `target` has no type among its parts
    ///   that says which properties an object has, `number[]`, `() => void`, there is no such view, and the cast asserts.
    /// * If `target` has no objects, an object is converted as well.
    pub fn type_coerced(&mut self, source: TypeId, target: TypeId) -> TypeId {
        let (source, target) = (self.reduced(source), self.reduced(target));
        if self.says_nothing(target) || self.parts(target).iter().all(|&part| self.has_primitive_flag(part)) || self.is_assignable(source, target) {
            return target;
        }
        if !self.is_untyped(source) {
            let mut parts = vec![target];
            parts.extend(self.parts(source).iter().copied().filter(|&part| !self.has_primitive_flag(part)));
            return self.union(&parts);
        }
        let (mut views, mut parts) = (Vec::new(), Vec::new());
        for &part in self.parts(target) {
            let is_view = self.says_properties(part) && self.element_of_array_subtype(part).is_none() && self.built_in_extended_by(part).is_none();
            if is_view { views.push(part) } else { parts.push(part) }
        }
        if views.is_empty() {
            return target;
        }
        let views = self.union(&views);
        parts.push(self.view_of_anything_as(views));
        self.union(&parts)
    }

    /// An object of which nothing is known is in a place of the view from here on. `source`: the checker's type of it.
    pub fn note_foreign(&mut self, view: TypeId, source: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_foreign(view, (source != TypeId::UNRESOLVED).then_some(source), at);
    }

    /// An object is made as `ty` says.
    pub fn note_allocation(&mut self, ty: TypeId) {
        let ty = self.laid_out_as(ty);
        self.aot.flows.noted.allocated.insert(ty);
    }

    /// `const host: Host = system as any`, where a `Host` is neither more nor less than a `System`, and what is missing is stored next. It is
    /// the same object, and goes on being used as a `System`. What such a cast makes of it: a `System & Host`, which is both. `None` if
    /// one of the types is the other and more, or nothing can be both.
    pub fn type_of_both(&mut self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let are_laid_out = self.says_properties(source) && self.says_properties(target) && !self.is_type_of_instances(source) && !self.is_type_of_instances(target);
        if !are_laid_out || self.is_of_type(target, source) || self.is_of_type(source, target) {
            return None;
        }
        let both = self.intersection(&[source, target]);
        let both = self.laid_out_as(both);
        matches!(self.data(both), TypeData::Intersection(_)).then_some(both)
    }

    /// A value is cast to `target`, with `as`, with `!` or by entering a place whose type is written down. `sources`: what it is looked at
    /// as, as far as it is an object of the program. `may_be_plain`: it may be an object that the program has not laid out. All say how
    /// objects are laid out.
    ///
    /// The cast may make an object of `target`: of plain data a copy, of an object that was made as something `target` extends that
    /// object. Nothing becomes an object of a class but by its constructor.
    pub fn note_cast(&mut self, sources: &[TypeId], target: TypeId, may_be_plain: bool) {
        if self.is_type_of_instances(target) {
            return;
        }
        if may_be_plain {
            self.aot.flows.noted.copied_into.insert(target);
            self.aot.flows.noted.allocated.insert(target);
        }
        for &source in sources {
            // An object only becomes what has all it has. It was made as a member of `source`, so that goes for `source` too.
            if self.is_of_type(target, source) {
                self.aot.flows.noted.casts.insert((source, target));
                self.aot.flows.noted.allocated.insert(target);
            }
        }
        // `function tag<T extends object>(value: T): T & Tagged { return Object.assign(value, { .. }) }`: whoever calls it gets back what it
        // has handed over, of which nothing is known in between. What was made as one of the types of an intersection and has been given
        // the rest becomes one of the intersection.
        if let TypeData::Intersection(parts) = self.data(target) {
            for &part in parts.iter() {
                if self.says_properties(part) {
                    let part = self.laid_out_as(part);
                    self.aot.flows.noted.casts.insert((part, target));
                }
            }
            self.aot.flows.noted.allocated.insert(target);
        }
    }

    /// If the call `e` yields its first argument itself, whatever more the type of the call says of it: that argument. `Object.assign(target,
    /// ..)`, which is a `T & U`, `Object.freeze(o)`, a `Readonly<T>`, `seal`, `preventExtensions`, `defineProperty`, `defineProperties`,
    /// `setPrototypeOf`. The function is known by the signature the call is resolved to.
    pub fn argument_handed_back_by(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        const NAMES: [&[u8]; 7] = [b"assign", b"freeze", b"seal", b"preventExtensions", b"defineProperty", b"defineProperties", b"setPrototypeOf"];
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = hir[hir[call].callee].kind else { return None };
        if name.is_none() || !NAMES.contains(&self.atoms().bytes(name)) {
            return None;
        }
        let first = hir.ids(hir[call].args).next().filter(|&first| !matches!(hir[first].kind, ExprKind::Spread(_) | ExprKind::Missing))?;
        let (declared_in, func, _) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))?;
        let (of, bound) = (self.hir(declared_in), self.bound(declared_in));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else { return None };
        let MemberOwner::Interface(interface) = bound.member_owner[member.idx()] else { return None };
        let is_the_global = of.kind == FileKind::Declaration && of[func].name.is_some() && NAMES.contains(&self.atoms().bytes(of[func].name)) && self.atoms().bytes(of[interface].name) == b"ObjectConstructor";
        is_the_global.then_some(first)
    }

    /// An expression is of type `ty`. Takes note of the intersections in it with an array, a function or a class of the engine: there are
    /// objects of such a type, they are not laid out, and no declaration names it.
    pub fn note_type_of_expression(&mut self, ty: TypeId) {
        for &part in self.parts(ty) {
            if matches!(self.data(part), TypeData::Intersection(_)) && (self.element_of_array_subtype(part).is_some() || self.built_in_extended_by(part).is_some()) {
                self.aot.flows.noted.not_laid_out.insert(part);
            }
        }
    }

    /// What a value of the type yields when it is called or constructed. Something of which nothing is known that is cast to `(n: number)
    /// => Wrapped` yields what nothing is known of either, and that is held to `Wrapped`.
    pub fn results_of_calls(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut results = Vec::new();
        if ty == TypeId::UNRESOLVED {
            return results;
        }
        for &part in self.parts(ty) {
            for constructs in [false, true] {
                for &sig in self.signatures(part, constructs).iter() {
                    results.push(self.sig_return(sig));
                }
            }
        }
        results
    }

    /// Whether the type says nothing of what an object of it is: `any`, `unknown`, `object`, `{}`, or a type parameter that is bounded by
    /// one of them. Not so where the checker has no type.
    pub fn is_untyped(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED {
            return false;
        }
        self.parts(ty).iter().any(|&part| {
            let part = if self.is_instantiable(part) { self.base_constraint(part) } else { part };
            part.is_any() || part == TypeId::UNKNOWN || part == TypeId::OBJECT || self.admits_primitives(part)
        })
    }

    /// The value of an expression whose type `is_untyped` is held to `target`, which says how objects are laid out.
    pub fn note_untyped_inflow(&mut self, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_untyped_inflow(target, at);
    }

    /// The type that the checker has for where the value of `e` goes, if `e` is an argument, an element of an array literal, the value of
    /// a property of an object literal, or what is assigned. That is a place like any other, whether or not the translated program
    /// has one of that type there: `map.set(key, e)`, `list.push(e)`, `[e]`, `options.handler = e`.
    pub fn type_entered_by(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        let enters = match self.bound(file).expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != e,
                ExprKind::Array(_) => true,
                ExprKind::Assign { op: None, value, .. } => value == e,
                _ => false,
            },
            Parent::Prop(_) => true,
            _ => false,
        };
        // An object literal is made as what it is checked against, or is of that type by what it is made as.
        if !enters || matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing | ExprKind::Object(_)) {
            return None;
        }
        let source = self.type_of_expr(file, e);
        if self.says_nothing(source) || self.parts(source).iter().all(|&part| self.has_primitive_flag(part)) {
            return None;
        }
        self.contextual_type_of_literal(file, e).filter(|&target| !self.says_nothing(target))
    }

    /// `source`: the type of a function of the program. `target`: the type of a place it is handed to. If that is a function type that a
    /// declaration file or JavaScript declares, whoever calls the function there is not compiled with the program, and calls it with
    /// what that type says: for each parameter, the type of what it is called with and the type it is declared with. These are the
    /// signatures that the checker compares when it checks the one type against the other.
    pub fn arguments_of_callback(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        if !matches!(self.data(source), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. }) {
            return entering;
        }
        for &part in self.parts(target) {
            for &called_as in self.signatures(part, false).iter() {
                let is_called_from_outside = self.sig_decl(called_as).is_some_and(|(file, ..)| self.hir(file).is_js || self.hir(file).kind == FileKind::Declaration);
                if !is_called_from_outside {
                    continue;
                }
                let arguments = self.sig_params(called_as);
                for &declared_as in self.signatures(source, false).iter() {
                    if !self.sig_decl(declared_as).is_some_and(|(file, ..)| !self.hir(file).is_js && self.hir(file).kind != FileKind::Declaration) {
                        continue;
                    }
                    let parameters = self.sig_params(declared_as);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            entering.push((argument, parameter));
                        }
                    }
                }
            }
        }
        entering
    }

    /// A value of type `source` enters a place of type `target`. If both hold other values, those enter with it, and nothing tests them
    /// there: the elements of an `S[]` that is taken for a `T[]`, what is in a `Map<K, S>` that is taken for a `Map<K, T>`, in a `Set`, a
    /// `Promise`, an `Iterable`, a dictionary. For each, the type of what is held and the type it is held as: the type arguments, where
    /// the two are instantiations of one declaration, or else what their index signatures say. The first time it is asked of the two
    /// types, and nothing after that.
    pub fn types_held_entering(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        if source == target || self.says_nothing(source) || self.says_nothing(target) || !self.aot.flows.held_entering.insert((source, target)) {
            return entering;
        }
        for &from in self.parts(source) {
            for &to in self.parts(target) {
                if from == to || self.has_primitive_flag(from) || self.has_primitive_flag(to) {
                    continue;
                }
                if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
                    && declared == as_declared
                {
                    let (held, held_as) = (self.type_arguments(from), self.type_arguments(to));
                    entering.extend(held.iter().copied().zip(held_as.iter().copied()));
                    continue;
                }
                for key in [TypeId::NUMBER, TypeId::STRING] {
                    if let (Some(held), Some(held_as)) = (self.index_type_of_type(from, key), self.index_type_of_type(to, key)) {
                        entering.push((held, held_as));
                    }
                }
            }
        }
        entering
    }

    /// Whether a value of type `source`, whose objects are not laid out, may enter a place for objects of one of `views` as it is: `source`
    /// says what they are, which `any`, `unknown`, `object` and `{}` do not, and each is seen as one of the views. If so, note is taken
    /// that the view admits them.
    pub fn admits_foreign(&mut self, source: TypeId, views: &[TypeId]) -> bool {
        let source = self.reduced(source);
        let mut admitting = Vec::new();
        let is_admitted = self.is_taken_by_views(source, views, &mut admitting) && !admitting.is_empty();
        if is_admitted {
            let at = self.aot.flows.place;
            for view in admitting {
                self.aot.flows.noted.add_foreign(view, Some(source), at);
            }
        }
        is_admitted
    }

    /// Appends the views that take the objects a value of type `source` can be. False: there is none for some, or it is not known what
    /// they are.
    fn is_taken_by_views(&mut self, source: TypeId, views: &[TypeId], out: &mut Vec<TypeId>) -> bool {
        if let TypeData::Union(parts) = self.data(source) {
            return parts.iter().all(|&part| self.is_taken_by_views(part, views, out));
        }
        if self.says_nothing(source) || source == TypeId::OBJECT {
            return false;
        }
        if self.is_instantiable(source) {
            let bound = self.base_constraint(source);
            return bound != source && self.is_taken_by_views(bound, views, out);
        }
        // Whether a primitive may enter is not asked here.
        if self.has_primitive_flag(source) {
            return true;
        }
        if self.admits_primitives(source) {
            return false;
        }
        let Some(&view) = views.iter().find(|&&view| self.is_seen_as(source, view)) else { return false };
        out.push(view);
        true
    }

    /// Whether an object literal that is checked against the type is checked against the type of the objects of a class. It is not made
    /// as that: nothing but the constructor makes one.
    pub fn is_checked_against_a_class(&self, expected: TypeId) -> bool {
        self.parts(expected).iter().any(|&part| self.is_type_of_instances(part))
    }

    /// If the call `e` is one of `Object.freeze(o)`, `Object.seal(o)`, `Object.preventExtensions(o)`, `Reflect.preventExtensions(o)`, or of
    /// what a package declares by one of these names, which can only do it by them: takes note of what `o` is. The function is known by
    /// the name it is called by and by where it is declared. An object that gets there by a way that is not seen through here is turned
    /// away by the engine.
    pub fn note_freeze(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return };
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = hir[hir[call].callee].kind else { return };
        if name.is_none() || !matches!(self.atoms().bytes(name), b"freeze" | b"seal" | b"preventExtensions") {
            return;
        }
        let Some(frozen) = hir.ids(hir[call].args).next() else { return };
        if matches!(hir[frozen].kind, ExprKind::Spread(_) | ExprKind::Missing) {
            return;
        }
        let Some(sig) = self.resolved_signature(file, e).sig else { return };
        if !self.sig_decl(sig).is_some_and(|(declared_in, ..)| self.hir(declared_in).kind == FileKind::Declaration) {
            return;
        }
        // A literal is made as what it is checked against, which is the type of the parameter.
        let params = self.sig_params(sig);
        let frozen = [Some(self.type_of_expr(file, frozen)), self.param_type_at(&params, 0)];
        self.aot.flows.noted.frozen.extend(frozen.into_iter().flatten());
    }

    /// Hands over what has been noted to this checker, which starts anew: what is noted from here on does not depend on what was asked
    /// before.
    pub fn take_noted(&mut self) -> Noted {
        self.aot.flows.held_entering.clear();
        std::mem::take(&mut self.aot.flows.noted)
    }

    // ───────────────────────────── kinds of types ─────────────────────────────

    /// Whether a value of the type can be an object that the type says something of.
    fn may_hold_objects(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) => !self.has_primitive_flag(ty) && parts.iter().any(|&part| self.may_hold_objects(part)),
            // A primitive with a brand is the primitive.
            TypeData::Intersection(parts) => parts.iter().all(|&part| self.may_hold_objects(part)),
            TypeData::Ref { .. }
            | TypeData::Tuple { .. }
            | TypeData::Anon { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. }
            | TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Substitution { .. } => true,
            _ => false,
        }
    }

    /// Whether it is a type that says which properties its objects have, so that they can be laid out by it. Neither a union nor a type
    /// parameter: those stand for other types.
    fn says_properties(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { .. } => !self.is_array(ty),
            TypeData::Anon { origin, .. } => {
                matches!(origin, Origin::TypeLiteral(..) | Origin::Mapped(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..))
            }
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } | TypeData::Intersection(_) => true,
            _ => false,
        }
    }

    /// Not `{}`, which anything is.
    fn has_properties(&mut self, ty: TypeId) -> bool {
        self.members(ty).is_some_and(|members| !members.shape().props.is_empty())
    }

    /// Appends the types that say which properties an object has that is of type `ty`, or, with `in_arrays`, that is an element of an
    /// array of type `ty`, however deep. `seen`: what has been looked at, since a type may be made of itself: `type Json = string | Json[]`.
    fn add_object_types_in(&mut self, ty: TypeId, in_arrays: bool, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if !self.may_hold_objects(ty) || !seen.insert(ty) {
            return;
        }
        if let TypeData::Union(parts) = self.data(ty) {
            for &part in parts.iter() {
                self.add_object_types_in(part, in_arrays, seen, out);
            }
        } else if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.add_object_types_in(bound, in_arrays, seen, out);
        } else if self.is_array_or_tuple(ty) {
            if in_arrays {
                for &element in self.type_arguments(ty) {
                    self.add_object_types_in(element, in_arrays, seen, out);
                }
            }
        } else if let Some(element) = self.element_of_array_subtype(ty) {
            if in_arrays {
                self.add_object_types_in(element, in_arrays, seen, out);
            }
        } else if self.says_properties(ty) {
            out.push(self.laid_out_as(ty));
        }
    }

    // ───────────────────────────── what is not laid out ─────────────────────────────

    /// What the objects of the class or interface `sym` are, if what it extends says: an array, a function, an object of a class of the
    /// engine. No code of the program makes such an object by itself, so it is never laid out.
    fn root_of(&mut self, sym: Sym) -> Root {
        if self.aot.flows.roots.is_empty() {
            let others = [
                (known::Array, Root::Array),
                (known::ReadonlyArray, Root::Array),
                (known::Function, Root::Function),
                (known::CallableFunction, Root::Function),
                (known::NewableFunction, Root::Function),
            ];
            for (name, root) in others {
                if let Some(global) = self.global_type_symbol(name) {
                    self.aot.flows.roots.insert(global, root);
                }
            }
            for class in self.classes_of_the_engine() {
                self.aot.flows.roots.insert(class, Root::Class(class));
            }
        }
        if let Some(&known) = self.aot.flows.roots.get(&sym) {
            return known;
        }
        // What extends itself is an error, which has been reported.
        self.aot.flows.roots.insert(sym, Root::None);
        let is_called = self.files().decls_of(sym).iter().any(|&(file, decl)| {
            let hir = self.hir(file);
            matches!(decl, Decl::Interface(interface) if hir[interface].members.iter().any(|member| matches!(hir[member].kind, MemberKind::CallSignature | MemberKind::ConstructSignature)))
        });
        let mut root = if is_called { Root::Function } else { Root::None };
        for &base in self.base_types(sym).iter() {
            if root != Root::None {
                break;
            }
            if let TypeData::Ref { target, .. } = *self.data(base) {
                root = self.root_of(target);
            }
        }
        self.aot.flows.roots.insert(sym, root);
        root
    }

    /// As far as the program's library declares them.
    fn classes_of_the_engine(&self) -> Vec<Sym> {
        CLASSES_OF_THE_ENGINE.iter().filter_map(|name| self.global_type_symbol(self.atoms().intern(name))).collect()
    }

    /// `interface Failure extends Error { code: string }`, `interface Callback { (): void; label: string }`, `Buffer`, and `Int32Array & { 0:
    /// number }`, where the other types of the intersection only say more of the properties: what the objects of the type are, whatever
    /// more it says of them. `None`: nothing of the kind, or an array (`element_of_array_subtype`), or a class of the engine itself.
    pub fn built_in_extended_by(&mut self, ty: TypeId) -> Option<BuiltIn> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } if self.root_of(target) == Root::Class(target) => None,
            TypeData::Ref { .. } | TypeData::Intersection(_) => self.built_in_that_is(ty),
            _ => None,
        }
    }

    /// The same, where `ty` may be a class of the engine or the type of a function itself.
    fn built_in_that_is(&mut self, ty: TypeId) -> Option<BuiltIn> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => match self.root_of(target) {
                Root::Function => Some(BuiltIn::Function),
                Root::Class(class) if class == target => Some(BuiltIn::Instance(ty)),
                Root::Class(class) => {
                    let declared = self.declared_type(class);
                    Some(BuiltIn::Instance(self.permissive_instantiation(declared)))
                }
                _ => None,
            },
            TypeData::Intersection(ref parts) => parts.iter().find_map(|&part| self.built_in_that_is(part)),
            TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => Some(BuiltIn::Function),
            TypeData::Anon { origin: Origin::TypeLiteral(..), .. } => {
                let is_called = !self.signatures(ty, false).is_empty() || !self.signatures(ty, true).is_empty();
                is_called.then_some(BuiltIn::Function)
            }
            _ => None,
        }
    }

    /// The strings and the numbers that a value of the type can be, as far as the type names them. For strings and for numbers by
    /// themselves: all of them, or none if it can be others as well, as with `string`, a template literal type, or a type parameter.
    /// The type of a member of an enum names the value of the member. A numeric enum as a whole names nothing: flags are combined. In
    /// an order that only depends on what they are.
    pub fn literals_of_type(&mut self, ty: TypeId) -> Vec<Literal> {
        let (mut strings, mut numbers): (Vec<Atom>, Vec<f64>) = (Vec::new(), Vec::new());
        let (mut is_any_string, mut is_any_number) = (false, false);
        let parts = self.parts(ty);
        let mut enums: Vec<TypeId> = Vec::new();
        for &part in parts {
            match *self.data(part) {
                TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. } => strings.push(value),
                TypeData::NumberLit { bits, .. } => numbers.push(f64::from_bits(bits)),
                TypeData::EnumLit { member, value: EnumValue::Number(bits), .. } => {
                    let whole = self.enum_type_of_member(member);
                    if !enums.contains(&whole) {
                        enums.push(whole);
                    }
                    numbers.push(f64::from_bits(bits));
                }
                TypeData::Intrinsic(Intrinsic::String) | TypeData::Template { .. } | TypeData::StringMapping { .. } => is_any_string = true,
                TypeData::Intrinsic(Intrinsic::Number) | TypeData::Enum { .. } => is_any_number = true,
                // Neither a string nor a number.
                TypeData::Intrinsic(
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening | Intrinsic::BigInt | Intrinsic::Symbol | Intrinsic::Object,
                )
                | TypeData::BoolLit { .. }
                | TypeData::BigIntLit { .. }
                | TypeData::UniqueSymbol { .. }
                | TypeData::Ref { .. }
                | TypeData::Tuple { .. }
                | TypeData::Anon { .. }
                | TypeData::Fns { .. }
                | TypeData::Synth(_)
                | TypeData::ReverseMapped { .. } => {}
                _ => (is_any_string, is_any_number) = (true, true),
            }
        }
        if !is_any_number && !enums.is_empty() {
            let named: FxHashSet<TypeId> = parts.iter().copied().collect();
            for whole in enums {
                let members = self.parts(whole);
                is_any_number |= members.len() > 1 && members.len() <= named.len() && members.iter().all(|member| named.contains(member));
            }
        }
        let mut literals = Vec::new();
        if !is_any_string {
            strings.sort_unstable_by_key(|&value| self.atoms().bytes(value));
            strings.dedup();
            literals.extend(strings.into_iter().map(Literal::String));
        }
        if !is_any_number {
            numbers.sort_unstable_by(f64::total_cmp);
            numbers.dedup_by_key(|value| value.to_bits());
            literals.extend(numbers.into_iter().map(Literal::Number));
        }
        literals
    }

    /// The primitive types that are assignable to the object type `ty`: a string is a `{ length: number }`.
    pub fn primitives_of_type(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut primitives = Vec::new();
        for primitive in [TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL] {
            let wrapper = self.apparent_type(primitive);
            if self.has_the_names_of(wrapper, ty) && self.is_of_type(primitive, ty) {
                primitives.push(primitive);
            }
        }
        primitives
    }

    /// Whether `ty` has a property by every name that an object of type `view` cannot be without. If not, it is not assignable to it. The
    /// same as `add_candidates` finds out for many types at once.
    fn has_the_names_of(&mut self, ty: TypeId, view: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(view) {
            return parts.iter().all(|&part| self.has_the_names_of(ty, part));
        }
        let object = self.global_ref(known::Object, &[]);
        let (Some(of_type), Some(of_view), of_every_object) = (self.members(ty), self.members(view), self.members(object)) else { return false };
        let shape = of_view.shape();
        let mut is_weak = shape.index.is_empty();
        for prop in shape.props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
            is_weak = false;
            if of_type.resolved.prop(prop.name).is_none() && !of_every_object.is_some_and(|members| members.resolved.prop(prop.name).is_some()) {
                return false;
            }
        }
        !is_weak || shape.props.iter().any(|prop| of_type.resolved.prop(prop.name).is_some())
    }

    /// The type at `index` of the list has the properties of `ty`.
    fn add_names_of(&mut self, having: &mut Having, index: u32, ty: TypeId) {
        let Some(members) = self.members(ty) else { return };
        if having.indexable.last() != Some(&index) && (!members.shape().index.is_empty() || self.is_object_type_with_inferable_index(ty)) {
            having.indexable.push(index);
        }
        for prop in members.shape().props.iter() {
            let indexes = having.by_name.entry(prop.name).or_default();
            if indexes.last() != Some(&index) {
                indexes.push(index);
            }
        }
    }

    /// The types of the objects that are not laid out and that the program need not have got from anyone: arrays, functions, the objects of
    /// the classes of the engine, and whatever the program or the library of the language declares that is one of them and more. A class
    /// as a value and a function that has been given properties are among them. With `any` for type parameters.
    fn kinds_not_laid_out(&mut self, noted: &FxHashSet<TypeId>) -> (Vec<Kind>, Having) {
        let (mut kinds, mut having) = (Vec::new(), Having::default());
        let of_functions = [known::Function, known::CallableFunction, known::NewableFunction].map(|name| self.global_ref(name, &[]));
        let mut add = |c: &mut Self, kind: Kind, is_function: bool| {
            let ty = c.type_of_kind(kind);
            let index = kinds.len() as u32;
            kinds.push(kind);
            having.all.push(index);
            c.add_names_of(&mut having, index, ty);
            if is_function {
                for of_function in of_functions {
                    c.add_names_of(&mut having, index, of_function);
                }
            }
        };
        add(self, Kind::Arrays, false);
        add(self, Kind::Functions, true);
        for class in self.classes_of_the_engine() {
            add(self, Kind::InstancesOf(class), false);
        }
        let mut noted: Vec<TypeId> = noted.iter().copied().collect();
        noted.sort_unstable_by_key(|ty| ty.0);
        for ty in noted {
            let is_function = matches!(self.built_in_that_is(ty), Some(BuiltIn::Function));
            add(self, Kind::Of(ty), is_function);
        }
        let files = self.files();
        let mut seen: FxHashSet<Sym> = FxHashSet::default();
        for (file, module) in files.modules.iter().enumerate() {
            // What a package declares is let in where it is seen to come in. Of JavaScript nothing is declared.
            if module.hir.is_js || (module.hir.kind == FileKind::Declaration && !module.is_lib) {
                continue;
            }
            for (id, symbol) in module.bound.symbols.iter().enumerate() {
                let is_type = symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
                if !is_type && !(symbol.flags.intersects(SymFlags::FUNCTION | SymFlags::VARIABLE) && symbol.exports.is_some()) {
                    continue;
                }
                let sym = files.sym(FileId(file as u32), SymbolId(id as u32));
                if !seen.insert(sym) {
                    continue;
                }
                let root = if is_type { self.root_of(sym) } else { Root::None };
                if root != Root::None && root != Root::Class(sym) {
                    add(self, Kind::InstancesOf(sym), root == Root::Function);
                }
                // The class as a value, with what is static in it, and a function that has properties.
                if files.flags(sym).intersects(SymFlags::CLASS | SymFlags::FUNCTION | SymFlags::VARIABLE) && files.each_export(sym).len() != 0 {
                    let value = self.type_of_symbol(sym);
                    if self.has_properties(value) && !(self.signatures(value, false).is_empty() && self.signatures(value, true).is_empty()) {
                        add(self, Kind::ValueOf(sym), true);
                    }
                }
            }
        }
        (kinds, having)
    }

    fn type_of_kind(&mut self, kind: Kind) -> TypeId {
        let ty = match kind {
            Kind::Made(ty) => return ty,
            Kind::Of(ty) => ty,
            Kind::Arrays => return self.array_of(TypeId::ANY),
            Kind::Functions => return self.global_ref(known::Function, &[]),
            Kind::InstancesOf(sym) => self.declared_type(sym),
            Kind::ValueOf(sym) => self.type_of_symbol(sym),
        };
        self.permissive_instantiation(ty)
    }

    // ───────────────────────────── the relation ─────────────────────────────

    /// Whether an object that is made as `made` says is of type `view`, neither of them a union. That is the assignability relation. In
    /// either, a type parameter stands for anything: what generic code makes as a `Box<T>` is a `Box<string>` to whoever has called it
    /// with a string, and what it is handed as a `Box<T>` was made as a `Box<string>`.
    fn is_of_type(&mut self, made: TypeId, view: TypeId) -> bool {
        self.is_assignable(made, view) || ((self.has_type_variables(made) || self.has_type_variables(view)) && self.is_assignable_permissive(made, view))
    }

    /// Appends those of the types of `having` that have a property by every name that an object of type `view` cannot be without. No other
    /// is assignable to it. In no order, and some more than once.
    fn add_candidates(&mut self, having: &Having, view: TypeId, out: &mut Vec<u32>) {
        let Some(members) = self.members(view) else { return };
        let shape = members.shape();
        // The members of the global `Object`, which every object is taken to have.
        let object = self.global_ref(known::Object, &[]);
        let of_every_object = self.members(object);
        let mut is_weak = shape.index.is_empty();
        let mut required: Vec<&[u32]> = Vec::new();
        for prop in shape.props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
            is_weak = false;
            if of_every_object.is_some_and(|members| members.resolved.prop(prop.name).is_some()) {
                continue;
            }
            // Nobody has it.
            let Some(indexes) = having.by_name.get(&prop.name) else { return };
            required.push(indexes);
        }
        let Some(&rarest) = required.iter().min_by_key(|indexes| indexes.len()) else {
            // A type all of whose properties are optional takes what has one of them.
            // One with an index signature takes what has one or can be taken to: no class, no interface. `[key: string]: any` takes all,
            // and so may a type parameter, which stands for anything.
            let takes_any = shape.index.iter().any(|info| info.key == TypeId::STRING && self.instantiate(info.value, members.mapper).is_any());
            if is_weak {
                out.extend(shape.props.iter().filter_map(|prop| having.by_name.get(&prop.name)).flatten());
            } else if shape.index.is_empty() || takes_any || self.has_type_variables(view) {
                out.extend_from_slice(&having.all);
            } else {
                out.extend_from_slice(&having.indexable);
            }
            return;
        };
        out.extend(rarest.iter().filter(|candidate| required.iter().all(|indexes| indexes.binary_search(candidate).is_ok())));
    }

    /// `{ title?: string; [key: string]: any }` takes every object that has no property by one of its names: nothing is required, nothing
    /// can be of the wrong type, and the index signature takes anything. The relation need not be asked, and it would be asked about
    /// every type that objects are made as. If `view` is such a type: those of `having` that do have a property by one of its names,
    /// ascending.
    fn sharing_a_name_if_the_rest_is_taken(&mut self, having: &Having, view: TypeId) -> Option<Vec<u32>> {
        if matches!(self.data(view), TypeData::Intersection(_)) || self.has_type_variables(view) {
            return None;
        }
        let members = self.members(view)?;
        let shape = members.shape();
        let [info] = shape.index[..] else { return None };
        if info.key != TypeId::STRING || !self.instantiate(info.value, members.mapper).is_any() || shape.props.iter().any(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
            return None;
        }
        let mut sharing: Vec<u32> = shape.props.iter().filter_map(|prop| having.by_name.get(&prop.name)).flatten().copied().collect();
        sharing.sort_unstable();
        sharing.dedup();
        Some(sharing)
    }

    // ───────────────────────────── the whole program ─────────────────────────────

    /// The views that what is held to one of `roots` gets into, if it is plain data: those, the types of their fields, and so on all the
    /// way down, through arrays. Not what the fields of a class hold: plain data is no object of a class. `index_of`: of the views. Each
    /// with the first of the places of the roots it is come by from.
    fn views_held_within(&mut self, roots: impl Iterator<Item = (TypeId, Place)>, index_of: &FxHashMap<TypeId, u32>) -> FxHashMap<TypeId, Place> {
        let mut roots: Vec<(TypeId, Place)> = roots.collect();
        roots.sort_unstable_by_key(|root| root.1);
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        let mut held: FxHashMap<TypeId, Place> = FxHashMap::default();
        for (root, at) in roots {
            let mut pending = vec![root];
            while let Some(ty) = pending.pop() {
                if !index_of.contains_key(&ty) || held.contains_key(&ty) {
                    continue;
                }
                held.insert(ty, at);
                if self.is_type_of_instances(ty) {
                    continue;
                }
                let Some(members) = self.members(ty) else { continue };
                for prop in members.shape().props.iter() {
                    let of_field = self.type_of_prop(prop, members.mapper);
                    self.add_object_types_in(of_field, true, &mut seen, &mut pending);
                }
            }
        }
        held
    }

    /// Once everything is translated: what holds of each of `views`, the types that say how the objects of the program are laid out, no
    /// two of them the same. The whole program is looked at here and nowhere else. What comes of it depends on what is in the sets and
    /// on the order of the views, and on nothing else.
    ///
    /// It is three steps, of which the second is nearly all the work and can be shared out. This is the first: which objects can be of
    /// which views going by the names of their properties. What is left are questions that stand by themselves. Any number of
    /// checkers of the program may `answer` any slices of `Questions::all`, if the views are published. The answers, in the order of
    /// the questions, go to `Questions::close`, which asks no checker.
    pub fn questions_about_views(&mut self, mut noted: Noted, views: &[TypeId]) -> Questions {
        let mut index_of: FxHashMap<TypeId, u32> = FxHashMap::default();
        for (index, &view) in views.iter().enumerate() {
            index_of.entry(view).or_insert(index as u32);
        }
        // Plain data is copied into the layout of the type it is cast to, and what it holds into the layouts of the types of the fields.
        // So objects are made as those.
        let copied_into = self.views_held_within(noted.copied_into.iter().map(|&ty| (ty, Place::NOWHERE)), &index_of);
        noted.allocated.extend(copied_into.into_keys().filter(|&ty| !self.is_type_of_instances(ty)));
        let untyped_into = self.views_held_within(noted.untyped_into.iter().map(|(&ty, &at)| (ty, at)), &index_of);

        let mut made = Having::default();
        for (index, &view) in views.iter().enumerate() {
            if noted.allocated.contains(&view) {
                made.all.push(index as u32);
                self.add_names_of(&mut made, index as u32, view);
            }
        }

        // What is frozen is asked about like a view, whether or not anything is looked at as it.
        let mut asked: Vec<TypeId> = views.to_vec();
        let mut frozen: Vec<TypeId> = Vec::new();
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        for &ty in &noted.frozen {
            self.add_object_types_in(ty, false, &mut seen, &mut frozen);
        }
        for &ty in &frozen {
            index_of.entry(ty).or_insert_with(|| {
                asked.push(ty);
                asked.len() as u32 - 1
            });
        }

        let mut questions: Vec<Question> = Vec::new();
        let mut answered = 0;
        let mut members: Vec<Vec<u32>> = Vec::with_capacity(asked.len());
        let mut candidates: Vec<u32> = Vec::new();
        for (index, &view) in asked.iter().enumerate() {
            candidates.clear();
            self.add_candidates(&made, view, &mut candidates);
            candidates.sort_unstable();
            candidates.dedup();
            let sharing_a_name = self.sharing_a_name_if_the_rest_is_taken(&made, view);
            let mut known = Vec::new();
            for &candidate in candidates.iter().filter(|&&candidate| candidate as usize != index) {
                let made_as = views[candidate as usize];
                if sharing_a_name.as_ref().is_some_and(|sharing| sharing.binary_search(&candidate).is_err()) && !self.has_type_variables(made_as) {
                    known.push(candidate);
                    continue;
                }
                if index < views.len() {
                    questions.push(Question { kind: Kind::Made(made_as), view, about: (index as u32, candidate) });
                    continue;
                }
                // No other checker need know the type.
                answered += 1;
                if self.is_of_type(made_as, view) {
                    known.push(candidate);
                }
            }
            // It is a member of itself, whatever it is.
            if made.all.binary_search(&(index as u32)).is_ok() {
                known.push(index as u32);
            }
            members.push(known);
        }

        // An object that is not laid out is in a place of the type where it has been seen to get there, and may be where the program
        // holds a value to the type of which its text says nothing, if there is such an object that is of the type.
        let why_foreign: Vec<Option<WhyForeign>> = views.iter().map(|view| noted.foreign.get(view).map(|&(source, at)| WhyForeign::Seen { source, at })).collect();
        let untyped_at: Vec<Place> = views.iter().map(|view| untyped_into.get(view).copied().unwrap_or(Place::NOWHERE)).collect();
        let (others, having) = if untyped_into.is_empty() { Default::default() } else { self.kinds_not_laid_out(&noted.not_laid_out) };
        for (index, &view) in views.iter().enumerate() {
            if why_foreign[index].is_some() || !untyped_into.contains_key(&view) {
                continue;
            }
            candidates.clear();
            self.add_candidates(&having, view, &mut candidates);
            candidates.sort_unstable();
            candidates.dedup();
            questions.extend(candidates.iter().map(|&candidate| Question { kind: others[candidate as usize], view, about: (index as u32, u32::MAX) }));
        }

        let mut upcasts: Vec<(u32, u32, Place)> = noted.upcasts.iter().filter_map(|(&(from, to), &at)| Some((*index_of.get(&from)?, *index_of.get(&to)?, at))).collect();
        upcasts.sort_unstable();
        let mut casts: Vec<(u32, u32)> = noted.casts.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        casts.sort_unstable();
        let mut frozen: Vec<u32> = frozen.iter().map(|ty| index_of[ty]).collect();
        frozen.sort_unstable();
        Questions {
            questions,
            answered,
            number_of_views: views.len(),
            members,
            why_foreign,
            untyped_at,
            allocated: made.all,
            frozen,
            upcasts,
            casts,
        }
    }

    /// The second step: the answers to the questions, in their order. Of the questions of a slice whether a view admits an object that is
    /// not laid out, those after the first yes are not gone into and answered no: one yes is all that counts.
    pub fn answer(&mut self, questions: &[Question]) -> Vec<bool> {
        let mut admitting = None;
        let mut answers = Vec::with_capacity(questions.len());
        for question in questions {
            answers.push(match question.kind {
                Kind::Made(made) => self.is_of_type(made, question.view),
                _ if admitting == Some(question.view) => false,
                kind => {
                    let other = self.type_of_kind(kind);
                    let is_admitted = self.is_of_type(other, question.view);
                    if is_admitted {
                        admitting = Some(question.view);
                    }
                    is_admitted
                }
            });
        }
        answers
    }

    // ───────────────────────────── why ─────────────────────────────

    /// A line for each of `views` that admits objects that are not laid out, in their order: the view, and how it has come to that, back to
    /// where such an object was let in or something untyped was held to a view.
    pub fn explain_foreign(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let mut lines = Vec::new();
        for (index, &view) in views.iter().enumerate() {
            let mut why = membership.why_foreign[index];
            if why.is_none() {
                continue;
            }
            let mut line = format!("foreign: {}: ", self.name_for_people(view));
            while let Some(reason) = why.take() {
                match reason {
                    WhyForeign::Seen { source, at } => {
                        let source = source.map_or_else(|| "a type that nobody has kept".to_owned(), |source| self.name_for_people(source));
                        line += &format!("seen: {source} at {}", self.place_for_people(at));
                    }
                    WhyForeign::Untyped { at, candidate } => {
                        let candidate = self.type_of_kind(candidate.0);
                        line += &format!("untyped: something untyped is held to it at {}, and {} is of the type", self.place_for_people(at), self.name_for_people(candidate));
                    }
                    WhyForeign::Inherited { from, at } => {
                        line += &format!("inherited from {} over an upcast noted at {}; which is ", self.name_for_people(views[from as usize]), self.place_for_people(at));
                        why = membership.why_foreign[from as usize];
                    }
                }
            }
            lines.push(line);
        }
        lines
    }

    /// A line for each of `views` that has members only because a test has been left out, in their order: how many, and from where, the
    /// most first.
    pub fn explain_members(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let mut lines = Vec::new();
        for of_view in membership.added_over.chunk_by(|a, b| a.view == b.view) {
            let total: u32 = of_view.iter().map(|added| added.members).sum();
            let mut line = format!("members: {}: {total} added", self.name_for_people(views[of_view[0].view as usize]));
            for added in of_view {
                line += &match added.from {
                    Some((from, at)) => format!("; {} of {} over an upcast noted at {}", added.members, self.name_for_people(views[from as usize]), self.place_for_people(at)),
                    None => format!("; {} that a cast may turn a member into", added.members),
                };
            }
            lines.push(line);
        }
        lines
    }

    fn name_for_people(&mut self, ty: TypeId) -> String {
        const MOST: usize = 72;
        let text = self.type_to_string(ty);
        let text = String::from_utf8_lossy(&text);
        if text.chars().count() <= MOST { text.into_owned() } else { text.chars().take(MOST).chain(" ..".chars()).collect() }
    }

    fn place_for_people(&self, at: Place) -> String {
        if at == Place::NOWHERE {
            return "no place in the source".to_owned();
        }
        let name = self.files().module(at.file).file_name();
        let name = name.rsplit(|&byte| byte == b'/').next().unwrap_or(name);
        let text = &self.hir(at.file).text;
        let line = text[..(at.pos as usize).min(text.len())].iter().filter(|&&byte| byte == b'\n').count() + 1;
        format!("{}:{line}", String::from_utf8_lossy(name))
    }
}

impl Questions {
    pub fn all(&self) -> &[Question] {
        &self.questions
    }

    /// The third step. `answers`: to `all`, in that order.
    pub fn close(self, answers: &[bool]) -> Membership {
        let Questions { questions, answered, number_of_views, mut members, mut why_foreign, untyped_at, allocated, frozen, upcasts, casts } = self;
        debug_assert_eq!(questions.len(), answers.len());
        for (question, _) in questions.iter().zip(answers).filter(|&(_, &is_so)| is_so) {
            let (view, made) = question.about;
            match question.kind {
                Kind::Made(_) => members[view as usize].push(made),
                // The first yes is the same however the questions were shared out: nothing before it is left out.
                kind => _ = why_foreign[view as usize].get_or_insert(WhyForeign::Untyped { at: untyped_at[view as usize], candidate: Candidate(kind) }),
            }
        }
        for of_view in &mut members {
            of_view.sort_unstable();
        }

        // From here on a set of what is made is a row of bits, one for each of `allocated`, in that order.
        let words = allocated.len().div_ceil(64);
        let mut place_of = vec![u32::MAX; members.len()];
        for (place, &made) in allocated.iter().enumerate() {
            place_of[made as usize] = place as u32;
        }
        let mut sets = vec![0u64; members.len() * words];
        for (index, of_view) in members.iter().enumerate() {
            for &member in of_view {
                let place = place_of[member as usize] as usize;
                sets[index * words + place / 64] |= 1 << (place % 64);
            }
        }
        let has = |sets: &[u64], index: usize, place: usize| sets[index * words + place / 64] >> (place % 64) & 1 != 0;
        let number_in = |sets: &[u64]| sets.iter().map(|word| word.count_ones() as usize).sum::<usize>();
        let number_at_first = number_in(&sets);
        let mut becomes = vec![0u64; allocated.len() * words];
        let mut gathered = vec![0u64; words];
        let (mut added_over_upcast, mut added_by_casts) = (vec![0u32; upcasts.len()], vec![0u32; members.len()]);
        loop {
            let mut is_changed = false;
            // What is in a place of the one type gets into places of the other untested, so it had better be a member there.
            for (&(from, to, at), added) in upcasts.iter().zip(&mut added_over_upcast) {
                let (from, to) = (from as usize, to as usize);
                for word in 0..words {
                    let both = sets[to * words + word] | sets[from * words + word];
                    *added += (both ^ sets[to * words + word]).count_ones();
                    is_changed |= both != sets[to * words + word];
                    sets[to * words + word] = both;
                }
                if why_foreign[from].is_some() && why_foreign[to].is_none() {
                    why_foreign[to] = Some(WhyForeign::Inherited { from: from as u32, at });
                    is_changed = true;
                }
            }
            // What is looked at as `source` was made as one of its members. The cast can make it a `target` where it is, if that is in
            // turn a member of what it was made as: it has all its fields.
            for &(source, target) in &casts {
                let target = place_of[target as usize] as usize;
                if target == u32::MAX as usize {
                    continue;
                }
                for member in places_in(&sets[source as usize * words..][..words]) {
                    if member != target && has(&sets, allocated[member] as usize, target) {
                        becomes[member * words + target / 64] |= 1 << (target % 64);
                    }
                }
            }
            // It stays in the places it is in.
            for index in 0..members.len() {
                gathered.fill(0);
                for member in places_in(&sets[index * words..][..words]) {
                    for word in 0..words {
                        gathered[word] |= becomes[member * words + word];
                    }
                }
                for word in 0..words {
                    let both = sets[index * words + word] | gathered[word];
                    added_by_casts[index] += (both ^ sets[index * words + word]).count_ones();
                    is_changed |= both != sets[index * words + word];
                    sets[index * words + word] = both;
                }
            }
            if !is_changed {
                break;
            }
        }
        let members_added = number_in(&sets) - number_at_first;
        let views_in = |row: &[u64]| places_in(row).map(|place| allocated[place]).collect::<Vec<u32>>();
        for (index, of_view) in members.iter_mut().enumerate() {
            *of_view = views_in(&sets[index * words..][..words]);
        }
        let mut specializations: Vec<Vec<u32>> = vec![Vec::new(); number_of_views];
        for (place, &made) in allocated.iter().enumerate() {
            specializations[made as usize] = views_in(&becomes[place * words..][..words]);
        }

        let mut reached: Vec<Reach> = Vec::new();
        reached.resize_with(number_of_views, Reach::default);
        for &ty in &frozen {
            for &member in &members[ty as usize] {
                reached[member as usize].may_be_frozen = true;
            }
        }
        for &index in &allocated {
            reached[index as usize].is_allocated = true;
        }
        for (((reach, members), specializations), why_foreign) in reached.iter_mut().zip(members).zip(specializations).zip(&why_foreign) {
            reach.members = members;
            reach.specializations = specializations;
            reach.admits_foreign = why_foreign.is_some();
        }
        let over_upcasts = upcasts.iter().zip(added_over_upcast).map(|(&(from, to, at), members)| AddedOver { view: to, from: Some((from, at)), members });
        let by_casts = added_by_casts.into_iter().take(number_of_views).enumerate().map(|(view, members)| AddedOver { view: view as u32, from: None, members });
        let mut added_over: Vec<AddedOver> = over_upcasts.chain(by_casts).filter(|added| added.members != 0).collect();
        added_over.sort_by_key(|added| (added.view, std::cmp::Reverse(added.members), added.from));
        Membership { views: reached, pairs_asked: questions.len() + answered, members_added, why_foreign, added_over }
    }
}
