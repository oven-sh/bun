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
    if let (Split::Chars, CodeUnits::U8(a), CodeUnits::U8(b)) = (split, T::units(a), T::units(b)) {
        return diff_latin1_chars(a, b, head, tail, max_edits);
    }
    let mut offsets_a = split.offsets(a, head, end_a);
    let mut offsets_b = split.offsets(b, head, end_b);

    let tokens = offsets_a.len() + offsets_b.len();
    let mut interner = Interner::with_capacity(match split {
        // Short lines are repeats.
        Split::Lines => tokens.min((end_a + end_b - 2 * head) / 4),
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

/// A token is a code unit, and that is its number.
fn diff_latin1_chars(
    a: &[u8],
    b: &[u8],
    head: usize,
    tail: usize,
    max_edits: usize,
) -> Option<Vec<Edit>> {
    let (end_a, end_b) = (a.len() - tail, b.len() - tail);
    let mut is_seen = [false; 256];
    for text in [&a[head..end_a], &b[head..end_b]] {
        text.iter()
            .for_each(|&unit| is_seen[usize::from(unit)] = true);
    }
    let in_tail = a[end_a..]
        .iter()
        .take_while(|&&unit| is_seen[usize::from(unit)]);
    let reach = in_tail.count();
    let [ids_a, ids_b] = [&a[head..end_a + reach], &b[head..end_b + reach]]
        .map(|text| text.iter().map(|&unit| unit.into()).collect::<Vec<u32>>());
    let edit = |h: Hunk| {
        let units = Hunk {
            a_lo: head + h.a_lo,
            a_hi: head + h.a_hi,
            b_lo: head + h.b_lo,
            b_hi: head + h.b_hi,
        };
        Edit {
            units,
            tokens: units,
        }
    };
    let hunks = diff_ids(&ids_a, &ids_b, is_seen.len(), max_edits)?;
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

/// Enough for 70,000 rows of 70,000 bits.
const ROW_WORK: usize = 80_000_000;
const ROW_WORK_PER_TOKEN: usize = 32;
/// Enough for 8,300 insertions and as many deletions.
const SEARCH_WORK: usize = 70_000_000;
const SEARCH_WORK_PER_TOKEN: usize = 16;
/// About what it takes to find out what else there is to try.
const FIRST_WORK_PER_TOKEN: usize = 8;

/// The search is fast if the sequences are close, which only running it tells. What rows of bits cost is known before.
fn mark(
    a: &[u32],
    b: &[u32],
    distinct: usize,
    max_edits: usize,
    changed_a: &mut [bool],
    changed_b: &mut [bool],
) {
    let tokens = a.len() + b.len();
    let first = FIRST_WORK_PER_TOKEN * tokens;
    let mut rows = None;
    let mut is_too_far = false;
    let mut more = || {
        let matches = Matches::new(b, distinct);
        let cost = matches.cost(a);
        let more = if cost <= ROW_WORK + ROW_WORK_PER_TOKEN * tokens {
            rows = Some((matches, cost));
            (cost / 3).saturating_sub(first)
        } else {
            SEARCH_WORK + SEARCH_WORK_PER_TOKEN * tokens - first
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

/// A script has as many edits as the lengths differ by, and some pairs of an insertion and a deletion. Each round allows
/// one more pair (Wu, Manber, Myers and Miller, "An O(NP) sequence comparison algorithm", 1990).
fn search(a: &[u32], b: &[u32], max_edits: usize, mut work: Work<'_>) -> Search {
    let Some(spare) = max_edits.checked_sub(a.len().abs_diff(b.len())) else {
        return Search::TooFar;
    };
    let goal = a.len() as isize - b.len() as isize;
    // Of the diagonals k = x - y from the goal outwards: the furthest y of those below it, the furthest x of those above.
    let mut below = vec![NOWHERE; goal.max(0) as usize + 1];
    let mut above = vec![NOWHERE; (-goal).max(0) as usize + 1];
    let mut start = if goal > 0 { (0, NOWHERE) } else { (NOWHERE, 0) };
    let mut trace = Trace::default();

    for pairs in 0..=spare / 2 {
        let y = sweep(b, a, &mut below, start.0, 1, &mut trace, &mut work);
        let x = sweep(a, b, &mut above, start.1, 0, &mut trace, &mut work);
        let (Some(x), Some(y)) = (x, y) else {
            return Search::OutOfWork;
        };
        start = (NOWHERE, NOWHERE);
        let (inserted, deleted) = (x as isize, y as isize + goal);
        trace.push(u64::from(inserted >= deleted), 1);
        let x = inserted.max(deleted);
        let matches = u32::common_prefix(&a[x as usize..], &b[(x - goal) as usize..]) as isize;
        if x + matches == a.len() as isize {
            return Search::Found(trace.backtrack(goal, pairs as isize));
        }
        if !work.spend(matches + 1) {
            return Search::OutOfWork;
        }
        (below[0], above[0]) = ((x + matches - goal) as i32, (x + matches) as i32);
        below.push(NOWHERE);
        above.push(NOWHERE);
    }
    Search::TooFar
}

/// Loses to every place, even after a step.
const NOWHERE: i32 = -3;

/// The diagonals on one side of the goal, towards it. `furthest` has places in `own`. A step towards the goal, from
/// `outer`, skips a token of `other`. A step away from it skips one of `own`, and gets `tie` on top of where it leads.
fn sweep(
    own: &[u32],
    other: &[u32],
    furthest: &mut [i32],
    mut outer: i32,
    tie: i32,
    trace: &mut Trace,
    work: &mut Work<'_>,
) -> Option<i32> {
    let mut end = furthest.len();
    while end > 1 {
        let steps = (end - 1).min(64);
        let shift = other.len() as isize - own.len() as isize - (end as isize - 1);
        let some = &mut furthest[end - 1 - steps..end];
        let (word, matches) = sweep_some(own, other, some, shift, outer, tie);
        outer = some[1];
        trace.push(word, steps);
        if !work.spend((steps + matches) as isize) {
            return None;
        }
        end -= steps;
    }
    Some(outer)
}

/// All but the first of `furthest`, from the last. There, `own[at]` is next to `other[at + shift]`. The steps, and the
/// number of matches: no more than `own` has tokens, because each step starts where the last has ended.
// Inlined, its loop runs out of registers.
#[inline(never)]
fn sweep_some(
    own: &[u32],
    other: &[u32],
    furthest: &mut [i32],
    mut shift: isize,
    mut outer: i32,
    tie: i32,
) -> (u64, usize) {
    let (mut word, mut matches) = (0u64, 0);
    for i in (1..furthest.len()).rev() {
        let inner = furthest[i - 1] + 1;
        word = word << 1 | u64::from(inner > outer - tie);
        outer = inner.max(outer);
        while let Some(one) = own.get(outer as usize)
            && other.get((outer as isize + shift) as usize) == Some(one)
        {
            outer += 1;
            matches += 1;
        }
        furthest[i] = outer;
        shift += 1;
    }
    (word, matches)
}

/// For each step of [`search`], whether it leads away from the goal. On the goal, whether it is an insertion.
#[derive(Default)]
struct Trace {
    /// From the highest bit of each.
    words: Vec<u64>,
    bits: usize,
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

    fn backtrack(&self, goal: isize, mut pairs: isize) -> Script {
        let mut script = Vec::with_capacity((goal.abs() + 2 * pairs) as usize);
        let mut k = goal;
        while pairs > 0 || k != 0 {
            let (below, above) = (goal.max(0) + pairs, (-goal).max(0) + pairs);
            let in_round = if k < goal {
                below - (goal - k)
            } else {
                below + above - (k - goal)
            };
            let at = (pairs * (goal.abs() + pairs) + in_round) as usize;
            let bit = self.words[at / 64] << (at % 64) >> 63 == 1;
            let is_insertion = bit != (k > goal);
            script.push(is_insertion);
            pairs -= isize::from(bit && k != goal);
            k += if is_insertion { 1 } else { -1 };
        }
        Script(script)
    }
}
