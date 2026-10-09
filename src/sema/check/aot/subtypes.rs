//! The soundness closure: which layouts are subtypes of which supertypes.
//!
//! **Subtypes by flow, not by fit.** `S(V)`, the layouts whose objects can be in a place of type `V`, is the least fixed point over the
//! flows of the program. A flow is an edge between two layouts:
//!
//! * ALLOCATION: `L` is in `S(L)` if a site makes it or plain data is copied into it.
//! * DECLARED: `L` goes to every supertype it declares, `extends` or a part of an intersection. Untested.
//! * UPCAST `a -> b`: a test has been left out (`Checker::note_upcast`). `S(b)` takes all of `S(a)`.
//! * CAST `a -> b`: `as`, a place whose type is written down, a type guard (`Checker::note_cast`). `S(b)` takes those of `S(a)` that pass, the
//!   cast may turn an object into a `b` where it is, and it admits what cannot become one: `Subtypes::verdict`.
//! * TEST `a -> b`: every other `Coerce` operation, which only makes sure. `S(b)` takes those of `S(a)` that fit, and nothing else comes of it.
//! * FIELDS: `L` in `S(V)` makes tests between the layouts of the type of `L.f` and those of `V.f`, where the two differ: a read through the
//!   one finds what has been stored through the other, and is tested. Only what is not laid out goes over them: the type of a field is
//!   vouched for (phase B), which brings every layout that fits. One general type of a field, `props: P`, would bring every layout of
//!   the program to a test against every other type of that field.
//!
//! A supertype that ADMITS UNTYPED OBJECTS takes any object, as far as the engine goes: its accesses test the shape, and its set is a list
//! of the shapes worth testing for. So nothing is asked at a test into it. What is in a place of it is not known, then: the target of
//! a cast or a test out of it is vouched for.
//!
//! Only at a cast is the relation asked, about a pair that a flow has brought together, and only once the names and the constants of the
//! two have been compared. So the cost follows the flows and the sizes of the sets. Nothing is a matrix, and no question is asked about
//! all pairs.
//!
//! What a cast makes of a layout `L` that gets to it is a function of `L` and the target `b` alone (`Subtypes::verdict`), so the system is
//! monotone: what comes of it does not depend on the order of the steps or on who answers.
//!
//! It goes in ROUNDS. A round propagates what is new over the untested edges, collects the pairs that have come together at casts, and
//! hands them out as questions, which any number of checkers answer. The answers start the next round.
//!
//! **Phase A** is that. **Phase B is a safety net.** A value that the operations say nothing of and the checker has a type for, an element, what
//! an indirect or a generic call yields, is VOUCHED for by that type. Whether every flow into such a place has been noted does not
//! show before the program runs: function types, instantiated type parameters and containers carry flows within them. So the
//! target of a vouched cast is completed by fit, from posting lists by name and by constant, never from all pairs. Every yes is a
//! layout that FITS, BUT NO FLOW brings it: counted, and listed by `Checker::explain_members`. Here to fit is to be assignable as the language
//! has it, which an honest flow is. That reference fields do not count (`Checker::has_same_fields`) is for a cast that meets a canonical
//! layout, which phase A sees, and would make every two layouts with the same field names subtypes of each other. A target that requires no live field has no
//! posting list to go by, and nearly everything fits it: it admits untyped objects instead, which costs its accesses a test of the
//! shape. So does one that more than `MOST_CANDIDATES` layouts may fit by their names and constants: `{ color: string }` where a thousand
//! literals `{ color: "red" }` are each a layout of their own, `{ id: string }` in a program with ten thousand layouts that have an `id`, times
//! eighty thousand targets. A SUPERTYPE THAT FITS BRINGS ITS WHOLE SET: if `Node` is assignable to the target, whatever is in a place of type `Node`
//! may get there. So a yes is an untested edge, and a target with too many candidates first asks about the supertypes with the largest
//! sets: one question in place of six hundred. When the list is empty or understood, phase B goes.
//!
//! **A budget.** The tables grow with the flows, and a program may have flows that make them grow beyond all use: `Subtypes::is_over_budget`.
//! Then nothing is followed any further, the link fails, and `Subtypes::report` says on stderr what has grown, in numbers alone.

use super::callees::{Callee, Hole};
use super::creation::CreationsByView;
use super::escape_closure::{Certainty, ClosureInput, Doubt, EscapeClosure, Escapes, ForClosure, place_not_seen_through};
use super::first_stores::ConstructionsByView;
use super::flows::{Membership, OriginOfData, Place, Question, Reach, WhyForeign};
use super::trust::Claim;
use crate::atom::Atom;
use crate::types::TypeId;
use crate::util::{FxHashMap, FxHashSet};
use std::collections::VecDeque;
use std::time::Instant;

/// An allocation site makes it.
pub(super) const HAS_SITE: u16 = 1;
/// Plain data is copied into it.
pub(super) const IS_COPIED: u16 = 1 << 1;
/// Some field of it is a set of constants.
pub(super) const HAS_CONSTANTS: u16 = 1 << 2;
/// Some field of it is one constant: a discriminant that says which layout an object has.
pub(super) const IS_CONCRETE: u16 = 1 << 3;
/// The type of the objects of a class: nothing becomes one but by its constructor.
pub(super) const IS_INSTANCE: u16 = 1 << 4;
/// It has type parameters: generic code makes it or looks at objects as it.
pub(super) const IS_GENERIC: u16 = 1 << 5;
/// A coercion made it: its names say nothing of what is of it.
pub(super) const IS_MADE_BY_COERCION: u16 = 1 << 6;
/// As the relation has it: all its properties are optional, dead ones too, and it has no index signature. It takes what shares a name.
pub(super) const IS_WEAK: u16 = 1 << 7;
pub(super) const HAS_INDEX_SIGNATURE: u16 = 1 << 8;
/// A layout that declares it as a supertype `IS_CONCRETE`.
const HAS_CONCRETE_SUBTYPE: u16 = 1 << 9;
/// All its properties are primitives, stored by the program or not: no read through it reaches another object.
pub(super) const IS_FLAT: u16 = 1 << 10;
/// The program tells it from a layout that an object has to be made as: `Subtypes::tell_apart`. It admits nothing for being flat or for
/// requiring nothing.
const IS_TOLD_APART: u16 = 1 << 11;

/// Phase B asks about no more layouts than this for one target. Of a target that the program tells apart from others, or the type of the objects
/// of a class, which cannot take any object instead: than that.
const MOST_CANDIDATES: usize = 64;
const MOST_CANDIDATES_OF_WHAT_IS_MADE: usize = 4096;
/// A supertype with as many subtypes is asked about first where there are too many candidates.
const LARGE: usize = 8;
/// What fits brings a target no more subtypes than this in all. `Element<any>` fits every `Element<P>`, and brings all the others to each.
const MOST_SUBTYPES_BY_FIT: usize = 1024;

const MOST_MEMBERSHIPS: usize = 50_000_000;
const MOST_PAIRS_MET: usize = 500_000_000;
const MOST_PAIRS_WAITING: usize = 100_000_000;
const MOST_QUESTIONS: usize = 30_000_000;
const MOST_TESTS: usize = 20_000_000;

/// What is compared before the relation is asked. Names are the numbers of atoms. Every list is ascending.
#[derive(Default)]
pub(super) struct Facts {
    pub flags: u16,
    /// The names of all its properties.
    pub declared: Box<[u32]>,
    /// Of those: what some code of the program stores.
    pub live: Box<[u32]>,
    /// Of those: what an object cannot be without, and not every object has.
    pub required: Box<[u32]>,
    /// By name of a property whose type is nothing but constants and nil: the constants.
    pub constants: Box<[(u32, u64)]>,
    /// The names of the properties whose type may stand for a constant: `any`, `never`, a type parameter.
    pub open: Box<[u32]>,
    /// What kind of type it is, in a word that says nothing of the program: for `Subtypes::report`.
    pub kind: &'static str,
}

impl Facts {
    /// Whether it takes any object for what it is by itself: see `IS_FLAT`, and phase B on a target that requires no live field.
    pub(super) fn admits_by_structure(&self) -> bool {
        self.flags & (IS_TOLD_APART | IS_INSTANCE) == 0 && (self.flags & IS_FLAT != 0 || self.required.is_empty())
    }
}

/// `--aot-explain=progress`: says on stderr where the closure is. The link of a large program is silent for minutes otherwise.
pub(super) struct Clock {
    is_loud: bool,
    started: Instant,
    last: Instant,
}

impl Clock {
    pub(super) fn new(is_loud: bool) -> Clock {
        Clock { is_loud, started: Instant::now(), last: Instant::now() }
    }

    pub(super) fn say(&mut self, what: std::fmt::Arguments<'_>) {
        if self.is_loud {
            eprintln!("aot: progress: {:.1} s, {:.1} s since the last line: {what}", self.started.elapsed().as_secs_f64(), self.last.elapsed().as_secs_f64());
        }
        self.last = Instant::now();
    }
}

/// How the translated program describes the fields of the views: what the engine compares where a field is read.
pub struct FieldTypes {
    /// By view: the name and the type of each live field, both as numbers of the program, ascending by name.
    pub of_views: Vec<Vec<(u32, u32)>>,
    /// The types of the static fields of classes.
    pub of_static_fields: Vec<u32>,
    /// By type: the views in it, at any depth. Ascending.
    pub views_in: Vec<Vec<u32>>,
    /// The views that are the parts of one union, for every union of several. Each ascending.
    pub together: Vec<Vec<u32>>,
    /// By type: the numbers in `together` of the unions in it, at any depth. Ascending.
    pub unions_in: Vec<Vec<u32>>,
    /// The types that a cast leads to that makes a copy of plain data. Ascending.
    pub copied_to: Vec<u32>,
}

/// How a supertype is told from a layout that has to be made: `Subtypes::tell_apart`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ToldApart {
    /// A type guard or a test leads from the one to the other.
    Tested,
    /// They are parts of one union that plain data may be held to.
    Beside,
    /// The one is upcast to the other, which is told apart itself.
    Upcast,
}

/// Why a layout is a subtype of a supertype: the first reason that was come by. The order of the steps is fixed, so it is always the same.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Cause {
    /// An allocation site, or a copy of plain data. For what is not laid out: it is let in here.
    Birth,
    /// A shape transition from the layout makes it.
    Transition(u32),
    /// The subtype of the view, which declares this one as a supertype.
    Declared(u32),
    /// Over the upcast of that number.
    Upcast(u32),
    /// It passes a cast from the view.
    Cast(u32),
    /// A cast from the view admits it as it is: the target is abstract, or a sibling that it cannot become.
    Admitted(u32),
    /// The supertype holds the layout, which becomes this one and stays where it is.
    Became(u32),
    /// Phase B: the view fits, this layout or a supertype of it, but no flow brings what is in a place of it.
    Fit(u32),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Verdict {
    /// The answer is on its way: the number of the pair.
    Asked(u32),
    Refused,
    Passes,
    Admitted,
    /// `fits`: it is of the type as it is, too, so it passes a test.
    Becomes { fits: bool },
}

/// A layout and a cast target that have come together, and the questions about them.
struct Pair {
    member: u32,
    target: u32,
    /// The view that the cast is from. `NONE`: phase B.
    from: u32,
    /// It is a cast, and no mere test.
    may_change: bool,
    /// Where the answer is to whether the member is of the type of the target, and to the converse. The top bit: among `own_questions`.
    fits: u32,
    is_fitted: u32,
}

const NONE: u32 = u32::MAX;
/// In place of the number of an answer: it is known to be yes.
const YES: u32 = u32::MAX - 1;
/// In place of the number of an upcast: phase B has found that the one fits the other.
const FITS: u32 = u32::MAX - 1;
const OWN: u32 = 1 << 31;

/// Phase B: the layouts that are allocated or may yet be, by what the target of a vouched cast is compared by. Each list ascending.
struct Candidates {
    by_name: FxHashMap<u32, Vec<u32>>,
    by_open: FxHashMap<u32, Vec<u32>>,
    by_constant: FxHashMap<(u32, u64), Vec<u32>>,
    without_names: Vec<u32>,
    /// The views with at least `LARGE` subtypes that admit no untyped objects, allocated or not, by name.
    large_by_name: FxHashMap<u32, Vec<u32>>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Phase {
    Flows,
    Completion,
}

/// The sizes, for whoever wants to know what the link costs.
#[derive(Default)]
pub struct Sizes {
    pub views: usize,
    pub allocated: usize,
    pub declared_edges: usize,
    pub upcasts: usize,
    pub casts: usize,
    pub tests: usize,
    pub field_tests: usize,
    pub rounds: usize,
    pub pairs_met: usize,
    pub pairs_asked: usize,
    pub questions: usize,
    pub memberships: usize,
    pub largest: usize,
    pub fitting_without_flow: usize,
    pub with_too_many_candidates: usize,
    pub admitting_untyped: usize,
    pub transitions: usize,
    pub bytes: usize,
}

impl Sizes {
    pub fn line(&self) -> String {
        format!(
            "{} views, {} allocated; edges: {} declared, {} upcasts, {} casts, {} tests, {} tests between field types; {} rounds, {} pairs met, {} asked about in {} questions; {} memberships, the largest set {}, {} listed transitions; {} fit without a flow; {} vouched targets have too many candidates; {} supertypes admit untyped objects; {} KB",
            self.views,
            self.allocated,
            self.declared_edges,
            self.upcasts,
            self.casts,
            self.tests,
            self.field_tests,
            self.rounds,
            self.pairs_met,
            self.pairs_asked,
            self.questions,
            self.memberships,
            self.largest,
            self.transitions,
            self.fitting_without_flow,
            self.with_too_many_candidates,
            self.admitting_untyped,
            self.bytes / 1024
        )
    }
}

/// What `Checker::begin_subtypes` has gathered.
pub(super) struct Gathered {
    /// The views.
    pub types: Vec<TypeId>,
    /// For each: what the relation is asked about where it is the supertype. See `Checker::type_coerced_to`.
    pub asked_as: Vec<TypeId>,
    pub facts: Vec<Facts>,
    /// From a view to a supertype it declares.
    pub declared: Vec<(u32, u32)>,
    pub upcasts: Vec<(u32, u32, Place)>,
    pub casts: Vec<(u32, u32)>,
    /// Those of `casts` that are type guards. Ascending.
    pub guards: Vec<(u32, u32)>,
    /// Those of `casts` that refuse nothing: `Checker::note_forced_cast`. Ascending.
    pub forced: Vec<(u32, u32)>,
    /// For `Checker::explain_parsed` alone.
    pub data_held_to: Vec<(u32, OriginOfData, Place)>,
    pub tests: Vec<(u32, u32)>,
    /// The targets of vouched casts and of casts of what is untyped, each with the first place. Ascending.
    pub vouched: Vec<(u32, Place)>,
    /// The views that the value of an expression is held to whose type says nothing, themselves and not what they hold. Ascending.
    pub held_untyped: Vec<(u32, Place)>,
    /// What is not laid out and let in: the view, the type of the object if that is known, and why.
    pub foreign: Vec<(u32, Option<TypeId>, WhyForeign)>,
    /// Whether a kind of objects that are not laid out is of the type of a view that something untyped is held to. By view.
    pub about_kinds: Vec<(Question, u32, WhyForeign)>,
    /// By `Alteration`.
    pub(super) altered: [AlteredViews; 2],
    pub fields: FieldTypes,
    pub stored: FxHashSet<Atom>,
    pub predictions: Vec<(Place, Claim)>,
    pub callees_at_birth: Vec<(u32, Atom, Callee)>,
    pub callees_stored: Vec<(u32, Atom, Callee)>,
    pub callee_holes: Vec<(Place, Atom, Option<Hole>)>,
    pub creations: CreationsByView,
    pub constructions: ConstructionsByView,
    pub escapes: Escapes,
    /// Of the views.
    pub index_of: FxHashMap<TypeId, u32>,
}

/// The objects that a built-in may freeze, or give another prototype: see `alterations.rs`.
pub(super) struct AlteredViews {
    /// The views whose subtypes may be: they are handed to the built-in, or get to a type that is and is no view.
    pub(super) views: Vec<u32>,
    /// What is handed to it and is no view.
    pub(super) besides: Vec<Facts>,
    /// And every layout that has escaped.
    pub(super) is_untyped: bool,
    /// And every layout.
    pub(super) is_anything: bool,
}

/// The state between two rounds.
pub struct Subtypes {
    gathered: Gathered,
    /// The number of views. A number from here on stands for what is not laid out: this one for whatever stays where upcasts take it,
    /// the next ones for the types in `seen`, which also pass the casts that they fit.
    nodes: u32,
    seen: Vec<TypeId>,
    /// By supertype: its subtypes, ascending, and why each is one.
    sets: Vec<Vec<u32>>,
    causes: Vec<Vec<Cause>>,
    /// By subtype: the supertypes that hold it, in the order they came to.
    holders: Vec<Vec<u32>>,
    /// By layout: what a cast turns it into. Ascending.
    becomes: Vec<Vec<u32>>,
    /// By view: the untested edges out of it, each with its cause but for the number of the view.
    untested: Vec<Vec<(u32, u32)>>,
    /// By view: the targets of the casts and the tests from it, and whether it is a cast.
    tested: Vec<Vec<(u32, bool)>>,
    is_tested: FxHashSet<(u32, u32)>,
    /// By view: how many of `tested` have been noted. The rest are tests between field types.
    noted_tests: Vec<u32>,
    /// By target: the layouts that it refuses, ascending, and those that have come since that list was last put in order.
    refused: Vec<Vec<u32>>,
    newly_refused: Vec<Vec<u32>>,
    /// By view: the declared supertypes that an allocation site makes or plain data is copied into, at any distance. Ascending.
    bases: Vec<Option<Box<[u32]>>>,
    /// What a cast makes of a layout, but for those that the target refuses.
    verdicts: FxHashMap<(u32, u32), Verdict>,
    /// By view: what has come to it since it was last propagated.
    fresh: Vec<Vec<u32>>,
    queue: VecDeque<u32>,
    is_queued: Vec<bool>,
    /// What has met at a cast and what is newly a subtype, while the untested edges are followed.
    met: Vec<(u32, u32, u32, bool)>,
    joined: Vec<(u32, u32)>,
    compared: FxHashSet<(u32, u32)>,
    candidates: Option<Box<Candidates>>,
    /// Phase B: by target with too many candidates, the supertypes that it has asked about first. Ascending.
    asked_first: FxHashMap<u32, Vec<u32>>,
    /// By view: it is vouched for. Those that phase B has yet to complete. The views that have come to admit untyped objects since it
    /// last looked.
    is_vouched: Vec<bool>,
    to_complete: Vec<(u32, Place)>,
    newly_admitting: Vec<u32>,
    /// `Membership::told_apart`.
    told_apart: Vec<(u32, u32, ToldApart)>,
    /// By view: something that is not laid out is in its set.
    is_admitting: Vec<bool>,
    /// By view: `give_up_completing`.
    is_given_up: Vec<bool>,
    why_let_in: FxHashMap<(u32, u32), WhyForeign>,
    pairs: Vec<Pair>,
    questions: Vec<Question>,
    own_questions: Vec<Question>,
    phase: Phase,
    sizes: Sizes,
    clock: Clock,
    /// Since the budget and the time were last looked at.
    steps: usize,
    /// How many entries `sets`, `refused` and `becomes` have.
    memberships: usize,
    refusals: usize,
    transitions: usize,
    /// The table that has passed its budget.
    over_budget: Option<&'static str>,
}

fn is_subset(of: &[u32], within: &[u32]) -> bool {
    of.len() <= within.len() && of.iter().all(|name| within.binary_search(name).is_ok())
}

fn shares_one(a: &[u32], b: &[u32]) -> bool {
    let (fewer, more) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    fewer.iter().any(|name| more.binary_search(name).is_ok())
}

/// The entries of the name.
fn constants_of(constants: &[(u32, u64)], name: u32) -> &[(u32, u64)] {
    let from = constants.partition_point(|entry| entry.0 < name);
    let len = constants[from..].partition_point(|entry| entry.0 == name);
    &constants[from..from + len]
}

/// Whether the relation has to be asked if what is made as the one is of the type of the other. If not, it is not.
fn may_fit(made: &Facts, view: &Facts) -> bool {
    if view.flags & IS_MADE_BY_COERCION != 0 {
        return true;
    }
    if !is_subset(&view.required, &made.declared) || (view.flags & IS_WEAK != 0 && !made.declared.is_empty() && !shares_one(&view.declared, &made.declared)) {
        return false;
    }
    view.constants.chunk_by(|a, b| a.0 == b.0).all(|taken| {
        let name = taken[0].0;
        if made.declared.binary_search(&name).is_err() {
            return true;
        }
        let own = constants_of(&made.constants, name);
        if own.is_empty() { made.open.binary_search(&name).is_ok() } else { own.iter().all(|constant| taken.binary_search(constant).is_ok()) }
    })
}

impl Subtypes {
    pub(super) fn new(gathered: Gathered, clock: Clock) -> Subtypes {
        let nodes = gathered.types.len();
        let mut seen: Vec<TypeId> = gathered.foreign.iter().filter_map(|let_in| let_in.1).collect();
        seen.sort_unstable_by_key(|ty| ty.0);
        seen.dedup();
        let all = nodes + 1 + seen.len();
        let mut subtypes = Subtypes {
            nodes: nodes as u32,
            seen,
            sets: vec![Vec::new(); nodes],
            causes: vec![Vec::new(); nodes],
            holders: vec![Vec::new(); all],
            becomes: vec![Vec::new(); nodes],
            untested: vec![Vec::new(); nodes],
            tested: vec![Vec::new(); nodes],
            is_tested: FxHashSet::default(),
            noted_tests: vec![0; nodes],
            refused: vec![Vec::new(); nodes],
            newly_refused: vec![Vec::new(); nodes],
            bases: (0..nodes).map(|_| None).collect(),
            verdicts: FxHashMap::default(),
            fresh: vec![Vec::new(); nodes],
            queue: VecDeque::new(),
            is_queued: vec![false; nodes],
            met: Vec::new(),
            joined: Vec::new(),
            compared: FxHashSet::default(),
            candidates: None,
            asked_first: FxHashMap::default(),
            is_vouched: vec![false; nodes],
            to_complete: Vec::new(),
            newly_admitting: Vec::new(),
            told_apart: Vec::new(),
            is_admitting: vec![false; nodes],
            is_given_up: vec![false; nodes],
            why_let_in: FxHashMap::default(),
            pairs: Vec::new(),
            questions: Vec::new(),
            own_questions: Vec::new(),
            phase: Phase::Flows,
            sizes: Sizes::default(),
            clock,
            steps: 0,
            memberships: 0,
            refusals: 0,
            transitions: 0,
            over_budget: None,
            gathered,
        };
        subtypes.begin();
        subtypes
    }

    fn begin(&mut self) {
        self.sizes.views = self.gathered.types.len();
        self.sizes.declared_edges = self.gathered.declared.len();
        self.sizes.upcasts = self.gathered.upcasts.len();
        self.sizes.casts = self.gathered.casts.len();
        self.sizes.tests = self.gathered.tests.len();
        for &(from, to) in &self.gathered.declared {
            self.untested[from as usize].push((to, NONE));
        }
        for (number, &(from, to, _)) in self.gathered.upcasts.iter().enumerate() {
            self.untested[from as usize].push((to, number as u32));
        }
        for (edges, may_change) in [(&self.gathered.casts, true), (&self.gathered.tests, false)] {
            for &(from, to) in edges {
                if self.is_tested.insert((from, to)) {
                    self.tested[from as usize].push((to, may_change));
                    self.noted_tests[from as usize] += 1;
                }
            }
        }
        // ABSTRACT: no field of the layout is one constant, and a layout that declares it as a supertype has such a field. `Declaration`,
        // `TypeNode`, where a `PropertyAccessExpression` has `kind: SyntaxKind.PropertyAccessExpression`.
        let mut pending: Vec<u32> = (0..self.nodes).filter(|&view| self.gathered.facts[view as usize].flags & IS_CONCRETE != 0).collect();
        while let Some(view) = pending.pop() {
            for at in 0..self.untested[view as usize].len() {
                let (supertype, number) = self.untested[view as usize][at];
                let flags = &mut self.gathered.facts[supertype as usize].flags;
                if number == NONE && *flags & HAS_CONCRETE_SUBTYPE == 0 {
                    *flags |= HAS_CONCRETE_SUBTYPE;
                    pending.push(supertype);
                }
            }
        }
        self.tell_apart();
        for view in 0..self.nodes {
            if self.gathered.facts[view as usize].flags & (HAS_SITE | IS_COPIED) != 0 {
                self.insert(view, view, Cause::Birth);
            }
        }
        for at in 0..self.gathered.foreign.len() {
            let (view, source, why) = self.gathered.foreign[at];
            let stranger = match source {
                Some(source) => self.nodes + 1 + self.seen.binary_search_by_key(&source.0, |ty| ty.0).unwrap_or(0) as u32,
                None => self.nodes,
            };
            self.let_in(view, stranger, why);
        }
        for at in 0..self.gathered.vouched.len() {
            let (target, place) = self.gathered.vouched[at];
            self.let_in_by_structure(target, place);
        }
        // Nothing has to be made of an object for a type all of whose properties are primitives, and no read through it reaches another object.
        // So what is untyped is not copied into it. Where only its type vouches for a value, that is held to it as to any other:
        // what untyped code stores to a field `o: { v: number }` is refused there, and not where `o.v` is read.
        for at in 0..self.gathered.held_untyped.len() {
            let (view, place) = self.gathered.held_untyped[at];
            if self.flags(view) & (IS_FLAT | IS_MADE_BY_COERCION) == IS_FLAT {
                self.let_in(view, self.nodes, WhyForeign::Flat { at: place });
            }
        }
        self.questions.extend(self.gathered.about_kinds.iter().map(|about| about.0));
        self.settle();
    }

    /// A plain object that a supertype takes as it is, for being flat or for requiring nothing (`Facts::admits_by_structure`), stays plain. Where the
    /// program goes on to find out that it is a `Pair`, by a discriminant, and a `Pair` has to be made, the test fails: nothing has made
    /// one of it. So a supertype takes nothing by its structure
    /// * if a type guard or a test leads out of it to a layout that has to be made: `as` makes a copy of plain data, so `links as MappedSymbolLinks` is
    ///   no such thing,
    /// * if it is a part of a union beside such a layout, where the engine takes any object for the union if it does for a part, and plain data
    ///   may be held to that union: it is in the target of a cast that makes a copy of plain data, or in the type of a field of a layout
    ///   that plain data is copied into. `[symbolLinks, type] as const`, whose elements are a `SymbolLinks | Type`, is only ever read,
    /// * if it is upcast to a supertype that for one of these reasons takes nothing by its structure, which would inherit what it takes:
    ///   `Leaf`, flat, and what `Leaf | Pair | ..` have in common, `{ tag }`, flat as well.
    /// Plain data is copied into it as into any layout, and what fits it is found by its names. The type of the objects of a class is none of the
    /// layouts meant: a plain object never narrows to it, and a cast to it refuses the object whether or not something was made of it before.
    fn tell_apart(&mut self) {
        let nodes = self.nodes as usize;
        let (mut upcast_from, mut cast_from, mut beside): (Vec<Vec<u32>>, Vec<Vec<u32>>, Vec<Vec<u32>>) = (vec![Vec::new(); nodes], vec![Vec::new(); nodes], vec![Vec::new(); nodes]);
        for from in 0..nodes {
            for &(to, _) in &self.untested[from] {
                upcast_from[to as usize].push(from as u32);
            }
            for &(to, may_change) in &self.tested[from] {
                if !may_change || self.gathered.guards.binary_search(&(from as u32, to)).is_ok() {
                    cast_from[to as usize].push(from as u32);
                }
            }
        }
        let fields = &self.gathered.fields;
        let of_what_is_copied_into = (self.gathered.facts.iter().zip(&fields.of_views)).filter(|(facts, _)| facts.flags & IS_COPIED != 0).flat_map(|(_, of_view)| of_view.iter().map(|field| field.1));
        let mut is_plain_data_held_to = vec![false; fields.together.len()];
        for ty in fields.copied_to.iter().copied().chain(of_what_is_copied_into) {
            for &number in &fields.unions_in[ty as usize] {
                is_plain_data_held_to[number as usize] = true;
            }
        }
        for (number, together) in fields.together.iter().enumerate().filter(|&(number, _)| is_plain_data_held_to[number]) {
            for &view in together {
                beside[view as usize].push(number as u32);
            }
        }
        // What takes any object for another reason need not be made.
        let mut has_to_be_made: Vec<bool> = self.gathered.facts.iter().map(|facts| facts.flags & (IS_MADE_BY_COERCION | IS_INSTANCE) == 0 && !facts.admits_by_structure()).collect();
        // So does what inherits that over a declaration or an upcast. It is not told from anything, whatever leads out of it.
        let mut takes_any_object = vec![false; nodes];
        let mut inheriting: Vec<u32> = self.gathered.foreign.iter().map(|let_in| let_in.0).collect();
        while let Some(view) = inheriting.pop() {
            if !std::mem::replace(&mut takes_any_object[view as usize], true) {
                has_to_be_made[view as usize] = false;
                inheriting.extend(self.untested[view as usize].iter().map(|edge| edge.0));
            }
        }
        let mut pending: Vec<u32> = (0..self.nodes).filter(|&view| has_to_be_made[view as usize]).collect();
        while let Some(made) = pending.pop() {
            let mut told_from_it: Vec<(u32, ToldApart)> = cast_from[made as usize].iter().map(|&other| (other, ToldApart::Tested)).collect();
            if self.flags(made) & IS_TOLD_APART != 0 {
                told_from_it.extend(upcast_from[made as usize].iter().map(|&other| (other, ToldApart::Upcast)));
            }
            for &number in &beside[made as usize] {
                told_from_it.extend(self.gathered.fields.together[number as usize].iter().map(|&other| (other, ToldApart::Beside)));
            }
            for (other, how) in told_from_it {
                let facts = &mut self.gathered.facts[other as usize];
                if facts.admits_by_structure() && !takes_any_object[other as usize] {
                    facts.flags = (facts.flags & !IS_FLAT) | IS_TOLD_APART;
                    self.told_apart.push((other, made, how));
                    pending.push(other);
                }
            }
        }
        self.told_apart.sort_unstable_by_key(|told| told.0);
    }

    /// The questions of this round, for any checker of the program, if the views are published. None, and none of its own: it is done.
    pub fn questions(&self) -> &[Question] {
        &self.questions
    }

    /// Those about types that only the checker knows that has gathered the flows.
    pub fn own_questions(&self) -> &[Question] {
        &self.own_questions
    }

    /// The names that count as stored: what `Checker::answer` goes by, and no field by another name needs a slot.
    pub fn stored(&self) -> &FxHashSet<Atom> {
        &self.gathered.stored
    }

    fn flags(&self, view: u32) -> u16 {
        self.gathered.facts[view as usize].flags
    }

    fn is_allocated(&self, layout: u32) -> bool {
        self.sets[layout as usize].binary_search(&layout).is_ok()
    }

    fn is_forced(&self, from: u32, to: u32) -> bool {
        self.gathered.forced.binary_search(&(from, to)).is_ok()
    }

    fn admits_untyped(&self, view: u32) -> bool {
        self.is_admitting[view as usize]
    }

    fn let_in(&mut self, view: u32, stranger: u32, why: WhyForeign) {
        if self.insert(view, stranger, Cause::Birth) {
            self.why_let_in.insert((view, stranger), why);
        }
    }

    /// `target` is vouched for. Nearly everything fits a target that requires no live field, and there is no list to find that in. It takes any
    /// object instead. Yields whether it does.
    fn let_in_by_structure(&mut self, target: u32, at: Place) -> bool {
        let facts = &self.gathered.facts[target as usize];
        if facts.flags & IS_MADE_BY_COERCION != 0 || !facts.required.is_empty() || !facts.admits_by_structure() {
            return false;
        }
        self.let_in(target, self.nodes, WhyForeign::Weak { at });
        true
    }

    fn insert(&mut self, view: u32, member: u32, cause: Cause) -> bool {
        if self.over_budget.is_some() {
            return false;
        }
        let Err(at) = self.sets[view as usize].binary_search(&member) else { return false };
        self.sets[view as usize].insert(at, member);
        self.causes[view as usize].insert(at, cause);
        self.follow(view, member);
        true
    }

    /// `members`: ascending. One walk over the set, however many there are.
    fn insert_all(&mut self, view: u32, members: &[u32], cause: Cause) {
        let set = &self.sets[view as usize];
        let new: Vec<u32> = if members.len() * 8 < set.len() {
            members.iter().copied().filter(|member| set.binary_search(member).is_err()).collect()
        } else {
            let mut among = 0;
            let is_new = |&member: &u32| {
                while set.get(among).is_some_and(|&other| other < member) {
                    among += 1;
                }
                set.get(among) != Some(&member)
            };
            members.iter().copied().filter(is_new).collect()
        };
        if new.len() < 4 {
            for member in new {
                self.insert(view, member, cause);
            }
            return;
        }
        if self.over_budget.is_some() {
            return;
        }
        let (old, old_causes) = (std::mem::take(&mut self.sets[view as usize]), std::mem::take(&mut self.causes[view as usize]));
        let (mut set, mut causes) = (Vec::with_capacity(old.len() + new.len()), Vec::with_capacity(old.len() + new.len()));
        let mut next = 0;
        for (member, why) in old.into_iter().zip(old_causes) {
            while new.get(next).is_some_and(|&other| other < member) {
                set.push(new[next]);
                causes.push(cause);
                next += 1;
            }
            set.push(member);
            causes.push(why);
        }
        set.extend_from_slice(&new[next..]);
        causes.resize(set.len(), cause);
        (self.sets[view as usize], self.causes[view as usize]) = (set, causes);
        for &member in &new {
            self.follow(view, member);
        }
    }

    /// `member` is newly in the set of `view`.
    fn follow(&mut self, view: u32, member: u32) {
        self.memberships += 1;
        self.tick(1);
        self.holders[member as usize].push(view);
        self.fresh[view as usize].push(member);
        if !std::mem::replace(&mut self.is_queued[view as usize], true) {
            self.queue.push_back(view);
        }
        if member >= self.nodes {
            if !std::mem::replace(&mut self.is_admitting[view as usize], true) {
                self.newly_admitting.push(view);
            }
            return;
        }
        if member != view {
            self.joined.push((member, view));
        }
        // It stays in the places it is in.
        for at in 0..self.becomes[member as usize].len() {
            let becomes = self.becomes[member as usize][at];
            self.insert(view, becomes, Cause::Became(member));
        }
    }

    /// Wherever a table grows. Every so often it looks at the budget and at the time.
    fn tick(&mut self, steps: usize) {
        self.steps += steps;
        if self.steps < 1 << 20 || self.over_budget.is_some() {
            return;
        }
        self.steps = 0;
        let tables = [
            (self.memberships > MOST_MEMBERSHIPS, "the number of memberships"),
            (self.sizes.pairs_met > MOST_PAIRS_MET, "the number of pairs met"),
            (self.met.len() > MOST_PAIRS_WAITING, "the number of pairs that wait"),
            (self.sizes.questions > MOST_QUESTIONS, "the number of questions"),
            (self.is_tested.len() > MOST_TESTS, "the number of tests"),
        ];
        self.over_budget = tables.into_iter().find(|table| table.0).map(|table| table.1);
        if self.clock.last.elapsed().as_secs() >= 2 {
            self.say("on the way");
        }
    }

    /// The table that has grown beyond all use, if one has. What `finish` yields then is good for nothing.
    pub fn is_over_budget(&self) -> Option<&'static str> {
        self.over_budget
    }

    /// `--aot-explain=progress`: a line with the sizes of the tables.
    pub fn say(&mut self, step: &str) {
        if !self.clock.is_loud {
            return;
        }
        const MB: usize = 1 << 20;
        let largest = self.sets.iter().map(Vec::len).max().unwrap_or(0);
        let waiting_to_be_refused: usize = self.newly_refused.iter().map(Vec::len).sum();
        self.clock.say(format_args!(
            "{step}: round {}, phase {}; {} memberships, the largest set {largest}, {} transitions; {} tests, {} pairs of field types compared; {} pairs met, {} refused, {} verdicts kept, {} asked about in {} questions; waiting: {} views, {} new subtypes, {} pairs met, {} pairs asked about, {} + {} questions; MB: sets {}, refused {}, verdicts {}, tests {}, waiting {}",
            self.sizes.rounds,
            if self.phase == Phase::Flows { "A" } else { "B" },
            self.memberships,
            self.transitions,
            self.is_tested.len(),
            self.compared.len(),
            self.sizes.pairs_met,
            self.refusals + waiting_to_be_refused,
            self.verdicts.len(),
            self.sizes.pairs_asked,
            self.sizes.questions,
            self.queue.len(),
            self.joined.len(),
            self.met.len(),
            self.pairs.len(),
            self.questions.len(),
            self.own_questions.len(),
            self.memberships * (size_of::<u32>() * 3 + size_of::<Cause>()) / MB,
            (self.refusals + waiting_to_be_refused) * size_of::<u32>() / MB,
            self.verdicts.len() * 24 / MB,
            (self.is_tested.len() * 20 + self.compared.len() * 12) / MB,
            (self.met.len() * 16 + self.joined.len() * 8 + self.pairs.len() * size_of::<Pair>() + (self.questions.len() + self.own_questions.len()) * size_of::<Question>()) / MB,
        ));
    }

    /// What has grown, in numbers alone: no name and no text of the program is in it.
    fn report(&self) {
        let nodes = self.nodes as usize;
        // Out of the view and into it: declared, upcasts, casts, tests, tests between field types.
        let mut degrees = vec![[0u32; 10]; nodes];
        for from in 0..nodes {
            for &(to, number) in &self.untested[from] {
                let kind = usize::from(number != NONE);
                degrees[from][kind] += 1;
                degrees[to as usize][5 + kind] += 1;
            }
            for (at, &(to, may_change)) in self.tested[from].iter().enumerate() {
                let kind = if at >= self.noted_tests[from] as usize { 4 } else if may_change { 2 } else { 3 };
                degrees[from][kind] += 1;
                degrees[to as usize][5 + kind] += 1;
            }
        }
        let number_of = |cause: &Cause| match cause {
            Cause::Birth => 0,
            Cause::Transition(_) => 1,
            Cause::Declared(_) => 2,
            Cause::Upcast(_) => 3,
            Cause::Cast(_) => 4,
            Cause::Admitted(_) => 5,
            Cause::Became(_) => 6,
            Cause::Fit(_) => 7,
        };
        let by_cause = |causes: [usize; 8]| format!("born {}, by a transition {}, declared {}, over upcasts {}, passing casts {}, admitted {}, become {}, fitting {}", causes[0], causes[1], causes[2], causes[3], causes[4], causes[5], causes[6], causes[7]);
        let describe = |view: usize| {
            let facts = &self.gathered.facts[view];
            let words = [
                (HAS_SITE, "has a site"),
                (IS_COPIED, "copied into"),
                (HAS_CONSTANTS, "has constants"),
                (IS_CONCRETE, "concrete"),
                (IS_INSTANCE, "class"),
                (IS_GENERIC, "generic"),
                (IS_MADE_BY_COERCION, "made by coercion"),
                (IS_WEAK, "weak"),
                (HAS_INDEX_SIGNATURE, "index signature"),
                (HAS_CONCRETE_SUBTYPE, "has a concrete subtype"),
                (IS_FLAT, "flat"),
                (IS_TOLD_APART, "told apart"),
            ];
            let words: Vec<&str> = words.iter().filter(|word| facts.flags & word.0 != 0).map(|word| word.1).collect();
            let mut causes = [0usize; 8];
            for cause in &self.causes[view] {
                causes[number_of(cause)] += 1;
            }
            let (set, of) = (&self.sets[view], &degrees[view]);
            format!(
                "#{view}: {}, {}; names: {} declared, {} live, {} required, {} open, {} constants; {} subtypes, {} not laid out; refuses {}; becomes {}; held by {}; out: {} declared, {} upcasts, {} casts, {} tests, {} field tests; in: {} declared, {} upcasts, {} casts, {} tests, {} field tests; subtypes {}",
                facts.kind,
                if words.is_empty() { "no flag".to_string() } else { words.join(", ") },
                facts.declared.len(),
                facts.live.len(),
                facts.required.len(),
                facts.open.len(),
                facts.constants.len(),
                set.len(),
                set.len() - set.partition_point(|&member| member < self.nodes),
                self.refused[view].len() + self.newly_refused[view].len(),
                self.becomes[view].len(),
                self.holders[view].len(),
                of[0],
                of[1],
                of[2],
                of[3],
                of[4],
                of[5],
                of[6],
                of[7],
                of[8],
                of[9],
                by_cause(causes)
            )
        };
        let say_the_first = |title: &str, size_of_view: &dyn Fn(usize) -> usize| {
            let mut by_size: Vec<usize> = (0..nodes).filter(|&view| size_of_view(view) > 0).collect();
            by_size.sort_unstable_by_key(|&view| (std::cmp::Reverse(size_of_view(view)), view));
            eprintln!("aot: sizes: {title}: {} in all, in {} views. The first 30:", by_size.iter().map(|&view| size_of_view(view)).sum::<usize>(), by_size.len());
            for &view in by_size.iter().take(30) {
                eprintln!("aot: sizes:   {} {}", size_of_view(view), describe(view));
            }
        };
        match self.over_budget {
            Some(table) => eprintln!("aot: sizes: {table} is over its budget, in round {}, phase {}", self.sizes.rounds, if self.phase == Phase::Flows { "A" } else { "B" }),
            None => eprintln!("aot: sizes: within the budget"),
        }
        let mut all_causes = [0usize; 8];
        let mut sets_by_size = [0usize; 33];
        for view in 0..nodes {
            for cause in &self.causes[view] {
                all_causes[number_of(cause)] += 1;
            }
            sets_by_size[(usize::BITS - self.sets[view].len().leading_zeros()) as usize] += 1;
        }
        eprintln!("aot: sizes: all memberships: {}", by_cause(all_causes));
        let sets_by_size: Vec<String> = sets_by_size.iter().enumerate().filter(|size| *size.1 > 0).map(|(bits, number)| format!("{number} below {}", 1usize << bits)).collect();
        eprintln!("aot: sizes: sets by size: {}", sets_by_size.join(", "));
        say_the_first("subtypes", &|view| self.sets[view].len());
        say_the_first("supertypes that hold it", &|view| self.holders[view].len());
        say_the_first("transitions out of it", &|view| self.becomes[view].len());
        say_the_first("layouts refused", &|view| self.refused[view].len() + self.newly_refused[view].len());
        say_the_first("casts and tests out of it", &|view| self.tested[view].len());
        say_the_first("casts and tests into it", &|view| (degrees[view][7] + degrees[view][8] + degrees[view][9]) as usize);
        say_the_first("untested edges into it", &|view| (degrees[view][5] + degrees[view][6]) as usize);
        // Why supertypes admit untyped objects: by the reason where it starts, those that it is the reason of themselves and those that have it
        // over upcasts, declarations and casts.
        const REASONS: [&str; 8] = ["seen to be let in", "declared in a declaration file", "untyped inflow and a kind that is of the type", "weak", "flat", "too many candidates", "made by coercion", "another"];
        let (mut of_their_own, mut inherited) = ([0usize; 8], [0usize; 8]);
        for view in (0..self.nodes).filter(|&view| self.admits_untyped(view)) {
            let (mut at, mut steps) = (view, 0);
            let reason = loop {
                let set = &self.sets[at as usize];
                let first = set.partition_point(|&member| member < self.nodes);
                let from = match self.causes[at as usize].get(first) {
                    Some(&Cause::Upcast(number)) => self.gathered.upcasts[number as usize].0,
                    Some(&Cause::Declared(from) | &Cause::Cast(from)) => from,
                    _ => {
                        break match set.get(first).and_then(|&stranger| self.why_let_in.get(&(at, stranger))) {
                            Some(WhyForeign::Seen { .. }) if self.flags(at) & IS_MADE_BY_COERCION != 0 => 6,
                            Some(WhyForeign::Seen { .. }) => 0,
                            Some(WhyForeign::DeclaredOnly) => 1,
                            Some(WhyForeign::Untyped { .. }) => 2,
                            Some(WhyForeign::Weak { .. }) => 3,
                            Some(WhyForeign::Flat { .. }) => 4,
                            Some(WhyForeign::TooMany { .. }) => 5,
                            _ => 7,
                        };
                    }
                };
                steps += 1;
                if from == at || from >= self.nodes || steps > 64 {
                    break 7;
                }
                at = from;
            };
            if steps == 0 { of_their_own[reason] += 1 } else { inherited[reason] += 1 }
        }
        let by_reason: Vec<String> = (0..8).filter(|&reason| of_their_own[reason] + inherited[reason] > 0).map(|reason| format!("{}: {} and {} that have it from those", REASONS[reason], of_their_own[reason], inherited[reason])).collect();
        eprintln!("aot: sizes: supertypes that admit untyped objects: {}. {}", of_their_own.iter().chain(&inherited).sum::<usize>(), by_reason.join("; "));
        let mut views_in: Vec<usize> = self.gathered.fields.views_in.iter().map(Vec::len).collect();
        views_in.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
        eprintln!("aot: sizes: views in a type: {} in all, in {} types. The first 30: {:?}", views_in.iter().sum::<usize>(), views_in.len(), &views_in[..views_in.len().min(30)]);
        // What one layout per structure would save, at the least: the types of the fields are compared as they are.
        for kind in ["an object literal", "a type literal"] {
            let mut by_fields: FxHashMap<&[(u32, u32)], usize> = FxHashMap::default();
            for (view, fields) in self.gathered.fields.of_views.iter().enumerate().filter(|of_view| self.gathered.facts[of_view.0].kind == kind) {
                *by_fields.entry(&fields[..]).or_default() += usize::from(view < nodes);
            }
            let mut sharing: Vec<usize> = by_fields.values().copied().filter(|&number| number > 1).collect();
            sharing.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
            eprintln!("aot: sizes: {kind}: {} views with {} different lists of live fields (name and type); {} views share theirs with another. The first 30: {:?}", by_fields.values().sum::<usize>(), by_fields.len(), sharing.iter().sum::<usize>(), &sharing[..sharing.len().min(30)]);
        }
        let mut together: Vec<usize> = self.gathered.fields.together.iter().map(Vec::len).collect();
        together.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
        eprintln!("aot: sizes: parts of a union: {} in all, in {} unions. The first 30: {:?}", together.iter().sum::<usize>(), together.len(), &together[..together.len().min(30)]);
    }

    fn add_test(&mut self, from: u32, to: u32) {
        if from == to || self.over_budget.is_some() || !self.is_tested.insert((from, to)) {
            return;
        }
        self.tick(1);
        self.sizes.field_tests += 1;
        self.tested[from as usize].push((to, false));
        if self.is_admitting[from as usize] {
            self.newly_admitting.push(from);
        }
        let set = &self.sets[from as usize];
        let not_laid_out = set[set.partition_point(|&member| member < self.nodes)..].to_vec();
        self.bring_together(&not_laid_out, from, to, false);
    }

    /// `members`, ascending, which are in places of the view `from`, get to a cast or a test. Those that the target has or refuses are left
    /// out here, in one walk over the three lists: nearly all of them, and there are many edges between large sets.
    fn bring_together(&mut self, members: &[u32], from: u32, to: u32, may_change: bool) {
        if self.over_budget.is_some() || members.is_empty() || (!may_change && self.admits_untyped(to)) {
            return;
        }
        self.tick(members.len());
        self.put_refused_in_order(to);
        let is_forced = may_change && self.is_forced(from, to);
        let mut admitted = Vec::new();
        let (has, refuses) = (&self.sets[to as usize], &self.refused[to as usize]);
        let target = &self.gathered.facts[to as usize];
        let (mut among, mut among_refused) = (0, 0);
        for &member in members {
            while has.get(among).is_some_and(|&other| other < member) {
                among += 1;
            }
            while refuses.get(among_refused).is_some_and(|&other| other < member) {
                among_refused += 1;
            }
            // What is not laid out, and of no type that is known, stays where upcasts take it. But see `meet`.
            let may_pass = member != self.nodes || (may_change && target.flags & IS_FLAT != 0) || is_forced;
            if is_forced && refuses.get(among_refused) == Some(&member) && has.get(among) != Some(&member) {
                admitted.push(member);
            }
            // What an upcast has brought here before may yet become the target at a cast: `createType(flags) as TypeParameter`.
            let is_new = has.get(among) != Some(&member)
                || (may_change && member < self.nodes && target.flags & IS_INSTANCE == 0 && self.gathered.facts[member as usize].live.len() <= target.live.len() && self.becomes[member as usize].binary_search(&to).is_err());
            if is_new && refuses.get(among_refused) != Some(&member) && may_pass && member != to {
                self.met.push((member, from, to, may_change));
            }
        }
        for member in admitted {
            self.insert(to, member, Cause::Admitted(from));
        }
    }

    fn put_refused_in_order(&mut self, target: u32) {
        let mut new = std::mem::take(&mut self.newly_refused[target as usize]);
        if new.is_empty() {
            return;
        }
        new.sort_unstable();
        new.dedup();
        let old = std::mem::take(&mut self.refused[target as usize]);
        let mut merged = Vec::with_capacity(old.len() + new.len());
        let (mut at, mut among_new) = (0, 0);
        while at < old.len() && among_new < new.len() {
            if old[at] <= new[among_new] {
                among_new += usize::from(old[at] == new[among_new]);
                merged.push(old[at]);
                at += 1;
            } else {
                merged.push(new[among_new]);
                among_new += 1;
            }
        }
        merged.extend_from_slice(&old[at..]);
        merged.extend_from_slice(&new[among_new..]);
        self.refusals += merged.len() - old.len();
        self.refused[target as usize] = merged;
    }

    /// Follows every edge as far as it goes without an answer, and leaves the questions of the next round.
    fn settle(&mut self) {
        loop {
            self.say("the untested edges");
            while let Some(view) = self.queue.pop_front() {
                self.is_queued[view as usize] = false;
                let mut fresh = std::mem::take(&mut self.fresh[view as usize]);
                fresh.sort_unstable();
                for at in 0..self.untested[view as usize].len() {
                    let (to, number) = self.untested[view as usize][at];
                    // That untyped objects get to the one does not show that they get to the other.
                    match number {
                        NONE => self.insert_all(to, &fresh, Cause::Declared(view)),
                        FITS => self.bring_what_fits(view, to, &fresh[..fresh.partition_point(|&member| member < self.nodes)]),
                        number => self.insert_all(to, &fresh, Cause::Upcast(number)),
                    }
                }
                let laid_out = fresh.partition_point(|&member| member < self.nodes);
                for at in 0..self.tested[view as usize].len() {
                    let (to, may_change) = self.tested[view as usize][at];
                    let members = if at < self.noted_tests[view as usize] as usize { &fresh[..] } else { &fresh[laid_out..] };
                    self.bring_together(members, view, to, may_change);
                }
            }
            // The untested edges first: what a declaration or an upcast brings need not be asked about.
            self.say("the fields of the new subtypes");
            for (member, view) in std::mem::take(&mut self.joined) {
                self.compare_fields(member, view);
            }
            self.say("the pairs that have met");
            for (member, from, to, may_change) in std::mem::take(&mut self.met) {
                self.meet(member, from, to, may_change);
            }
            if self.over_budget.is_some() {
                self.say("over the budget");
                self.report();
                self.queue.clear();
                self.joined.clear();
                self.met.clear();
                self.pairs.clear();
                self.questions.clear();
                self.own_questions.clear();
                return;
            }
            if self.queue.is_empty() && self.joined.is_empty() && self.met.is_empty() {
                if !self.pairs.is_empty() || !self.questions.is_empty() {
                    return self.say("the questions of the round");
                }
                self.find_what_to_complete();
                if self.to_complete.is_empty() {
                    return;
                }
                self.say("phase B");
                self.complete();
            }
        }
    }

    /// `member` is a subtype of `view`: what is stored to a field through the one is read through the other.
    fn compare_fields(&mut self, member: u32, view: u32) {
        if self.over_budget.is_some() {
            return;
        }
        let (mut at, mut other) = (0, 0);
        loop {
            let (Some(&(name, ty)), Some(&(same, as_ty))) = (self.gathered.fields.of_views[member as usize].get(at), self.gathered.fields.of_views[view as usize].get(other)) else { return };
            at += usize::from(name <= same);
            other += usize::from(same <= name);
            if name != same || ty == as_ty || !self.compared.insert((ty, as_ty)) {
                continue;
            }
            for from in 0..self.gathered.fields.views_in[ty as usize].len() {
                for to in 0..self.gathered.fields.views_in[as_ty as usize].len() {
                    let (from, to) = (self.gathered.fields.views_in[ty as usize][from], self.gathered.fields.views_in[as_ty as usize][to]);
                    self.add_test(from, to);
                    self.add_test(to, from);
                }
            }
        }
    }

    /// `member`, which is in places of the view `from`, gets to a cast to `to`, or to a mere test.
    fn meet(&mut self, member: u32, from: u32, to: u32, may_change: bool) {
        let is_there = self.sets[to as usize].binary_search(&member).is_ok();
        // Phase B asks about a supertype that is there, too: for what it brings.
        if self.over_budget.is_some() || (is_there && from != NONE && (!may_change || member >= self.nodes)) {
            return;
        }
        self.tick(1);
        self.sizes.pairs_met += 1;
        // A type all of whose properties are primitives admits untyped objects wherever the source of a cast to it does. Nothing has to be
        // made of such an object, and nothing that is read through the type has to be held to a layout: `Pick<CompilerOptions, "target">`.
        if member == self.nodes {
            self.insert(to, member, Cause::Cast(from));
            return;
        }
        // Phase B asks for itself, and what it is told says nothing of what a cast makes of the pair.
        if from == NONE {
            if may_fit(&self.gathered.facts[member as usize], &self.gathered.facts[to as usize]) {
                self.sizes.pairs_asked += 1;
                let fits = self.ask(Question::whether_made_is_assignable_to(self.gathered.types[member as usize], self.gathered.asked_as[to as usize]), false);
                self.pairs.push(Pair { member, target: to, from, may_change, fits, is_fitted: NONE });
            }
            return;
        }
        match self.verdicts.get(&(member, to)) {
            // A cast makes more of it than a test.
            Some(&Verdict::Asked(pair)) => {
                let is_forced = self.is_forced(from, to);
                let pair = &mut self.pairs[pair as usize];
                if may_change && (!pair.may_change || is_forced) {
                    (pair.from, pair.may_change) = (from, true);
                }
                return;
            }
            Some(&known) => return self.apply(known, member, from, to, may_change),
            None => {}
        }
        let number = Verdict::Asked(self.pairs.len() as u32);
        // What is not laid out passes if it is of the type.
        if member > self.nodes {
            self.verdicts.insert((member, to), number);
            let fits = self.ask(Question::whether_made_is_of(self.seen[(member - self.nodes - 1) as usize], self.gathered.asked_as[to as usize]), true);
            return self.pairs.push(Pair { member, target: to, from, may_change, fits, is_fitted: NONE });
        }
        let (made, target) = (&self.gathered.facts[member as usize], &self.gathered.facts[to as usize]);
        // What is there without a verdict has come over an untested edge: it fits.
        let asks_whether_it_fits = !is_there && may_fit(made, target);
        let asks_the_converse = target.flags & IS_INSTANCE == 0 && is_subset(&made.live, &target.live) && may_fit(target, made);
        if !asks_whether_it_fits && !asks_the_converse {
            let verdict = self.verdict(member, to, is_there, false);
            self.settle_pair(member, to, verdict);
            return self.apply(verdict, member, from, to, may_change);
        }
        self.verdicts.insert((member, to), number);
        self.sizes.pairs_asked += 1;
        let fits = if asks_whether_it_fits { self.ask(Question::whether_made_is_of(self.gathered.types[member as usize], self.gathered.asked_as[to as usize]), false) } else if is_there { YES } else { NONE };
        let is_fitted = if asks_the_converse { self.ask(Question::whether_made_is_of(self.gathered.types[to as usize], self.gathered.asked_as[member as usize]), false) } else { NONE };
        self.pairs.push(Pair { member, target: to, from, may_change, fits, is_fitted });
    }

    fn settle_pair(&mut self, member: u32, target: u32, verdict: Verdict) {
        if verdict == Verdict::Refused {
            self.verdicts.remove(&(member, target));
            self.newly_refused[target as usize].push(member);
        } else {
            self.verdicts.insert((member, target), verdict);
        }
    }

    fn ask(&mut self, question: Question, is_own: bool) -> u32 {
        self.sizes.questions += 1;
        let questions = if is_own { &mut self.own_questions } else { &mut self.questions };
        questions.push(question);
        (questions.len() - 1) as u32 | if is_own { OWN } else { 0 }
    }

    /// What a cast to `target` makes of an object of the layout `member`. `fits`: it is of the type of the target. `is_fitted`: the target is
    /// of the type of the layout, and has every live field of it.
    ///
    /// TRANSITION FIRST, ADMIT SECOND. A SHAPE TRANSITION ADDS FIELDS AND LOSES NONE: a `PromiseOrAwaitableType` does not become a
    /// `FreshObjectLiteralType`, which lacks `promisedTypeOfPromise`. Where each is of the type of the other, because what the one has more is
    /// optional (`TypeParameter extends Type`), it goes to the one that has more. NOTHING BECOMES AN ABSTRACT LAYOUT: an object is allocated
    /// as what its discriminant says, or becomes that, and a step on the way hides what an allocation makes. What a cast would have
    /// turned into one is admitted as it is.
    ///
    /// A FAMILY: the extensions of one base that is allocated. `Type` is cast to `ObjectType`, `InterfaceType`, `ResolvedType`, `GenericType` as the
    /// program learns more about it. No discriminant says that it is one and not the other, and it is several at once: it ACCUMULATES
    /// extensions, and a transition goes one way only. So a sibling that cannot become the target is admitted as it is. What its
    /// layout lacks of the target's fields is an extra property, which is slow.
    fn verdict(&mut self, member: u32, target: u32, fits: bool, is_fitted: bool) -> Verdict {
        let (made, to) = (&self.gathered.facts[member as usize], &self.gathered.facts[target as usize]);
        let may_become = is_fitted && (made.live.len() < to.live.len() || !fits);
        let is_abstract = to.flags & IS_CONCRETE == 0 && to.flags & HAS_CONCRETE_SUBTYPE != 0;
        if may_become && !is_abstract {
            return Verdict::Becomes { fits };
        }
        if fits {
            return Verdict::Passes;
        }
        // A copy of plain data is born complete, which takes nothing from what casts do to the objects of the base.
        const NO_EXTENSION: u16 = HAS_SITE | HAS_CONSTANTS | IS_INSTANCE;
        if may_become || (made.flags & NO_EXTENSION == 0 && to.flags & NO_EXTENSION == 0 && self.have_a_base_in_common(member, target)) {
            return Verdict::Admitted;
        }
        Verdict::Refused
    }

    fn have_a_base_in_common(&mut self, a: u32, b: u32) -> bool {
        self.find_bases(a);
        self.find_bases(b);
        match (&self.bases[a as usize], &self.bases[b as usize]) {
            (Some(of_a), Some(of_b)) => shares_one(of_a, of_b),
            _ => false,
        }
    }

    fn find_bases(&mut self, view: u32) {
        if self.bases[view as usize].is_some() {
            return;
        }
        let (mut found, mut passed, mut pending) = (Vec::new(), FxHashSet::default(), vec![view]);
        while let Some(at) = pending.pop() {
            for &(supertype, number) in &self.untested[at as usize] {
                if number == NONE && passed.insert(supertype) {
                    if self.flags(supertype) & (HAS_SITE | IS_COPIED) != 0 {
                        found.push(supertype);
                    }
                    pending.push(supertype);
                }
            }
        }
        found.sort_unstable();
        self.bases[view as usize] = Some(found.into_boxed_slice());
    }

    /// `from`: the view that the cast is from. `may_change`: it is a cast, and no mere test, which only lets through what fits.
    fn apply(&mut self, verdict: Verdict, member: u32, from: u32, to: u32, may_change: bool) {
        let verdict = match verdict {
            Verdict::Becomes { fits: true } if !may_change => Verdict::Passes,
            Verdict::Becomes { .. } | Verdict::Admitted if !may_change => return,
            verdict => verdict,
        };
        match verdict {
            Verdict::Refused if may_change && self.is_forced(from, to) => _ = self.insert(to, member, Cause::Admitted(from)),
            Verdict::Asked(_) | Verdict::Refused => {}
            Verdict::Passes => _ = self.insert(to, member, Cause::Cast(from)),
            Verdict::Admitted => _ = self.insert(to, member, Cause::Admitted(from)),
            Verdict::Becomes { .. } => {
                let Err(at) = self.becomes[member as usize].binary_search(&to) else { return };
                self.becomes[member as usize].insert(at, to);
                self.transitions += 1;
                self.insert(to, to, Cause::Transition(member));
                for at in 0..self.holders[member as usize].len() {
                    let holder = self.holders[member as usize][at];
                    self.insert(holder, to, Cause::Became(member));
                }
            }
        }
    }

    /// The answers to `questions` and to `own_questions`, in their order. Starts the next round.
    pub fn advance(&mut self, answers: &[bool], own_answers: &[bool]) {
        debug_assert!(answers.len() == self.questions.len() && own_answers.len() == self.own_questions.len());
        self.say("the answers");
        self.sizes.rounds += 1;
        // They are the first questions of the first round. The first yes is the same however the questions were shared out: nothing
        // before it is left out.
        for (at, (_, view, why)) in std::mem::take(&mut self.gathered.about_kinds).into_iter().enumerate() {
            if answers[at] {
                self.let_in(view, self.nodes, why);
            }
        }
        let is_yes = |at: u32| at == YES || (at != NONE && if at & OWN != 0 { own_answers[(at & !OWN) as usize] } else { answers[at as usize] });
        let pairs = std::mem::take(&mut self.pairs);
        let decided: Vec<(u32, u32, u32, bool, bool, bool)> = pairs.iter().map(|pair| (pair.member, pair.target, pair.from, pair.may_change, is_yes(pair.fits), is_yes(pair.is_fitted))).collect();
        self.questions.clear();
        self.own_questions.clear();
        for (member, target, from, may_change, fits, is_fitted) in decided {
            if from == NONE {
                // Whatever is in a place of the one may get to a place of the other, now and later.
                if fits {
                    self.untested[member as usize].push((target, FITS));
                    let set = &self.sets[member as usize];
                    let brought = set[..set.partition_point(|&subtype| subtype < self.nodes)].to_vec();
                    self.bring_what_fits(member, target, &brought);
                }
                continue;
            }
            let verdict = if member > self.nodes {
                if fits { Verdict::Passes } else { Verdict::Refused }
            } else {
                self.verdict(member, target, fits, is_fitted)
            };
            self.settle_pair(member, target, verdict);
            self.apply(verdict, member, from, target, may_change);
        }
        self.settle();
    }

    /// Phase B has found that `from` fits `target`. `members`: subtypes of `from`, ascending.
    fn bring_what_fits(&mut self, from: u32, target: u32, members: &[u32]) {
        if self.admits_untyped(target) || self.is_given_up[target as usize] {
            return;
        }
        let has = &self.sets[target as usize];
        let new = members.iter().filter(|member| has.binary_search(member).is_err()).count();
        if has.len() + new <= MOST_SUBTYPES_BY_FIT {
            return self.insert_all(target, members, Cause::Fit(from));
        }
        let at = self.gathered.vouched.binary_search_by_key(&target, |vouched| vouched.0).map_or_else(|_| Place::default(), |found| self.gathered.vouched[found].1);
        self.give_up_completing(target, at);
    }

    /// Too many layouts may fit the target, or do. It takes any object instead. Not the type of the objects of a class: nothing but its constructor
    /// makes one, and what else is of its type gets there by a flow that is seen, or not at all. Nor a part of a union that is told
    /// from the others by what it requires, or what they have in common: plain data that stayed plain would be none of them. One that
    /// requires nothing is no such part.
    fn give_up_completing(&mut self, target: u32, at: Place) {
        if std::mem::replace(&mut self.is_given_up[target as usize], true) {
            return;
        }
        self.sizes.with_too_many_candidates += 1;
        let facts = &self.gathered.facts[target as usize];
        if facts.flags & IS_INSTANCE == 0 && (facts.flags & IS_TOLD_APART == 0 || facts.required.is_empty()) {
            self.let_in(target, self.nodes, WhyForeign::TooMany { at });
        }
    }

    /// Phase B begins with what has been noted as vouched for. After that, whenever all is quiet: the targets of the casts and the tests out of
    /// a supertype that has come to admit untyped objects.
    fn find_what_to_complete(&mut self) {
        if self.phase == Phase::Flows {
            self.phase = Phase::Completion;
            for at in 0..self.gathered.vouched.len() {
                let (target, place) = self.gathered.vouched[at];
                self.is_vouched[target as usize] = true;
                self.to_complete.push((target, place));
            }
        }
        for view in std::mem::take(&mut self.newly_admitting) {
            for at in 0..self.tested[view as usize].len() {
                let to = self.tested[view as usize][at].0;
                if !std::mem::replace(&mut self.is_vouched[to as usize], true) {
                    self.to_complete.push((to, Place::default()));
                }
            }
        }
    }

    fn find_candidates(&self) -> Candidates {
        // What is allocated, or may yet be: the target of a cast.
        let mut is_candidate: Vec<bool> = (0..self.nodes).map(|layout| self.is_allocated(layout)).collect();
        for &(_, to) in &self.gathered.casts {
            if self.flags(to) & IS_INSTANCE == 0 {
                is_candidate[to as usize] = true;
            }
        }
        let mut lists = Candidates { by_name: FxHashMap::default(), by_open: FxHashMap::default(), by_constant: FxHashMap::default(), without_names: Vec::new(), large_by_name: FxHashMap::default() };
        for layout in 0..self.nodes {
            let facts = &self.gathered.facts[layout as usize];
            if self.sets[layout as usize].len() >= LARGE && !self.admits_untyped(layout) && facts.flags & IS_MADE_BY_COERCION == 0 {
                for &name in facts.declared.iter() {
                    lists.large_by_name.entry(name).or_default().push(layout);
                }
            }
            if !is_candidate[layout as usize] {
                continue;
            }
            if facts.declared.is_empty() {
                lists.without_names.push(layout);
            }
            for &name in facts.declared.iter() {
                lists.by_name.entry(name).or_default().push(layout);
            }
            for &name in facts.open.iter() {
                lists.by_open.entry(name).or_default().push(layout);
            }
            for &constant in facts.constants.iter() {
                lists.by_constant.entry(constant).or_default().push(layout);
            }
        }
        lists
    }

    /// The layouts among which are all that fit a type with these facts. Ascending.
    fn candidates_for(lists: &Candidates, facts: &Facts) -> Vec<u32> {
        // The numbers of names differ from run to run, so of two lists of one length it is not the first that is taken.
        let is_shorter = |a: &&[u32], b: &&[u32]| a.len().cmp(&b.len()).then_with(|| a.cmp(b));
        let mut candidates: Vec<u32> = Vec::new();
        // The shortest list that every layout that fits is in: of a required name, or of the constants of a required field.
        match facts.required.iter().map(|name| lists.by_name.get(name).map_or(&[][..], |list| &list[..])).min_by(is_shorter) {
            // What fits shares a name, or has none.
            None => {
                candidates.extend(facts.declared.iter().filter_map(|name| lists.by_name.get(name)).flatten());
                candidates.extend_from_slice(&lists.without_names);
            }
            Some(shortest) => {
                let lists_of = |taken: &[(u32, u64)]| {
                    let mut found: Vec<&[u32]> = taken.iter().filter_map(|constant| lists.by_constant.get(constant)).chain(lists.by_open.get(&taken[0].0)).map(|list| &list[..]).collect();
                    found.sort_unstable();
                    found
                };
                let number_in = |found: &Vec<&[u32]>| found.iter().map(|list| list.len()).sum::<usize>();
                let by_constants = (facts.constants.chunk_by(|a, b| a.0 == b.0).filter(|taken| facts.required.binary_search(&taken[0].0).is_ok()).map(lists_of)).min_by(|a, b| number_in(a).cmp(&number_in(b)).then_with(|| a.cmp(b)));
                match by_constants {
                    Some(found) if number_in(&found) < shortest.len() => candidates.extend(found.into_iter().flatten()),
                    _ => candidates.extend_from_slice(shortest),
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        candidates
    }

    /// The supertypes with the largest sets that may fit the target by their names, `MOST_CANDIDATES` at most. Ascending.
    fn large_candidates_for(&self, lists: &Candidates, target: u32) -> Vec<u32> {
        let facts = &self.gathered.facts[target as usize];
        let names = if facts.required.is_empty() { &facts.declared } else { &facts.required };
        let mut large: Vec<u32> = names.iter().filter_map(|name| lists.large_by_name.get(name)).flatten().copied().collect();
        large.sort_unstable();
        large.dedup();
        large.retain(|&view| view != target && may_fit(&self.gathered.facts[view as usize], facts));
        large.sort_by_key(|&view| (std::cmp::Reverse(self.sets[view as usize].len()), view));
        large.truncate(MOST_CANDIDATES);
        large.sort_unstable();
        large
    }

    /// Phase B, for `to_complete`. See the head of the file.
    fn complete(&mut self) {
        let lists = match self.candidates.take() {
            Some(lists) => lists,
            None => Box::new(self.find_candidates()),
        };
        let mut again: Vec<(u32, Place)> = Vec::new();
        let mut targets_by_name: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
        for (target, place) in std::mem::take(&mut self.to_complete) {
            // What a coercion made admits everything as it is, and so does what admits untyped objects.
            if self.flags(target) & IS_MADE_BY_COERCION != 0 || self.admits_untyped(target) || self.let_in_by_structure(target, place) {
                continue;
            }
            let facts = &self.gathered.facts[target as usize];
            // Nearly everything fits a class that requires nothing, and it cannot take any object instead.
            if facts.flags & IS_INSTANCE != 0 && facts.required.is_empty() {
                self.give_up_completing(target, place);
                continue;
            }
            let most = if facts.flags & (IS_INSTANCE | IS_TOLD_APART) != 0 { MOST_CANDIDATES_OF_WHAT_IS_MADE } else { MOST_CANDIDATES };
            let (has, asked_first) = (&self.sets[target as usize], self.asked_first.get(&target));
            let may_be_new = |&made: &u32| made != target && has.binary_search(&made).is_err() && asked_first.is_none_or(|asked| asked.binary_search(&made).is_err()) && may_fit(&self.gathered.facts[made as usize], facts);
            let fitting: Vec<u32> = Self::candidates_for(&lists, facts).into_iter().filter(may_be_new).take(MOST_CANDIDATES_OF_WHAT_IS_MADE + 1).collect();
            if fitting.len() > most {
                // One of them may bring most of the others, unless they are beyond all measure.
                let large = if asked_first.is_none() && fitting.len() <= MOST_CANDIDATES_OF_WHAT_IS_MADE { self.large_candidates_for(&lists, target) } else { Vec::new() };
                if !large.is_empty() {
                    self.met.extend(large.iter().map(|&view| (view, NONE, target, false)));
                    self.asked_first.insert(target, large);
                    again.push((target, place));
                    continue;
                }
                self.give_up_completing(target, place);
                continue;
            }
            for &name in facts.live.iter() {
                targets_by_name.entry(name).or_default().push(target);
            }
            self.bring_together(&fitting, NONE, target, false);
        }
        self.candidates = Some(lists);
        self.to_complete = again;
        // What generic code has made goes by the bounds of its type parameters until a test on the way out makes it what the caller takes
        // it for: a `Token<TKind>` becomes an `AsteriskToken`. Where it comes out of a call that is not seen through, nothing says
        // what it is looked at as before. What the caller takes it for has the same fields: `{ value: T }` does not become whatever
        // has a `value`.
        let is_shorter = |a: &&[u32], b: &&[u32]| a.len().cmp(&b.len()).then_with(|| a.cmp(b));
        // Not only what is made as such a type: whatever is in a place of it. `createBaseToken<T extends Node>` casts a `Node` to `Mutable<T>`, which
        // is carried out nowhere, and `createToken<TKind>` hands it on as a `Token<TKind>`, which a `Node` is.
        for generic in 0..self.nodes {
            let facts = &self.gathered.facts[generic as usize];
            if facts.flags & IS_GENERIC == 0 || facts.flags & IS_INSTANCE != 0 {
                continue;
            }
            let Some(shortest) = facts.live.iter().map(|name| targets_by_name.get(name).map_or(&[][..], |list| &list[..])).min_by(is_shorter) else { continue };
            let may_meet = |&&target: &&u32| target != generic && facts.live == self.gathered.facts[target as usize].live;
            let targets: Vec<u32> = shortest.iter().filter(may_meet).copied().collect();
            let set = &self.sets[generic as usize];
            let laid_out = set[..set.partition_point(|&subtype| subtype < self.nodes)].to_vec();
            for target in targets {
                self.bring_together(&laid_out, generic, target, true);
            }
        }
    }

    /// Once there are no more questions.
    pub fn finish(mut self, let_through: &ForClosure) -> Membership {
        self.say("done");
        if self.clock.is_loud && self.over_budget.is_none() {
            self.report();
        }
        let views = self.nodes as usize;
        let mut reached: Vec<Reach> = Vec::new();
        reached.resize_with(views, Reach::default);
        let mut why_foreign: Vec<Option<WhyForeign>> = vec![None; views];
        for (view, reach) in reached.iter_mut().enumerate() {
            let set = &self.sets[view];
            let laid_out = set.partition_point(|&member| member < self.nodes);
            reach.members = set[..laid_out].to_vec();
            reach.specializations = self.becomes[view].clone();
            reach.is_allocated = set.binary_search(&(view as u32)).is_ok();
            reach.is_transition_target_only = reach.is_allocated && self.gathered.facts[view].flags & (HAS_SITE | IS_COPIED) == 0;
            reach.admits_foreign = laid_out < set.len();
            if reach.admits_foreign {
                why_foreign[view] = Some(match self.causes[view][laid_out] {
                    Cause::Upcast(number) => WhyForeign::Inherited { from: self.gathered.upcasts[number as usize].0, at: self.gathered.upcasts[number as usize].2 },
                    Cause::Declared(from) => WhyForeign::Inherited { from, at: Place::default() },
                    Cause::Cast(from) | Cause::Admitted(from) => WhyForeign::PassedCast { from },
                    _ => self.why_let_in[&(view as u32, set[laid_out])],
                });
            }
            self.sizes.allocated += usize::from(reach.is_allocated);
            self.sizes.admitting_untyped += usize::from(reach.admits_foreign);
            self.sizes.memberships += laid_out;
            self.sizes.fitting_without_flow += self.causes[view][..laid_out].iter().filter(|cause| matches!(cause, Cause::Fit(_))).count();
            self.sizes.largest = self.sizes.largest.max(laid_out);
            self.sizes.transitions += reach.specializations.len();
        }
        let mark = |reach: &mut Reach, alteration: usize| *(if alteration == 0 { &mut reach.may_be_frozen } else { &mut reach.may_have_other_prototype }) = true;
        for alteration in 0..2 {
            for &view in &self.gathered.altered[alteration].views {
                for &member in self.sets[view as usize].iter().filter(|&&member| (member as usize) < views) {
                    mark(&mut reached[member as usize], alteration);
                }
            }
        }
        if self.gathered.altered.iter().any(|altered| !altered.besides.is_empty()) {
            let lists = match self.candidates.take() {
                Some(lists) => lists,
                None => Box::new(self.find_candidates()),
            };
            for alteration in 0..2 {
                for facts in &self.gathered.altered[alteration].besides {
                    for made in Self::candidates_for(&lists, facts) {
                        if may_fit(&self.gathered.facts[made as usize], facts) {
                            mark(&mut reached[made as usize], alteration);
                        }
                    }
                }
            }
        }
        self.sizes.bytes = self.sets.iter().map(|set| set.len() * (size_of::<u32>() * 2 + size_of::<Cause>())).sum::<usize>() + self.verdicts.len() * 16 + self.is_tested.len() * 12;

        // Callee prediction. First by allocated layout and name: the functions whose closures the stores that are seen put there.
        let join = |callees: &mut FxHashMap<(u32, Atom), Callee>, place: (u32, Atom), callee: Callee| {
            let joined = callees.entry(place).or_default();
            *joined = joined.join(callee);
        };
        let mut held: FxHashMap<(u32, Atom), Callee> = FxHashMap::default();
        for &(made, name, callee) in &self.gathered.callees_at_birth {
            // A shape transition keeps what the fields hold.
            let (mut passed, mut pending) = (FxHashSet::default(), vec![made]);
            while let Some(layout) = pending.pop() {
                if passed.insert(layout) && reached.get(layout as usize).is_some_and(|reach| reach.is_allocated) {
                    join(&mut held, (layout, name), callee);
                    pending.extend_from_slice(&self.becomes[layout as usize]);
                }
            }
        }
        for &(view, name, callee) in &self.gathered.callees_stored {
            for &layout in self.sets[view as usize].iter().filter(|&&layout| (layout as usize) < views) {
                join(&mut held, (layout, name), callee);
            }
        }
        let mut held_by: Vec<Vec<(Atom, Callee)>> = vec![Vec::new(); views];
        for (&(layout, name), &callee) in &held {
            held_by[layout as usize].push((name, callee));
        }
        // The same for the facts, with what `Object.assign` and a spread copy from field to field.
        let mut known_by: Vec<FxHashMap<Atom, Callee>> = held_by.iter().map(|held| held.iter().copied().collect()).collect();
        let mut is_copied_into_blindly = vec![false; views];
        let copies = EscapeClosure::copies(&self.gathered.escapes, &self.gathered.index_of);
        loop {
            let mut has_grown = false;
            for &(source, target) in &copies {
                let targets: Vec<u32> = self.sets[target as usize].iter().copied().filter(|&layout| (layout as usize) < views).collect();
                let sources: &[u32] = source.map_or(&[], |source| &self.sets[source as usize]);
                let is_blind = source.is_none() || sources.iter().any(|&layout| (layout as usize) >= views || is_copied_into_blindly[layout as usize]);
                let read: Vec<(Atom, Callee)> = sources.iter().filter(|&&layout| (layout as usize) < views).flat_map(|&layout| known_by[layout as usize].iter().map(|(&name, &callee)| (name, callee))).collect();
                for layout in targets {
                    if is_blind && !std::mem::replace(&mut is_copied_into_blindly[layout as usize], true) {
                        has_grown = true;
                    }
                    for &(name, callee) in &read {
                        let joined = known_by[layout as usize].entry(name).or_default();
                        let both = joined.join(callee);
                        has_grown |= both != *joined;
                        *joined = both;
                    }
                }
            }
            if !has_grown {
                break;
            }
        }
        let unknown_callees: Vec<(u32, Place)> = (known_by.iter().enumerate()).filter_map(|(layout, known)| Some((layout as u32, known.values().filter_map(|&held| place_not_seen_through(held)).min()?))).collect();
        let admits_untyped: Vec<bool> = reached.iter().map(|reach| reach.admits_foreign).collect();
        let is_allocated: Vec<bool> = reached.iter().map(|reach| reach.is_allocated).collect();
        let fields = &self.gathered.fields;
        let held_by_fields = |view: u32| -> Vec<u32> { fields.of_views[view as usize].iter().flat_map(|&(_, ty)| fields.views_in[ty as usize].iter().copied()).collect() };
        let closure = EscapeClosure::close(
            &self.gathered.escapes,
            &ClosureInput { views, index_of: &self.gathered.index_of, sets: &self.sets, admits_untyped: &admits_untyped, is_allocated: &is_allocated, held_by_fields: &held_by_fields, types: let_through, unknown_callees: &unknown_callees },
        );
        // What a built-in may alter whose operand nothing is said of.
        let is_marked = |reach: &Reach, alteration: usize| reach.is_allocated && if alteration == 0 { reach.may_be_frozen } else { reach.may_have_other_prototype };
        let mut altered_by = [[0u32; 3]; 2];
        for alteration in 0..2 {
            let altered = &self.gathered.altered[alteration];
            altered_by[alteration][0] = reached.iter().filter(|reach| is_marked(reach, alteration)).count() as u32;
            for layout in (0..views).filter(|&layout| altered.is_anything || altered.is_untyped && closure.escaped[layout].is_some()) {
                mark(&mut reached[layout], alteration);
            }
            altered_by[alteration][1] = reached.iter().filter(|reach| is_marked(reach, alteration)).count() as u32;
            altered_by[alteration][2] = u32::from(altered.is_anything);
        }
        let (alteration_sites, untyped_alterations) = (self.gathered.escapes.alterations.sites(), self.gathered.escapes.alterations.untyped_places());
        let doubt_about = |layout: u32, name: Atom, callee: Callee| -> Option<Doubt> {
            if closure.escaped[layout as usize].is_some() {
                Some(Doubt::Escaped)
            } else if closure.is_open[layout as usize] || closure.open_fields.contains(&(layout, name)) {
                Some(Doubt::OpenedField)
            } else if is_copied_into_blindly[layout as usize] {
                Some(Doubt::CopiedBlindly)
            } else if closure.is_copied_into[layout as usize] {
                Some(Doubt::Retagged)
            } else if known_by[layout as usize].get(&name).is_some_and(|&known| known != Callee::Nothing && known != callee) {
                Some(Doubt::CopiedFromAnother)
            } else {
                None
            }
        };
        // Then by supertype: a read through it finds an object of any subtype.
        let mut callees_unresolved: Vec<(u32, Atom, Callee)> = Vec::new();
        for (view, reach) in reached.iter_mut().enumerate() {
            let mut read: FxHashMap<Atom, Callee> = FxHashMap::default();
            for &layout in &reach.members {
                for &(name, callee) in &held_by[layout as usize] {
                    let joined = read.entry(name).or_default();
                    *joined = joined.join(callee);
                }
            }
            for (name, callee) in read {
                match callee {
                    Callee::One(file, func) => {
                        let doubt = if reach.admits_foreign { Some(Doubt::AdmitsUntyped) } else { reach.members.iter().filter_map(|&layout| doubt_about(layout, name, callee)).min() };
                        reach.callees.push((name, file, func, doubt.map_or(Certainty::Fact, Certainty::Predicted)));
                    }
                    callee => callees_unresolved.push((view as u32, name, callee)),
                }
            }
            reach.callees.sort_unstable_by_key(|&(name, file, func, _)| (file, func, name.0));
        }
        self.say("the callees");
        self.gathered.creations.apply(&mut reached);
        self.gathered.constructions.apply(&mut reached, &self.gathered.facts, &self.becomes);
        let (escaped, escapes_by_door) = (closure.escaped, closure.by_door);
        Membership {
            views: reached,
            escaped,
            escapes_by_door,
            alteration_sites,
            altered_by,
            untyped_alterations,
            widest_alterations: self.gathered.escapes.alterations.widest(),
            doors: self.gathered.escapes.alterations.doors(),
            sizes: self.sizes,
            why_foreign,
            subtypes: self.sets,
            causes: self.causes,
            upcasts: self.gathered.upcasts,
            vouched: self.gathered.vouched,
            data_held_to: self.gathered.data_held_to,
            told_apart: self.told_apart,
            predictions: self.gathered.predictions,
            callee_holes: self.gathered.callee_holes,
            callees_unresolved,
        }
    }
}
