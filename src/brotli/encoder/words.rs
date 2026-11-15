//! Finds words of the static dictionary in the input. The numbers of transforms are from RFC 7932 appendix B.

use super::hash::{Match, score};
use super::matching::{bytes_at, match_length};
use super::word_tables::{Case, PackedWord, all_words, likely_words};

/// The transform that omits the last `n` bytes.
const OMIT_LAST: [u8; 10] = [0, 12, 27, 23, 42, 63, 56, 48, 59, 64];

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

    /// Replaces `best` with a word at the start of `data` that is no worse. `first_distance` refers to the first word.
    #[inline(always)]
    pub(super) fn improve(
        &mut self,
        data: &[u8],
        candidates: usize,
        first_distance: usize,
        max_distance: usize,
        best: &mut Match,
    ) {
        self.lookups += candidates;
        for word in likely_words(bytes_at(data, 0)).into_iter().take(candidates) {
            if word.length() == 0 || word.length() > data.len() {
                continue;
            }
            let length = match_length(word.spelling(), data);
            let Some(&transform) = OMIT_LAST.get(word.length() - length) else {
                continue;
            };
            let distance = first_distance + word.address(transform);
            if distance > max_distance {
                continue;
            }
            let score = score(length, distance);
            if score >= best.score {
                *best = Match {
                    length,
                    omitted: word.length() - length,
                    distance,
                    score,
                };
                self.matches += 1;
            }
        }
    }
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

    /// At the start of `data`, which has at least four bytes. Some matches below `min_length` are left out.
    #[inline(always)]
    pub(super) fn find(&mut self, data: &[u8], min_length: usize) {
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/static_dict.c#L72
        self.lengths = 0;
        for (word, case) in all_words(bytes_at(data, 0)) {
            if case == Case::Unchanged {
                self.add_unchanged(word, data, min_length);
            } else if let Some(after) = strip_word(word, case, data) {
                self.add_uppercase(word, case, after);
            }
        }
        if let [first @ (b' ' | b'.'), a, b, c, d, ..] = *data {
            for (word, case) in all_words([a, b, c, d]) {
                if (first == b' ' || case == Case::Unchanged)
                    && let Some(after) = strip_word(word, case, &data[1..])
                {
                    self.add_after_one_byte(first, word, case, after);
                }
            }
        }
        match *data {
            [0xC2, 0xA0, _, _, _, _, ..] => {
                for (word, _) in unchanged_words(&data[2..]) {
                    self.add(word, 102, word.length() + 2);
                }
            }
            [first @ (b'e' | b's' | b','), b' ', _, _, _, _, ..] => {
                let transform = match first {
                    b'e' => 18,
                    b's' => 7,
                    _ => 13,
                };
                for (word, after) in unchanged_words(&data[2..]) {
                    if let [b' ', ..] = after {
                        self.add(word, transform, word.length() + 3);
                    }
                }
            }
            [b'.', b'c', b'o', b'm', b'/', _, _, _, _, ..] => {
                for (word, _) in unchanged_words(&data[5..]) {
                    self.add(word, 72, word.length() + 5);
                }
            }
            [b' ', b't', b'h', b'e', b' ', _, _, _, _, ..] => {
                for (word, after) in unchanged_words(&data[5..]) {
                    self.add(word, 41, word.length() + 5);
                    if after.starts_with(b" of ") {
                        self.add(word, 62, word.length() + 9);
                    }
                    if after.starts_with(b" of the ") {
                        self.add(word, 73, word.length() + 13);
                    }
                }
            }
            _ => {}
        }
    }

    #[inline(never)]
    fn add_unchanged(&mut self, word: PackedWord, data: &[u8], min_length: usize) {
        let length = word.length();
        let matched = match_length(word.spelling(), data);
        if matched == length {
            self.add(word, 0, length);
        }
        if matched + 1 >= length {
            self.add(word, 12, length - 1);
            if data[length - 1..].starts_with(b"ing ") {
                self.add(word, 49, length + 3);
            }
        }
        for kept in min_length.max(length.saturating_sub(9))..=matched.min(length - 2) {
            self.add(word, OMIT_LAST[length - kept], kept);
        }
        if matched < length {
            return;
        }
        let Some(after) = data[length..].first_chunk::<7>() else {
            return;
        };
        let mut add = |transform, suffix: &[u8]| {
            if after.starts_with(suffix) {
                self.add(word, transform, length + suffix.len());
            }
        };
        match after[0] {
            b' ' => {
                add(1, b" ");
                match after[1] {
                    b'a' => {
                        add(28, b" a ");
                        add(46, b" as ");
                        add(60, b" at ");
                        add(10, b" and ");
                    }
                    b'b' => add(38, b" by "),
                    b'i' => {
                        add(16, b" in ");
                        add(47, b" is ");
                    }
                    b'f' => {
                        add(25, b" for ");
                        add(37, b" from ");
                    }
                    b'o' => {
                        add(8, b" of ");
                        add(45, b" on ");
                    }
                    b'n' => add(80, b" not "),
                    b't' => {
                        add(5, b" the ");
                        add(29, b" that ");
                        add(17, b" to ");
                    }
                    b'w' => add(35, b" with "),
                    _ => {}
                }
            }
            b'"' => {
                add(19, b"\"");
                add(21, b"\">");
            }
            b'.' => {
                add(20, b".");
                add(31, b". ");
                add(43, b". The ");
                add(75, b". This ");
            }
            b',' => {
                add(76, b",");
                add(14, b", ");
            }
            b'\n' => {
                add(22, b"\n");
                add(50, b"\n\t");
            }
            b']' => add(24, b"]"),
            b'\'' => add(36, b"'"),
            b':' => add(51, b":"),
            b'(' => add(57, b"("),
            b'=' => {
                add(70, b"=\"");
                add(86, b"='");
            }
            b'a' => add(84, b"al "),
            b'e' => {
                add(53, b"ed ");
                add(82, b"er ");
                add(95, b"est ");
            }
            b'f' => add(90, b"ful "),
            b'i' => {
                add(92, b"ive ");
                add(100, b"ize ");
            }
            b'l' => {
                add(93, b"less ");
                add(61, b"ly ");
            }
            b'o' => add(106, b"ous "),
            _ => {}
        }
    }

    fn add_uppercase(&mut self, word: PackedWord, case: Case, after: &[u8]) {
        let mut add = |first, all, suffix_length| {
            let transform = if case == Case::UppercaseAll {
                all
            } else {
                first
            };
            self.add(word, transform, word.length() + suffix_length);
        };
        add(9, 44, 0);
        let [next, second, ..] = *after else {
            return;
        };
        match next {
            b' ' => add(4, 68, 1),
            b'"' => add(66, 87, 1),
            b'.' => add(79, 101, 1),
            b',' => add(99, 112, 1),
            b'\'' => add(74, 94, 1),
            b'(' => add(78, 113, 1),
            _ => {}
        }
        match &[next, second] {
            b"\">" => add(69, 97, 2),
            b". " => add(88, 114, 2),
            b", " => add(58, 107, 2),
            b"=\"" => add(104, 105, 2),
            b"='" => add(108, 116, 2),
            _ => {}
        }
    }

    /// `prefix` is a space, or a dot before an unchanged word.
    fn add_after_one_byte(&mut self, prefix: u8, word: PackedWord, case: Case, after: &[u8]) {
        const NO: u8 = u8::MAX;
        let column = match case {
            _ if prefix == b'.' => 0,
            Case::Unchanged => 1,
            Case::UppercaseFirst => 2,
            Case::UppercaseAll => 3,
        };
        let mut add = |transforms: [u8; 4], suffix_length| {
            if transforms[column] != NO {
                self.add(word, transforms[column], 1 + word.length() + suffix_length);
            }
        };
        add([32, 6, 30, 85], 0);
        let [next, second, ..] = *after else {
            return;
        };
        match next {
            b' ' => add([77, 2, 15, 83], 1),
            b'(' => add([67, 89, NO, NO], 1),
            b',' => add([NO, 103, 109, NO], 1),
            b'.' => add([NO, 71, 96, 115], 1),
            _ => {}
        }
        match &[next, second] {
            b", " => add([NO, 33, 65, 111], 2),
            b". " => add([NO, 52, 91, 117], 2),
            b"=\"" => add([NO, 81, 118, 110], 2),
            b"='" => add([NO, 98, 120, 119], 2),
            _ => {}
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

fn unchanged_words(data: &[u8]) -> impl Iterator<Item = (PackedWord, &[u8])> {
    let words = all_words(bytes_at(data, 0)).filter(|&(_, case)| case == Case::Unchanged);
    words.filter_map(|(word, case)| Some((word, strip_word(word, case, data)?)))
}
