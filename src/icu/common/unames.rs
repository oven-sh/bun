//! Finds a character by its name, in `unames.icu`. ICU4C: unames.cpp

use crate::common::bytes::{U16s, U32s};
use crate::common::cstring::until_nul;
use crate::common::memory::{try_collect, try_collect_results};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uchar::u_char_type;
use crate::common::udata;
use crate::common::umutex::OnceBox;
use crate::common::unicode::uchar::{U_CHAR_CATEGORY_COUNT, U_SURROGATE};
use crate::common::uniset::MAX_VALUE;
use crate::common::utf16;
use crate::common::utypes::UErrorCode;
use bun_core::strings;
use std::iter::successors;

const GROUP_SHIFT: u32 = 5;
const LINES_PER_GROUP: usize = 1 << GROUP_SHIFT;

/// The token table entry of a byte that stands for itself.
const LETTER: u16 = 0xffff;
/// The token table entry of the first byte of a two-byte token number.
const LEAD_BYTE: u16 = 0xfffe;

/// A name of this length is not found.
const QUERY_LENGTH_LIMIT: usize = 120;

// The semicolon-separated fields of a line.
const NAME_FIELD: usize = 0;
const ALIAS_FIELD: usize = 3;

const CATEGORY_NAMES: [&str; 33] = [
    "unassigned",
    "uppercase letter",
    "lowercase letter",
    "titlecase letter",
    "modifier letter",
    "other letter",
    "non spacing mark",
    "enclosing mark",
    "combining spacing mark",
    "decimal digit number",
    "letter number",
    "other number",
    "space separator",
    "line separator",
    "paragraph separator",
    "control",
    "format",
    "private use area",
    "surrogate",
    "dash punctuation",
    "start punctuation",
    "end punctuation",
    "connector punctuation",
    "other punctuation",
    "math symbol",
    "currency symbol",
    "modifier symbol",
    "other symbol",
    "initial punctuation",
    "final punctuation",
    "noncharacter",
    "lead surrogate",
    "trail surrogate",
];

fn get_char_cat_name(c: u32) -> &'static [u8] {
    let category = match u_char_type(c) {
        _ if (0xfdd0..=0xfdef).contains(&c) || c & 0xfffe == 0xfffe => U_CHAR_CATEGORY_COUNT,
        U_SURROGATE if utf16::is_lead(c) => U_CHAR_CATEGORY_COUNT + 1,
        U_SURROGATE => U_CHAR_CATEGORY_COUNT + 2,
        category => category,
    };
    CATEGORY_NAMES.at(category as usize).as_bytes()
}

/// Keeps the low 32 bits. Returns `None` if a byte is not a hexadecimal digit.
fn parse_hexadecimal(digits: &[u8]) -> Option<u32> {
    digits.iter().try_fold(0, |c, &digit| {
        Some(c << 4 | char::from(digit).to_digit(16)?)
    })
}

/// Parses `category-HHHH>`. Accepts any code point of the category, also if it has a regular name.
fn find_ext_name(name: &[u8]) -> Option<u32> {
    let (category, digits) = strings::rsplit_once_char(name.strip_suffix(b">")?, b'-')
        .filter(|(_, digits)| (1..=8).contains(&digits.len()))?;
    parse_hexadecimal(digits)
        .filter(|&c| c <= MAX_VALUE && get_char_cat_name(c).eq_ignore_ascii_case(category))
}

/// Code points whose names are computed.
struct AlgorithmicRange {
    start: u32,
    end: u32,
    prefix: &'static [u8],
    suffix: Suffix,
}

enum Suffix {
    Hexadecimal {
        digits: u8,
    },
    /// One element of each list.
    Factorized {
        /// The lengths of the lists.
        factors: U16s<'static>,
        /// The lists, one after another.
        elements: Vec<&'static [u8]>,
    },
}

impl AlgorithmicRange {
    fn new(header: &[u8; 12], body: &'static [u8]) -> Result<Self, UErrorCode> {
        let &[.., kind, variant, _, _] = header;
        let (prefix, suffix) = if kind == 0 {
            (until_nul(body), Suffix::Hexadecimal { digits: variant })
        } else {
            let factors = U16s::of(body).slice(0..variant.into());
            let mut strings = strings::split(body.slice(2 * factors.len()..), b"\0");
            let prefix = strings.next().soft_unwrap();
            let elements = try_collect(strings)?;
            (prefix, Suffix::Factorized { factors, elements })
        };
        Ok(Self {
            start: U32s::of(header).at(0),
            end: U32s::of(header).at(1),
            prefix,
            suffix,
        })
    }

    fn find_name(&self, mut matcher: Matcher) -> Option<u32> {
        if !self.prefix.iter().all(|&c| matcher.consistent_with(c)) {
            return None;
        }
        match &self.suffix {
            Suffix::Hexadecimal { digits } if matcher.rest.len() != usize::from(*digits) => None,
            Suffix::Hexadecimal { .. } => parse_hexadecimal(matcher.rest),
            Suffix::Factorized { factors, elements } => {
                let limit = u64::from(self.end.saturating_sub(self.start)) + 1;
                find_factor_suffix(*factors, elements, matcher.rest, limit)
                    .map(|offset| self.start.wrapping_add(offset))
            }
        }
        .filter(|c| (self.start..=self.end).contains(c))
    }
}

/// Returns the smallest offset below `limit` whose name ends with exactly `suffix`.
fn find_factor_suffix(
    factors: U16s,
    mut elements: &[&[u8]],
    suffix: &[u8],
    limit: u64,
) -> Option<u32> {
    // For each position, the smallest number that the indexes so far form if they spell `suffix[..position]`.
    let mut min_offsets = [u64::MAX; QUERY_LENGTH_LIMIT];
    min_offsets.set(0, 0);
    for factor in factors.iter() {
        let list;
        (list, elements) = elements.split_soft(factor.into());
        // Backwards, so that an entry is taken before this list writes it.
        for position in (0..=suffix.len()).rev() {
            let first = min_offsets.at(position).saturating_mul(factor.into());
            min_offsets.set(position, u64::MAX);
            for (offset, element) in (first..limit).zip(list) {
                if suffix.slice(position..).starts_with(element)
                    && let Some(min) = min_offsets.soft_get_mut(position + element.len())
                {
                    *min = offset.min(*min);
                }
            }
        }
    }
    u32::try_from(min_offsets.at(suffix.len())).ok()
}

/// The names that are stored are in groups of 32 lines, which consist of letters and of token numbers.
struct CharNames {
    token_count: u16,
    /// Extends to the end of the item, because a two-byte token number is not checked against `token_count`.
    tokens: U16s<'static>,
    token_strings: &'static [u8],
    /// For each group the upper bits of its code points, and the two halves of its offset in `group_strings`.
    groups: U16s<'static>,
    group_strings: &'static [u8],
    ranges: Vec<AlgorithmicRange>,
}

impl CharNames {
    fn load() -> Result<Self, UErrorCode> {
        let data = udata::open_choice(None, b"icu", b"unames", |info| {
            &info.data_format == b"unam" && info.format_version[0] == 1
        })?
        .memory;
        let [token_strings, groups, group_strings, alg_names] =
            [0, 1, 2, 3].map(|i| data.slice(U32s::of(data).at(i) as usize..));
        let size = |range: &[u8]| U16s::of(range).get(5).map(usize::from);
        let ranges = successors(alg_names.get(4..), |rest| rest.get(size(rest)?..))
            .take(U32s::of(alg_names).at(0) as usize)
            // A range that is shorter than its header ends the list.
            .map_while(|rest| rest.get(..size(rest)?)?.split_first_chunk())
            .map(|(header, body)| AlgorithmicRange::new(header, body));
        let groups = U16s::of(groups);
        Ok(Self {
            token_count: U16s::of(data).at(8),
            tokens: U16s::of(data.slice(18..)),
            token_strings,
            groups: groups.slice(1..1 + 3 * usize::from(groups.at(0))),
            group_strings,
            ranges: try_collect_results(ranges)?,
        })
    }

    fn token(&self, c: u8) -> u16 {
        if u16::from(c) < self.token_count {
            self.tokens.at(c.into())
        } else {
            LETTER
        }
    }

    // ICU4C: unames.cpp, compareName
    fn matches(&self, line: &[u8], field: usize, mut matcher: Matcher) -> bool {
        // If the semicolon is a token number, lines have only one field.
        if field != NAME_FIELD && self.token(b';') != LETTER {
            return false;
        }
        let mut bytes = line.iter().copied();
        for _ in 0..field {
            bytes.by_ref().take_while(|&c| c != b';').for_each(drop);
        }
        while let Some(c) = bytes.next() {
            let mut token = self.token(c);
            if token == LEAD_BYTE {
                let Some(trail) = bytes.next() else { break };
                token = self.tokens.at(usize::from(c) << 8 | usize::from(trail));
            }
            if token != LETTER {
                let string = self.token_strings.slice(token.into()..).iter();
                let mut string = string.take_while(|&&c| c != 0);
                if !string.all(|&c| matcher.consistent_with(c)) {
                    return false;
                }
            } else if c == b';' {
                break;
            } else if !matcher.consistent_with(c) {
                return false;
            }
        }
        matcher.rest.is_empty()
    }

    fn find_stored_name(&self, field: usize, query: Matcher) -> Option<u32> {
        (0..self.groups.len()).step_by(3).find_map(|group| {
            let [msb, high, low] = [0, 1, 2].map(|i| u32::from(self.groups.at(group + i)));
            let packed = self.group_strings.slice((high << 16 | low) as usize..);
            let line = group_lines(packed).position(|line| self.matches(line, field, query))?;
            Some(msb << GROUP_SHIFT | line as u32)
        })
    }
}

/// The lines follow their lengths, which have one or two nibbles each. ICU4C: unames.cpp, expandGroupLengths
fn group_lines(packed: &[u8]) -> impl Iterator<Item = &[u8]> {
    // The last byte can hold a 33rd length.
    let (mut lengths, mut lines) = ([0; LINES_PER_GROUP + 1], 0);
    let (mut used, mut low) = (0, 0);
    while lines < LINES_PER_GROUP {
        let byte = packed.at(used);
        used += 1;
        let is_one_length = low < 12 && byte >= 0xc0;
        let length = match low {
            12.. => ((low & 3) << 4 | byte >> 4) + 12,
            _ if is_one_length => (byte & 0x3f) + 12,
            _ => byte >> 4,
        };
        lengths.set(lines, length);
        lines += 1;
        if !is_one_length {
            low = byte & 0xf;
            if low < 12 {
                lengths.set(lines, low);
                lines += 1;
            }
        }
    }
    let mut text = packed.slice(used..);
    lengths
        .into_iter()
        .take(LINES_PER_GROUP)
        .map(move |length| {
            let line;
            (line, text) = text.split_soft(length.into());
            line
        })
}

/// Returns the significant characters of `name` in uppercase (UAX44-LM2). `buffer` is at least as long as `name`.
fn skeleton<'a>(name: &[u8], buffer: &'a mut [u8]) -> &'a [u8] {
    let is_blank = |c: &u8| matches!(c, b' ' | b'_');
    let mut length = 0;
    for (i, c) in name.iter().enumerate() {
        let after = name.slice(i + 1..);
        let is_medial = || {
            [name.slice(..i).last(), after.first()]
                .iter()
                .all(|c| c.is_some_and(u8::is_ascii_alphanumeric))
        };
        let is_in_1180 = || {
            buffer.slice(..length) == b"HANGULJUNGSEONGO"
                && matches!(after, [b'E' | b'e', rest @ ..] if rest.iter().all(is_blank))
        };
        let is_significant = if *c == b'-' {
            !is_medial() || is_in_1180()
        } else {
            !is_blank(c)
        };
        if is_significant {
            buffer.set(length, c.to_ascii_uppercase());
            length += 1;
        }
    }
    buffer.slice(..length)
}

// ICU4C: unames.cpp, CharacterNameQuery::Matcher
#[derive(Clone, Copy)]
struct Matcher<'a> {
    rest: &'a [u8],
    /// The medial hyphen of U+1180 HANGUL JUNGSEONG O-E is significant, because U+116C is HANGUL JUNGSEONG OE.
    is_1180: bool,
    last: u8,
}

impl<'a> Matcher<'a> {
    fn new(skeleton: &'a [u8]) -> Self {
        Self {
            rest: skeleton,
            is_1180: skeleton == b"HANGULJUNGSEONGO-E",
            last: b' ',
        }
    }

    fn consistent_with(&mut self, c: u8) -> bool {
        let Some((&next, rest)) = self.rest.split_first() else {
            return false;
        };
        let last = std::mem::replace(&mut self.last, c);
        let expected = match c {
            b' ' if last == b'-' => last,
            b'-' if last == b' ' || (self.is_1180 && rest.len() == 1) => c,
            b' ' | b'-' => return true,
            _ => c,
        };
        self.rest = rest;
        next == expected
    }
}

/// Finds a name, an extended name such as `<control-0009>`, or an alias. ICU4C: unames.cpp, u_charFromName
pub(crate) fn u_char_from_name(name: &[u8]) -> Option<u32> {
    static NAMES: OnceBox<Result<CharNames, UErrorCode>> = OnceBox::new();
    let names = NAMES.get_or_init_caching_err(CharNames::load).ok()?;
    if name.len() >= QUERY_LENGTH_LIMIT {
        return None;
    }
    if let Some(rest) = name.strip_prefix(b"<") {
        return find_ext_name(rest);
    }
    let mut buffer = [0; QUERY_LENGTH_LIMIT];
    let query = Matcher::new(skeleton(name, &mut buffer));
    if query.rest.is_empty() {
        return None;
    }
    let mut ranges = names.ranges.iter();
    ranges
        .find_map(|range| range.find_name(query))
        .or_else(|| names.find_stored_name(NAME_FIELD, query))
        .or_else(|| names.find_stored_name(ALIAS_FIELD, query))
        .filter(|&c| c <= MAX_VALUE)
}
