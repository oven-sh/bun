//! The package `brace-expansion`, for a pattern that has no backslash.

use core::ops::Range;

use bun_core::fmt::FormatDouble;

use super::{Stop, Work, is_line_terminator};
use crate::{BACKSLASH, Unit, byte_at};

const OPEN: u8 = b'{';
const CLOSE: u8 = b'}';
const COMMA: u8 = b',';
/// A brace that is to be taken as it is.
const ESCAPED: u8 = BACKSLASH;
/// About how much longer the package spells one. There it has a random number in it.
const ESCAPED_EXTRA: usize = 24;

const MOST: usize = 100_000;
const LONGEST_TOGETHER: usize = 4_000_000;

const NOWHERE: usize = usize::MAX;

#[derive(Default)]
pub(super) struct Texts {
    units: Vec<u16>,
    /// Where each ends in `units`, and how long the package takes it to be.
    ends: Vec<(usize, usize)>,
    /// How long it takes all of them to be.
    length: usize,
}

impl Texts {
    fn one(text: &[u16]) -> Self {
        let mut texts = Texts::default();
        texts.push([text, &[], &[]], length_of(text));
        texts
    }

    fn push(&mut self, pieces: [&[u16]; 3], length: usize) {
        for piece in pieces {
            self.units.extend_from_slice(piece);
        }
        self.ends.push((self.units.len(), length));
        self.length += length;
    }

    fn has_room_for(&self, length: usize) -> bool {
        self.ends.len() < MOST && self.length + length <= LONGEST_TOGETHER
    }

    fn with_lengths(&self) -> impl Iterator<Item = (&[u16], usize)> {
        let mut start = 0;
        self.ends.iter().map(move |&(end, length)| {
            let text = &self.units[start..end];
            start = end;
            (text, length)
        })
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &[u16]> {
        self.with_lengths().map(|(text, _)| text)
    }
}

fn length_of(text: &[u16]) -> usize {
    text.len() + ESCAPED_EXTRA * text.iter().filter(|unit| unit.is(ESCAPED)).count()
}

/// `/\{(?:(?!\{).)*\}/.test(pattern)`
fn has_braces(pattern: &[u16]) -> bool {
    let mut is_open = false;
    pattern.iter().any(|&unit| {
        is_open = unit.is(OPEN) || (is_open && !is_line_terminator(unit));
        is_open && unit.is(CLOSE)
    })
}

pub(super) fn expand(mut pattern: Vec<u16>, work: &mut Work<'_>) -> Result<Texts, Stop> {
    if !has_braces(&pattern) {
        return Ok(Texts::one(&pattern));
    }
    let starts_with_empty = pattern[0].is(OPEN) && pattern[1].is(CLOSE);
    if starts_with_empty {
        pattern[..2].fill(ESCAPED.into());
    }
    let mut texts = Source::new(pattern).expand_all(Scope::Pattern, work)?;
    crate::replace(&mut texts.units, ESCAPED, CLOSE);
    if starts_with_empty {
        let mut start = 0;
        for &(end, _) in &texts.ends {
            texts.units[start] = OPEN.into();
            start = end;
        }
    }
    Ok(texts)
}

/// Each of `before`, then `between`, then each of `after`, as long as there is room.
fn combine(
    before: &Texts,
    between: &[u16],
    after: &Texts,
    drops_empty: bool,
    work: &mut Work<'_>,
) -> Result<Texts, Stop> {
    let mut combined = Texts::default();
    let between_length = length_of(between);
    work.spend(between.len())?;
    for (before, before_length) in before.with_lengths() {
        for (after, after_length) in after.with_lengths() {
            let length = before_length + between_length + after_length;
            work.spend(8 + length)?;
            if drops_empty && length == 0 {
                continue;
            }
            if !combined.has_room_for(length) {
                return Ok(combined);
            }
            combined.push([before, between, after], length);
        }
    }
    Ok(combined)
}

/// What comes next from some index on.
#[derive(Clone, Copy)]
struct Ahead {
    /// The first closing brace whose opening brace is not from here on too.
    close: usize,
    comma: usize,
    /// Where the first match of `/,(?!,).*\}/` can end.
    close_after_comma: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Scope {
    Pattern,
    /// A result with braces put back around it.
    Rewritten,
    /// Each closing brace belongs to an opening one.
    InBraces,
}

struct Source {
    text: Vec<u16>,
    /// For each index and the end, as `text` was before a brace was escaped in it.
    ahead: Vec<Ahead>,
}

impl Source {
    fn new(text: Vec<u16>) -> Self {
        let nothing = Ahead {
            close: NOWHERE,
            comma: NOWHERE,
            close_after_comma: NOWHERE,
        };
        let mut ahead = vec![nothing; text.len() + 1];
        let mut close_in_line = NOWHERE;
        for (at, &unit) in text.iter().enumerate().rev() {
            let mut here = ahead[at + 1];
            if unit.is(CLOSE) {
                (here.close, close_in_line) = (at, at);
            } else if unit.is(OPEN) && here.close != NOWHERE {
                here.close = ahead[here.close + 1].close;
            } else if unit.is(COMMA) {
                here.comma = at;
                if byte_at(&text, at + 1) != COMMA {
                    here.close_after_comma = here.close_after_comma.min(close_in_line);
                }
            } else if is_line_terminator(unit) {
                close_in_line = NOWHERE;
            }
            ahead[at] = here;
        }
        Source { text, ahead }
    }

    fn expand_all(&mut self, scope: Scope, work: &mut Work<'_>) -> Result<Texts, Stop> {
        work.spend(self.text.len())?;
        self.expand(0..self.text.len(), scope, work)
    }

    /// The first braces in `within` that belong together.
    fn first_pair(&self, within: Range<usize>) -> Option<(usize, usize)> {
        let end = within.end;
        within
            .filter(|&at| self.text[at].is(OPEN))
            .map(|open| (open, self.ahead[open + 1].close))
            .find(|&(_, close)| close < end)
    }

    /// `body` has as many opening as closing braces.
    fn split_at_commas(&self, body: Range<usize>) -> Vec<Range<usize>> {
        let mut options = Vec::new();
        let (mut start, mut at) = (body.start, body.start);
        while at < body.end {
            if self.text[at].is(OPEN) {
                at = self.ahead[at + 1].close;
            } else if self.text[at].is(COMMA) {
                options.push(start..at);
                start = at + 1;
            }
            at += 1;
        }
        options.push(start..body.end);
        options
    }

    fn expand(
        &mut self,
        range: Range<usize>,
        scope: Scope,
        work: &mut Work<'_>,
    ) -> Result<Texts, Stop> {
        work.check_stack()?;
        let mut is_top = scope == Scope::Pattern;
        let mut may_have_spare_close = scope != Scope::InBraces;
        let nothing = Texts::one(&[]);
        let mut expanded = Texts::one(&[]);
        let (mut drops_empty, mut is_first_group) = (false, true);
        let Range { mut start, end } = range;
        let mut pair = self.first_pair(start..end);
        let mut has_escaped_close = false;
        loop {
            let Some((open, close)) = pair else {
                let rest = &self.text[start..end];
                return combine(&expanded, rest, &nothing, drops_empty, work);
            };
            let (before, body) = (start..open, open + 1..close);
            let is_last = close + 1 == end;
            let mut values = None;
            if open > start && self.text[open - 1].is(b'$') {
                is_first_group = false;
            } else {
                let sequence = Sequence::of(&self.text[body.clone()], has_escaped_close);
                if sequence.is_none() && self.ahead[body.start].comma >= close {
                    if self.ahead[close + 1].close_after_comma >= end {
                        let rest = &self.text[start..end];
                        return combine(&expanded, rest, &nothing, drops_empty, work);
                    }
                    self.text[close] = ESCAPED.into();
                    is_top = true;
                    may_have_spare_close &= self.ahead[close + 1].close != NOWHERE;
                    has_escaped_close = may_have_spare_close;
                    pair = if may_have_spare_close {
                        Some((open, self.ahead[close + 1].close))
                    } else {
                        self.first_pair(open + 1..end)
                    };
                    continue;
                }
                if is_first_group {
                    drops_empty = is_top && sequence.is_none();
                    is_first_group = false;
                }
                values = Some(match sequence {
                    Some(sequence) => sequence.expand(work)?,
                    None => {
                        let is_all = is_last && before.is_empty() && expanded.length == 0;
                        self.expand_options(body, drops_empty && is_all, work)?
                    }
                });
            }
            let (between, values) = match &values {
                Some(values) => (before, values),
                None => (start..close + 1, &nothing),
            };
            let drops_empty = drops_empty && is_last;
            expanded = combine(&expanded, &self.text[between], values, drops_empty, work)?;
            if is_last {
                return Ok(expanded);
            }
            start = close + 1;
            pair = self.first_pair(start..end);
            has_escaped_close = false;
        }
    }

    fn expand_options(
        &mut self,
        body: Range<usize>,
        drops_empty: bool,
        work: &mut Work<'_>,
    ) -> Result<Texts, Stop> {
        let mut values = Texts::default();
        let mut has_room_after = |expanded: Texts| {
            for (value, length) in expanded.with_lengths() {
                if drops_empty && length == 0 {
                    continue;
                }
                if !values.has_room_for(length) {
                    return false;
                }
                values.push([value, &[], &[]], length);
            }
            true
        };
        let options = self.split_at_commas(body.clone());
        if options.len() > 1 {
            for option in options {
                if !has_room_after(self.expand(option, Scope::InBraces, work)?) {
                    break;
                }
            }
            return Ok(values);
        }
        // The commas are in braces further in. These go back around each result.
        let inner = self.expand(body, Scope::InBraces, work)?;
        let embrace = |text: &[u16]| [&[OPEN.into()][..], text, &[CLOSE.into()]].concat();
        if inner.ends.len() == 1 {
            return Ok(Texts::one(&embrace(&inner.units)));
        }
        for text in inner.iter() {
            if !has_room_after(Source::new(embrace(text)).expand_all(Scope::Rewritten, work)?) {
                break;
            }
        }
        Ok(values)
    }
}

/// `{1..9}`, `{a..z}` or `{1..9..2}`.
struct Sequence {
    first: f64,
    last: f64,
    step: f64,
    is_of_letters: bool,
    /// How many characters to fill up to with zeros.
    width: usize,
}

/// `text` without the `/-?\d+/` that it starts with, if it does.
fn split_integer(text: &[u16]) -> Option<(&[u16], &[u16])> {
    let sign = usize::from(byte_at(text, 0) == b'-');
    let digits = text[sign..]
        .iter()
        .take_while(|unit| unit.byte().is_ascii_digit());
    match digits.count() {
        0 => None,
        digits => Some(text.split_at(sign + digits)),
    }
}

fn split_letter(text: &[u16]) -> Option<(&[u16], &[u16])> {
    byte_at(text, 0)
        .is_ascii_alphabetic()
        .then(|| text.split_at(1))
}

fn parse_integer(text: &[u16]) -> f64 {
    let text: String = text.iter().map(|unit| char::from(unit.byte())).collect();
    text.parse().expect("it is a sign and digits")
}

impl Sequence {
    fn of(body: &[u16], has_escaped_close: bool) -> Option<Self> {
        const DOTS: &[u16] = &[b'.' as u16; 2];
        if has_escaped_close {
            return None;
        }
        let is_of_letters = split_letter(body).is_some();
        let split = if is_of_letters {
            split_letter
        } else {
            split_integer
        };
        let (first, rest) = split(body)?;
        let (last, rest) = split(rest.strip_prefix(DOTS)?)?;
        let step = match rest {
            [] => rest,
            _ => match split_integer(rest.strip_prefix(DOTS)?)? {
                (step, []) => step,
                _ => return None,
            },
        };
        let is_padded = |text: &[u16]| {
            let sign = usize::from(byte_at(text, 0) == b'-');
            byte_at(text, sign) == b'0' && text.len() > sign + 1
        };
        let value_of = |text: &[u16]| {
            if is_of_letters {
                f64::from(text[0])
            } else {
                parse_integer(text)
            }
        };
        Some(Sequence {
            first: value_of(first),
            last: value_of(last),
            step: match step {
                [] => 1.0,
                _ => parse_integer(step).abs().max(1.0),
            },
            is_of_letters,
            width: if [first, last, step].into_iter().any(is_padded) {
                first.len().max(last.len())
            } else {
                0
            },
        })
    }

    fn expand(&self, work: &mut Work<'_>) -> Result<Texts, Stop> {
        let mut values = Texts::default();
        let mut text = Vec::new();
        let is_down = self.last < self.first;
        let step = if is_down { -self.step } else { self.step };
        let mut value = self.first;
        while if is_down {
            value >= self.last
        } else {
            value <= self.last
        } {
            text.clear();
            if !self.is_of_letters {
                let mut buffer = [0; 124];
                let digits = FormatDouble::dtoa(&mut buffer, value);
                let (sign, digits) = digits.split_at(usize::from(value < 0.0));
                let zeros = self.width.saturating_sub(sign.len() + digits.len());
                text.extend(sign.iter().map(|&byte| u16::from(byte)));
                text.extend(core::iter::repeat_n(u16::from(b'0'), zeros));
                text.extend(digits.iter().map(|&byte| u16::from(byte)));
            } else if value != f64::from(BACKSLASH) {
                text.push(value as u16);
            }
            work.spend(64 + text.len())?;
            if !values.has_room_for(text.len()) {
                break;
            }
            values.push([&text, &[], &[]], text.len());
            value += step;
        }
        Ok(values)
    }
}
