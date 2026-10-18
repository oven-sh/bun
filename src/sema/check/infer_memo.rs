//! Memoizes `inferTypes` walks.
//!
//! The checker repeats the same walk from a source type to a target type many times: once per `chooseOverload` pass,
//! and once per call of a generic function whose arguments have the same types or the same context. The memo records a
//! walk's writes to the inference infos and replays them instead of running the next identical walk.
//!
//! tsgo runs every walk, so skipping one must not be observable. These rules guarantee that:
//!
//! - The key (`key_of_walk`) contains everything a walk reads from the `Inference`. A hit compares the whole key.
//! - A stored walk had no other side effects, called traces here (`traces_of_inference`). It didn't make a query, start
//!   a computation whose result is cached in a table, compute an instantiation, create a record, or report anything. So
//!   every lookup it made hit the type store or a table.
//! - The entries it hit are final (`is_settled_for_inference`). An evaluation starts with a miss, so an entry can only
//!   be overwritten by an evaluation of the same key that started before the entry was stored and finishes after it was
//!   read. No evaluation like that was in progress when the walk ran.
//! - A cache that evicts either sits in front of a table or can rebuild an evicted entry from tables. A walk gets the
//!   same answer from it on a hit and on a miss, and the cache's contents aren't visible anywhere else. So rebuilding
//!   an entry doesn't count as a trace. If it did, whether a walk left a trace would depend on which lookups ran before
//!   it (`Checker::scopes_begun`).
//! - Some lookups miss without starting an evaluation. `type_of_mapped_prop` and the `circular_*` tables are read this
//!   way. If the entry is added later, it changes the answer only when it was produced by a cycle or a limit. So memo
//!   entries are valid until the next cycle or limit (`inference_disturbances`), either in this task or in a commit
//!   from another task (`Checker::state_of_commits`).
//! - It follows that the same walk, run later, would hit the same entries and follow the same path without filling any
//!   table. The task creates, stores, and publishes exactly what it would without the memo. The exception is
//!   in-progress state that a function checks before it looks in a table. The walk runs in that case
//!   (`obstacle_to_leaving_out`).
//! - Effects that a walk has every time it runs are stored and replayed. See the fields of `Entry`.
//!
//! The thresholds and size limits only decide which walks are stored and for how long. They never change a result.
//!
//! The memo belongs to a `Checker`, which runs one task. No other task sees it.

use super::super::*;
use super::Inference;
use crate::util::fx_hash;
use smallvec::SmallVec;

/// Labels for `Checker::inference_walk_counts`.
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

/// Index into `INFERENCE_WALK_COUNTS`.
#[derive(Copy, Clone)]
pub(in super::super) enum Count {
    /// Walks that got past the fast path in `infer_ex`.
    Walks,
    /// Walks that ran and made at least `LONG_WALK` calls.
    Long,
    ToLongTarget,
    /// This and the next two are the obstacles that `obstacle_to_leaving_out` can return.
    InInstantiation,
    InVarianceComputation,
    NotAtRest,
    Keyed,
    LeftOut,
    /// Sum of `Entry::calls` over the skipped walks.
    CallsLeftOut,
    /// The matching entry is older than the last disturbance.
    Disturbed,
    /// The matching entry still needs a second walk to confirm it. See `InferenceMemo::store`.
    NotConfirmed,
    /// The walk behind the matching entry would hit the `instantiation_count` limit or run out of native stack.
    WithoutRoom,
    /// No entry could be replayed, and `is_settled_for_inference` returned `false`.
    NotSettled,
    /// Long walks that weren't stored because they left a trace.
    LeftTrace,
    Stored,
    /// Number of generations that ended.
    Disturbances,
}

/// A walk is long if it makes at least this many `infer_types` calls. The first long walk to a target marks the target,
/// and only walks to a marked target get a key. Building the key, reading the counters twice, and scanning the frames
/// in progress cost about as much as three calls. Every walk to a marked target pays that. Only a hit earns it back.
pub(super) const LONG_WALK: u32 = 16;

/// A key, or a key followed by the state after the walk.
type Words = SmallVec<[u32; 48]>;

/// A recorded walk.
#[derive(Clone, Debug, Default)]
struct Entry {
    /// The `key_of_walk` output, then the `push_state` output after the walk, which is omitted if the walk didn't
    /// change the state. The key includes the state before the walk, so restoring the state after it has the same
    /// effect as repeating the walk's writes in order.
    words: Box<[u32]>,
    key_len: u32,
    /// Number of `infer_types` calls.
    calls: u32,
    /// Amount the walk added to `Checker::instantiation_count`. With no mapper active, every `instantiate` call that
    /// isn't a no-op adds one regardless of the current count, unless the count is already at its limit.
    instantiations: u32,
    /// Bits the walk set in `Checker::reliability`. A comparison in progress stores them with its result.
    reliability: u8,
    /// See `InferenceMemo::store`.
    is_confirmed: bool,
    /// Bytes of native stack the walk used.
    stack: u32,
    /// `InferenceMemo::generation` when the walk ran.
    generation: u64,
}

impl Entry {
    fn key(&self) -> &[u32] {
        &self.words[..self.key_len as usize]
    }

    /// Returns the state after the walk. It's empty if the walk wrote nothing.
    fn state_after(&self) -> &[u32] {
        &self.words[self.key_len as usize..]
    }

    /// True if two walks with the same key had the same outcome.
    fn did_the_same_as(&self, other: &Entry) -> bool {
        self.words == other.words
            && self.calls == other.calls
            && self.instantiations == other.instantiations
            && self.reliability == other.reliability
    }
}

/// Labels for `Checker::traces_of_inference`. Each one is a `Checker` field or a kind of record.
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

/// Labels for `Checker::inference_disturbances`.
const DISTURBANCES: [&str; 9] = [
    "cycles",
    "taints",
    "limits",
    "times_cut_short",
    "in_progress_variance_reads",
    "unmarked_refusals",
    "any_signature_reads",
    "commits",
    "times_forgotten",
];

/// Snapshot of every value that a trace would change. One is recorded before the walk and one after it.
struct Readings {
    traces: [u64; TRACES.len()],
    disturbances: [u64; DISTURBANCES.len()],
    /// Always `usize::MAX` before the walk.
    lowest_taint: usize,
    /// Always `false` before the walk.
    has_met_contextual_function: bool,
    /// Decreases only when it's reset, which is a trace. An increase is recorded in `Entry::instantiations`.
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
}

#[derive(Default)]
pub(in super::super) struct InferenceMemo {
    /// Bit set of long-walk targets, indexed by a hash of the target. Two targets can share a bit. Empty until the
    /// first long walk.
    long_targets: Vec<u64>,
    /// Indexed by a hash of the key. A new entry overwrites the old one in its slot. The length is 0 at first, then a
    /// power of two.
    entries: Vec<Entry>,
    /// Shifting a hash right by this amount yields an index into `entries`.
    shift: u32,
    /// Number of entries stored since `entries` last grew.
    stored: usize,
    /// Entries from an earlier generation are stale.
    generation: u64,
    /// `Checker::inference_disturbances` at the start of this generation.
    disturbances: [u64; DISTURBANCES.len()],
    counts: [u64; INFERENCE_WALK_COUNTS.len()],
}

impl InferenceMemo {
    /// 2^15 bits, or 4 KB.
    const LONG_TARGET_BITS: u32 = 15;
    const MOST_ENTRIES: usize = 1 << 10;
    /// Longest `Entry::words` that gets stored. Together with `MOST_ENTRIES`, it caps the memo at 4 MB per task.
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

    /// `now` is the current `Checker::inference_disturbances`.
    fn begin_generation_if_disturbed(&mut self, now: &[u64; DISTURBANCES.len()]) {
        if self.disturbances != *now {
            self.disturbances = *now;
            self.generation += 1;
            self.count(Count::Disturbances);
        }
    }

    /// Returns the slot of the entry with `key`, whatever its generation.
    fn place(&self, hash: u64, key: &[u32]) -> Option<usize> {
        let place = (hash >> self.shift) as usize;
        (self.entries.get(place)?.key() == key).then_some(place)
    }

    /// Stores `walked`. `instantiate` counts its calls, and the checker caches some results outside the tables, such as
    /// those of `simplified`. The first walk to compute one of them counts the `instantiate` calls it needs, and the
    /// next walk doesn't. So an entry with a nonzero count is replayed only after a second walk has matched the first.
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

/// Returns everything a walk from `source` to `target` reads from `n`, and the offset of the part that a walk also
/// writes. `infer_ex` must have prepared `n` for the walk. A walk never reads `Candidate::inferred`.
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

/// Appends everything a walk writes in `n`'s infos, except `Candidate::inferred`, which its first write clears in every
/// info. No write returns an info to an earlier state: the priority improves, the lists and the depths grow, or
/// `top_level` is cleared. So a walk has written something if and only if the state differs afterward.
fn push_state(words: &mut Words, n: &Inference) {
    for c in &n.candidates {
        let (covariant, contravariant) = (c.covariant.len() as u32, c.contravariant.len() as u32);
        words.extend([c.priority, u32::from(c.top_level), covariant, contravariant]);
        words.extend(c.covariant.iter().map(|ty| ty.0));
        words.extend_from_slice(&c.depths);
        words.extend(c.contravariant.iter().map(|ty| ty.0));
    }
}

/// Restores `n`'s infos to the state that `push_state` wrote to `words`.
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
    /// Runs `infer_types(n, source, target)` or replays a stored walk. `infer_ex` calls it for marked targets.
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
        if let Some(place) = self.inference_memo.place(hash, &key) {
            let entry = &self.inference_memo.entries[place];
            let is_disturbed = entry.generation != self.inference_memo.generation;
            // Neither the count limit in `instantiate` nor an `is_stack_low` check would have stopped the walk.
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
        if !self.is_settled_for_inference() {
            self.inference_memo.count(Count::NotSettled);
            return self.infer_types(n, source, target);
        }
        // Same as `begin_scope`, which isn't called here because it would leave a trace in an enclosing walk.
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
        if n.calls < LONG_WALK || !has_left_no_trace {
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
        if walked.words.len() <= InferenceMemo::MOST_WORDS {
            self.inference_memo.store(hash, walked);
        }
    }

    /// Returns the counts in `INFERENCE_WALK_COUNTS` order. They depend only on the program and its split into tasks.
    pub fn inference_walk_counts(&self) -> [u64; INFERENCE_WALK_COUNTS.len()] {
        self.inference_memo.counts
    }

    /// Returns the reason no walk can be skipped right now: in-progress state that a walk would read before it looks in
    /// a table, or would change without leaving a trace. Returns `None` if there isn't any, so a walk whose lookups all
    /// hit tables would hit them again now. The obstacles are:
    /// - An instantiation is in progress. While a mapper is active, `instantiate` with that mapper counts each type
    ///   once and marks the type so that the next call doesn't count it, even where `type_of_instantiated_symbol`
    ///   restores the count. The depth is also limited. And `instantiate` and `members` check
    ///   `index_infos_in_instantiation` and `unresolved_members` first.
    /// - A variance computation is in progress.
    /// - A check is in progress that neither reads nor stores expression types, or that reads them from
    ///   `rechecked_members`.
    /// - A caller hasn't read an overflow flag yet. A comparison overwrites `relation_too_deep` and can set
    ///   `relation_too_complex`.
    /// - `infer_reverse_mapped_type` is in progress.
    /// - An intersection is being reduced. Looking up a property during the reduction creates the property again.
    /// - A type parameter default or an identical base type is being resolved.
    /// - A comparison or a mapped type was cut short in this file. It isn't evaluated again.
    /// - The declared type of an alias is being resolved. `same_alias` searches `stack` for it.
    /// - No query is in progress at all. Every comparison then starts by resetting `instantiation_count` to 0.
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

    /// True if the table entries that a walk hits now are final. Call it only after `obstacle_to_leaving_out` has
    /// returned `None`. It requires that:
    /// - No frame will overwrite an entry that a nested visit of the same query has stored. Type node and conditional
    ///   type queries do that without recording the nested visit, so a frame for one of them always fails the test. The
    ///   other queries that do it record the visit in the frame.
    /// - No frame is tainted. Under a tainted frame, a part of a type that is normally cached is derived, and counted,
    ///   on every read.
    /// - No result is cached only while a frame is in progress, or only until the type of an accessor is assigned.
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

    /// Builds the snapshot before or after a walk with `n`. Call it only between the two assignments to `lowest_taint`.
    fn readings_for_inference(&self, n: &Inference) -> Readings {
        Readings {
            traces: self.traces_of_inference(),
            disturbances: self.inference_disturbances(),
            lowest_taint: self.lowest_taint,
            has_met_contextual_function: n.has_met_contextual_function,
            instantiation_count: self.instantiation_count,
        }
    }

    /// Returns the counters in `TRACES` order. Together with the other fields of `Readings`, they change whenever a
    /// walk does anything that isn't recorded in its `Entry`. Every computation whose result is cached in a table
    /// starts with `enter` or `begin_scope`, which `work` and `scopes_begun` count.
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

    /// Returns the counters in `DISTURBANCES` order. One of them changes whenever a computation hits a cycle or is cut
    /// short, or a result stops being valid for every caller. A walk that changes one of them has left a trace.
    ///
    /// The last counter changes when `getUniqueTypeParameters` adds type parameters to `unresolved_renamed_params`.
    /// Asking for the constraint of one removes it from the set, which is a trace. So a stored walk doesn't ask for the
    /// constraint of any type parameter in the set, and that stays true until more are added.
    fn inference_disturbances(&self) -> [u64; DISTURBANCES.len()] {
        let from_loops = self.incomplete_flow_taints;
        [
            self.cycles.wrapping_sub(from_loops),
            self.taints.wrapping_sub(from_loops),
            self.limits_in_earlier_files + self.limits + self.instantiation_limit_hits,
            self.times_cut_short.get(),
            self.in_progress_variance_reads,
            self.unmarked_refusals,
            u64::from(self.any_signature_reads),
            self.state_of_commits(),
            u64::from(self.links.times_forgotten()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds the entry for a long walk with `key` that ended in the state `after`.
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
    fn a_changed_reading_counts_as_a_trace() {
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
        after.traces[1] += 1;
        assert!(!after.shows_no_trace_since(&before));
        let mut after = Readings { ..before };
        after.disturbances[DISTURBANCES.len() - 1] += 1;
        assert!(!after.shows_no_trace_since(&before));
        for after in [
            Readings {
                instantiation_count: 9,
                ..before
            },
            Readings {
                lowest_taint: 3,
                ..before
            },
            Readings {
                has_met_contextual_function: true,
                ..before
            },
        ] {
            assert!(!after.shows_no_trace_since(&before));
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
