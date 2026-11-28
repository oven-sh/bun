//! `preprocess` at `optimizationLevel` 2, on interned parts.

use std::collections::{BTreeMap, BTreeSet};

use bun_core::w;

use super::braces::Numbers;
use super::budget::{Abort, Budget, cost};
use super::slash_split;
use crate::{Platform, SLASH, byte_at};

/// Parts with the same text have the same id.
pub(super) type PartId = u32;

pub(super) const EMPTY: PartId = 0;
const DOT: PartId = 1;
const DOT_DOT: PartId = 2;
const STAR: PartId = 3;
pub(super) const GLOBSTAR: PartId = 4;
const RESERVED_PARTS: [&[u16]; 5] = [w!(""), w!("."), w!(".."), w!("*"), w!("**")];

/// A glob is also copied into both maps of [`MergeIndex`].
const BYTES_PER_GLOB: usize = 128;
const BYTES_PER_PART: usize = 2 * size_of::<PartId>();

fn is_empty_or_dots(part: PartId) -> bool {
    matches!(part, EMPTY | DOT | DOT_DOT)
}

pub(super) struct GlobParts<'t> {
    /// By [`PartId`].
    pub(super) texts: Vec<&'t [u16]>,
    pub(super) globs: Vec<Vec<PartId>>,
}

/// `None` if the numbers have to be listed: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1334-L1340>
pub(super) fn preprocess<'t>(
    glob_set: impl Iterator<Item = &'t [u16]>,
    platform: Platform,
    numbers: Numbers,
    budget: &mut Budget<'_>,
) -> Result<Option<GlobParts<'t>>, Abort> {
    let (mut texts, mut globs) = (RESERVED_PARTS.to_vec(), Vec::new());
    let mut ids: BTreeMap<_, PartId> = RESERVED_PARTS.into_iter().zip(0..).collect();
    let mut seen = BTreeSet::new();
    for glob in glob_set {
        budget.spend(cost::LOOKUP + glob.len())?;
        if !seen.insert(glob) {
            continue;
        }
        let mut parts = Vec::new();
        slash_split(glob, platform, SLASH, |range| {
            let text = &glob[range];
            parts.push(*ids.entry(text).or_insert_with(|| {
                texts.push(text);
                texts.len() as PartId - 1
            }));
        });
        budget.spend(cost::LOOKUP * parts.len())?;
        globs.push(parts);
    }
    let mut glob_parts = GlobParts { texts, globs };
    glob_parts.first_phase_pre_process(budget)?;
    let is_done =
        glob_parts.globs.len() <= 1 || glob_parts.second_phase_pre_process(numbers, budget)?;
    Ok(is_done.then_some(glob_parts))
}

impl GlobParts<'_> {
    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1484-L1545>
    fn first_phase_pre_process(&mut self, budget: &mut Budget<'_>) -> Result<(), Abort> {
        let mut did_something = true;
        while core::mem::take(&mut did_something) {
            let mut index = 0;
            while let Some(parts) = self.globs.get_mut(index) {
                budget.spend(cost::CALL + parts.len())?;
                let mut parts = core::mem::take(parts);
                did_something |= self.split_globstar_dotdot(&mut parts, budget)?;
                did_something |= remove_dot_parts(&mut parts);
                did_something |= collapse_dotdot(&mut parts);
                self.globs[index] = parts;
                index += 1;
            }
        }
        Ok(())
    }

    /// `**/**` becomes `**`, and `**/../a/b` becomes `../a/b` and `**/a/b`.
    fn split_globstar_dotdot(
        &mut self,
        parts: &mut Vec<PartId>,
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let (mut read, mut written, mut did_split) = (0, 0, false);
        while let Some(&part) = parts.get(read) {
            read += 1;
            if part == GLOBSTAR {
                while parts.get(read) == Some(&GLOBSTAR) {
                    read += 1;
                }
                if let [DOT_DOT, first, second, ..] = parts[read..]
                    && !is_empty_or_dots(first)
                    && !is_empty_or_dots(second)
                {
                    let other = [&parts[..written], &[GLOBSTAR], &parts[read + 1..]].concat();
                    budget.spend(cost::ALLOCATION + cost::STEP * other.len())?;
                    budget.charge_memory(BYTES_PER_GLOB + BYTES_PER_PART * other.len())?;
                    self.globs.push(other);
                    did_split = true;
                    continue;
                }
            }
            parts[written] = part;
            written += 1;
        }
        parts.truncate(written);
        Ok(did_split)
    }

    /// Merges each glob into the first later one that it matches: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1553-L1565>
    fn second_phase_pre_process(
        &mut self,
        numbers: Numbers,
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let mut index = MergeIndex::new(&self.globs, budget)?;
        let mut merged = Vec::new();
        for at in 0..self.globs.len() {
            budget.spend(cost::LOOKUP)?;
            let key = index.remove(at);
            let duplicate = index.by_id.range((key.id, 0)..=(key.id, usize::MAX)).next();
            let end = duplicate.map_or(self.globs.len(), |&(_, other)| other);
            // Globs of the same shape only match if they are duplicates.
            let mut untried = index.count_by_len[key.len] - index.count_by_shape[key.shape];
            // A merged glob does not always match the same paths as the two, and equal numbers decide which ones merge.
            if untried != 0 && numbers == Numbers::AsDigitClasses {
                return Ok(false);
            }
            let mut other = at + 1;
            while untried != 0 && other < end {
                budget.spend(cost::STEP)?;
                let MergeKey { len, shape, .. } = index.keys[other];
                if len != key.len || shape == key.shape {
                    other = index.run_ends[other];
                } else if self.parts_match(at, other, &mut merged, budget)? {
                    break;
                } else {
                    untried -= 1;
                    other += 1;
                }
            }
            if untried != 0 && other < end {
                budget.spend(cost::LOOKUP + merged.len())?;
                index.merge(at, other, &merged);
                self.globs[other].clone_from(&merged);
            } else if end == self.globs.len() {
                continue;
            }
            self.globs[at] = Vec::new();
        }
        self.globs.retain(|parts| !parts.is_empty());
        Ok(true)
    }

    /// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1566-L1601>
    fn parts_match(
        &self,
        a: usize,
        b: usize,
        result: &mut Vec<PartId>,
        budget: &mut Budget<'_>,
    ) -> Result<bool, Abort> {
        let (mut a, mut b) = (&self.globs[a][..], &self.globs[b][..]);
        debug_assert_eq!(a.len(), b.len());
        let matches_star = |part: PartId| {
            part != EMPTY && part != GLOBSTAR && byte_at(self.texts[part as usize], 0) != crate::DOT
        };
        result.clear();
        let (mut took_star_of_a, mut took_star_of_b) = (false, false);
        while let ([a_part, a_rest @ ..], [b_part, b_rest @ ..]) = (a, b) {
            budget.spend(cost::STEP)?;
            if a_part == b_part {
                result.push(*a_part);
                (a, b) = (a_rest, b_rest);
            } else if *a_part == GLOBSTAR && a_rest.first() == Some(b_part) {
                result.push(GLOBSTAR);
                a = a_rest;
            } else if *b_part == GLOBSTAR && b_rest.first() == Some(a_part) {
                result.push(GLOBSTAR);
                b = b_rest;
            } else {
                if *a_part == STAR && matches_star(*b_part) {
                    took_star_of_a = true;
                } else if *b_part == STAR && matches_star(*a_part) {
                    took_star_of_b = true;
                } else {
                    return Ok(false);
                }
                if took_star_of_a && took_star_of_b {
                    return Ok(false);
                }
                result.push(STAR);
                (a, b) = (a_rest, b_rest);
            }
        }
        Ok(true)
    }
}

/// `a/./b` becomes `a/b`, and `./` becomes `.`.
fn remove_dot_parts(parts: &mut Vec<PartId>) -> bool {
    let (len, mut position) = (parts.len(), 0);
    parts.retain(|&part| {
        position += 1;
        part != DOT || position == 1 || position == len
    });
    if let [DOT, DOT | EMPTY] = parts[..] {
        parts.pop();
    }
    parts.len() != len
}

/// `a/../b` becomes `b`, and `a/../**` becomes `./**`.
fn collapse_dotdot(parts: &mut Vec<PartId>) -> bool {
    let cancels_with_dotdot = |part: PartId| !is_empty_or_dots(part) && part != GLOBSTAR;
    let (len, mut written) = (parts.len(), 0);
    for read in 0..len {
        let part = parts[read];
        if part != DOT_DOT || written == 0 || !cancels_with_dotdot(parts[written - 1]) {
            parts[written] = part;
            written += 1;
        } else if written == 1 && parts.get(read + 1) == Some(&GLOBSTAR) {
            parts[0] = DOT;
        } else {
            written -= 1;
        }
    }
    parts.truncate(written);
    if parts.is_empty() {
        parts.push(EMPTY);
    }
    written != len
}

#[derive(Clone, Copy)]
struct MergeKey {
    len: usize,
    /// The same for globs that have `*` and `**` at the same positions.
    shape: usize,
    /// The same for equal globs.
    id: usize,
}

/// The globs that the second phase has not reached yet. It spares comparing all pairs.
#[derive(Default)]
struct MergeIndex {
    shapes: BTreeMap<Vec<PartId>, usize>,
    ids: BTreeMap<Vec<PartId>, usize>,
    /// By index of the glob.
    keys: Vec<MergeKey>,
    /// By index of the glob. The globs from there up to this index have the same shape.
    run_ends: Vec<usize>,
    count_by_len: Vec<usize>,
    count_by_shape: Vec<usize>,
    /// `(id, index)`
    by_id: BTreeSet<(usize, usize)>,
}

impl MergeIndex {
    fn new(globs: &[Vec<PartId>], budget: &mut Budget<'_>) -> Result<Self, Abort> {
        let mut index = MergeIndex::default();
        for (at, parts) in globs.iter().enumerate() {
            budget.spend(cost::LOOKUP + parts.len())?;
            let key = index.insert(parts, at);
            index.keys.push(key);
        }
        index.run_ends = (1..=globs.len()).collect();
        for at in (1..globs.len()).rev() {
            if index.keys[at - 1].shape == index.keys[at].shape {
                index.run_ends[at - 1] = index.run_ends[at];
            }
        }
        Ok(index)
    }

    fn insert(&mut self, parts: &[PartId], at: usize) -> MergeKey {
        let intern = |map: &mut BTreeMap<Vec<PartId>, usize>, key| {
            let next = map.len();
            *map.entry(key).or_insert(next)
        };
        let count = |counts: &mut Vec<usize>, key: usize| {
            counts.resize(counts.len().max(key + 1), 0);
            counts[key] += 1;
        };
        let stars = parts.iter().map(|&part| match part {
            STAR | GLOBSTAR => part,
            _ => EMPTY,
        });
        let key = MergeKey {
            len: parts.len(),
            shape: intern(&mut self.shapes, stars.collect()),
            id: intern(&mut self.ids, parts.to_vec()),
        };
        count(&mut self.count_by_len, key.len);
        count(&mut self.count_by_shape, key.shape);
        self.by_id.insert((key.id, at));
        key
    }

    fn remove(&mut self, at: usize) -> MergeKey {
        let key = self.keys[at];
        self.count_by_len[key.len] -= 1;
        self.count_by_shape[key.shape] -= 1;
        self.by_id.remove(&(key.id, at));
        key
    }

    /// The globs up to `at` have been removed. If the shape of `other` changes, the rest of its run was compared with `at`, which paid for the loop.
    fn merge(&mut self, at: usize, other: usize, merged: &[PartId]) {
        let old = self.remove(other);
        self.keys[other] = self.insert(merged, other);
        if self.keys[other].shape != old.shape {
            let before = self.run_ends[at + 1..other].iter_mut().rev();
            before
                .take_while(|end| **end > other)
                .for_each(|end| *end = other);
            self.run_ends[other] = other + 1;
        }
    }
}
