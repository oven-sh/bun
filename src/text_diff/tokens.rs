//! The diff that the package `diff` (jsdiff) 9.0.0 gives.
//!
//! Of all shortest edit scripts its forward Myers search picks the one that, read from the end, takes an insertion
//! wherever that still leads to a shortest script, else a deletion, else a match. That depends only on which tokens
//! match, so whatever cannot change it is left out of the search: the common head, most of the common tail, and tokens
//! that only one side has.

use bun_core::slice_as_bytes;
use bun_core::strings::{CodeUnits, PathByte, count_char, is_js_whitespace};

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
        |shared_a, shared_b, changed_a, changed_b| {
            let unshared = (a.len() - shared_a.len()) + (b.len() - shared_b.len());
            let max_edits = max_edits.saturating_sub(unshared);
            match search(shared_a, shared_b, max_edits) {
                Search::Found(script) => script.mark(shared_a, shared_b, changed_a, changed_b),
                Search::OutOfWork if shared_a.len().max(shared_b.len()) < MAX_LEN => {
                    search_bounded(shared_a, shared_b, changed_a, changed_b);
                }
                Search::OutOfWork | Search::TooFar => {
                    changed_a.fill(true);
                    changed_b.fill(true);
                }
            }
        },
    );
    let edits: usize = hunks.iter().map(|h| h.deleted() + h.inserted()).sum();
    (edits <= max_edits).then_some(hunks)
}

/// Enough for 8,192 insertions and as many deletions among shared tokens. A step keeps one bit.
const WORK: usize = 80_000_000;
const WORK_PER_TOKEN: usize = 32;

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
fn search(a: &[u32], b: &[u32], max_edits: usize) -> Search {
    let Some(spare) = max_edits.checked_sub(a.len().abs_diff(b.len())) else {
        return Search::TooFar;
    };
    let max_pairs = (spare / 2).min(a.len()).min(b.len());
    let mut work = (WORK + WORK_PER_TOKEN * (a.len() + b.len())) as isize;
    let mut pairs = 2;
    loop {
        match search_within(a, b, pairs.min(max_pairs), &mut work) {
            Search::TooFar if pairs < max_pairs => pairs *= 4,
            done => return done,
        }
    }
}

fn search_within(a: &[u32], b: &[u32], pairs: usize, work: &mut isize) -> Search {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let goal = n - m;
    let max_edits = goal.abs() + 2 * pairs as isize;
    let origin = (max_edits - goal) / 2 + 1;
    // By diagonal k = x - y: one more than the furthest x, so that 0 loses to every path.
    let mut furthest = vec![0u32; max_edits as usize + 3];
    // By round: its first diagonal, and where its bits start.
    let mut rounds: Vec<(isize, usize)> = Vec::new();
    let mut bits: Vec<u64> = Vec::new();

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
        rounds.push((lo, bits.len()));
        let (mut word, mut bit) = (0u64, 1u64);
        let mut below = furthest[(origin + lo - 1) as usize];
        let mut k = lo;
        while k <= hi {
            let above = furthest[(origin + k + 1) as usize];
            let is_insertion = below < above;
            let mut x = if is_insertion { above - 1 } else { below } as usize;
            let mut y = (x as isize - k) as usize;
            if x < a.len() && y < b.len() && a[x] == b[y] {
                let matches = 1 + u32::common_prefix(&a[x + 1..], &b[y + 1..]);
                (x, y) = (x + matches, y + matches);
                *work -= matches as isize;
                if *work < 0 {
                    return Search::OutOfWork;
                }
            }
            furthest[(origin + k) as usize] = x as u32 + 1;
            word |= if is_insertion { bit } else { 0 };
            bit = bit.rotate_left(1);
            if bit == 1 {
                bits.push(core::mem::take(&mut word));
            }
            if x == a.len() {
                if y == b.len() {
                    bits.push(word);
                    return Search::Found(backtrack(&rounds, &bits, k));
                }
                highest = k - 1;
                break;
            }
            if y == b.len() {
                lowest = k + 1;
            }
            below = above;
            k += 2;
        }
        bits.push(word);
        *work -= (k - lo) / 2 + 1;
        if *work < 0 {
            return Search::OutOfWork;
        }
    }
    Search::TooFar
}

fn backtrack(rounds: &[(isize, usize)], bits: &[u64], mut k: isize) -> Script {
    let step = |&(lo, first_word): &(isize, usize)| {
        let index = (k - lo) as usize / 2;
        let is_insertion = bits[first_word + index / 64] >> (index % 64) & 1 == 1;
        k += if is_insertion { 1 } else { -1 };
        is_insertion
    };
    Script(rounds.iter().rev().map(step).collect())
}
