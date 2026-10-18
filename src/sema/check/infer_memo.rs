//! A memo of the walks of `inferTypes`.
//!
//! The same walk from a source type to a target type is made again and again: in every pass of `chooseOverload`, and for
//! every call of a generic function with arguments of the same types or in the same context. What a walk wrote into the
//! inference infos is kept here, and written again in place of the next walk.
//!
//! The rule that makes that exact. tsgo makes every walk, so a walk that is left out must be one that nothing could tell
//! from what is written in its place:
//!
//! - The key (`key_of_walk`) holds all that a walk reads from the `Inference`. A hit compares every number of it.
//! - The walk that is stored left no trace (`traces_of_inference`): it made no query, began no computation whose result a
//!   table keeps, computed no instantiation, created no record and reported nothing. So it found all it asked for in the
//!   type store and in tables.
//! - What it found there stays (`is_settled_for_inference`). An evaluation begins with a miss, so an entry is replaced only
//!   by an evaluation of its key that began before the entry was stored and ends after it was read. When the walk was
//!   made, no such evaluation was in progress.
//! - A cache that forgets is in front of a table, or makes again from tables what it has forgotten. A walk gets the same
//!   from it with the entry and without, and what such a cache holds shows nowhere else. So making it again isn't a trace,
//!   or the same walk would leave one or not by what was asked in between (`Checker::scopes_begun`).
//! - What it did not find there, and did not evaluate, says the same once it is there. `type_of_mapped_prop` and the tables
//!   of what is circular are asked in that way. An entry says what its absence did not only if it comes from a cycle or a
//!   limit, so what is kept here lasts until the next one (`inference_disturbances`).
//! - So the same walk made later finds the same, takes the same path and fills no table either, and the task creates,
//!   stores and publishes what it does without the memo. Unless something is in progress that a function looks at before
//!   it looks into a table: then the walk is made (`obstacle_to_leaving_out`).
//! - What a walk does every time it is made is stored and done again: see the fields of `Entry`.
//!
//! The thresholds and the bounds decide which walks are stored and for how long. They change the time, never a result.
//!
//! The memo belongs to a `Checker`, which runs one task. Nothing of it goes to a barrier.

use super::super::*;
use super::Inference;
use crate::util::fx_hash;
use smallvec::SmallVec;

/// `false`: every walk is made.
pub(super) const ENABLED: bool = true;

/// Every walk that the memo would leave out is made, and compared with what would have been written in its place. A
/// difference is a panic that names the types, the file and each trace that the walk has left. For debugging.
const SHADOW: bool = false;

/// An entry lasts from one file of the task to the next. Of what `check_file` clears, a walk without a trace asks only for
/// what is in `obstacle_to_leaving_out`, for what depends on syntax alone, and after a miss. Off: it ends with the file.
const LASTS_ACROSS_FILES: bool = true;

/// An entry outlasts a read of the incomplete type of a loop. `taint_from` writes to counters and to the frames in
/// progress, which then store nothing, or for the first time. Off: it ends there, as at a cycle.
const OUTLASTS_FLOW_LOOPS: bool = true;

/// The names of `Checker::inference_walk_counts`.
pub const INFERENCE_WALK_COUNTS: [&str; 16] = [
    "walks",
    "long",
    "to the target of a long walk",
    "in an instantiation",
    "in a variance computation",
    "otherwise not at rest",
    "keyed",
    "left out",
    "calls left out",
    "of an earlier generation",
    "not confirmed",
    "without room",
    "not settled",
    "left a trace",
    "stored",
    "disturbances",
];

/// An index into `INFERENCE_WALK_COUNTS`.
#[derive(Copy, Clone)]
pub(in super::super) enum Count {
    /// `infer_ex` got past its first test.
    Walks,
    /// Made, with `LONG_WALK` calls or more.
    Long,
    ToLongTarget,
    /// The three answers of `obstacle_to_leaving_out`.
    InInstantiation,
    InVarianceComputation,
    NotAtRest,
    Keyed,
    LeftOut,
    /// `Entry::calls` of those.
    CallsLeftOut,
    /// There is an entry from before the last disturbance.
    Disturbed,
    /// There is one for which `InferenceMemo::store` waits for a second walk.
    NotConfirmed,
    /// There is one, and the walk would come to the limit of `instantiation_count` or of the native stack.
    WithoutRoom,
    /// There is none to write again, and `is_settled_for_inference` does not hold.
    NotSettled,
    /// Long, and not stored for what it did.
    LeftTrace,
    Stored,
    /// How often a generation ended.
    Disturbances,
}

/// A walk of this many calls of `infer_types` is long. The first long walk to a target marks the target, and only a walk
/// to a marked target has a key. The key, two readings of the counters and a look at the frames in progress cost about as
/// much as three calls, which every walk to a marked target pays and only a hit gets back.
pub(super) const LONG_WALK: u32 = 16;

/// The numbers of a key, or of a key and an outcome.
type Words = SmallVec<[u32; 48]>;

/// A walk that was made.
#[derive(Clone, Debug, Default)]
struct Entry {
    /// `key_of_walk`, then `push_state` after the walk, unless that is the state in the key. The key has the state before
    /// the walk, so the state after it is where the writes of the walk lead, one after the other.
    words: Box<[u32]>,
    key_len: u32,
    /// How often `infer_types` was called.
    calls: u32,
    /// What it added to `Checker::instantiation_count`. With no mapper active, every `instantiate` that has something to do
    /// adds one, whatever the count is, unless it finds the count at its limit.
    instantiations: u32,
    /// What it set in `Checker::reliability`: a comparison in progress stores that with its result.
    reliability: u8,
    /// See `InferenceMemo::store`.
    is_confirmed: bool,
    /// How many bytes of native stack it took.
    stack: u32,
    /// `InferenceMemo::generation` when it was made.
    generation: u64,
}

impl Entry {
    fn key(&self) -> &[u32] {
        &self.words[..self.key_len as usize]
    }

    /// Empty: the walk wrote nothing.
    fn state_after(&self) -> &[u32] {
        &self.words[self.key_len as usize..]
    }

    /// Of two walks with one key.
    fn did_the_same_as(&self, other: &Entry) -> bool {
        self.words == other.words
            && self.calls == other.calls
            && self.instantiations == other.instantiations
            && self.reliability == other.reliability
    }
}

/// The names of `Checker::traces_of_inference`: the field of the checker, or the kind of record.
const TRACES: [&str; 14] = [
    "work",
    "scopes_begun",
    "instantiations_computed",
    "atoms",
    "components",
    "mappers",
    "signatures",
    "types",
    "comparisons_of_deeply_nested_types",
    "incomplete_flow_taints",
    "reported",
    "diagnostics",
    "relation_too_complex and relation_too_deep",
    "unresolved_renamed_params",
];

/// The names of `Checker::inference_disturbances`.
const DISTURBANCES: [&str; 9] = [
    "file",
    "cycles",
    "taints",
    "limits",
    "times_cut_short",
    "variance_cycles",
    "unmarked_refusals",
    "any_signature_reads",
    "times_forgotten",
];

/// All that says whether a walk has left a trace, before the walk or after it.
struct Readings {
    traces: [u64; TRACES.len()],
    disturbances: [u64; DISTURBANCES.len()],
    /// `usize::MAX` before the walk.
    lowest_taint: usize,
    /// `false` before the walk.
    has_met_contextual_function: bool,
    /// It goes down where it is reset. What it goes up by is `Entry::instantiations`.
    instantiation_count: u32,
}

impl Readings {
    fn shows_no_trace_since(&self, before: &Readings) -> bool {
        self.traces == before.traces
            && self.disturbances == before.disturbances
            && self.lowest_taint == before.lowest_taint
            && self.has_met_contextual_function == before.has_met_contextual_function
            && self.instantiation_count >= before.instantiation_count
    }

    /// Under `SHADOW`: each number that is another one than in `before`, with its name and both values.
    #[cold]
    fn moved_since(&self, before: &Readings) -> String {
        let others = [
            "lowest_taint",
            "has_met_contextual_function",
            "instantiation_count",
        ];
        let numbers = |of: &Readings| {
            let listed = of.traces.iter().chain(&of.disturbances).copied();
            let rest = [
                of.lowest_taint as u64,
                u64::from(of.has_met_contextual_function),
                u64::from(of.instantiation_count),
            ];
            listed.chain(rest).collect::<Vec<u64>>()
        };
        let names = TRACES.iter().chain(&DISTURBANCES).chain(&others);
        let moved = names
            .zip(numbers(before).into_iter().zip(numbers(self)))
            .filter(|(_, (before, after))| before != after)
            .map(|(name, (before, after))| format!("{name} from {before} to {after}"));
        moved.collect::<Vec<String>>().join(", ")
    }
}

#[derive(Default)]
pub(in super::super) struct InferenceMemo {
    /// A bit for each target of a long walk, at a hash of the target. Two targets can share one. Empty until the first.
    long_targets: Vec<u64>,
    /// Each at a hash of its key: a new entry overwrites whatever is in its place. Empty, then a power of two.
    entries: Vec<Entry>,
    /// A hash shifted right by this amount is an index into `entries`.
    shift: u32,
    /// How many entries were stored since `entries` last grew.
    stored: usize,
    /// Only the entries of this generation count.
    generation: u64,
    /// `Checker::inference_disturbances` when the generation began.
    disturbances: [u64; DISTURBANCES.len()],
    counts: [u64; INFERENCE_WALK_COUNTS.len()],
}

impl InferenceMemo {
    /// 4 KB.
    const LONG_TARGET_BITS: u32 = 15;
    const MOST_ENTRIES: usize = 1 << 10;
    /// The longest `Entry::words` that is stored: with `MOST_ENTRIES`, no task keeps more than 4 MB.
    const MOST_WORDS: usize = 1 << 10;

    #[inline]
    fn bit_of(target: TypeId) -> usize {
        (target.0.wrapping_mul(0x9E37_79B9) >> (32 - Self::LONG_TARGET_BITS)) as usize
    }

    #[inline]
    pub(super) fn has_long_walk_to(&self, target: TypeId) -> bool {
        let bit = Self::bit_of(target);
        (self.long_targets.get(bit / 64)).is_some_and(|word| word >> (bit % 64) & 1 != 0)
    }

    pub(super) fn note_long_walk_to(&mut self, target: TypeId) {
        if self.long_targets.is_empty() {
            self.long_targets = vec![0; 1 << (Self::LONG_TARGET_BITS - 6)];
        }
        let bit = Self::bit_of(target);
        self.long_targets[bit / 64] |= 1 << (bit % 64);
        self.count(Count::Long);
    }

    #[inline]
    pub(super) fn count(&mut self, what: Count) {
        self.counts[what as usize] += 1;
    }

    /// `now`: `Checker::inference_disturbances`.
    fn begin_generation_if_disturbed(&mut self, now: &[u64; DISTURBANCES.len()]) {
        if self.disturbances != *now {
            self.disturbances = *now;
            self.generation += 1;
            self.count(Count::Disturbances);
        }
    }

    /// Where the entry with `key` is, of whatever generation.
    fn place(&self, hash: u64, key: &[u32]) -> Option<usize> {
        let place = (hash >> self.shift) as usize;
        (self.entries.get(place)?.key() == key).then_some(place)
    }

    /// `instantiate` counts its calls. A walk that is the first to compute what the checker keeps outside the tables, as
    /// `simplified` does, counts the calls which that takes, and the next walk does not. So a count other than 0 is
    /// written again only after a second walk has done the same as the first.
    fn store(&mut self, hash: u64, mut walked: Entry) {
        self.count(Count::Stored);
        walked.is_confirmed = walked.instantiations == 0;
        if let Some(place) = self.place(hash, walked.key()) {
            let earlier = &self.entries[place];
            if earlier.generation == self.generation {
                walked.is_confirmed |= walked.did_the_same_as(earlier);
                walked.stack = walked.stack.max(earlier.stack);
            }
            self.entries[place] = walked;
            return;
        }
        if self.stored == self.entries.len() && self.stored < Self::MOST_ENTRIES {
            self.grow();
        }
        self.stored += 1;
        let place = (hash >> self.shift) as usize;
        self.entries[place] = walked;
    }

    #[cold]
    fn grow(&mut self) {
        let len = (self.entries.len() * 4).max(64);
        let empty = std::iter::repeat_with(Entry::default).take(len).collect();
        self.shift = 64 - len.trailing_zeros();
        self.stored = 0;
        for entry in std::mem::replace(&mut self.entries, empty) {
            if entry.key_len != 0 && entry.generation == self.generation {
                let place = (fx_hash(entry.key()) >> self.shift) as usize;
                self.entries[place] = entry;
            }
        }
    }
}

/// All that a walk from `source` to `target` reads from `n`, which `infer_ex` has prepared for it, and where the part
/// begins that a walk writes. It never reads `Candidate::inferred`.
fn key_of_walk(n: &Inference, source: TypeId, target: TypeId) -> (Words, usize) {
    debug_assert!(n.propagated.is_none());
    let mut key = Words::new();
    key.extend([source.0, target.0, n.priority, u32::from(n.contra)]);
    key.push(n.params.len() as u32);
    for (param, c) in n.params.iter().zip(&n.candidates) {
        let has = u32::from(c.fixed.is_some()) | u32::from(c.implied_arity.is_some()) << 1;
        let fixed = c.fixed.map_or(0, |fixed| fixed.0);
        key.extend([param.0, has, fixed, c.implied_arity.unwrap_or(0) as u32]);
    }
    let state_at = key.len();
    push_state(&mut key, n);
    (key, state_at)
}

/// What a walk writes into the infos of `n`, except that it empties every `Candidate::inferred` with its first write. No
/// write takes an info back to an earlier state: the priority gets better, or the lists and the depths grow, or
/// `top_level` is cleared. So a walk has written something exactly if the state is another one after it.
fn push_state(words: &mut Words, n: &Inference) {
    for c in &n.candidates {
        let (covariant, contravariant) = (c.covariant.len() as u32, c.contravariant.len() as u32);
        words.extend([c.priority, u32::from(c.top_level), covariant, contravariant]);
        words.extend(c.covariant.iter().map(|ty| ty.0));
        words.extend_from_slice(&c.depths);
        words.extend(c.contravariant.iter().map(|ty| ty.0));
    }
}

/// Puts the infos of `n` into the state that `push_state` wrote to `words`.
fn write_state(mut words: &[u32], n: &mut Inference) {
    for c in &mut n.candidates {
        let Some((&[priority, top_level, covariant, contravariant], rest)) =
            words.split_first_chunk()
        else {
            return;
        };
        let (covariant, rest) = rest.split_at(covariant as usize);
        let (depths, rest) = rest.split_at(covariant.len());
        let (contravariant, rest) = rest.split_at(contravariant as usize);
        (c.priority, c.top_level) = (priority, top_level != 0);
        c.covariant.clear();
        c.covariant.extend(covariant.iter().map(|&ty| TypeId(ty)));
        c.depths.clear();
        c.depths.extend_from_slice(depths);
        c.contravariant.clear();
        (c.contravariant).extend(contravariant.iter().map(|&ty| TypeId(ty)));
        words = rest;
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `infer_types(n, source, target)` for `infer_ex`, to a target of a long walk.
    #[inline(never)]
    pub(super) fn infer_types_with_memo(
        &mut self,
        n: &mut Inference,
        source: TypeId,
        target: TypeId,
    ) {
        self.inference_memo.count(Count::ToLongTarget);
        if let Some(obstacle) = self.obstacle_to_leaving_out() {
            self.inference_memo.count(obstacle);
            return self.infer_types(n, source, target);
        }
        self.inference_memo.count(Count::Keyed);
        let (key, state_at) = key_of_walk(n, source, target);
        let hash = fx_hash(&key[..]);
        let disturbances = self.inference_disturbances();
        (self.inference_memo).begin_generation_if_disturbed(&disturbances);
        let in_use = self.stack_base.saturating_sub(stack_pointer());
        let mut left_out = None;
        if let Some(place) = self.inference_memo.place(hash, &key) {
            let entry = &self.inference_memo.entries[place];
            let is_disturbed = entry.generation != self.inference_memo.generation;
            // No `instantiate` of the walk would find the count at its limit, and no `is_stack_low` too little stack.
            let count = (self.instantiation_count).saturating_add(entry.instantiations);
            let has_room = count < 5_000_000
                && in_use.saturating_add(entry.stack as usize) <= self.stack_limit;
            let found = match () {
                _ if is_disturbed => Count::Disturbed,
                _ if !entry.is_confirmed => Count::NotConfirmed,
                _ if !has_room => Count::WithoutRoom,
                _ => Count::LeftOut,
            };
            if !matches!(found, Count::LeftOut) {
                self.inference_memo.count(found);
            } else if SHADOW {
                left_out = Some(entry.clone());
            } else {
                if !entry.state_after().is_empty() {
                    write_state(entry.state_after(), n);
                    n.clear_cached_inferences();
                }
                self.instantiation_count += entry.instantiations;
                self.reliability |= entry.reliability;
                let deepest = (in_use + entry.stack as usize).max(self.deepest_stack.get());
                self.deepest_stack.set(deepest);
                let calls = u64::from(entry.calls);
                self.inference_memo.counts[Count::CallsLeftOut as usize] += calls;
                self.inference_memo.count(Count::LeftOut);
                return;
            }
        }
        if left_out.is_none() && !self.is_settled_for_inference() {
            self.inference_memo.count(Count::NotSettled);
            return self.infer_types(n, source, target);
        }
        // As `begin_scope` does, which would leave a trace in a walk around this one.
        let outer_taint = std::mem::replace(&mut self.lowest_taint, usize::MAX);
        let outer_reliability = std::mem::take(&mut self.reliability);
        let outer_deepest = self.deepest_stack.replace(0);
        let before = self.readings_for_inference(n);
        self.infer_types(n, source, target);
        let after = self.readings_for_inference(n);
        let deepest = self.deepest_stack.get();
        self.deepest_stack.set(deepest.max(outer_deepest));
        let reliability = self.reliability;
        self.reliability |= outer_reliability;
        self.lowest_taint = self.lowest_taint.min(outer_taint);
        let has_left_no_trace = after.shows_no_trace_since(&before);
        if left_out.is_none() && (n.calls < LONG_WALK || !has_left_no_trace) {
            if n.calls >= LONG_WALK {
                self.inference_memo.count(Count::LeftTrace);
            }
            return;
        }
        let key_len = key.len();
        let mut words = key;
        push_state(&mut words, n);
        if words[key_len..] == words[state_at..key_len] {
            words.truncate(key_len);
        }
        let walked = Entry {
            words: Box::from(&words[..]),
            key_len: key_len as u32,
            calls: n.calls,
            instantiations: (after.instantiation_count).wrapping_sub(before.instantiation_count),
            reliability,
            is_confirmed: false,
            stack: u32::try_from(deepest.saturating_sub(in_use)).unwrap_or(u32::MAX),
            generation: self.inference_memo.generation,
        };
        if let Some(left_out) = left_out {
            if !has_left_no_trace
                || !walked.did_the_same_as(&left_out)
                || walked.stack > left_out.stack
            {
                let moved = after.moved_since(&before);
                self.walk_differs(source, target, &left_out, &walked, &moved);
            }
        } else if walked.words.len() <= InferenceMemo::MOST_WORDS {
            self.inference_memo.store(hash, walked);
        }
    }

    /// In the order of `INFERENCE_WALK_COUNTS`. A function of the program and of how it is cut into tasks.
    pub fn inference_walk_counts(&self) -> [u64; INFERENCE_WALK_COUNTS.len()] {
        self.inference_memo.counts
    }

    /// What is in progress that a walk looks at before it looks into a table, or changes, without a trace. `None`: nothing,
    /// so a walk that found all it asked for in tables finds it there now.
    /// - An instantiation. While a mapper is active, an `instantiate` with it counts once for each type and marks the type
    ///   for the next one, also where `type_of_instantiated_symbol` takes the count back. The depth has a limit. And
    ///   `instantiate` and `members` look at `index_infos_in_instantiation` and `unresolved_members` first.
    /// - A variance computation.
    /// - A check that neither reads nor stores the types of expressions, or that takes them from `rechecked_members`.
    /// - An overflow that a caller has yet to read: a comparison assigns one flag and sets the other.
    /// - What `infer_reverse_mapped_type` has on its stacks. The reduction of an intersection, in which looking up a
    ///   property creates it once more. A default or an equivalent base type.
    /// - A comparison or a mapped type that was cut short in this file: it is not evaluated again.
    /// - The declared type of an alias: `same_alias` looks for it in `stack`.
    /// - Nothing at all: then every comparison begins with `instantiation_count` at 0.
    pub(in super::super) fn obstacle_to_leaving_out(&self) -> Option<Count> {
        if self.instantiation_depth != 0
            || !self.index_infos_in_instantiation.is_empty()
            || !self.unresolved_members.is_empty()
        {
            return Some(Count::InInstantiation);
        }
        if self.in_variance_computation {
            return Some(Count::InVarianceComputation);
        }
        let is_at_rest = !self.is_rechecking()
            && !self.pulls_contextual_types()
            && !self.relation_too_complex
            && !self.relation_too_deep
            && self.reverse_mapped_source_stack.is_empty()
            && self.never_in_progress.is_empty()
            && self.defaults_in_progress.is_empty()
            && self.identical_base_types_in_progress.is_empty()
            && self.relations_cut_short.is_empty()
            && self.generic_mapped_types_cut_short.is_empty()
            && !self.stack.is_empty()
            && !(self.stack.iter()).any(|q| matches!(q, Query::Declared(_)));
        (!is_at_rest).then_some(Count::NotAtRest)
    }

    /// Whether what a walk finds in tables now stays there, where `obstacle_to_leaving_out` finds nothing.
    /// - No frame stores over what a visit inside it has stored. A type node and a conditional type do, and nothing says
    ///   whether there was such a visit. Of the other queries that do, the frame says so.
    /// - No frame is tainted: under one, a part of a type is derived each time, and counted, that is kept otherwise.
    /// - Nothing is kept for as long as a frame is in progress, or until the type of an accessor is assigned.
    pub(in super::super) fn is_settled_for_inference(&self) -> bool {
        self.provisional.is_empty()
            && self.instantiated_symbol_links.is_empty()
            && self.stack.iter().zip(&self.frames).all(|(q, frame)| {
                !matches!(q, Query::TypeNode(..) | Query::Cond(..))
                    && !frame.tainted
                    && !frame.has_result
                    && !frame.is_stored_by_nested_visit
                    && !frame.has_read_members_in_place
            })
    }

    /// Around a walk with `n`, between the two assignments to `lowest_taint`.
    fn readings_for_inference(&self, n: &Inference) -> Readings {
        Readings {
            traces: self.traces_of_inference(),
            disturbances: self.inference_disturbances(),
            lowest_taint: self.lowest_taint,
            has_met_contextual_function: n.has_met_contextual_function,
            instantiation_count: self.instantiation_count,
        }
    }

    /// Changes with everything that a walk can do and that is not stored in its `Entry`, together with the rest of
    /// `Readings`. A computation whose result a table keeps begins with `enter` or with `begin_scope`. In the order of
    /// `TRACES`.
    fn traces_of_inference(&self) -> [u64; TRACES.len()] {
        let [atoms, components, mappers, signatures, types] = self.task.own.created();
        [
            self.work,
            self.scopes_begun,
            self.instantiations_computed,
            atoms as u64,
            components as u64,
            mappers as u64,
            signatures as u64,
            types as u64,
            self.comparisons_of_deeply_nested_types,
            self.incomplete_flow_taints,
            self.reported.len() as u64,
            self.task.diagnostics.len() as u64,
            u64::from(self.relation_too_complex) | u64::from(self.relation_too_deep) << 1,
            self.unresolved_renamed_params.len() as u64,
        ]
    }

    /// Grows whenever something is found in progress, is cut short or ceases to be valid for every caller. A walk that
    /// changes it has left a trace. In the order of `DISTURBANCES`.
    ///
    /// The last one: `getUniqueTypeParameters` has put type parameters into `unresolved_renamed_params`. Whatever asks for
    /// the constraint of one takes it out, which is a trace. So a walk that is stored asks for none that is in there, until
    /// more are put in.
    fn inference_disturbances(&self) -> [u64; DISTURBANCES.len()] {
        let file = self.task.file.filter(|_| !LASTS_ACROSS_FILES);
        let from_loops = match OUTLASTS_FLOW_LOOPS {
            true => self.incomplete_flow_taints,
            false => 0,
        };
        [
            file.map_or(u64::MAX, |file| u64::from(file.0)),
            self.cycles.wrapping_sub(from_loops),
            self.taints.wrapping_sub(from_loops),
            self.limits_in_earlier_files + self.limits + self.instantiation_limit_hits,
            self.times_cut_short.get(),
            u64::from(self.variance_cycles),
            self.unmarked_refusals,
            u64::from(self.any_signature_reads),
            u64::from(self.links.times_forgotten()),
        ]
    }

    /// Under `SHADOW`. `moved`: `Readings::moved_since`.
    #[cold]
    #[inline(never)]
    fn walk_differs(
        &mut self,
        source: TypeId,
        target: TypeId,
        left_out: &Entry,
        walked: &Entry,
        moved: &str,
    ) -> ! {
        let file = self.task.file;
        let file = file.map(|file| bstr::BStr::new(self.files().module(file).file_name()));
        let (source, target) = (self.type_to_string(source), self.type_to_string(target));
        let (source, target) = (bstr::BStr::new(&source), bstr::BStr::new(&target));
        panic!(
            "the memo of inference walks would leave out a walk that does something else, while checking {file:?}, from \
             {source} to {target}. It has moved: {moved}. Stored: {left_out:?}. Made: {walked:?}"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A long walk with `key` that left the infos in the state `after`.
    fn walk(memo: &InferenceMemo, key: &[u32], after: &[u32], instantiations: u32) -> Entry {
        Entry {
            words: key.iter().chain(after).copied().collect(),
            key_len: key.len() as u32,
            calls: LONG_WALK,
            instantiations,
            generation: memo.generation,
            ..Entry::default()
        }
    }

    fn store(memo: &mut InferenceMemo, key: &[u32], after: &[u32], instantiations: u32) {
        let walked = walk(memo, key, after, instantiations);
        memo.store(fx_hash(key), walked);
    }

    fn is_left_out(memo: &InferenceMemo, key: &[u32]) -> bool {
        let place = memo.place(fx_hash(key), key);
        let entry = place.map(|place| &memo.entries[place]);
        entry.is_some_and(|entry| entry.is_confirmed && entry.generation == memo.generation)
    }

    #[test]
    fn the_first_long_walk_marks_its_target() {
        let mut memo = InferenceMemo::default();
        assert!(!memo.has_long_walk_to(TypeId(7)));
        memo.note_long_walk_to(TypeId(7));
        assert!(memo.has_long_walk_to(TypeId(7)));
        assert!(!memo.has_long_walk_to(TypeId(8)));
    }

    #[test]
    fn a_walk_that_instantiates_is_left_out_after_two_that_did_the_same() {
        let mut memo = InferenceMemo::default();
        let key = [1, 2, 3];
        store(&mut memo, &key, &[7], 0);
        assert!(is_left_out(&memo, &key));
        store(&mut memo, &key, &[7], 5);
        assert!(!is_left_out(&memo, &key));
        store(&mut memo, &key, &[7], 4);
        assert!(!is_left_out(&memo, &key));
        store(&mut memo, &key, &[8], 4);
        assert!(!is_left_out(&memo, &key));
        store(&mut memo, &key, &[8], 4);
        assert!(is_left_out(&memo, &key));
        assert!(!is_left_out(&memo, &[1, 2]));
    }

    #[test]
    fn an_entry_lasts_until_something_is_disturbed() {
        let mut memo = InferenceMemo::default();
        let key = [1, 2, 3];
        memo.begin_generation_if_disturbed(&[1; DISTURBANCES.len()]);
        store(&mut memo, &key, &[], 0);
        memo.begin_generation_if_disturbed(&[1; DISTURBANCES.len()]);
        assert!(is_left_out(&memo, &key));
        let mut disturbed = [1; DISTURBANCES.len()];
        disturbed[DISTURBANCES.len() - 1] = 2;
        memo.begin_generation_if_disturbed(&disturbed);
        assert!(!is_left_out(&memo, &key));
        assert_eq!(memo.counts[Count::Disturbances as usize], 2);
        assert_eq!(memo.counts[Count::Stored as usize], 1);
    }

    #[test]
    fn what_a_walk_has_moved_is_named() {
        let before = Readings {
            traces: [5; TRACES.len()],
            disturbances: [7; DISTURBANCES.len()],
            lowest_taint: usize::MAX,
            has_met_contextual_function: false,
            instantiation_count: 10,
        };
        let mut after = Readings {
            instantiation_count: 12,
            ..before
        };
        assert!(after.shows_no_trace_since(&before));
        assert_eq!(
            after.moved_since(&before),
            "instantiation_count from 10 to 12"
        );
        after.traces[1] += 1;
        after.disturbances[DISTURBANCES.len() - 1] += 1;
        assert!(!after.shows_no_trace_since(&before));
        assert_eq!(
            after.moved_since(&before),
            "scopes_begun from 5 to 6, times_forgotten from 7 to 8, instantiation_count from 10 to 12"
        );
        for (after, moved) in [
            (
                Readings {
                    instantiation_count: 9,
                    ..before
                },
                "instantiation_count from 10 to 9".to_owned(),
            ),
            (
                Readings {
                    lowest_taint: 3,
                    ..before
                },
                format!("lowest_taint from {} to 3", usize::MAX),
            ),
            (
                Readings {
                    has_met_contextual_function: true,
                    ..before
                },
                "has_met_contextual_function from 0 to 1".to_owned(),
            ),
        ] {
            assert!(!after.shows_no_trace_since(&before));
            assert_eq!(after.moved_since(&before), moved);
        }
    }

    #[test]
    fn the_table_grows_up_to_its_bound() {
        let mut memo = InferenceMemo::default();
        for i in 0..5000 {
            store(&mut memo, &[i, 0, 0], &[], 0);
            assert!(is_left_out(&memo, &[i, 0, 0]));
        }
        assert_eq!(memo.entries.len(), InferenceMemo::MOST_ENTRIES);
        let kept = (0..5000).filter(|&i| is_left_out(&memo, &[i, 0, 0]));
        assert!(kept.count() > InferenceMemo::MOST_ENTRIES / 2);
    }

    #[test]
    fn the_state_of_the_infos_is_written_as_it_was() {
        let params = [TypeId(10), TypeId(11)];
        let fresh = Inference::for_params(&params, None);
        let mut n = fresh.clone();
        n.candidates[0].covariant.extend([TypeId(1), TypeId(2)]);
        n.candidates[0].depths.extend([3, 0]);
        (n.candidates[0].priority, n.candidates[0].top_level) = (0, false);
        n.candidates[1].contravariant.push(TypeId(5));
        let (key, state_at) = key_of_walk(&n, TypeId(20), TypeId(21));
        assert_ne!(key, key_of_walk(&fresh, TypeId(20), TypeId(21)).0);
        let mut written = fresh;
        write_state(&key[state_at..], &mut written);
        assert_eq!(key, key_of_walk(&written, TypeId(20), TypeId(21)).0);
    }
}
