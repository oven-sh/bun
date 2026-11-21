//! The diff that the package `diff` (jsdiff) 9.0.0 gives.
//!
//! Of all shortest edit scripts its forward Myers search picks the one that, read from the end, takes an insertion
//! wherever that still leads to a shortest script, else a deletion, else a match. That depends only on which tokens
//! match, so whatever cannot change it is left out of the search: the common head, most of the common tail, and tokens
//! that only one side has.

use bun_core::slice_as_bytes;
use bun_core::strings::{CodeUnits, PathByte, count_char, is_js_whitespace};

use crate::bit_rows::Matches;
use crate::{Elem, Hunk, Interner, MAX_LEN, diff_shared_tokens, search_bounded};

/// A code unit of a JS string: Latin-1 or UTF-16.
pub trait Unit: PathByte + Into<u32> {}
impl Unit for u8 {}
impl Unit for u16 {}

#[inline]
pub(crate) fn is<T: Unit>(unit: Option<&T>, ascii: u8) -> bool {
    unit == Some(&T::from_u8(ascii))
}

/// What a token is.
#[derive(Clone, Copy)]
pub enum Split {
    /// A line with its `\n`.
    Lines,
    /// A word, a run of spaces, a line ending, or any other code point.
    Words,
    /// A code point.
    Chars,
}

/// `extendedWordChars` of https://github.com/kpdecker/jsdiff/blob/v9.0.0/src/diff/word.ts
#[inline]
fn is_word(unit: u32) -> bool {
    match unit {
        0..0x80 => (unit as u8).is_ascii_alphanumeric() || unit == u32::from(b'_'),
        0xD7 | 0xF7 | 0x2C7 | 0x2D8..=0x2DD => false,
        0xAD | 0xC0..=0x2FF | 0x1E00..=0x1EFF => true,
        _ => false,
    }
}

#[inline]
fn is_space(unit: u32) -> bool {
    unit != u32::from(b'\n') && unit != u32::from(b'\r') && is_js_whitespace(unit)
}

impl Split {
    /// The end of the token that `text[at]` is in.
    #[inline]
    pub(crate) fn end<T: Unit>(self, text: &[T], at: usize) -> usize {
        let rest = &text[at..];
        let first: u32 = rest[0].into();
        let run = |of: fn(u32) -> bool| rest.iter().take_while(|&&unit| of(unit.into())).count();
        at + match self {
            Split::Lines => {
                T::index_of_unit(rest, T::from_u8(b'\n')).map_or(rest.len(), |at| at + 1)
            }
            Split::Words if is_word(first) => run(is_word),
            Split::Words if is_space(first) => run(is_space),
            Split::Words if first == u32::from(b'\r') && is(rest.get(1), b'\n') => 2,
            Split::Words | Split::Chars => {
                let is_pair = first & 0xFC00 == 0xD800
                    && rest
                        .get(1)
                        .is_some_and(|&low| low.into() & 0xFC00 == 0xDC00);
                1 + usize::from(is_pair)
            }
        }
    }

    pub fn count<T: Unit>(self, text: &[T]) -> usize {
        let unterminated = usize::from(!text.is_empty() && !is(text.last(), b'\n'));
        match (self, T::units(text)) {
            (Split::Lines, CodeUnits::U8(text)) => count_char(text, b'\n') + unterminated,
            (Split::Lines, CodeUnits::U16(text)) => {
                let newline = u16::from(b'\n');
                text.iter().filter(|&&unit| unit == newline).count() + unterminated
            }
            (Split::Chars, CodeUnits::U8(text)) => text.len(),
            _ => {
                let (mut at, mut count) = (0, 0);
                while at < text.len() {
                    at = self.end(text, at);
                    count += 1;
                }
                count
            }
        }
    }

    fn is_boundary<T: Unit>(self, text: &[T], at: usize) -> bool {
        at == 0 || at == text.len() || self.end(&text[at - 1..=at], 0) == 1
    }

    /// The length of the tokens that both texts start with.
    fn common_head<T: Unit>(self, a: &[T], b: &[T]) -> usize {
        let mut head = u8::common_prefix(slice_as_bytes(a), slice_as_bytes(b)) / size_of::<T>();
        if let Split::Lines = self
            && head < a.len().max(b.len())
        {
            return line_start(a, head);
        }
        while !(self.is_boundary(a, head) && self.is_boundary(b, head)) {
            head -= 1;
        }
        head
    }

    /// The length of the tokens that both texts, which start at a token, end with.
    fn common_tail<T: Unit>(self, a: &[T], b: &[T]) -> usize {
        let tail = u8::common_suffix(slice_as_bytes(a), slice_as_bytes(b)) / size_of::<T>();
        if self.is_boundary(a, a.len() - tail) && self.is_boundary(b, b.len() - tail) {
            return tail;
        }
        a.len() - self.end(a, a.len() - tail)
    }

    /// `from`, and where each token of `text[from..to]` ends.
    fn offsets<T: Unit>(self, text: &[T], from: usize, to: usize) -> Vec<u32> {
        let mut offsets = vec![from as u32];
        let mut at = from;
        while at < to {
            at = self.end(text, at);
            offsets.push(at as u32);
        }
        offsets
    }
}

/// Just after the last `\n` before `at`.
pub(crate) fn line_start<T: Unit>(text: &[T], at: usize) -> usize {
    T::last_index_of_unit(&text[..at], T::from_u8(b'\n')).map_or(0, |at| at + 1)
}

/// One replacement, as code units of the texts and as indices of their tokens.
#[derive(Clone, Copy)]
pub struct Edit {
    pub units: Hunk,
    pub tokens: Hunk,
}

/// `None`: it takes more than `max_edits` insertions and deletions. The texts are no longer than a JS string.
pub fn diff_text<T: Unit>(split: Split, a: &[T], b: &[T], max_edits: usize) -> Option<Vec<Edit>> {
    let head = split.common_head(a, b);
    if head == a.len() && head == b.len() {
        return Some(Vec::new());
    }
    let tail = split.common_tail(&a[head..], &b[head..]);
    let (end_a, end_b) = (a.len() - tail, b.len() - tail);
    let mut offsets_a = split.offsets(a, head, end_a);
    let mut offsets_b = split.offsets(b, head, end_b);

    let tokens = offsets_a.len() + offsets_b.len();
    let mut interner = Interner::with_capacity(match split {
        Split::Lines => tokens,
        // Most are repeats.
        Split::Words | Split::Chars => tokens.min(1024),
    });
    let [mut ids_a, mut ids_b] = [(a, &offsets_a), (b, &offsets_b)].map(|(text, offsets)| {
        offsets
            .array_windows()
            .map(|&[from, to]| interner.intern(slice_as_bytes(&text[from as usize..to as usize])))
            .collect::<Vec<u32>>()
    });

    // An edit can move into the tail (`x a` → `a a` is `-x a +a`), but not past a token that nothing before it equals.
    let mut at = end_a;
    while at < a.len() {
        let end = split.end(a, at);
        let Some(id) = interner.find(slice_as_bytes(&a[at..end])) else {
            break;
        };
        ids_a.push(id);
        ids_b.push(id);
        offsets_a.push(end as u32);
        offsets_b.push((end - end_a + end_b) as u32);
        at = end;
    }

    let distinct = interner.lines.len();
    drop(interner);
    let hunks = diff_ids(&ids_a, &ids_b, distinct, max_edits)?;
    let before = split.count(&a[..head]);
    let edit = |h: Hunk| Edit {
        units: Hunk {
            a_lo: offsets_a[h.a_lo] as usize,
            a_hi: offsets_a[h.a_hi] as usize,
            b_lo: offsets_b[h.b_lo] as usize,
            b_hi: offsets_b[h.b_hi] as usize,
        },
        tokens: Hunk {
            a_lo: before + h.a_lo,
            a_hi: before + h.a_hi,
            b_lo: before + h.b_lo,
            b_hi: before + h.b_hi,
        },
    };
    Some(hunks.into_iter().map(edit).collect())
}

/// As [`diff_text`], of tokens that are numbers below `distinct`, at most `i32::MAX` on each side.
pub fn diff_ids(a: &[u32], b: &[u32], distinct: usize, max_edits: usize) -> Option<Vec<Hunk>> {
    let hunks = diff_shared_tokens(
        a,
        b,
        distinct,
        &|shared_a, shared_b, changed_a, changed_b| {
            let unshared = (a.len() - shared_a.len()) + (b.len() - shared_b.len());
            let max_edits = max_edits.saturating_sub(unshared);
            mark(
                shared_a, shared_b, distinct, max_edits, changed_a, changed_b,
            );
        },
    );
    let edits: usize = hunks.iter().map(|h| h.deleted() + h.inserted()).sum();
    (edits <= max_edits).then_some(hunks)
}

/// Enough for Myers' search to find 8,192 insertions and as many deletions, and for 70,000 rows of 70,000 bits.
const WORK: usize = 80_000_000;
const WORK_PER_TOKEN: usize = 32;
/// About what it takes to find out what else there is to try.
const FIRST_WORK_PER_TOKEN: usize = 8;

/// Myers' search is fast if the sequences are close, which only running it tells. What rows of bits cost is known before.
fn mark(
    a: &[u32],
    b: &[u32],
    distinct: usize,
    max_edits: usize,
    changed_a: &mut [bool],
    changed_b: &mut [bool],
) {
    let all = WORK + WORK_PER_TOKEN * (a.len() + b.len());
    let first = FIRST_WORK_PER_TOKEN * (a.len() + b.len());
    let mut rows = None;
    let mut is_too_far = false;
    let mut more = || {
        let matches = Matches::new(b, distinct);
        let cost = matches.cost(a);
        let more = if cost <= all {
            rows = Some((matches, cost));
            (cost / 2).saturating_sub(first)
        } else {
            all - first
        };
        let reach = edits_within(a.len().abs_diff(b.len()), first + more).min(max_edits);
        if more > 0 && is_further_than(a, b, reach) {
            is_too_far = reach == max_edits;
            return 0;
        }
        more
    };
    let work = Work {
        left: first as isize,
        more: Some(&mut more),
    };
    match (search(a, b, max_edits, work), rows) {
        (Search::Found(script), _) => script.mark(a, b, changed_a, changed_b),
        (Search::OutOfWork, Some((matches, cost))) if !is_too_far => {
            matches.mark(a, cost, changed_a, changed_b);
        }
        (Search::OutOfWork, None) if !is_too_far && a.len().max(b.len()) < MAX_LEN => {
            search_bounded(a, b, changed_a, changed_b);
        }
        (Search::OutOfWork | Search::TooFar, _) => {
            changed_a.fill(true);
            changed_b.fill(true);
        }
    }
}

struct Work<'a> {
    left: isize,
    /// Asked once, when none is left.
    more: Option<&'a mut dyn FnMut() -> usize>,
}

impl Work<'_> {
    /// False if that was too much.
    #[inline]
    fn spend(&mut self, steps: isize) -> bool {
        self.left -= steps;
        self.left >= 0 || self.refill()
    }

    #[cold]
    fn refill(&mut self) -> bool {
        self.left += self.more.take().map_or(0, |more| more()) as isize;
        self.left >= 0
    }
}

/// [`search`] finds no longer script in `work` steps: it visits each count of insertions and deletions below its own.
fn edits_within(difference: usize, work: usize) -> usize {
    let pairs = ((difference * difference + 4 * work).isqrt() - difference) / 2;
    difference + 2 * pairs
}

const GRAMS: [usize; 5] = [2, 4, 6, 8, 16];
const MAX_SLOTS: usize = 1 << 20;

/// The hashes of the last few tokens of a sequence.
struct Grams {
    /// Of all tokens up to each of the last places.
    prefixes: [u64; 32],
    end: usize,
}

impl Grams {
    const BASE: u64 = 0x9E37_79B9_7F4A_7C15;

    fn new() -> Self {
        let prefixes = [0; 32];
        Self { prefixes, end: 0 }
    }

    fn push(&mut self, token: u32) {
        let shifted = self.prefixes[self.end % 32].wrapping_mul(Self::BASE);
        self.end += 1;
        self.prefixes[self.end % 32] = shifted.wrapping_add(u64::from(token) + 1);
    }

    /// The top bits are the best. `shift` is `BASE` to the power of `length`.
    fn last(&self, length: usize, shift: u64) -> u64 {
        let before = self.prefixes[self.end.wrapping_sub(length) % 32];
        let gram = self.prefixes[self.end % 32].wrapping_sub(before.wrapping_mul(shift));
        gram.wrapping_mul(Self::BASE)
    }
}

/// True only if every script has more than `edits` edits, which are at least the difference of the lengths.
///
/// Consecutive tokens of `a` that `b` does not have within `edits` of the same place have an edit among them
/// (Ukkonen, "Approximate string-matching with q-grams and maximal matches", 1992).
fn is_further_than(a: &[u32], b: &[u32], edits: usize) -> bool {
    if a.len() / GRAMS[0] <= edits {
        return false;
    }
    let max_deleted = (edits + a.len() - b.len()) / 2;
    let max_inserted = edits - max_deleted;
    let shifts = GRAMS.map(|length| Grams::BASE.wrapping_pow(length as u32));
    // By hash: the last place in `b` where such a gram ends. Sharing a slot only hides an edit.
    let slots = (4 * GRAMS.len() * (edits + 1))
        .next_power_of_two()
        .min(MAX_SLOTS);
    let slot = |hash: u64| (hash >> (64 - slots.trailing_zeros())) as usize;
    let mut last_end = vec![0u32; slots];
    let (mut in_a, mut in_b) = (Grams::new(), Grams::new());
    let (mut found, mut since_found) = (0, 0);
    for &token in a {
        in_a.push(token);
        since_found += 1;
        for &token in &b[in_b.end..b.len().min(in_a.end + max_inserted)] {
            in_b.push(token);
            for (length, shift) in GRAMS.into_iter().zip(shifts) {
                last_end[slot(in_b.last(length, shift))] = in_b.end as u32;
            }
        }
        let Some(longest) = GRAMS.iter().rposition(|&length| length <= since_found) else {
            continue;
        };
        let end = last_end[slot(in_a.last(GRAMS[longest], shifts[longest]))] as usize;
        if end == 0 || end + max_deleted < in_a.end {
            (found, since_found) = (found + 1, 0);
            if found > edits {
                return true;
            }
        }
    }
    false
}

enum Search {
    Found(Script),
    TooFar,
    OutOfWork,
}

/// For each edit, last to first, whether it is an insertion. After each come all the matches there are.
struct Script(Vec<bool>);

impl Script {
    fn mark(&self, a: &[u32], b: &[u32], changed_a: &mut [bool], changed_b: &mut [bool]) {
        let (mut x, mut y) = (0, 0);
        for &is_insertion in self.0.iter().rev() {
            let matches = u32::common_prefix(&a[x..], &b[y..]);
            (x, y) = (x + matches, y + matches);
            if is_insertion {
                changed_b[y] = true;
                y += 1;
            } else {
                changed_a[x] = true;
                x += 1;
            }
        }
    }
}

/// A script has as many edits as the lengths differ by, and some pairs of an insertion and a deletion. Looking for one
/// with at most `pairs` of those takes (`pairs` + 1) × (`pairs` + difference + 1) steps.
fn search(a: &[u32], b: &[u32], max_edits: usize, mut work: Work<'_>) -> Search {
    let Some(spare) = max_edits.checked_sub(a.len().abs_diff(b.len())) else {
        return Search::TooFar;
    };
    let max_pairs = (spare / 2).min(a.len()).min(b.len());
    let mut pairs = 2;
    loop {
        match search_within(a, b, pairs.min(max_pairs), &mut work) {
            Search::TooFar if pairs < max_pairs => pairs *= 4,
            done => return done,
        }
    }
}

// Inlined, its inner loop runs out of registers.
#[inline(never)]
fn search_within(a: &[u32], b: &[u32], pairs: usize, work: &mut Work<'_>) -> Search {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let goal = n - m;
    let max_edits = goal.abs() + 2 * pairs as isize;
    let origin = (max_edits - goal) / 2 + 1;
    // By diagonal k = x - y: one more than the furthest x, so that 0 loses to every path.
    let mut furthest = vec![0u32; max_edits as usize + 3];
    let mut trace = Trace::default();

    let start = u32::common_prefix(a, b) as isize;
    if start == n && start == m {
        return Search::Found(Script(Vec::new()));
    }
    furthest[origin as usize] = start as u32 + 1;
    // A step past a path that has reached the end of `b` (of `a`) would leave the grid.
    let mut lowest = if start == m { 1 } else { isize::MIN };
    let mut highest = if start == n { -1 } else { isize::MAX };

    for d in 1..=max_edits {
        let lo = (-d).max(goal - (max_edits - d)).max(lowest);
        let hi = d.min(goal + (max_edits - d)).min(highest);
        let bits_before = trace.bits;
        let steps = (hi - lo) as usize / 2 + 1;
        let (before, from_lo) = furthest.split_at_mut((origin + lo) as usize);
        let mut below = before[before.len() - 1];
        let mut k = lo;
        'round: for diagonals in from_lo.as_chunks_mut::<2>().0[..steps].chunks_mut(64) {
            let mut word = 0u64;
            for [here, above] in diagonals.iter_mut() {
                let is_insertion = below < *above;
                word = word << 1 | u64::from(is_insertion);
                let mut x = if is_insertion { *above - 1 } else { below } as usize;
                let mut y = (x as isize - k) as usize;
                below = *above;
                if let (Some(in_a), Some(in_b)) = (a.get(x), b.get(y)) {
                    if in_a != in_b {
                        *here = x as u32 + 1;
                        k += 2;
                        continue;
                    }
                    let from = x;
                    (x, y) = (x + 1, y + 1);
                    while x < a.len() && y < b.len() && a[x] == b[y] {
                        (x, y) = (x + 1, y + 1);
                    }
                    if !work.spend((x - from) as isize) {
                        return Search::OutOfWork;
                    }
                }
                *here = x as u32 + 1;
                if x == a.len() {
                    trace.push(word, (k - lo) as usize / 2 % 64 + 1);
                    if y == b.len() {
                        trace.end_round(lo, bits_before);
                        return Search::Found(trace.backtrack(k));
                    }
                    highest = k - 1;
                    break 'round;
                }
                if y == b.len() {
                    lowest = k + 1;
                }
                k += 2;
            }
            trace.push(word, diagonals.len());
        }
        trace.end_round(lo, bits_before);
        if !work.spend((k - lo) / 2 + 1) {
            return Search::OutOfWork;
        }
    }
    Search::TooFar
}

/// For each step of [`search_within`], whether it is an insertion. There can be a round for each token.
#[derive(Default)]
struct Trace {
    /// From the highest bit of each.
    words: Vec<u64>,
    bits: usize,
    /// The first diagonal, and the number of bits.
    rounds: Vec<(i32, u32)>,
}

impl Trace {
    /// The lowest `count` bits of `word`, 1 to 64.
    fn push(&mut self, word: u64, count: usize) {
        let (word, used) = (word << (64 - count), self.bits % 64);
        self.bits += count;
        match self.words.last_mut() {
            Some(last) if used > 0 => {
                *last |= word >> used;
                if used + count > 64 {
                    self.words.push(word << (64 - used));
                }
            }
            _ => self.words.push(word),
        }
    }

    fn end_round(&mut self, lo: isize, bits_before: usize) {
        let count = self.bits - bits_before;
        self.rounds.push((lo as i32, count as u32));
    }

    fn backtrack(&self, mut k: isize) -> Script {
        let mut start = self.bits;
        let step = |&(lo, count): &(i32, u32)| {
            start -= count as usize;
            let at = start + (k - lo as isize) as usize / 2;
            let is_insertion = self.words[at / 64] << (at % 64) >> 63 == 1;
            k += if is_insertion { 1 } else { -1 };
            is_insertion
        };
        Script(self.rounds.iter().rev().map(step).collect())
    }
}
