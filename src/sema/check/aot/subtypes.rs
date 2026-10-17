use super::callees::Callee;
use super::creation::IndexedCreations;
use super::escape_closure::Escapes;
use super::first_stores::IndexedConstructions;
use super::flows::{LayoutUsage, Membership, Place, SubtypeAnswer, SubtypeQuery, UntypedReason};
use crate::atom::Atom;
use crate::types::TypeId;
use crate::util::{FxHashMap, FxHashSet};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

pub(super) const HAS_SITE: u16 = 1;
pub(super) const IS_COPIED: u16 = 1 << 1;
pub(super) const HAS_CONSTANTS: u16 = 1 << 2;
pub(super) const IS_CONCRETE: u16 = 1 << 3;
pub(super) const IS_INSTANCE: u16 = 1 << 4;
pub(super) const IS_GENERIC: u16 = 1 << 5;
pub(super) const IS_COERCION_RESULT: u16 = 1 << 6;
pub(super) const IS_WEAK: u16 = 1 << 7;
pub(super) const HAS_INDEX_SIGNATURE: u16 = 1 << 8;
const HAS_CONCRETE_SUBTYPE: u16 = 1 << 9;
pub(super) const IS_FLAT: u16 = 1 << 10;
const IS_DISTINGUISHED: u16 = 1 << 11;
pub(super) const IS_FLAT_BUT_FOR_FUNCTIONS: u16 = 1 << 12;
pub(super) const MAY_LACK_CAPACITY: u16 = 1 << 13;
pub(super) const IS_PLAIN_DATA: u16 = 1 << 14;
pub(super) const IS_PLAIN_DATA_OR_FUNCTIONS: u16 = 1 << 15;

const MAX_CANDIDATES: usize = 4096;
const MAX_CANDIDATES_PER_CREATED_TYPE: usize = 4096;
const MANY_CANDIDATES: usize = 64;
const LARGE: usize = 8;
const MAX_STRUCTURAL_SUBTYPES: usize = 1024;
const BITSET_THRESHOLD: usize = 128;
const MAX_BITSET_WORDS: usize = 1 << 22;

const MAX_MEMBERSHIPS: usize = 50_000_000;
const MAX_PAIRS_MET: usize = 500_000_000;
const MAX_PAIRS_WAITING: usize = 100_000_000;
const MAX_QUERIES: usize = 30_000_000;
const MAX_TESTS: usize = 20_000_000;

#[derive(Default)]
pub(super) struct Facts {
    pub flags: u16,
    pub declared: Box<[u32]>,
    pub live: Box<[u32]>,
    pub required: Box<[u32]>,
    pub constants: Box<[(u32, u64)]>,
    pub open: Box<[u32]>,
    pub hidden: Box<[u32]>,
    pub declared_as_bits: u64,
    pub live_as_bits: u64,
    pub required_as_bits: u64,
    pub kind: &'static str,
}

impl Facts {
    pub(super) fn accepts_by_structure(&self) -> bool {
        self.flags & (IS_DISTINGUISHED | IS_INSTANCE) == 0
            && (self.flags & IS_FLAT != 0 || self.required.is_empty())
    }
}

#[derive(Clone)]
pub(super) struct Clock {
    is_verbose: bool,
    print_line: Option<fn(std::fmt::Arguments<'_>)>,
    started: Instant,
    last: Instant,
}

impl Clock {
    pub(super) fn new(print_line: Option<fn(std::fmt::Arguments<'_>)>) -> Clock {
        Clock {
            is_verbose: print_line.is_some(),
            print_line,
            started: Instant::now(),
            last: Instant::now(),
        }
    }

    pub(super) fn log_progress(&mut self, what: std::fmt::Arguments<'_>) {
        if let Some(print_line) = self.print_line {
            print_line(format_args!(
                "aot: progress: {:.1} s, {:.1} s since the last line: {what}",
                self.started.elapsed().as_secs_f64(),
                self.last.elapsed().as_secs_f64()
            ));
        }
        self.last = Instant::now();
    }
}

pub struct FieldTypes {
    pub fields_by_layout: Vec<Vec<(u32, u32)>>,
    pub static_field_types: Vec<u32>,
    pub layouts_in_type: Vec<Vec<u32>>,
    pub together: Vec<Vec<u32>>,
    pub unions_in_type: Vec<Vec<u32>>,
    pub copy_targets: Vec<u32>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Cause {
    Birth,
    Transition(u32),
    Declared(u32),
    Upcast(u32),
    Cast(u32),
    Accepted(u32),
    Converted(u32),
    Fit(u32),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Verdict {
    Asked(u32),
    Refused,
    Passes,
    Accepted,
    Becomes { fits: bool },
}

#[derive(Clone)]
struct Pair {
    member: u32,
    target: u32,
    from: u32,
    may_convert: bool,
    fits: u32,
    structural_fit: u32,
}

const NONE: u32 = u32::MAX;
const YES: u32 = u32::MAX - 1;
const NOT_KNOWN: u32 = u32::MAX - 2;
const FITS: u32 = u32::MAX - 1;
const OWN: u32 = 1 << 31;

#[derive(Clone)]
struct Candidates {
    by_name: FxHashMap<u32, Vec<u32>>,
    by_open: FxHashMap<u32, Vec<u32>>,
    by_constant: FxHashMap<(u32, u64), Vec<u32>>,
    without_names: Vec<u32>,
    large_by_name: FxHashMap<u32, Vec<u32>>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Phase {
    Flows,
    Completion,
}

#[derive(Default, Clone)]
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
    pub pairs_queried: usize,
    pub queries: usize,
    pub memberships: usize,
    pub largest: usize,
    pub structural_without_flow: usize,
    pub with_too_many_candidates: usize,
    pub accepting_untyped: usize,
    pub transitions: usize,
    pub bytes: usize,
    pub unknown_answers: usize,
}

impl Sizes {
    pub fn line(&self) -> String {
        format!(
            "{} views, {} allocated; edges: {} declared, {} upcasts, {} casts, {} tests, {} tests between field types; {} rounds, {} pairs met, {} asked about in {} questions; {} memberships, the largest set {}, {} listed transitions; {} fit without a flow; {} vouched targets have too many candidates; {} supertypes admit untyped objects; {} KB; {} answers not known",
            self.views,
            self.allocated,
            self.declared_edges,
            self.upcasts,
            self.casts,
            self.tests,
            self.field_tests,
            self.rounds,
            self.pairs_met,
            self.pairs_queried,
            self.queries,
            self.memberships,
            self.largest,
            self.transitions,
            self.structural_without_flow,
            self.with_too_many_candidates,
            self.accepting_untyped,
            self.bytes / 1024,
            self.unknown_answers
        )
    }
}

pub(super) struct Gathered {
    pub types: Vec<TypeId>,
    pub asked_as: Vec<TypeId>,
    pub facts: Vec<Facts>,
    pub declared: Vec<(u32, u32)>,
    pub upcasts: Vec<(u32, u32, Place)>,
    pub casts: Vec<(u32, u32)>,
    pub guards: Vec<(u32, u32)>,
    pub forced: Vec<(u32, u32)>,
    pub unverified_overload_results: Vec<(u32, u32)>,
    pub assignable_casts: Vec<(u32, u32)>,
    pub tests: Vec<(u32, u32)>,
    pub instantiations: Vec<Vec<u32>>,
    pub declaration_of: Vec<u32>,
    pub vouched: Vec<(u32, Place)>,
    pub untyped_inflow_sites: Vec<(u32, Place)>,
    pub untyped_inflow_pairs: Vec<(u32, u32)>,
    pub any_inflow_sites: Vec<(u32, Place)>,
    pub checked: Vec<(u32, Place)>,
    pub checked_by_path: [usize; 7],
    pub logs_type_errors: bool,
    pub logging_relaxation: LoggingRelaxation,
    pub accepting_when_strict: Vec<bool>,
    pub subtypes_when_strict: Vec<Vec<(u32, Cause)>>,
    pub conversions_when_strict: Vec<Vec<u32>>,
    pub kind_queries_retry: Vec<(SubtypeQuery, u32, UntypedReason)>,
    pub foreign: Vec<(u32, Option<TypeId>, UntypedReason)>,
    pub kind_queries: Vec<(SubtypeQuery, u32, UntypedReason)>,
    pub(super) altered: [MutatedTypes; 2],
    pub fields: FieldTypes,
    pub stored: FxHashSet<Atom>,
    pub callees_at_creation: Vec<(u32, Atom, Callee)>,
    pub callees_stored: Vec<(u32, Atom, Callee)>,
    pub creations: IndexedCreations,
    pub constructions: IndexedConstructions,
    pub escapes: Escapes,
}

pub(super) struct MutatedTypes {
    pub(super) views: Vec<u32>,
    pub(super) besides: Vec<Facts>,
    pub(super) is_untyped: bool,
    pub(super) is_any_layout: bool,
}

#[derive(Clone)]
pub struct Subtypes {
    gathered: Arc<Gathered>,
    flow_phase_snapshot: Option<Box<Subtypes>>,
    completes_structurally: bool,
    kind_queries: Vec<(SubtypeQuery, u32, UntypedReason)>,
    subtypes_by_flow: Vec<Vec<u32>>,
    nodes: u32,
    seen: Vec<TypeId>,
    sets: Vec<Vec<u32>>,
    causes: Vec<Vec<Cause>>,
    bits: Vec<Vec<u64>>,
    bitset_words_left: usize,
    holders: Vec<Vec<u32>>,
    becomes: Vec<Vec<u32>>,
    untested: Vec<Vec<(u32, u32)>>,
    tested: Vec<Vec<(u32, bool)>>,
    is_tested: FxHashSet<(u32, u32)>,
    recorded_tests: Vec<u32>,
    refused: Vec<Vec<u32>>,
    newly_rejected: Vec<Vec<u32>>,
    bases: Vec<Option<Box<[u32]>>>,
    verdicts: FxHashMap<(u32, u32), Verdict>,
    answered: FxHashMap<(bool, TypeId, TypeId), SubtypeAnswer>,
    kind_query_answers: Option<Vec<SubtypeAnswer>>,
    fresh: Vec<Vec<u32>>,
    queue: VecDeque<u32>,
    is_queued: Vec<bool>,
    met: Vec<(u32, u32, u32, bool)>,
    joined: Vec<(u32, u32)>,
    compared: FxHashSet<(u32, u32)>,
    candidates: Option<Box<Candidates>>,
    queried_first: FxHashMap<u32, Vec<u32>>,
    is_trusted: Vec<bool>,
    to_complete: Vec<(u32, Place)>,
    newly_accepting: Vec<u32>,
    is_accepting: Vec<bool>,
    has_bailed_out: Vec<bool>,
    is_reachable_from_untyped: Vec<bool>,
    escaped_layout_types: Option<Vec<u32>>,
    relaxes_if_rejected: FxHashSet<(u32, u32)>,
    shared_by_instantiations: FxHashSet<(u32, u32)>,
    acceptance_reasons: FxHashMap<(u32, u32), UntypedReason>,
    distinguished_from: Vec<Vec<u32>>,
    pairs: Vec<Pair>,
    queries: Vec<SubtypeQuery>,
    own_queries: Vec<SubtypeQuery>,
    phase: Phase,
    sizes: Sizes,
    clock: Clock,
    steps: usize,
    memberships: usize,
    refusals: usize,
    transitions: usize,
    over_budget: Option<&'static str>,
}

fn name_bloom_bits(names: &[u32]) -> u64 {
    names.iter().fold(0, |bits, name| {
        bits | 1 << (name.wrapping_mul(0x9E37_79B1) >> 26)
    })
}

fn is_subset(of: &[u32], within: &[u32]) -> bool {
    of.len() <= within.len() && of.iter().all(|name| within.binary_search(name).is_ok())
}

fn have_common_element(a: &[u32], b: &[u32]) -> bool {
    let (fewer, more) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    fewer.iter().any(|name| more.binary_search(name).is_ok())
}

fn constants_for_name(constants: &[(u32, u64)], name: u32) -> &[(u32, u64)] {
    let from = constants.partition_point(|entry| entry.0 < name);
    let len = constants[from..].partition_point(|entry| entry.0 == name);
    &constants[from..from + len]
}

fn may_be_assignable_to(created: &Facts, view: &Facts) -> bool {
    if view.flags & IS_COERCION_RESULT != 0 {
        return true;
    }
    if view.required_as_bits & !created.declared_as_bits != 0 {
        return false;
    }
    if !is_subset(&view.required, &created.declared)
        || (view.flags & IS_WEAK != 0
            && !view.declared.is_empty()
            && !created.declared.is_empty()
            && !have_common_element(&view.declared, &created.declared))
    {
        return false;
    }
    view.constants.chunk_by(|a, b| a.0 == b.0).all(|taken| {
        let name = taken[0].0;
        if created.declared.binary_search(&name).is_err() {
            return true;
        }
        let own = constants_for_name(&created.constants, name);
        if own.is_empty() {
            created.open.binary_search(&name).is_ok()
        } else {
            own.iter()
                .all(|constant| taken.binary_search(constant).is_ok())
        }
    })
}

fn may_match_by_constants(created: &Facts, view: &Facts) -> bool {
    if view.required_as_bits & !created.declared_as_bits != 0 {
        return false;
    }
    if !is_subset(&view.required, &created.declared)
        || (view.flags & IS_WEAK != 0
            && !view.declared.is_empty()
            && !created.declared.is_empty()
            && !have_common_element(&view.declared, &created.declared))
    {
        return false;
    }
    view.constants.chunk_by(|a, b| a.0 == b.0).all(|taken| {
        let own = constants_for_name(&created.constants, taken[0].0);
        own.is_empty()
            || own
                .iter()
                .any(|constant| taken.binary_search(constant).is_ok())
    })
}

const MAX_TYPES_RELAXED_TOGETHER: usize = 32;
const MAX_LIVE_FIELDS_TO_CONVERT: usize = 9;
const MAX_LIVE_FIELDS_TO_RELAX: usize = 6;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LoggingRelaxation {
    Nothing,
    AllExternalData,
    BoundedExternalData,
    BoundedUntyped,
}

impl Subtypes {
    pub(super) fn new(gathered: Gathered, clock: Clock) -> Subtypes {
        Subtypes::new_run(gathered, clock, false, FxHashMap::default(), None)
    }

    pub fn restart(mut self) -> Subtypes {
        let subtypes_by_flow = self
            .sets
            .iter()
            .map(|set| set[..set.partition_point(|&member| member < self.nodes)].to_vec())
            .collect();
        if let Some(mut resumed) = self.flow_phase_snapshot.take() {
            drop(self.gathered);
            if resumed.gathered.logs_type_errors {
                resumed.gathered_mut().kind_queries_retry = self.kind_queries;
            }
            resumed.completes_structurally = true;
            resumed.kind_queries = Vec::new();
            resumed.answered = self.answered;
            resumed.kind_query_answers = self.kind_query_answers;
            resumed.clock = self.clock;
            resumed.subtypes_by_flow = subtypes_by_flow;
            resumed.settle();
            return *resumed;
        }
        let mut gathered = Self::into_gathered(self.gathered);
        gathered.kind_queries = self.kind_queries;
        if gathered.logs_type_errors {
            gathered
                .kind_queries_retry
                .clone_from(&gathered.kind_queries);
        }
        let mut again = Subtypes::new_run(
            gathered,
            self.clock,
            true,
            self.answered,
            self.kind_query_answers,
        );
        again.subtypes_by_flow = subtypes_by_flow;
        again
    }

    pub fn logs_type_errors(&self) -> bool {
        self.gathered.logs_type_errors
    }

    pub fn has_relaxed_too_much_for_logging(&self) -> bool {
        let admitting = |list: &[bool]| list.iter().filter(|&&is_accepting| is_accepting).count();
        self.gathered.logging_relaxation != LoggingRelaxation::Nothing
            && admitting(&self.is_accepting)
                > admitting(&self.gathered.accepting_when_strict)
                    + (self.nodes as usize / 8).max(128)
    }

    pub fn explain_logging_relaxation(&self) -> String {
        let admitting = |list: &[bool]| list.iter().filter(|&&is_accepting| is_accepting).count();
        format!(
            "given: for the log: {:?}: {} views admit strangers, {} as a throw build has them, of {}; {} come from outside, {} are untyped; checks by road: untyped, call, construction, free name, caught or resumed, receiver, parameter: {:?}: {}",
            self.gathered.logging_relaxation,
            admitting(&self.is_accepting),
            admitting(&self.gathered.accepting_when_strict),
            self.nodes,
            self.gathered.checked.len(),
            self.gathered.untyped_inflow_sites.len(),
            self.gathered.checked_by_path,
            if self.has_relaxed_too_much_for_logging() {
                "too many"
            } else {
                "kept"
            }
        )
    }

    pub fn restart_final_run(self, opens: LoggingRelaxation) -> Subtypes {
        let (subtypes_by_flow, mut gathered) =
            (self.subtypes_by_flow, Self::into_gathered(self.gathered));
        if gathered.logging_relaxation == LoggingRelaxation::Nothing {
            gathered.accepting_when_strict = self.is_accepting;
            let nodes = self.nodes;
            gathered.subtypes_when_strict = (self.sets.iter().zip(&self.causes))
                .map(|(set, causes)| {
                    set.iter()
                        .copied()
                        .zip(causes.iter().copied())
                        .take_while(|member| member.0 < nodes)
                        .collect()
                })
                .collect();
            gathered.conversions_when_strict = self.becomes;
        }
        gathered.logging_relaxation = opens;
        gathered
            .kind_queries
            .clone_from(&gathered.kind_queries_retry);
        let mut again = Subtypes::new_run(
            gathered,
            self.clock,
            true,
            self.answered,
            self.kind_query_answers,
        );
        again.subtypes_by_flow = subtypes_by_flow;
        again
    }

    fn into_gathered(gathered: Arc<Gathered>) -> Gathered {
        Arc::into_inner(gathered).expect("a finished run is the only owner of its inputs")
    }

    fn gathered_mut(&mut self) -> &mut Gathered {
        Arc::get_mut(&mut self.gathered)
            .expect("a run changes its inputs only before its snapshot is taken")
    }

    fn new_run(
        mut gathered: Gathered,
        clock: Clock,
        completes_structurally: bool,
        answered: FxHashMap<(bool, TypeId, TypeId), SubtypeAnswer>,
        kind_query_answers: Option<Vec<SubtypeAnswer>>,
    ) -> Subtypes {
        for facts in gathered.facts.iter_mut() {
            (
                facts.declared_as_bits,
                facts.live_as_bits,
                facts.required_as_bits,
            ) = (
                name_bloom_bits(&facts.declared),
                name_bloom_bits(&facts.live),
                name_bloom_bits(&facts.required),
            );
        }
        let nodes = gathered.types.len();
        let kind_queries = if completes_structurally {
            Vec::new()
        } else {
            gathered.kind_queries.clone()
        };
        let mut seen: Vec<TypeId> = gathered
            .foreign
            .iter()
            .filter_map(|accept_untyped| accept_untyped.1)
            .collect();
        seen.sort_unstable_by_key(|ty| ty.0);
        seen.dedup();
        let all = nodes + 1 + seen.len() + 2;
        let mut subtypes = Subtypes {
            nodes: nodes as u32,
            seen,
            sets: vec![Vec::new(); nodes],
            causes: vec![Vec::new(); nodes],
            bits: vec![Vec::new(); nodes],
            bitset_words_left: MAX_BITSET_WORDS,
            holders: vec![Vec::new(); all],
            becomes: vec![Vec::new(); nodes],
            untested: vec![Vec::new(); nodes],
            tested: vec![Vec::new(); nodes],
            is_tested: FxHashSet::default(),
            recorded_tests: vec![0; nodes],
            refused: vec![Vec::new(); nodes],
            newly_rejected: vec![Vec::new(); nodes],
            bases: (0..nodes).map(|_| None).collect(),
            verdicts: FxHashMap::default(),
            answered,
            kind_query_answers,
            fresh: vec![Vec::new(); nodes],
            queue: VecDeque::new(),
            is_queued: vec![false; nodes],
            met: Vec::new(),
            joined: Vec::new(),
            compared: FxHashSet::default(),
            candidates: None,
            queried_first: FxHashMap::default(),
            is_trusted: vec![false; nodes],
            to_complete: Vec::new(),
            newly_accepting: Vec::new(),
            is_accepting: vec![false; nodes],
            has_bailed_out: vec![false; nodes],
            is_reachable_from_untyped: vec![false; nodes],
            escaped_layout_types: None,
            relaxes_if_rejected: FxHashSet::default(),
            shared_by_instantiations: FxHashSet::default(),
            acceptance_reasons: FxHashMap::default(),
            distinguished_from: Vec::new(),
            pairs: Vec::new(),
            queries: Vec::new(),
            own_queries: Vec::new(),
            phase: Phase::Flows,
            sizes: Sizes::default(),
            clock,
            steps: 0,
            memberships: 0,
            refusals: 0,
            transitions: 0,
            over_budget: None,
            gathered: Arc::new(gathered),
            flow_phase_snapshot: None,
            completes_structurally,
            kind_queries,
            subtypes_by_flow: Vec::new(),
        };
        subtypes.begin();
        subtypes
    }

    fn begin(&mut self) {
        self.sizes.views = self.gathered.types.len();
        self.sizes.declared_edges = self.gathered.declared.len();
        self.sizes.upcasts = self.gathered.upcasts.len();
        self.propagate_casts_to_fields();
        self.sizes.casts = self.gathered.casts.len();
        self.sizes.tests = self.gathered.tests.len();
        for &(from, to) in &self.gathered.declared {
            self.untested[from as usize].push((to, NONE));
        }
        for (number, &(from, to, _)) in self.gathered.upcasts.iter().enumerate() {
            self.untested[from as usize].push((to, number as u32));
        }
        for (edges, may_convert) in [(&self.gathered.casts, true), (&self.gathered.tests, false)] {
            for &(from, to) in edges {
                if self.is_tested.insert((from, to)) {
                    self.tested[from as usize].push((to, may_convert));
                    self.recorded_tests[from as usize] += 1;
                }
            }
        }
        let mut pending: Vec<u32> = (0..self.nodes)
            .filter(|&view| self.gathered.facts[view as usize].flags & IS_CONCRETE != 0)
            .collect();
        while let Some(view) = pending.pop() {
            for at in 0..self.untested[view as usize].len() {
                let (supertype, number) = self.untested[view as usize][at];
                let flags = &mut self.gathered_mut().facts[supertype as usize].flags;
                if number == NONE && *flags & HAS_CONCRETE_SUBTYPE == 0 {
                    *flags |= HAS_CONCRETE_SUBTYPE;
                    pending.push(supertype);
                }
            }
        }
        self.mark_distinguished_layouts();
        for view in 0..self.nodes {
            if self.gathered.facts[view as usize].flags & (HAS_SITE | IS_COPIED) != 0 {
                self.insert(view, view, Cause::Birth);
            }
        }
        for at in 0..self.gathered.foreign.len() {
            let (view, source, why) = self.gathered.foreign[at];
            let stranger = match source {
                Some(source) => {
                    self.nodes
                        + 1
                        + self
                            .seen
                            .binary_search_by_key(&source.0, |ty| ty.0)
                            .unwrap_or(0) as u32
                }
                None => self.nodes,
            };
            self.accept_untyped(view, stranger, why);
            self.accept_relaxed(view, why);
        }
        for at in 0..self.gathered.vouched.len() {
            let (target, place) = self.gathered.vouched[at];
            self.accept_by_structure(target, place);
        }
        for at in 0..self.gathered.untyped_inflow_sites.len() {
            let (view, place) = self.gathered.untyped_inflow_sites[at];
            if self.flags(view) & (IS_FLAT_BUT_FOR_FUNCTIONS | IS_COERCION_RESULT)
                == IS_FLAT_BUT_FOR_FUNCTIONS
            {
                self.accept_untyped(view, self.nodes, UntypedReason::Flat { at: place });
            }
            if self.flags(view) & (HAS_INDEX_SIGNATURE | IS_INSTANCE) == HAS_INDEX_SIGNATURE {
                self.accept_untyped(view, self.nodes, UntypedReason::Dictionary { at: place });
            }
        }
        const UNTYPED_INFLOW: u8 = 0;
        const MEMBER_OF_RELAXED: u8 = 1;
        const UNION_SIBLING: u8 = 2;
        let mut unions_of: Vec<Vec<u32>> = vec![Vec::new(); self.nodes as usize];
        for (union, arms) in self.gathered.fields.together.iter().enumerate() {
            for &arm in arms {
                unions_of[arm as usize].push(union as u32);
            }
        }
        let mut pending: Vec<(u32, Place, u8)> = self
            .gathered
            .untyped_inflow_sites
            .iter()
            .map(|&(view, place)| (view, place, UNTYPED_INFLOW))
            .collect();
        let mut seen: FxHashSet<(u32, u8)> = pending
            .iter()
            .map(|entry| (entry.0, UNTYPED_INFLOW))
            .collect();
        let mut holds_untyped_values = vec![false; self.gathered.fields.together.len()];
        let mut opened_at: Vec<Option<Place>> = vec![None; self.nodes as usize];
        while let Some((view, place, reason)) = pending.pop() {
            let flags = self.flags(view);
            if flags & (IS_INSTANCE | IS_COERCION_RESULT) != 0 {
                continue;
            }
            let mut is_open = flags & MAY_LACK_CAPACITY != 0
                || reason == MEMBER_OF_RELAXED && flags & IS_PLAIN_DATA != 0
                || reason == UNION_SIBLING;
            if is_open {
                self.accept_untyped(
                    view,
                    self.nodes,
                    UntypedReason::MayLackCapacity { at: place },
                );
                opened_at[view as usize].get_or_insert(place);
                let together = &self.gathered.untyped_inflow_pairs;
                for &(_, arm) in &together[together.partition_point(|pair| pair.0 < view)
                    ..together.partition_point(|pair| pair.0 <= view)]
                {
                    if seen.insert((arm, UNION_SIBLING)) {
                        pending.push((arm, place, UNION_SIBLING));
                    }
                }
                for &union in unions_of[view as usize]
                    .iter()
                    .filter(|&&union| holds_untyped_values[union as usize])
                {
                    for &arm in &self.gathered.fields.together[union as usize] {
                        if seen.insert((arm, UNION_SIBLING)) {
                            pending.push((arm, place, UNION_SIBLING));
                        }
                    }
                }
            }
            is_open |= flags & IS_PLAIN_DATA != 0
                && self.sets[view as usize].binary_search(&self.nodes).is_ok();
            let member_reason = if is_open {
                MEMBER_OF_RELAXED
            } else {
                UNTYPED_INFLOW
            };
            let fields = &self.gathered.fields;
            for &(_, of_field) in &fields.fields_by_layout[view as usize] {
                for &member in &fields.layouts_in_type[of_field as usize] {
                    if seen.insert((member, member_reason)) {
                        pending.push((member, place, member_reason));
                    }
                }
                for &union in &fields.unions_in_type[of_field as usize] {
                    if std::mem::replace(&mut holds_untyped_values[union as usize], true) {
                        continue;
                    }
                    let arms = &fields.together[union as usize];
                    if let Some(opened) = arms.iter().find_map(|&arm| opened_at[arm as usize]) {
                        for &arm in arms {
                            if seen.insert((arm, UNION_SIBLING)) {
                                pending.push((arm, opened, UNION_SIBLING));
                            }
                        }
                    }
                }
            }
        }
        let mut pending: Vec<u32> = self
            .gathered
            .untyped_inflow_sites
            .iter()
            .map(|held| held.0)
            .collect();
        while let Some(view) = pending.pop() {
            if self.flags(view) & (IS_INSTANCE | IS_COERCION_RESULT) != 0
                || std::mem::replace(&mut self.is_reachable_from_untyped[view as usize], true)
            {
                continue;
            }
            let fields = &self.gathered.fields;
            pending.extend(
                fields.fields_by_layout[view as usize]
                    .iter()
                    .flat_map(|field| fields.layouts_in_type[field.1 as usize].iter().copied()),
            );
        }
        self.accept_records_of_other_layouts();
        if self.gathered.logging_relaxation != LoggingRelaxation::Nothing {
            self.relax_for_logging();
        }
        if self.kind_query_answers.is_none() {
            self.queries
                .extend(self.gathered.kind_queries.iter().map(|about| about.0));
        }
        self.settle();
    }

    fn propagate_casts_to_fields(&mut self) {
        let is_record = |view: u32| {
            self.gathered.facts[view as usize].flags & (IS_INSTANCE | IS_COERCION_RESULT) == 0
        };
        let mut pending: Vec<(u32, u32)> = self
            .gathered
            .casts
            .iter()
            .copied()
            .filter(|cast| {
                self.gathered.guards.binary_search(cast).is_err()
                    && is_record(cast.0)
                    && is_record(cast.1)
            })
            .collect();
        let mut is_known: FxHashSet<(u32, u32)> = self.gathered.casts.iter().copied().collect();
        let mut below = Vec::new();
        let mut nested_casts: FxHashSet<(u32, u32)> = FxHashSet::default();
        let fields = &self.gathered.fields;
        while let Some((from, to)) = pending.pop() {
            let (mut at, mut other) = (0, 0);
            while let (Some(&(name, ty)), Some(&(same, as_ty))) = (
                fields.fields_by_layout[from as usize].get(at),
                fields.fields_by_layout[to as usize].get(other),
            ) {
                at += usize::from(name <= same);
                other += usize::from(same <= name);
                if name != same || ty == as_ty {
                    continue;
                }
                for &held in &fields.layouts_in_type[ty as usize] {
                    for &slot_type in &fields.layouts_in_type[as_ty as usize] {
                        if held != slot_type
                            && is_record(held)
                            && is_record(slot_type)
                            && nested_casts.insert((held, slot_type))
                        {
                            pending.push((held, slot_type));
                            if is_known.insert((held, slot_type)) {
                                below.push((held, slot_type));
                            }
                        }
                    }
                }
            }
        }
        let opening: Vec<(u32, u32)> = nested_casts
            .into_iter()
            .filter(|cast| self.is_small_or_data(cast.0, cast.1, MAX_LIVE_FIELDS_TO_RELAX))
            .collect();
        self.relaxes_if_rejected.extend(opening);
        if !below.is_empty() {
            let casts = &mut self.gathered_mut().casts;
            casts.extend(below);
            casts.sort_unstable();
        }
    }

    fn logging_untyped_node(&self) -> u32 {
        self.nodes + 1 + self.seen.len() as u32
    }

    fn other_layout_record_node(&self) -> u32 {
        self.logging_untyped_node() + 1
    }

    fn relax_for_logging(&mut self) {
        let stage = self.gathered.logging_relaxation;
        let mut candidates = self.gathered.untyped_inflow_sites.clone();
        if stage != LoggingRelaxation::BoundedUntyped {
            candidates.extend_from_slice(&self.gathered.checked);
        }
        for (view, place) in candidates {
            if self.gathered.accepting_when_strict[view as usize]
                || self.flags(view) & IS_COERCION_RESULT != 0
            {
                continue;
            }
            if stage == LoggingRelaxation::AllExternalData
                || self
                    .types_relaxed_with(view, MAX_TYPES_RELAXED_TOGETHER)
                    .is_some()
            {
                self.accept_untyped(
                    view,
                    self.logging_untyped_node(),
                    UntypedReason::ForLogging { at: place },
                );
            }
        }
    }

    fn types_relaxed_with(&self, view: u32, maximum: usize) -> Option<usize> {
        let fields = &self.gathered.fields;
        let (mut reached, mut is_reached) = (vec![view], FxHashSet::default());
        is_reached.insert(view);
        let mut at = 0;
        while at < reached.len() {
            let from = reached[at] as usize;
            at += 1;
            let onward =
                (self.untested[from].iter().map(|edge| edge.0))
                    .chain(self.tested[from].iter().map(|edge| edge.0))
                    .chain(fields.fields_by_layout[from].iter().flat_map(|field| {
                        fields.layouts_in_type[field.1 as usize].iter().copied()
                    }));
            for to in onward {
                if !self.gathered.accepting_when_strict[to as usize] && is_reached.insert(to) {
                    reached.push(to);
                    if reached.len() > maximum {
                        return None;
                    }
                }
            }
        }
        Some(reached.len())
    }

    fn mark_distinguished_layouts(&mut self) {
        let nodes = self.nodes as usize;
        let (mut upcast_from, mut cast_from, mut beside): (
            Vec<Vec<u32>>,
            Vec<Vec<u32>>,
            Vec<Vec<u32>>,
        ) = (
            vec![Vec::new(); nodes],
            vec![Vec::new(); nodes],
            vec![Vec::new(); nodes],
        );
        for from in 0..nodes {
            for &(to, _) in &self.untested[from] {
                upcast_from[to as usize].push(from as u32);
            }
            for &(to, may_convert) in &self.tested[from] {
                if !may_convert
                    || self
                        .gathered
                        .guards
                        .binary_search(&(from as u32, to))
                        .is_ok()
                {
                    cast_from[to as usize].push(from as u32);
                }
            }
        }
        let fields = &self.gathered.fields;
        let of_copy_targets = (self.gathered.facts.iter().zip(&fields.fields_by_layout))
            .filter(|(facts, _)| facts.flags & IS_COPIED != 0)
            .flat_map(|(_, layout_entry)| layout_entry.iter().map(|field| field.1));
        let mut is_checked_plain_data = vec![false; fields.together.len()];
        for ty in fields.copy_targets.iter().copied().chain(of_copy_targets) {
            for &number in &fields.unions_in_type[ty as usize] {
                is_checked_plain_data[number as usize] = true;
            }
        }
        for (number, together) in fields
            .together
            .iter()
            .enumerate()
            .filter(|&(number, _)| is_checked_plain_data[number])
        {
            for &view in together {
                beside[view as usize].push(number as u32);
            }
        }
        let mut must_be_allocated: Vec<bool> = self
            .gathered
            .facts
            .iter()
            .map(|facts| {
                facts.flags & (IS_COERCION_RESULT | IS_INSTANCE) == 0
                    && !facts.accepts_by_structure()
            })
            .collect();
        let mut accepts_any_object = vec![false; nodes];
        let mut inheriting: Vec<u32> = self
            .gathered
            .foreign
            .iter()
            .map(|accept_untyped| accept_untyped.0)
            .collect();
        while let Some(view) = inheriting.pop() {
            if !std::mem::replace(&mut accepts_any_object[view as usize], true) {
                must_be_allocated[view as usize] = false;
                inheriting.extend(self.untested[view as usize].iter().map(|edge| edge.0));
            }
        }
        let mut pending: Vec<u32> = (0..self.nodes)
            .filter(|&view| must_be_allocated[view as usize])
            .collect();
        while let Some(created) = pending.pop() {
            let mut distinguished_from_it: Vec<u32> = cast_from[created as usize].clone();
            if self.flags(created) & IS_DISTINGUISHED != 0 {
                distinguished_from_it.extend_from_slice(&upcast_from[created as usize]);
            }
            for &number in &beside[created as usize] {
                distinguished_from_it
                    .extend_from_slice(&self.gathered.fields.together[number as usize]);
            }
            for other in distinguished_from_it {
                let facts = &mut self.gathered_mut().facts[other as usize];
                if !accepts_any_object[other as usize] {
                    facts.flags &= !IS_FLAT_BUT_FOR_FUNCTIONS;
                }
                if facts.accepts_by_structure() && !accepts_any_object[other as usize] {
                    facts.flags = (facts.flags & !IS_FLAT) | IS_DISTINGUISHED;
                    pending.push(other);
                }
            }
        }
        let mut distinguished_from: Vec<Vec<u32>> = vec![Vec::new(); nodes];
        for created in 0..nodes {
            let union_siblings = beside[created].iter().flat_map(|&number| {
                self.gathered.fields.together[number as usize]
                    .iter()
                    .copied()
            });
            for other in cast_from[created]
                .iter()
                .copied()
                .chain(union_siblings)
                .filter(|&other| other as usize != created)
            {
                distinguished_from[other as usize].push(created as u32);
            }
        }
        self.distinguished_from = distinguished_from;
    }

    pub fn queries(&self) -> &[SubtypeQuery] {
        &self.queries
    }

    pub fn own_queries(&self) -> &[SubtypeQuery] {
        &self.own_queries
    }

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

    fn may_satisfy_unverified_overload_result(&self, member: u32, from: u32, to: u32) -> bool {
        member == from
            && self
                .gathered
                .unverified_overload_results
                .binary_search(&(from, to))
                .is_ok()
            && may_match_by_constants(
                &self.gathered.facts[member as usize],
                &self.gathered.facts[to as usize],
            )
    }

    fn accepts_untyped(&self, view: u32) -> bool {
        self.is_accepting[view as usize]
    }

    fn accept_untyped(&mut self, view: u32, stranger: u32, why: UntypedReason) {
        if self.insert(view, stranger, Cause::Birth) {
            self.acceptance_reasons.insert((view, stranger), why);
        }
    }

    fn accept_relaxed(&mut self, view: u32, why: UntypedReason) {
        if matches!(why, UntypedReason::UnretainedExternalData { .. }) {
            self.accept_in_subtypes(view, why);
        }
    }

    fn accept_in_subtypes(&mut self, view: u32, why: UntypedReason) {
        let mut reached = vec![view];
        while let Some(above) = reached.pop() {
            let fields = &self.gathered.fields;
            let below: Vec<u32> = fields.fields_by_layout[above as usize]
                .iter()
                .flat_map(|field| fields.layouts_in_type[field.1 as usize].iter().copied())
                .collect();
            for view in below {
                if self.insert(view, self.nodes, Cause::Birth) {
                    self.acceptance_reasons.insert((view, self.nodes), why);
                    reached.push(view);
                }
            }
        }
    }

    fn records_relaxed_with(&self, view: u32) -> Option<Vec<u32>> {
        let is_closed_record = |view: u32| {
            self.flags(view) & (IS_INSTANCE | IS_COERCION_RESULT) == 0
                && !self.is_accepting[view as usize]
        };
        if !is_closed_record(view) {
            return None;
        }
        let fields = &self.gathered.fields;
        let (mut group, mut is_in_group) = (vec![view], FxHashSet::default());
        is_in_group.insert(view);
        let mut at = 0;
        while at < group.len() {
            let from = group[at] as usize;
            at += 1;
            let supertypes = self.untested[from].iter().map(|edge| edge.0);
            let subtype_layouts = fields.fields_by_layout[from]
                .iter()
                .flat_map(|field| fields.layouts_in_type[field.1 as usize].iter().copied());
            for to in supertypes
                .chain(subtype_layouts)
                .chain(self.distinguished_from[from].iter().copied())
            {
                if is_closed_record(to) && is_in_group.insert(to) {
                    group.push(to);
                    if group.len() > MAX_TYPES_RELAXED_TOGETHER {
                        return None;
                    }
                }
            }
        }
        Some(group)
    }

    fn accept_records_of_other_layouts(&mut self) {
        let is_record = |flags: u16| flags & (IS_INSTANCE | IS_COERCION_RESULT) == 0;
        let is_plain_record =
            |flags: u16| is_record(flags) && flags & IS_PLAIN_DATA_OR_FUNCTIONS != 0;
        let mut inflow_at: Vec<Option<Place>> = vec![None; self.nodes as usize];
        let mut pending: Vec<u32> = Vec::new();
        for &(view, place) in &self.gathered.any_inflow_sites {
            if let Some(group) = self.records_relaxed_with(view) {
                for view in group {
                    inflow_at[view as usize].get_or_insert(place);
                }
            } else if is_plain_record(self.flags(view)) && inflow_at[view as usize].is_none() {
                inflow_at[view as usize] = Some(place);
                pending.push(view);
            }
        }
        let fields = &self.gathered.fields;
        let subtype_layouts = |view: u32| {
            fields.fields_by_layout[view as usize]
                .iter()
                .flat_map(|field| fields.layouts_in_type[field.1 as usize].iter().copied())
        };
        while let Some(outer) = pending.pop() {
            for view in subtype_layouts(outer) {
                if is_plain_record(self.flags(view)) && inflow_at[view as usize].is_none() {
                    inflow_at[view as usize] = inflow_at[outer as usize];
                    pending.push(view);
                }
            }
        }
        loop {
            let stays_closed = |view: u32| {
                inflow_at[view as usize].is_none()
                    && is_record(self.flags(view))
                    && !self.is_accepting[view as usize]
            };
            let is_distinguished_from_closed = |view: u32| {
                self.distinguished_from[view as usize].iter().any(|&other| {
                    stays_closed(other)
                        && !self.gathered.facts[other as usize].accepts_by_structure()
                })
            };
            let mut excluded: Vec<u32> = Vec::new();
            for view in (0..self.nodes).filter(|&view| inflow_at[view as usize].is_some()) {
                let (mut supertypes, mut visited) = (vec![view], FxHashSet::default());
                let mut is_excluded = subtype_layouts(view).any(stays_closed);
                while let Some(at) = supertypes.pop().filter(|_| !is_excluded) {
                    is_excluded = is_distinguished_from_closed(at);
                    supertypes.extend(self.untested[at as usize].iter().map(|edge| edge.0).filter(
                        |&supertype| {
                            !self.is_accepting[supertype as usize] && visited.insert(supertype)
                        },
                    ));
                }
                if is_excluded {
                    excluded.push(view);
                }
            }
            if excluded.is_empty() {
                break;
            }
            for view in excluded {
                inflow_at[view as usize] = None;
            }
        }
        let stranger = self.other_layout_record_node();
        for view in 0..self.nodes {
            if let Some(at) = inflow_at[view as usize] {
                self.accept_untyped(view, stranger, UntypedReason::AnotherLayout { at });
            }
        }
    }

    fn accept_by_structure(&mut self, target: u32, at: Place) -> bool {
        let facts = &self.gathered.facts[target as usize];
        if facts.flags & IS_COERCION_RESULT != 0
            || !facts.required.is_empty()
            || !facts.accepts_by_structure()
        {
            return false;
        }
        self.accept_untyped(target, self.nodes, UntypedReason::Weak { at });
        true
    }

    fn insert(&mut self, view: u32, member: u32, cause: Cause) -> bool {
        if self.over_budget.is_some() || self.bitset_contains(view, member) == Some(true) {
            return false;
        }
        let Err(at) = self.sets[view as usize].binary_search(&member) else {
            return false;
        };
        self.sets[view as usize].insert(at, member);
        self.causes[view as usize].insert(at, cause);
        self.bitset_insert(view, &[member]);
        self.follow(view, member);
        true
    }

    #[inline]
    fn bitset_contains(&self, view: u32, member: u32) -> Option<bool> {
        let bits = &self.bits[view as usize];
        (member < self.nodes && !bits.is_empty())
            .then(|| bits[(member / 64) as usize] >> (member % 64) & 1 != 0)
    }

    fn bitset_insert(&mut self, view: u32, new: &[u32]) {
        let nodes = self.nodes;
        let set_in = |bits: &mut [u64], members: &[u32]| {
            for &member in members.iter().take_while(|&&member| member < nodes) {
                bits[(member / 64) as usize] |= 1 << (member % 64);
            }
        };
        if !self.bits[view as usize].is_empty() {
            return set_in(&mut self.bits[view as usize], new);
        }
        let words = (nodes as usize).div_ceil(64);
        if self.sets[view as usize].len() < BITSET_THRESHOLD || self.bitset_words_left < words {
            return;
        }
        self.bitset_words_left -= words;
        let mut bits = vec![0u64; words];
        set_in(&mut bits, &self.sets[view as usize]);
        self.bits[view as usize] = bits;
    }

    fn filter_new_members(&self, target: u32, members: &[u32], as_bits: &[u64]) -> Vec<u32> {
        let has = &self.bits[target as usize];
        if has.is_empty() {
            let set = &self.sets[target as usize];
            return members
                .iter()
                .copied()
                .filter(|member| set.binary_search(member).is_err())
                .collect();
        }
        if as_bits.is_empty() || as_bits.len() > members.len() * 4 {
            return members
                .iter()
                .copied()
                .filter(|&member| has[(member / 64) as usize] >> (member % 64) & 1 == 0)
                .collect();
        }
        let mut new = Vec::new();
        for (word, (&brought, &held)) in as_bits.iter().zip(has.iter()).enumerate() {
            let mut left = brought & !held;
            while left != 0 {
                new.push(word as u32 * 64 + left.trailing_zeros());
                left &= left - 1;
            }
        }
        new
    }

    fn insert_all(&mut self, view: u32, members: &[u32], cause: Cause) {
        let set = &self.sets[view as usize];
        let new: Vec<u32> = if members.len() * 8 < set.len() {
            members
                .iter()
                .copied()
                .filter(|member| set.binary_search(member).is_err())
                .collect()
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
        self.insert_new(view, new, cause);
    }

    fn insert_new(&mut self, view: u32, new: Vec<u32>, cause: Cause) {
        if new.len() < 4 {
            for member in new {
                self.insert(view, member, cause);
            }
            return;
        }
        if self.over_budget.is_some() {
            return;
        }
        let (old, old_causes) = (
            std::mem::take(&mut self.sets[view as usize]),
            std::mem::take(&mut self.causes[view as usize]),
        );
        let (mut set, mut causes) = (
            Vec::with_capacity(old.len() + new.len()),
            Vec::with_capacity(old.len() + new.len()),
        );
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
        self.bitset_insert(view, &new);
        for &member in &new {
            self.follow(view, member);
        }
    }

    fn follow(&mut self, view: u32, member: u32) {
        self.memberships += 1;
        self.tick(1);
        self.holders[member as usize].push(view);
        self.fresh[view as usize].push(member);
        if !std::mem::replace(&mut self.is_queued[view as usize], true) {
            self.queue.push_back(view);
        }
        if member >= self.nodes {
            if member != self.logging_untyped_node() {
                let kept = if member == self.nodes {
                    self.other_layout_record_node()
                } else {
                    member
                };
                let casts = &self.gathered.assignable_casts;
                for &(_, wider) in &casts[casts.partition_point(|cast| cast.0 < view)
                    ..casts.partition_point(|cast| cast.0 <= view)]
                {
                    self.met.push((kept, view, wider, false));
                }
            }
            if member != self.other_layout_record_node()
                && !std::mem::replace(&mut self.is_accepting[view as usize], true)
            {
                self.newly_accepting.push(view);
            }
            let declaration = self.gathered.declaration_of[view as usize];
            if declaration != NONE
                && member != self.nodes
                && member != self.logging_untyped_node()
                && self.shared_by_instantiations.insert((declaration, member))
            {
                for &other in self.gathered.instantiations[declaration as usize]
                    .iter()
                    .filter(|&&other| other != view)
                {
                    self.met.push((member, view, other, false));
                }
            }
            return;
        }
        if member != view {
            self.joined.push((member, view));
        }
        for at in 0..self.becomes[member as usize].len() {
            let becomes = self.becomes[member as usize][at];
            self.insert(view, becomes, Cause::Converted(member));
        }
    }

    fn tick(&mut self, steps: usize) {
        self.steps += steps;
        if self.steps < 1 << 20 || self.over_budget.is_some() {
            return;
        }
        self.steps = 0;
        let tables = [
            (
                self.memberships > MAX_MEMBERSHIPS,
                "the number of memberships",
            ),
            (
                self.sizes.pairs_met > MAX_PAIRS_MET,
                "the number of pairs met",
            ),
            (
                self.met.len() > MAX_PAIRS_WAITING,
                "the number of pairs that wait",
            ),
            (self.sizes.queries > MAX_QUERIES, "the number of questions"),
            (self.is_tested.len() > MAX_TESTS, "the number of tests"),
        ];
        self.over_budget = tables
            .into_iter()
            .find(|table| table.0)
            .map(|table| table.1);
        if self.clock.last.elapsed().as_secs() >= 2 {
            self.log_progress("on the way");
        }
    }

    pub fn is_over_budget(&self) -> Option<&'static str> {
        self.over_budget
    }

    pub fn log_progress(&mut self, step: &str) {
        if !self.clock.is_verbose {
            return;
        }
        const MB: usize = 1 << 20;
        let largest = self.sets.iter().map(Vec::len).max().unwrap_or(0);
        let pending_rejections: usize = self.newly_rejected.iter().map(Vec::len).sum();
        self.clock.log_progress(format_args!(
            "{step}: round {}, phase {}; {} memberships, the largest set {largest}, {} transitions; {} tests, {} pairs of field types compared; {} pairs met, {} refused, {} verdicts kept, {} asked about in {} questions; waiting: {} views, {} new subtypes, {} pairs met, {} pairs asked about, {} + {} questions; MB: sets {}, refused {}, verdicts {}, tests {}, waiting {}",
            self.sizes.rounds,
            if self.phase == Phase::Flows { "A" } else { "B" },
            self.memberships,
            self.transitions,
            self.is_tested.len(),
            self.compared.len(),
            self.sizes.pairs_met,
            self.refusals + pending_rejections,
            self.verdicts.len(),
            self.sizes.pairs_queried,
            self.sizes.queries,
            self.queue.len(),
            self.joined.len(),
            self.met.len(),
            self.pairs.len(),
            self.queries.len(),
            self.own_queries.len(),
            self.memberships * (size_of::<u32>() * 3 + size_of::<Cause>()) / MB,
            (self.refusals + pending_rejections) * size_of::<u32>() / MB,
            self.verdicts.len() * 24 / MB,
            (self.is_tested.len() * 20 + self.compared.len() * 12) / MB,
            (self.met.len() * 16 + self.joined.len() * 8 + self.pairs.len() * size_of::<Pair>() + (self.queries.len() + self.own_queries.len()) * size_of::<SubtypeQuery>()) / MB,
        ));
    }

    fn report(&self) {
        let Some(print_line) = self.clock.print_line else {
            return;
        };
        let nodes = self.nodes as usize;
        let mut degrees = vec![[0u32; 10]; nodes];
        for from in 0..nodes {
            for &(to, number) in &self.untested[from] {
                let kind = usize::from(number != NONE);
                degrees[from][kind] += 1;
                degrees[to as usize][5 + kind] += 1;
            }
            for (at, &(to, may_convert)) in self.tested[from].iter().enumerate() {
                let kind = if at >= self.recorded_tests[from] as usize {
                    4
                } else if may_convert {
                    2
                } else {
                    3
                };
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
            Cause::Accepted(_) => 5,
            Cause::Converted(_) => 6,
            Cause::Fit(_) => 7,
        };
        let by_cause = |causes: [usize; 8]| {
            format!(
                "born {}, by a transition {}, declared {}, over upcasts {}, passing casts {}, admitted {}, become {}, fitting {}",
                causes[0],
                causes[1],
                causes[2],
                causes[3],
                causes[4],
                causes[5],
                causes[6],
                causes[7]
            )
        };
        let describe = |view: usize| {
            let facts = &self.gathered.facts[view];
            let words = [
                (HAS_SITE, "has a site"),
                (IS_COPIED, "copied into"),
                (HAS_CONSTANTS, "has constants"),
                (IS_CONCRETE, "concrete"),
                (IS_INSTANCE, "class"),
                (IS_GENERIC, "generic"),
                (IS_COERCION_RESULT, "made by coercion"),
                (IS_WEAK, "weak"),
                (HAS_INDEX_SIGNATURE, "index signature"),
                (HAS_CONCRETE_SUBTYPE, "has a concrete subtype"),
                (IS_FLAT, "flat"),
                (IS_FLAT_BUT_FOR_FUNCTIONS, "flat but for functions"),
                (IS_DISTINGUISHED, "told apart"),
            ];
            let words: Vec<&str> = words
                .iter()
                .filter(|word| facts.flags & word.0 != 0)
                .map(|word| word.1)
                .collect();
            let mut causes = [0usize; 8];
            for cause in &self.causes[view] {
                causes[number_of(cause)] += 1;
            }
            let (set, of) = (&self.sets[view], &degrees[view]);
            format!(
                "#{view}: {}, {}; names: {} declared, {} live, {} required, {} open, {} constants; {} subtypes, {} not laid out; refuses {}; becomes {}; held by {}; out: {} declared, {} upcasts, {} casts, {} tests, {} field tests; in: {} declared, {} upcasts, {} casts, {} tests, {} field tests; subtypes {}",
                facts.kind,
                if words.is_empty() {
                    "no flag".to_string()
                } else {
                    words.join(", ")
                },
                facts.declared.len(),
                facts.live.len(),
                facts.required.len(),
                facts.open.len(),
                facts.constants.len(),
                set.len(),
                set.len() - set.partition_point(|&member| member < self.nodes),
                self.refused[view].len() + self.newly_rejected[view].len(),
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
        let report_first = |title: &str, size_of_view: &dyn Fn(usize) -> usize| {
            let mut by_size: Vec<usize> =
                (0..nodes).filter(|&view| size_of_view(view) > 0).collect();
            by_size.sort_unstable_by_key(|&view| (std::cmp::Reverse(size_of_view(view)), view));
            print_line(format_args!(
                "aot: sizes: {title}: {} in all, in {} views. The first 30:",
                by_size
                    .iter()
                    .map(|&view| size_of_view(view))
                    .sum::<usize>(),
                by_size.len()
            ));
            for &view in by_size.iter().take(30) {
                print_line(format_args!(
                    "aot: sizes:   {} {}",
                    size_of_view(view),
                    describe(view)
                ));
            }
        };
        match self.over_budget {
            Some(table) => print_line(format_args!(
                "aot: sizes: {table} is over its budget, in round {}, phase {}",
                self.sizes.rounds,
                if self.phase == Phase::Flows { "A" } else { "B" }
            )),
            None => print_line(format_args!("aot: sizes: within the budget")),
        }
        let mut all_causes = [0usize; 8];
        let mut sets_by_size = [0usize; 33];
        for view in 0..nodes {
            for cause in &self.causes[view] {
                all_causes[number_of(cause)] += 1;
            }
            sets_by_size[(usize::BITS - self.sets[view].len().leading_zeros()) as usize] += 1;
        }
        print_line(format_args!(
            "aot: sizes: all memberships: {}",
            by_cause(all_causes)
        ));
        let sets_by_size: Vec<String> = sets_by_size
            .iter()
            .enumerate()
            .filter(|size| *size.1 > 0)
            .map(|(bits, number)| format!("{number} below {}", 1usize << bits))
            .collect();
        print_line(format_args!(
            "aot: sizes: sets by size: {}",
            sets_by_size.join(", ")
        ));
        report_first("subtypes", &|view| self.sets[view].len());
        report_first("supertypes that hold it", &|view| self.holders[view].len());
        report_first("transitions out of it", &|view| self.becomes[view].len());
        report_first("layouts refused", &|view| {
            self.refused[view].len() + self.newly_rejected[view].len()
        });
        report_first("casts and tests out of it", &|view| self.tested[view].len());
        report_first("casts and tests into it", &|view| {
            (degrees[view][7] + degrees[view][8] + degrees[view][9]) as usize
        });
        report_first("untested edges into it", &|view| {
            (degrees[view][5] + degrees[view][6]) as usize
        });
        const REASONS: [&str; 9] = [
            "seen to be let in",
            "declared in a declaration file",
            "untyped inflow and a kind that is of the type",
            "weak",
            "flat",
            "too many candidates",
            "made by coercion",
            "another",
            "may lack room",
        ];
        let (mut of_their_own, mut inherited) = ([0usize; 9], [0usize; 9]);
        for view in (0..self.nodes).filter(|&view| self.accepts_untyped(view)) {
            let (mut at, mut steps) = (view, 0);
            let reason = loop {
                let set = &self.sets[at as usize];
                let first = set.partition_point(|&member| member < self.nodes);
                let from = match self.causes[at as usize].get(first) {
                    Some(&Cause::Upcast(number)) => self.gathered.upcasts[number as usize].0,
                    Some(&Cause::Declared(from) | &Cause::Cast(from)) => from,
                    _ => {
                        break match set
                            .get(first)
                            .and_then(|&stranger| self.acceptance_reasons.get(&(at, stranger)))
                        {
                            Some(UntypedReason::Seen { .. })
                                if self.flags(at) & IS_COERCION_RESULT != 0 =>
                            {
                                6
                            }
                            Some(UntypedReason::Seen { .. }) => 0,
                            Some(UntypedReason::DeclaredOnly) => 1,
                            Some(UntypedReason::Untyped { .. }) => 2,
                            Some(UntypedReason::Weak { .. }) => 3,
                            Some(UntypedReason::Flat { .. }) => 4,
                            Some(UntypedReason::TooMany { .. }) => 5,
                            Some(UntypedReason::MayLackCapacity { .. }) => 8,
                            Some(UntypedReason::Dictionary { .. }) => 4,
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
            if steps == 0 {
                of_their_own[reason] += 1
            } else {
                inherited[reason] += 1
            }
        }
        let by_reason: Vec<String> = (0..9)
            .filter(|&reason| of_their_own[reason] + inherited[reason] > 0)
            .map(|reason| {
                format!(
                    "{}: {} and {} that have it from those",
                    REASONS[reason], of_their_own[reason], inherited[reason]
                )
            })
            .collect();
        print_line(format_args!(
            "aot: sizes: supertypes that admit untyped objects: {}. {}",
            of_their_own.iter().chain(&inherited).sum::<usize>(),
            by_reason.join("; ")
        ));
        let mut layouts_in_type: Vec<usize> = self
            .gathered
            .fields
            .layouts_in_type
            .iter()
            .map(Vec::len)
            .collect();
        layouts_in_type.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
        print_line(format_args!(
            "aot: sizes: views in a type: {} in all, in {} types. The first 30: {:?}",
            layouts_in_type.iter().sum::<usize>(),
            layouts_in_type.len(),
            &layouts_in_type[..layouts_in_type.len().min(30)]
        ));
        for kind in ["an object literal", "a type literal"] {
            let mut by_fields: FxHashMap<&[(u32, u32)], usize> = FxHashMap::default();
            for (view, fields) in self
                .gathered
                .fields
                .fields_by_layout
                .iter()
                .enumerate()
                .filter(|layout_entry| self.gathered.facts[layout_entry.0].kind == kind)
            {
                *by_fields.entry(&fields[..]).or_default() += usize::from(view < nodes);
            }
            let mut sharing: Vec<usize> = by_fields
                .values()
                .copied()
                .filter(|&number| number > 1)
                .collect();
            sharing.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
            print_line(format_args!(
                "aot: sizes: {kind}: {} views with {} different lists of live fields (name and type); {} views share theirs with another. The first 30: {:?}",
                by_fields.values().sum::<usize>(),
                by_fields.len(),
                sharing.iter().sum::<usize>(),
                &sharing[..sharing.len().min(30)]
            ));
        }
        let mut together: Vec<usize> = self.gathered.fields.together.iter().map(Vec::len).collect();
        together.sort_unstable_by_key(|&number| std::cmp::Reverse(number));
        print_line(format_args!(
            "aot: sizes: parts of a union: {} in all, in {} unions. The first 30: {:?}",
            together.iter().sum::<usize>(),
            together.len(),
            &together[..together.len().min(30)]
        ));
    }

    fn add_test(&mut self, from: u32, to: u32) {
        if from == to || self.over_budget.is_some() || !self.is_tested.insert((from, to)) {
            return;
        }
        self.tick(1);
        self.sizes.field_tests += 1;
        self.tested[from as usize].push((to, false));
        if self.is_accepting[from as usize] {
            self.newly_accepting.push(from);
        }
        let set = &self.sets[from as usize];
        let without_fixed_layout =
            set[set.partition_point(|&member| member < self.nodes)..].to_vec();
        self.propagate_members(&without_fixed_layout, from, to, false);
    }

    fn propagate_members(&mut self, members: &[u32], from: u32, to: u32, may_convert: bool) {
        if self.over_budget.is_some()
            || members.is_empty()
            || (!may_convert && self.accepts_untyped(to))
        {
            return;
        }
        self.tick(members.len());
        self.sort_rejected(to);
        let is_forced = may_convert && self.is_forced(from, to);
        let opens = may_convert && self.relaxes_if_rejected.contains(&(from, to));
        let mut opened_by = None;
        let mut admitted = Vec::new();
        let (has, refuses) = (&self.sets[to as usize], &self.refused[to as usize]);
        let target = &self.gathered.facts[to as usize];
        let (mut among, mut among_refused) = (0, 0);
        for &member in members {
            while has.get(among).is_some_and(|&other| other < member) {
                among += 1;
            }
            while refuses
                .get(among_refused)
                .is_some_and(|&other| other < member)
            {
                among_refused += 1;
            }
            let may_pass = (member != self.nodes && member != self.other_layout_record_node())
                || (may_convert && target.flags & IS_FLAT != 0)
                || is_forced;
            if is_forced
                && refuses.get(among_refused) == Some(&member)
                && has.get(among) != Some(&member)
            {
                admitted.push(member);
            }
            if opened_by.is_none()
                && member < self.nodes
                && refuses.get(among_refused) == Some(&member)
                && has.get(among) != Some(&member)
                && (opens
                    || may_convert && self.may_satisfy_unverified_overload_result(member, from, to))
            {
                opened_by = Some(member);
            }
            let is_new = has.get(among) != Some(&member)
                || (may_convert
                    && member < self.nodes
                    && target.flags & IS_INSTANCE == 0
                    && self.gathered.facts[member as usize].live.len() <= target.live.len()
                    && self.becomes[member as usize].binary_search(&to).is_err());
            if is_new && refuses.get(among_refused) != Some(&member) && may_pass && member != to {
                self.met.push((member, from, to, may_convert));
            }
        }
        for member in admitted {
            self.insert(to, member, Cause::Accepted(from));
        }
        if let Some(member) = opened_by {
            self.relax_for_unconvertible_layout(to, member);
        }
    }

    fn sort_rejected(&mut self, target: u32) {
        let mut new = std::mem::take(&mut self.newly_rejected[target as usize]);
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

    fn settle(&mut self) {
        loop {
            self.log_progress("the untested edges");
            while let Some(view) = self.queue.pop_front() {
                self.is_queued[view as usize] = false;
                let mut fresh = std::mem::take(&mut self.fresh[view as usize]);
                fresh.sort_unstable();
                let layouts_among = fresh.partition_point(|&member| member < self.nodes);
                let mut fresh_as_bits: Vec<u64> = Vec::new();
                if layouts_among >= BITSET_THRESHOLD
                    && self.untested[view as usize]
                        .iter()
                        .any(|edge| edge.1 == FITS)
                {
                    fresh_as_bits.resize((self.nodes as usize).div_ceil(64), 0);
                    for &member in &fresh[..layouts_among] {
                        fresh_as_bits[(member / 64) as usize] |= 1 << (member % 64);
                    }
                }
                for at in 0..self.untested[view as usize].len() {
                    let (to, number) = self.untested[view as usize][at];
                    match number {
                        NONE => self.insert_all(to, &fresh, Cause::Declared(view)),
                        FITS => self.propagate_structural_match(
                            view,
                            to,
                            &fresh[..layouts_among],
                            &fresh_as_bits,
                        ),
                        number => self.insert_all(to, &fresh, Cause::Upcast(number)),
                    }
                }
                let layout_types_cache = fresh.partition_point(|&member| member < self.nodes);
                for at in 0..self.tested[view as usize].len() {
                    let (to, may_convert) = self.tested[view as usize][at];
                    let members = if at < self.recorded_tests[view as usize] as usize {
                        &fresh[..]
                    } else {
                        &fresh[layout_types_cache..]
                    };
                    self.propagate_members(members, view, to, may_convert);
                }
            }
            self.log_progress("the fields of the new subtypes");
            for (member, view) in std::mem::take(&mut self.joined) {
                self.compare_fields(member, view);
            }
            self.log_progress("the pairs that have met");
            for (member, from, to, may_convert) in std::mem::take(&mut self.met) {
                self.meet(member, from, to, may_convert);
            }
            if self.over_budget.is_some() {
                self.log_progress("over the budget");
                self.report();
                self.queue.clear();
                self.joined.clear();
                self.met.clear();
                self.pairs.clear();
                self.queries.clear();
                self.own_queries.clear();
                return;
            }
            if self.queue.is_empty() && self.joined.is_empty() && self.met.is_empty() {
                if !self.pairs.is_empty()
                    || !self.queries.is_empty()
                    || !self.gathered.kind_queries.is_empty()
                {
                    self.log_progress("the questions of the round");
                    if self.queries.is_empty() && self.own_queries.is_empty() {
                        self.log_progress("the answers of the other checkers");
                        self.advance(&[], &[]);
                    }
                    return;
                }
                if self.phase == Phase::Flows && !self.completes_structurally {
                    self.flow_phase_snapshot = Some(Box::new(self.clone()));
                }
                self.collect_completion_targets();
                if self.to_complete.is_empty() {
                    if self.accepts_untyped_into_uninhabited() {
                        continue;
                    }
                    return;
                }
                self.log_progress("phase B");
                self.complete();
            }
        }
    }

    fn compare_fields(&mut self, member: u32, view: u32) {
        if self.over_budget.is_some() {
            return;
        }
        let (mut at, mut other) = (0, 0);
        loop {
            let (Some(&(name, ty)), Some(&(same, as_ty))) = (
                self.gathered.fields.fields_by_layout[member as usize].get(at),
                self.gathered.fields.fields_by_layout[view as usize].get(other),
            ) else {
                return;
            };
            at += usize::from(name <= same);
            other += usize::from(same <= name);
            if name != same || ty == as_ty || !self.compared.insert((ty, as_ty)) {
                continue;
            }
            for from in 0..self.gathered.fields.layouts_in_type[ty as usize].len() {
                for to in 0..self.gathered.fields.layouts_in_type[as_ty as usize].len() {
                    let (from, to) = (
                        self.gathered.fields.layouts_in_type[ty as usize][from],
                        self.gathered.fields.layouts_in_type[as_ty as usize][to],
                    );
                    self.add_test(from, to);
                    self.add_test(to, from);
                }
            }
        }
    }

    fn meet(&mut self, member: u32, from: u32, to: u32, may_convert: bool) {
        let is_there = self
            .bitset_contains(to, member)
            .unwrap_or_else(|| self.sets[to as usize].binary_search(&member).is_ok());
        if self.over_budget.is_some()
            || (is_there && from != NONE && (!may_convert || member >= self.nodes))
        {
            return;
        }
        self.tick(1);
        self.sizes.pairs_met += 1;
        if member == self.nodes
            || member == self.logging_untyped_node()
            || member == self.other_layout_record_node()
        {
            self.insert(to, member, Cause::Cast(from));
            return;
        }
        if from == NONE {
            let (created, view) = (
                &self.gathered.facts[member as usize],
                &self.gathered.facts[to as usize],
            );
            let is_rejected_by_language = created.hidden.iter().any(|name| {
                view.declared.binary_search(name).is_ok()
                    && view.hidden.binary_search(name).is_err()
            }) && (view.flags & IS_INSTANCE != 0
                || self
                    .gathered
                    .untyped_inflow_sites
                    .binary_search_by_key(&to, |held| held.0)
                    .is_err());
            if !is_rejected_by_language && may_be_assignable_to(created, view) {
                self.sizes.pairs_queried += 1;
                let fits = self.ask(
                    SubtypeQuery::allocated_is_assignable_query(
                        self.gathered.types[member as usize],
                        self.gathered.asked_as[to as usize],
                    ),
                    false,
                );
                self.pairs.push(Pair {
                    member,
                    target: to,
                    from,
                    may_convert,
                    fits,
                    structural_fit: NONE,
                });
            }
            return;
        }
        match self.verdicts.get(&(member, to)) {
            Some(&Verdict::Asked(pair)) => {
                let is_forced = self.is_forced(from, to);
                let pair = &mut self.pairs[pair as usize];
                if may_convert && (!pair.may_convert || is_forced) {
                    (pair.from, pair.may_convert) = (from, true);
                }
                return;
            }
            Some(&known) => return self.apply(known, member, from, to, may_convert),
            None => {}
        }
        let number = Verdict::Asked(self.pairs.len() as u32);
        if member > self.nodes {
            self.verdicts.insert((member, to), number);
            let fits = self.ask(
                SubtypeQuery::allocated_is_subtype_query(
                    self.seen[(member - self.nodes - 1) as usize],
                    self.gathered.asked_as[to as usize],
                ),
                true,
            );
            return self.pairs.push(Pair {
                member,
                target: to,
                from,
                may_convert,
                fits,
                structural_fit: NONE,
            });
        }
        let (created, target) = (
            &self.gathered.facts[member as usize],
            &self.gathered.facts[to as usize],
        );
        let needs_fit_check = !is_there && may_be_assignable_to(created, target);
        let queries_converse = target.flags & IS_INSTANCE == 0
            && created.live_as_bits & !target.live_as_bits == 0
            && is_subset(&created.live, &target.live)
            && may_be_assignable_to(target, created);
        if !needs_fit_check && !queries_converse {
            let verdict = self.verdict(member, to, is_there, false);
            self.settle_pair(member, to, verdict);
            return self.apply(verdict, member, from, to, may_convert);
        }
        self.verdicts.insert((member, to), number);
        self.sizes.pairs_queried += 1;
        let fits = if needs_fit_check {
            self.ask(
                SubtypeQuery::allocated_is_subtype_query(
                    self.gathered.types[member as usize],
                    self.gathered.asked_as[to as usize],
                ),
                false,
            )
        } else if is_there {
            YES
        } else {
            NONE
        };
        let structural_fit = if queries_converse {
            self.ask(
                SubtypeQuery::allocated_is_subtype_query(
                    self.gathered.types[to as usize],
                    self.gathered.asked_as[member as usize],
                ),
                false,
            )
        } else {
            NONE
        };
        self.pairs.push(Pair {
            member,
            target: to,
            from,
            may_convert,
            fits,
            structural_fit,
        });
    }

    fn settle_pair(&mut self, member: u32, target: u32, verdict: Verdict) {
        if verdict == Verdict::Refused {
            self.verdicts.remove(&(member, target));
            self.newly_rejected[target as usize].push(member);
        } else {
            self.verdicts.insert((member, target), verdict);
        }
    }

    fn ask(&mut self, query: SubtypeQuery, is_own: bool) -> u32 {
        self.sizes.queries += 1;
        if let Some(&answer) = query
            .as_allocated_query()
            .and_then(|asked| self.answered.get(&asked))
        {
            return match answer {
                SubtypeAnswer::Yes => YES,
                SubtypeAnswer::No => NONE,
                SubtypeAnswer::NotKnown => {
                    self.sizes.unknown_answers += 1;
                    NOT_KNOWN
                }
            };
        }
        let queries = if is_own {
            &mut self.own_queries
        } else {
            &mut self.queries
        };
        queries.push(query);
        (queries.len() - 1) as u32 | if is_own { OWN } else { 0 }
    }

    fn verdict(&mut self, member: u32, target: u32, fits: bool, structural_fit: bool) -> Verdict {
        let (created, to) = (
            &self.gathered.facts[member as usize],
            &self.gathered.facts[target as usize],
        );
        let may_become = structural_fit && (created.live.len() < to.live.len() || !fits);
        let is_abstract = to.flags & IS_CONCRETE == 0 && to.flags & HAS_CONCRETE_SUBTYPE != 0;
        if may_become && !is_abstract {
            return Verdict::Becomes { fits };
        }
        if fits {
            return Verdict::Passes;
        }
        const NO_EXTENSION: u16 = HAS_SITE | HAS_CONSTANTS | IS_INSTANCE;
        if may_become
            || (created.flags & NO_EXTENSION == 0
                && to.flags & NO_EXTENSION == 0
                && self.have_common_base(member, target))
        {
            return Verdict::Accepted;
        }
        Verdict::Refused
    }

    fn have_common_base(&mut self, a: u32, b: u32) -> bool {
        self.find_bases(a);
        self.find_bases(b);
        match (&self.bases[a as usize], &self.bases[b as usize]) {
            (Some(of_a), Some(of_b)) => have_common_element(of_a, of_b),
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

    fn apply(&mut self, verdict: Verdict, member: u32, from: u32, to: u32, may_convert: bool) {
        let verdict = match verdict {
            Verdict::Becomes { fits: true } if !may_convert => Verdict::Passes,
            Verdict::Becomes { .. } | Verdict::Accepted if !may_convert => return,
            verdict => verdict,
        };
        match verdict {
            Verdict::Refused if may_convert && self.is_forced(from, to) => {
                _ = self.insert(to, member, Cause::Accepted(from))
            }
            Verdict::Refused
                if may_convert
                    && member < self.nodes
                    && self.relaxes_if_rejected.contains(&(from, to)) =>
            {
                self.relax_for_unconvertible_layout(to, member)
            }
            Verdict::Refused
                if may_convert && self.may_satisfy_unverified_overload_result(member, from, to) =>
            {
                self.relax_for_unconvertible_layout(to, member)
            }
            Verdict::Asked(_) | Verdict::Refused => {}
            Verdict::Passes => _ = self.insert(to, member, Cause::Cast(from)),
            Verdict::Accepted => _ = self.insert(to, member, Cause::Accepted(from)),
            Verdict::Becomes { .. } => {
                let Err(at) = self.becomes[member as usize].binary_search(&to) else {
                    return;
                };
                self.becomes[member as usize].insert(at, to);
                self.transitions += 1;
                self.insert(to, to, Cause::Transition(member));
                for at in 0..self.holders[member as usize].len() {
                    let holder = self.holders[member as usize][at];
                    self.insert(holder, to, Cause::Converted(member));
                }
                if from != NONE && self.flags(from) & IS_GENERIC != 0 {
                    for at in 0..self.becomes[member as usize].len() {
                        let sibling = self.becomes[member as usize][at];
                        if sibling != to
                            && self.gathered.facts[sibling as usize].live
                                == self.gathered.facts[to as usize].live
                        {
                            self.met.push((to, from, sibling, true));
                            self.met.push((sibling, from, to, true));
                        }
                    }
                }
            }
        }
    }

    pub fn advance(&mut self, answers: &[SubtypeAnswer], local_answers: &[SubtypeAnswer]) {
        debug_assert!(
            answers.len() == self.queries.len() && local_answers.len() == self.own_queries.len()
        );
        self.sizes.unknown_answers += answers
            .iter()
            .chain(local_answers)
            .filter(|&&answer| answer == SubtypeAnswer::NotKnown)
            .count();
        for (query, &answer) in self
            .queries
            .iter()
            .zip(answers)
            .chain(self.own_queries.iter().zip(local_answers))
        {
            if let Some(asked) = query.as_allocated_query() {
                self.answered.insert(asked, answer);
            }
        }
        self.log_progress("the answers");
        self.sizes.rounds += 1;
        let kind_queries = if self.gathered.kind_queries.is_empty() {
            Vec::new()
        } else {
            std::mem::take(&mut self.gathered_mut().kind_queries)
        };
        if !kind_queries.is_empty() {
            let retained = match self.kind_query_answers.take() {
                Some(retained) => {
                    self.sizes.unknown_answers += retained
                        .iter()
                        .filter(|&&answer| answer == SubtypeAnswer::NotKnown)
                        .count();
                    retained
                }
                None => answers[..kind_queries.len()].to_vec(),
            };
            for (&answer, (_, view, why)) in retained.iter().zip(kind_queries) {
                if answer != SubtypeAnswer::No {
                    self.accept_untyped(view, self.nodes, why);
                    self.accept_relaxed(view, why);
                }
            }
            self.kind_query_answers = Some(retained);
        }
        let answer_at = |at: u32| match at {
            YES => SubtypeAnswer::Yes,
            NONE => SubtypeAnswer::No,
            NOT_KNOWN => SubtypeAnswer::NotKnown,
            at if at & OWN != 0 => local_answers[(at & !OWN) as usize],
            at => answers[at as usize],
        };
        let pairs = std::mem::take(&mut self.pairs);
        let decided: Vec<(u32, u32, u32, bool, SubtypeAnswer, SubtypeAnswer)> = pairs
            .iter()
            .map(|pair| {
                (
                    pair.member,
                    pair.target,
                    pair.from,
                    pair.may_convert,
                    answer_at(pair.fits),
                    answer_at(pair.structural_fit),
                )
            })
            .collect();
        self.queries.clear();
        self.own_queries.clear();
        for (member, target, from, may_convert, fits, structural_fit) in decided {
            let may_convert_conservatively =
                fits == SubtypeAnswer::No && structural_fit == SubtypeAnswer::NotKnown;
            let (fits, structural_fit) = (
                fits != SubtypeAnswer::No,
                structural_fit == SubtypeAnswer::Yes,
            );
            if from == NONE {
                if fits {
                    self.untested[member as usize].push((target, FITS));
                    if self.accepts_untyped(target) || self.has_bailed_out[target as usize] {
                        continue;
                    }
                    let set = &self.sets[member as usize];
                    let new = self.filter_new_members(
                        target,
                        &set[..set.partition_point(|&subtype| subtype < self.nodes)],
                        &self.bits[member as usize],
                    );
                    self.propagate_new_members(member, target, new);
                }
                continue;
            }
            let verdict = if member > self.nodes {
                if fits {
                    Verdict::Passes
                } else {
                    Verdict::Refused
                }
            } else if may_convert_conservatively {
                Verdict::Accepted
            } else {
                self.verdict(member, target, fits, structural_fit)
            };
            self.settle_pair(member, target, verdict);
            self.apply(verdict, member, from, target, may_convert);
        }
        self.settle();
    }

    fn propagate_structural_match(
        &mut self,
        from: u32,
        target: u32,
        members: &[u32],
        as_bits: &[u64],
    ) {
        if self.accepts_untyped(target) || self.has_bailed_out[target as usize] {
            return;
        }
        let new = self.filter_new_members(target, members, as_bits);
        self.propagate_new_members(from, target, new);
    }

    fn propagate_new_members(&mut self, from: u32, target: u32, new: Vec<u32>) {
        if self.sets[target as usize].len() + new.len() <= MAX_STRUCTURAL_SUBTYPES {
            return self.insert_new(target, new, Cause::Fit(from));
        }
        let at = self
            .gathered
            .vouched
            .binary_search_by_key(&target, |vouched| vouched.0)
            .map_or_else(|_| Place::default(), |found| self.gathered.vouched[found].1);
        self.abandon_completion(target, at);
    }

    fn abandon_completion(&mut self, target: u32, at: Place) {
        if std::mem::replace(&mut self.has_bailed_out[target as usize], true) {
            return;
        }
        self.sizes.with_too_many_candidates += 1;
        let facts = &self.gathered.facts[target as usize];
        if facts.flags & IS_INSTANCE == 0
            && (facts.flags & IS_DISTINGUISHED == 0 || facts.required.is_empty())
        {
            self.accept_untyped(target, self.nodes, UntypedReason::TooMany { at });
        }
    }

    fn collect_completion_targets(&mut self) {
        if self.phase == Phase::Flows {
            self.phase = Phase::Completion;
            for at in 0..self.gathered.vouched.len() {
                let (target, place) = self.gathered.vouched[at];
                self.is_trusted[target as usize] = true;
                self.to_complete.push((target, place));
            }
        }
        for view in std::mem::take(&mut self.newly_accepting) {
            for at in 0..self.tested[view as usize].len() {
                let to = self.tested[view as usize][at].0;
                if !std::mem::replace(&mut self.is_trusted[to as usize], true) {
                    self.to_complete.push((to, Place::default()));
                }
            }
        }
    }

    fn accepts_untyped_into_uninhabited(&mut self) -> bool {
        if !self.completes_structurally {
            return false;
        }
        let mut is_accepted_untyped = false;
        let mut is_allocated_by_a_cast = vec![false; self.nodes as usize];
        let has_members: Vec<bool> = (0..self.nodes)
            .map(|view| {
                self.sets[view as usize]
                    .iter()
                    .any(|&member| member != self.other_layout_record_node())
            })
            .collect();
        for &(from, to) in &self.gathered.casts {
            if has_members[from as usize] {
                is_allocated_by_a_cast[to as usize] = true;
            }
        }
        let mut reaches_closed_layout_with_subtypes: Vec<bool> = (0..self.nodes)
            .map(|view| has_members[view as usize] && !self.accepts_untyped(view))
            .collect();
        let mut is_next_to_closed_arm_with_subtypes = vec![false; self.nodes as usize];
        for arms in &self.gathered.fields.together {
            if arms
                .iter()
                .any(|&arm| reaches_closed_layout_with_subtypes[arm as usize])
            {
                for &arm in arms {
                    is_next_to_closed_arm_with_subtypes[arm as usize] = true;
                }
            }
        }
        loop {
            let mut has_grown = false;
            for &(from, to, _) in &self.gathered.upcasts {
                if reaches_closed_layout_with_subtypes[to as usize]
                    && !reaches_closed_layout_with_subtypes[from as usize]
                {
                    reaches_closed_layout_with_subtypes[from as usize] = true;
                    has_grown = true;
                }
            }
            if !has_grown {
                break;
            }
        }
        for view in 0..self.nodes {
            if self.is_trusted[view as usize]
                && !reaches_closed_layout_with_subtypes[view as usize]
                && !has_members[view as usize]
                && self.flags(view) & (IS_INSTANCE | HAS_SITE | IS_COPIED) == 0
                && !is_allocated_by_a_cast[view as usize]
                && (self.flags(view) & IS_DISTINGUISHED == 0
                    || self.gathered.facts[view as usize].required.is_empty()
                    || !is_next_to_closed_arm_with_subtypes[view as usize])
            {
                let at = self
                    .gathered
                    .vouched
                    .binary_search_by_key(&view, |vouched| vouched.0)
                    .map_or_else(|_| Place::default(), |found| self.gathered.vouched[found].1);
                self.accept_untyped(view, self.nodes, UntypedReason::NeverAllocated { at });
                is_accepted_untyped = true;
            }
        }
        is_accepted_untyped
    }

    fn find_candidates(&self) -> Candidates {
        let mut is_candidate: Vec<bool> = (0..self.nodes)
            .map(|layout| self.is_allocated(layout))
            .collect();
        for &(_, to) in &self.gathered.casts {
            if self.flags(to) & IS_INSTANCE == 0 {
                is_candidate[to as usize] = true;
            }
        }
        let mut lists = Candidates {
            by_name: FxHashMap::default(),
            by_open: FxHashMap::default(),
            by_constant: FxHashMap::default(),
            without_names: Vec::new(),
            large_by_name: FxHashMap::default(),
        };
        for layout in 0..self.nodes {
            let facts = &self.gathered.facts[layout as usize];
            if self.sets[layout as usize].len() >= LARGE
                && !self.accepts_untyped(layout)
                && facts.flags & IS_COERCION_RESULT == 0
            {
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

    fn candidates_for(lists: &Candidates, facts: &Facts) -> Vec<u32> {
        let is_shorter = |a: &&[u32], b: &&[u32]| a.len().cmp(&b.len()).then_with(|| a.cmp(b));
        let mut candidates: Vec<u32> = Vec::new();
        match facts
            .required
            .iter()
            .map(|name| lists.by_name.get(name).map_or(&[][..], |list| &list[..]))
            .min_by(is_shorter)
        {
            None => {
                candidates.extend(
                    facts
                        .declared
                        .iter()
                        .filter_map(|name| lists.by_name.get(name))
                        .flatten(),
                );
                candidates.extend_from_slice(&lists.without_names);
            }
            Some(shortest) => {
                let lists_of = |taken: &[(u32, u64)]| {
                    let mut found: Vec<&[u32]> = taken
                        .iter()
                        .filter_map(|constant| lists.by_constant.get(constant))
                        .chain(lists.by_open.get(&taken[0].0))
                        .map(|list| &list[..])
                        .collect();
                    found.sort_unstable();
                    found
                };
                let number_in =
                    |found: &Vec<&[u32]>| found.iter().map(|list| list.len()).sum::<usize>();
                let by_constants = (facts
                    .constants
                    .chunk_by(|a, b| a.0 == b.0)
                    .filter(|taken| facts.required.binary_search(&taken[0].0).is_ok())
                    .map(lists_of))
                .min_by(|a, b| number_in(a).cmp(&number_in(b)).then_with(|| a.cmp(b)));
                match by_constants {
                    Some(found) if number_in(&found) < shortest.len() => {
                        candidates.extend(found.into_iter().flatten())
                    }
                    _ => candidates.extend_from_slice(shortest),
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        candidates
    }

    fn large_candidates_for(&self, lists: &Candidates, target: u32) -> Vec<u32> {
        let facts = &self.gathered.facts[target as usize];
        let names = if facts.required.is_empty() {
            &facts.declared
        } else {
            &facts.required
        };
        let mut large: Vec<u32> = names
            .iter()
            .filter_map(|name| lists.large_by_name.get(name))
            .flatten()
            .copied()
            .collect();
        large.sort_unstable();
        large.dedup();
        large.retain(|&view| {
            view != target && may_be_assignable_to(&self.gathered.facts[view as usize], facts)
        });
        large.sort_by_key(|&view| (std::cmp::Reverse(self.sets[view as usize].len()), view));
        large.truncate(MANY_CANDIDATES);
        large.sort_unstable();
        large
    }

    fn is_small_or_data(&self, created: u32, target: u32, most_live_fields: usize) -> bool {
        let (created, target) = (
            &self.gathered.facts[created as usize],
            &self.gathered.facts[target as usize],
        );
        created.flags & target.flags & IS_PLAIN_DATA != 0
            || created.live.len() <= most_live_fields && target.live.len() <= most_live_fields
    }

    fn may_meet_through_untyped(&self, created: u32, target: u32) -> bool {
        created != target
            && self.sets[target as usize].binary_search(&created).is_err()
            && may_match_by_constants(
                &self.gathered.facts[created as usize],
                &self.gathered.facts[target as usize],
            )
            && self.is_small_or_data_recursively(created, target)
    }

    fn is_small_or_data_recursively(&self, created: u32, target: u32) -> bool {
        let fields = &self.gathered.fields;
        let is_record = |view: u32| self.flags(view) & (IS_INSTANCE | IS_COERCION_RESULT) == 0;
        let mut pending = vec![(created, target)];
        let mut seen: FxHashSet<(u32, u32)> = FxHashSet::default();
        while let Some((from, to)) = pending.pop() {
            if !self.is_small_or_data(from, to, MAX_LIVE_FIELDS_TO_CONVERT) {
                return false;
            }
            let (mut at, mut other) = (0, 0);
            while let (Some(&(name, ty)), Some(&(same, as_ty))) = (
                fields.fields_by_layout[from as usize].get(at),
                fields.fields_by_layout[to as usize].get(other),
            ) {
                at += usize::from(name <= same);
                other += usize::from(same <= name);
                if name != same || ty == as_ty {
                    continue;
                }
                for &held in &fields.layouts_in_type[ty as usize] {
                    for &slot_type in &fields.layouts_in_type[as_ty as usize] {
                        if held != slot_type
                            && is_record(held)
                            && is_record(slot_type)
                            && self.sets[slot_type as usize].binary_search(&held).is_err()
                            && seen.insert((held, slot_type))
                        {
                            pending.push((held, slot_type));
                        }
                    }
                }
            }
        }
        true
    }

    fn relax_for_unconvertible_layout(&mut self, target: u32, created: u32) {
        let facts = &self.gathered.facts[target as usize];
        if facts.flags & IS_INSTANCE == 0
            && (facts.flags & IS_DISTINGUISHED == 0 || facts.required.is_empty())
        {
            self.accept_untyped(
                target,
                self.nodes,
                UntypedReason::UnconvertibleLayout { from: created },
            );
        }
    }

    fn escaped_layouts(&mut self) -> Vec<u32> {
        if self.escaped_layout_types.is_none() {
            let number_of: FxHashMap<TypeId, u32> = self
                .gathered
                .types
                .iter()
                .enumerate()
                .map(|(view, &ty)| (ty, view as u32))
                .collect();
            let mut views: Vec<u32> = self
                .gathered
                .escapes
                .with_mutations(|recorded| recorded.escaped())
                .iter()
                .filter_map(|ty| number_of.get(ty).copied())
                .collect();
            views.sort_unstable();
            views.dedup();
            self.escaped_layout_types = Some(views);
        }
        let mut layouts: Vec<u32> = Vec::new();
        for &view in self.escaped_layout_types.iter().flatten() {
            layouts.extend(
                self.sets[view as usize]
                    .iter()
                    .copied()
                    .take_while(|&member| member < self.nodes)
                    .filter(|&member| self.flags(member) & IS_INSTANCE == 0),
            );
        }
        layouts.sort_unstable();
        layouts.dedup();
        layouts
    }

    fn complete(&mut self) {
        let lists = match self.candidates.take() {
            Some(lists) => lists,
            None => Box::new(self.find_candidates()),
        };
        let mut again: Vec<(u32, Place)> = Vec::new();
        let mut targets_by_name: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
        let escaped = self.escaped_layouts();
        for (target, place) in std::mem::take(&mut self.to_complete) {
            if self.flags(target) & IS_COERCION_RESULT != 0
                || self.accepts_untyped(target)
                || self.accept_by_structure(target, place)
            {
                continue;
            }
            let facts = &self.gathered.facts[target as usize];
            if facts.flags & (IS_INSTANCE | IS_WEAK) != 0 && facts.required.is_empty() {
                self.abandon_completion(target, place);
                continue;
            }
            let (many, maximum) = if facts.flags & (IS_INSTANCE | IS_DISTINGUISHED) != 0 {
                (
                    MAX_CANDIDATES_PER_CREATED_TYPE,
                    MAX_CANDIDATES_PER_CREATED_TYPE,
                )
            } else {
                (MANY_CANDIDATES, MAX_CANDIDATES)
            };
            let (has, queried_first) =
                (&self.sets[target as usize], self.queried_first.get(&target));
            let may_be_new = |&created: &u32| {
                created != target
                    && has.binary_search(&created).is_err()
                    && queried_first.is_none_or(|asked| asked.binary_search(&created).is_err())
                    && may_be_assignable_to(&self.gathered.facts[created as usize], facts)
            };
            let fitting: Vec<u32> = Self::candidates_for(&lists, facts)
                .into_iter()
                .filter(may_be_new)
                .take(MAX_CANDIDATES_PER_CREATED_TYPE + 1)
                .collect();
            if fitting.len() > many {
                let large = if self.completes_structurally
                    && queried_first.is_none()
                    && fitting.len() <= MAX_CANDIDATES_PER_CREATED_TYPE
                {
                    self.large_candidates_for(&lists, target)
                } else {
                    Vec::new()
                };
                if !large.is_empty() {
                    self.met
                        .extend(large.iter().map(|&view| (view, NONE, target, false)));
                    self.queried_first.insert(target, large);
                    again.push((target, place));
                    continue;
                }
            }
            if fitting.len() > maximum {
                self.abandon_completion(target, place);
                continue;
            }
            for &name in facts.live.iter() {
                targets_by_name.entry(name).or_default().push(target);
            }
            if self.completes_structurally {
                self.propagate_members(&fitting, NONE, target, false);
                if self.is_reachable_from_untyped[target as usize] {
                    let meeting: Vec<u32> = escaped
                        .iter()
                        .copied()
                        .filter(|&created| self.may_meet_through_untyped(created, target))
                        .collect();
                    for &created in &meeting {
                        if may_be_assignable_to(
                            &self.gathered.facts[created as usize],
                            &self.gathered.facts[target as usize],
                        ) && self.is_small_or_data(created, target, MAX_LIVE_FIELDS_TO_RELAX)
                        {
                            self.relaxes_if_rejected.insert((created, target));
                        }
                        self.propagate_members(&[created], created, target, true);
                    }
                }
            }
        }
        self.candidates = Some(lists);
        self.to_complete = again;
        let is_shorter = |a: &&[u32], b: &&[u32]| a.len().cmp(&b.len()).then_with(|| a.cmp(b));
        for generic in 0..self.nodes {
            let facts = &self.gathered.facts[generic as usize];
            if facts.flags & IS_GENERIC == 0 || facts.flags & IS_INSTANCE != 0 {
                continue;
            }
            let Some(shortest) = facts
                .live
                .iter()
                .map(|name| targets_by_name.get(name).map_or(&[][..], |list| &list[..]))
                .min_by(is_shorter)
            else {
                continue;
            };
            let may_meet = |&&target: &&u32| {
                target != generic && facts.live == self.gathered.facts[target as usize].live
            };
            let targets: Vec<u32> = shortest.iter().filter(may_meet).copied().collect();
            let set = &self.sets[generic as usize];
            let layout_types_cache =
                set[..set.partition_point(|&subtype| subtype < self.nodes)].to_vec();
            for target in targets {
                self.propagate_members(&layout_types_cache, generic, target, true);
            }
        }
    }

    pub fn finish(mut self) -> Membership {
        self.log_progress("done");
        if self.clock.is_verbose && self.over_budget.is_none() {
            self.report();
        }
        let views = self.nodes as usize;
        if self.gathered.logging_relaxation != LoggingRelaxation::Nothing {
            for view in 0..views {
                for &(member, cause) in &self.gathered.subtypes_when_strict[view] {
                    if let Err(at) = self.sets[view].binary_search(&member) {
                        self.sets[view].insert(at, member);
                        self.causes[view].insert(at, cause);
                    }
                }
            }
            for (becomes, when_closed) in self
                .becomes
                .iter_mut()
                .zip(&self.gathered.conversions_when_strict)
            {
                for &to in when_closed {
                    if let Err(at) = becomes.binary_search(&to) {
                        becomes.insert(at, to);
                    }
                }
            }
            for view in 0..views {
                let mut pending: Vec<u32> = self.sets[view]
                    .iter()
                    .copied()
                    .filter(|&member| member < self.nodes)
                    .collect();
                while let Some(member) = pending.pop() {
                    for &to in &self.becomes[member as usize] {
                        if let Err(at) = self.sets[view].binary_search(&to) {
                            self.sets[view].insert(at, to);
                            self.causes[view].insert(at, Cause::Converted(member));
                            pending.push(to);
                        }
                    }
                }
            }
        }
        let mut reached: Vec<LayoutUsage> = Vec::new();
        reached.resize_with(views, LayoutUsage::default);
        let mut untyped_reasons: Vec<Option<UntypedReason>> = vec![None; views];
        let (logging_untyped_node, other_layout_record_node) =
            (self.logging_untyped_node(), self.other_layout_record_node());
        for (view, reach) in reached.iter_mut().enumerate() {
            let set = &self.sets[view];
            let layout_types_cache = set.partition_point(|&member| member < self.nodes);
            reach.members = set[..layout_types_cache].to_vec();
            if let Some(by_flow) = self.subtypes_by_flow.get(view) {
                reach.structural_subtypes = reach
                    .members
                    .iter()
                    .copied()
                    .filter(|member| by_flow.binary_search(member).is_err())
                    .collect();
            }
            reach.specializations.clone_from(&self.becomes[view]);
            reach.is_allocated = set.binary_search(&(view as u32)).is_ok();
            reach.is_transition_target_only =
                reach.is_allocated && self.gathered.facts[view].flags & (HAS_SITE | IS_COPIED) == 0;
            reach.accepts_untyped = layout_types_cache < set.len();
            reach.accepts_only_other_layouts = set.binary_search(&other_layout_record_node).is_ok()
                && set[layout_types_cache..].iter().all(|&stranger| {
                    stranger == other_layout_record_node || stranger == logging_untyped_node
                });
            reach.is_relaxed_for_logging = reach.accepts_untyped
                && self.gathered.logging_relaxation != LoggingRelaxation::Nothing
                && (!self.gathered.accepting_when_strict[view] || reach.accepts_only_other_layouts);
            if reach.accepts_untyped {
                untyped_reasons[view] = Some(match self.causes[view][layout_types_cache] {
                    Cause::Upcast(number) => UntypedReason::Inherited {
                        from: self.gathered.upcasts[number as usize].0,
                        at: self.gathered.upcasts[number as usize].2,
                    },
                    Cause::Declared(from) => UntypedReason::Inherited {
                        from,
                        at: Place::default(),
                    },
                    Cause::Cast(from) | Cause::Accepted(from) => UntypedReason::PassedCast { from },
                    _ => self.acceptance_reasons[&(view as u32, set[layout_types_cache])],
                });
            }
            self.sizes.allocated += usize::from(reach.is_allocated);
            self.sizes.accepting_untyped += usize::from(reach.accepts_untyped);
            self.sizes.memberships += layout_types_cache;
            self.sizes.structural_without_flow += self.causes[view][..layout_types_cache]
                .iter()
                .filter(|cause| matches!(cause, Cause::Fit(_)))
                .count();
            self.sizes.largest = self.sizes.largest.max(layout_types_cache);
            self.sizes.transitions += reach.specializations.len();
        }
        let mark = |reach: &mut LayoutUsage, mutation: usize| {
            *(if mutation == 0 {
                &mut reach.may_be_frozen
            } else {
                &mut reach.may_have_other_prototype
            }) = true
        };
        for mutation in 0..2 {
            for &view in &self.gathered.altered[mutation].views {
                for &member in self.sets[view as usize]
                    .iter()
                    .filter(|&&member| (member as usize) < views)
                {
                    mark(&mut reached[member as usize], mutation);
                }
            }
        }
        if self
            .gathered
            .altered
            .iter()
            .any(|altered| !altered.besides.is_empty())
        {
            let lists = match self.candidates.take() {
                Some(lists) => lists,
                None => Box::new(self.find_candidates()),
            };
            for mutation in 0..2 {
                for facts in &self.gathered.altered[mutation].besides {
                    for created in Self::candidates_for(&lists, facts) {
                        if may_be_assignable_to(&self.gathered.facts[created as usize], facts) {
                            mark(&mut reached[created as usize], mutation);
                        }
                    }
                }
            }
        }
        self.sizes.bytes = self
            .sets
            .iter()
            .map(|set| set.len() * (size_of::<u32>() * 2 + size_of::<Cause>()))
            .sum::<usize>()
            + self.verdicts.len() * 16
            + self.is_tested.len() * 12;

        let join =
            |callees: &mut FxHashMap<(u32, Atom), Callee>, place: (u32, Atom), callee: Callee| {
                let joined = callees.entry(place).or_default();
                *joined = joined.join(callee);
            };
        let mut held: FxHashMap<(u32, Atom), Callee> = FxHashMap::default();
        for &(created, name, callee) in &self.gathered.callees_at_creation {
            let (mut passed, mut pending) = (FxHashSet::default(), vec![created]);
            while let Some(layout) = pending.pop() {
                if passed.insert(layout)
                    && reached
                        .get(layout as usize)
                        .is_some_and(|reach| reach.is_allocated)
                {
                    join(&mut held, (layout, name), callee);
                    pending.extend_from_slice(&self.becomes[layout as usize]);
                }
            }
        }
        for &(view, name, callee) in &self.gathered.callees_stored {
            for &layout in self.sets[view as usize]
                .iter()
                .filter(|&&layout| (layout as usize) < views)
            {
                join(&mut held, (layout, name), callee);
            }
        }
        let mut store_target_type: Vec<Vec<(Atom, Callee)>> = vec![Vec::new(); views];
        for (&(layout, name), &callee) in &held {
            store_target_type[layout as usize].push((name, callee));
        }
        let is_marked = |reach: &LayoutUsage, mutation: usize| {
            reach.is_allocated
                && if mutation == 0 {
                    reach.may_be_frozen
                } else {
                    reach.may_have_other_prototype
                }
        };
        let mut mutated_by = [[0u32; 3]; 2];
        for mutation in 0..2 {
            let altered = &self.gathered.altered[mutation];
            mutated_by[mutation][0] = reached
                .iter()
                .filter(|reach| is_marked(reach, mutation))
                .count() as u32;
            if mutation == 1 {
                for reach in &mut reached {
                    reach.prototype_is_set_by_typed_code = reach.may_have_other_prototype;
                }
            }
            if altered.is_any_layout || altered.is_untyped {
                for reach in &mut reached {
                    mark(reach, mutation);
                }
            }
            mutated_by[mutation][1] = reached
                .iter()
                .filter(|reach| is_marked(reach, mutation))
                .count() as u32;
            mutated_by[mutation][2] =
                u32::from(altered.is_any_layout) | u32::from(altered.is_untyped) << 1;
        }
        let number_of: FxHashMap<TypeId, u32> = self
            .gathered
            .types
            .iter()
            .enumerate()
            .map(|(view, &ty)| (ty, view as u32))
            .collect();
        let mut is_known_escaped = vec![false; views];
        for view in self
            .gathered
            .escapes
            .with_mutations(|recorded| recorded.escaped())
            .iter()
            .filter_map(|ty| number_of.get(ty))
        {
            for &member in self.sets[*view as usize]
                .iter()
                .filter(|&&member| (member as usize) < views)
            {
                is_known_escaped[member as usize] = true;
            }
        }
        let mut gives_up: Vec<bool> = (0..views)
            .map(|view| {
                reached[view].is_allocated
                    && reached[view].accepts_untyped
                    && self.gathered.facts[view].flags & IS_INSTANCE == 0
            })
            .collect();
        for reach in reached.iter().filter(|reach| !reach.accepts_untyped) {
            for &member in &reach.members {
                gives_up[member as usize] = false;
            }
        }
        let count = |holds: &dyn Fn(usize) -> bool| {
            (0..views)
                .filter(|&view| reached[view].is_allocated && holds(view))
                .count() as u32
        };
        let is_record = |view: usize| self.gathered.facts[view].flags & IS_INSTANCE == 0;
        let mutation_evidence = [
            count(&|view| is_record(view)),
            count(&|view| gives_up[view]),
            count(&|view| is_known_escaped[view]),
            count(&|view| is_record(view) && !gives_up[view] && !is_known_escaped[view]),
            count(&|view| !is_record(view) && !is_known_escaped[view]),
        ];
        let (mutation_sites, untyped_mutations) = self
            .gathered
            .escapes
            .with_mutations(|recorded| (recorded.sites(), recorded.untyped_sites()));
        let (widest_mutations, redefinition_counts) = self
            .gathered
            .escapes
            .with_mutations(|recorded| (recorded.widest(), recorded.redefinition_counts()));
        let places_marking_every_layout = self
            .gathered
            .escapes
            .with_mutations(|recorded| recorded.places_marking_every_layout());
        for reach in reached.iter_mut() {
            let mut read: FxHashMap<Atom, Callee> = FxHashMap::default();
            for &layout in &reach.members {
                for &(name, callee) in &store_target_type[layout as usize] {
                    let joined = read.entry(name).or_default();
                    *joined = joined.join(callee);
                }
            }
            for (name, callee) in read {
                if let Callee::One(file, func) = callee {
                    reach.callees.push((name, file, func));
                }
            }
            reach
                .callees
                .sort_unstable_by_key(|&(name, file, func)| (file, func, name.0));
        }
        self.log_progress("the callees");
        self.flow_phase_snapshot = None;
        let gathered = Self::into_gathered(self.gathered);
        gathered.creations.apply(&mut reached);
        let constructions_are_incomplete = gathered.constructions.is_incomplete();
        gathered
            .constructions
            .apply(&mut reached, &gathered.facts, &self.becomes);
        Membership {
            constructions_are_incomplete,
            views: reached,
            mutation_sites,
            mutated_by,
            mutation_evidence,
            untyped_mutations,
            widest_mutations,
            places_marking_every_layout,
            redefinition_counts,
            sizes: self.sizes,
            untyped_reasons,
            subtypes: self.sets,
            causes: self.causes,
            upcasts: gathered.upcasts,
            vouched: gathered.vouched,
        }
    }
}
