//! A class of units, and the four grammars in which one is written.

use crate::unit::{Subject, Text, Unit, is_line_terminator, push_utf8, unfold};
use bun_core::strings;

const BANG: u32 = b'!' as u32;
const DASH: u32 = b'-' as u32;
const OPEN: u32 = b'[' as u32;
const BACKSLASH: u32 = b'\\' as u32;
const CLOSE: u32 = b']' as u32;
const CARET: u32 = b'^' as u32;

type Ranges = Vec<(u32, u32)>;

fn has_at(bytes: &[u8], at: usize, text: &[u8]) -> bool {
    bytes.get(at..).is_some_and(|rest| rest.starts_with(text))
}

// ───────────────────────────── the names of minimatch, which are Unicode's ─────────────────────────────

const ALNUM: u16 = 1 << 0;
const ALPHA: u16 = 1 << 1;
const ASCII: u16 = 1 << 2;
const BLANK: u16 = 1 << 3;
const CNTRL: u16 = 1 << 4;
const DIGIT: u16 = 1 << 5;
const GRAPH: u16 = 1 << 6;
const LOWER: u16 = 1 << 7;
const PRINT: u16 = 1 << 8;
const PUNCT: u16 = 1 << 9;
const SPACE: u16 = 1 << 10;
const UPPER: u16 = 1 << 11;
const WORD: u16 = 1 << 12;
const XDIGIT: u16 = 1 << 13;

/// The name, its bit, and whether it needs the flag `u`. `[:graph:]` is written negated.
const MINIMATCH_NAMES: [(&[u8], u16, bool); 14] = [
    (b"[:alnum:]", ALNUM, true),
    (b"[:alpha:]", ALPHA, true),
    (b"[:ascii:]", ASCII, false),
    (b"[:blank:]", BLANK, true),
    (b"[:cntrl:]", CNTRL, true),
    (b"[:digit:]", DIGIT, true),
    (b"[:graph:]", GRAPH, true),
    (b"[:lower:]", LOWER, true),
    (b"[:print:]", PRINT, true),
    (b"[:punct:]", PUNCT, true),
    (b"[:space:]", SPACE, true),
    (b"[:upper:]", UPPER, true),
    (b"[:word:]", WORD, true),
    (b"[:xdigit:]", XDIGIT, false),
];

/// `\p{Zs}`
fn is_space_separator(c: u32) -> bool {
    matches!(
        c,
        0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x202F | 0x205F | 0x3000
    )
}

/// `\p{Z}`
fn is_separator(c: u32) -> bool {
    is_space_separator(c) || matches!(c, 0x2028 | 0x2029)
}

/// `\p{P}` in ASCII: not `$+<=>^`|~`, which are symbols. Beyond ASCII: none.
fn is_punctuation(c: u32) -> bool {
    matches!(
        c,
        33..=35 | 37..=42 | 44..=47 | 58 | 59 | 63 | 64 | 91..=93 | 95 | 123 | 125
    )
}

/// ASCII is exact. Beyond it `\p{L}\p{Nl}`, `\p{Nd}`, `\p{Ll}` and `\p{Lu}` are the properties that `core` has, and `\p{C}` is `\p{Cc}`.
fn in_names(names: u16, unit: u32) -> bool {
    let Some(c) = char::from_u32(unit).filter(|_| names != 0) else {
        return false;
    };
    let has = |name: u16| names & name != 0;
    let (is_letter, is_digit, is_control) = (c.is_alphabetic(), c.is_numeric(), c.is_control());
    has(ALNUM) && (is_letter || is_digit)
        || has(ALPHA) && is_letter
        || has(ASCII) && c.is_ascii()
        || has(BLANK) && (is_space_separator(unit) || c == '\t')
        || has(CNTRL | PRINT) && is_control
        || has(DIGIT) && is_digit
        || has(GRAPH) && (is_separator(unit) || is_control)
        || has(LOWER) && c.is_lowercase()
        || has(PUNCT) && is_punctuation(unit)
        || has(SPACE) && (is_separator(unit) || matches!(unit, 9..=13))
        || has(UPPER) && c.is_uppercase()
        || has(WORD) && (is_letter || is_digit || c == '_')
        || has(XDIGIT) && c.is_ascii_hexdigit()
}

// ───────────────────────────── a class ─────────────────────────────

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Class {
    /// The final answers for ASCII: negation, folding and "never a `/`" are in it.
    ascii: [u64; 2],
    ranges: Box<[(u32, u32)]>,
    names: u16,
    /// minimatch writes `[:graph:]` negated, beside the rest: "in these, or not in those".
    not_names: u16,
    negated: bool,
    /// There are `ranges` or `names`.
    has_first: bool,
    folds: bool,
}

fn in_ranges(ranges: &[(u32, u32)], c: u32) -> bool {
    ranges.iter().any(|(low, high)| *low <= c && c <= *high)
}

impl Class {
    fn new(ranges: Ranges, negated: bool, folds: bool) -> Class {
        Class {
            ascii: [0; 2],
            ranges: ranges.into(),
            names: 0,
            not_names: 0,
            negated,
            has_first: true,
            folds,
        }
    }

    /// Fills in `ascii`.
    fn finished(mut self, never_slash: bool) -> Class {
        for c in 0..128_u8 {
            let hit = match self.folds {
                // Negation comes after folding: a member in either case makes both members.
                true => {
                    let in_case = |c: u8| in_ranges(&self.ranges, u32::from(c));
                    (in_case(c.to_ascii_uppercase()) || in_case(c.to_ascii_lowercase()))
                        != self.negated
                }
                false => self.says(u32::from(c)),
            };
            if hit && !(never_slash && c == b'/') {
                self.ascii[usize::from(c >> 6)] |= 1 << (c & 63);
            }
        }
        self
    }

    /// These ranges: `\d` outside of brackets.
    pub(crate) fn of_ranges(ranges: &[(u32, u32)], folds: bool) -> Class {
        Class::new(ranges.to_vec(), false, folds).finished(false)
    }

    /// `[^.\/]`
    pub(crate) fn not_dot_or_slash() -> Class {
        let members = (*b"./").map(|it| (u32::from(it), u32::from(it)));
        Class::new(
            members.to_vec(),
            /* negated */ true,
            /* folds */ false,
        )
        .finished(false)
    }

    /// What it says of `c`, which is not folded, without the bitmap.
    fn says(&self, c: u32) -> bool {
        self.has_first && (in_ranges(&self.ranges, c) || in_names(self.names, c)) != self.negated
            || self.not_names != 0 && in_names(self.not_names, c) == self.negated
    }

    /// `unit` is folded if the class folds.
    #[inline]
    pub(crate) fn has(&self, unit: u32) -> bool {
        if unit < 0x80 {
            return self.ascii[(unit >> 6) as usize] & (1 << (unit & 63)) != 0;
        }
        match self.folds {
            true => {
                (in_ranges(&self.ranges, unit) || in_ranges(&self.ranges, unfold(unit)))
                    != self.negated
            }
            false => self.says(unit),
        }
    }

    pub(crate) fn takes_slash(&self) -> bool {
        self.has(u32::from(b'/'))
    }

    /// minimatch writes it `([..]|[^..])`, which does not start with a `[`.
    pub(crate) fn is_written_in_parens(&self) -> bool {
        self.has_first && self.not_names != 0
    }

    /// It takes nothing but a `/`.
    pub(crate) fn is_slash(&self) -> bool {
        !self.negated
            && self.names == 0
            && self.not_names == 0
            && self.ascii == [1_u64 << b'/', 0]
            && self.ranges.iter().all(|(_, high)| *high < 0x80)
    }
}

/// What starts with a `[`.
pub(crate) enum Read {
    Class {
        class: Class,
        len: usize,
        /// Of minimatch: it has a POSIX class that needs the flag `u`.
        needs_code_points: bool,
    },
    /// Of minimatch: a class of one character is that character.
    One { unit: u32, len: usize },
    /// The `[` is a character.
    NotAClass,
    /// The pattern, or what is left of it, matches nothing.
    Never,
}

fn read(class: Class, len: usize) -> Read {
    Read::Class {
        class,
        len,
        needs_code_points: false,
    }
}

// ───────────────────────────── minimatch: `parseClass(glob, at)` ─────────────────────────────

/// The length of the `[:name:]` at `at`, 0 if there is none.
fn minimatch_name_len(glob: &[u8], at: usize) -> usize {
    let found = MINIMATCH_NAMES.iter().find(|it| has_at(glob, at, it.0));
    found.map_or(0, |it| it.0.len())
}

/// Where the last `]` of `glob` is that can close a class: it is not escaped and not the end of a `[:name:]`.
pub(crate) fn minimatch_last_close(glob: &[u8]) -> Option<usize> {
    let (mut last, mut i) = (None, 0);
    while let Some(byte) = glob.get(i) {
        match byte {
            b'\\' => i += 1,
            b']' => last = Some(i),
            b'[' => i += minimatch_name_len(glob, i).saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    last
}

/// Whether it is worth reading the class at `at`. Without this a name of nothing but `[` is read from each of them to its end.
pub(crate) fn minimatch_can_close(glob: &[u8], at: usize, last_close: Option<usize>) -> bool {
    last_close.is_some_and(|it| it >= at + 2) || minimatch_name_len(glob, at) > 0
}

/// `glob[at]` is `[`. `code_points`: the name has a POSIX class that needs the flag `u`, so a character beyond U+FFFF is one unit.
pub(crate) fn minimatch(glob: &[u8], at: usize, code_points: bool) -> Read {
    let unit = match code_points {
        true => Unit::CodePoint,
        false => Unit::Utf16,
    };
    let text = Text { unit, folds: false };
    let mut ranges = Ranges::new();
    let (mut names, mut not_names) = (0, 0);
    // How many elements `ranges` of the reference has. What is not one unit counts as two.
    let mut count = 0;
    // The one unit, if `ranges` is one unit.
    let mut only = 0;
    let (mut saw_start, mut escaping, mut negated) = (false, false, false);
    let mut needs_code_points = false;
    let mut range_start = None;
    let (mut i, mut end) = (at + 1, at);
    'chars: while let Some((c, len)) = text.next(Subject::of(glob), i) {
        if matches!(c, BANG | CARET) && i == at + 1 {
            negated = true;
            i += 1;
            continue;
        }
        if c == CLOSE && saw_start && !escaping {
            end = i + 1;
            break;
        }
        saw_start = true;
        if c == BACKSLASH && !escaping {
            escaping = true;
            i += 1;
            continue;
        }
        if c == OPEN && !escaping {
            for (name, bit, needs_u) in MINIMATCH_NAMES {
                if !has_at(glob, i, name) {
                    continue;
                }
                if range_start.is_some() {
                    return Read::Never;
                }
                i += name.len();
                if bit == GRAPH {
                    not_names |= bit;
                } else {
                    names |= bit;
                    count += 2;
                }
                needs_code_points |= needs_u;
                continue 'chars;
            }
        }
        escaping = false;
        i += len;
        if let Some(start) = range_start.take() {
            if c > start {
                ranges.push((start, c));
                count += 2;
            } else if c == start {
                ranges.push((c, c));
                count += 1;
                only = c;
            }
        } else if has_at(glob, i, b"-]") {
            ranges.extend([(c, c), (DASH, DASH)]);
            count += 2;
            i += 1;
        } else if has_at(glob, i, b"-") {
            range_start = Some(c);
            i += 1;
        } else {
            ranges.push((c, c));
            count += 1;
            only = c;
        }
    }
    if end < i {
        return Read::NotAClass;
    }
    if count == 0 && not_names == 0 {
        return Read::Never;
    }
    let len = end - at;
    // `/^\\?.$/`: one UTF-16 unit that is no line terminator.
    let is_one_unit = only <= 0xFFFF && char::from_u32(only).is_some() && !is_line_terminator(only);
    if not_names == 0 && count == 1 && !negated && is_one_unit {
        return Read::One { unit: only, len };
    }
    let has_first = count > 0;
    let class = Class {
        names,
        not_names,
        has_first,
        ..Class::new(ranges, negated, false)
    };
    Read::Class {
        class: class.finished(false),
        len,
        needs_code_points,
    }
}

// ───────────────────────────── wildmatch: git, npm `ignore` 7.0.12 ─────────────────────────────

const WILDMATCH_NAMES: [(&[u8], &[(u32, u32)]); 12] = [
    (b"alnum", &[(48, 57), (65, 90), (97, 122)]),
    (b"alpha", &[(65, 90), (97, 122)]),
    (b"blank", &[(32, 32), (9, 9)]),
    (b"cntrl", &[(0, 31), (127, 127)]),
    (b"digit", &[(48, 57)]),
    (b"graph", &[(33, 126)]),
    (b"lower", &[(97, 122)]),
    (b"print", &[(32, 126)]),
    (b"punct", &[(33, 47), (58, 64), (91, 96), (123, 126)]),
    (b"space", &[(32, 32), (9, 10), (13, 13)]),
    (b"upper", &[(65, 90)]),
    (b"xdigit", &[(48, 57), (65, 70), (97, 102)]),
];

/// `dowild` of `wildmatch.c` at a `[`, and `scanBracket` of the package. `glob[at]` is `[`. It never takes a `/`.
pub(crate) fn wildmatch(glob: &[u8], at: usize, text: Text) -> Read {
    let unit_at = |i: usize| text.plain().next(Subject::of(glob), i);
    let negated = matches!(glob.get(at + 1), Some(b'!' | b'^'));
    let mut i = at + 1 + usize::from(negated);
    let mut ranges = Ranges::new();
    // What a `-` can start a range from.
    let mut prev = None;
    loop {
        let Some((c, len)) = unit_at(i) else {
            return Read::Never;
        };
        let is_before_bound = glob.get(i + 1).is_some_and(|next| *next != b']');
        if c == BACKSLASH {
            let Some((escaped, len)) = unit_at(i + 1) else {
                return Read::Never;
            };
            ranges.push((escaped, escaped));
            prev = Some(escaped);
            i += 1 + len;
        } else if let Some(low) = prev.filter(|_| c == DASH && is_before_bound) {
            i += 1;
            if glob.get(i) == Some(&b'\\') {
                i += 1;
            }
            let Some((high, len)) = unit_at(i) else {
                return Read::Never;
            };
            if low <= high {
                ranges.push((low, high));
            }
            prev = None;
            i += len;
        } else if c == OPEN && glob.get(i + 1) == Some(&b':') {
            let rest = glob.get(i + 2..).unwrap_or_default();
            let Some(end) = strings::index_of_char_usize(rest, b']') else {
                return Read::Never;
            };
            if let Some(name) = rest[..end].strip_suffix(b":") {
                let Some((_, members)) = WILDMATCH_NAMES.iter().find(|it| it.0 == name) else {
                    return Read::Never;
                };
                ranges.extend_from_slice(members);
                prev = None;
                i += 2 + end + 1;
            } else {
                ranges.push((OPEN, OPEN));
                prev = Some(OPEN);
                i += 1;
            }
        } else {
            ranges.push((c, c));
            prev = Some(c);
            i += len;
        }
        if glob.get(i) == Some(&b']') {
            let class = Class::new(ranges, negated, text.folds).finished(true);
            return read(class, i + 1 - at);
        }
    }
}

// ───────────────────────────── globset ─────────────────────────────

fn utf8_of(c: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(4);
    push_utf8(&mut bytes, c);
    bytes
}

/// `Parser::parse_class`, written for bytes: a character beyond ASCII is each of its bytes. `Err`: why the line is refused.
pub(crate) fn globset(glob: &[u8], at: usize, folds: bool) -> Result<Read, Vec<u8>> {
    let text = Text {
        unit: Unit::CodePoint,
        folds: false,
    };
    let negated = matches!(glob.get(at + 1), Some(b'!' | b'^'));
    let mut i = at + 1 + usize::from(negated);
    let mut chars = Ranges::new();
    let (mut first, mut in_range) = (true, false);
    loop {
        // `allow_unclosed_class`
        let Some((c, len)) = text.next(Subject::of(glob), i) else {
            return Ok(Read::NotAClass);
        };
        i += len;
        if c == CLOSE && !first {
            break;
        }
        if c == DASH && !first && !in_range {
            in_range = true;
        } else if let Some(last) = chars.last_mut().filter(|_| in_range) {
            last.1 = c;
            if last.1 < last.0 {
                let (low, high) = (utf8_of(last.0), utf8_of(last.1));
                return Err([b"invalid range; '", &low[..], b"' > '", &high, b"'"].concat());
            }
            in_range = false;
        } else {
            chars.push((c, c));
        }
        first = false;
    }
    if in_range {
        chars.push((DASH, DASH));
    }
    let mut ranges = Ranges::with_capacity(chars.len());
    let one = |byte: &u8| (u32::from(*byte), u32::from(*byte));
    for (low, high) in chars {
        let (from, to) = (utf8_of(low), utf8_of(high));
        let ([before @ .., last], [first, after @ ..]) = (&from[..], &to[..]) else {
            continue;
        };
        if low == high {
            ranges.extend(from.iter().map(one));
            continue;
        }
        // What the expression would be refused for.
        if last > first {
            return Ok(Read::Never);
        }
        ranges.extend(before.iter().map(one));
        ranges.push((u32::from(*last), u32::from(*first)));
        ranges.extend(after.iter().map(one));
    }
    Ok(read(
        Class::new(ranges, negated, folds).finished(false),
        i - at,
    ))
}

// ───────────────────────────── JavaScript: picomatch and npm `ignore` 5, 7.0.5 hand the text to `RegExp` ─────────────────────────────

const MAX: u32 = 0x10FFFF;
const DIGITS: &[(u32, u32)] = &[(48, 57)];
const NOT_DIGITS: &[(u32, u32)] = &[(0, 47), (58, MAX)];
const WORDS: &[(u32, u32)] = &[(48, 57), (65, 90), (95, 95), (97, 122)];
const NOT_WORDS: &[(u32, u32)] = &[(0, 47), (58, 64), (91, 94), (96, 96), (123, MAX)];
const SPACES: &[(u32, u32)] = &[
    (9, 13),
    (32, 32),
    (0xA0, 0xA0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
    (0xFEFF, 0xFEFF),
];
const NOT_SPACES: &[(u32, u32)] = &[
    (0, 8),
    (14, 31),
    (33, 0x9F),
    (0xA1, 0x167F),
    (0x1681, 0x1FFF),
    (0x200B, 0x2027),
    (0x202A, 0x202E),
    (0x2030, 0x205E),
    (0x2060, 0x2FFF),
    (0x3001, 0xFEFE),
    (0xFF00, MAX),
];

/// What a `\` and what follows it are. `len` counts the `\`.
pub(crate) enum Escape {
    Unit {
        unit: u32,
        len: usize,
    },
    /// `\d`, `\W`, ..
    Ranges(&'static [(u32, u32)]),
    /// `\b`, and `\B`, which is negated.
    WordBoundary {
        negated: bool,
    },
    /// `\c` without a letter: the `\` is a character.
    Backslash,
    /// `\1` .. `\9`: the group of that number if there is one, else `unit`.
    Reference {
        number: u32,
        unit: u32,
        len: usize,
    },
}

/// The value of `digits` to the base `1 << bits`. `None` if one of them is no digit.
fn number(digits: Option<&[u8]>, bits: u32) -> Option<u32> {
    digits?.iter().try_fold(0, |value, digit| {
        let digit = char::from(*digit).to_digit(1 << bits)?;
        Some((value << bits) | digit)
    })
}

/// `source[at]` is `\`, and something follows. As `RegExp` without the flag `u` reads it. An octal escape is read to its end.
pub(crate) fn javascript_escape(source: &[u8], at: usize, in_class: bool) -> Escape {
    let unit = |unit: u32, len: usize| Escape::Unit { unit, len };
    let c = source.get(at + 1).copied().unwrap_or(0);
    match c {
        b'd' => Escape::Ranges(DIGITS),
        b'D' => Escape::Ranges(NOT_DIGITS),
        b'w' => Escape::Ranges(WORDS),
        b'W' => Escape::Ranges(NOT_WORDS),
        b's' => Escape::Ranges(SPACES),
        b'S' => Escape::Ranges(NOT_SPACES),
        b't' => unit(9, 2),
        b'n' => unit(10, 2),
        b'v' => unit(11, 2),
        b'f' => unit(12, 2),
        b'r' => unit(13, 2),
        b'b' if in_class => unit(8, 2),
        b'B' if in_class => unit(66, 2),
        b'b' | b'B' => Escape::WordBoundary { negated: c == b'B' },
        b'x' => match number(source.get(at + 2..at + 4), 4) {
            Some(value) => unit(value, 4),
            None => unit(120, 2),
        },
        b'u' => match number(source.get(at + 2..at + 6), 4) {
            Some(value) => unit(value, 6),
            None => unit(117, 2),
        },
        b'c' => match source.get(at + 2) {
            Some(letter)
                if letter.is_ascii_alphabetic()
                    || in_class && (letter.is_ascii_digit() || *letter == b'_') =>
            {
                unit(u32::from(letter % 32), 3)
            }
            _ => Escape::Backslash,
        },
        b'0'..=b'9' => {
            // `\8` and `\9` are the digits.
            let most = match c {
                b'0'..=b'3' => 3,
                b'4'..=b'7' => 2,
                _ => 0,
            };
            let digits = source.get(at + 1..).unwrap_or_default();
            let octal = digits
                .iter()
                .take(most)
                .take_while(|it| matches!(it, b'0'..=b'7'));
            let len = octal.count();
            let value = number(digits.get(..len), 3).filter(|_| len > 0);
            let digit = u32::from(c);
            let (value, len) = (value.unwrap_or(digit), 1 + len.max(1));
            match c == b'0' || in_class {
                true => unit(value, len),
                false => Escape::Reference {
                    number: u32::from(c - b'0'),
                    unit: value,
                    len,
                },
            }
        }
        // An identity escape, of a UTF-16 unit.
        _ => match Text::UTF16.next(Subject::of(source), at + 1) {
            Some((escaped, len)) => unit(escaped, 1 + len),
            None => Escape::Backslash,
        },
    }
}

/// An element of a class at `*i`. `None`: a set, which has been added.
fn atom(source: &[u8], i: &mut usize, ranges: &mut Ranges) -> Option<u32> {
    if source.get(*i) == Some(&b'\\') && *i + 1 < source.len() {
        return match javascript_escape(source, *i, true) {
            Escape::Ranges(set) => {
                *i += 2;
                ranges.extend_from_slice(set);
                None
            }
            Escape::Unit { unit, len } | Escape::Reference { unit, len, .. } => {
                *i += len;
                Some(unit)
            }
            Escape::Backslash | Escape::WordBoundary { .. } => {
                *i += 1;
                Some(BACKSLASH)
            }
        };
    }
    let (unit, len) = Text::UTF16.next(Subject::of(source), *i)?;
    *i += len;
    Some(unit)
}

/// `source[at]` is `[`. `Read::Never`: `RegExp` throws: it is not closed, or a range is out of order.
pub(crate) fn javascript(source: &[u8], at: usize, folds: bool) -> Read {
    let negated = source.get(at + 1) == Some(&b'^');
    let mut i = at + 1 + usize::from(negated);
    let mut ranges = Ranges::new();
    loop {
        match source.get(i) {
            None => return Read::Never,
            Some(b']') => break,
            Some(_) => {}
        }
        let low = atom(source, &mut i, &mut ranges);
        let is_range =
            source.get(i) == Some(&b'-') && source.get(i + 1).is_some_and(|it| *it != b']');
        if !is_range {
            ranges.extend(low.map(|it| (it, it)));
            continue;
        }
        i += 1;
        match (low, atom(source, &mut i, &mut ranges)) {
            (Some(low), Some(high)) if high < low => return Read::Never,
            (Some(low), Some(high)) => ranges.push((low, high)),
            // `[\d-x]`: the three of them.
            (low, high) => {
                ranges.extend(low.or(high).map(|it| (it, it)));
                ranges.push((DASH, DASH));
            }
        }
    }
    read(
        Class::new(ranges, negated, folds).finished(false),
        i + 1 - at,
    )
}
