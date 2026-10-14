//! Which objects are of which types.
//!
//! Compiled code looks at an object as a type says, a view, and tests nothing that the type says. So of every view it has to be known
//! which objects can be in its places: its subtypes, which are layouts that objects are made as. Those are the layouts that some flow of
//! the program brings there: see `subtypes.rs`. Here is what is noted of the flows while the program is translated, and the relation
//! that a cast goes by: whether an object that is made as one type says is of another type.
//!
//! What has to agree for that is the names and the kinds of the properties. Their types need not, as far as memory goes: a field that
//! several views share is kept as the widest of them says, and a read through a narrower one is tested. So generic code, which is
//! compiled once for all its instantiations, is dealt with by letting a type parameter of a VIEW stand for anything: whatever it is
//! handed will do. What it MAKES goes by the bounds of its type parameters, as assignability has it: a `Token<TKind>` is no
//! `Token<SyntaxKind.AsteriskToken>` until the test on the way out of the generic code has made it one.
//!
//! Not every object is laid out: an array, a function, a `Map`, what the host or a package makes. Those are assignable to types of the
//! program as well, `{ length: number }` for one. A view that such an object is seen to enter, or may enter where the program holds a
//! value to it of which its text says nothing, admits foreign objects, which costs every access through it a test and a general path.
//!
//! **A property that no code of the program ever stores does not exist.** `_expressionBrand: any` is declared so that the checker tells an
//! `Expression` from a `Node`. No object has it, so none can be required to, and it gets no slot. Which names are stored is known when
//! the program is linked. From then on the relation leaves the others out of what it compares an object with, at every depth
//! (`Relation::AssignableAsStored`). While the program is translated it leaves out nothing: a test more is made, which the object passes
//! when the program runs, because that goes by the members found here.
//!
//! Whoever translates the program reports what objects are made as, what is cast to what, and where it has left out a
//! test because the one type is assignable to the other. All of it is sets. What follows is worked out once, when all are in:
//! `begin_subtypes`.

use crate::atom::{Atom, known};
use crate::bind::{Decl, Flow, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::{Checker, ContextFlags, Program};
use crate::check::relate::Relation;
use crate::check::task::Finished;
use super::identity::Identity;
use super::callees::Callee;
use super::subtypes::{self, AlteredViews, Cause, Facts, FieldTypes, Gathered, OpensForTheLog, Sizes, Subtypes};
use super::creation::Creations;
use super::alterations::{Alteration, DoorsCounted, NUMBER_OF_OPERANDS, UntypedAlterations, WidestAlterations};
use super::escape_closure::Escapes;
use super::first_stores::Constructions;
use super::storage::Made;
use crate::hir::{BinOp, Chain, ClassId, ExprId, ExprKind, ExprTag, FileKind, FnId, MappedModifier, MemberKind, PatKind, PropKey, PropKind, TypeNodeId, TypeNodeKind, UnOp};
use crate::program::{FileId, Sym};
use crate::types::{ComponentsId, EnumValue, Follow, Intrinsic, MapperId, Origin, Prop, PropFlags, PropSource, Shape, SigId, TypeData, TypeId, Visitor};
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex, PoisonError, RwLock};

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

const MOST_INSTANTIATIONS_LOOKED_INTO: u32 = 8;

const MOST_INSTANTIATIONS_LOOKED_INTO_AT_ALL: u32 = 2048;

const MOST_LEVELS_LOOKED_INTO: u32 = 256;

const MOST_PROPERTIES_OF_A_RECORD_THAT_IS_TURNED_WHERE_IT_LIES: usize = 6;

const MOST_TYPES_THAT_CROSS_FROM_ONE_PLACE: u32 = 1 << 16;

pub struct GaveUp {
    rank: (u8, u32, u32),
    pub typed_side: FileId,
    pub name: String,
    pub place: String,
}

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
/// (`laid_out_as`), but for `not_laid_out`. `T`: what a type is called by. What costs something comes with the first place in
/// the program that it was noted at, so that it can be said why.
pub struct Noted<T = TypeId> {
    /// What an allocation site makes.
    allocated_at_site: FxHashSet<T>,
    /// What plain data is cast to, which makes a copy of it.
    copied_into: FxHashSet<T>,
    /// An object that is looked at as the first type says is looked at as the second says from somewhere on, and no test is made there.
    upcasts: FxHashMap<(T, T), Place>,
    /// An object that is looked at as the first type says is cast to the second, by `as`, by a place whose type is written down or by a type
    /// guard: it passes, the cast turns it into one where it is, admits it as it is, or refuses it. Which, is found at the link.
    casts: FxHashSet<(T, T)>,
    /// Those of them that are type guards: they make no copy of plain data.
    guards: FxHashSet<(T, T)>,
    /// Those of them that the program forces, `x as unknown as T`, here or inside generic code that the cast is at the way out of: they refuse nothing.
    forced: FxHashSet<(T, T)>,
    /// The same, but it is only made sure that it is one: it passes or it does not.
    tests: FxHashSet<(T, T)>,
    /// A value that the operations say nothing of is held to it: an element, what an indirect or a generic call yields, an argument of
    /// whoever calls a function without knowing it.
    vouched_into: FxHashMap<T, Place>,
    /// An object that is not laid out, of a type that is assignable to this one, is let into a place of it, and no test is made there.
    /// With the type of the object.
    foreign: FxHashMap<T, (Option<T>, Place)>,
    /// The value of an expression whose type says nothing of it, `any`, `unknown`, `object`, `{}`, is held to it.
    untyped_into: FxHashMap<T, Place>,
    checked_into: FxHashMap<T, Place>,
    checked_by_road: [usize; 7],
    /// Types that no declaration names and whose objects are not laid out: `(() => number) & { unit: string }`, `number[] & { tag: string }`.
    not_laid_out: FxHashSet<T>,
    cut_short: FxHashMap<Place, [u32; 4]>,
    most_looked_into: [u32; 3],
    /// By field, which is a layout and a name: the functions whose closures the allocation sites of the layout store there.
    callees_at_birth: FxHashMap<(T, Atom), Callee>,
    /// The same for the stores through a supertype, which reach the objects of every subtype.
    callees_stored: FxHashMap<(T, Atom), Callee>,
    /// Which fields objects get right after their allocation: see `creation.rs`.
    creations: Creations<T>,
    /// The constructor functions: see `first_stores.rs`.
    constructions: Constructions<T>,
    escapes: Escapes<T>,
}

fn join_callee<K: Eq + Hash>(callees: &mut FxHashMap<K, Callee>, place: K, callee: Callee) {
    let joined = callees.entry(place).or_default();
    *joined = joined.join(callee);
}

impl<T> Default for Noted<T> {
    fn default() -> Noted<T> {
        Noted {
            allocated_at_site: FxHashSet::default(),
            copied_into: FxHashSet::default(),
            upcasts: FxHashMap::default(),
            casts: FxHashSet::default(),
            guards: FxHashSet::default(),
            forced: FxHashSet::default(),
            tests: FxHashSet::default(),
            vouched_into: FxHashMap::default(),
            foreign: FxHashMap::default(),
            untyped_into: FxHashMap::default(),
            checked_into: FxHashMap::default(),
            checked_by_road: [0; 7],
            not_laid_out: FxHashSet::default(),
            cut_short: FxHashMap::default(),
            most_looked_into: [0; 3],
            callees_at_birth: FxHashMap::default(),
            callees_stored: FxHashMap::default(),
            creations: Creations::default(),
            constructions: Constructions::default(),
            escapes: Escapes::default(),
        }
    }
}

impl<T: Copy + Eq + Hash> Noted<T> {
    pub fn has_alterations(&self) -> bool {
        self.escapes.alterations.is_some()
    }

    pub fn absorb_evidence_of_strangers(&mut self, other: &Noted<T>) {
        if let Some(noted) = &other.escapes.alterations {
            self.escapes.alterations.get_or_insert_with(Default::default).absorb_evidence_of_strangers(noted);
        }
    }

    pub fn evidence_of_strangers(&self) -> (Vec<T>, Vec<T>, Vec<T>) {
        self.escapes.with_alterations(|noted| (noted.let_out(), noted.entered_by_strangers(), noted.entered_if_let_out()))
    }

    /// Adds what has been noted elsewhere, in terms of the same names for the types.
    pub fn absorb(&mut self, other: Noted<T>) {
        self.allocated_at_site.extend(other.allocated_at_site);
        self.copied_into.extend(other.copied_into);
        self.casts.extend(other.casts);
        self.guards.extend(other.guards);
        self.forced.extend(other.forced);
        self.tests.extend(other.tests);
        self.not_laid_out.extend(other.not_laid_out);
        for (at, times) in other.cut_short {
            for (sum, more) in self.cut_short.entry(at).or_default().iter_mut().zip(times) {
                *sum += more;
            }
        }
        for (most, other) in self.most_looked_into.iter_mut().zip(other.most_looked_into) {
            *most = (*most).max(other);
        }
        self.creations.absorb(other.creations);
        self.constructions.absorb(other.constructions);
        self.escapes.absorb(other.escapes);
        for (upcast, at) in other.upcasts {
            self.add_upcast(upcast, at);
        }
        for (view, (source, at)) in other.foreign {
            self.add_foreign(view, source, at);
        }
        for (view, at) in other.checked_into {
            self.add_check(view, at);
        }
        for (sum, more) in self.checked_by_road.iter_mut().zip(other.checked_by_road) {
            *sum += more;
        }
        for (view, at) in other.untyped_into {
            self.add_untyped_inflow(view, at);
        }
        for (view, at) in other.vouched_into {
            self.add_vouched_inflow(view, at);
        }
        for (field, callee) in other.callees_at_birth {
            join_callee(&mut self.callees_at_birth, field, callee);
        }
        for (field, callee) in other.callees_stored {
            join_callee(&mut self.callees_stored, field, callee);
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

    fn add_check(&mut self, view: T, at: Place) {
        let first = self.checked_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn add_untyped_inflow(&mut self, view: T, at: Place) {
        let first = self.untyped_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    fn add_vouched_inflow(&mut self, view: T, at: Place) {
        let first = self.vouched_into.entry(view).or_insert(at);
        *first = at.min(*first);
    }

    /// The same in terms of other names for the types. What `rename` has no name for is left out, a pair if either has none.
    pub fn renamed<U: Copy + Eq + Hash>(self, mut rename: impl FnMut(T) -> Option<U>) -> Noted<U> {
        let mut each = |types: FxHashSet<T>| -> FxHashSet<U> { types.into_iter().filter_map(&mut rename).collect() };
        let (copied_into, not_laid_out) = (each(self.copied_into), each(self.not_laid_out));
        let allocated_at_site = each(self.allocated_at_site);
        let casts = self.casts.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let guards = self.guards.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let forced = self.forced.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let tests = self.tests.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let upcasts = self.upcasts.into_iter().filter_map(|((from, to), at)| Some(((rename(from)?, rename(to)?), at))).collect();
        let foreign = self.foreign.into_iter().filter_map(|(view, (source, at))| Some((rename(view)?, (source.and_then(&mut rename), at)))).collect();
        let untyped_into = self.untyped_into.into_iter().filter_map(|(view, at)| Some((rename(view)?, at))).collect();
        let checked_into = self.checked_into.into_iter().filter_map(|(view, at)| Some((rename(view)?, at))).collect();
        let vouched_into = self.vouched_into.into_iter().filter_map(|(view, at)| Some((rename(view)?, at))).collect();
        let mut of_fields = |callees: FxHashMap<(T, Atom), Callee>| -> FxHashMap<(U, Atom), Callee> {
            let mut renamed = FxHashMap::default();
            for ((holder, name), callee) in callees {
                if let Some(holder) = rename(holder) {
                    join_callee(&mut renamed, (holder, name), callee);
                }
            }
            renamed
        };
        let (callees_at_birth, callees_stored) = (of_fields(self.callees_at_birth), of_fields(self.callees_stored));
        let creations = self.creations.renamed(&mut rename);
        let constructions = self.constructions.renamed(&mut rename);
        let escapes = self.escapes.renamed(&mut rename);
        Noted { allocated_at_site, copied_into, upcasts, casts, guards, forced, tests, vouched_into, foreign, untyped_into, checked_into, checked_by_road: self.checked_by_road, not_laid_out, cut_short: self.cut_short, most_looked_into: self.most_looked_into, callees_at_birth, callees_stored, creations, constructions, escapes }
    }
}

/// What the objects of a class or an interface are that are not laid out whoever declares it, because of what it extends.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Root {
    None,
    Array,
    /// It extends `Function`, or it can be called or constructed.
    Function,
    /// A declaration file of a package says that it can be called or constructed. That is a declaration without a body, which nothing is held to: what `memo(C)` yields is a
    /// plain object, `Fragment` a symbol.
    Claimed,
    /// A class of the engine.
    Class(Sym),
}

/// The same, for whoever describes the type.
pub enum BuiltIn {
    Function,
    /// Anything: see `Root::Claimed`.
    Claimed,
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
    /// What `is_provably_assignable` has given up on.
    pub(super) cut_short: FxHashSet<(TypeId, TypeId, u8)>,
    pub(super) times_not_known: usize,
    /// `root_of`, as far as it has been asked. Arrays, functions and the classes of the engine are in it from the first time on.
    roots: FxHashMap<Sym, Root>,
    /// What is being translated: see `note_place`.
    place: Place,
    /// What `types_held_entering` has been asked.
    held_entering: FxHashSet<(TypeId, TypeId)>,
    looked_into: Vec<((Applied, Applied), [u32; 2])>,
    not_looked_into: FxHashSet<(TypeId, bool)>,
    levels_looked_into: u32,
    /// `find_applications_in`, as far as it has been asked.
    applications: FxHashMap<TypeId, Vec<(Applied, u32)>>,
    beyond_the_layouts: FxHashMap<TypeId, bool>,
    /// Once the program is linked: a bit for every published name, by its number. Set: some code of the program stores a property by it.
    stored: Option<std::sync::Arc<Vec<u64>>>,
    /// Cache of `canonical_type`.
    canonical: FxHashMap<TypeId, TypeId>,
    laid_out: FxHashMap<TypeId, TypeId>,
    first_of_structure: FxHashMap<Identity, TypeId>,
    nested_too_deeply: FxHashMap<TypeId, bool>,
    with_room_for_what_nothing_is_said_of: FxHashMap<TypeId, bool>,
    seen_before: Option<Arc<FxHashSet<Identity>>>,
    finding_canonical: u32,
    pub(super) objects_of: FxHashMap<TypeId, std::rc::Rc<super::alterations::ObjectsOf>>,
    pub(super) carried: FxHashMap<(TypeId, TypeId), std::rc::Rc<[(TypeId, TypeId)]>>,
    pub(super) saying_nothing_of_objects: FxHashMap<TypeId, bool>,
    pub(super) takes_primitives_by_itself: FxHashMap<TypeId, bool>,
    pub(super) function_types: Option<[TypeId; 3]>,
    /// `is_tainted`, as far as it has been asked.
    tainted: FxHashMap<TypeId, bool>,
    with_tainted_part: FxHashMap<TypeId, bool>,
    being_asked_of_taint: u32,
    /// This checker is at the search from the doors. While it is, no type is tainted.
    is_searching_from_doors: bool,
    is_crossing_bounded: bool,
    crossing_from_one_place: u32,
    gave_up_crossing: Option<GaveUp>,
    /// For the search: the untyped files that a tool has made of a TypeScript file which is still in the program, checked, and only declares (`P.tsx.js` of `P.tsx`), and those TypeScript files.
    made_of_checked_text: FxHashSet<FileId>,
    checked_texts: FxHashSet<FileId>,
    pairs_compared: FxHashSet<(TypeId, TypeId, bool)>,
    given_and_kept_by_nobody: Vec<Vec<Atom>>,
}

/// What the search from the doors has found, as every task reads it: it mentions no type by its number. It follows from the program alone, so that it does not matter which task has made it.
#[derive(Default, Clone)]
pub(super) struct Given {
    went_on_by_pairs: bool,
    identities: FxHashSet<Identity>,
    names: FxHashMap<Identity, Vec<Box<[u8]>>>,
    /// Of those that have properties: by name, `said_by` what the property holds. A name is its text: a text first seen during the check is an atom of the task that has seen it, and another task has another text by that number.
    properties: Vec<FxHashMap<Box<[u8]>, Said>>,
    /// By name of a property: the indexes in `properties` of those that have it.
    by_name: FxHashMap<Box<[u8]>, Vec<u32>>,
}

/// Whether the name is that of a property keyed by a symbol, `{ readonly [brand]: "h" }`. No data has such a property, and nothing is laid out by a type that has one: it is left out of the names a type is known by.
fn is_keyed_by_symbol(name: &[u8]) -> bool {
    name.first() == Some(&0xFE)
}

/// What is read off the type of a property: `Checker::said_by`.
#[derive(Clone, PartialEq, Eq, Hash)]
struct Said {
    kinds: u16,
    /// The strings and the numbers that it can be, each kind by itself, if the type names them all: a discriminant. Empty: it can be others. By text and by bits: nothing that is numbered by task. In order.
    strings: Vec<Box<[u8]>>,
    numbers: Vec<u64>,
}

impl Said {
    /// Whether a type that says this may be assignable to one that says `taken`.
    fn may_fit(&self, taken: &Said) -> bool {
        if !said::may_fit(self.kinds, taken.kinds) {
            return false;
        }
        if (self.kinds | taken.kinds) & said::ANYTHING != 0 {
            return true;
        }
        (self.kinds & said::STRING == 0 || taken.strings.is_empty() || !self.strings.is_empty() && self.strings.iter().all(|text| taken.strings.contains(text)))
            && (self.kinds & said::NUMBER == 0 || taken.numbers.is_empty() || !self.numbers.is_empty() && self.numbers.iter().all(|bits| taken.numbers.contains(bits)))
    }
}

/// `Checker::kinds_said_by`
mod said {
    pub(super) const TRUE: u16 = 1;
    pub(super) const FALSE: u16 = 1 << 1;
    pub(super) const NUMBER: u16 = 1 << 2;
    pub(super) const STRING: u16 = 1 << 3;
    pub(super) const BIGINT: u16 = 1 << 4;
    pub(super) const SYMBOL: u16 = 1 << 5;
    /// Objects that are neither of the two below.
    pub(super) const RECORDS: u16 = 1 << 6;
    pub(super) const ARRAYS: u16 = 1 << 7;
    pub(super) const FUNCTIONS: u16 = 1 << 8;
    /// Nothing is read off the type.
    pub(super) const ANYTHING: u16 = 1 << 9;

    /// Whether a type that says `held` may be assignable to one that says `taken`. That a string is a `{ length: number }`, an array too, and a function a `{ name: string }` is left aside: no property of what the program is given is looked at so.
    pub(super) fn may_fit(held: u16, taken: u16) -> bool {
        (held | taken) & ANYTHING != 0 || held & !taken == 0
    }
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
    /// No application: the text of a string literal type or of a template literal type, which a template literal type makes longer.
    Text,
    Alias(Sym),
    Conditional(FileId, TypeNodeId),
    IndexedAccess,
    StringMapping,
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
    /// Nothing but a shape transition does: no allocation site, no copy of plain data.
    pub is_transition_target_only: bool,
    /// Objects that are made as it are of a type that the program freezes or seals objects of.
    pub may_be_frozen: bool,
    /// Or of a type that it replaces the prototype of objects of, by anything but `null`.
    pub may_have_other_prototype: bool,
    /// An object that is not laid out can be in places of this type.
    pub admits_foreign: bool,
    pub is_opened_for_the_log: bool,
    /// The allocated types whose objects can be in places of this type, itself among them if it is allocated. Ascending.
    pub members: Vec<u32>,
    pub members_by_fit: Vec<u32>,
    /// What a cast may turn an object into, where it is, that was made as this type. Each is a member of this type. Ascending.
    pub specializations: Vec<u32>,
    /// By name of a field: the one function whose closures the stores that are seen put there, in the objects of every subtype. A
    /// prediction: an untyped store is not seen. In no order that means anything.
    pub callees: Vec<(Atom, FileId, FnId)>,
    /// The fields that an object of it gets right after its allocation, and whether at every creation point, on every path. A
    /// prediction: see `creation.rs`. By name.
    pub set_at_creation: Vec<(Atom, bool)>,
    /// Of a layout that is allocated: the names of the required fields that nobody ever sees absent. A fact: see
    /// `first_stores.rs`. In no order that means anything.
    pub never_seen_absent: Vec<Atom>,
}

pub struct Membership {
    /// For each of the views that were asked about.
    pub views: Vec<Reach>,
    pub(super) alteration_sites: [[u32; NUMBER_OF_OPERANDS]; 2],
    pub(super) altered_by: [[u32; 3]; 2],
    pub(super) evidence_of_alterations: [u32; 5],
    pub(super) untyped_alterations: UntypedAlterations,
    pub(super) widest_alterations: WidestAlterations,
    pub(super) constructions_are_incomplete: bool,
    pub(super) doors: DoorsCounted,
    pub sizes: Sizes,
    /// For each view that admits foreign objects: why.
    pub why_foreign: Vec<Option<WhyForeign>>,
    /// For each view: its subtypes, and after them, by numbers that no view has, what is not laid out. Ascending. And why each is one.
    pub subtypes: Vec<Vec<u32>>,
    pub causes: Vec<Vec<Cause>>,
    /// What `Cause::Upcast` numbers.
    pub upcasts: Vec<(u32, u32, Place)>,
    /// The targets of vouched casts, each with the first place. Ascending.
    pub vouched: Vec<(u32, Place)>,
}

/// Where a value of type `any` or `unknown` comes from, going by the text: `Checker::origin_of_data`. The first three are known for data that nobody has made anything of.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum OriginOfData {
    /// `JSON.parse(..)`
    Parsed,
    /// What a declaration without a body has produced.
    Prediction,
    /// The value of a JSON module.
    JsonModule,
    /// A variable or a parameter that is annotated so.
    Annotated,
    /// A variable whose type is inferred so.
    Inferred,
    /// What a function of the program yields.
    Function,
    /// What a built-in of the engine yields, but for `JSON.parse`.
    BuiltIn,
    /// A property that is declared so, of an object that has a type.
    Property,
    Awaited,
}

impl OriginOfData {
    pub fn is_known_for_data(self) -> bool {
        self <= OriginOfData::JsonModule
    }
}

struct LookedAt {
    target: (TypeId, Identity),
    parts_of_target: Vec<Identity>,
    source: (TypeId, Identity),
    parts_of_source: Vec<Identity>,
    file: FileId,
    written: TypeNodeId,
    operand: ExprId,
    is_known_for_data: Option<bool>,
}

struct WrittenUnion {
    file: FileId,
    node: TypeNodeId,
    members: Vec<(TypeId, Identity)>,
}

#[derive(Default)]
struct Left {
    looked_at: FxHashMap<FileId, Vec<LookedAt>>,
    unions: FxHashMap<FileId, Vec<WrittenUnion>>,
    arrays: Vec<(Identity, Vec<Identity>)>,
}

type SaidByType = (Identity, Option<Vec<(Box<[u8]>, Said)>>);

fn share_by_weight(files: &[FileId], weights: &[u64], index: usize, searchers: usize) -> Vec<FileId> {
    let total: u64 = files.iter().map(|file| weights[file.idx()]).sum();
    let (from, to) = (total * index as u64 / searchers as u64, total * (index as u64 + 1) / searchers as u64);
    let mut ahead = 0;
    let starts_in_share = |file: &FileId| {
        let starts_at = ahead;
        ahead += weights[file.idx()];
        from <= starts_at && starts_at < to
    };
    files.iter().copied().filter(starts_in_share).collect()
}

pub enum Share<'a> {
    Of(&'a [FileId]),
    Rest { index: usize, of: usize, is_taken: &'a [bool] },
}

pub struct Meeting {
    barrier: Barrier,
    search: Search,
}

pub(super) struct Search {
    searchers: usize,
    barrier: Barrier,
    found_by_all: AtomicUsize,
    seen: RwLock<FxHashSet<Identity>>,
    tainted: RwLock<FxHashSet<Identity>>,
    said: Vec<Mutex<Vec<SaidByType>>>,
    said_so_far: Mutex<FxHashSet<Vec<(Box<[u8]>, Said)>>>,
    given: RwLock<Given>,
    gave_up: Mutex<Option<GaveUp>>,
    is_gone_on_with: bool,
    left: Mutex<Left>,
    seen_before: Option<Arc<FxHashSet<Identity>>>,
    targets_by_source: FxHashMap<Identity, Vec<Identity>>,
    seen_by_other_declarations: FxHashMap<FileId, Place>,
    names: Mutex<FxHashMap<Identity, Vec<Box<[u8]>>>>,
}

fn held<T>(lock: Result<T, PoisonError<T>>) -> T {
    lock.unwrap_or_else(PoisonError::into_inner)
}

impl Search {
    fn new(searchers: usize) -> Search {
        Search {
            searchers,
            barrier: Barrier::new(searchers),
            found_by_all: AtomicUsize::new(0),
            seen: RwLock::default(),
            tainted: RwLock::default(),
            said: (0..searchers).map(|_| Mutex::default()).collect(),
            said_so_far: Mutex::default(),
            given: RwLock::default(),
            gave_up: Mutex::default(),
            is_gone_on_with: false,
            left: Mutex::default(),
            seen_before: None,
            targets_by_source: FxHashMap::default(),
            seen_by_other_declarations: FxHashMap::default(),
            names: Mutex::default(),
        }
    }

    fn going_on_from(first: Search, parties: usize) -> Search {
        let seen = held(first.seen.into_inner());
        Search {
            seen_before: Some(Arc::new(seen.clone())),
            seen: RwLock::new(seen),
            tainted: first.tainted,
            said_so_far: first.said_so_far,
            given: first.given,
            left: first.left,
            names: first.names,
            ..Search::new(parties)
        }
    }

    fn found(&self) -> Given {
        Given { names: std::mem::take(&mut *held(self.names.lock())), ..std::mem::take(&mut *held(self.given.write())) }
    }

    fn has_any_found(&self, found: usize) -> bool {
        self.found_by_all.fetch_add(found, Ordering::SeqCst);
        self.barrier.wait();
        let by_all = self.found_by_all.load(Ordering::SeqCst);
        if self.barrier.wait().is_leader() {
            self.found_by_all.store(0, Ordering::SeqCst);
        }
        self.barrier.wait();
        by_all != 0
    }

    fn add_what_was_said(&self) {
        let (mut given, mut said_so_far) = (held(self.given.write()), held(self.said_so_far.lock()));
        for said in &self.said {
            for (identity, properties) in held(said.lock()).drain(..) {
                let is_new = given.identities.insert(identity);
                let Some(properties) = properties.filter(|_| is_new) else { continue };
                if properties.is_empty() || !said_so_far.insert(properties.clone()) {
                    continue;
                }
                for (name, _) in &properties {
                    let index = given.properties.len() as u32;
                    given.by_name.entry(name.clone()).or_default().push(index);
                }
                given.properties.push(properties.into_iter().collect());
            }
        }
    }
}

impl<'s> Program<'s> {
    pub fn is_what_is_given_found(&self) -> bool {
        self.aot.storage.given.get().is_some()
    }

    pub(crate) fn absorb_pairs_compared(&self, mut pairs: Vec<(Identity, Identity)>) {
        if !pairs.is_empty() {
            held(self.aot.storage.pairs_compared.lock()).append(&mut pairs);
        }
    }

    pub fn meeting_of(&self, parties: usize) -> Meeting {
        let first = held(self.aot.storage.found_at_first.lock()).take().expect("the search from the doors is made ahead of the plan");
        let mut search = Search::going_on_from(first, parties);
        for (source, target) in std::mem::take(&mut *held(self.aot.storage.pairs_compared.lock())) {
            search.targets_by_source.entry(source).or_default().push(target);
        }
        for targets in search.targets_by_source.values_mut() {
            targets.sort_unstable();
            targets.dedup();
        }
        Meeting { barrier: Barrier::new(parties), search }
    }

    pub fn find_what_is_given(&self, searchers: usize, step: u32, is_searched_again: bool, at_once: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) -> Result<Vec<Finished<'s>>, GaveUp> {
        if self.aot.storage.given.get().is_some() {
            return Ok(Vec::new());
        }
        let search = Search { is_gone_on_with: is_searched_again, seen_by_other_declarations: self.checker().importers_that_see_other_declarations(), ..Search::new(searchers.max(1)) };
        held(search.given.write()).went_on_by_pairs = is_searched_again;
        let finished: Vec<Mutex<Option<Finished<'s>>>> = (0..search.searchers).map(|_| Mutex::new(None)).collect();
        at_once(search.searchers, &|index| {
            let mut searcher = self.checker();
            searcher.begin_stack_budget();
            searcher.begin_task(step, index as u32, true);
            searcher.withhold_tables_of_expressions();
            for file in (0..self.files.modules.len() as u32).map(FileId) {
                if searcher.is_untyped_file(file) {
                    searcher.task.begin_file(file, false);
                }
            }
            searcher.aot.flows.is_searching_from_doors = true;
            searcher.aot.flows.is_crossing_bounded = true;
            searcher.search_from_doors(&search, index, &Share::Rest { index, of: search.searchers, is_taken: &[] }, &FxHashMap::default());
            let mut found = searcher.end_task();
            found.diagnostics.retain(|(owner, _)| owner.is_some_and(|owner| !matches!(owner, crate::check::Query::Expr(..) | crate::check::Query::Call(..))));
            *held(finished[index].lock()) = Some(found);
        });
        if let Some(gave_up) = held(search.gave_up.lock()).take() {
            return Err(gave_up);
        }
        match is_searched_again {
            true => {
                self.aot.storage.given.set_for_warming_up(held(search.given.read()).clone());
                *held(self.aot.storage.found_at_first.lock()) = Some(search);
            }
            false => {
                let _ = self.aot.storage.given.set(search.found());
            }
        }
        Ok(finished.into_iter().filter_map(|finished| held(finished.into_inner())).collect())
    }
}

/// Why a view admits objects that are not laid out.
#[derive(Copy, Clone)]
pub enum WhyForeign {
    /// A value of the type `source`, if that is still known, has been let in.
    Seen { source: Option<TypeId>, at: Place },
    /// The value of an expression whose type says nothing has been held to the view, or to one that holds it, and objects of the kind are
    /// of the type of the view.
    Untyped { at: Place, candidate: Candidate },
    Given { at: Place, candidate: Candidate },
    GivenAndKeptByNobody { at: Place },
    /// What is in a place of the view `from` gets into places of this one untested.
    Inherited { from: u32, at: Place },
    /// A declaration file declares the type: it describes host objects to begin with.
    DeclaredOnly,
    Instance,
    /// What is in a place of the view `from` and is not laid out passes a cast to this one.
    PassedCast { from: u32 },
    /// It requires no live field, so nearly everything fits it, and a value that only its type vouches for is held to it. See `subtypes.rs`,
    /// phase B.
    Weak { at: Place },
    /// All its properties are primitives, and something untyped is held to it: nothing has to be made of that.
    Flat { at: Place },
    /// More layouts may fit it than phase B asks about for one target, and a value that only its type vouches for is held to it.
    TooMany { at: Place },
    ForTheLog { at: Place },
    NothingIsMadeAsIt { at: Place },
}

/// A kind of objects that are not laid out. `Checker::name_of_candidate` says which.
#[derive(Copy, Clone)]
pub struct Candidate(Kind);

/// Types, by their index in a list, and which of them has a property by which name.
#[derive(Default)]
struct Having {
    /// Ascending, as are `indexable` and each list of `by_name`.
    all: Vec<u32>,
    /// Those that a type with an index signature can take: they have one, or are known to have no properties but those they say.
    indexable: Vec<u32>,
    by_name: FxHashMap<Atom, Vec<u32>>,
}

const MOST_GIVEN_KINDS_ASKED_ABOUT: usize = 256;

/// What a question is about.
#[derive(Copy, Clone)]
enum Kind {
    /// Objects that are made as the type.
    Made(TypeId),
    /// The same, and the types of reference fields count: see `Checker::is_of_type_as`.
    Assignable(TypeId),
    /// Objects that are not laid out: arrays, functions, the objects of a class or an interface, a class or a function as a value. With
    /// `any` for type parameters. They are named by what every checker finds for itself, and not by a type that one checker has made.
    Arrays,
    Functions,
    InstancesOf(Sym),
    ValueOf(Sym),
    /// Objects of a type that no declaration names, which whoever has noted it has kept.
    Of(TypeId),
    Given(TypeId),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Answer {
    No,
    Yes,
    NotKnown,
}

/// Whether objects of a kind are of the type of a view. It stands by itself: every checker of the program answers it the same, whatever
/// it has been asked before.
#[derive(Copy, Clone)]
pub struct Question {
    kind: Kind,
    view: TypeId,
}

impl Question {
    pub(super) fn whether_made_is_of(made: TypeId, view: TypeId) -> Question {
        Question { kind: Kind::Made(made), view }
    }

    pub(super) fn whether_made_is_assignable_to(made: TypeId, view: TypeId) -> Question {
        Question { kind: Kind::Assignable(made), view }
    }
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is noted ─────────────────────────────

    /// The type that says how objects of type `ty` are laid out. There is one for all instantiations of a class and its `this` type, since
    /// a class is compiled once, and one for the fresh type of an object literal, which the expression has, and the regular one. A mapped
    /// type over a type parameter is the same over what the parameter is bounded by, as the parameter by itself is: where `T extends
    /// Node`, a `Mutable<T>` is a `Mutable<Node>`. `Identifier & BinaryExpression`, which nothing is, going by `kind`, is `never`: no view, no
    /// member, nothing that objects are made as or cast to.
    pub fn laid_out_as(&mut self, ty: TypeId) -> TypeId {
        if let Some(&known) = self.aot.flows.laid_out.get(&ty) {
            return known;
        }
        let found = self.find_what_it_is_laid_out_as(ty);
        if self.aot.flows.finding_canonical == 0 {
            self.aot.flows.laid_out.insert(ty, found);
        }
        found
    }

    fn find_what_it_is_laid_out_as(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced(ty);
        match *self.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) if self.files().flags(target).contains(SymFlags::CLASS) => self.declared_type(target),
            TypeData::Anon { origin: Origin::Mapped(file, node), mapper } => {
                let Some((over, _)) = self.mapped_modifiers_source(file, node) else { return ty };
                let over = self.instantiate(over, mapper);
                // `Mutable<T>`, `Readonly<T>`: there is no `readonly` when the program runs, so it is a `T`.
                if self.only_changes_readonly(file, node) {
                    let over = if self.is_type_param(over) { self.base_constraint(over) } else { over };
                    if self.says_properties(over) {
                        return self.laid_out_as(over);
                    }
                }
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
                let ty = self.regular_type_of_object_literal(ty);
                let ty = self.canonical_type(ty);
                if self.structure_of_plain_literal(ty).is_none() {
                    return ty;
                }
                self.keep_type(ty);
                let identity = self.identity_of_type(ty);
                *self.aot.flows.first_of_structure.entry(identity).or_insert(ty)
            }
        }
    }

    pub fn place_of_object_literal(&self, ty: TypeId) -> Option<(u32, u32)> {
        match *self.data(ty) {
            TypeData::Anon { origin: Origin::ObjectLiteral(file, e, ..), .. } => Some((file.0, self.hir(file)[e].pos)),
            _ => None,
        }
    }

    fn is_plain_data(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Object(_) => true,
            ExprKind::Unary { op: UnOp::Minus, operand } => matches!(hir[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_)),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.is_plain_data(file, element)),
            _ => false,
        }
    }

    pub(super) fn structure_of_plain_literal(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
        let TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, false, _, _, _, false), mapper: MapperId::IDENTITY } = *self.data(ty) else { return None };
        if self.types().provenance(ty).is_some() || self.is_untyped_file(file) {
            return None;
        }
        let hir = self.hir(file);
        let ExprKind::Object(written) = hir[literal].kind else { return None };
        if !written.iter().all(|p| hir[p].kind == PropKind::Init && matches!(hir[p].key, PropKey::Name(_)) && self.is_plain_data(file, hir[p].value)) {
            return None;
        }
        let members = self.members(ty)?;
        let shape = members.shape();
        if shape.props.is_empty() || !shape.call.is_empty() || !shape.construct.is_empty() || !shape.index.is_empty() {
            return None;
        }
        let mut fields = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            let name = self.atoms().bytes(prop.name);
            if !matches!(prop.source, PropSource::Literal(..)) || prop.flags.intersects(PropFlags::METHOD | PropFlags::ACCESSOR) || prop.name_type != TypeId::UNRESOLVED || name == b"__proto__" || name.first().is_none_or(u8::is_ascii_digit) {
                return None;
            }
            let of_field = self.type_of_prop(prop, MapperId::IDENTITY);
            let of_field = self.regular(of_field);
            let flags = prop.flags.contains(PropFlags::OPTIONAL) as u8 | (prop.flags.contains(PropFlags::READONLY) as u8) << 1;
            fields.push((prop.name, flags, self.regular_type_of_object_literal(of_field)));
        }
        Some(fields)
    }

    /// The supertype whose layout `ty` shares. `interface AssignmentExpression extends BinaryExpression { left: LeftHandSideExpression }`
    /// and `BinaryExpression & { left: Identifier }` only narrow the types of reference fields. A reference is one word whatever it
    /// points to, so at run time they are a `BinaryExpression`: one layout id, no shape transition on a cast. The field types of the
    /// layout are those of the supertype, so a read is typed by the supertype and the narrower type is tested where it is used.
    /// Found by walking `extends` clauses and intersection members only, so every checker finds the same type.
    fn canonical_type(&mut self, ty: TypeId) -> TypeId {
        if let Some(&known) = self.aot.flows.canonical.get(&ty) {
            return known;
        }
        // Breaks cycles.
        self.aot.flows.canonical.insert(ty, ty);
        self.aot.flows.finding_canonical += 1;
        let supertypes: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_made_by_the_program(ty) => match self.members(ty) {
                Some(members) => self.base_types(target).into_vec().into_iter().map(|base| self.instantiate(base, members.mapper)).collect(),
                None => Vec::new(),
            },
            TypeData::Intersection(ref parts) => parts.to_vec(),
            _ => Vec::new(),
        };
        // An instantiation differs from the interface at the bounds of its parameters in nothing that the run time sees, where those are primitives.
        let mut supertypes = supertypes;
        if let TypeData::Ref { target, .. } = *self.data(ty)
            && self.is_made_by_the_program(ty)
            && !self.is_type_of_instances(ty)
        {
            let at_bounds = self.at_primitive_bounds_of_parameters(target);
            if at_bounds != ty {
                supertypes.push(at_bounds);
            }
        }
        let mut canonical = ty;
        for supertype in supertypes {
            let is_record = self.says_properties(supertype) && self.is_made_by_the_program(supertype) && !self.is_type_of_instances(supertype);
            if is_record && self.has_same_fields(ty, supertype, true) {
                canonical = self.laid_out_as(supertype);
                break;
            }
        }
        self.aot.flows.finding_canonical -= 1;
        self.aot.flows.canonical.insert(ty, canonical);
        canonical
    }

    /// Whether `sub` has the fields of `sup` and they differ only in what the reference fields point to. No signatures, no index
    /// signatures. The primitive part of each field has to agree, discriminants above all.
    ///
    /// `exact`, for the layout id: `sub` has no other fields, every declared field counts, what is optional in the one is in the other, and
    /// the primitive parts are the same but for `undefined` and `null`. So nothing the relation goes by is lost when `sub` is allocated
    /// as `sup`. The answer is a function of the two types alone, before and after the link.
    ///
    /// Otherwise, for the relation at the link: `sub` may have more fields, dead fields do not count, a field that `sup` requires is
    /// required in `sub`, and the primitive part of `sub` is assignable to that of `sup`. It has to reach as far as that, because a
    /// canonical layout has the reference fields of the SUPERTYPE: an `AssignmentExpression` is allocated as a `BinaryExpression`, whose
    /// `left` is an `Expression`, and is still a `{ left: LeftHandSideExpression }`.
    fn has_same_fields(&mut self, sub: TypeId, sup: TypeId, exact: bool) -> bool {
        let (Some(of_sub), Some(of_sup)) = (self.members(sub), self.members(sup)) else { return false };
        let (sub_shape, sup_shape) = (of_sub.shape(), of_sup.shape());
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(sub_shape) || !is_plain(sup_shape) {
            return false;
        }
        let is_dead = |c: &Self, name: Atom| !exact && c.is_never_stored(name);
        if exact && sub_shape.props.iter().any(|prop| of_sup.resolved.prop(prop.name).is_none()) {
            return false;
        }
        const KIND: PropFlags = PropFlags::METHOD.union(PropFlags::ACCESSOR);
        for sup_prop in sup_shape.props.iter() {
            if is_dead(self, sup_prop.name) {
                continue;
            }
            let Some(sub_prop) = of_sub.resolved.prop(sup_prop.name) else { return false };
            let (is_sub_optional, is_sup_optional) = (sub_prop.flags.contains(PropFlags::OPTIONAL), sup_prop.flags.contains(PropFlags::OPTIONAL));
            if sub_prop.flags & KIND != sup_prop.flags & KIND || (is_sub_optional && !is_sup_optional) || (exact && is_sub_optional != is_sup_optional) {
                return false;
            }
            let (sub_type, sup_type) = (self.type_of_prop(sub_prop, of_sub.mapper), self.type_of_prop(sup_prop, of_sup.mapper));
            if sub_type != sup_type && !self.differs_in_references_only(sub_type, sup_type, exact) {
                return false;
            }
        }
        true
    }

    /// See `has_same_fields`. A field is a reference, a real primitive (number, string, boolean, bigint, symbol, a literal) or boxed.
    /// * A reference slot holds nil anyway, so a nil-only type (`undefined`, `null`, `void`) goes with any reference type, both ways:
    ///   `FlowUnreachable.node: undefined`, `FlowStart.node: FunctionExpression | undefined`.
    /// * `unknown` and `any` in `sup` are a boxed slot, which holds whatever `sub` says, so references and nil go with it:
    ///   `FlowNodeBase.node: unknown`. Not a real primitive: it would lose its unboxed slot. Not the other way round.
    /// * Real primitives have to agree.
    fn differs_in_references_only(&mut self, sub: TypeId, sup: TypeId, exact: bool) -> bool {
        let is_generic = |c: &Self, ty: TypeId| c.parts(ty).iter().any(|&part| c.is_instantiable(part));
        // By its bound: a type parameter does not stand for a constant here either. `is_of_type` would let it.
        if is_generic(self, sub) || is_generic(self, sup) {
            if exact {
                let (sub_bound, sup_bound) = (self.at_primitive_bounds(sub), self.at_primitive_bounds(sup));
                let is_bounded = (sub_bound != sub || sup_bound != sup) && !is_generic(self, sub_bound) && !is_generic(self, sup_bound);
                return is_bounded && (sub_bound == sup_bound || self.differs_in_references_only(sub_bound, sup_bound, true));
            }
            let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
            return self.is_provably_related(sub, sup, relation);
        }
        let is_nil = |part: TypeId| part.is_undefined() || part.is_null() || part == TypeId::VOID;
        let has_references = |c: &Self, ty: TypeId| c.parts(ty).iter().any(|&part| !c.has_primitive_flag(part));
        let primitives = |c: &Self, ty: TypeId| -> Vec<TypeId> { c.parts(ty).iter().copied().filter(|&part| c.has_primitive_flag(part) && !is_nil(part)).collect() };
        let is_boxed = |ty: TypeId| ty.is_any() || ty == TypeId::UNKNOWN;
        if is_boxed(sup) {
            return is_boxed(sub) || primitives(self, sub).is_empty();
        }
        if is_boxed(sub) || sub.is_never() || sup.is_never() {
            return false;
        }
        let (sub_primitives, sup_primitives) = (primitives(self, sub), primitives(self, sup));
        let (sub_references, sup_references) = (has_references(self, sub), has_references(self, sup));
        let is_sub_nil = !sub_references && sub_primitives.is_empty();
        let is_sup_nil = !sup_references && sup_primitives.is_empty();
        if exact {
            // Which string or number it is, is nothing that a slot shows.
            let kinds = |c: &mut Self, parts: &[TypeId]| -> Vec<TypeId> {
                let mut kinds: Vec<TypeId> = Vec::new();
                for &part in parts {
                    let kind = if c.is_number_like(part) { TypeId::NUMBER } else if c.is_string_like(part) { TypeId::STRING } else { c.base_of_literal(part) };
                    kinds.extend(c.parts(kind).iter().copied());
                }
                kinds.sort_unstable_by_key(|kind| kind.0);
                kinds.dedup();
                kinds
            };
            let (sub_kinds, sup_kinds) = (kinds(self, &sub_primitives), kinds(self, &sup_primitives));
            return (sub_references == sup_references || is_sub_nil || is_sup_nil) && sub_kinds == sup_kinds && sub_primitives.iter().all(|&part| sup_primitives.contains(&part) || self.is_provably_assignable(part, sup));
        }
        (!sub_references || sup_references || is_sup_nil) && sub_primitives.into_iter().all(|part| sup_primitives.contains(&part) || self.is_provably_assignable(part, sup))
    }

    /// What a type parameter is bounded by, if that is primitives alone: `E extends Name`, `TKind extends SyntaxKind`. Any other stands for objects, and a place for the type at
    /// its bound is no place for every instantiation.
    fn primitive_bound(&mut self, ty: TypeId) -> Option<TypeId> {
        if !self.is_type_param(ty) {
            return None;
        }
        let bound = self.base_constraint(ty);
        let is_primitive = !self.parts(bound).is_empty() && self.parts(bound).iter().all(|&part| self.has_primitive_flag(part) && !self.is_instantiable(part));
        is_primitive.then_some(bound)
    }

    /// The type with every part that has a `primitive_bound` replaced by that.
    fn at_primitive_bounds(&mut self, ty: TypeId) -> TypeId {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let bounded: Vec<TypeId> = parts.into_iter().map(|part| self.primitive_bound(part).unwrap_or(part)).collect();
        self.union(&bounded)
    }

    /// `Site<E>` as it is declared, with every parameter that has a `primitive_bound` replaced by that.
    fn at_primitive_bounds_of_parameters(&mut self, target: Sym) -> TypeId {
        let declared = self.declared_type(target);
        let parameters: Vec<TypeId> = self.type_params_of_symbol(target).iter().copied().collect();
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::new();
        for parameter in parameters {
            if let Some(bound) = self.primitive_bound(parameter) {
                pairs.push((parameter, bound));
            }
        }
        if pairs.is_empty() {
            return declared;
        }
        let mapper = self.types().mapper(pairs);
        self.instantiate(declared, mapper)
    }

    /// Whether the mapped type that is declared at `node` is `{ readonly [K in keyof T]: T[K] }`, with `readonly`, `-readonly` or neither: it
    /// has the properties of `T`, with their types, and what is optional in `T` is in it.
    fn only_changes_readonly(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let mapped = self.mapped_decl(file, node);
        if mapped.name_ty.is_some() || mapped.ty.is_none() || mapped.optional != MappedModifier::None {
            return false;
        }
        let Some((over, true)) = self.mapped_modifiers_source(file, node) else { return false };
        let (template, key) = (self.type_from_node(file, mapped.ty), self.type_param(file, mapped.param));
        matches!(*self.data(template), TypeData::IndexedAccess { obj, index, .. } if obj == over && index == key)
    }

    /// Whether the type is one of a family that need not end, and too far out in it to be laid out: `interface List<T> { next:
    /// List<List<T>> }` has a field of a larger instantiation of itself, which has one of a larger one still. That is read off the type
    /// alone, however it was come by: some declaration is applied too often within its own type arguments, `List<List<List<..>>>`, or,
    /// where `A<T>` has a `B<T[]>` and `B<T>` an `A<T[]>`, `T[][][]..`. A long tuple and a long text count for more, so that what only grows
    /// sideways, `C<[...T, 0]>`, ends as well. A generic alias is such a declaration though it stand for the same each time: with `type Maybe<T> = T | null`, `Maybe<Maybe<number>>` is another type than `Maybe<number>`. So is what waits for a type parameter: `Awaited<Awaited<T>>`, `T[K][K]`.
    pub fn is_nested_too_deeply(&mut self, ty: TypeId) -> bool {
        if let Some(&known) = self.aot.flows.nested_too_deeply.get(&ty) {
            return known;
        }
        let found = self.find_whether_it_is_nested_too_deeply(ty);
        self.aot.flows.nested_too_deeply.insert(ty, found);
        found
    }

    fn find_whether_it_is_nested_too_deeply(&mut self, ty: TypeId) -> bool {
        self.find_applications_in(ty);
        self.aot.flows.applications[&ty].iter().any(|&(_, times)| times > MOST_APPLICATIONS_WITHIN_EACH_OTHER)
    }

    fn generic_form_of(&mut self, ty: TypeId) -> Option<TypeId> {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => Some(self.declared_type(target)),
            TypeData::Anon { origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node), .. } => Some(self.type_from_node(file, node)),
            _ => None,
        }
    }

    pub fn is_beyond_the_layouts(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED {
            return false;
        }
        if let Some(&known) = self.aot.flows.beyond_the_layouts.get(&ty) {
            return known;
        }
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let found = parts.into_iter().any(|part| self.is_nested_too_deeply(part));
        self.aot.flows.beyond_the_layouts.insert(ty, found);
        found
    }

    pub fn is_read_from_beyond_the_layouts(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let call = match hir[e].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let of_object = self.type_of_expr(file, obj);
                return self.is_beyond_the_layouts(of_object);
            }
            ExprKind::Call(call) => call,
            _ => return false,
        };
        let mut callee = hir[call].callee;
        while let ExprKind::NonNull(asserted) = hir[callee].kind {
            callee = asserted;
        }
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[callee].kind {
            let of_receiver = self.type_of_expr(file, obj);
            if self.is_beyond_the_layouts(of_receiver) {
                return true;
            }
        }
        for argument in hir.ids(hir[call].args) {
            let argument = match hir[argument].kind {
                ExprKind::Missing => continue,
                ExprKind::Spread(spread) => spread,
                _ => argument,
            };
            let of_argument = self.type_of_expr(file, argument);
            if self.is_beyond_the_layouts(of_argument) {
                return true;
            }
        }
        false
    }

    pub fn note_what_comes_from_beyond_the_layouts(&mut self, ty: TypeId) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let (mut seen, mut views) = (FxHashSet::default(), Vec::new());
        self.add_what_stays_untyped(ty, true, &mut seen, &mut views);
        for view in views {
            self.note_foreign(view, TypeId::UNRESOLVED);
        }
    }

    pub fn note_what_a_generic_function_made(&mut self, made: &Made, made_as: TypeId) {
        if made_as == TypeId::UNRESOLVED {
            return;
        }
        let mut views = Vec::new();
        self.add_what_is_made_as(made, made_as, &mut views);
        for view in views {
            self.note_foreign(view, TypeId::UNRESOLVED);
        }
    }

    fn add_what_is_made_as(&mut self, made: &Made, made_as: TypeId, out: &mut Vec<TypeId>) {
        let mut made_as = self.reduced(made_as);
        if self.is_instantiable(made_as) {
            let bound = self.base_constraint(made_as);
            made_as = self.reduced(bound);
        }
        if !self.may_hold_objects(made_as) {
            return;
        }
        if let TypeData::Union(parts) = self.data(made_as) {
            let parts: Vec<TypeId> = parts.to_vec();
            let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| self.says_properties(part)).collect();
            if objects.len() > 1 {
                let objects = self.union(&objects);
                let common = self.view_of_union(objects);
                if !matches!(self.data(common), TypeData::Union(_)) {
                    self.add_what_is_made_as(made, common, out);
                }
            }
            for part in parts {
                self.add_what_is_made_as(made, part, out);
            }
            return;
        }
        if self.is_array_or_tuple(made_as) {
            if let Some(elements) = &made.elements {
                let of_elements: Vec<TypeId> = self.type_arguments(made_as).to_vec();
                for of_element in of_elements {
                    self.add_what_is_made_as(elements, of_element, out);
                }
            }
            return;
        }
        let is_module = matches!(self.data(made_as), TypeData::Anon { origin: Origin::Module(..), .. });
        if !made.is_object || self.built_in_that_is(made_as).is_some() || self.is_type_of_instances(made_as) || !self.says_properties(made_as) || is_module {
            return;
        }
        let view = self.laid_out_as(made_as);
        out.push(view);
        for (name, held) in &made.within {
            if let Some(of_field) = self.type_of_property(made_as, *name) {
                self.add_what_is_made_as(held, of_field, out);
            }
        }
        if let Some(anywhere) = &made.anywhere
            && let Some(members) = self.members(made_as)
        {
            for info in members.shape().index.iter() {
                self.add_what_is_made_as(anywhere, info.value, out);
            }
            for prop in members.shape().props.iter() {
                let of_field = self.type_of_prop(prop, members.mapper);
                self.add_what_is_made_as(anywhere, of_field, out);
            }
        }
    }

    /// The types that the record of the type refers to, those that its mappers map to among them, and the type arguments of the alias that is stored with it.
    fn types_referred_to_by(&self, at: TypeId) -> Vec<TypeId> {
        let mut referred = Referred::default();
        self.data(at).visit(&mut referred);
        // What a spread was made of is no part of it: `{ ...a, ...b, ...c }` is made of `{ ...a, ...b }` and `c`, and has the properties of all three itself.
        if let TypeData::Synth(shape) = self.data(at)
            && let Some((left, right)) = shape.created_from
        {
            for operand in [left, right] {
                if let Some(index) = referred.types.iter().position(|&ty| ty == operand) {
                    referred.types.swap_remove(index);
                }
            }
        }
        for mapper in std::mem::take(&mut referred.mappers) {
            if mapper != MapperId::IDENTITY {
                referred.types.extend(self.types().mapping(mapper).iter().map(|pair| pair.1));
            }
        }
        if let Some((_, type_arguments)) = self.stored_alias(at) {
            referred.types.extend(type_arguments.iter().copied());
        }
        referred.types
    }

    /// For each declaration: how often at most it is applied, one application within the other, in `ty` and its type arguments. It goes by
    /// the records of the types and the aliases stored with them, which refer to older records only, so it ends: the arguments of `Json[]` in `type Json = string | Json[]`
    /// are a node there and not the type they resolve to. Types may be nested thousands deep, so it keeps its own list of what is to do.
    fn find_applications_in(&mut self, ty: TypeId) {
        let mut pending = vec![ty];
        while let Some(&at) = pending.last() {
            if self.aot.flows.applications.contains_key(&at) {
                pending.pop();
                continue;
            }
            let referred = self.types_referred_to_by(at);
            // The arguments first.
            let known = pending.len();
            pending.extend(referred.iter().copied().filter(|argument| !self.aot.flows.applications.contains_key(argument)));
            if pending.len() > known {
                continue;
            }
            let arguments = (referred.len() - self.stored_alias(at).map_or(0, |stored| stored.1.len())) as u32;
            let own = match *self.data(at) {
                TypeData::StringLit { value, .. } => Some((Applied::Text, self.atoms().bytes(value).len() as u32 / 64)),
                _ if arguments == 0 => None,
                TypeData::Ref { target, .. } => Some((Applied::Named(target), 1)),
                TypeData::Anon { origin, .. } => Some((Applied::Written(origin), 1)),
                TypeData::Fns { ref decls, .. } => decls.first().map(|&(file, func)| (Applied::Function(file, func), 1)),
                TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Some((Applied::Computed, 1)),
                TypeData::Tuple { .. } => Some((Applied::Tuple, 1 + arguments / 16)),
                TypeData::Cond { file, node, .. } => Some((Applied::Conditional(file, node), 1)),
                TypeData::IndexedAccess { .. } => Some((Applied::IndexedAccess, 1)),
                TypeData::StringMapping { .. } => Some((Applied::StringMapping, 1)),
                TypeData::Template { ref texts, .. } => Some((Applied::Text, texts.iter().map(|&text| self.atoms().bytes(text).len() as u32).sum::<u32>() / 64)),
                _ => None,
            };
            let alias = self.stored_alias(at).filter(|stored| !stored.1.is_empty()).map(|stored| (Applied::Alias(stored.0), 1));
            let mut all: Vec<(Applied, u32)> = Vec::new();
            for argument in &referred {
                for &(applied, times) in &self.aot.flows.applications[argument] {
                    match all.iter_mut().find(|known| known.0 == applied) {
                        Some(known) => known.1 = known.1.max(times),
                        None => all.push((applied, times)),
                    }
                }
            }
            for (applied, times) in own.into_iter().chain(alias) {
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
        let not_known_before = self.aot.flows.times_not_known;
        let (opaque, any) = (self.restrictive_instantiation(source), self.permissive_instantiation(target));
        let is_seen = self.is_provably_assignable(opaque, any);
        if self.aot.flows.times_not_known == not_known_before {
            self.aot.flows.seen_as.insert((source, target), is_seen);
        }
        is_seen
    }

    /// An object that is looked at as `source` says is looked at as `target` says, and no test is made: `is_seen_as` has been relied on, or
    /// the object is known to be the same, see `argument_handed_back_by`.
    pub fn note_upcast(&mut self, source: TypeId, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_upcast((source, target), at);
    }

    /// Where the type that the view stands for is declared: the name of the alias, the interface or the class, the first of them if it is
    /// merged, or the start of a type literal or an object literal. `None`: nothing declares it: an intersection, a mapped type, what
    /// the parts of a union have in common.
    pub fn declaration_of_view(&self, view: TypeId) -> Option<Place> {
        let named = |sym: Sym| {
            let declarations = self.files().decls_of(sym);
            let places = declarations.iter().filter_map(|&(file, decl)| {
                let hir = self.hir(file);
                Some(Place {
                    file,
                    pos: match decl {
                        Decl::Alias(alias) => hir[alias].name_pos,
                        Decl::Interface(interface) => hir[interface].name_pos,
                        Decl::Class(class) if hir[class].name.is_some() => hir[class].name_pos,
                        Decl::Class(class) => hir[class].start,
                        _ => return None,
                    },
                })
            });
            places.min()
        };
        if let Some((alias, _)) = self.alias_of_type(view) {
            return named(alias);
        }
        match *self.data(view) {
            TypeData::Ref { target, .. } => named(target),
            TypeData::Anon { origin: Origin::TypeLiteral(file, node), .. } => Some(Place { file, pos: self.hir(file)[node].pos }),
            TypeData::Anon { origin: Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..), .. } => Some(Place { file, pos: self.hir(file)[e].pos }),
            _ => None,
        }
    }

    /// What is translated from here on is at `pos` of `file`. What is noted is noted for that place.
    pub fn note_place(&mut self, file: FileId, pos: u32) {
        self.aot.flows.place = Place { file, pos };
    }

    /// What the parts of the union have in common, which is what an object is looked at as of which it is not known which part it is of.
    /// Each part is seen as that, whatever the relation makes of it.
    pub fn view_of_union(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let view = self.union_as_view(union);
        for &part in self.parts(union) {
            if self.says_properties(part) {
                let part = self.laid_out_as(part);
                self.aot.flows.seen_as.insert((part, view), true);
            }
        }
        view
    }

    /// `union_as_object` as a record that is the same in every task. That has the names in the order of the first part and keeps the constituents of
    /// each property in the order of the parts, which is that of their ids. This has the same properties with the same types, by name. The
    /// union is kept where a spread keeps its operands, with a rank that no spread has, nor a `view_with_all_names`.
    fn union_as_view(&mut self, union: TypeId) -> TypeId {
        let object = self.union_as_object(union);
        let Some(members) = self.members(object) else { return object };
        let mut shape = Shape::new_in(self.arena);
        for prop in members.shape().props.iter() {
            let ty = self.type_of_prop(prop, members.mapper);
            let flags = prop.flags & (PropFlags::OPTIONAL | PropFlags::METHOD | PropFlags::ACCESSOR);
            shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY, name_type: TypeId::UNRESOLVED });
        }
        self.sort_by_name(&mut shape);
        shape.index.extend(members.shape().index.iter().cloned());
        (shape.created_from, shape.spread_rank) = (Some((TypeId::NEVER, union)), u32::MAX - 1);
        self.synth(shape)
    }

    fn sort_by_name(&self, shape: &mut Shape<'_>) {
        let atoms = self.atoms();
        shape.props.sort_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
    }

    /// What an object is looked at as that is of one of the parts of the union, where a property is accessed that not all of them have:
    /// `(node as NamedDeclaration).name`, where the object may be any `Node`. It has a property by every name that one of the parts has.
    /// What some part lacks or need not have, it need not have. Each part is seen as that, whatever the relation makes of it.
    pub fn view_of_either(&mut self, union: TypeId) -> TypeId {
        let union = self.reduced(union);
        let parts: Vec<TypeId> = self.parts(union).iter().copied().filter(|&part| self.says_properties(part)).collect();
        self.view_with_all_names(&parts, (TypeId::NEVER, union))
    }

    /// What an object is looked at as of which nothing is known and that has been coerced to `target`: one of `target`, if it could be made
    /// one, or whatever it was. It has the properties of `target`, and need not have any. It is a type of its own, so that `target`
    /// stays what it is: a view that has only its members in its places.
    fn view_of_anything_as(&mut self, target: TypeId) -> TypeId {
        let parts: Vec<TypeId> = self.parts(target).to_vec();
        self.view_with_all_names(&parts, (TypeId::UNKNOWN, target))
    }

    /// Whether the type is a `view_of_anything_as`.
    pub fn is_view_of_anything(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && matches!(shape.created_from, Some((TypeId::UNKNOWN, _))))
    }

    /// For a `view_of_anything_as` the type that was cast to, for a `view_of_either` the union. Any other type unchanged.
    fn type_coerced_to(&self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Synth(shape) if shape.spread_rank == u32::MAX => shape.created_from.map_or(ty, |made_for| made_for.1),
            _ => ty,
        }
    }

    /// Whether the type is a `view_of_anything_as` or a `view_of_either`: nobody has declared it, and no primitive is of it.
    pub fn is_view_made_by_coercion(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && shape.created_from.is_some())
    }

    /// `made_for`: `unknown` and the type that is meant, for `view_of_anything_as`; `never` and the union, for `view_of_either`. It is kept
    /// where a spread keeps its operands, with a rank that no spread has: that tells the type from every other, in every checker.
    fn view_with_all_names(&mut self, parts: &[TypeId], made_for: (TypeId, TypeId)) -> TypeId {
        let is_of_anything = made_for.0 == TypeId::UNKNOWN;
        let mut of_parts = Vec::with_capacity(parts.len());
        for &part in parts {
            let apparent = self.apparent_type(part);
            of_parts.extend(self.members(apparent));
        }
        let mut shape = Shape::new_in(self.arena);
        let mut seen: FxHashSet<Atom> = FxHashSet::default();
        for members in &of_parts {
            for prop in members.shape().props.iter().filter(|prop| seen.insert(prop.name)) {
                let (mut types, mut is_optional, mut flags) = (Vec::new(), is_of_anything, PropFlags::METHOD);
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
                shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY, name_type: TypeId::UNRESOLVED });
            }
        }
        self.sort_by_name(&mut shape);
        (shape.created_from, shape.spread_rank) = (Some(made_for), u32::MAX);
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
    /// * `undefined` and `null` stay what they are. They are converted where the value enters a declared place that cannot hold them: `Builder::fit`.
    /// * Any other primitive becomes one of the primitives of `target`, by the conversions of the language. So those of `source` are gone. Which
    ///   string or number it is, is not looked at: `5 as 1 | 2` is a number, and so is `2.5 as Small`, an enum.
    /// * An object stays the same object. It is made one of `target` if it can be: it is one, it was made as less and has what is
    ///   missing, it is plain data. Otherwise it is what it was. So the result is of `target` or of one of the object types of `source`.
    /// * If nothing is known of `e`, it is of `target` or anything: `view_of_anything_as` of the parts of `target` that say which properties
    ///   an object has. An array, an object of a class of the engine is what nothing can be made: those parts stay, and whoever emits the
    ///   cast sees that there is no room for anything else and asserts. Not so with a function.
    /// * Not so with `Error` and what extends it, which are types like any other here: `catch (e) { (e as Error).message }` is everywhere,
    ///   and what is thrown may be anything. Where `target` is nothing else, see `lets_everything_through`, a primitive stays what it is too.
    /// * So it is if `target` has no objects: `raw as string` of a `string | Tree` is a string or a `Tree`.
    pub fn type_coerced(&mut self, source: TypeId, target: TypeId) -> TypeId {
        // Where the result is `target`, it is the very type that was given: whoever asks compares the two.
        let given = target;
        let (source, target) = (self.reduced(source), self.reduced(target));
        let is_untyped = self.is_untyped(source);
        let may_be_any_object = is_untyped || self.is_of_several_kinds_of_primitives(source);
        if self.says_nothing(target) || (!is_untyped && self.is_provably_assignable(source, target)) {
            return given;
        }
        let lets_everything_through = self.lets_everything_through(target);
        if lets_everything_through && !is_untyped {
            return self.union(&[target, source]);
        }
        let (mut views, mut parts, mut is_as_given) = (Vec::new(), Vec::new(), true);
        for &part in self.parts(target) {
            if self.has_primitive_flag(part) {
                let widened = if self.is_number_like(part) {
                    TypeId::NUMBER
                } else if self.is_string_like(part) {
                    TypeId::STRING
                } else {
                    self.base_of_literal(part)
                };
                // `boolean` has all that its parts widen to.
                is_as_given &= self.parts(widened).iter().all(|of_widened| self.parts(target).contains(of_widened));
                parts.push(widened);
            } else if is_untyped && self.can_be_made_of_anything(part) {
                views.push(part);
            } else {
                parts.push(part);
            }
        }
        if !views.is_empty() {
            let views = self.union(&views);
            parts.push(self.view_of_anything_as(views));
        }
        if lets_everything_through {
            parts.extend([TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL, TypeId::UNDEFINED, TypeId::NULL]);
        }
        let number_of_target = parts.len();
        // Of a value of which nothing is known as well: an object stays the object it is.
        // So it does under a cast to a function type, which asserts nothing: the call does, by the language. `memo(C) as typeof C` is an object that nobody calls.
        let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        if may_be_any_object && objects.into_iter().all(|part| matches!(self.built_in_that_is(part), Some(BuiltIn::Function))) {
            parts.push(TypeId::OBJECT);
        }
        if !is_untyped {
            parts.extend(self.parts(source).iter().copied().filter(|&part| !self.has_primitive_flag(part)));
        }
        // `undefined` and `null` pass: `o.flag as boolean` is how people strip `| undefined`, and they go on to compare with it. Only `!` asserts. The type says so where it
        // matters: a bare number or boolean has no room for them. Whatever else `target` is, is kept as a cell or boxed, which holds nil whatever the type says.
        let is_kept_bare = self.parts(target).iter().all(|&part| self.has_primitive_flag(part)) && self.parts(target).iter().any(|&part| self.is_number_like(part) || part == TypeId::BOOLEAN || self.parts(TypeId::BOOLEAN).contains(&part));
        for nil in [TypeId::UNDEFINED, TypeId::NULL] {
            if is_kept_bare && (is_untyped || self.parts(source).contains(&nil)) && !parts.contains(&nil) {
                parts.push(nil);
            }
        }
        if is_as_given && views.is_empty() && parts.len() == number_of_target { given } else { self.union(&parts) }
    }

    /// Primitives of more than one kind and nothing else: `boolean | number | string`. Nil is no kind. A place of such a type has room for an object that an `as` has let through:
    /// `Declared::is_of_several_kinds_of_primitives`.
    pub fn is_of_several_kinds_of_primitives(&mut self, ty: TypeId) -> bool {
        let ty = self.reduced(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let mut kinds: Vec<TypeId> = Vec::new();
        for part in parts {
            if !self.has_primitive_flag(part) {
                return false;
            }
            if part.is_undefined() || part.is_null() {
                continue;
            }
            let kind = if self.is_number_like(part) {
                TypeId::NUMBER
            } else if self.is_string_like(part) {
                TypeId::STRING
            } else {
                self.base_of_literal(part)
            };
            if !kinds.contains(&kind) {
                kinds.push(kind);
            }
        }
        kinds.len() > 1
    }

    /// Whether an object of which nothing is known can be made one of the type, which is a part of the target of a cast: it says which properties an object has, and is no array, no function and
    /// no class of the engine.
    pub(super) fn can_be_made_of_anything(&mut self, part: TypeId) -> bool {
        self.says_properties(part)
            && self.has_properties(part)
            && self.element_of_array_subtype(part).is_none()
            && (self.built_in_that_is(part).is_none() || self.extends_error(part))
            && (!self.is_left_without_a_layout(part) || self.extends_error(part))
    }

    /// An interface that `lib.*.d.ts` declares, or all of whose declarations are ambient: it says what code without a body hands out. There is no layout for it, so nothing is made one of it:
    /// `FileBuild::is_object_type_of_program`.
    fn is_left_without_a_layout(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => self.files().module(target.file).is_lib || self.is_ambient_interface(target),
            _ => false,
        }
    }

    /// Whether the objects of the type are those of the class `Error` of the engine, or of what extends it.
    fn extends_error(&mut self, ty: TypeId) -> bool {
        let Some(BuiltIn::Instance(class)) = self.built_in_that_is(ty) else { return false };
        matches!(*self.data(class), TypeData::Ref { target, .. } if self.atoms().bytes(self.files().symbol(target).name) == b"Error")
    }

    /// `e as Error`, `e as MyError | undefined`: all that the type has besides nil is `Error` or extends it. Such a cast does nothing at all
    /// to a value, whatever it is.
    pub fn lets_everything_through(&mut self, target: TypeId) -> bool {
        let target = self.reduced(target);
        let mut has_error = false;
        for &part in self.parts(target) {
            if part.is_undefined() || part.is_null() {
                continue;
            }
            if !self.extends_error(part) {
                return false;
            }
            has_error = true;
        }
        has_error
    }

    /// `(x as T).name`, `p.name` where `p` holds what a cast has yielded: the object need not be a `T`, so what is read need not be a
    /// `T["name"]`. The read is a coercion itself, as if `x.name as T["name"]` were written. For such a read `e`: the type of what is found,
    /// `unknown` where the object need not have the property, and the type it is coerced to. What the object has not is `undefined`, and
    /// so is what need not be there by the type that is found, and what a chain yields that is cut short.
    pub fn property_read_of_coerced(&mut self, file: FileId, e: ExprId) -> Option<(TypeId, TypeId)> {
        let ExprKind::Dot { obj, name, chain, .. } = self.hir(file)[e].kind else { return None };
        if matches!(self.hir(file)[obj].kind, ExprKind::Super) || !self.has_declared_type(file, e) {
            return None;
        }
        let known = self.type_yielded_by(file, obj);
        if known == self.type_of_expr(file, obj) || self.says_nothing(known) {
            return None;
        }
        // `(x as string).length`: the string's: see `has_no_objects_by_its_type`.
        if self.has_no_objects_by_its_type(file, obj) {
            return None;
        }
        let object = self.non_nullable(known);
        let is_of_anything = self.parts(object).iter().any(|&part| self.is_view_of_anything(part));
        let found = if is_of_anything { None } else { self.type_of_property(object, name) };
        let target = self.type_of_expr(file, e);
        let may_be_missing = chain != Chain::No || found.is_none_or(|found| self.contains_undefined(found));
        let target = if may_be_missing { self.union(&[target, TypeId::UNDEFINED]) } else { target };
        Some((found.unwrap_or(TypeId::UNKNOWN), target))
    }

    /// `e` is a string, a number, a boolean and the like to the checker. What it yields may be an object all the same, which an `as` has let through. Whoever only looks sees that
    /// object. A use that needs the primitive asserts that it is one, or goes by it as a prediction: `FileBuild::used_as_its_type`.
    pub fn has_no_objects_by_its_type(&mut self, file: FileId, e: ExprId) -> bool {
        let declared = self.type_of_expr(file, e);
        let parts: Vec<TypeId> = self.parts(declared).to_vec();
        !self.says_nothing(declared) && !parts.is_empty() && parts.into_iter().all(|part| self.has_primitive_flag(part))
    }

    /// Whether the type is one about what the program is given from outside. Such a type is a prediction, and a prediction never asserts.
    pub fn is_prediction_about_what_is_given(&self, _declared: TypeId) -> bool {
        false
    }

    /// `has_no_objects_by_its_type`, and a use of `e` asserts.
    pub fn is_asserted_where_it_is_used(&mut self, file: FileId, e: ExprId) -> bool {
        let declared = self.type_of_expr(file, e);
        self.has_no_objects_by_its_type(file, e) && !self.is_prediction_about_what_is_given(declared)
    }

    /// An object of which nothing is known is in a place of the view from here on. `source`: the checker's type of it.
    pub fn note_foreign(&mut self, view: TypeId, source: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_foreign(view, (source != TypeId::UNRESOLVED).then_some(source), at);
    }

    fn has_a_namespace_among_its_parts(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::Anon { origin: Origin::Module(..), .. }))
    }

    pub fn may_yield_a_namespace(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::ImportCall { .. } => true,
            ExprKind::Await(inner) | ExprKind::As { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } => self.may_yield_a_namespace(file, inner),
            ExprKind::Cond { yes, no, .. } => self.may_yield_a_namespace(file, yes) || self.may_yield_a_namespace(file, no),
            ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name) == b"require") => true,
            _ => {
                let own = self.type_of_expr(file, e);
                let awaited = self.awaited(own);
                self.has_a_namespace_among_its_parts(own) || self.has_a_namespace_among_its_parts(awaited)
            }
        }
    }

    pub(super) fn noted_creations(&mut self) -> &mut Creations {
        &mut self.aot.flows.noted.creations
    }

    pub(super) fn escapes_noted(&mut self) -> &mut Escapes {
        &mut self.aot.flows.noted.escapes
    }

    pub(super) fn noted_constructions(&mut self) -> &mut Constructions {
        &mut self.aot.flows.noted.constructions
    }

    /// The value of the expression `value` is stored to the field `name` of an object. `holder`: with `is_birth`, the layout that it is being
    /// allocated as. Else the supertype that it is looked at as.
    pub fn note_callee_stored(&mut self, holder: TypeId, name: Atom, file: FileId, value: ExprId, is_birth: bool) {
        let callee = self.callee_yielded_by(file, value, 0).callee;
        if callee != Callee::Nothing {
            let noted = &mut self.aot.flows.noted;
            join_callee(if is_birth { &mut noted.callees_at_birth } else { &mut noted.callees_stored }, (holder, name), callee);
        }
    }

    /// The same for a closure of the function, which a declaration stores there: `namespace N { export function f() {} }`.
    pub fn note_callee_declared(&mut self, holder: TypeId, name: Atom, file: FileId, func: FnId) {
        join_callee(&mut self.aot.flows.noted.callees_stored, (holder, name), Callee::One(file, func));
    }

    /// An object is made as `ty` says.
    pub fn note_allocation(&mut self, ty: TypeId) {
        let ty = self.laid_out_as(ty);
        self.aot.flows.noted.allocated_at_site.insert(ty);
    }

    /// `const host: Host = system as any`, where a `Host` is neither more nor less than a `System`, and what is missing is stored next. It is
    /// the same object, and goes on being used as a `System`. What such a cast makes of it: a `System & Host`, which is both. `None` if
    /// one of the types is the other and more, or nothing can be both.
    ///
    /// Not for a supertype that a coercion made: `const name = (child as NamedDeclaration).name; isPropertyName(name)`. It says what `name`
    /// was coerced to, not what it is, which may be a `QualifiedName`. An intersection with it would assert its discriminants.
    pub fn type_of_both(&mut self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let not_known_before = self.aot.flows.times_not_known;
        if self.is_view_made_by_coercion(source) || self.is_view_made_by_coercion(target) {
            return None;
        }
        let are_laid_out = self.says_properties(source) && self.says_properties(target) && !self.is_type_of_instances(source) && !self.is_type_of_instances(target);
        if !are_laid_out || self.is_of_type(target, source) || self.is_of_type(source, target) || self.aot.flows.times_not_known != not_known_before {
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
    /// `is_vouched`: the operations say nothing of the value, and `sources` is what the checker takes it for. `may_change`: it is a cast, and
    /// does not only make sure. `is_guard`: it is a type guard, which makes no copy of plain data.
    ///
    /// A cast may make an object of `target`: of plain data a copy, of an object that was made as something `target` extends that
    /// object. Nothing becomes an object of a class but by its constructor. What it makes of which layout is found at the link.
    pub fn note_cast(&mut self, sources: &[TypeId], target: TypeId, may_be_plain: bool, is_vouched: bool, may_change: bool, is_guard: bool) {
        let at = self.aot.flows.place;
        if may_be_plain && !self.is_type_of_instances(target) {
            self.aot.flows.noted.copied_into.insert(target);
        }
        if is_vouched {
            self.aot.flows.noted.add_vouched_inflow(target, at);
        }
        let noted = &mut self.aot.flows.noted;
        (if may_change { &mut noted.casts } else { &mut noted.tests }).extend(sources.iter().filter(|&&source| source != target).map(|&source| (source, target)));
        if !may_change {
            return;
        }
        if is_guard {
            noted.guards.extend(sources.iter().filter(|&&source| source != target).map(|&source| (source, target)));
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
        }
    }

    /// The cast from `sources` to `target`, which `note_cast` has been told of, is forced: `x as unknown as T`, `<T><any>x`, or it is at the way out of generic code and stands for such a cast to a type
    /// with type parameters in there. It makes what it can of an object, and refuses none.
    pub fn note_forced_cast(&mut self, sources: &[TypeId], target: TypeId) {
        self.aot.flows.noted.forced.extend(sources.iter().filter(|&&source| source != target).map(|&source| (source, target)));
    }

    /// `e`: a call. What the declaration of the function says it yields, where this call yields something else: `createToken<TKind>(kind)` is
    /// declared to yield a `Token<TKind>`, which is what it makes, and yields an `AsteriskToken` here.
    pub fn declared_result_of_call(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let sig = self.resolved_signature(file, e).sig?;
        let (of, func, _) = self.sig_decl(sig)?;
        let declared = self.return_type_of_fn(of, func);
        (declared != self.sig_return(sig)).then_some(declared)
    }

    /// If the call `e` yields its first argument itself, whatever more the type of the call says of it: that argument. `Object.assign(target,
    /// ..)`, which is a `T & U`, `Object.freeze(o)`, a `Readonly<T>`, `seal`, `preventExtensions`, `defineProperty`, `defineProperties`,
    /// `setPrototypeOf`. The function is known by the signature the call is resolved to. For a function of the program:
    /// `Checker::argument_handed_back_by_function`.
    pub fn argument_handed_back_by(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        const NAMES: [&[u8]; 7] = [b"assign", b"freeze", b"seal", b"preventExtensions", b"defineProperty", b"defineProperties", b"setPrototypeOf"];
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return None };
        if name.is_none() || !NAMES.contains(&self.atoms().bytes(name)) || !self.names_global_object(file, obj, b"Object") {
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

    /// `f.call(x as A)`, `id(x as A)`. `e`: an argument of a call or a `new`. Whether the parameter that takes it is declared as a type parameter of the very
    /// signature that is called, and the call writes no type arguments: then the parameter has its type from the arguments, and nobody has
    /// written it down but they.
    pub fn is_taken_as_what_the_arguments_say(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return false };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return false };
        if hir.ids(hir[call].type_args).next().is_some() || hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(index) = hir.ids(hir[call].args).position(|argument| argument == e) else { return false };
        let Some(sig) = self.resolved_signature(file, parent).sig else { return false };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else { return false };
        let declared = self.sig_of_fn(declared_in, func);
        let parameters = self.sig_params(declared);
        let Some(taking) = self.param_type_at(&parameters, index) else { return false };
        self.sig_type_params(declared).iter().any(|&parameter| parameter == taking)
    }

    /// Whether `undefined` is of the type. Of a type parameter it may be.
    pub fn admits_undefined(&mut self, ty: TypeId) -> bool {
        self.admits_nil(ty) || self.parts(ty).iter().any(|&part| part.is_any() || part.is_undefined() || matches!(part, TypeId::UNKNOWN | TypeId::VOID | TypeId::UNRESOLVED) || self.is_instantiable(part))
    }

    /// An expression is of type `ty`. Takes note of the intersections in it with an array, a function or a class of the engine: there are
    /// objects of such a type, they are not laid out, and no declaration names it.
    pub fn note_type_of_expression(&mut self, ty: TypeId) {
        for &part in self.parts(ty) {
            if matches!(self.data(part), TypeData::Intersection(_)) && (self.element_of_array_subtype(part).is_some() || self.built_in_extended_by(part).is_some()) {
                self.aot.flows.noted.not_laid_out.insert(part);
            }
            if matches!(self.data(part), TypeData::Anon { origin: Origin::Module(..), .. }) {
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

    /// Data of the origin is held to `ty`, by a cast or by a place whose type is written down. `is_in_container`: nothing is made of it from the top, as with the value of a
    /// JSON module. A cast walks no container, so what is in one stays what it is, with all that it holds: the views that it is looked at as from
    /// then on take it as it is, if it is known for data.
    pub fn note_what_stays_untyped(&mut self, ty: TypeId, is_in_container: bool, origin: OriginOfData) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let (mut seen, mut views) = (FxHashSet::default(), Vec::new());
        self.add_what_stays_untyped(ty, is_in_container, &mut seen, &mut views);
        if origin.is_known_for_data() {
            for view in views {
                self.note_foreign(view, TypeId::UNRESOLVED);
            }
        }
    }

    // ───────────────────────────── what the program is given ─────────────────────────────

    /// Whether declaration files alone declare the interface or the class. What they declare is made elsewhere: nothing is laid out by it, and what is read out of it is a prediction already (trust.rs), but for the language's and the host's own
    /// objects, which are made of nobody's data and cannot be replaced: `Math`, `JSON`, `console`. Not an array: what is handed in as one need not be one.
    fn is_declared_outside(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => !self.is_array(ty) && self.files().decls_of(target).iter().all(|&(declared_in, _)| self.hir(declared_in).kind == FileKind::Declaration),
            _ => false,
        }
    }

    /// Whether data from outside the program is looked at as the type. Types are facts about what the program makes and predictions about what it is given: a place of such a type holds
    /// anything, and the type is what it is expected to hold. ASSERTED.md 1.
    pub(super) fn explain_taint(&mut self) -> Vec<String> {
        let files = self.files();
        let mut seen: FxHashSet<Sym> = FxHashSet::default();
        let mut declared: Vec<Sym> = Vec::new();
        for (file, module) in files.modules.iter().enumerate() {
            if module.is_untyped() || self.only_declares(FileId(file as u32)) {
                continue;
            }
            for (id, symbol) in module.bound.symbols.iter().enumerate() {
                let sym = files.sym(FileId(file as u32), SymbolId(id as u32));
                if symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE) && seen.insert(sym) {
                    declared.push(sym);
                }
            }
        }
        let given = self.given();
        let (mut all, mut by_identity, mut by_looks, mut otherwise) = (0u32, 0u32, 0u32, 0u32);
        let mut lost: Vec<String> = Vec::new();
        for sym in declared {
            let ty = self.declared_type(sym);
            if !self.says_properties(ty) || !self.may_hold_objects(ty) || self.is_declared_outside(ty) {
                continue;
            }
            all += 1;
            if !self.is_tainted(ty) {
                continue;
            }
            let identity = self.identity_of_type(ty);
            if given.identities.contains(&identity) {
                by_identity += 1;
            } else if self.takes_what_is_given(ty, given) {
                by_looks += 1;
                if lost.len() < 8 {
                    let name = self.name_for_people(ty);
                    lost.push(format!("alterations: given: where: by its looks: {name}"));
                }
            } else {
                otherwise += 1;
            }
        }
        let mut lines = vec![format!("alterations: given: of the {all} classes and interfaces that compiled files declare, data from outside is looked at as {by_identity} by what they are, {by_looks} by their looks, {otherwise} otherwise; {} types are given", given.identities.len())];
        lines.append(&mut lost);
        lines
    }

    pub fn is_tainted(&mut self, ty: TypeId) -> bool {
        if self.aot.flows.is_searching_from_doors || !(self.says_properties(ty) || self.is_array_or_tuple(ty)) {
            return false;
        }
        if let Some(&known) = self.aot.flows.tainted.get(&ty) {
            return known;
        }
        if !self.may_hold_objects(ty) || self.is_declared_outside(ty) {
            self.aot.flows.tainted.insert(ty, false);
            return false;
        }
        let given = self.given();
        if given.identities.is_empty() {
            return false;
        }
        // The type that a literal is checked against may be that of another literal.
        self.aot.flows.tainted.insert(ty, false);
        self.aot.flows.being_asked_of_taint += 1;
        let identity = self.identity_of_type(ty);
        let is_tainted = given.identities.contains(&identity) || self.takes_what_is_given(ty, given) || self.is_type_of_literal_that_is_given_otherwise(ty, given) || self.is_type_of_plain_literal(ty);
        self.aot.flows.being_asked_of_taint -= 1;
        self.aot.flows.tainted.insert(ty, is_tainted);
        is_tainted
    }

    fn is_type_of_literal_that_is_given_otherwise(&mut self, ty: TypeId, given: &Given) -> bool {
        if !matches!(self.data(ty), TypeData::Anon { origin: Origin::ObjectLiteral(..), .. }) {
            return false;
        }
        let regular = self.regular_type_of_object_literal(ty);
        let widened = self.get_widened_type(regular);
        [regular, widened].into_iter().any(|other| other != ty && given.identities.contains(&self.identity_of_type(other)))
    }

    /// Whether it is the type of an object literal that stands where a tainted type is expected. Such a literal is made as a plain object (`FileBuild::is_asked_to_be_dynamic`). A place that takes its type from an initializer takes it from
    /// what the initializer is made as: the field of the literal around it, an element of the array literal around it, `const x = { .. } satisfies T`, a result that is inferred.
    /// `{ A: { p: [] } } satisfies { [N in Names]?: Row<N> }`: the inner literal is checked against `Row<"A">` and stored to a field of the outer one, which is of the inner one's own type.
    fn is_type_of_plain_literal(&mut self, ty: TypeId) -> bool {
        let (TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, ..), .. } | TypeData::Anon { origin: Origin::WidenedLiteral(file, literal, ..), .. }) = *self.data(ty) else { return false };
        matches!(self.hir(file)[literal].kind, ExprKind::Object(_)) && self.contextual_type_of_literal(file, literal).is_some_and(|expected| self.has_tainted_part(expected))
    }

    /// The search is made once for the program: a task that finds it made reads it. Tasks that find it missing at the same time all make it, and come to the same.
    pub(super) fn is_searching_from_doors(&self) -> bool {
        self.aot.flows.is_searching_from_doors
    }

    fn given(&mut self) -> &'p Given {
        let program = self.p;
        if let Some(given) = program.aot.storage.given.get() {
            return given;
        }
        // By a checker of its own, outside the plan: what it finds out on the way is dropped with it. So the task that happens to make the search is left as every other task is: with nothing looked at out of its order, and
        // nothing remembered from while no type was tainted.
        let search = Search { seen_by_other_declarations: self.importers_that_see_other_declarations(), ..Search::new(1) };
        let mut searcher = program.checker();
        searcher.begin_task(0, 0, true);
        (searcher.stack_base, searcher.stack_limit) = (self.stack_base, self.stack_limit);
        searcher.aot.flows.is_searching_from_doors = true;
        searcher.search_from_doors(&search, 0, &Share::Rest { index: 0, of: 1, is_taken: &[] }, &FxHashMap::default());
        drop(searcher);
        program.aot.storage.given.get_or_init(|| search.found())
    }

    fn said_by_properties_of(&mut self, ty: TypeId) -> Option<Vec<(Box<[u8]>, Said)>> {
        if self.is_array_or_tuple(ty) {
            return None;
        }
        let mut properties = Vec::new();
        if let Some(members) = self.members(ty) {
            for prop in members.shape().props.iter() {
                let name: Box<[u8]> = self.atoms().bytes(prop.name).into();
                if is_keyed_by_symbol(&name) {
                    continue;
                }
                let of_prop = self.type_of_prop(prop, members.mapper);
                properties.push((name, self.said_by(of_prop)));
            }
        }
        properties.sort_unstable_by(|one, other| one.0.cmp(&other.0));
        Some(properties)
    }

    fn said_by(&mut self, ty: TypeId) -> Said {
        let ty = self.reduced(ty);
        let mut said = Said { kinds: self.kinds_said_by(ty), strings: Vec::new(), numbers: Vec::new() };
        for literal in self.literals_of_type(ty) {
            match literal {
                Literal::String(text) => said.strings.push(self.atoms().bytes(text).into()),
                Literal::Number(number) => said.numbers.push(number.to_bits()),
            }
        }
        said.strings.sort_unstable();
        said.numbers.sort_unstable();
        said
    }

    /// Which kinds of values the type has room for, nil aside, as far as that is read off it without a question to the checker's relations.
    fn kinds_said_by(&mut self, ty: TypeId) -> u16 {
        let ty = self.reduced(ty);
        match self.data(ty) {
            TypeData::Union(parts) => parts.to_vec().into_iter().fold(0, |all, part| all | self.kinds_said_by(part)),
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::String => said::STRING,
                Intrinsic::Number => said::NUMBER,
                Intrinsic::BigInt => said::BIGINT,
                Intrinsic::Symbol => said::SYMBOL,
                Intrinsic::Object => said::RECORDS | said::ARRAYS | said::FUNCTIONS,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening | Intrinsic::Never => 0,
                _ => said::ANYTHING,
            },
            TypeData::StringLit { .. } | TypeData::EnumLit { value: EnumValue::String(_), .. } | TypeData::Template { .. } | TypeData::StringMapping { .. } => said::STRING,
            TypeData::NumberLit { .. } | TypeData::EnumLit { value: EnumValue::Number(_), .. } => said::NUMBER,
            TypeData::BigIntLit { .. } => said::BIGINT,
            TypeData::BoolLit { value: true, .. } => said::TRUE,
            TypeData::BoolLit { .. } => said::FALSE,
            TypeData::UniqueSymbol { .. } => said::SYMBOL,
            TypeData::Ref { .. } | TypeData::Tuple { .. } | TypeData::Anon { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } | TypeData::Fns { .. } => {
                if self.is_array_or_tuple(ty) || self.element_of_array_subtype(ty).is_some() {
                    said::ARRAYS
                } else if self.is_declared_outside(ty) || self.is_empty_object_type(ty) {
                    // `Iterable<T>`, `ArrayLike<T>`, `{}`
                    said::ANYTHING
                } else if matches!(self.built_in_that_is(ty), Some(BuiltIn::Function)) {
                    said::FUNCTIONS
                } else {
                    said::RECORDS
                }
            }
            _ => said::ANYTHING,
        }
    }

    /// Where the data may go on to: whether one of the types that the search has found may be assignable to the type: `takeDeep(node: Deep<All>)`, handed a `node: All`; `Readonly<T>`, `Partial<T>`, `Pick<T, ..>`, a base interface. Asked of a
    /// type when somebody has to do with it, once: nobody goes through the types of the program. It goes by the names of the properties and by the kinds of what they hold, which every task finds the same: whoever is assignable has every
    /// required property and one of the properties at least, and holds nothing there that the type has no room for.
    fn takes_what_is_given(&mut self, ty: TypeId, given: &Given) -> bool {
        if !self.says_properties(ty) || self.is_type_of_instances(ty) || self.built_in_that_is(ty).is_some() || self.element_of_array_subtype(ty).is_some() {
            return false;
        }
        let Some(members) = self.members(ty) else { return false };
        if given.went_on_by_pairs
            && members.shape().props.len() <= MOST_PROPERTIES_OF_A_RECORD_THAT_IS_TURNED_WHERE_IT_LIES
            && (members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::OPTIONAL)).count() >= 2
                || (matches!(self.data(ty), TypeData::Ref { .. }) || self.alias_of_type(ty).is_some())
                    && self.generic_form_of(ty).and_then(|form| self.members(form)).unwrap_or(members).shape().props.iter().any(|prop| {
                        let held = self.type_of_prop(prop, MapperId::IDENTITY);
                        let held = if self.is_instantiable(held) { self.base_constraint(held) } else { held };
                        self.says_nothing(held) || self.may_hold_objects(held) || self.parts(held).iter().any(|&part| matches!(self.data(part), TypeData::Fns { .. }))
                    }))
        {
            return false;
        }
        let atoms = self.atoms();
        let names: Vec<(&[u8], bool)> = members.shape().props.iter().map(|prop| (atoms.bytes(prop.name), prop.flags.contains(PropFlags::OPTIONAL))).filter(|name| !is_keyed_by_symbol(name.0)).collect();
        let none = Vec::new();
        let having = |name: &[u8]| given.by_name.get(name).unwrap_or(&none);
        let lists: Vec<&Vec<u32>> = match names.iter().filter(|name| !name.1).map(|name| having(name.0)).min_by_key(|having| having.len()) {
            Some(fewest) => vec![fewest],
            None => names.iter().map(|name| having(name.0)).collect(),
        };
        // What the type itself says is only found out once one has the names.
        let mut taken: Vec<(&[u8], Said)> = Vec::new();
        for &index in lists.into_iter().flatten() {
            let held = &given.properties[index as usize];
            if !names.iter().all(|&(name, is_optional)| is_optional || held.contains_key(name)) {
                continue;
            }
            if taken.is_empty() {
                for prop in members.shape().props.iter() {
                    let of_prop = self.type_of_prop(prop, members.mapper);
                    taken.push((atoms.bytes(prop.name), self.said_by(of_prop)));
                }
            }
            if taken.iter().all(|(name, taken)| held.get(*name).is_none_or(|held| held.may_fit(taken))) {
                return true;
            }
        }
        false
    }

    /// Whether the value of the expression is what the program is given, or is read out of that: it is of a tainted type, a prediction, or a property or an element of one. Nothing is asserted of it, and no cast makes
    /// anything of it.
    pub fn is_given(&mut self, file: FileId, e: ExprId) -> bool {
        let own = self.type_of_expr(file, e);
        self.has_tainted_part(own) || self.unvouched_claim(file, e).is_some() || self.is_predicted(file, e)
    }

    /// `--aot-explain=given`: of the unions of two or more record types that are written in a typed text, of the program's graph or not: how many have a member that is tainted and one that is not, and how many there are. A place of such a union holds
    /// anything, and a narrowing that names the other member expects its layout.
    /// And of the first: how many have no member that the search has found: a member only takes what was found, by its names, kinds and discriminants: it looks like what is given.
    pub fn count_unions_given_in_part(&mut self) -> (usize, usize, usize) {
        let (mut in_part, mut by_looks, mut all) = (0, 0, 0);
        for file in (0..self.files().modules.len() as u32).map(FileId) {
            if self.hir(file).kind == FileKind::Declaration || self.is_untyped_file(file) {
                continue;
            }
            let hir = self.hir(file);
            for (index, node) in hir.types.iter().enumerate() {
                if !matches!(node.kind, crate::hir::TypeNodeKind::Union(_)) {
                    continue;
                }
                let union = self.type_from_node(file, TypeNodeId(index as u32));
                let (mut tainted, mut found, mut records) = (0, 0, 0);
                for member in self.parts(union).to_vec() {
                    let member = self.reduced(member);
                    if self.says_properties(member) && !self.is_type_of_instances(member) && self.built_in_that_is(member).is_none() && self.element_of_array_subtype(member).is_none() && !self.is_declared_outside(member) {
                        records += 1;
                        if self.is_tainted(member) {
                            tainted += 1;
                            let identity = self.identity_of_type(member);
                            found += usize::from(self.given().identities.contains(&identity));
                        }
                    }
                }
                if records > 1 {
                    all += 1;
                    if tainted != 0 && tainted != records {
                        in_part += 1;
                        by_looks += usize::from(found == 0);
                    }
                }
            }
        }
        (in_part, by_looks, all)
    }

    /// Whether there is such a type in the program at all.
    pub fn is_any_type_tainted(&mut self) -> bool {
        !self.aot.flows.is_searching_from_doors && !self.given().identities.is_empty()
    }

    /// Whether no object of the type is laid out by it, nor an element of an array of it: primitives, arrays of them, what the engine makes. Such a type is everybody's and cannot be tainted.
    pub(super) fn is_laid_out_nowhere(&mut self, ty: TypeId) -> bool {
        let (mut seen, mut found) = (FxHashSet::default(), Vec::new());
        self.add_object_types_in(ty, true, &mut seen, &mut found);
        found.is_empty()
    }

    /// The same for one of the parts of a union.
    pub fn has_tainted_part(&mut self, ty: TypeId) -> bool {
        if !matches!(self.data(ty), TypeData::Union(_)) {
            return self.is_tainted(ty);
        }
        if !self.is_any_type_tainted() {
            return false;
        }
        if let Some(&known) = self.aot.flows.with_tainted_part.get(&ty) {
            return known;
        }
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        let has_one = parts.into_iter().any(|part| self.is_tainted(part));
        if self.aot.flows.being_asked_of_taint == 0 {
            self.aot.flows.with_tainted_part.insert(ty, has_one);
        }
        has_one
    }

    /// Whether the expression is of such a type by itself: `export const kept = { .. }`, which untyped code imports and stores to.
    pub fn is_of_tainted_type(&mut self, file: FileId, e: ExprId) -> bool {
        let own = self.type_of_expr(file, e);
        self.has_tainted_part(own)
    }

    /// It goes by the trees, the symbols and the checker's types alone: every task finds the same, and nothing is remembered on the way that the answer would change.
    pub fn search_with_the_others(&mut self, meeting: &Meeting, index: usize, share: &Share<'_>) {
        let program = self.p;
        let own_pairs = self.targets_compared_by_source();
        self.aot = Default::default();
        self.aot.flows.is_searching_from_doors = true;
        self.aot.flows.seen_before = meeting.search.seen_before.clone();
        if let Share::Rest { .. } = share {
            for file in (0..program.files.modules.len() as u32).map(FileId) {
                if self.is_untyped_file(file) {
                    self.task.begin_file(file, false);
                }
            }
        }
        self.search_from_doors(&meeting.search, index, share, &own_pairs);
        if meeting.barrier.wait().is_leader() {
            let _ = program.aot.storage.given.set(meeting.search.found());
        }
        meeting.barrier.wait();
        self.aot = Default::default();
    }

    fn go_through_the_doors(&mut self, search: &Search, share: &Share<'_>, held_to: &mut Vec<TypeId>, looked_at: &mut Vec<LookedAt>, written_unions: &mut Vec<WrittenUnion>) -> bool {
        let count = self.files().modules.len() as u32;
        let all = move || (0..count).map(FileId);
        let weights: Vec<u64> = all().map(|file| self.hir(file).exprs.len() as u64 + 1).collect();
        let mine: FxHashSet<FileId> = if let Share::Of(mine) = share { mine.iter().copied().collect() } else { FxHashSet::default() };
        let own = |files: &[FileId]| -> Vec<FileId> {
            match *share {
                Share::Of(_) => files.iter().copied().filter(|file| mine.contains(file)).collect(),
                Share::Rest { index, of, is_taken } => {
                    let left: Vec<FileId> = files.iter().copied().filter(|file| !is_taken.get(file.idx()).copied().unwrap_or(false)).collect();
                    share_by_weight(&left, &weights, index, of)
                }
            }
        };
        // `P.tsx.js`, which a tool has made of `P.tsx`, does what the checked text does. No value of another type gets anywhere than in the text: all that differs is that what the text makes is made as plain objects.
        let standing_in: FxHashMap<&[u8], FileId> = (all().filter(|&file| self.only_declares(file) && self.hir(file).kind != FileKind::Declaration && self.hir(file).decorators.is_empty()))
            .map(|file| (self.files().module(file).file_name(), file))
            .collect();
        let made_of: Vec<(FileId, FileId)> = (all().filter(|&file| self.is_compiled(file) && self.is_untyped_file(file)))
            .filter_map(|file| Some((file, *standing_in.get(self.files().module(file).file_name().strip_suffix(b".js")?)?)))
            .collect();
        self.aot.flows.made_of_checked_text = made_of.iter().map(|made| made.0).collect();
        self.aot.flows.checked_texts = made_of.iter().map(|made| made.1).collect();
        let texts: Vec<FileId> = made_of.iter().map(|made| made.1).collect();
        for text in own(&texts) {
            self.add_types_born_in(text, held_to);
        }
        // So the text is gone through like that of a typed file.
        let files: Vec<FileId> = all().filter(|&file| (self.is_compiled(file) || self.aot.flows.checked_texts.contains(&file)) && !self.is_untyped_file(file)).collect();
        // A type is written where its alias is: also in a module that is imported for its types alone, which is no module of the program's graph.
        let written: Vec<FileId> = all().filter(|&file| self.hir(file).kind != FileKind::Declaration && !self.is_untyped_file(file)).collect();
        for file in own(&files) {
            self.add_types_that_data_is_held_to(file, held_to);
        }
        // Untyped code of the program is outside as well: it calls what it imports with what it has made, and stores to what it is handed.
        let untyped: Vec<FileId> = all().filter(|&file| self.is_compiled(file) && self.is_untyped_file(file) && !self.aot.flows.made_of_checked_text.contains(&file)).collect();
        let (mut imported, mut crossed) = (FxHashSet::default(), FxHashSet::default());
        let seen_by_other_declarations = &search.seen_by_other_declarations;
        for file in own(&files) {
            if let Some(&at) = seen_by_other_declarations.get(&file) {
                let module = self.files().file_symbol(file);
                let value = self.files().module_value(module);
                let of_module = self.type_of_symbol(value);
                self.add_what_is_handed_to(of_module, 0, file, at, &mut FxHashSet::default(), &mut crossed, held_to);
            }
        }
        for file in own(&untyped) {
            self.add_what_is_handed_to_what_is_exported_again(file, &mut crossed, held_to);
        }
        if !untyped.is_empty() {
            for file in own(&untyped).into_iter().chain(own(&files)) {
                self.add_types_imported_across(file, &mut imported, &mut crossed, held_to);
            }
            for file in own(&files) {
                self.add_types_handed_to_javascript(file, &mut crossed, held_to);
            }
        }
        if let Some(gave_up) = self.aot.flows.gave_up_crossing.take() {
            let mut first = held(search.gave_up.lock());
            if first.as_ref().is_none_or(|known| gave_up.rank < known.rank) {
                *first = Some(gave_up);
            }
        }
        search.barrier.wait();
        if held(search.gave_up.lock()).is_some() {
            return false;
        }
        for file in own(&files) {
            self.add_what_is_looked_at_in(file, looked_at);
        }
        for file in own(&written) {
            self.add_unions_written_in(file, written_unions);
        }
        true
    }

    pub(in crate::check) fn note_pair_compared(&mut self, source: TypeId, target: TypeId, relation: Relation, is_reported: bool) {
        if self.p.files.options.undefined_properties_name_nobody && relation != Relation::Identity && (relation != Relation::Comparable || is_reported) && self.aot.flows.seen_before.is_none() && self.p.aot.storage.given.get().is_none() {
            self.aot.flows.pairs_compared.insert((source, target, is_reported));
        }
    }

    fn pairs_that_carry_on(&mut self) -> Vec<(TypeId, TypeId)> {
        let mut compared: Vec<(TypeId, TypeId, bool)> = std::mem::take(&mut self.aot.flows.pairs_compared).into_iter().collect();
        compared.sort_unstable_by_key(|pair| (pair.0.0, pair.1.0, pair.2));
        let mut pairs = Vec::new();
        for (source, target, is_reported) in compared {
            let takes = self.says_properties(target) && self.may_hold_objects(target) && !self.is_type_of_instances(target) && self.built_in_that_is(target).is_none() && self.element_of_array_subtype(target).is_none() && !self.is_declared_outside(target);
            if !takes || !self.says_properties(source) || !self.may_hold_objects(source) || !(is_reported || self.is_assignable(source, target)) {
                continue;
            }
            pairs.push((source, target));
        }
        self.aot.flows.pairs_compared.clear();
        pairs
    }

    pub(crate) fn take_pairs_compared(&mut self) -> Vec<(Identity, Identity)> {
        let mut pairs = Vec::new();
        for (source, target) in self.pairs_that_carry_on() {
            self.keep_type(target);
            pairs.push((self.identity_of_type(source), self.identity_of_type(target)));
        }
        pairs
    }

    fn targets_compared_by_source(&mut self) -> FxHashMap<Identity, Vec<TypeId>> {
        let mut targets: FxHashMap<Identity, Vec<TypeId>> = FxHashMap::default();
        for (source, target) in self.pairs_that_carry_on() {
            targets.entry(self.identity_of_type(source)).or_default().push(target);
        }
        targets
    }

    fn add_targets_of_what_is_found(&mut self, search: &Search, own_pairs: &FxHashMap<Identity, Vec<TypeId>>, kept_targets: &FxHashMap<Identity, TypeId>, followed: &mut FxHashSet<Identity>, out: &mut Vec<TypeId>) {
        if own_pairs.is_empty() && kept_targets.is_empty() {
            return;
        }
        let mut found: Vec<Identity> = {
            let by_all = held(search.tainted.read());
            let of_earlier_tasks = (!kept_targets.is_empty()).then(|| search.targets_by_source.keys());
            own_pairs.keys().chain(of_earlier_tasks.into_iter().flatten()).copied().filter(|identity| by_all.contains(identity) && !followed.contains(identity)).collect()
        };
        found.sort_unstable();
        found.dedup();
        followed.extend(found.iter().copied());
        for identity in found {
            out.extend(own_pairs.get(&identity).into_iter().flatten().copied());
            for target in search.targets_by_source.get(&identity).into_iter().flatten() {
                out.extend(kept_targets.get(target));
            }
        }
    }

    fn search_from_doors(&mut self, search: &Search, index: usize, share: &Share<'_>, own_pairs: &FxHashMap<Identity, Vec<TypeId>>) {
        let (mut held_to, mut looked_at, mut written_unions) = (Vec::new(), Vec::new(), Vec::new());
        let goes_on = search.seen_before.is_some();
        if !goes_on && !self.go_through_the_doors(search, share, &mut held_to, &mut looked_at, &mut written_unions) {
            return;
        }
        let (mut is_left_taken, mut arrays_before, mut arrays_found, mut arrays_not_said_yet): (bool, Vec<(Identity, Vec<Identity>)>, Vec<Identity>, Vec<Identity>) = (!goes_on, Vec::new(), Vec::new(), Vec::new());
        let (mut seen, mut views): (FxHashSet<(TypeId, bool)>, Vec<TypeId>) = (FxHashSet::default(), Vec::new());
        let mut gone_through: FxHashSet<(TypeId, bool)> = FxHashSet::default();
        let mut tainted: FxHashSet<TypeId> = FxHashSet::default();
        let mut arrays: Vec<(TypeId, Vec<Identity>)> = Vec::new();
        let mut listed: FxHashSet<TypeId> = FxHashSet::default();
        let mut not_said_yet: Vec<TypeId> = Vec::new();
        let mut followed: FxHashSet<Identity> = FxHashSet::default();
        let mut kept_targets: FxHashMap<Identity, TypeId> = FxHashMap::default();
        if let (false, &Share::Rest { index, of, .. }) = (search.targets_by_source.is_empty(), share) {
            for (at, ty) in self.kept_types().into_iter().enumerate() {
                if at % of == index {
                    kept_targets.insert(self.identity_of_type(ty), ty);
                }
            }
        }
        self.add_targets_of_what_is_found(search, own_pairs, &kept_targets, &mut followed, &mut held_to);
        loop {
            while search.has_any_found(held_to.len()) {
                if !is_left_taken {
                    is_left_taken = true;
                    self.take_what_was_left(search, index, share, &mut looked_at, &mut written_unions, &mut arrays_before);
                }
                for ty in held_to.drain(..) {
                    self.add_what_stays_untyped(ty, true, &mut seen, &mut views);
                }
                let mut newly: Vec<TypeId> = views.drain(..).filter(|&ty| tainted.insert(ty)).collect();
                let so_far: Vec<(TypeId, bool)> = seen.iter().copied().filter(|&one| gone_through.insert(one)).collect();
                let mut seen_to_stay = Vec::new();
                for &(ty, stays) in &so_far {
                    if stays {
                        seen_to_stay.push(self.identity_of_type(ty));
                    }
                    if self.says_properties(ty) && !self.is_type_of_instances(ty) && self.built_in_that_is(ty).is_none() && self.element_of_array_subtype(ty).is_none() && tainted.insert(ty) {
                        newly.push(ty);
                    }
                    if self.is_array_or_tuple(ty) && !tainted.contains(&ty) && listed.insert(ty) {
                        let mut parts = Vec::new();
                        for element in self.type_arguments(ty).to_vec() {
                            for part in self.parts(element).to_vec() {
                                parts.push(self.identity_of_type(part));
                            }
                        }
                        arrays.push((ty, parts));
                    }
                }
                held(search.seen.write()).extend(seen_to_stay);
                // An array of them that the data may hold. Not `string[]`, which is everybody's.
                loop {
                    let identities: Vec<Identity> = newly.iter().map(|&ty| self.identity_of_type(ty)).collect();
                    let mut names = Vec::with_capacity(newly.len());
                    for (&ty, &identity) in newly.iter().zip(&identities) {
                        self.keep_type(ty);
                        let Some(members) = self.members(ty) else { continue };
                        let atoms = self.atoms();
                        names.push((identity, members.shape().props.iter().map(|prop| atoms.bytes(prop.name).into()).collect()));
                    }
                    held(search.names.lock()).extend(names);
                    held(search.tainted.write()).extend(identities.into_iter().chain(arrays_found.iter().copied()));
                    not_said_yet.append(&mut newly);
                    arrays_not_said_yet.append(&mut arrays_found);
                    search.barrier.wait();
                    {
                        let by_all = held(search.tainted.read());
                        arrays.retain(|(ty, parts)| {
                            let is_of_them = parts.iter().any(|part| by_all.contains(part));
                            if is_of_them && tainted.insert(*ty) {
                                newly.push(*ty);
                            }
                            !is_of_them
                        });
                        arrays_before.retain(|(identity, parts)| {
                            let is_of_them = parts.iter().any(|part| by_all.contains(part));
                            if is_of_them {
                                arrays_found.push(*identity);
                            }
                            !is_of_them
                        });
                    }
                    if !search.has_any_found(newly.len() + arrays_found.len()) {
                        break;
                    }
                }
                // What the program has made and looks at as such a type is written to as the data is: `(second as ListItem).next = parsed`, `const item: ListItem = second`.
                self.add_types_looked_at_as(&mut looked_at, search, &mut held_to);
                self.add_targets_of_what_is_found(search, own_pairs, &kept_targets, &mut followed, &mut held_to);
            }
            // The members of a union that is written go together, also where one of them only takes what has been found.
            let mut said = Vec::new();
            for ty in not_said_yet.drain(..) {
                let identity = self.identity_of_type(ty);
                if !held(search.given.read()).identities.contains(&identity) {
                    said.push((identity, self.said_by_properties_of(ty)));
                }
            }
            said.extend(arrays_not_said_yet.drain(..).map(|identity| (identity, None)));
            *held(search.said[index].lock()) = said;
            search.barrier.wait();
            if index == 0 {
                search.add_what_was_said();
            }
            search.barrier.wait();
            self.add_members_of_written_unions(&written_unions, search, &mut held_to);
            if !search.has_any_found(held_to.len()) {
                break;
            }
        }
        if search.is_gone_on_with {
            let seen = held(search.seen.read());
            let mut left = held(search.left.lock());
            for it in looked_at {
                if !seen.contains(&it.target.1) || !seen.contains(&it.source.1) && self.may_hold_objects(it.source.0) {
                    left.looked_at.entry(it.file).or_default().push(it);
                }
            }
            for union in written_unions {
                if !union.members.iter().all(|member| seen.contains(&member.1)) {
                    left.unions.entry(union.file).or_default().push(union);
                }
            }
            for (ty, parts) in arrays {
                left.arrays.push((self.identity_of_type(ty), parts));
            }
        }
    }

    fn take_what_was_left(&mut self, search: &Search, index: usize, share: &Share<'_>, looked_at: &mut Vec<LookedAt>, unions: &mut Vec<WrittenUnion>, arrays: &mut Vec<(Identity, Vec<Identity>)>) {
        let (mut of_looked_at, mut of_unions) = (Vec::new(), Vec::new());
        {
            let mut left = held(search.left.lock());
            let files: Vec<FileId> = match *share {
                Share::Of(mine) => mine.to_vec(),
                Share::Rest { index, of, is_taken } => {
                    let mut files: Vec<FileId> = (left.looked_at.keys().chain(left.unions.keys()).copied()).filter(|file| !is_taken.get(file.idx()).copied().unwrap_or(false) && file.idx() % of == index).collect();
                    files.sort_unstable_by_key(|file| file.0);
                    files.dedup();
                    files
                }
            };
            for file in files {
                of_looked_at.extend(left.looked_at.remove(&file).unwrap_or_default());
                of_unions.extend(left.unions.remove(&file).unwrap_or_default());
            }
            if index == 0 {
                *arrays = std::mem::take(&mut left.arrays);
                arrays.sort_unstable();
                arrays.dedup();
            }
        }
        for mut it in of_looked_at {
            let target = self.type_from_node(it.file, it.written);
            it.target.0 = self.reduced(target);
            self.prepare_enclosing(it.file, it.operand);
            let source = self.type_of_expr(it.file, it.operand);
            it.source.0 = self.reduced(source);
            looked_at.push(it);
        }
        for mut union in of_unions {
            let written = self.type_from_node(union.file, union.node);
            let mut members = Vec::new();
            for member in self.parts(written).to_vec() {
                let member = self.reduced(member);
                if self.may_hold_objects(member) {
                    members.push(member);
                }
            }
            union.members = members.into_iter().map(|member| (member, self.identity_of_type(member))).collect();
            unions.push(union);
        }
    }

    /// A place of `A | B` holds anything as soon as `A` is tainted, a literal there that no discriminant singles out is made plain, and what is narrowed to `B` is expected to be laid out as a `B`. `taking`: `takes_what_is_given`, as far as asked.
    fn add_unions_written_in(&mut self, file: FileId, out: &mut Vec<WrittenUnion>) {
        let hir = self.hir(file);
        for (index, node) in hir.types.iter().enumerate() {
            if !matches!(node.kind, TypeNodeKind::Union(_)) {
                continue;
            }
            let union = self.type_from_node(file, TypeNodeId(index as u32));
            let mut members = Vec::new();
            for member in self.parts(union).to_vec() {
                let member = self.reduced(member);
                if self.may_hold_objects(member) {
                    members.push((member, self.identity_of_type(member)));
                }
            }
            if members.len() >= 2 {
                out.push(WrittenUnion { file, node: TypeNodeId(index as u32), members });
            }
        }
    }

    fn add_members_of_written_unions(&mut self, unions: &[WrittenUnion], search: &Search, out: &mut Vec<TypeId>) {
        let (seen, tainted, given) = (held(search.seen.read()), held(search.tainted.read()), held(search.given.read()));
        let mut taking: FxHashMap<TypeId, bool> = FxHashMap::default();
        for WrittenUnion { members, .. } in unions {
            if members.iter().all(|member| seen.contains(&member.1)) {
                continue;
            }
            let mut is_given = false;
            for &(member, identity) in members {
                is_given = tainted.contains(&identity)
                    || match taking.get(&member) {
                        Some(&known) => known,
                        None => {
                            let takes = self.takes_what_is_given(member, &given);
                            taking.insert(member, takes);
                            takes
                        }
                    };
                if is_given {
                    break;
                }
            }
            if is_given {
                out.extend(members.iter().filter(|member| !seen.contains(&member.1)).map(|member| member.0));
            }
        }
    }

    /// What a cast or an annotated variable with an initializer carries, both ways, as far as it has not been seen. BACK: the type of the operand of a cast to one of the types, of the initializer of a variable that is annotated with one.
    /// ON: the type after `as`, or the annotation, where the operand is of one of the types (`base as Derived`: no assignability tells that), or where nothing is known of the operand and it is known for data (`origin_of_data`): `load(path) as Settings`
    /// with a `load` of a package that yields `any`, `const s: Settings = loose` with a `loose` that holds what was parsed, the value of a JSON module. Not what goes through an `any` of the program's own, `(x: unknown) => x as T`: only a flow tells
    /// what gets there.
    fn add_what_is_looked_at_in(&mut self, file: FileId, out: &mut Vec<LookedAt>) {
        let hir = self.hir(file);
        let casts = self.exprs_by_kind_of(file).of(ExprTag::As).iter().filter_map(|&cast| match hir[cast].kind {
            ExprKind::As { expr, ty } => Some((ty, expr)),
            _ => None,
        });
        let annotated = hir.var_decls.iter().filter(|declaration| declaration.ty.is_some() && declaration.init.is_some()).map(|declaration| (declaration.ty, declaration.init));
        let written: Vec<(TypeNodeId, ExprId)> = casts.chain(annotated).collect();
        for (written, value) in written {
            let target = self.type_from_node(file, written);
            let target = self.reduced(target);
            if !self.may_hold_objects(target) {
                continue;
            }
            self.prepare_enclosing(file, value);
            // `x as unknown as T`: what is looked at as a `T` is `x`.
            let (mut operand, mut source) = (value, self.type_of_expr(file, value));
            while self.says_nothing(source)
                && let ExprKind::As { expr, .. } | ExprKind::NonNull(expr) = hir[operand].kind
            {
                operand = expr;
                source = self.type_of_expr(file, operand);
            }
            let source = self.reduced(source);
            let mut identities_of_parts = |ty: TypeId| -> Vec<Identity> { self.parts(ty).to_vec().into_iter().map(|part| self.identity_of_type(part)).collect() };
            let (parts_of_target, parts_of_source) = (identities_of_parts(target), identities_of_parts(source));
            let (target, source) = ((target, self.identity_of_type(target)), (source, self.identity_of_type(source)));
            out.push(LookedAt { target, parts_of_target, source, parts_of_source, file, written, operand, is_known_for_data: None });
        }
    }

    fn add_types_looked_at_as(&mut self, looked_at: &mut [LookedAt], search: &Search, out: &mut Vec<TypeId>) {
        let (seen, tainted) = (held(search.seen.read()), held(search.tainted.read()));
        for it in looked_at {
            if it.parts_of_target.iter().any(|part| tainted.contains(part)) {
                if self.may_hold_objects(it.source.0) && !seen.contains(&it.source.1) {
                    out.push(it.source.0);
                }
                continue;
            }
            if seen.contains(&it.target.1) {
                continue;
            }
            if it.parts_of_source.iter().any(|part| tainted.contains(part))
                || self.says_nothing(it.source.0) && *it.is_known_for_data.get_or_insert_with(|| self.origin_of_data(it.file, it.operand).is_some_and(|origin| origin.is_known_for_data()))
            {
                out.push(it.target.0);
            }
        }
    }

    /// Whether the code behind what the file declares is untyped code of the program that nobody has checked: JavaScript, or a TypeScript file that stands in for a declaration file. Not what a tool has made of a checked text.
    fn is_declared_for_javascript(&self, declared_in: FileId) -> bool {
        let flows = &self.aot.flows;
        self.is_untyped_file(declared_in) && !flows.made_of_checked_text.contains(&declared_in)
            || self.only_declares(declared_in) && self.hir(declared_in).kind != FileKind::Declaration && !flows.checked_texts.contains(&declared_in)
    }

    /// What the text makes, where untyped code made of it runs in its place: every object literal and the attributes of every JSX element, by its own type and by the type it is checked against. From there it gets on as in typed code.
    fn add_types_born_in(&mut self, file: FileId, out: &mut Vec<TypeId>) {
        let by_kind = self.exprs_by_kind_of(file);
        for &literal in by_kind.of(ExprTag::Object) {
            self.prepare_enclosing(file, literal);
            out.push(self.type_of_expr(file, literal));
            out.extend(self.contextual_type_of_literal(file, literal));
        }
        for &element in by_kind.of(ExprTag::Jsx) {
            self.prepare_enclosing(file, element);
            out.push(self.jsx_attributes_type(file, element));
            out.extend(self.apparent_type_of_contextual_type_of_jsx_attributes(file, element, ContextFlags::empty()));
        }
    }

    /// What an untyped file refers to that a typed file of the program declares, and what a typed file refers to that untyped code is behind. `imported`: what has been looked at, and whether from an untyped file.
    fn add_types_imported_across(&mut self, file: FileId, imported: &mut FxHashSet<(Sym, bool)>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let bound = self.bound(file);
        let is_untyped = self.is_untyped_file(file);
        for &name in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
            let local = bound.expr_symbol[name.idx()];
            if local.is_none() {
                continue;
            }
            let local = self.files().sym(file, local);
            if !self.files().flags(local).contains(SymFlags::ALIAS) {
                continue;
            }
            let Some(target) = self.files().resolve_alias(local) else { continue };
            if !imported.insert((target, is_untyped)) {
                continue;
            }
            let across = self.files().decls_of(target).iter().map(|declared| declared.0).find(|&declared_in| match is_untyped {
                true => !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration,
                false => self.is_declared_for_javascript(declared_in),
            });
            if let Some(declared_in) = across {
                let of_target = self.type_of_symbol(target);
                let typed_side = if is_untyped { declared_in } else { file };
                self.add_what_crosses_at(of_target, u8::from(!is_untyped), typed_side, Place { file, pos: self.hir(file)[name].pos }, seen, out);
            }
        }
    }

    fn add_what_is_handed_to_what_is_exported_again(&mut self, file: FileId, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let module = self.files().file_symbol(file);
        let value = self.files().module_value(module);
        let of_module = self.type_of_symbol(value);
        let Some(members) = self.members(of_module) else { return };
        let exported: Vec<Sym> = (members.shape().props.iter()).filter_map(|prop| if let PropSource::Symbol(exported) = prop.source { Some(exported) } else { None }).collect();
        for exported in exported {
            let target = if self.files().flags(exported).contains(SymFlags::ALIAS) { self.files().resolve_alias(exported) } else { Some(exported) };
            let Some(target) = target else { continue };
            let declared_in = self.files().decls_of(target).iter().map(|declaration| declaration.0).find(|&declared_in| !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration);
            if let Some(declared_in) = declared_in {
                let of_target = self.type_of_symbol(target);
                self.add_what_is_handed_to(of_target, 0, declared_in, Place { file, pos: 0 }, &mut FxHashSet::default(), seen, out);
            }
        }
    }

    fn add_data_that_crosses_at(&mut self, ty: TypeId, depth: u32, typed_side: FileId, at: Place, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        for part in self.parts(ty).to_vec() {
            if self.is_shaped_as_data(part, &mut FxHashSet::default()) {
                self.add_what_crosses_at(part, 1, typed_side, at, seen, out);
            } else if depth < 4 {
                for signature in self.signatures(part, false).to_vec() {
                    let yielded = self.sig_return(signature);
                    self.add_data_that_crosses_at(yielded, depth + 1, typed_side, at, seen, out);
                }
            }
        }
    }

    fn is_shaped_as_data(&mut self, ty: TypeId, gone_through: &mut FxHashSet<TypeId>) -> bool {
        let ty = self.reduced(ty);
        if self.parts(ty).iter().any(|&part| matches!(self.data(part), TypeData::Fns { .. })) {
            return false;
        }
        if !self.may_hold_objects(ty) || self.says_nothing(ty) || !gone_through.insert(ty) {
            return true;
        }
        for part in self.parts(ty).to_vec() {
            if !self.may_hold_objects(part) || self.says_nothing(part) {
                continue;
            }
            if self.is_instantiable(part) {
                let bound = self.base_constraint(part);
                if !self.is_shaped_as_data(bound, gone_through) {
                    return false;
                }
                continue;
            }
            if self.is_array_or_tuple(part) {
                for element in self.type_arguments(part).to_vec() {
                    if !self.is_shaped_as_data(element, gone_through) {
                        return false;
                    }
                }
                continue;
            }
            if self.is_type_of_instances(part) || self.built_in_that_is(part).is_some() || !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty() {
                return false;
            }
            let Some(members) = self.members(part) else { continue };
            let mut held: Vec<TypeId> = members.shape().index.iter().map(|info| info.value).collect();
            for prop in members.shape().props.iter() {
                held.push(self.type_of_prop(prop, members.mapper));
            }
            for held in held {
                if !self.is_shaped_as_data(held, gone_through) {
                    return false;
                }
            }
        }
        true
    }

    fn add_what_is_handed_to(&mut self, ty: TypeId, depth: u32, typed_side: FileId, at: Place, gone_through: &mut FxHashSet<TypeId>, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if depth > 4 || !gone_through.insert(ty) {
            return;
        }
        for part in self.parts(ty).to_vec() {
            if matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
                for argument in self.type_arguments(part).to_vec() {
                    self.add_what_is_handed_to(argument, depth + 1, typed_side, at, gone_through, seen, out);
                }
            }
            if self.is_declared_outside(part) {
                continue;
            }
            for is_construct in [false, true] {
                for signature in self.signatures(part, is_construct).to_vec() {
                    let parameters = self.sig_params(signature);
                    for index in 0..parameters.len() + 8 {
                        let Some(parameter) = self.param_type_at(&parameters, index) else { break };
                        self.add_data_that_crosses_at(parameter, 0, typed_side, at, seen, out);
                    }
                    let yielded = self.sig_return(signature);
                    self.add_what_is_handed_to(yielded, depth + 1, typed_side, at, gone_through, seen, out);
                }
            }
            if !self.may_hold_objects(part) || self.is_array_or_tuple(part) || self.is_instantiable(part) {
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            let mut held: Vec<(TypeId, bool)> = Vec::new();
            for prop in members.shape().props.iter() {
                held.push((self.type_of_prop(prop, members.mapper), prop.flags.contains(PropFlags::READONLY)));
            }
            let is_module = matches!(self.data(part), TypeData::Anon { origin: Origin::Module(_), .. });
            for (held, is_readonly) in held {
                if !is_readonly && !is_module {
                    self.add_data_that_crosses_at(held, 0, typed_side, at, seen, out);
                }
                self.add_what_is_handed_to(held, depth + 1, typed_side, at, gone_through, seen, out);
            }
        }
    }

    /// The arguments of the calls of the typed file whose callee is reached through a name that is imported from an untyped file, or from a file whose code is one: `render(state)`, `new View(options)`, `lib.store.set(item)`.
    fn add_types_handed_to_javascript(&mut self, file: FileId, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind_of(file);
        for &e in by_kind.of(ExprTag::Call).iter().chain(by_kind.of(ExprTag::New)) {
            let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else { continue };
            let mut named = hir[call].callee;
            while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } | ExprKind::NonNull(obj) = hir[named].kind {
                named = obj;
            }
            if !matches!(hir[named].kind, ExprKind::Ident(_)) || bound.expr_symbol[named.idx()].is_none() {
                continue;
            }
            let local = self.files().sym(file, bound.expr_symbol[named.idx()]);
            if !self.files().flags(local).contains(SymFlags::ALIAS) || !self.files().resolve_alias(local).is_some_and(|target| self.is_declared_for_javascript(target.file)) {
                continue;
            }
            for argument in hir.ids(hir[call].args) {
                let argument = match hir[argument].kind {
                    ExprKind::Spread(spread) => spread,
                    _ => argument,
                };
                self.prepare_enclosing(file, argument);
                let handed = self.type_of_expr(file, argument);
                self.add_what_crosses_at(handed, 2, file, Place { file, pos: hir[argument].pos }, seen, out);
            }
        }
    }

    fn add_what_crosses_at(&mut self, ty: TypeId, rank: u8, typed_side: FileId, at: Place, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        if self.aot.flows.gave_up_crossing.is_some() {
            return;
        }
        self.aot.flows.crossing_from_one_place = 0;
        self.add_what_crosses(ty, seen, out);
        if self.aot.flows.crossing_from_one_place > MOST_TYPES_THAT_CROSS_FROM_ONE_PLACE {
            let name = match *self.data(ty) {
                TypeData::Anon { origin: Origin::Module(module), .. } => format!("typeof import(\"{}\")", self.path_for_people(module.file)),
                _ => self.name_for_people(ty),
            };
            let text = &self.hir(at.file).text;
            let line = text[..(at.pos as usize).min(text.len())].iter().filter(|&&byte| byte == b'\n').count() + 1;
            let place = format!("{}:{line}", self.path_for_people(at.file));
            self.aot.flows.gave_up_crossing = Some(GaveUp { rank: (rank, at.file.0, at.pos), typed_side, name, place });
        }
    }

    fn path_for_people(&self, file: FileId) -> String {
        let path = String::from_utf8_lossy(self.files().module(file).file_name());
        match path.rsplit_once("/node_modules/") {
            Some((_, inside)) => inside.to_owned(),
            None => path.rsplit('/').next().unwrap_or(&path).to_owned(),
        }
    }

    /// What untyped code has to do with once it holds a value of the type. A function it calls with what it has made, and what the function yields it holds in turn. Of an object it reads and stores the properties, of a
    /// container the elements. `out`: the types among all that which say properties. What a declaration file declares is gone through by its type arguments alone: nothing is laid out by it.
    fn add_what_crosses(&mut self, ty: TypeId, seen: &mut FxHashSet<TypeId>, out: &mut Vec<TypeId>) {
        if self.aot.flows.crossing_from_one_place > MOST_TYPES_THAT_CROSS_FROM_ONE_PLACE {
            return;
        }
        let ty = self.reduced(ty);
        if !(self.may_hold_objects(ty) || matches!(self.data(ty), TypeData::Fns { .. })) || !seen.insert(ty) {
            return;
        }
        self.aot.flows.crossing_from_one_place += u32::from(self.aot.flows.is_crossing_bounded);
        // `wrap(): Box<Box<T>>`: it is laid out so far and no further.
        if self.is_nested_too_deeply(ty) {
            return;
        }
        if let TypeData::Union(parts) = self.data(ty) {
            for part in parts.to_vec() {
                self.add_what_crosses(part, seen, out);
            }
            return;
        }
        if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.add_what_crosses(bound, seen, out);
            return;
        }
        for is_construct in [false, true] {
            for signature in self.signatures(ty, is_construct).to_vec() {
                let parameters = self.sig_params(signature);
                // A rest parameter of a tuple type stands for several.
                for index in 0..parameters.len() + 8 {
                    let Some(parameter) = self.param_type_at(&parameters, index) else { break };
                    self.add_what_crosses(parameter, seen, out);
                }
                let yielded = self.sig_return(signature);
                self.add_what_crosses(yielded, seen, out);
            }
        }
        if matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
            for argument in self.type_arguments(ty).to_vec() {
                self.add_what_crosses(argument, seen, out);
            }
        }
        // An array that untyped code hands in need not be one.
        if self.is_array_or_tuple(ty) {
            out.push(ty);
            return;
        }
        if self.is_declared_outside(ty) {
            return;
        }
        if let TypeData::Anon { origin: Origin::Mapped(file, node), .. } = *self.data(ty)
            && (self.has_type_variables(ty) || self.generic_form_of(ty) == Some(ty))
        {
            let template = self.mapped_decl(file, node).ty;
            if template.is_some() {
                let template = self.type_from_node(file, template);
                self.add_what_crosses(template, seen, out);
            }
        }
        if let Some(form) = self.generic_form_of(ty)
            && form != ty
            && self.is_applied_to_what_is_applied(ty)
        {
            self.add_what_crosses(form, seen, out);
            for argument in self.types_referred_to_by(ty) {
                self.add_what_crosses(argument, seen, out);
            }
            if self.says_properties(ty) {
                out.push(ty);
            }
            return;
        }
        let Some(members) = self.members(ty) else { return };
        for info in members.shape().index.iter() {
            self.add_what_crosses(info.value, seen, out);
        }
        for prop in members.shape().props.iter() {
            let of_prop = self.type_of_prop(prop, members.mapper);
            self.add_what_crosses(of_prop, seen, out);
        }
        if self.says_properties(ty) {
            out.push(ty);
        }
    }

    fn has_room_for_what_nothing_is_said_of(&mut self, ty: TypeId, depth: u32) -> bool {
        if depth == 0
            && let Some(&known) = self.aot.flows.with_room_for_what_nothing_is_said_of.get(&ty)
        {
            return known;
        }
        let found = self.says_nothing_of_objects(ty)
            || depth < 2
                && self.parts(ty).to_vec().into_iter().any(|part| {
                    matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) && self.type_arguments(part).to_vec().into_iter().any(|argument| self.has_room_for_what_nothing_is_said_of(argument, depth + 1))
                });
        if depth == 0 {
            self.aot.flows.with_room_for_what_nothing_is_said_of.insert(ty, found);
        }
        found
    }

    pub(super) fn note_what_enters_a_place_that_says_nothing(&mut self, own: TypeId, target: Option<TypeId>) {
        if !self.may_hold_objects(own) && !matches!(self.data(own), TypeData::Fns { .. }) || !self.aot.escape_closure.entered_places_that_say_nothing.insert((own, target)) {
            return;
        }
        if let Some(target) = target {
            if matches!(self.data(own), TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_), .. }) {
                for mine in self.signatures(own, false).to_vec() {
                    for theirs in self.signatures(target, false).to_vec() {
                        let (taken, handed) = (self.sig_params(mine), self.sig_params(theirs));
                        for index in 0..taken.len() {
                            let (Some(into), Some(from)) = (self.param_type_at(&taken, index), self.param_type_at(&handed, index)) else { break };
                            if self.has_room_for_what_nothing_is_said_of(into, 0) {
                                self.note_all_that_is_brought_by(from, 0);
                            }
                        }
                        let (yielded, expected) = (self.sig_return(mine), self.sig_return(theirs));
                        if self.has_room_for_what_nothing_is_said_of(expected, 0) {
                            self.note_all_that_is_brought_by(yielded, 0);
                        }
                    }
                }
            }
            if !self.has_room_for_what_nothing_is_said_of(target, 0) {
                return;
            }
        }
        self.note_all_that_is_brought_by(own, 0);
    }

    fn note_all_that_is_brought_by(&mut self, ty: TypeId, depth: u32) {
        self.note_what_is_let_out(ty, None);
        for part in self.parts(ty).to_vec() {
            if self.says_properties(part) && !self.is_type_of_instances(part) && !self.is_declared_outside(part) {
                self.note_view_let_out(part);
            }
            if depth >= 2 {
                continue;
            }
            if matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
                for argument in self.type_arguments(part).to_vec() {
                    self.note_all_that_is_brought_by(argument, depth + 1);
                }
            }
            if matches!(self.data(part), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. })
                && let Some(members) = self.members(part)
            {
                let mut held: Vec<TypeId> = Vec::new();
                for prop in members.shape().props.iter() {
                    held.push(self.type_of_prop(prop, members.mapper));
                }
                for held in held {
                    self.note_all_that_is_brought_by(held, depth + 1);
                }
            }
        }
    }

    fn is_applied_to_what_is_applied(&mut self, ty: TypeId) -> bool {
        self.find_applications_in(ty);
        for argument in self.types_referred_to_by(ty) {
            if self.is_instantiable(argument) || self.has_type_variables(argument) || self.aot.flows.applications[&argument].iter().any(|applied| applied.1 > 0) {
                return true;
            }
        }
        false
    }

    /// `JSON.parse(..)`, `response.json()`, `structuredClone(..)`.
    fn is_door_for_data(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        let callee = hir[call].callee;
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => match self.atoms().bytes(name) {
                b"parse" => self.names_global_object(file, obj, b"JSON"),
                b"json" => hir.ids(hir[call].args).next().is_none() && self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.hir(of).kind == FileKind::Declaration),
                _ => false,
            },
            ExprKind::Ident(name) => {
                self.atoms().bytes(name) == b"structuredClone"
                    && self.bound(file).expr_symbol[callee.idx()].is_none()
                    && self.symbol_of_identifier(file, callee, name).is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
            }
            _ => false,
        }
    }

    /// The types that are written where what has come through a door of the file gets to.
    fn add_types_that_data_is_held_to(&mut self, file: FileId, out: &mut Vec<TypeId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind_of(file);
        let mut pending: Vec<ExprId> = Vec::new();
        for &call in by_kind.of(ExprTag::Call) {
            if self.is_door_for_data(file, call) {
                pending.push(call);
            }
        }
        let mut holders: FxHashSet<SymbolId> = FxHashSet::default();
        while let Some(mut yielded) = pending.pop() {
            let is_kept_by_name = loop {
                match bound.expr_parent[yielded.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::As { ty, .. } => {
                            out.push(self.type_from_node(file, ty));
                            yielded = parent;
                        }
                        ExprKind::Await(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } | ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, .. } => yielded = parent,
                        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == yielded => yielded = parent,
                        ExprKind::Cond { yes, no, .. } if yes == yielded || no == yielded => yielded = parent,
                        ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } if right == yielded => yielded = parent,
                        _ => break false,
                    },
                    Parent::VarInit(d) if hir[d].ty.is_none() && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                        let holder = bound.pat_symbol[hir[d].pat.idx()];
                        if holders.insert(holder) {
                            pending.extend(by_kind.of(ExprTag::Ident).iter().copied().filter(|name| bound.expr_symbol[name.idx()] == holder));
                        }
                        break true;
                    }
                    _ => break false,
                }
            };
            if is_kept_by_name {
                continue;
            }
            self.prepare_enclosing(file, yielded);
            if let Some(expected) = self.contextual_type(file, yielded, ContextFlags::empty()) {
                out.push(expected);
            }
        }
    }

    /// Nobody else can hold what the expression yields, nor anything that hangs below it: `JSON.parse(text)`, with one argument: a reviver sees what is made. Not what a variable holds.
    pub fn is_fresh_graph_by_text(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.is_fresh_graph_by_text(file, expr),
            ExprKind::Call(call) => {
                let has_one_argument = {
                    let hir = self.hir(file);
                    hir[call].args.len == 1 && !hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_) | ExprKind::Missing))
                };
                has_one_argument && self.origin_of_data(file, e) == Some(OriginOfData::Parsed)
            }
            _ => false,
        }
    }

    /// Where the value of the expression comes from, going by the text, if it is of type `any` or `unknown`. `None`: it has a type, or it is the program's own: `x as any` of an `x`
    /// that has a type, `(x as any).field`, what `new` makes.
    ///
    /// Nothing rests on it but which types take an object as it is: what is not let in is turned away where it is read.
    pub fn origin_of_data(&mut self, file: FileId, e: ExprId) -> Option<OriginOfData> {
        self.origin_of_data_within(file, e, 0)
    }

    fn origin_of_data_within(&mut self, file: FileId, e: ExprId, depth: u32) -> Option<OriginOfData> {
        let says_nothing = |c: &Self, ty: TypeId| ty != TypeId::UNRESOLVED && c.parts(ty).iter().any(|&part| part.is_any() || part == TypeId::UNKNOWN);
        let ty = self.type_of_expr(file, e);
        if !says_nothing(self, ty) || depth > 8 {
            return None;
        }
        if self.unvouched_claim(file, e).is_some() {
            return Some(OriginOfData::Prediction);
        }
        // Of two, the one that is known for data.
        let either = |a: Option<OriginOfData>, b: Option<OriginOfData>| a.into_iter().chain(b).min();
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.origin_of_data_within(file, expr, depth + 1),
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, left, right } => either(self.origin_of_data_within(file, left, depth + 1), self.origin_of_data_within(file, right, depth + 1)),
            ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } => self.origin_of_data_within(file, right, depth + 1),
            ExprKind::Cond { yes, no, .. } => either(self.origin_of_data_within(file, yes, depth + 1), self.origin_of_data_within(file, no, depth + 1)),
            ExprKind::Call(_) => match self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) {
                Some((declared_in, func, _)) if self.only_declares(declared_in) => {
                    let (hir, bound) = (self.hir(declared_in), self.bound(declared_in));
                    let is_parse = matches!(bound.fns[func.idx()].owner, FnOwner::Member(member) if matches!(bound.member_owner[member.idx()], MemberOwner::Interface(interface) if self.atoms().bytes(hir[interface].name) == b"JSON"))
                        && hir[func].name.is_some()
                        && self.atoms().bytes(hir[func].name) == b"parse";
                    Some(if is_parse { OriginOfData::Parsed } else { OriginOfData::BuiltIn })
                }
                _ => Some(OriginOfData::Function),
            },
            // What data holds is data. `(element as any).parent`: what the program's own object holds, the program has put there.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let holder = self.type_of_expr(file, obj);
                if says_nothing(self, holder) { self.origin_of_data_within(file, obj, depth + 1) } else { Some(OriginOfData::Property) }
            }
            ExprKind::Await(operand) => match self.hir(file)[operand].kind {
                ExprKind::Call(_) if self.unvouched_claim(file, operand).is_some() => Some(OriginOfData::Prediction),
                _ => Some(OriginOfData::Awaited),
            },
            ExprKind::Ident(name) => {
                let named = Some(OriginOfData::Inferred);
                let Some(sym) = self.symbol_of_identifier(file, e, name) else { return named };
                let Some((of, Decl::Var(pat))) = self.files().value_declaration(sym) else { return Some(OriginOfData::Annotated) };
                let (hir, bound) = (self.hir(of), self.bound(of));
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return named };
                let otherwise = Some(if hir[d].ty.is_some() { OriginOfData::Annotated } else { OriginOfData::Inferred });
                // It holds what it is initialized with.
                if hir[d].pat != pat || hir[d].init.is_none() || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                    return otherwise;
                }
                match self.origin_of_data_within(of, hir[d].init, depth + 1) {
                    Some(origin) if origin.is_known_for_data() => Some(origin),
                    // `const loose: any = typed`
                    None => None,
                    _ => otherwise,
                }
            }
            _ => None,
        }
    }

    /// `stays`: what is of type `ty` is in a container, or is held by what is.
    fn add_what_stays_untyped(&mut self, ty: TypeId, stays: bool, seen: &mut FxHashSet<(TypeId, bool)>, out: &mut Vec<TypeId>) {
        let ty = self.reduced(ty);
        if !self.may_hold_objects(ty) || seen.contains(&(ty, stays)) {
            return;
        }
        if stays && self.aot.flows.seen_before.is_some() {
            let identity = self.identity_of_type(ty);
            if self.aot.flows.seen_before.as_ref().is_some_and(|before| before.contains(&identity)) {
                return;
            }
        }
        seen.insert((ty, stays));
        if let TypeData::Union(parts) = self.data(ty) {
            let parts: Vec<TypeId> = parts.to_vec();
            // What an object is looked at as of which it is not known which part it is of.
            // Of the object types among the parts alone, as `FileBuild::layout_in_common` has it: `{ a: boolean } | { a: boolean; b: boolean } | undefined`.
            let objects: Vec<TypeId> = parts.iter().copied().filter(|&part| self.says_properties(part)).collect();
            if stays && objects.len() > 1 {
                // Its properties are unions in turn, of what the parts have by the name.
                let objects = self.union(&objects);
                let common = self.view_of_union(objects);
                self.add_what_stays_untyped(common, true, seen, out);
            }
            for part in parts {
                self.add_what_stays_untyped(part, stays, seen, out);
            }
        } else if self.is_instantiable(ty) {
            let bound = self.base_constraint(ty);
            self.add_what_stays_untyped(bound, stays, seen, out);
        } else if self.is_array_or_tuple(ty) {
            for &element in self.type_arguments(ty) {
                self.add_what_stays_untyped(element, true, seen, out);
            }
        } else if let Some(element) = self.element_of_array_subtype(ty) {
            self.add_what_stays_untyped(element, true, seen, out);
        } else {
            match self.built_in_that_is(ty) {
                Some(BuiltIn::Function | BuiltIn::Claimed) => return,
                // `Map<K, V>`, `Set<T>`, `Promise<T>`
                Some(BuiltIn::Instance(_)) => {
                    for &argument in self.type_arguments(ty) {
                        self.add_what_stays_untyped(argument, true, seen, out);
                    }
                    return;
                }
                None => {}
            }
            // Plain data is no object of a class.
            if self.is_type_of_instances(ty) {
                return;
            }
            let Some(members) = self.members(ty) else { return };
            let goes_on = !self.is_nested_too_deeply(ty);
            if !goes_on && let Some(form) = self.generic_form_of(ty) {
                self.add_what_stays_untyped(form, true, seen, out);
            }
            for info in members.shape().index.iter().filter(|_| goes_on) {
                self.add_what_stays_untyped(info.value, true, seen, out);
            }
            // The type of a module says what it exports, and no object is laid out by it: `import * as data from "./x.json"`, `import("./x.json")`.
            let is_module = matches!(self.data(ty), TypeData::Anon { origin: Origin::Module(..), .. });
            if !self.says_properties(ty) && !is_module {
                return;
            }
            if stays && !is_module {
                out.push(self.laid_out_as(ty));
            }
            for prop in members.shape().props.iter().filter(|_| goes_on) {
                let of_field = self.type_of_prop(prop, members.mapper);
                self.add_what_stays_untyped(of_field, stays, seen, out);
            }
        }
    }

    /// The value of an expression whose type `is_untyped` is held to `target`, which says how objects are laid out.
    pub fn note_untyped_inflow(&mut self, target: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_untyped_inflow(target, at);
    }

    pub fn note_check_of_a_log_build(&mut self, target: TypeId, road: usize) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_check(target, at);
        self.aot.flows.noted.checked_by_road[road] += 1;
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
                // Whoever steps through the generator gets it.
                ExprKind::Yield { value, star: false } => value == e,
                // `links[id] ??= new Links()` stores what `links[id] = new Links()` does.
                ExprKind::Assign { op: None | Some(crate::hir::BinOp::And | crate::hir::BinOp::Or | crate::hir::BinOp::Nullish), value, .. } => value == e,
                _ => false,
            },
            Parent::Prop(_) => true,
            // What an async function returns is what its promise is resolved with, which is no place of the translated program.
            Parent::Stmt(stmt) => matches!(hir[stmt].kind, crate::hir::StmtKind::Return(_)),
            Parent::FnBody(_) => true,
            _ => false,
        };
        // An object literal is made as what it is checked against, or as its own type: `const all: Beta[] = [new Beta(), { .. }]`.
        if !enters || matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing) {
            return None;
        }
        let source = self.type_of_expr(file, e);
        if self.says_nothing(source) || self.parts(source).iter().all(|&part| self.has_primitive_flag(part)) {
            return None;
        }
        let entered = self.contextual_type_of_literal(file, e).or_else(|| match self.bound(file).expr_parent[e.idx()] {
            Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => {
                let array = self.type_of_expr(file, parent);
                self.index_type_of_type(array, TypeId::NUMBER)
            }
            _ => None,
        });
        entered.filter(|&target| !self.says_nothing(target))
    }

    /// `list.push(...more)`. `e`: the spread, an argument of a call or a `new`. The type of what it iterates over, and the type that the checker has for where each of those goes.
    pub fn types_entered_by_spread(&mut self, file: FileId, e: ExprId) -> Option<(TypeId, TypeId)> {
        let hir = self.hir(file);
        let ExprKind::Spread(spread) = hir[e].kind else { return None };
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return None };
        if !matches!(hir[parent].kind, ExprKind::Call(call) | ExprKind::New(call) if hir[call].callee != e) {
            return None;
        }
        let iterable = self.type_of_expr(file, spread);
        let source = self.iterated_type(iterable, false);
        let target = self.contextual_type_of_literal(file, e)?;
        (!self.says_nothing(source) && !self.says_nothing(target)).then_some((source, target))
    }

    /// `Object.assign(target, a, b)`. For each property of the type `source` that the type `target` has by the same name: the two types.
    pub fn properties_assigned(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        for &from in &self.parts(source).to_vec() {
            let Some(of_source) = self.members(from) else { continue };
            for &to in &self.parts(target).to_vec() {
                let Some(of_target) = self.members(to) else { continue };
                for prop in of_source.shape().props.iter() {
                    if let Some(taking) = of_target.resolved.prop(prop.name) {
                        entering.push((self.type_of_prop(prop, of_source.mapper), self.type_of_prop(taking, of_target.mapper)));
                    }
                }
            }
        }
        entering
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
                let is_called_from_outside = self.sig_decl(called_as).is_some_and(|(file, ..)| self.is_untyped_file(file) || self.only_declares(file));
                if !is_called_from_outside {
                    continue;
                }
                let arguments = self.sig_params(called_as);
                for &declared_as in self.signatures(source, false).iter() {
                    if !self.sig_decl(declared_as).is_some_and(|(file, ..)| !self.is_untyped_file(file) && !self.only_declares(file)) {
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
    /// the two are instantiations of one declaration, or else what their index signatures say. Likewise what goes through a function:
    /// its arguments the other way, from the type it is taken for to its own, and what it yields; and through a function that is a property of the two. The first time it is asked of the two
    /// types, and nothing after that.
    pub fn types_held_entering(&mut self, source: TypeId, target: TypeId) -> Vec<(TypeId, TypeId)> {
        let mut entering = Vec::new();
        if source == target || self.says_nothing(source) || self.says_nothing(target) || !self.aot.flows.held_entering.insert((source, target)) {
            return entering;
        }
        let mut functions_of: Vec<Option<Vec<(Atom, TypeId)>>> = vec![None; self.parts(target).len()];
        let mut said_by: Vec<Option<([Option<TypeId>; 2], [bool; 2])>> = vec![None; self.parts(target).len()];
        for &from in self.parts(source) {
            if self.has_primitive_flag(from) {
                continue;
            }
            let is_written = self.is_record_written_by_the_program(from);
            let mut said_by_from = None;
            for (number, &to) in self.parts(target).iter().enumerate() {
                if from == to || self.has_primitive_flag(to) {
                    continue;
                }
                if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
                    && declared == as_declared
                {
                    let (held, held_as) = (self.type_arguments(from), self.type_arguments(to));
                    entering.extend(held.iter().copied().zip(held_as.iter().copied()));
                    continue;
                }
                let first = entering.len();
                let (held, is_declared) = match said_by_from {
                    Some(known) => known,
                    None => *said_by_from.insert(self.held_and_called(from)),
                };
                let (held_as, is_called) = match said_by[number] {
                    Some(known) => known,
                    None => *said_by[number].insert(self.held_and_called(to)),
                };
                for key in 0..2 {
                    if let (Some(held), Some(held_as)) = (held[key], held_as[key]) {
                        entering.push((held, held_as));
                    }
                }
                // A function that is called as `to` says is handed what that takes, and what it yields is taken for what that yields.
                for constructs in [false, true] {
                    if !is_declared[usize::from(constructs)] || !is_called[usize::from(constructs)] {
                        continue;
                    }
                    for &called_as in self.signatures(to, constructs).iter() {
                        let arguments = self.sig_params(called_as);
                        for &declared_as in self.signatures(from, constructs).iter() {
                            let parameters = self.sig_params(declared_as);
                            for index in 0..parameters.len() {
                                if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                                    entering.push((argument, parameter));
                                }
                            }
                            entering.push((self.sig_return(declared_as), self.sig_return(called_as)));
                        }
                    }
                }
                // So with a function that is a property: `{ deps: (ctx: A) => .. }` that is taken for a `{ deps: (ctx: Big) => .. }` is handed a `Big`.
                // Not of what the standard library or a declaration file writes: `then` yields a `Promise` of a type parameter of its own, whose `then` yields another: that does not end.
                if !is_written {
                    self.end_what_grows(from, to, first, &mut entering);
                    continue;
                }
                if functions_of[number].is_none() {
                    let mut functions = Vec::new();
                    if self.is_record_written_by_the_program(to)
                        && let Some(members) = self.members(to)
                    {
                        let names: Vec<Atom> = members.shape().props.iter().map(|prop| prop.name).collect();
                        for name in names {
                            if let Some(held_as) = self.type_of_property(to, name)
                                && self.parts(held_as).iter().any(|&part| !self.signatures(part, false).is_empty())
                            {
                                functions.push((name, held_as));
                            }
                        }
                    }
                    functions_of[number] = Some(functions);
                }
                for index in 0..functions_of[number].as_ref().map_or(0, Vec::len) {
                    let Some(&(name, held_as)) = functions_of[number].as_ref().and_then(|functions| functions.get(index)) else { break };
                    if let Some(held) = self.type_of_property(from, name)
                        && held != held_as
                    {
                        entering.push((held, held_as));
                    }
                }
                self.end_what_grows(from, to, first, &mut entering);
            }
        }
        entering
    }

    fn held_and_called(&mut self, ty: TypeId) -> ([Option<TypeId>; 2], [bool; 2]) {
        let held = [TypeId::NUMBER, TypeId::STRING].map(|key| self.index_type_of_type(ty, key));
        (held, [false, true].map(|constructs| !self.signatures(ty, constructs).is_empty()))
    }

    fn applied_by(&self, ty: TypeId) -> Applied {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => Applied::Named(target),
            TypeData::Anon { origin, .. } => Applied::Written(origin),
            TypeData::Fns { ref decls, .. } => decls.first().map_or(Applied::Computed, |&(file, func)| Applied::Function(file, func)),
            TypeData::Intersection(ref parts) => parts.first().map_or(Applied::Computed, |&part| self.applied_by(part)),
            _ => Applied::Computed,
        }
    }

    fn is_nested_more_in_itself(&mut self, inner: TypeId, outer: [TypeId; 2]) -> bool {
        for ty in [inner, outer[0], outer[1]] {
            self.find_applications_in(ty);
        }
        let applications = &self.aot.flows.applications;
        applications[&inner].iter().any(|&(applied, times)| {
            let around = outer.iter().filter_map(|ty| applications[ty].iter().find(|known| known.0 == applied)).map(|known| known.1).max();
            around.is_some_and(|around| times > around)
        })
    }

    pub fn times_not_known(&self) -> usize {
        self.aot.flows.times_not_known
    }

    pub(super) fn answers_are_provisional(&self) -> bool {
        self.aot.flows.is_searching_from_doors || self.aot.flows.being_asked_of_taint != 0 || self.aot.flows.finding_canonical != 0
    }

    pub fn go_a_level_into_what_is_held(&mut self) {
        self.aot.flows.levels_looked_into += 1;
    }

    pub fn come_back_a_level(&mut self) {
        self.aot.flows.levels_looked_into -= 1;
    }

    fn end_what_grows(&mut self, from: TypeId, to: TypeId, first: usize, entering: &mut Vec<(TypeId, TypeId)>) {
        if entering.len() == first {
            return;
        }
        let mut grown = Vec::new();
        for index in first..entering.len() {
            let (held, held_as) = entering[index];
            if self.is_nested_more_in_itself(held, [from, to]) || self.is_nested_more_in_itself(held_as, [from, to]) {
                grown.push(index);
            }
        }
        let key = (self.applied_by(from), self.applied_by(to));
        let known = match self.aot.flows.looked_into.iter().position(|known| known.0 == key) {
            Some(known) => known,
            None => {
                self.aot.flows.looked_into.push((key, [0; 2]));
                self.aot.flows.looked_into.len() - 1
            }
        };
        let times = &mut self.aot.flows.looked_into[known].1;
        times[0] += 1;
        times[1] += u32::from(!grown.is_empty());
        let [at_all, for_what_grows] = *times;
        let levels = self.aot.flows.levels_looked_into;
        let most = &mut self.aot.flows.noted.most_looked_into;
        *most = [most[0].max(at_all), most[1].max(for_what_grows), most[2].max(levels)];
        let why = if levels > MOST_LEVELS_LOOKED_INTO {
            3
        } else if self.is_half_of_stack_in_use() {
            2
        } else if at_all > MOST_INSTANTIATIONS_LOOKED_INTO_AT_ALL {
            1
        } else if for_what_grows > MOST_INSTANTIATIONS_LOOKED_INTO && !grown.is_empty() {
            0
        } else {
            return;
        };
        if why != 0 {
            grown = (first..entering.len()).collect();
        }
        let at = self.aot.flows.place;
        self.aot.flows.noted.cut_short.entry(at).or_default()[why] += 1;
        for index in grown.into_iter().rev() {
            let (held, held_as) = entering.remove(index);
            self.note_what_is_not_looked_into(held, held_as);
        }
    }

    fn note_once_what_comes_from_beyond_the_layouts(&mut self, ty: TypeId) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let (mut seen, mut views) = (std::mem::take(&mut self.aot.flows.not_looked_into), Vec::new());
        self.add_what_stays_untyped(ty, true, &mut seen, &mut views);
        self.aot.flows.not_looked_into = seen;
        for view in views {
            self.note_foreign(view, TypeId::UNRESOLVED);
        }
    }

    fn note_what_is_not_looked_into(&mut self, held: TypeId, held_as: TypeId) {
        self.note_once_what_comes_from_beyond_the_layouts(held_as);
        for (function, is_what_it_is_called_as) in [(held_as, true), (held, false)] {
            for &part in self.parts(function) {
                for constructs in [false, true] {
                    for &signature in self.signatures(part, constructs).iter() {
                        if is_what_it_is_called_as {
                            let yielded = self.sig_return(signature);
                            self.note_once_what_comes_from_beyond_the_layouts(yielded);
                            continue;
                        }
                        let parameters = self.sig_params(signature);
                        for index in 0..parameters.len() {
                            if let Some(parameter) = self.param_type_at(&parameters, index) {
                                self.note_once_what_comes_from_beyond_the_layouts(parameter);
                            }
                        }
                    }
                }
            }
        }
    }

    fn is_record_written_by_the_program(&self, ty: TypeId) -> bool {
        let file = match *self.data(ty) {
            TypeData::Ref { target, .. } => target.file,
            TypeData::Anon { origin: Origin::TypeLiteral(file, _) | Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..), .. } => file,
            _ => return false,
        };
        !self.files.module(file).is_lib && self.hir(file).kind != FileKind::Declaration
    }

    /// Whether a value of type `source`, whose objects are not laid out, may enter a place for objects of one of `views` as it is: `source`
    /// says what they are, which `any`, `unknown`, `object` and `{}` do not, and each is seen as one of the views. If so, note is taken
    /// that the view admits them.
    pub fn admits_foreign(&mut self, source: TypeId, views: &[TypeId]) -> bool {
        let source = self.reduced(source);
        if self.has_a_namespace_among_its_parts(source) {
            let at = self.aot.flows.place;
            for &view in views {
                self.aot.flows.noted.add_foreign(view, Some(source), at);
            }
        }
        let mut admitting = Vec::new();
        let is_admitted = self.is_taken_by_views(source, views, &mut admitting) && !admitting.is_empty();
        if is_admitted {
            let at = self.aot.flows.place;
            let comes_from_beyond = self.is_beyond_the_layouts(source);
            for view in admitting {
                self.aot.flows.noted.add_foreign(view, Some(source), at);
                if comes_from_beyond {
                    self.note_what_comes_from_beyond_the_layouts(view);
                }
            }
        } else if self.has_tainted_part(source) {
            let at = self.aot.flows.place;
            for part in self.parts(source).to_vec() {
                if !self.is_tainted(part) {
                    continue;
                }
                for &view in views {
                    if self.is_type_of_instances(view) && self.is_seen_as(part, view) {
                        self.aot.flows.noted.add_foreign(view, Some(part), at);
                    }
                }
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
        let mut not_known = Vec::new();
        for &view in views {
            let not_known_before = self.aot.flows.times_not_known;
            if self.is_seen_as(source, view) {
                out.push(view);
                return true;
            }
            if self.aot.flows.times_not_known != not_known_before {
                not_known.push(view);
            }
        }
        let is_taken_for_all_that_is_known = !not_known.is_empty();
        out.append(&mut not_known);
        is_taken_for_all_that_is_known
    }

    /// Whether an object literal that is checked against the type is checked against the type of the objects of a class. It is not made
    /// as that: nothing but the constructor makes one.
    pub fn is_checked_against_a_class(&self, expected: TypeId) -> bool {
        self.parts(expected).iter().any(|&part| self.is_type_of_instances(part))
    }

    fn classes_named_by(&self, types: &[TypeId]) -> FxHashSet<Sym> {
        (types.iter())
            .filter_map(|&ty| match *self.data(ty) {
                TypeData::Ref { target, .. } if self.is_type_of_instances(ty) => Some(target),
                _ => None,
            })
            .collect()
    }

    fn classes_opened_for_strangers(&mut self, let_out: &[TypeId], entered: &[TypeId], entered_if_let_out: &[TypeId]) -> FxHashSet<Sym> {
        let (mut opened, evidence) = (self.classes_named_by(entered), self.classes_named_by(let_out));
        let (mut pending, mut above_what_is_let_out): (Vec<TypeId>, FxHashSet<Sym>) = (let_out.to_vec(), FxHashSet::default());
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if above_what_is_let_out.insert(target) {
                pending.extend(self.base_types(target).iter().copied());
            }
        }
        for &ty in entered_if_let_out {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if !self.is_type_of_instances(ty) || opened.contains(&target) {
                continue;
            }
            if above_what_is_let_out.contains(&target) || self.extends_one_of(ty, &evidence) {
                opened.insert(target);
            }
        }
        opened
    }

    pub fn classes_served_by_second_bodies(&mut self, let_out: &[TypeId], entered: &[TypeId], entered_if_let_out: &[TypeId], classes: &[TypeId]) -> Vec<bool> {
        let opened = self.classes_opened_for_strangers(let_out, entered, entered_if_let_out);
        let mut pending: Vec<TypeId> = let_out.to_vec();
        let let_out = self.classes_named_by(let_out);
        let is_open: Vec<bool> = classes.iter().map(|&class| self.extends_one_of(class, &opened)).collect();
        let mut met: FxHashSet<Sym> = FxHashSet::default();
        for (&class, &is_open) in classes.iter().zip(&is_open) {
            if is_open || self.extends_one_of(class, &let_out) {
                pending.push(class);
            }
        }
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if met.insert(target) {
                pending.extend(self.base_types(target).iter().copied());
            }
        }
        (classes.iter().zip(is_open)).map(|(&class, is_open)| !is_open && matches!(*self.data(class), TypeData::Ref { target, .. } if met.contains(&target))).collect()
    }

    pub fn note_evidence_of_strangers_in(&mut self, file: FileId) {
        let program = self.p;
        let kept = self.take_noted();
        for (_, expressions) in self.code_whose_escapes_are_noted(file) {
            self.note_escapes_of(file, &expressions);
        }
        self.note_escapes_of(file, &[]);
        let noted = self.take_noted();
        self.aot.flows.noted = kept;
        let noted = noted.renamed(|ty| match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_type_of_instances(ty) => Some(target),
            _ => None,
        });
        let mut evidence: Noted<Sym> = Noted::default();
        evidence.absorb_evidence_of_strangers(&noted);
        let places = program.aot.storage.evidence_of_strangers_noted.get_or_init(|| (0..program.files.modules.len()).map(|_| Mutex::new(None)).collect());
        *held(places[file.idx()].lock()) = Some(evidence.escapes.alterations.unwrap_or_default());
    }

    pub fn merge_noted_evidence_of_strangers(&mut self, is_compiled: &dyn Fn(FileId) -> bool) {
        let program = self.p;
        let Some(places) = program.aot.storage.evidence_of_strangers_noted.get() else { return };
        let mut all: super::alterations::Alterations<Sym> = Default::default();
        for file in (0..program.files.modules.len() as u32).map(FileId) {
            if !is_compiled(file) || self.hir(file).kind == FileKind::Declaration || self.files.module(file).is_opaque() || self.is_untyped_file(file) {
                continue;
            }
            let Some(noted) = held(places[file.idx()].lock()).take() else { return };
            all.absorb_evidence_of_strangers(&noted);
        }
        let evidence: FxHashSet<Sym> = all.all_with_evidence_of_strangers().into_iter().collect();
        let mut met: FxHashSet<Sym> = FxHashSet::default();
        let files = if evidence.is_empty() { Vec::new() } else { self.files_declaring_classes() };
        for file in files {
            for class in (0..self.hir(file).classes.len() as u32).map(ClassId) {
                let ty = self.type_of_instances(file, class);
                if !self.extends_one_of(ty, &evidence) {
                    continue;
                }
                let mut pending: Vec<TypeId> = vec![ty];
                while let Some(ty) = pending.pop() {
                    let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
                    if met.insert(target) {
                        pending.extend(self.base_types(target).iter().copied());
                    }
                }
            }
        }
        let _ = program.aot.storage.evidence_of_strangers.set(met);
    }

    pub fn may_be_served_by_second_bodies(&mut self, file: FileId, class: ClassId) -> bool {
        let program = self.p;
        let Some(met) = program.aot.storage.evidence_of_strangers.get() else { return true };
        let ty = self.type_of_instances(file, class);
        matches!(*self.data(ty), TypeData::Ref { target, .. } if met.contains(&target))
    }

    fn extends_one_of(&mut self, ty: TypeId, classes: &FxHashSet<Sym>) -> bool {
        let (mut pending, mut seen): (Vec<TypeId>, FxHashSet<Sym>) = (vec![ty], FxHashSet::default());
        while let Some(ty) = pending.pop() {
            let TypeData::Ref { target, .. } = *self.data(ty) else { continue };
            if !seen.insert(target) {
                continue;
            }
            if classes.contains(&target) {
                return true;
            }
            pending.extend(self.base_types(target).iter().copied());
        }
        false
    }

    /// Hands over what has been noted to this checker, which starts anew: what is noted from here on does not depend on what was asked
    /// before.
    pub fn note_what_is_given(&mut self, kept: &dyn Fn(&Identity) -> Option<TypeId>) -> usize {
        let given = self.given();
        let mut kept_by_nobody: Vec<Identity> = Vec::new();
        for identity in &given.identities {
            match kept(identity) {
                Some(ty) => {
                    self.aot.flows.noted.not_laid_out.insert(ty);
                }
                None => kept_by_nobody.push(*identity),
            }
        }
        kept_by_nobody.sort_unstable();
        let atoms = self.atoms();
        self.aot.flows.given_and_kept_by_nobody = kept_by_nobody.iter().filter_map(|identity| given.names.get(identity)).map(|names| names.iter().filter_map(|name| atoms.lookup(name)).collect()).collect();
        kept_by_nobody.len()
    }

    pub fn take_noted(&mut self) -> Noted {
        self.aot.flows.held_entering.clear();
        self.aot.flows.looked_into.clear();
        self.aot.flows.not_looked_into.clear();
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
    pub(super) fn says_properties(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { .. } => !self.is_array(ty),
            TypeData::Anon { origin: Origin::Module(namespace), .. } => self.is_reified_namespace(*namespace),
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
    fn extends_untyped_code(&mut self, sym: Sym, depth: u32) -> bool {
        let declared: Vec<(FileId, Decl)> = self.files().decls_of(sym).to_vec();
        if declared.iter().any(|&(file, _)| self.is_untyped_file(file)) {
            return true;
        }
        if depth > 32 || !declared.iter().any(|&(file, decl)| matches!(decl, Decl::Class(class) if self.hir(file)[class].extends.is_some())) {
            return false;
        }
        let bases = self.base_types(sym).into_vec();
        bases.is_empty()
            || bases.into_iter().any(|base| match *self.data(base) {
                TypeData::Ref { target, .. } => self.extends_untyped_code(target, depth + 1),
                _ => true,
            })
    }

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
        let is_of_package = self.is_ambient_interface(sym) && self.files().decls_of(sym).iter().all(|&(file, _)| !self.files().module(file).is_lib);
        let mut root = if !is_called {
            Root::None
        } else if is_of_package {
            Root::Claimed
        } else {
            Root::Function
        };
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
                Root::Claimed => Some(BuiltIn::Claimed),
                Root::Class(class) if class == target => Some(BuiltIn::Instance(ty)),
                Root::Class(class) => {
                    let declared = self.declared_type(class);
                    Some(BuiltIn::Instance(self.permissive_instantiation(declared)))
                }
                _ => None,
            },
            TypeData::Intersection(ref parts) => parts.iter().find_map(|&part| self.built_in_that_is(part)),
            TypeData::Fns { .. } | TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => Some(BuiltIn::Function),
            TypeData::Anon { origin: Origin::TypeLiteral(file, _), .. } => {
                let is_called = !self.signatures(ty, false).is_empty() || !self.signatures(ty, true).is_empty();
                let is_of_package = self.hir(file).kind == FileKind::Declaration && !self.files().module(file).is_lib;
                is_called.then_some(if is_of_package { BuiltIn::Claimed } else { BuiltIn::Function })
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
    pub fn requires_nothing(&mut self, ty: TypeId) -> bool {
        let objects: Vec<TypeId> = self.parts(ty).iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        !objects.is_empty()
            && objects.into_iter().all(|part| {
                self.says_properties(part)
                    && self.members(part).is_some_and(|members| {
                        let shape = members.shape();
                        !shape.props.is_empty() && shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && shape.props.iter().all(|prop| prop.flags.contains(PropFlags::OPTIONAL))
                    })
            })
    }

    pub fn primitives_of_type(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut primitives = Vec::new();
        for primitive in [TypeId::STRING, TypeId::NUMBER, TypeId::BOOLEAN, TypeId::BIGINT, TypeId::SYMBOL] {
            let wrapper = self.apparent_type(primitive);
            let not_known_before = self.aot.flows.times_not_known;
            if self.has_the_names_of(wrapper, ty) && (self.is_of_type(primitive, ty) || self.aot.flows.times_not_known != not_known_before) {
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
            if of_type.resolved.prop(prop.name).is_none() && !of_every_object.is_some_and(|members| members.resolved.prop(prop.name).is_some()) && !self.is_never_stored(prop.name) {
                return false;
            }
        }
        !is_weak || shape.props.iter().any(|prop| of_type.resolved.prop(prop.name).is_some())
    }

    /// Adds the names of the properties of `ty`. Whether a type with an index signature can take it.
    fn add_names_of(&mut self, names: &mut Vec<Atom>, ty: TypeId) -> bool {
        let Some(members) = self.members(ty) else { return false };
        names.extend(members.shape().props.iter().map(|prop| prop.name));
        !members.shape().index.is_empty() || self.is_object_type_with_inferable_index(ty)
    }

    /// The types of the objects that are not laid out and that the program need not have got from anyone: arrays, functions, the objects of
    /// the classes of the engine, and whatever the program or the library of the language declares that is one of them and more. A class
    /// as a value and a function that has been given properties are among them. With `any` for type parameters.
    fn kinds_not_laid_out(&mut self, noted: &FxHashSet<TypeId>, given: &[TypeId], in_parallel: crate::util::InParallel<'_>) -> (Vec<Kind>, Having) {
        const FILES_OF_A_CHECKER: usize = 64;
        const KINDS_OF_A_CHECKER: usize = 512;
        let mut kinds: Vec<(Kind, bool)> = vec![(Kind::Arrays, false), (Kind::Functions, true)];
        kinds.extend(self.classes_of_the_engine().into_iter().map(|class| (Kind::InstancesOf(class), false)));
        let mut noted: Vec<TypeId> = noted.iter().copied().collect();
        noted.sort_unstable_by_key(|ty| ty.0);
        for ty in noted {
            let is_function = matches!(self.built_in_that_is(ty), Some(BuiltIn::Function));
            kinds.push((Kind::Of(ty), is_function));
        }
        kinds.extend(given.iter().map(|&ty| (Kind::Given(ty), false)));
        let files = self.files();
        let mut namespaces: Vec<Sym> = Vec::new();
        for file in (0..files.modules.len() as u32).map(FileId) {
            let hir = self.hir(file);
            if matches!(hir.kind, FileKind::Declaration | FileKind::Json) {
                continue;
            }
            let named = hir.specifier_uses.iter().filter(|named| named.kind.is_dynamic() || named.kind == crate::hir::SpecifierKind::Require).map(|named| named.spec);
            let whole = hir.imports.iter().filter(|import| import.namespace.is_some()).map(|import| import.spec);
            let exported = hir.ids(hir.body).filter_map(|stmt| if let crate::hir::StmtKind::ExportStar { spec, alias, .. } = hir[stmt].kind { alias.is_some().then_some(spec) } else { None });
            namespaces.extend(named.chain(whole).chain(exported).filter_map(|specifier| files.module_of_specifier(file, specifier)));
        }
        namespaces.sort_unstable();
        namespaces.dedup();
        for namespace in namespaces {
            if files.flags(namespace).contains(SymFlags::VALUE_MODULE) {
                kinds.push((Kind::ValueOf(namespace), false));
            }
        }
        // What a package declares is let in where it is seen to come in. Of JavaScript nothing is declared.
        let declaring: Vec<FileId> = (0..files.modules.len() as u32).map(FileId).filter(|&file| !(files.module(file).is_untyped() || (self.only_declares(file) && !files.module(file).is_lib))).collect();
        let declared = self.in_slices(&declaring, FILES_OF_A_CHECKER, Some(in_parallel), &|c, slice| {
            let mut found: Vec<(Sym, Option<bool>, bool)> = Vec::new();
            for &file in slice {
                for (id, symbol) in files.module(file).bound.symbols.iter().enumerate() {
                    let is_type = symbol.flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
                    if !is_type && !(symbol.flags.intersects(SymFlags::FUNCTION | SymFlags::VARIABLE) && symbol.exports.is_some()) {
                        continue;
                    }
                    let sym = files.sym(file, SymbolId(id as u32));
                    let root = if is_type { c.root_of(sym) } else { Root::None };
                    let instances = if root != Root::None && root != Root::Class(sym) {
                        Some(root == Root::Function)
                    } else {
                        (root == Root::None && symbol.flags.intersects(SymFlags::CLASS) && c.extends_untyped_code(sym, 0)).then_some(false)
                    };
                    // The class as a value, with what is static in it, and a function that has properties.
                    let is_value = files.flags(sym).intersects(SymFlags::CLASS | SymFlags::FUNCTION | SymFlags::VARIABLE) && files.each_export(sym).len() != 0 && {
                        let value = c.type_of_symbol(sym);
                        c.has_properties(value) && !(c.signatures(value, false).is_empty() && c.signatures(value, true).is_empty())
                    };
                    found.push((sym, instances, is_value));
                }
            }
            found
        });
        let mut seen: FxHashSet<Sym> = FxHashSet::default();
        for (sym, instances, is_value) in declared.into_iter().flatten() {
            if !seen.insert(sym) {
                continue;
            }
            kinds.extend(instances.map(|are_functions| (Kind::InstancesOf(sym), are_functions)));
            if is_value {
                kinds.push((Kind::ValueOf(sym), true));
            }
        }
        let names = self.in_slices(&kinds, KINDS_OF_A_CHECKER, Some(in_parallel), &|c, slice| {
            let of_functions = [known::Function, known::CallableFunction, known::NewableFunction].map(|name| c.global_ref(name, &[]));
            let mut of_slice: Vec<(bool, Vec<Atom>, Vec<Box<[u8]>>)> = Vec::with_capacity(slice.len());
            for &(kind, is_function) in slice {
                let mut names = Vec::new();
                let ty = c.type_of_kind(kind);
                let mut is_indexable = c.add_names_of(&mut names, ty);
                for of_function in of_functions.into_iter().filter(|_| is_function) {
                    is_indexable |= c.add_names_of(&mut names, of_function);
                }
                let own: Vec<Box<[u8]>> = names.iter().filter(|name| name.is_own()).map(|&name| c.atoms().bytes(name).into()).collect();
                names.retain(|name| !name.is_own());
                of_slice.push((is_indexable, names, own));
            }
            of_slice
        });
        let mut having = Having::default();
        for (index, (is_indexable, names, own)) in names.into_iter().flatten().enumerate() {
            let index = index as u32;
            having.all.push(index);
            if is_indexable {
                having.indexable.push(index);
            }
            for name in names.into_iter().chain(own.iter().map(|text| self.atoms().intern(text))) {
                let indexes = having.by_name.entry(name).or_default();
                if indexes.last() != Some(&index) {
                    indexes.push(index);
                }
            }
        }
        (kinds.into_iter().map(|kind| kind.0).collect(), having)
    }

    fn type_of_kind(&mut self, kind: Kind) -> TypeId {
        let ty = match kind {
            Kind::Made(ty) | Kind::Assignable(ty) => return ty,
            Kind::Of(ty) | Kind::Given(ty) => ty,
            Kind::Arrays => return self.array_of(TypeId::ANY),
            Kind::Functions => return self.global_ref(known::Function, &[]),
            Kind::InstancesOf(sym) => self.declared_type(sym),
            Kind::ValueOf(sym) => self.type_of_symbol(sym),
        };
        self.permissive_instantiation(ty)
    }

    // ───────────────────────────── the relation ─────────────────────────────

    /// Whether an object that is made as `made` says is of type `view`, neither of them a union. That is the assignability relation. In
    /// either a type parameter stands for anything, because type arguments do not exist at run time: what generic code is handed as a
    /// `Box<T>` was made as a `Box<string>`, and the `Both<T>` it allocates is a `Cache<string>` to the caller.
    ///
    /// With one exception: a type parameter of `made` does not stand for a CONSTANT. Where a field of `view` is a discriminant, that of
    /// `made` goes by its bound (`discriminants_agree`): the `Token<TKind>` of `createToken<TKind>` has a `kind` that is a `SyntaxKind`, and
    /// is neither an `AsteriskToken` nor a `{ kind: "untransformed" }`. It becomes one by the test on the way out of the generic code,
    /// see `Subtypes::verdict`. Not so for an object of a generic class: one layout for all instantiations, no shape transition.
    ///
    /// Once it is known which names are stored, `view` has no property by any other, nor have the types of its properties.
    fn is_of_type(&mut self, made: TypeId, view: TypeId) -> bool {
        self.is_of_type_as(made, view, true)
    }

    /// `goes_by_fields`: see below. Without it, it is assignability as the language has it, dead properties and type parameters aside.
    fn is_of_type_as(&mut self, made: TypeId, view: TypeId, goes_by_fields: bool) -> bool {
        let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
        if self.is_provably_related(made, view, relation) {
            return true;
        }
        // It has the live fields, with the same discriminants: a subtype whatever its reference fields are declared to point to. A read
        // through the narrower type is tested (`Lowering::readField`). At the link only, where the dead fields are known.
        if goes_by_fields && self.aot.flows.stored.is_some() && self.says_properties(made) && self.says_properties(view) && self.has_same_fields(made, view, false) {
            return true;
        }
        if goes_by_fields
            && self.aot.flows.stored.is_some()
            && self.says_properties(made)
            && self.says_properties(view)
            && !self.is_provably_related(view, made, relation)
            && self.is_assignable_ignoring_optionality(made, view, relation)
        {
            return true;
        }
        let is_made_generic = self.has_type_variables(made);
        if !is_made_generic && !self.has_type_variables(view) {
            return false;
        }
        if is_made_generic && !self.is_type_of_instances(made) && !self.discriminants_agree(made, view, relation, !goes_by_fields) {
            return false;
        }
        let (made, view) = (self.permissive_instantiation(made), self.permissive_instantiation(view));
        self.is_provably_related(made, view, relation)
    }

    fn is_narrowed_from(&mut self, view: TypeId, made: TypeId) -> bool {
        if !matches!(self.data(view), TypeData::Intersection(_)) || !self.says_properties(made) || !self.says_properties(view) {
            return false;
        }
        let relation = if self.aot.flows.stored.is_some() { Relation::AssignableAsStored } else { Relation::Assignable };
        let (Some(of_made), Some(of_view)) = (self.members(made), self.members(view)) else { return false };
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(of_made.shape()) || !is_plain(of_view.shape()) || of_made.shape().props.len() != of_view.shape().props.len() {
            return false;
        }
        const KIND: PropFlags = PropFlags::METHOD.union(PropFlags::ACCESSOR);
        for view_prop in of_view.shape().props.iter() {
            let Some(made_prop) = of_made.resolved.prop(view_prop.name) else { return false };
            if made_prop.flags & KIND != view_prop.flags & KIND {
                return false;
            }
            let (made_type, view_type) = (self.type_of_prop(made_prop, of_made.mapper), self.type_of_prop(view_prop, of_view.mapper));
            if made_type != view_type && !self.is_provably_related(made_type, view_type, relation) && !self.is_provably_related(view_type, made_type, relation) {
                return false;
            }
        }
        true
    }

    fn is_assignable_ignoring_optionality(&mut self, made: TypeId, view: TypeId, relation: Relation) -> bool {
        let (Some(of_made), Some(of_view)) = (self.members(made), self.members(view)) else { return false };
        let is_plain = |shape: &Shape| shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty();
        if !is_plain(of_made.shape()) || !is_plain(of_view.shape()) {
            return false;
        }
        let mut is_one_optional = false;
        for view_prop in of_view.shape().props.iter() {
            if self.is_never_stored(view_prop.name) {
                continue;
            }
            let is_required = !view_prop.flags.contains(PropFlags::OPTIONAL);
            let Some(made_prop) = of_made.resolved.prop(view_prop.name) else {
                if is_required {
                    return false;
                }
                continue;
            };
            let (mut made_type, view_type) = (self.type_of_prop(made_prop, of_made.mapper), self.type_of_prop(view_prop, of_view.mapper));
            if is_required && made_prop.flags.contains(PropFlags::OPTIONAL) {
                made_type = self.non_nullable(made_type);
                is_one_optional = true;
            }
            if made_type != view_type && !self.is_provably_related(made_type, view_type, relation) {
                return false;
            }
        }
        is_one_optional
    }

    /// Whether every field of `view` whose type is a set of constants takes what `made`, as it is declared, has in that field. `by_bounds`, for what no flow has brought
    /// (`subtypes.rs`, phase B): also every field of `view` that holds primitives alone, where that of `made` is a type parameter whose bound is primitives alone. A numeric enum as
    /// a whole names no constant, and `TKind extends SyntaxKind` is no `TypeMapKind` all the same.
    fn discriminants_agree(&mut self, made: TypeId, view: TypeId, relation: Relation, by_bounds: bool) -> bool {
        let (Some(of_made), Some(of_view)) = (self.members(made), self.members(view)) else { return true };
        let are_primitives = |c: &Self, ty: TypeId| c.parts(ty).iter().all(|&part| c.has_primitive_flag(part));
        for view_prop in of_view.shape().props.iter() {
            let view_type = self.type_of_prop(view_prop, of_view.mapper);
            let names_constants = !self.literals_of_type(view_type).is_empty();
            if !names_constants && !(by_bounds && are_primitives(self, view_type)) {
                continue;
            }
            let Some(made_prop) = of_made.resolved.prop(view_prop.name) else { continue };
            let made_type = self.type_of_prop(made_prop, of_made.mapper);
            if !names_constants && !self.base_constraint_of(made_type).is_some_and(|bound| are_primitives(self, bound)) {
                continue;
            }
            if !self.is_provably_related(made_type, view_type, relation) {
                return false;
            }
        }
        true
    }

    /// `e`: a name whose declared union the checker has narrowed because a type guard `g(e)` returned true. A guard proves its own type and
    /// nothing else. The checker keeps the union members that are SUBTYPES of that type, which drops `Cls { name?: string }` under
    /// `n is { name: string }` although the guard was truthful for it. What is left of `stored` is every member that has the fields
    /// the guard's type requires, optional or not, besides what the checker kept (`own`). `None`: no guard is seen to be the cause.
    pub(super) fn type_proved_by_guard(&mut self, file: FileId, e: ExprId, stored: TypeId, own: TypeId) -> Option<TypeId> {
        let guard = self.guard_narrowing(file, e)?;
        let kept = self.filter(stored, |c, part| c.parts(own).contains(&part) || (c.says_properties(part) && c.has_the_names_of(part, guard)));
        Some(kept)
    }

    /// The type of the nearest type guard that is known to have returned true for the name `e` where it is read, with nothing but other
    /// conditions in between.
    fn guard_narrowing(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        const MOST_STEPS: usize = 32;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let named = bound.expr_symbol[e.idx()];
        if named.is_none() {
            return None;
        }
        let mut at = bound.expr_flow[e.idx()];
        for _ in 0..MOST_STEPS {
            let (before, tested) = match bound.flow[at.idx()] {
                Flow::Cond { before, expr, sense: true } => (before, expr),
                Flow::Cond { before, .. } | Flow::Switch { before, .. } => (before, ExprId::NONE),
                Flow::Call { before, call } => (before, call),
                _ => return None,
            };
            at = before;
            let Some(tested) = tested.some() else { continue };
            let ExprKind::Call(call) = hir[tested].kind else { continue };
            let Some(sig) = self.resolved_signature(file, tested).sig else { continue };
            let Some(predicate) = self.sig_predicate(sig) else { continue };
            let (Some(index), Some(guard)) = (predicate.param, predicate.ty) else { continue };
            let Some(argument) = hir.ids(hir[call].args).nth(index) else { continue };
            if matches!(hir[argument].kind, ExprKind::Ident(_)) && bound.expr_symbol[argument.idx()] == named {
                return Some(guard);
            }
        }
        None
    }

    /// From here on `is_of_type` and all that goes before it leave out the properties whose names are not among `stored`.
    fn go_by_names_stored(&mut self, stored: &FxHashSet<Atom>) {
        let bits = self.p.aot.storage.names_stored.get_or_init(|| {
            let mut bits: Vec<u64> = Vec::new();
            for name in stored.iter().filter(|name| name.is_some() && !name.is_own()) {
                let at = name.0 as usize;
                if bits.len() <= at / 64 {
                    bits.resize(at / 64 + 1, 0);
                }
                bits[at / 64] |= 1 << (at % 64);
            }
            std::sync::Arc::new(bits)
        });
        self.aot.flows.stored = Some(bits.clone());
    }

    /// Whether the objects of the type are made by the program, as far as the type tells. What a declaration file declares is made
    /// elsewhere, and so is an array: which names the program stores says nothing of what those have.
    pub(in crate::check) fn is_made_by_the_program(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => !self.only_declares(target.file),
            TypeData::Tuple { .. } => false,
            _ => true,
        }
    }

    /// Whether a declaration file declares the record type. The program may allocate it, `const o: FromADts = { .. }`, but what it is there
    /// for is host objects, which reach its places by ways nobody follows: a property of another host object, a cast of `require(..)`.
    /// So it always admits foreign objects.
    pub fn is_declared_only_record(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { target, .. } => self.only_declares(target.file),
            TypeData::Anon { origin: Origin::TypeLiteral(file, _), .. } => self.only_declares(*file),
            TypeData::Intersection(parts) => parts.iter().any(|&part| self.is_declared_only_record(part)),
            TypeData::Synth(shape) if shape.spread_rank >= u32::MAX - 1 => shape.created_from.is_some_and(|(_, viewed)| self.parts(viewed).iter().any(|&part| self.is_declared_only_record(part))),
            _ => false,
        }
    }

    /// `readonly T[]`, `ReadonlyArray<T>` and a readonly tuple as what they are when the program runs: `T[]`, and the tuple. Any other type
    /// as it is.
    pub(in crate::check) fn without_readonly(&mut self, ty: TypeId) -> TypeId {
        match *self.data(ty) {
            TypeData::Tuple { readonly: true, ref flags, .. } => {
                let (elements, flags) = (self.type_arguments(ty).to_vec(), flags.to_vec());
                self.tuple(&elements, &flags, false)
            }
            TypeData::Ref { .. } if self.is_reference_to_global(ty, known::ReadonlyArray, 1) => match self.array_element(ty) {
                Some(element) => self.array_of(element),
                None => ty,
            },
            _ => ty,
        }
    }

    /// Whether it is known that no code of the program stores a property by the name. Not known: before the program is linked; of a name
    /// that only this checker has come by; of a key that is a symbol and of `#x`, which whoever counts the stores spells otherwise.
    pub(in crate::check) fn is_never_stored(&self, name: Atom) -> bool {
        let Some(stored) = &self.aot.flows.stored else { return false };
        if name.is_none() || name.is_own() {
            return false;
        }
        let at = name.0 as usize;
        let is_stored = stored.get(at / 64).is_some_and(|word| word >> (at % 64) & 1 != 0);
        !is_stored && !self.atoms().bytes(name).starts_with(&[0xFE])
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
            // As the relation has it: a type that requires a property is not weak, stored or not.
            is_weak = false;
            if of_every_object.is_some_and(|members| members.resolved.prop(prop.name).is_some()) || self.is_never_stored(prop.name) {
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

    // ───────────────────────────── the whole program ─────────────────────────────

    /// The views that what is held to one of `roots` gets into, if it is plain data: those, the types of their fields, and so on all the
    /// way down, through arrays. Not what the fields of a class hold: plain data is no object of a class. `index_of`: of the views. Each
    /// with the first of the places of the roots it is come by from.
    fn views_held_within(&mut self, roots: impl Iterator<Item = (TypeId, Place)>, index_of: &FxHashMap<TypeId, u32>, forms_beyond: &mut Vec<TypeId>) -> FxHashMap<TypeId, Place> {
        let mut roots: Vec<(TypeId, Place)> = roots.collect();
        roots.sort_unstable_by_key(|root| root.1);
        let mut seen: FxHashSet<TypeId> = FxHashSet::default();
        let mut held: FxHashMap<TypeId, Place> = FxHashMap::default();
        for (root, at) in roots {
            let mut pending = vec![root];
            while let Some(ty) = pending.pop() {
                if !index_of.contains_key(&ty) {
                    if self.is_nested_too_deeply(ty) {
                        forms_beyond.extend(self.generic_form_of(ty));
                    }
                    continue;
                }
                if held.contains_key(&ty) {
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

    /// Once everything is translated: gathers the flows between `views`, the types that say how the objects of the program are laid out, no
    /// two of them the same, and what is compared of each before the relation is asked. The whole program is looked at here and in
    /// `subtypes.rs`, and nowhere else. What comes of it depends on what is in the sets and on the order of the views, and on nothing else.
    ///
    /// What it yields goes in rounds. Any number of checkers of the program may `answer` any slices of `Subtypes::questions`, if the views are
    /// published, this one answers `Subtypes::own_questions`, and the answers, in the order of the questions, go to `Subtypes::advance`, until
    /// there are no more questions.
    ///
    /// `stored`: the names by which some code of the linked program stores a property, or defines a method or an accessor. A property by
    /// another name does not exist. A name too few costs nothing but speed: what is stored by it after all is an extra property, as
    /// with any name that a layout has no field for, and so is what plain data brings along when it is copied into a layout.
    ///
    /// `says_progress`: `--aot-explain=progress`.
    pub fn begin_subtypes(&mut self, noted: Noted, views: &[TypeId], fields: FieldTypes, stored: FxHashSet<Atom>, says_progress: bool, in_parallel: crate::util::InParallel<'_>) -> Subtypes {
        const VIEWS_OF_A_CHECKER: usize = 512;
        let mut clock = subtypes::Clock::new(says_progress);
        clock.say(format_args!(
            "gathering: {} views, {} types of fields with {} views in them, {} unions; noted: {} sites, {} upcasts, {} casts, {} tests, {} vouched for, {} untyped into, {} copied into, {} not laid out",
            views.len(),
            fields.views_in.len(),
            fields.views_in.iter().map(Vec::len).sum::<usize>(),
            fields.together.len(),
            noted.allocated_at_site.len(),
            noted.upcasts.len(),
            noted.casts.len(),
            noted.tests.len(),
            noted.vouched_into.len(),
            noted.untyped_into.len(),
            noted.copied_into.len(),
            noted.foreign.len()
        ));
        let mut cut_short: Vec<(Place, [u32; 4])> = noted.cut_short.iter().map(|(&at, &times)| (at, times)).collect();
        cut_short.sort_unstable();
        let sums = cut_short.iter().fold([0u32; 4], |sums, cut| [sums[0] + cut.1[0], sums[1] + cut.1[1], sums[2] + cut.1[2], sums[3] + cut.1[3]]);
        let first = cut_short.first().map_or_else(String::new, |cut| format!("; the first at {}", self.place_for_people(cut.0)));
        clock.say(format_args!(
            "what is held within what enters: the walk was cut short at {} places: {} times for what nests in itself, {} for too many of two declarations, {} for the stack, {} for too many levels{first}; the most of two declarations in one body: {} looked into, {} of them for what nests in itself; the deepest: {} levels",
            cut_short.len(),
            sums[0],
            sums[1],
            sums[2],
            sums[3],
            noted.most_looked_into[0],
            noted.most_looked_into[1],
            noted.most_looked_into[2]
        ));
        self.go_by_names_stored(&stored);
        let mut index_of: FxHashMap<TypeId, u32> = FxHashMap::default();
        for (index, &view) in views.iter().enumerate() {
            index_of.entry(view).or_insert(index as u32);
        }
        // Plain data is copied into the layout of the type it is cast to, and what it holds into the layouts of the types of the fields.
        // So objects are made as those.
        let mut forms_beyond: Vec<TypeId> = Vec::new();
        let copied_into = self.views_held_within(noted.copied_into.iter().map(|&ty| (ty, Place::NOWHERE)), &index_of, &mut Vec::new());
        let untyped_into = self.views_held_within(noted.untyped_into.iter().map(|(&ty, &at)| (ty, at)), &index_of, &mut forms_beyond);
        let mut noted = noted;
        let (mut seen_beyond, mut staying) = (FxHashSet::default(), Vec::new());
        for form in forms_beyond {
            self.add_what_stays_untyped(form, true, &mut seen_beyond, &mut staying);
        }
        for view in staying {
            noted.add_foreign(view, None, Place::NOWHERE);
        }
        clock.say(format_args!("what is held within: {} copied into, {} untyped into", copied_into.len(), untyped_into.len()));

        let types: Vec<TypeId> = views.to_vec();
        let altered = Alteration::ALL.map(|alteration| noted.escapes.with_alterations(|noted| noted.closed(alteration)));
        let types_altered: [Vec<TypeId>; 2] = [0, 1].map(|alteration: usize| {
            let mut handed_over: Vec<TypeId> = altered[alteration].types.clone();
            handed_over.sort_unstable_by_key(|ty| ty.0);
            let (mut found, mut seen): (Vec<TypeId>, FxHashSet<TypeId>) = Default::default();
            for ty in handed_over {
                self.add_object_types_in(ty, false, &mut seen, &mut found);
            }
            found
        });

        // The members of the global `Object`, which every object is taken to have.
        let object = self.global_ref(known::Object, &[]);
        let mut of_every_object: Vec<u32> = self.members(object).map_or_else(Vec::new, |members| members.shape().props.iter().map(|prop| prop.name.0).collect());
        of_every_object.sort_unstable();
        let numbered: Vec<(usize, TypeId)> = types.iter().copied().enumerate().collect();
        let gather = |c: &mut Checker<'p, 's>, slice: &[(usize, TypeId)]| {
            c.go_by_names_stored(&stored);
            let (mut facts, mut declared): (Vec<Facts>, Vec<(u32, u32)>) = Default::default();
            let (mut passed, mut found): (FxHashSet<TypeId>, Vec<u32>) = Default::default();
            for &(index, ty) in slice {
                let mut of_type = c.facts_of(ty, &of_every_object);
                c.add_undeclared_fields_to(&mut of_type, ty, &stored);
                if noted.allocated_at_site.contains(&ty) {
                    of_type.flags |= subtypes::HAS_SITE;
                }
                if copied_into.contains_key(&ty) && of_type.flags & subtypes::IS_INSTANCE == 0 {
                    of_type.flags |= subtypes::IS_COPIED;
                }
                facts.push(of_type);
                passed.clear();
                found.clear();
                c.add_declared_supertypes(ty, &index_of, &mut passed, &mut found);
                found.sort_unstable();
                found.dedup();
                declared.extend(found.iter().filter(|&&supertype| supertype as usize != index).map(|&supertype| (index as u32, supertype)));
            }
            (facts, declared)
        };
        let has_own_atoms = |facts: &Facts| {
            let is_own = |name: u32| Atom(name).is_own();
            [&facts.declared, &facts.live, &facts.required, &facts.open].into_iter().any(|names| names.iter().any(|&name| is_own(name)))
                || facts.constants.iter().any(|&(name, constant)| is_own(name) || constant >> 32 == 0x7FF8_0001 && is_own(constant as u32))
        };
        let of_slices = self.in_slices(&numbered, VIEWS_OF_A_CHECKER, Some(in_parallel), &|c, slice| Some(gather(c, slice)).filter(|gathered| !gathered.0.iter().any(has_own_atoms)));
        let mut facts: Vec<Facts> = Vec::with_capacity(types.len());
        let mut declared: Vec<(u32, u32)> = Vec::new();
        for (slice, gathered) in numbered.chunks(VIEWS_OF_A_CHECKER).zip(of_slices) {
            let (of_facts, of_declared) = gathered.unwrap_or_else(|| gather(self, slice));
            facts.extend(of_facts);
            declared.extend(of_declared);
        }
        let has_own_names: Vec<bool> = facts.iter().map(has_own_atoms).collect();
        clock.say(format_args!("the facts: {} types, {} declared supertypes", types.len(), declared.len()));
        let asked_as: Vec<TypeId> = types.iter().map(|&ty| self.type_coerced_to(ty)).collect();
        clock.say(format_args!("what the relation is asked about"));

        // Whatever is held to a type without the operations saying what it is: see `subtypes.rs`, phase B.
        let mut first_vouched: FxHashMap<u32, Place> = FxHashMap::default();
        for (ty, &at) in noted.vouched_into.iter().chain(&untyped_into).chain(&copied_into) {
            if let Some(&index) = index_of.get(ty) {
                let first = first_vouched.entry(index).or_insert(at);
                *first = at.min(*first);
            }
        }
        // Whoever stores to a field without knowing the layout hands it anything, and the engine holds that to the type of the field.
        for ty in fields.of_views.iter().flatten().map(|field| field.1).chain(fields.of_static_fields.iter().copied()) {
            for &view in &fields.views_in[ty as usize] {
                first_vouched.entry(view).or_insert(Place::NOWHERE);
            }
        }
        let mut vouched: Vec<(u32, Place)> = first_vouched.into_iter().collect();
        vouched.sort_unstable();

        // An object that is not laid out is in a place of the type where it has been seen to get there, and may be where the program
        // holds a value to the type of which its text says nothing, if there is such an object that is of the type.
        let mut foreign: Vec<(u32, Option<TypeId>, WhyForeign)> = Vec::new();
        let mut about_kinds: Vec<(Question, u32, WhyForeign)> = Vec::new();
        let mut given: Vec<TypeId> = noted.not_laid_out.iter().copied().collect();
        given.retain(|&ty| self.is_tainted(ty));
        for ty in &given {
            noted.not_laid_out.remove(ty);
        }
        given.sort_unstable_by_key(|ty| ty.0);
        let (others, having) = self.kinds_not_laid_out(&noted.not_laid_out, &given, in_parallel);
        clock.say(format_args!("{} vouched for, {} kinds that are not laid out", vouched.len(), others.len()));
        let is_namespace_kind = |c: &Self, kind: Kind| match kind {
            Kind::Of(ty) => matches!(c.data(ty), TypeData::Anon { origin: Origin::Module(..), .. }),
            Kind::ValueOf(sym) => c.files().flags(sym).contains(SymFlags::VALUE_MODULE),
            _ => false,
        };
        let has_namespaces = others.iter().any(|&kind| is_namespace_kind(self, kind));
        let mut having_of_nobody = Having::default();
        for (index, names) in std::mem::take(&mut self.aot.flows.given_and_kept_by_nobody).into_iter().enumerate() {
            having_of_nobody.all.push(index as u32);
            having_of_nobody.indexable.push(index as u32);
            for name in names {
                having_of_nobody.by_name.entry(name).or_default().push(index as u32);
            }
        }
        let (let_out, entered, entered_if_let_out) = noted.evidence_of_strangers();
        let opened = self.classes_opened_for_strangers(&let_out, &entered, &entered_if_let_out);
        let numbered: Vec<(usize, TypeId)> = views.iter().copied().enumerate().collect();
        let ask = |c: &mut Checker<'p, 's>, slice: &[(usize, TypeId)]| {
            c.go_by_names_stored(&stored);
            let mut foreign: Vec<(u32, Option<TypeId>, WhyForeign)> = Vec::new();
            let mut about_kinds: Vec<(Question, u32, WhyForeign)> = Vec::new();
            let (mut candidates, mut of_nobody): (Vec<u32>, Vec<u32>) = Default::default();
            for &(index, view) in slice {
                let seen_at = noted.foreign.get(&view).map(|seen| seen.1);
                if let Some(&(source, at)) = noted.foreign.get(&view) {
                    // What a coercion lets through is whatever it was, laid out or not. It passes no cast for being that.
                    let passing = source.filter(|_| !c.is_view_made_by_coercion(view));
                    foreign.push((index as u32, passing, WhyForeign::Seen { source, at }));
                } else if c.is_declared_only_record(view) {
                    foreign.push((index as u32, None, WhyForeign::DeclaredOnly));
                    continue;
                } else if c.is_type_of_instances(view) && c.extends_one_of(view, &opened) {
                    foreign.push((index as u32, None, WhyForeign::Instance));
                    continue;
                }
                let untyped_at = untyped_into.get(&view).copied().filter(|_| seen_at.is_none());
                let vouched_at = vouched.binary_search_by_key(&(index as u32), |target| target.0).ok().map(|found| vouched[found].1);
                let flows_in = seen_at.or(untyped_at).or(vouched_at);
                let Some(at) = flows_in.or(has_namespaces.then_some(Place::NOWHERE)) else { continue };
                candidates.clear();
                c.add_candidates(&having, view, &mut candidates);
                candidates.sort_unstable();
                candidates.dedup();
                let is_given = |candidate: &u32| matches!(others[*candidate as usize], Kind::Given(_));
                let is_made_by_coercion = c.is_view_made_by_coercion(view) || flows_in.is_none();
                if !is_made_by_coercion {
                    of_nobody.clear();
                    c.add_candidates(&having_of_nobody, view, &mut of_nobody);
                    if !of_nobody.is_empty() {
                        foreign.push((index as u32, None, WhyForeign::GivenAndKeptByNobody { at }));
                        continue;
                    }
                }
                let of_given: Vec<u32> = candidates.iter().copied().filter(|candidate| !is_made_by_coercion && is_given(candidate)).collect();
                if of_given.len() > MOST_GIVEN_KINDS_ASKED_ABOUT {
                    foreign.push((index as u32, None, WhyForeign::Given { at, candidate: Candidate(others[of_given[0] as usize]) }));
                    continue;
                }
                about_kinds.extend(of_given.iter().map(|&candidate| {
                    let kind = others[candidate as usize];
                    (Question { kind, view }, index as u32, WhyForeign::Given { at, candidate: Candidate(kind) })
                }));
                let is_namespace: Vec<bool> = candidates.iter().map(|&candidate| is_namespace_kind(c, others[candidate as usize])).collect();
                let mut is_namespace = is_namespace.into_iter();
                about_kinds.extend(candidates.iter().filter(|candidate| (is_namespace.next() == Some(true) || untyped_at.is_some()) && !is_given(candidate)).map(|&candidate| {
                    let kind = others[candidate as usize];
                    (Question { kind, view }, index as u32, WhyForeign::Untyped { at, candidate: Candidate(kind) })
                }));
            }
            (foreign, about_kinds)
        };
        let of_slices = self.in_slices(&numbered, VIEWS_OF_A_CHECKER, Some(in_parallel), &|c, slice| (!slice.iter().any(|view| has_own_names[view.0])).then(|| ask(c, slice)));
        for (slice, asked) in numbered.chunks(VIEWS_OF_A_CHECKER).zip(of_slices) {
            let (of_foreign, of_kinds) = asked.unwrap_or_else(|| ask(self, slice));
            foreign.extend(of_foreign);
            about_kinds.extend(of_kinds);
        }

        let mut upcasts: Vec<(u32, u32, Place)> = noted.upcasts.iter().filter_map(|(&(from, to), &at)| Some((*index_of.get(&from)?, *index_of.get(&to)?, at))).collect();
        upcasts.sort_unstable();
        let mut casts: Vec<(u32, u32)> = noted.casts.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        casts.sort_unstable();
        let mut guards: Vec<(u32, u32)> = noted.guards.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        guards.sort_unstable();
        let mut forced: Vec<(u32, u32)> = noted.forced.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        forced.sort_unstable();
        let mut tests: Vec<(u32, u32)> = noted.tests.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        tests.sort_unstable();
        // What is altered need not be a view: nothing may be looked at as it. It has no number then, and no set. What is seen to get to it may
        // be altered, and what may fit it by its names.
        let altered: [AlteredViews; 2] = [0, 1].map(|alteration: usize| {
            let besides: FxHashSet<TypeId> = types_altered[alteration].iter().copied().filter(|ty| !index_of.contains_key(ty)).collect();
            let into_besides = noted.upcasts.keys().chain(&noted.casts).chain(&noted.tests).filter(|edge| besides.contains(&edge.1)).filter_map(|edge| index_of.get(&edge.0).copied());
            let mut views: Vec<u32> = types_altered[alteration].iter().filter_map(|ty| index_of.get(ty).copied()).chain(into_besides).collect();
            views.sort_unstable();
            views.dedup();
            let mut besides: Vec<TypeId> = besides.into_iter().collect();
            besides.sort_unstable_by_key(|ty| ty.0);
            let besides: Vec<Facts> = besides.into_iter().map(|ty| self.facts_of(ty, &of_every_object)).collect();
            AlteredViews { views, besides, is_untyped: altered[alteration].is_untyped, is_anything: altered[alteration].is_anything }
        });
        let mut held_untyped: Vec<(u32, Place)> = noted.untyped_into.iter().filter_map(|(ty, &at)| Some((*index_of.get(ty)?, at))).collect();
        let mut checked: Vec<(u32, Place)> = noted.checked_into.iter().filter_map(|(ty, &at)| Some((*index_of.get(ty)?, at))).collect();
        checked.sort_unstable();
        held_untyped.sort_unstable();
        let by_view = |callees: &FxHashMap<(TypeId, Atom), Callee>| -> Vec<(u32, Atom, Callee)> { callees.iter().filter_map(|(&(holder, name), &callee)| Some((*index_of.get(&holder)?, name, callee))).collect() };
        let (callees_at_birth, callees_stored) = (by_view(&noted.callees_at_birth), by_view(&noted.callees_stored));
        let creations = noted.creations.by_view(&index_of);
        let constructions = noted.constructions.by_view(&index_of);
        clock.say(format_args!("the edges: {} questions about kinds", about_kinds.len()));
        let gathered = Gathered {
            types,
            asked_as,
            facts,
            declared,
            upcasts,
            casts,
            guards,
            forced,
            tests,
            vouched,
            held_untyped,
            checked,
            checked_by_road: noted.checked_by_road,
            logs_type_errors: self.logs_type_errors(),
            opens_for_the_log: OpensForTheLog::Nothing,
            admitting_when_closed: Vec::new(),
            about_kinds_once_more: Vec::new(),
            foreign,
            about_kinds,
            altered,
            fields,
            stored,
            callees_at_birth,
            callees_stored,
            escapes: noted.escapes,
            creations,
            constructions,
        };
        Subtypes::new(gathered, clock)
    }

    /// What kind of type it is, in a word that says nothing of the program.
    fn kind_of_view(&self, ty: TypeId) -> &'static str {
        match self.data(ty) {
            TypeData::Ref { .. } => "a reference",
            TypeData::Intersection(_) => "an intersection",
            TypeData::Synth(_) => "synthesized",
            TypeData::ReverseMapped { .. } => "reverse mapped",
            TypeData::Anon { origin: Origin::TypeLiteral(..), .. } => "a type literal",
            TypeData::Anon { origin: Origin::Mapped(..), .. } => "mapped",
            TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. } => "an object literal",
            TypeData::Anon { .. } => "of a declaration",
            _ => "another",
        }
    }

    /// What is compared of the type before the relation is asked about it. `of_every_object`: the names that every object has, ascending.
    fn facts_of(&mut self, ty: TypeId, of_every_object: &[u32]) -> Facts {
        let mut flags = 0;
        for (is_so, flag) in [(self.is_view_made_by_coercion(ty), subtypes::IS_MADE_BY_COERCION), (self.is_type_of_instances(ty), subtypes::IS_INSTANCE), (self.has_type_variables(ty), subtypes::IS_GENERIC)] {
            if is_so {
                flags |= flag;
            }
        }
        let kind = self.kind_of_view(ty);
        let Some(members) = self.members(ty) else { return Facts { flags, kind, ..Facts::default() } };
        let shape = members.shape();
        let (mut declared, mut live, mut required, mut open): (Vec<u32>, Vec<u32>, Vec<u32>, Vec<u32>) = Default::default();
        let mut constants: Vec<(u32, u64)> = Vec::new();
        let (mut requires_a_property, mut is_flat, mut is_flat_but_for_functions) = (false, true, true);
        for prop in shape.props.iter() {
            let name = prop.name.0;
            let is_live = !self.is_never_stored(prop.name);
            declared.push(name);
            if is_live {
                live.push(name);
            }
            if !prop.flags.contains(PropFlags::OPTIONAL) {
                requires_a_property = true;
                if is_live && of_every_object.binary_search(&name).is_err() {
                    required.push(name);
                }
            }
            let of_prop = self.type_of_prop(prop, members.mapper);
            // Also what no code of the program stores: plain data brings it along, and a read finds it.
            is_flat &= self.parts(of_prop).iter().all(|&part| self.has_primitive_flag(part));
            // Nothing is ever made of a function either.
            is_flat_but_for_functions &= self.parts(of_prop).iter().all(|&part| self.has_primitive_flag(part) || matches!(self.built_in_that_is(part), Some(BuiltIn::Function)));
            if of_prop.is_any() || of_prop.is_never() || self.has_type_variables(of_prop) {
                open.push(name);
                continue;
            }
            let is_nil_or_constant = |c: &Self, part: TypeId| {
                matches!(
                    c.data(part),
                    TypeData::StringLit { .. }
                        | TypeData::NumberLit { .. }
                        | TypeData::EnumLit { .. }
                        | TypeData::Intrinsic(Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening)
                )
            };
            if !self.parts(of_prop).iter().all(|&part| is_nil_or_constant(self, part)) {
                continue;
            }
            let named = self.literals_of_type(of_prop);
            if prop.flags.contains(PropFlags::OPTIONAL) || self.parts(of_prop).iter().any(|&part| matches!(self.data(part), TypeData::Intrinsic(_))) {
                constants.push((name, 0x7FF8_0002_0000_0000));
            }
            if !named.is_empty() {
                flags |= subtypes::HAS_CONSTANTS | if named.len() == 1 { subtypes::IS_CONCRETE } else { 0 };
            }
            // A string is told from every number: no number but NaN has these bits, and no type names NaN.
            constants.extend(named.into_iter().map(|constant| match constant {
                Literal::String(text) => (name, 0x7FF8_0001_0000_0000 | u64::from(text.0)),
                Literal::Number(number) => (name, number.to_bits()),
            }));
        }
        if !shape.index.is_empty() {
            flags |= subtypes::HAS_INDEX_SIGNATURE;
        } else if !requires_a_property {
            flags |= subtypes::IS_WEAK;
        }
        if is_flat_but_for_functions && shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && flags & subtypes::IS_INSTANCE == 0 {
            flags |= subtypes::IS_FLAT_BUT_FOR_FUNCTIONS;
            if is_flat {
                flags |= subtypes::IS_FLAT;
            }
        }
        for names in [&mut declared, &mut live, &mut required, &mut open] {
            names.sort_unstable();
        }
        constants.sort_unstable();
        constants.dedup();
        Facts { flags, declared: declared.into(), live: live.into(), required: required.into(), constants: constants.into(), open: open.into(), kind }
    }

    /// Appends the views that `ty` declares as supertypes: what it `extends`, the parts of an intersection. Beyond one that is no view, what
    /// that declares.
    fn add_declared_supertypes(&mut self, ty: TypeId, index_of: &FxHashMap<TypeId, u32>, passed: &mut FxHashSet<TypeId>, out: &mut Vec<u32>) {
        let supertypes: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_made_by_the_program(ty) => match self.members(ty) {
                Some(members) => self.base_types(target).into_vec().into_iter().map(|base| self.instantiate(base, members.mapper)).collect(),
                None => Vec::new(),
            },
            TypeData::Intersection(ref parts) => parts.to_vec(),
            _ => Vec::new(),
        };
        for supertype in supertypes {
            if !self.says_properties(supertype) || !passed.insert(supertype) {
                continue;
            }
            let laid_out = self.laid_out_as(supertype);
            match index_of.get(&laid_out) {
                Some(&index) => out.push(index),
                None => self.add_declared_supertypes(supertype, index_of, passed, out),
            }
        }
    }

    /// The answers to the questions, in their order. Of the questions of a slice whether a view admits an object that is not laid out, those
    /// after the first yes are not gone into and answered no: one yes is all that counts. `stored`: `Subtypes::stored`.
    pub fn answer(&mut self, questions: &[Question], stored: &FxHashSet<Atom>) -> Vec<Answer> {
        self.go_by_names_stored(stored);
        let mut admitting = None;
        let mut answers = Vec::with_capacity(questions.len());
        for question in questions {
            let not_known_before = self.aot.flows.times_not_known;
            let is_so = match question.kind {
                Kind::Made(made) => self.is_of_type(made, question.view),
                Kind::Assignable(made) => self.is_of_type_as(made, question.view, false) || self.is_narrowed_from(question.view, made),
                _ if admitting == Some(question.view) => false,
                Kind::Given(_) => {
                    let given = self.type_of_kind(question.kind);
                    let is_admitted = self.is_of_type_as(given, question.view, false);
                    if is_admitted {
                        admitting = Some(question.view);
                    }
                    is_admitted
                }
                kind => {
                    let other = self.type_of_kind(kind);
                    let is_admitted = self.is_of_type(other, question.view);
                    if is_admitted {
                        admitting = Some(question.view);
                    }
                    is_admitted
                }
            };
            answers.push(if self.aot.flows.times_not_known != not_known_before {
                Answer::NotKnown
            } else if is_so {
                Answer::Yes
            } else {
                Answer::No
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
            // The reasons lead back to where something was let in. Should they not, the line ends.
            for _ in 0..32 {
                let Some(reason) = why.take() else { break };
                match reason {
                    WhyForeign::Seen { source, at } => {
                        let source = source.map_or_else(|| "a type that nobody has kept".to_owned(), |source| self.name_for_people(source));
                        line += &format!("seen: {source} at {}", self.place_for_people(at));
                    }
                    WhyForeign::Untyped { at, candidate } => {
                        let candidate = self.type_of_kind(candidate.0);
                        line += &format!("untyped: something untyped is held to it at {}, and {} is of the type", self.place_for_people(at), self.name_for_people(candidate));
                    }
                    WhyForeign::Given { at, candidate } => {
                        let candidate = self.type_of_kind(candidate.0);
                        line += &format!("given: a value that only its type vouches for is held to it or to what holds it at {}, and {}, which the program is given, is assignable to it or to what holds it", self.place_for_people(at), self.name_for_people(candidate));
                    }
                    WhyForeign::GivenAndKeptByNobody { at } => line += &format!("given: a value that only its type vouches for is held to it or to what holds it at {}, and a type that the program is given and that no task could keep, such as untyped code makes, has its names", self.place_for_people(at)),
                    WhyForeign::DeclaredOnly => line += "declared in a declaration file",
                    WhyForeign::ForTheLog { at } => line += &format!("for the log: something untyped is held to it at {}, and few views open with it", self.place_for_people(at)),
                    WhyForeign::Instance => line += "a class: the text shows that an object its constructor has not made can come to be: an object of it or a method of it is handed to what is not typed code, or to a built-in that lets it out",
                    WhyForeign::Flat { at } => line += &format!("flat: all its properties are primitives, and something untyped is held to it at {}", self.place_for_people(at)),
                    WhyForeign::TooMany { at } => line += &format!("too many layouts may fit it to ask about each, and a value that only its type vouches for is held to it at {}", self.place_for_people(at)),
                    WhyForeign::NothingIsMadeAsIt { at } => line += &format!("nothing is made as it and no layout fits it, and a value that only its type vouches for is held to it at {}", self.place_for_people(at)),
                    WhyForeign::Weak { at } => line += &format!("weak: it requires no live field, and a value that only its type vouches for is held to it at {}", self.place_for_people(at)),
                    WhyForeign::Inherited { from, at } => {
                        let from_whom = self.name_of_view(views, from);
                        line += &format!("inherited from {from_whom} over an upcast noted at {}; which is ", self.place_for_people(at));
                        why = membership.why_foreign.get(from as usize).copied().flatten();
                    }
                    WhyForeign::PassedCast { from } => {
                        line += &format!("what is in a place of {} passes a cast to it; which is ", self.name_of_view(views, from));
                        why = membership.why_foreign.get(from as usize).copied().flatten();
                    }
                }
            }
            lines.push(line);
        }
        lines
    }

    fn name_of_view(&mut self, views: &[TypeId], view: u32) -> String {
        views.get(view as usize).map_or_else(|| "what is not laid out".to_owned(), |&view| self.name_for_people(view))
    }

    pub(super) fn name_for_people(&mut self, ty: TypeId) -> String {
        const MOST: usize = 72;
        let text = self.type_to_string(ty);
        let text = String::from_utf8_lossy(&text);
        if text.chars().count() <= MOST { text.into_owned() } else { text.chars().take(MOST).chain(" ..".chars()).collect() }
    }

    pub(super) fn place_for_people(&self, at: Place) -> String {
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

