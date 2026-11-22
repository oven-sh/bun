//! Finds words of the static dictionary in the input.

use super::hash::{MIN_SCORE, Match, score};
use super::matching::{bytes_at, load64, match_length};
use super::ring_buffer::SLACK;
use super::word_tables::{Case, PackedWord, all_words, has_likely_words, likely_words};
use crate::transform::Kind::{Identity, OmitLast, UppercaseAll, UppercaseFirst};
use crate::transform::Transform;

/// The index of a transform that exists.
macro_rules! transform {
    ($prefix:expr, $kind:expr, $suffix:expr) => {
        const { Transform::index_of($prefix, $kind, $suffix).unwrap() }
    };
}

/// The transform that omits the last `n` bytes.
pub(super) const OMIT_LAST: [u8; 10] = {
    let (mut transforms, mut n) = ([0; _], 0);
    while n < transforms.len() {
        transforms[n] = Transform::index_of(b"", OmitLast(n as u8), b"").unwrap();
        n += 1;
    }
    transforms
};

#[derive(Clone, Copy)]
enum ShortPrefix {
    None,
    Space,
    Dot,
}

/// The transforms with `suffix`, for each [`ShortPrefix`] and [`Case`].
const fn transforms_with(suffix: &[u8]) -> [[Option<u8>; 3]; 3] {
    const fn by_case(prefix: &[u8], suffix: &[u8]) -> [Option<u8>; 3] {
        let mut row = [None; _];
        row[Case::Unchanged as usize] = Transform::index_of(prefix, Identity, suffix);
        row[Case::UppercaseFirst as usize] = Transform::index_of(prefix, UppercaseFirst, suffix);
        row[Case::UppercaseAll as usize] = Transform::index_of(prefix, UppercaseAll, suffix);
        row
    }
    let mut rows = [[None; _]; _];
    rows[ShortPrefix::None as usize] = by_case(b"", suffix);
    rows[ShortPrefix::Space as usize] = by_case(b" ", suffix);
    rows[ShortPrefix::Dot as usize] = by_case(b".", suffix);
    rows
}

/// Gives up on inputs in which it finds next to nothing.
#[derive(Clone, Copy, Default)]
pub(super) struct QuickWordSearch {
    lookups: usize,
    matches: usize,
}

impl QuickWordSearch {
    #[inline(always)]
    pub(super) fn is_active(&self) -> bool {
        self.matches >= self.lookups >> 7
    }

    /// The best word at the start of `padded`, which ends with [`SLACK`] bytes. `first_distance` refers to the first word.
    #[inline(always)]
    pub(super) fn find(
        &mut self,
        padded: &[u8],
        candidates: usize,
        first_distance: usize,
        max_distance: usize,
    ) -> Option<Match> {
        self.lookups += candidates;
        // Fewer than four bytes never score high enough.
        if !has_likely_words(bytes_at(padded, 0)) {
            return None;
        }
        let (best, matches) = best_likely_word(padded, candidates, first_distance, max_distance);
        if matches == 0 {
            return None;
        }
        self.matches += matches;
        Some(Match { ..best })
    }
}

/// And how many were the best so far.
#[cold]
#[inline(never)]
fn best_likely_word(
    padded: &[u8],
    candidates: usize,
    first_distance: usize,
    max_distance: usize,
) -> (Match, usize) {
    let (mut best, mut matches) = (Match::new(0, 0, MIN_SCORE), 0);
    for word in likely_words(bytes_at(padded, 0))
        .into_iter()
        .take(candidates)
    {
        if word.length() != 0
            && let Some(found) = match_of(word, padded, first_distance)
            && found.distance <= max_distance
            && found.score >= best.score
        {
            best = found;
            matches += 1;
        }
    }
    (best, matches)
}

/// How much of the word is at the start of `padded`, which ends with [`SLACK`] bytes.
#[inline(always)]
fn matched_length(word: PackedWord, padded: &[u8]) -> usize {
    let most = word.length().min(padded.len() - SLACK);
    let mut matched = 0;
    loop {
        let difference = load64(word.padded_spelling(), matched) ^ load64(padded, matched);
        matched += (difference.trailing_zeros() / 8) as usize;
        if difference != 0 || matched >= most {
            return matched.min(most);
        }
    }
}

#[inline(always)]
fn match_of(word: PackedWord, padded: &[u8], first_distance: usize) -> Option<Match> {
    if word.length() + SLACK > padded.len() {
        return None;
    }
    let length = matched_length(word, padded);
    let omitted = word.length() - length;
    let distance = first_distance + word.address(*OMIT_LAST.get(omitted)?);
    Some(Match {
        length,
        omitted,
        distance,
        score: score(length, distance),
    })
}

pub(super) const MAX_MATCH_LENGTH: usize = 37;

/// For each length, the transformed word with the lowest address.
pub(super) struct WordMatches {
    /// A bit for each length that has one.
    lengths: u64,
    /// The address, and in the low 5 bits the length of the word.
    by_length: [u32; MAX_MATCH_LENGTH + 1],
}

impl WordMatches {
    pub(super) fn new() -> Self {
        Self {
            lengths: 0,
            by_length: [0; MAX_MATCH_LENGTH + 1],
        }
    }

    /// The address, the length in the input, and the length of the word.
    #[inline(always)]
    pub(super) fn from_length(
        &self,
        min_length: usize,
    ) -> impl Iterator<Item = (usize, usize, usize)> {
        let mut lengths = self.lengths & u64::MAX.unbounded_shl(min_length as u32);
        core::iter::from_fn(move || {
            let length = lengths.trailing_zeros() as usize;
            let &packed = self.by_length.get(length)?;
            lengths &= lengths - 1;
            Some(((packed >> 5) as usize, length, (packed % 32) as usize))
        })
    }

    #[inline(always)]
    fn add(&mut self, word: PackedWord, transform: u8, length: usize) {
        let packed = ((word.address(transform) << 5) + word.length()) as u32;
        let is_first = (self.lengths >> length) & 1 == 0;
        let best = &mut self.by_length[length];
        *best = if is_first { packed } else { packed.min(*best) };
        self.lengths |= 1 << length;
    }

    /// At the start of `padded`, which has at least four bytes and [`SLACK`]. Some matches below `min_length` are left out.
    #[inline(always)]
    pub(super) fn find(&mut self, padded: &[u8], min_length: usize) {
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/static_dict.c#L72
        self.lengths = 0;
        let data = &padded[..padded.len() - SLACK];
        for (word, case) in all_words(load64(padded, 0)) {
            if word.length() + b". This ".len() < min_length {
                break;
            }
            if case == Case::Unchanged {
                self.add_unchanged(word, padded, min_length);
            } else if let Some(after) = strip_word(word, case, data) {
                self.add_punctuated(ShortPrefix::None, word, case, after);
            }
        }
        if let [first @ (b' ' | b'.'), _, _, _, _, ..] = *data {
            let prefix = match first {
                b' ' => ShortPrefix::Space,
                _ => ShortPrefix::Dot,
            };
            for (word, case) in all_words(load64(padded, 1)) {
                if word.length() + 3 < min_length {
                    break;
                }
                if (first == b' ' || case == Case::Unchanged)
                    && let Some(after) = strip_word(word, case, &data[1..])
                {
                    self.add_punctuated(prefix, word, case, after);
                }
            }
        }
        macro_rules! add_between {
            ($prefix:literal, $($suffix:literal),+) => {
                for (word, after) in unchanged_words(&padded[$prefix.len()..]) {
                    $(if after.starts_with($suffix) {
                        let length = $prefix.len() + word.length() + $suffix.len();
                        self.add(word, transform!($prefix, Identity, $suffix), length);
                    })+
                }
            };
        }
        match *data {
            [0xC2, 0xA0, _, _, _, _, ..] => add_between!(b"\xC2\xA0", b""),
            [b'e', b' ', _, _, _, _, ..] => add_between!(b"e ", b" "),
            [b's', b' ', _, _, _, _, ..] => add_between!(b"s ", b" "),
            [b',', b' ', _, _, _, _, ..] => add_between!(b", ", b" "),
            [b'.', b'c', b'o', b'm', b'/', _, _, _, _, ..] => add_between!(b".com/", b""),
            [b' ', b't', b'h', b'e', b' ', _, _, _, _, ..] => {
                add_between!(b" the ", b"", b" of ", b" of the ");
            }
            _ => {}
        }
    }

    #[inline(never)]
    fn add_unchanged(&mut self, word: PackedWord, padded: &[u8], min_length: usize) {
        let data = &padded[..padded.len() - SLACK];
        let length = word.length();
        let matched = matched_length(word, padded);
        if matched + 1 >= length && data[length - 1..].starts_with(b"ing ") {
            self.add(word, transform!(b"", OmitLast(1), b"ing "), length + 3);
        }
        for kept in min_length.max(length.saturating_sub(9))..=matched {
            self.add(word, OMIT_LAST[length - kept], kept);
        }
        if matched < length {
            return;
        }
        let Some(after) = data[length..].first_chunk::<7>() else {
            return;
        };
        macro_rules! add {
            ($($suffix:literal),+) => {{
                $(if after.starts_with($suffix) {
                    self.add(word, transform!(b"", Identity, $suffix), length + $suffix.len());
                })+
            }};
        }
        match after[0] {
            b' ' => {
                add!(b" ");
                match after[1] {
                    b'a' => add!(b" a ", b" as ", b" at ", b" and "),
                    b'b' => add!(b" by "),
                    b'i' => add!(b" in ", b" is "),
                    b'f' => add!(b" for ", b" from "),
                    b'o' => add!(b" of ", b" on "),
                    b'n' => add!(b" not "),
                    b't' => add!(b" the ", b" that ", b" to "),
                    b'w' => add!(b" with "),
                    _ => {}
                }
            }
            b'"' => add!(b"\"", b"\">"),
            b'.' => add!(b".", b". ", b". The ", b". This "),
            b',' => add!(b",", b", "),
            b'\n' => add!(b"\n", b"\n\t"),
            b']' => add!(b"]"),
            b'\'' => add!(b"'"),
            b':' => add!(b":"),
            b'(' => add!(b"("),
            b'=' => add!(b"=\"", b"='"),
            b'a' => add!(b"al "),
            b'e' => add!(b"ed ", b"er ", b"est "),
            b'f' => add!(b"ful "),
            b'i' => add!(b"ive ", b"ize "),
            b'l' => add!(b"less ", b"ly "),
            b'o' => add!(b"ous "),
            _ => {}
        }
    }

    /// For a word that has a prefix or another case.
    fn add_punctuated(&mut self, prefix: ShortPrefix, word: PackedWord, case: Case, after: &[u8]) {
        let length = usize::from(!matches!(prefix, ShortPrefix::None)) + word.length();
        let mut add = |transforms: &[[Option<u8>; 3]; 3], suffix: &[u8]| {
            if let Some(transform) = transforms[prefix as usize][case as usize] {
                self.add(word, transform, length + suffix.len());
            }
        };
        macro_rules! add_if_among {
            ($bytes:expr, $($suffix:literal),+) => {
                match $bytes {
                    $($suffix => add(const { &transforms_with($suffix) }, $suffix),)+
                    _ => {}
                }
            };
        }
        add(const { &transforms_with(b"") }, b"");
        if let [next, second, ..] = *after {
            add_if_among!(&[next], b" ", b"\"", b".", b",", b"'", b"(");
            add_if_among!(&[next, second], b"\">", b". ", b", ", b"=\"", b"='");
        }
    }
}

/// What follows the word in `data`, if it starts with it.
#[inline(always)]
fn strip_word(word: PackedWord, case: Case, data: &[u8]) -> Option<&[u8]> {
    let spelling = word.spelling();
    let (start, after) = data.split_at_checked(spelling.len())?;
    let matches = match case {
        Case::Unchanged => match_length(spelling, start) == spelling.len(),
        Case::UppercaseFirst => {
            spelling[0] ^ 32 == start[0]
                && match_length(&spelling[1..], &start[1..]) == spelling.len() - 1
        }
        Case::UppercaseAll => {
            (spelling.iter().zip(start)).all(|(a, b)| a.to_ascii_uppercase() == *b)
        }
    };
    matches.then_some(after)
}

fn unchanged_words(padded: &[u8]) -> impl Iterator<Item = (PackedWord, &[u8])> {
    let data = &padded[..padded.len() - SLACK];
    let words = all_words(load64(padded, 0)).filter(|&(_, case)| case == Case::Unchanged);
    words.filter_map(|(word, case)| Some((word, strip_word(word, case, data)?)))
}
