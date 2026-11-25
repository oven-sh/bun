//! `preprocess` of minimatch with the `optimizationLevel` 2. What is between two slashes is a number here, the same for the same text.

use std::collections::{BTreeMap, BTreeSet};

use super::{Stop, Work, split};
use crate::{DOT, byte_at};

pub(super) type Part = u32;

pub(super) const EMPTY: Part = 0;
const HERE: Part = 1;
const UP: Part = 2;
const STAR: Part = 3;
pub(super) const GLOBSTAR: Part = 4;

const KNOWN: [&[u16]; 5] = {
    const DOT: u16 = b'.' as u16;
    const STAR: u16 = b'*' as u16;
    [&[], &[DOT], &[DOT, DOT], &[STAR], &[STAR, STAR]]
};

/// About what it takes to find a text among many, apart from comparing it.
const WORK_PER_LOOKUP: usize = 32;

pub(super) struct Globs<'t> {
    /// The text of each [`Part`].
    pub(super) texts: Vec<&'t [u16]>,
    pub(super) globs: Vec<Vec<Part>>,
}

impl<'t> Globs<'t> {
    pub(super) fn of(
        expanded: impl Iterator<Item = &'t [u16]>,
        win32: bool,
        work: &mut Work<'_>,
    ) -> Result<Self, Stop> {
        let mut all = Globs {
            texts: KNOWN.to_vec(),
            globs: Vec::new(),
        };
        let (mut seen, mut parts) = (BTreeSet::new(), BTreeMap::new());
        for glob in expanded {
            work.spend(WORK_PER_LOOKUP + glob.len())?;
            if !seen.insert(glob) {
                continue;
            }
            let mut of_glob = Vec::new();
            split(glob, win32, |range| {
                let text = &glob[range];
                let known = KNOWN.iter().position(|&known| known == text);
                of_glob.push(known.map_or_else(
                    || {
                        *parts.entry(text).or_insert_with(|| {
                            all.texts.push(text);
                            all.texts.len() as Part - 1
                        })
                    },
                    |known| known as Part,
                ));
            });
            work.spend(WORK_PER_LOOKUP * of_glob.len())?;
            all.globs.push(of_glob);
        }
        all.simplify_each(work)?;
        if all.globs.len() > 1 {
            all.merge(work)?;
        }
        Ok(all)
    }

    /// `firstPhasePreProcess`
    fn simplify_each(&mut self, work: &mut Work<'_>) -> Result<(), Stop> {
        let mut has_changed = true;
        while core::mem::take(&mut has_changed) {
            let mut index = 0;
            while let Some(glob) = self.globs.get_mut(index) {
                work.spend(8 + glob.len())?;
                let mut glob = core::mem::take(glob);
                has_changed |= self.split_at_up_behind_globstar(&mut glob, work)?;
                has_changed |= remove_here(&mut glob);
                has_changed |= go_up(&mut glob);
                self.globs[index] = glob;
                index += 1;
            }
        }
        Ok(())
    }

    /// `**/**` becomes `**`, and `**/../a/b` becomes `../a/b` and `**/a/b`.
    fn split_at_up_behind_globstar(
        &mut self,
        glob: &mut Vec<Part>,
        work: &mut Work<'_>,
    ) -> Result<bool, Stop> {
        let (mut read, mut written, mut has_split) = (0, 0, false);
        while let Some(&part) = glob.get(read) {
            read += 1;
            if part == GLOBSTAR {
                while glob.get(read) == Some(&GLOBSTAR) {
                    read += 1;
                }
                if let [UP, first, second, ..] = glob[read..]
                    && first > UP
                    && second > UP
                {
                    let other = [&glob[..written], &[GLOBSTAR], &glob[read + 1..]].concat();
                    work.spend(64 + 4 * other.len())?;
                    self.globs.push(other);
                    has_split = true;
                    continue;
                }
            }
            glob[written] = part;
            written += 1;
        }
        glob.truncate(written);
        Ok(has_split)
    }

    /// `secondPhasePreProcess`, which merges each with the first behind it that it can be merged with.
    fn merge(&mut self, work: &mut Work<'_>) -> Result<(), Stop> {
        let mut index = Index::default();
        for (at, glob) in self.globs.iter().enumerate() {
            work.spend(WORK_PER_LOOKUP + glob.len())?;
            index.insert(glob, at);
        }
        for at in 0..self.globs.len() {
            let glob = core::mem::take(&mut self.globs[at]);
            work.spend(WORK_PER_LOOKUP + glob.len())?;
            let (shape, whole) = index.remove(at);
            let next_same = index
                .by_whole
                .range((whole, 0)..=(whole, usize::MAX))
                .next();
            let mut found = next_same.map(|&(_, other)| (other, glob.clone()));
            // Two that have their stars in the same places can only be merged if they are the same.
            let mut from = (glob.len(), 0, 0);
            while let Some(&(length, other_shape, other)) = index.by_shape.range(from..).next()
                && length == glob.len()
            {
                work.spend(WORK_PER_LOOKUP)?;
                from = (length, other_shape + 1, 0);
                if other_shape == shape {
                    continue;
                }
                for &(_, _, other) in index.by_shape.range((length, other_shape, other)..from) {
                    if found.as_ref().is_some_and(|found| found.0 < other) {
                        break;
                    }
                    if let Some(merged) = self.merged(&glob, &self.globs[other], work)? {
                        found = Some((other, merged));
                        break;
                    }
                }
            }
            match found {
                None => self.globs[at] = glob,
                Some((other, merged)) => {
                    index.remove(other);
                    index.insert(&merged, other);
                    self.globs[other] = merged;
                }
            }
        }
        self.globs.retain(|glob| !glob.is_empty());
        Ok(())
    }

    /// `partsMatch` of two that have the same length.
    fn merged(
        &self,
        mut a: &[Part],
        mut b: &[Part],
        work: &mut Work<'_>,
    ) -> Result<Option<Vec<Part>>, Stop> {
        let is_in_star = |part: Part| {
            part != EMPTY && part != GLOBSTAR && byte_at(self.texts[part as usize], 0) != DOT
        };
        let mut merged = Vec::new();
        let (mut took_star_of_a, mut took_star_of_b) = (false, false);
        while let ([of_a, rest_of_a @ ..], [of_b, rest_of_b @ ..]) = (a, b) {
            work.spend(4)?;
            if of_a == of_b {
                merged.push(*of_a);
                (a, b) = (rest_of_a, rest_of_b);
            } else if *of_a == GLOBSTAR && rest_of_a.first() == Some(of_b) {
                merged.push(GLOBSTAR);
                a = rest_of_a;
            } else if *of_b == GLOBSTAR && rest_of_b.first() == Some(of_a) {
                merged.push(GLOBSTAR);
                b = rest_of_b;
            } else {
                if *of_a == STAR && is_in_star(*of_b) {
                    took_star_of_a = true;
                } else if *of_b == STAR && is_in_star(*of_a) {
                    took_star_of_b = true;
                } else {
                    return Ok(None);
                }
                if took_star_of_a && took_star_of_b {
                    return Ok(None);
                }
                merged.push(STAR);
                (a, b) = (rest_of_a, rest_of_b);
            }
        }
        Ok(Some(merged))
    }
}

/// `a/./b` becomes `a/b`, and `./` becomes `.`.
fn remove_here(glob: &mut Vec<Part>) -> bool {
    let (length, mut at) = (glob.len(), 0);
    glob.retain(|&part| {
        at += 1;
        part != HERE || at == 1 || at == length
    });
    if let [HERE, HERE | EMPTY] = glob[..] {
        glob.pop();
    }
    glob.len() != length
}

/// `a/../b` becomes `b`.
fn go_up(glob: &mut Vec<Part>) -> bool {
    let (length, mut written) = (glob.len(), 0);
    for read in 0..length {
        let part = glob[read];
        if part != UP || written == 0 || matches!(glob[written - 1], EMPTY..=UP | GLOBSTAR) {
            glob[written] = part;
            written += 1;
        } else if written == 1 && glob.get(read + 1) == Some(&GLOBSTAR) {
            glob[0] = HERE;
        } else {
            written -= 1;
        }
    }
    glob.truncate(written);
    if glob.is_empty() {
        glob.push(EMPTY);
    }
    written != length
}

/// The globs that are yet to be looked at.
#[derive(Default)]
struct Index {
    /// A number for each arrangement of `*` and `**`.
    shapes: BTreeMap<Vec<Part>, usize>,
    /// A number for each glob.
    wholes: BTreeMap<Vec<Part>, usize>,
    /// The length, the shape and the whole of the glob with that index.
    keys: Vec<(usize, usize, usize)>,
    by_shape: BTreeSet<(usize, usize, usize)>,
    by_whole: BTreeSet<(usize, usize)>,
}

impl Index {
    fn insert(&mut self, glob: &[Part], at: usize) {
        let number_in = |numbers: &mut BTreeMap<Vec<Part>, usize>, key| {
            let next = numbers.len();
            *numbers.entry(key).or_insert(next)
        };
        let stars = glob.iter().map(|&part| match part {
            STAR | GLOBSTAR => part,
            _ => EMPTY,
        });
        let shape = number_in(&mut self.shapes, stars.collect());
        let whole = number_in(&mut self.wholes, glob.to_vec());
        self.by_shape.insert((glob.len(), shape, at));
        self.by_whole.insert((whole, at));
        self.keys.resize(self.keys.len().max(at + 1), (0, 0, 0));
        self.keys[at] = (glob.len(), shape, whole);
    }

    /// Answers its shape and whole.
    fn remove(&mut self, at: usize) -> (usize, usize) {
        let (length, shape, whole) = self.keys[at];
        self.by_shape.remove(&(length, shape, at));
        self.by_whole.remove(&(whole, at));
        (shape, whole)
    }
}
