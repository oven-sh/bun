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
//!   type store and in tables, which keep what they have. The same walk made later reads the same, takes the same path and
//!   fills no table either, so the task creates, stores and publishes what it does without the memo.
//! - Nothing was in progress, at the start of either walk, that a function asks about before it looks into a table and
//!   without a trace (`is_at_rest_for_inference`).
//! - What is assigned while something is in progress can be assigned again once that is cut short. So an entry lasts until
//!   the next cycle, taint, limit or file (`inference_disturbances`).
//! - What a walk does every time it is made is stored and done again: see the fields of `Entry`.
//!
//! The thresholds and the bounds decide which walks are stored and for how long. They change the time, never a result.
//!
//! The memo belongs to a `Checker`, which runs one task. Nothing of it goes to a barrier.

use super::super::*;
use super::{Inference, MOST_CALLS};
use crate::util::fx_hash;
use smallvec::SmallVec;

/// `false`: every walk is made.
pub(super) const ENABLED: bool = true;

/// Every walk that the memo would leave out is made, and compared with what would have been written in its place. A
/// difference is a panic that names the types and the file. For debugging.
const SHADOW: bool = false;

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
    disturbances: [u64; 9],
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

    #[cold]
    pub(super) fn note_long_walk_to(&mut self, target: TypeId) {
        if self.long_targets.is_empty() {
            self.long_targets = vec![0; 1 << (Self::LONG_TARGET_BITS - 6)];
        }
        let bit = Self::bit_of(target);
        self.long_targets[bit / 64] |= 1 << (bit % 64);
    }

    /// `now`: `Checker::inference_disturbances`.
    fn begin_generation_if_disturbed(&mut self, now: &[u64; 9]) {
        if self.disturbances != *now {
            self.disturbances = *now;
            self.generation += 1;
        }
    }

    fn place(&self, hash: u64, key: &[u32]) -> Option<usize> {
        let place = (hash >> self.shift) as usize;
        let entry = self.entries.get(place)?;
        (entry.generation == self.generation && entry.key() == key).then_some(place)
    }

    /// `instantiate` counts its calls. A walk that is the first to compute what the checker keeps outside the tables, as
    /// `simplified` does, counts the calls which that takes, and the next walk does not. So a count other than 0 is
    /// written again only after a second walk has done the same as the first.
    fn store(&mut self, hash: u64, mut walked: Entry) {
        walked.is_confirmed = walked.instantiations == 0;
        if let Some(place) = self.place(hash, walked.key()) {
            let earlier = &mut self.entries[place];
            walked.is_confirmed |= walked.did_the_same_as(earlier);
            walked.stack = walked.stack.max(earlier.stack);
            *earlier = walked;
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
            if entry.generation == self.generation && entry.key_len != 0 {
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
        if !self.is_at_rest_for_inference() {
            return self.infer_types(n, source, target);
        }
        let (key, state_at) = key_of_walk(n, source, target);
        let hash = fx_hash(&key[..]);
        let disturbances = self.inference_disturbances();
        (self.inference_memo).begin_generation_if_disturbed(&disturbances);
        let in_use = self.stack_base.saturating_sub(stack_pointer());
        let mut left_out = None;
        if let Some(place) = self.inference_memo.place(hash, &key)
            && let entry = &self.inference_memo.entries[place]
            && entry.is_confirmed
            // No `instantiate` of the walk would find the count at its limit, and no `is_stack_low` too little stack.
            && self.instantiation_count.saturating_add(entry.instantiations) < 5_000_000
            && in_use.saturating_add(entry.stack as usize) <= self.stack_limit
        {
            if SHADOW {
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
                return;
            }
        }
        let traces = self.traces_of_inference();
        let count = self.instantiation_count;
        // As `begin_scope` does, which would leave a trace in a walk around this one.
        let outer_taint = std::mem::replace(&mut self.lowest_taint, usize::MAX);
        let outer_reliability = std::mem::take(&mut self.reliability);
        let outer_deepest = self.deepest_stack.replace(0);
        self.infer_types(n, source, target);
        let deepest = self.deepest_stack.get();
        self.deepest_stack.set(deepest.max(outer_deepest));
        let reliability = self.reliability;
        self.reliability |= outer_reliability;
        let is_tainted = self.lowest_taint != usize::MAX;
        self.lowest_taint = self.lowest_taint.min(outer_taint);
        let has_left_no_trace = !is_tainted
            && n.calls <= MOST_CALLS
            && self.instantiation_count >= count
            && self.traces_of_inference() == traces
            && self.inference_disturbances() == disturbances;
        if left_out.is_none() && !(has_left_no_trace && n.calls >= LONG_WALK) {
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
            instantiations: self.instantiation_count.wrapping_sub(count),
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
                self.walk_differs(source, target, &left_out, &walked, has_left_no_trace);
            }
        } else if walked.words.len() <= InferenceMemo::MOST_WORDS {
            self.inference_memo.store(hash, walked);
        }
    }

    /// Whether nothing is in progress that a walk could notice without a trace:
    /// - An instantiation. While a mapper is active `instantiate` counts fewer calls, and its depth has a limit.
    /// - A variance computation. `variances_worker` has no result for a symbol in progress.
    /// - A check that neither reads nor stores the types of expressions, or that takes them from `rechecked_members`.
    /// - An overflow that a caller has yet to read: a comparison sets the flag, and whether one has cannot be seen.
    /// - Results that last as long as a frame does: `provisional`, `context_checked_under`.
    /// - What `members`, `instantiate` and `infer_reverse_mapped_type` look at before their tables.
    /// - The reduction of an intersection, a default or an equivalent base type: whoever asks for the one in progress gets
    ///   an answer at once, which is not the one that is stored in the end.
    /// - The declared type of an alias: `same_alias` looks for it in `stack`.
    /// - A frame whose result was assigned by a visit inside it, which it assigns again, or is not final.
    ///
    /// And whether something is in progress at all: otherwise every comparison begins with `instantiation_count` at 0.
    fn is_at_rest_for_inference(&self) -> bool {
        self.instantiation_depth == 0
            && !self.in_variance_computation
            && !self.is_rechecking()
            && !self.pulls_contextual_types()
            && !self.relation_too_complex
            && !self.relation_too_deep
            && self.provisional.is_empty()
            && self.context_checked_under.is_empty()
            && self.unresolved_members.is_empty()
            && self.index_infos_in_instantiation.is_empty()
            && self.reverse_mapped_source_stack.is_empty()
            && self.never_in_progress.is_empty()
            && self.defaults_in_progress.is_empty()
            && self.identical_base_types_in_progress.is_empty()
            && !self.stack.is_empty()
            && self.stack.iter().zip(&self.frames).all(|(q, frame)| {
                !matches!(q, Query::Declared(_))
                    && !frame.tainted
                    && !frame.has_result
                    && !frame.is_stored_by_nested_visit
                    && !frame.has_read_members_in_place
            })
    }

    /// Changes with everything that a walk can do and that is not stored in its `Entry`, together with
    /// `inference_disturbances` and `lowest_taint`. A computation whose result a table keeps begins with `enter` or with
    /// `begin_scope`.
    fn traces_of_inference(&self) -> [u64; 8] {
        [
            self.work,
            self.scopes_begun,
            self.instantiations_computed,
            self.task.own.lengths().iter().sum::<usize>() as u64,
            self.comparisons_of_deeply_nested_types,
            self.reported.len() as u64,
            self.task.diagnostics.len() as u64,
            u64::from(self.relation_too_complex) | u64::from(self.relation_too_deep) << 1,
        ]
    }

    /// Changes whenever something is found in progress, is cut short or ceases to be valid for every caller, and with the
    /// file, at the start of which `check_file` resets two of these.
    fn inference_disturbances(&self) -> [u64; 9] {
        [
            self.task.file.map_or(u64::MAX, |file| u64::from(file.0)),
            self.cycles,
            self.limits,
            self.taints,
            self.times_cut_short.get(),
            self.instantiation_limit_hits,
            u64::from(self.variance_cycles),
            self.unmarked_refusals,
            u64::from(self.any_signature_reads),
        ]
    }

    /// Under `SHADOW`.
    #[cold]
    #[inline(never)]
    fn walk_differs(
        &mut self,
        source: TypeId,
        target: TypeId,
        left_out: &Entry,
        walked: &Entry,
        has_left_no_trace: bool,
    ) -> ! {
        let file = self.task.file;
        let file = file.map(|file| bstr::BStr::new(self.files().module(file).file_name()));
        let (source, target) = (self.type_to_string(source), self.type_to_string(target));
        let (source, target) = (bstr::BStr::new(&source), bstr::BStr::new(&target));
        panic!(
            "the memo of inference walks would leave out a walk that does something else, while checking {file:?}, from \
             {source} to {target}. It has left no trace: {has_left_no_trace}. Stored: {left_out:?}. Made: {walked:?}"
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
        place.is_some_and(|place| memo.entries[place].is_confirmed)
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
        memo.begin_generation_if_disturbed(&[1; 9]);
        store(&mut memo, &key, &[], 0);
        memo.begin_generation_if_disturbed(&[1; 9]);
        assert!(is_left_out(&memo, &key));
        memo.begin_generation_if_disturbed(&[2; 9]);
        assert!(!is_left_out(&memo, &key));
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
