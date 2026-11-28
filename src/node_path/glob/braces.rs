//! `brace-expansion`, for a pattern without backslashes: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L96-L291>

use core::ops::Range;

use bun_core::fmt::FormatDouble;
use bun_core::{strings, w};
use bun_paths::PathChar;

use super::append_ascii;
use super::budget::{Abort, Budget, check_stack, cost};
use crate::{BACKSLASH, CodeUnit, byte_at, scan};

const OPEN: u8 = b'{';
const CLOSE: u8 = b'}';
const COMMA: u8 = b',';
/// Stands in for `escOpen` and `escClose`.
const ESCAPED_BRACE: u8 = BACKSLASH;

const EXPANSION_MAX: usize = 100_000;
const EXPANSION_MAX_LENGTH: usize = 4_000_000;

const NOT_FOUND: usize = usize::MAX;

/// Upstream drops the expansions that do not fit, and answers `false` for the paths that they match.
fn check_limits(count: usize, total_len: usize) -> Result<(), Abort> {
    let fits = count <= EXPANSION_MAX && total_len <= EXPANSION_MAX_LENGTH;
    fits.then_some(()).ok_or(Abort::BudgetExceeded)
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Numbers {
    Listed,
    /// `{8..25}` is `{[8-9],1[0-9],2[0-5]}`, for a pattern without brackets and parentheses.
    AsDigitClasses,
}

#[derive(Default)]
pub(super) struct Expansions {
    units: Vec<u16>,
    ends: Vec<usize>,
}

impl Expansions {
    fn one(text: &[u16]) -> Self {
        Expansions {
            units: text.to_vec(),
            ends: vec![text.len()],
        }
    }

    fn push(&mut self, pieces: &[&[u16]]) -> Result<(), Abort> {
        for piece in pieces {
            self.units.extend_from_slice(piece);
        }
        self.ends.push(self.units.len());
        check_limits(self.len(), self.units.len())
    }

    fn len(&self) -> usize {
        self.ends.len()
    }

    fn memory_cost(&self) -> usize {
        size_of_val(&self.units[..]) + size_of_val(&self.ends[..])
    }

    fn get(&self, index: usize) -> &[u16] {
        let start = index.checked_sub(1).map_or(0, |it| self.ends[it]);
        &self.units[start..self.ends[index]]
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &[u16]> {
        let mut start = 0;
        (self.ends.iter()).map(move |&end| &self.units[core::mem::replace(&mut start, end)..end])
    }

    pub(super) fn has_bracket(&self) -> bool {
        scan::index_of(&self.units, b'[').is_some()
    }
}

/// `/\{(?:(?!\{).)*\}/.test(pattern)`
fn has_braces(pattern: &[u16]) -> bool {
    let mut is_open = false;
    pattern.iter().any(|&unit| {
        is_open = unit.eq_ascii(OPEN) || (is_open && !strings::is_js_line_terminator(unit.into()));
        is_open && unit.eq_ascii(CLOSE)
    })
}

/// `None` if the numbers have to be listed: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1238-L1244>
pub(super) fn brace_expand(
    pattern: &[u16],
    numbers: Numbers,
    budget: &mut Budget<'_>,
) -> Result<Option<Expansions>, Abort> {
    if !has_braces(pattern) {
        return Ok(Some(Expansions::one(pattern)));
    }
    let mut pattern = pattern.to_vec();
    let starts_with_empty_braces = pattern.starts_with(w!("{}"));
    if starts_with_empty_braces {
        pattern[.."{}".len()].fill(ESCAPED_BRACE.into());
    }
    let checkpoint = budget.bytes_in_use();
    let mut expander = Expander::new(pattern, numbers);
    let mut expansions = expander.expand_all(Scope::Top, budget)?;
    if numbers == Numbers::AsDigitClasses && expander.has_listed_bracket {
        return Ok(None);
    }
    budget.settle_memory(checkpoint, expansions.memory_cost())?;
    strings::replace_char_in_place(&mut expansions.units, ESCAPED_BRACE, CLOSE);
    if starts_with_empty_braces {
        let mut start = 0;
        for &end in &expansions.ends {
            expansions.units[start] = OPEN.into();
            start = end;
        }
    }
    Ok(Some(expansions))
}

struct BraceGroup {
    values: Expansions,
    /// The literal text up to the next group.
    post: Vec<u16>,
}

/// The `acc` of `expand_`. Its strings are only written out once, after the last group.
struct LazyCombine {
    common_prefix: Vec<u16>,
    /// Those with more than one value. The last varies fastest.
    groups: Vec<BraceGroup>,
    count: usize,
    total_len: usize,
}

impl LazyCombine {
    fn new() -> Self {
        LazyCombine {
            common_prefix: Vec::new(),
            groups: Vec::new(),
            count: 1,
            total_len: 0,
        }
    }

    fn memory_cost(&self) -> usize {
        let of_group = |it: &BraceGroup| it.values.memory_cost() + size_of_val(&it.post[..]);
        size_of_val(&self.common_prefix[..]) + self.groups.iter().map(of_group).sum::<usize>()
    }

    fn is_all_empty(&self) -> bool {
        self.total_len == 0
    }

    /// `acc = combine(acc, pre, values)`
    fn combine_lazily(
        &mut self,
        pre: &[u16],
        values: Expansions,
        budget: &mut Budget<'_>,
    ) -> Result<(), Abort> {
        budget.spend(cost::CALL + pre.len() + values.units.len())?;
        self.total_len = (self.total_len + self.count * pre.len()) * values.len()
            + self.count * values.units.len();
        self.count *= values.len();
        check_limits(self.count, self.total_len)?;

        let literal = match self.groups.last_mut() {
            Some(last) => &mut last.post,
            None => &mut self.common_prefix,
        };
        literal.extend_from_slice(pre);
        if values.len() < 2 {
            literal.extend_from_slice(&values.units);
        } else {
            let post = Vec::new();
            self.groups.push(BraceGroup { values, post });
        }
        Ok(())
    }

    fn write_expansion(&self, index: usize, text: &mut Vec<u16>) {
        let mut stride = self.count;
        text.clone_from(&self.common_prefix);
        for group in &self.groups {
            stride /= group.values.len();
            text.extend_from_slice(group.values.get(index / stride % group.values.len()));
            text.extend_from_slice(&group.post);
        }
    }

    /// `return combine(acc, pre, values)`
    fn combine(
        &self,
        pre: &[u16],
        values: &Expansions,
        drop_empties: bool,
        budget: &mut Budget<'_>,
    ) -> Result<Expansions, Abort> {
        let mut out = Expansions::default();
        let mut acc = Vec::new();
        for index in 0..self.count {
            self.write_expansion(index, &mut acc);
            budget.spend(cost::CALL * self.groups.len() + acc.len())?;
            for value in values.iter() {
                let len = acc.len() + pre.len() + value.len();
                budget.spend(cost::CALL + len)?;
                if !(drop_empties && len == 0) {
                    out.push(&[&acc, pre, value])?;
                }
            }
        }
        Ok(out)
    }
}

/// The results of the searches that upstream repeats on `text.slice(index)`.
#[derive(Clone, Copy)]
struct Lookahead {
    unmatched_close: usize,
    comma: usize,
    /// The earliest end of a match of `/,(?!,).*\}/`.
    close_after_comma: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Scope {
    Top,
    /// A result of `embrace`.
    Embraced,
    /// Braces are balanced here.
    InBraces,
}

struct Expander {
    text: Vec<u16>,
    /// One per index of `text` and one for its end. Not updated when a brace is escaped.
    lookahead: Vec<Lookahead>,
    numbers: Numbers,
    /// `{A..z}` has one.
    has_listed_bracket: bool,
}

impl Expander {
    fn new(text: Vec<u16>, numbers: Numbers) -> Self {
        let at_end = Lookahead {
            unmatched_close: NOT_FOUND,
            comma: NOT_FOUND,
            close_after_comma: NOT_FOUND,
        };
        let mut lookahead = vec![at_end; text.len() + 1];
        let mut close_on_line = NOT_FOUND;
        for (at, &unit) in text.iter().enumerate().rev() {
            let mut next = lookahead[at + 1];
            if unit.eq_ascii(CLOSE) {
                (next.unmatched_close, close_on_line) = (at, at);
            } else if unit.eq_ascii(OPEN) && next.unmatched_close != NOT_FOUND {
                next.unmatched_close = lookahead[next.unmatched_close + 1].unmatched_close;
            } else if unit.eq_ascii(COMMA) {
                next.comma = at;
                if byte_at(&text, at + 1) != COMMA {
                    next.close_after_comma = next.close_after_comma.min(close_on_line);
                }
            } else if strings::is_js_line_terminator(unit.into()) {
                close_on_line = NOT_FOUND;
            }
            lookahead[at] = next;
        }
        Expander {
            text,
            lookahead,
            numbers,
            has_listed_bracket: false,
        }
    }

    fn expand_all(&mut self, scope: Scope, budget: &mut Budget<'_>) -> Result<Expansions, Abort> {
        budget.spend(self.text.len())?;
        budget.charge_memory(size_of_val(&self.lookahead[..]))?;
        self.expand(0..self.text.len(), scope, budget)
    }

    /// The indices of the braces that `balanced("{", "}", text.slice(within))` finds.
    fn balanced(&self, within: Range<usize>) -> Option<(usize, usize)> {
        let end = within.end;
        within
            .filter(|&at| self.text[at].eq_ascii(OPEN))
            .map(|open| (open, self.lookahead[open + 1].unmatched_close))
            .find(|&(_, close)| close < end)
    }

    fn parse_comma_parts(&self, body: Range<usize>) -> Vec<Range<usize>> {
        let mut parts = Vec::new();
        let (mut start, mut at) = (body.start, body.start);
        while at < body.end {
            if self.text[at].eq_ascii(OPEN) {
                at = self.lookahead[at + 1].unmatched_close;
                debug_assert!(at < body.end);
            } else if self.text[at].eq_ascii(COMMA) {
                parts.push(start..at);
                start = at + 1;
            }
            at += 1;
        }
        parts.push(start..body.end);
        parts
    }

    /// `expand_`
    fn expand(
        &mut self,
        range: Range<usize>,
        scope: Scope,
        budget: &mut Budget<'_>,
    ) -> Result<Expansions, Abort> {
        check_stack()?;
        let mut is_top = scope == Scope::Top;
        let mut may_have_unmatched_close = scope != Scope::InBraces;
        let (mut acc, checkpoint) = (LazyCombine::new(), budget.bytes_in_use());
        let (mut drop_empties, mut is_first_group) = (false, true);
        let Range { mut start, end } = range;
        let mut braces = self.balanced(start..end);
        let mut body_has_escaped_close = false;
        while let Some((open, close)) = braces {
            let (body, post) = (open + 1..close, self.lookahead[close + 1]);
            let is_last = close + 1 == end;
            let (pre, values) = if open > start && self.text[open - 1].eq_ascii(b'$') {
                is_first_group = false;
                (start..close + 1, Expansions::one(&[]))
            } else {
                let sequence = if body_has_escaped_close {
                    None
                } else {
                    Sequence::parse(&self.text[body.clone()])
                };
                let is_options = self.lookahead[body.start].comma < close;
                if sequence.is_none() && !is_options {
                    if post.close_after_comma >= end {
                        break;
                    }
                    // `{a},b}` is `{a\},b}`.
                    self.text[close] = ESCAPED_BRACE.into();
                    is_top = true;
                    may_have_unmatched_close &= post.unmatched_close != NOT_FOUND;
                    body_has_escaped_close = may_have_unmatched_close;
                    braces = if may_have_unmatched_close {
                        Some((open, post.unmatched_close))
                    } else {
                        self.balanced(open + 1..end)
                    };
                    continue;
                }
                if is_first_group {
                    drop_empties = is_top && sequence.is_none();
                    is_first_group = false;
                }
                let values = match sequence {
                    Some(sequence) => {
                        let values = sequence.expand(self.numbers, budget)?;
                        self.has_listed_bracket |= sequence.is_alpha && values.has_bracket();
                        values
                    }
                    None => {
                        let drops_empties =
                            drop_empties && is_last && start == open && acc.is_all_empty();
                        self.expand_options(body, drops_empties, budget)?
                    }
                };
                (start..open, values)
            };
            if is_last {
                return acc.combine(&self.text[pre], &values, drop_empties, budget);
            }
            acc.combine_lazily(&self.text[pre], values, budget)?;
            budget.settle_memory(checkpoint, acc.memory_cost())?;
            start = close + 1;
            braces = self.balanced(start..end);
            body_has_escaped_close = false;
        }
        let rest = &self.text[start..end];
        acc.combine(rest, &Expansions::one(&[]), drop_empties, budget)
    }

    fn expand_options(
        &mut self,
        body: Range<usize>,
        drops_empties: bool,
        budget: &mut Budget<'_>,
    ) -> Result<Expansions, Abort> {
        let mut values = Expansions::default();
        let mut push_all = |expanded: Expansions, checkpoint: usize, budget: &mut Budget<'_>| {
            for value in expanded.iter() {
                if !(drops_empties && value.is_empty()) {
                    values.push(&[value])?;
                }
            }
            budget.settle_memory(checkpoint, values.memory_cost())
        };
        let checkpoint = budget.bytes_in_use();
        let comma_parts = self.parse_comma_parts(body.clone());
        if comma_parts.len() > 1 {
            for part in comma_parts {
                let expanded = self.expand(part, Scope::InBraces, budget)?;
                push_all(expanded, checkpoint, budget)?;
            }
            return Ok(values);
        }
        // `x{{a,b}}y` is `x{a}y` and `x{b}y`, which are parsed again.
        let numbers = core::mem::replace(&mut self.numbers, Numbers::Listed);
        let inner = self.expand(body, Scope::InBraces, budget)?;
        self.numbers = numbers;
        let embrace = |text: &[u16]| [w!("{"), text, w!("}")].concat();
        if inner.len() == 1 {
            return Ok(Expansions::one(&embrace(&inner.units)));
        }
        budget.settle_memory(checkpoint, inner.memory_cost())?;
        let checkpoint = budget.bytes_in_use();
        for text in inner.iter() {
            let mut expander = Expander::new(embrace(text), numbers);
            let expanded = expander.expand_all(Scope::Embraced, budget)?;
            self.has_listed_bracket |= expander.has_listed_bracket;
            push_all(expanded, checkpoint, budget)?;
        }
        Ok(values)
    }
}

/// `{1..9}`, `{a..z}` or `{1..9..2}`.
struct Sequence {
    first: f64,
    last: f64,
    step: f64,
    is_alpha: bool,
    /// 0 if numbers are not padded.
    width: usize,
}

/// Splits after a leading `/-?\d+/`.
fn split_integer(text: &[u16]) -> Option<(&[u16], &[u16])> {
    let sign = usize::from(byte_at(text, 0) == b'-');
    let is_digit = |unit: &&u16| unit.to_u8_saturating().is_ascii_digit();
    match text[sign..].iter().take_while(is_digit).count() {
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
    let ascii: Vec<u8> = text.iter().map(|unit| unit.to_u8_saturating()).collect();
    bun_core::fmt::parse_f64(&ascii).expect("split_integer has checked it")
}

impl Sequence {
    fn parse(body: &[u16]) -> Option<Self> {
        let is_alpha = split_letter(body).is_some();
        let split = if is_alpha {
            split_letter
        } else {
            split_integer
        };
        let (first, rest) = split(body)?;
        let (last, rest) = split(rest.strip_prefix(w!(".."))?)?;
        let step = match rest {
            [] => rest,
            _ => match split_integer(rest.strip_prefix(w!(".."))?)? {
                (step, []) => step,
                _ => return None,
            },
        };
        let is_padded = |text: &[u16]| {
            let sign = usize::from(byte_at(text, 0) == b'-');
            byte_at(text, sign) == b'0' && text.len() > sign + 1
        };
        let numeric = |text: &[u16]| {
            if is_alpha {
                f64::from(text[0])
            } else {
                parse_integer(text)
            }
        };
        Some(Sequence {
            first: numeric(first),
            last: numeric(last),
            step: match step {
                [] => 1.0,
                _ => parse_integer(step).abs().max(1.0),
            },
            is_alpha,
            width: if [first, last, step].into_iter().any(is_padded) {
                first.len().max(last.len())
            } else {
                0
            },
        })
    }

    /// `expandSequence`
    fn expand(&self, numbers: Numbers, budget: &mut Budget<'_>) -> Result<Expansions, Abort> {
        let mut values = Expansions::default();
        let mut text = Vec::new();
        let (low, high) = (self.first.min(self.last), self.first.max(self.last));
        let as_digit_classes = numbers == Numbers::AsDigitClasses
            && !self.is_alpha
            && self.step == 1.0
            && low >= 0.0
            && high <= MAX_SAFE_INTEGER
            // `{10..9}` has no class, so it keeps its order.
            && high - low >= 2.0;
        let reverse = self.last < self.first && !as_digit_classes;
        let mut step = if reverse { -self.step } else { self.step };
        let mut value = if reverse { high } else { low };
        while (low..=high).contains(&value) {
            text.clear();
            if !self.is_alpha {
                let mut buffer = [0; 124];
                let digits = FormatDouble::dtoa(&mut buffer, value);
                let (sign, digits) = digits.split_at(usize::from(value < 0.0));
                let zeros = self.width.saturating_sub(sign.len() + digits.len());
                append_ascii(&mut text, sign);
                text.extend(core::iter::repeat_n(u16::from(b'0'), zeros));
                append_ascii(&mut text, digits);
            } else if value != f64::from(BACKSLASH) {
                text.push(value as u16);
            }
            if as_digit_classes {
                step = widen_last_digits(&mut text, (high - value) as u64 + 1) as f64;
            }
            budget.spend(cost::LOOKUP + text.len())?;
            values.push(&[&text])?;
            // From 2^53 on, adding 1 changes nothing.
            if low == high {
                break;
            }
            value += step;
        }
        Ok(values)
    }
}

const MAX_SAFE_INTEGER: f64 = ((1u64 << f64::MANTISSA_DIGITS) - 1) as f64;

/// Makes `digits` match the numbers that follow it too, at most `max_count` in all. Returns how many it matches.
fn widen_last_digits(digits: &mut Vec<u16>, max_count: u64) -> u64 {
    let (mut at, mut place_value) = (digits.len() - 1, 1);
    while at != 0 && digits[at].eq_ascii(b'0') && place_value * 10 <= max_count {
        at -= 1;
        place_value *= 10;
    }
    let first = digits[at].to_u8_saturating();
    let count = (max_count / place_value).min(u64::from(b'9' + 1 - first));
    let any_digits = digits.len() - 1 - at;
    if count > 1 {
        digits.truncate(at);
        append_ascii(digits, &[b'[', first, b'-', first + count as u8 - 1, b']']);
    } else {
        digits.truncate(at + 1);
    }
    for _ in 0..any_digits {
        append_ascii(digits, b"[0-9]");
    }
    count * place_value
}
