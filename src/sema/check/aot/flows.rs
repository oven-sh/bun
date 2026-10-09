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
use crate::check::Checker;
use crate::check::relate::Relation;
use super::callees::{Callee, Hole};
use super::subtypes::{self, AlteredViews, Cause, Facts, FieldTypes, Gathered, Sizes, Subtypes, ToldApart};
use super::creation::Creations;
use super::alterations::{Alteration, DoorsCounted, NUMBER_OF_OPERANDS, UntypedAlterations, WidestAlterations};
use super::escape_closure::{ByDoor, Certainty, EscapeCause, Escapes};
use super::first_stores::Constructions;
use super::trust::Claim;
use crate::hir::{BinOp, Chain, ClassId, ExprId, ExprKind, FileKind, FnId, MappedModifier, MemberKind, TypeNodeId};
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
    /// `Checker::note_what_stays_untyped`: the view, where the data comes from, the first place.
    data_held_to: FxHashMap<(T, OriginOfData), Place>,
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
    /// Types that no declaration names and whose objects are not laid out: `(() => number) & { unit: string }`, `number[] & { tag: string }`.
    not_laid_out: FxHashSet<T>,
    /// Where a declaration without a body was taken for a prediction: `Checker::unvouched_claim`.
    predictions: FxHashMap<Place, Claim>,
    /// By field, which is a layout and a name: the functions whose closures the allocation sites of the layout store there.
    callees_at_birth: FxHashMap<(T, Atom), Callee>,
    /// The same for the stores through a supertype, which reach the objects of every subtype.
    callees_stored: FxHashMap<(T, Atom), Callee>,
    /// By declaration: the name of a variable that may hold a function and has no `OnlyFunction` that is a fact, and why it has none. `None`: it
    /// has one, and may be nil. For `explain_callees` alone.
    callee_holes: FxHashMap<Place, (Atom, Option<Hole>)>,
    /// Which fields objects get right after their allocation: see `creation.rs`.
    creations: Creations<T>,
    /// The constructor functions: see `first_stores.rs`.
    constructions: Constructions<T>,
    /// What gets to untyped code: see `escape_closure.rs`.
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
            data_held_to: FxHashMap::default(),
            tests: FxHashSet::default(),
            vouched_into: FxHashMap::default(),
            foreign: FxHashMap::default(),
            untyped_into: FxHashMap::default(),
            not_laid_out: FxHashSet::default(),
            predictions: FxHashMap::default(),
            callees_at_birth: FxHashMap::default(),
            callees_stored: FxHashMap::default(),
            callee_holes: FxHashMap::default(),
            creations: Creations::default(),
            constructions: Constructions::default(),
            escapes: Escapes::default(),
        }
    }
}

impl<T: Copy + Eq + Hash> Noted<T> {
    /// Adds what has been noted elsewhere, in terms of the same names for the types.
    pub fn absorb(&mut self, other: Noted<T>) {
        self.allocated_at_site.extend(other.allocated_at_site);
        self.copied_into.extend(other.copied_into);
        self.casts.extend(other.casts);
        self.guards.extend(other.guards);
        self.forced.extend(other.forced);
        for ((view, origin), at) in other.data_held_to {
            self.add_data_held_to(view, origin, at);
        }
        self.tests.extend(other.tests);
        self.not_laid_out.extend(other.not_laid_out);
        self.predictions.extend(other.predictions);
        self.callee_holes.extend(other.callee_holes);
        self.creations.absorb(other.creations);
        self.constructions.absorb(other.constructions);
        self.escapes.absorb(other.escapes);
        for (upcast, at) in other.upcasts {
            self.add_upcast(upcast, at);
        }
        for (view, (source, at)) in other.foreign {
            self.add_foreign(view, source, at);
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

    fn add_data_held_to(&mut self, view: T, origin: OriginOfData, at: Place) {
        let first = self.data_held_to.entry((view, origin)).or_insert(at);
        *first = at.min(*first);
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
        let data_held_to = self.data_held_to.into_iter().filter_map(|((view, origin), at)| Some(((rename(view)?, origin), at))).collect();
        let tests = self.tests.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        let upcasts = self.upcasts.into_iter().filter_map(|((from, to), at)| Some(((rename(from)?, rename(to)?), at))).collect();
        let foreign = self.foreign.into_iter().filter_map(|(view, (source, at))| Some((rename(view)?, (source.and_then(&mut rename), at)))).collect();
        let untyped_into = self.untyped_into.into_iter().filter_map(|(view, at)| Some((rename(view)?, at))).collect();
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
        Noted { allocated_at_site, copied_into, upcasts, casts, guards, forced, data_held_to, tests, vouched_into, foreign, untyped_into, not_laid_out, predictions: self.predictions, callees_at_birth, callees_stored, callee_holes: self.callee_holes, creations, constructions, escapes }
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
    /// Once the program is linked: a bit for every published name, by its number. Set: some code of the program stores a property by it.
    stored: Option<Vec<u64>>,
    /// Cache of `canonical_type`.
    canonical: FxHashMap<TypeId, TypeId>,
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
    /// Nothing but a shape transition does: no allocation site, no copy of plain data.
    pub is_transition_target_only: bool,
    /// Objects that are made as it are of a type that the program freezes or seals objects of.
    pub may_be_frozen: bool,
    /// Or of a type that it replaces the prototype of objects of, by anything but `null`.
    pub may_have_other_prototype: bool,
    /// An object that is not laid out can be in places of this type.
    pub admits_foreign: bool,
    /// The allocated types whose objects can be in places of this type, itself among them if it is allocated. Ascending.
    pub members: Vec<u32>,
    /// What a cast may turn an object into, where it is, that was made as this type. Each is a member of this type. Ascending.
    pub specializations: Vec<u32>,
    /// By name of a field: the one function whose closures the stores that are seen put there, in the objects of every subtype. A
    /// prediction: an untyped store is not seen. In no order that means anything.
    pub callees: Vec<(Atom, FileId, FnId, Certainty)>,
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
    /// For each of them: why untyped code may hold a reference to an object that is in a place of it. See `escape_closure.rs`.
    pub escaped: Vec<Option<EscapeCause>>,
    /// `EscapeClosure::by_door`.
    pub escapes_by_door: Vec<ByDoor>,
    /// By `Alteration`: `Alterations::sites`. And how many allocated layouts are marked by types and type parameters, how many with those that
    /// have escaped, and whether every layout is.
    pub(super) alteration_sites: [[u32; NUMBER_OF_OPERANDS]; 2],
    pub(super) altered_by: [[u32; 3]; 2],
    pub(super) untyped_alterations: UntypedAlterations,
    pub(super) widest_alterations: WidestAlterations,
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
    /// `Noted::data_held_to`, by view. Ascending.
    pub(super) data_held_to: Vec<(u32, OriginOfData, Place)>,
    /// The views that take nothing by their structure, each with the view it is told from, and how. Ascending.
    pub(super) told_apart: Vec<(u32, u32, ToldApart)>,
    /// `Noted::predictions`, in the order of the source.
    pub predictions: Vec<(Place, Claim)>,
    /// `Noted::callee_holes`, in the order of the source.
    pub callee_holes: Vec<(Place, Atom, Option<Hole>)>,
    /// By view and name of a field: what the stores that are seen put there, where that is not closures of one function. In no order.
    pub callees_unresolved: Vec<(u32, Atom, Callee)>,
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
    const ALL: [OriginOfData; 9] = [OriginOfData::Parsed, OriginOfData::Prediction, OriginOfData::JsonModule, OriginOfData::Annotated, OriginOfData::Inferred, OriginOfData::Function, OriginOfData::BuiltIn, OriginOfData::Property, OriginOfData::Awaited];

    pub fn is_known_for_data(self) -> bool {
        self <= OriginOfData::JsonModule
    }

    fn text(self) -> &'static str {
        match self {
            OriginOfData::Parsed => "JSON.parse",
            OriginOfData::Prediction => "a declaration without a body",
            OriginOfData::JsonModule => "a JSON module",
            OriginOfData::Annotated => "a name annotated any or unknown",
            OriginOfData::Inferred => "a name inferred any or unknown",
            OriginOfData::Function => "what a function of the program yields",
            OriginOfData::BuiltIn => "what another built-in yields",
            OriginOfData::Property => "a property declared any or unknown",
            OriginOfData::Awaited => "what is awaited",
        }
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
    /// What is in a place of the view `from` gets into places of this one untested.
    Inherited { from: u32, at: Place },
    /// A declaration file declares the type: it describes host objects to begin with.
    DeclaredOnly,
    /// What is in a place of the view `from` and is not laid out passes a cast to this one.
    PassedCast { from: u32 },
    /// It requires no live field, so nearly everything fits it, and a value that only its type vouches for is held to it. See `subtypes.rs`,
    /// phase B.
    Weak { at: Place },
    /// All its properties are primitives, and something untyped is held to it: nothing has to be made of that.
    Flat { at: Place },
    /// More layouts may fit it than phase B asks about for one target, and a value that only its type vouches for is held to it.
    TooMany { at: Place },
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
                self.canonical_type(ty)
            }
        }
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
            return self.related(sub, sup, relation);
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
            shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY });
        }
        self.sort_by_name(&mut shape);
        shape.index.extend(members.shape().index.iter().cloned());
        (shape.spread_of, shape.spread_rank) = (Some((TypeId::NEVER, union)), u32::MAX - 1);
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
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && matches!(shape.spread_of, Some((TypeId::UNKNOWN, _))))
    }

    /// For a `view_of_anything_as` the type that was cast to, for a `view_of_either` the union. Any other type unchanged.
    fn type_coerced_to(&self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Synth(shape) if shape.spread_rank == u32::MAX => shape.spread_of.map_or(ty, |made_for| made_for.1),
            _ => ty,
        }
    }

    /// Whether the type is a `view_of_anything_as` or a `view_of_either`: nobody has declared it, and no primitive is of it.
    pub fn is_view_made_by_coercion(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.spread_rank == u32::MAX && shape.spread_of.is_some())
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
                shape.props.push(Prop { name: prop.name, flags, source: PropSource::Type(ty), mapper: MapperId::IDENTITY });
            }
        }
        self.sort_by_name(&mut shape);
        (shape.spread_of, shape.spread_rank) = (Some(made_for), u32::MAX);
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
    ///   an object has. An array, a function, an object of a class of the engine is what nothing can be made: those parts stay, and
    ///   whoever emits the cast sees that there is no room for anything else and asserts.
    /// * Not so with `Error` and what extends it, which are types like any other here: `catch (e) { (e as Error).message }` is everywhere,
    ///   and what is thrown may be anything. Where `target` is nothing else, see `lets_everything_through`, a primitive stays what it is too.
    /// * So it is if `target` has no objects: `raw as string` of a `string | Tree` is a string or a `Tree`.
    pub fn type_coerced(&mut self, source: TypeId, target: TypeId) -> TypeId {
        // Where the result is `target`, it is the very type that was given: whoever asks compares the two.
        let given = target;
        let (source, target) = (self.reduced(source), self.reduced(target));
        let is_untyped = self.is_untyped(source);
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
        if is_untyped && !parts.iter().any(|&part| !self.has_primitive_flag(part)) {
            parts.push(TypeId::OBJECT);
        }
        if !is_untyped {
            parts.extend(self.parts(source).iter().copied().filter(|&part| !self.has_primitive_flag(part)));
        }
        // `undefined` and `null` pass: `o.flag as boolean` is how people strip `| undefined`, and they go on to compare with it. Only `!` asserts.
        for nil in [TypeId::UNDEFINED, TypeId::NULL] {
            if (is_untyped || self.parts(source).contains(&nil)) && !parts.contains(&nil) {
                parts.push(nil);
            }
        }
        if is_as_given && views.is_empty() && parts.len() == number_of_target { given } else { self.union(&parts) }
    }

    /// Whether an object of which nothing is known can be made one of the type, which is a part of the target of a cast: it says which properties an object has, and is no array, no function and
    /// no class of the engine.
    pub(super) fn can_be_made_of_anything(&mut self, part: TypeId) -> bool {
        self.says_properties(part) && self.has_properties(part) && self.element_of_array_subtype(part).is_none() && (self.built_in_that_is(part).is_none() || self.extends_error(part))
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
        let object = self.non_nullable(known);
        let is_of_anything = self.parts(object).iter().any(|&part| self.is_view_of_anything(part));
        let found = if is_of_anything { None } else { self.type_of_property(object, name) };
        let target = self.type_of_expr(file, e);
        let may_be_missing = chain != Chain::No || found.is_none_or(|found| self.contains_undefined(found));
        let target = if may_be_missing { self.union(&[target, TypeId::UNDEFINED]) } else { target };
        Some((found.unwrap_or(TypeId::UNKNOWN), target))
    }

    /// An object of which nothing is known is in a place of the view from here on. `source`: the checker's type of it.
    pub fn note_foreign(&mut self, view: TypeId, source: TypeId) {
        let at = self.aot.flows.place;
        self.aot.flows.noted.add_foreign(view, (source != TypeId::UNRESOLVED).then_some(source), at);
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

    /// The value of `e` is a prediction because of a declaration without a body.
    pub fn note_prediction(&mut self, file: FileId, e: ExprId, claim: Claim) {
        let at = Place { file, pos: self.hir(file)[e].pos };
        self.aot.flows.noted.predictions.insert(at, claim);
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

    /// `sym`: a variable in an environment or of a module that may hold a function. For `explain_callees`.
    pub fn note_callee_of_variable(&mut self, sym: Sym) {
        let why = match self.callee_of_variable(sym) {
            Ok(only) if !only.may_be_nil && !only.is_predicted => return,
            Ok(_) => None,
            Err(hole) => Some(hole),
        };
        let Some((file, decl)) = self.files().value_declaration(sym) else { return };
        let hir = self.hir(file);
        let pos = match decl {
            Decl::Var(pat) | Decl::Param(pat) => hir[pat].pos,
            Decl::Fn(func) => hir[func].start,
            _ => return,
        };
        let name = self.files().symbol(sym).name;
        self.aot.flows.noted.callee_holes.insert(Place { file, pos }, (name, why));
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
        if self.is_view_made_by_coercion(source) || self.is_view_made_by_coercion(target) {
            return None;
        }
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
    /// then on take it as it is, if it is known for data. Of any other origin it is only counted.
    pub fn note_what_stays_untyped(&mut self, ty: TypeId, is_in_container: bool, origin: OriginOfData) {
        if ty == TypeId::UNRESOLVED {
            return;
        }
        let (mut seen, mut views) = (FxHashSet::default(), Vec::new());
        self.add_what_stays_untyped(ty, is_in_container, &mut seen, &mut views);
        let at = self.aot.flows.place;
        for view in views {
            self.aot.flows.noted.add_data_held_to(view, origin, at);
            if origin.is_known_for_data() {
                self.note_foreign(view, TypeId::UNRESOLVED);
            }
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
        if !self.may_hold_objects(ty) || !seen.insert((ty, stays)) {
            return;
        }
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
                Some(BuiltIn::Function) => return,
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
            for info in members.shape().index.iter() {
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
            for prop in members.shape().props.iter() {
                let of_field = self.type_of_prop(prop, members.mapper);
                self.add_what_stays_untyped(of_field, stays, seen, out);
            }
        }
    }

    /// `--aot-explain=parsed`. The first lines, one for each origin, are numbers alone.
    pub fn explain_parsed(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let mut lines = Vec::new();
        let mut named = Vec::new();
        for origin in OriginOfData::ALL {
            let of_origin: Vec<(u32, Place)> = membership.data_held_to.iter().filter(|held| held.1 == origin).map(|held| (held.0, held.2)).collect();
            let mut by_place: FxHashMap<Place, u32> = FxHashMap::default();
            for held in &of_origin {
                *by_place.entry(held.1).or_default() += 1;
            }
            let mut by_place: Vec<(Place, u32)> = by_place.into_iter().collect();
            by_place.sort_unstable_by_key(|&(at, number)| (std::cmp::Reverse(number), at));
            let flagged_anyway = of_origin.iter().filter(|held| membership.views[held.0 as usize].admits_foreign).count();
            lines.push(format!(
                "parsed: {}: {}: {} views from {} places, {} of them admit untyped objects as it is; views by place, the first 10: {:?}",
                origin.text(),
                if origin.is_known_for_data() { "FLAGS" } else { "only counted" },
                of_origin.len(),
                by_place.len(),
                flagged_anyway,
                by_place.iter().take(10).map(|place| place.1).collect::<Vec<u32>>(),
            ));
            for &(at, number) in by_place.iter().take(6) {
                let such_as = of_origin.iter().find(|held| held.1 == at).map_or_else(String::new, |held| self.name_for_people(views[held.0 as usize]));
                named.push(format!("parsed: {}: {number} views at {}, such as {such_as}", origin.text(), self.place_for_people(at)));
            }
        }
        lines.append(&mut named);
        lines
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
        self.contextual_type_of_literal(file, e).filter(|&target| !self.says_nothing(target))
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
    /// its arguments the other way, from the type it is taken for to its own, and what it yields. The first time it is asked of the two
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
                // A function that is called as `to` says is handed what that takes, and what it yields is taken for what that yields.
                for constructs in [false, true] {
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
            if of_type.resolved.prop(prop.name).is_none() && !of_every_object.is_some_and(|members| members.resolved.prop(prop.name).is_some()) && !self.is_never_stored(prop.name) {
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
            if module.is_untyped() || (self.only_declares(FileId(file as u32)) && !module.is_lib) {
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
            Kind::Made(ty) | Kind::Assignable(ty) => return ty,
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
        if self.related(made, view, relation) {
            return true;
        }
        // It has the live fields, with the same discriminants: a subtype whatever its reference fields are declared to point to. A read
        // through the narrower type is tested (`Lowering::readField`). At the link only, where the dead fields are known.
        if goes_by_fields && self.aot.flows.stored.is_some() && self.says_properties(made) && self.says_properties(view) && self.has_same_fields(made, view, false) {
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
        self.related(made, view, relation)
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
            if !self.related(made_type, view_type, relation) {
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
        let mut bits: Vec<u64> = Vec::new();
        for name in stored.iter().filter(|name| name.is_some() && !name.is_own()) {
            let at = name.0 as usize;
            if bits.len() <= at / 64 {
                bits.resize(at / 64 + 1, 0);
            }
            bits[at / 64] |= 1 << (at % 64);
        }
        self.aot.flows.stored = Some(bits);
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
    pub fn begin_subtypes(&mut self, noted: Noted, views: &[TypeId], fields: FieldTypes, stored: FxHashSet<Atom>, says_progress: bool) -> Subtypes {
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
        self.go_by_names_stored(&stored);
        let mut index_of: FxHashMap<TypeId, u32> = FxHashMap::default();
        for (index, &view) in views.iter().enumerate() {
            index_of.entry(view).or_insert(index as u32);
        }
        // Plain data is copied into the layout of the type it is cast to, and what it holds into the layouts of the types of the fields.
        // So objects are made as those.
        let copied_into = self.views_held_within(noted.copied_into.iter().map(|&ty| (ty, Place::NOWHERE)), &index_of);
        let untyped_into = self.views_held_within(noted.untyped_into.iter().map(|(&ty, &at)| (ty, at)), &index_of);
        clock.say(format_args!("what is held within: {} copied into, {} untyped into", copied_into.len(), untyped_into.len()));

        let types: Vec<TypeId> = views.to_vec();
        let altered = Alteration::ALL.map(|alteration| noted.escapes.alterations.closed(alteration));
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
        let mut facts: Vec<Facts> = Vec::with_capacity(types.len());
        let mut declared: Vec<(u32, u32)> = Vec::new();
        let (mut passed, mut found): (FxHashSet<TypeId>, Vec<u32>) = Default::default();
        for (index, &ty) in types.iter().enumerate() {
            let mut of_type = self.facts_of(ty, &of_every_object);
            self.add_undeclared_fields_to(&mut of_type, ty, &stored);
            if noted.allocated_at_site.contains(&ty) {
                of_type.flags |= subtypes::HAS_SITE;
            }
            if copied_into.contains_key(&ty) && of_type.flags & subtypes::IS_INSTANCE == 0 {
                of_type.flags |= subtypes::IS_COPIED;
            }
            facts.push(of_type);
            passed.clear();
            found.clear();
            self.add_declared_supertypes(ty, &index_of, &mut passed, &mut found);
            found.sort_unstable();
            found.dedup();
            declared.extend(found.iter().filter(|&&supertype| supertype as usize != index).map(|&supertype| (index as u32, supertype)));
        }
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
        let (others, having) = if untyped_into.is_empty() { Default::default() } else { self.kinds_not_laid_out(&noted.not_laid_out) };
        clock.say(format_args!("{} vouched for, {} kinds that are not laid out", vouched.len(), others.len()));
        let mut candidates: Vec<u32> = Vec::new();
        for (index, &view) in views.iter().enumerate() {
            if let Some(&(source, at)) = noted.foreign.get(&view) {
                // What a coercion lets through is whatever it was, laid out or not. It passes no cast for being that.
                let passing = source.filter(|_| !self.is_view_made_by_coercion(view));
                foreign.push((index as u32, passing, WhyForeign::Seen { source, at }));
            } else if self.is_declared_only_record(view) {
                foreign.push((index as u32, None, WhyForeign::DeclaredOnly));
            } else if let Some(&at) = untyped_into.get(&view) {
                candidates.clear();
                self.add_candidates(&having, view, &mut candidates);
                candidates.sort_unstable();
                candidates.dedup();
                about_kinds.extend(candidates.iter().map(|&candidate| {
                    let kind = others[candidate as usize];
                    (Question { kind, view }, index as u32, WhyForeign::Untyped { at, candidate: Candidate(kind) })
                }));
            }
        }

        let mut upcasts: Vec<(u32, u32, Place)> = noted.upcasts.iter().filter_map(|(&(from, to), &at)| Some((*index_of.get(&from)?, *index_of.get(&to)?, at))).collect();
        upcasts.sort_unstable();
        let mut casts: Vec<(u32, u32)> = noted.casts.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        casts.sort_unstable();
        let mut guards: Vec<(u32, u32)> = noted.guards.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        guards.sort_unstable();
        let mut forced: Vec<(u32, u32)> = noted.forced.iter().filter_map(|(from, to)| Some((*index_of.get(from)?, *index_of.get(to)?))).collect();
        forced.sort_unstable();
        let mut data_held_to: Vec<(u32, OriginOfData, Place)> = noted.data_held_to.iter().filter_map(|(&(ty, origin), &at)| Some((*index_of.get(&ty)?, origin, at))).collect();
        data_held_to.sort_unstable();
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
        held_untyped.sort_unstable();
        let mut predictions: Vec<(Place, Claim)> = noted.predictions.iter().map(|(&at, &claim)| (at, claim)).collect();
        predictions.sort_unstable();
        let by_view = |callees: &FxHashMap<(TypeId, Atom), Callee>| -> Vec<(u32, Atom, Callee)> { callees.iter().filter_map(|(&(holder, name), &callee)| Some((*index_of.get(&holder)?, name, callee))).collect() };
        let (callees_at_birth, callees_stored) = (by_view(&noted.callees_at_birth), by_view(&noted.callees_stored));
        let mut callee_holes: Vec<(Place, Atom, Option<Hole>)> = noted.callee_holes.iter().map(|(&at, &(name, why))| (at, name, why)).collect();
        callee_holes.sort_unstable_by_key(|hole| hole.0);
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
            data_held_to,
            tests,
            vouched,
            held_untyped,
            foreign,
            about_kinds,
            altered,
            fields,
            stored,
            predictions,
            callees_at_birth,
            callees_stored,
            callee_holes,
            escapes: noted.escapes,
            index_of,
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
        let (mut requires_a_property, mut is_flat) = (false, true);
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
        if is_flat && shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && flags & subtypes::IS_INSTANCE == 0 {
            flags |= subtypes::IS_FLAT;
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
    pub fn answer(&mut self, questions: &[Question], stored: &FxHashSet<Atom>) -> Vec<bool> {
        self.go_by_names_stored(stored);
        let mut admitting = None;
        let mut answers = Vec::with_capacity(questions.len());
        for question in questions {
            answers.push(match question.kind {
                Kind::Made(made) => self.is_of_type(made, question.view),
                Kind::Assignable(made) => self.is_of_type_as(made, question.view, false),
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

    fn callee_for_people(&self, callee: Callee) -> String {
        let at = |(file, func): (FileId, FnId)| self.place_for_people(Place { file, pos: self.hir(file)[func].start });
        match callee {
            Callee::Nothing => "no function is stored".to_owned(),
            Callee::One(file, func) => format!("the function at {}", at((file, func))),
            Callee::Several(first, second) => format!("several functions: at {} and at {}", at(first), at(second)),
            Callee::Unknown(place) => format!("a value that is not seen through at {}", self.place_for_people(place)),
        }
    }

    /// The counts. Then a line for each variable in an environment or of a module that may hold a function and whose one function is no fact,
    /// in the order of the source, and one for each field under whose name the stores put something else than closures of one function,
    /// by its text. Each with the hole in the proof.
    pub fn explain_callees(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let mut lines = Vec::new();
        for &(at, name, why) in &membership.callee_holes {
            let why = match why {
                None => "one function, but a read may find undefined or null".to_owned(),
                Some(Hole::Declaration) => "no variable that one declaration of a module gives a name of its own".to_owned(),
                Some(Hole::Store(by)) => format!("stored to otherwise than as `name = value` at {}", self.place_for_people(by)),
                Some(Hole::Stored(callee)) => self.callee_for_people(callee),
                Some(Hole::Cycle) => "stored to itself by way of another variable".to_owned(),
            };
            lines.push(format!("callees: variable {} at {}: {why}", String::from_utf8_lossy(self.atoms().bytes(name)), self.place_for_people(at)));
        }
        let mut of_fields = Vec::new();
        for &(view, name, callee) in &membership.callees_unresolved {
            let holder = self.name_for_people(views[view as usize]);
            of_fields.push(format!("callees: field {holder}.{}: {}", String::from_utf8_lossy(self.atoms().bytes(name)), self.callee_for_people(callee)));
        }
        of_fields.sort_unstable();
        let resolved: usize = membership.views.iter().map(|reach| reach.callees.len()).sum();
        let counts = format!("callees: {} variables that may hold a function without a fact; fields by supertype: {resolved} with one function (a prediction: an untyped store is not seen), {} without", lines.len(), of_fields.len());
        lines.insert(0, counts);
        lines.append(&mut of_fields);
        lines
    }

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
                    WhyForeign::DeclaredOnly => line += "declared in a declaration file",
                    WhyForeign::Flat { at } => line += &format!("flat: all its properties are primitives, and something untyped is held to it at {}", self.place_for_people(at)),
                    WhyForeign::TooMany { at } => line += &format!("too many layouts may fit it to ask about each, and a value that only its type vouches for is held to it at {}", self.place_for_people(at)),
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

    /// First a line for each layout that fits the target of a vouched cast and that no flow brings there (`subtypes.rs`, phase B). Then a line
    /// for each of `views` that has a subtype besides itself, in their order: how many, by what they have come over, and the way of one
    /// of them back to where it is made.
    pub fn explain_members(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let mut lines = Vec::new();
        let of_views = || membership.subtypes.iter().zip(&membership.causes).take(views.len()).enumerate();
        for (view, (_, causes)) in of_views() {
            // By supertype that fits: how many subtypes it has brought.
            let mut fitting: Vec<u32> = causes.iter().filter_map(|cause| if let Cause::Fit(fitting) = cause { Some(*fitting) } else { None }).collect();
            fitting.sort_unstable();
            for brought in fitting.chunk_by(|a, b| a == b) {
                let at = membership.vouched.binary_search_by_key(&(view as u32), |target| target.0).map_or(Place::NOWHERE, |found| membership.vouched[found].1);
                lines.push(format!("members: fits, but no flow: {} with {} subtypes into {}, which is vouched for at {}", self.name_of_view(views, brought[0]), brought.len(), self.name_for_people(views[view]), self.place_for_people(at)));
            }
        }
        for &(view, from, how) in &membership.told_apart {
            let how = match how {
                ToldApart::Tested => "a type guard or a test leads there",
                ToldApart::Beside => "they are parts of one union that plain data may be held to",
                ToldApart::Upcast => "it is upcast to that, which is told apart itself",
            };
            lines.push(format!("members: told apart: {} from {}: {how}", self.name_of_view(views, view), self.name_of_view(views, from)));
        }
        for (view, (subtypes, causes)) in of_views() {
            let laid_out = subtypes.partition_point(|&subtype| (subtype as usize) < membership.subtypes.len());
            if laid_out == 0 || subtypes[..laid_out] == [view as u32] {
                continue;
            }
            let number_of = |is_meant: fn(&Cause) -> bool| causes[..laid_out].iter().filter(|cause| is_meant(cause)).count();
            let mut line = format!("members: {}: {laid_out} subtypes", self.name_for_people(views[view]));
            let kinds: [(&str, fn(&Cause) -> bool); 6] = [
                ("declared", |cause| matches!(cause, Cause::Declared(_))),
                ("over upcasts", |cause| matches!(cause, Cause::Upcast(_))),
                ("through casts", |cause| matches!(cause, Cause::Cast(_))),
                ("admitted as they are", |cause| matches!(cause, Cause::Admitted(_))),
                ("that a subtype becomes", |cause| matches!(cause, Cause::Became(_))),
                ("that fit without a flow", |cause| matches!(cause, Cause::Fit(_))),
            ];
            for (text, is_meant) in kinds {
                let number = number_of(is_meant);
                if number != 0 {
                    line += &format!("; {number} {text}");
                }
            }
            let is_telling = |cause: &Cause| !matches!(cause, Cause::Birth | Cause::Transition(_) | Cause::Declared(_));
            if let Some(at) = causes[..laid_out].iter().position(is_telling) {
                line += &format!("; such as {}{}", self.name_of_view(views, subtypes[at]), self.way_of_subtype(views, membership, view as u32, subtypes[at]));
            }
            lines.push(line);
        }
        lines
    }

    fn name_of_view(&mut self, views: &[TypeId], view: u32) -> String {
        views.get(view as usize).map_or_else(|| "what is not laid out".to_owned(), |&view| self.name_for_people(view))
    }

    /// How the layout has come to be a subtype of the view, back to where it is made.
    fn way_of_subtype(&mut self, views: &[TypeId], membership: &Membership, mut view: u32, mut subtype: u32) -> String {
        let mut way = String::new();
        for _ in 0..12 {
            let Ok(at) = membership.subtypes[view as usize].binary_search(&subtype) else { break };
            match membership.causes[view as usize][at] {
                Cause::Birth => return way + ", where it is allocated",
                Cause::Fit(fitting) if fitting == subtype || fitting == view => return way + ", which it fits, but no flow brings it there",
                Cause::Fit(fitting) => {
                    way += &format!(", which {} fits, but no flow brings it there", self.name_of_view(views, fitting));
                    view = fitting;
                }
                Cause::Transition(from) => return format!("{way}, which a cast makes of {}", self.name_of_view(views, from)),
                Cause::Declared(from) => {
                    way += &format!(", declared by {}", self.name_of_view(views, from));
                    view = from;
                }
                Cause::Upcast(number) => {
                    let (from, _, noted_at) = membership.upcasts[number as usize];
                    way += &format!(", over an upcast noted at {} from {}", self.place_for_people(noted_at), self.name_of_view(views, from));
                    view = from;
                }
                Cause::Cast(from) | Cause::Admitted(from) if from == view => break,
                Cause::Cast(from) => {
                    way += &format!(", through a cast from {}", self.name_of_view(views, from));
                    view = from;
                }
                Cause::Admitted(from) => {
                    way += &format!(", admitted as it is at a cast from {}", self.name_of_view(views, from));
                    view = from;
                }
                Cause::Became(layout) => {
                    way += &format!(", because {} becomes it", self.name_of_view(views, layout));
                    subtype = layout;
                }
            }
        }
        way
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

