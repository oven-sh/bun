//! `brace-expansion`, for a pattern without backslashes: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L96-L291>

use core::ops::Range;
use std::collections::VecDeque;

use bun_core::fmt::FormatDouble;
use bun_core::{strings, w};
use bun_paths::PathChar;

use super::append_ascii;
use super::budget::{Abort, Budget, check_stack, cost};
use crate::{BACKSLASH, CodeUnit, byte_at};

const OPEN: u8 = b'{';
const CLOSE: u8 = b'}';
const COMMA: u8 = b',';
/// Stands in for `escOpen` and `escClose`.
const ESCAPED_BRACE: u8 = BACKSLASH;
/// The usual length of `"\0CLOSE" + Math.random() + "\0"`, which counts toward [`EXPANSION_MAX_LENGTH`].
const UPSTREAM_ESCAPED_BRACE_LEN: usize = 25;

const EXPANSION_MAX: usize = 100_000;
const EXPANSION_MAX_LENGTH: usize = 4_000_000;

const NOT_FOUND: usize = usize::MAX;

fn upstream_len(text: &[u16]) -> usize {
    let escaped = text.iter().filter(|unit| unit.eq_ascii(ESCAPED_BRACE));
    text.len() + (UPSTREAM_ESCAPED_BRACE_LEN - 1) * escaped.count()
}

#[derive(Clone, Copy)]
struct Expansion {
    /// In [`Expansions::units`].
    end: usize,
    upstream_len: usize,
}

#[derive(Default)]
pub(super) struct Expansions {
    units: Vec<u16>,
    entries: Vec<Expansion>,
    total_upstream_len: usize,
}

impl Expansions {
    fn one(text: &[u16]) -> Self {
        let mut expansions = Expansions::default();
        expansions.push(&[text], upstream_len(text));
        expansions
    }

    fn push(&mut self, pieces: &[&[u16]], upstream_len: usize) {
        for piece in pieces {
            self.units.extend_from_slice(piece);
        }
        let end = self.units.len();
        self.entries.push(Expansion { end, upstream_len });
        self.total_upstream_len += upstream_len;
    }

    fn len(&self) -> usize {
        self.entries.len()
    }

    fn has_room_for(&self, upstream_len: usize) -> bool {
        self.len() < EXPANSION_MAX && self.total_upstream_len + upstream_len <= EXPANSION_MAX_LENGTH
    }

    fn memory_cost(&self) -> usize {
        size_of_val(&self.units[..]) + size_of_val(&self.entries[..])
    }

    fn get(&self, index: usize) -> &[u16] {
        let start = index.checked_sub(1).map_or(0, |it| self.entries[it].end);
        &self.units[start..self.entries[index].end]
    }

    fn iter_with_upstream_len(&self) -> impl Iterator<Item = (&[u16], usize)> {
        let mut start = 0;
        self.entries.iter().map(move |entry| {
            let text = &self.units[start..entry.end];
            start = entry.end;
            (text, entry.upstream_len)
        })
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &[u16]> {
        self.iter_with_upstream_len().map(|(text, _)| text)
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

/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1238-L1244>
pub(super) fn brace_expand(
    mut pattern: Vec<u16>,
    budget: &mut Budget<'_>,
) -> Result<Expansions, Abort> {
    if !has_braces(&pattern) {
        return Ok(Expansions::one(&pattern));
    }
    let starts_with_empty_braces = pattern.starts_with(w!("{}"));
    if starts_with_empty_braces {
        pattern[.."{}".len()].fill(ESCAPED_BRACE.into());
    }
    let checkpoint = budget.bytes_in_use();
    let mut expansions = Expander::new(pattern).expand_all(Scope::Top, budget)?;
    budget.settle_memory(checkpoint, expansions.memory_cost())?;
    strings::replace_char_in_place(&mut expansions.units, ESCAPED_BRACE, CLOSE);
    if starts_with_empty_braces {
        let mut start = 0;
        for entry in &expansions.entries {
            expansions.units[start] = OPEN.into();
            start = entry.end;
        }
    }
    Ok(expansions)
}

struct BraceGroup {
    values: Expansions,
    /// The literal text up to the next group.
    post: Vec<u16>,
}

/// The `acc` of `expand_`. Its strings are only written out once, after the last group.
struct LazyCombine {
    common_prefix: Vec<u16>,
    /// Those with more than one value in use. The last varies fastest.
    groups: VecDeque<BraceGroup>,
    upstream_lens: Vec<u32>,
}

impl LazyCombine {
    fn new() -> Self {
        LazyCombine {
            common_prefix: Vec::new(),
            groups: VecDeque::new(),
            upstream_lens: vec![0],
        }
    }

    fn memory_cost(&self) -> usize {
        let of_group = |it: &BraceGroup| it.values.memory_cost() + size_of_val(&it.post[..]);
        size_of_val(&self.common_prefix[..])
            + size_of_val(&self.upstream_lens[..])
            + self.groups.iter().map(of_group).sum::<usize>()
    }

    fn is_all_empty(&self) -> bool {
        self.upstream_lens.iter().all(|&len| len == 0)
    }

    /// `acc = combine(acc, pre, values)`
    fn combine_lazily(
        &mut self,
        pre: &[u16],
        values: Expansions,
        budget: &mut Budget<'_>,
    ) -> Result<(), Abort> {
        let pre_len = upstream_len(pre);
        let mut upstream_lens = Vec::new();
        let mut total_len = 0;
        'combine: for &acc_len in &self.upstream_lens {
            for value in &values.entries {
                let len = acc_len as usize + pre_len + value.upstream_len;
                total_len += len;
                if upstream_lens.len() == EXPANSION_MAX || total_len > EXPANSION_MAX_LENGTH {
                    break 'combine;
                }
                upstream_lens.push(len as u32);
            }
        }
        budget.spend(pre.len() + self.upstream_lens.len() + upstream_lens.len())?;
        self.upstream_lens = upstream_lens;

        let literal = match self.groups.back_mut() {
            Some(last) => &mut last.post,
            None => &mut self.common_prefix,
        };
        literal.extend_from_slice(pre);
        if values.len() < 2 {
            literal.extend_from_slice(&values.units);
            return Ok(());
        }
        let post = Vec::new();
        self.groups.push_back(BraceGroup { values, post });
        // The limits cut the list off before the leading groups get to their second value.
        let mut combinations = 1;
        let still_varies = |group: &&BraceGroup| {
            let still_varies = combinations < self.upstream_lens.len();
            combinations = combinations.saturating_mul(group.values.len());
            still_varies
        };
        let varying = self.groups.iter().rev().take_while(still_varies).count();
        for fixed in self.groups.drain(..self.groups.len() - varying) {
            self.common_prefix.extend_from_slice(fixed.values.get(0));
            self.common_prefix.extend_from_slice(&fixed.post);
        }
        Ok(())
    }

    fn write_expansion(&self, index: usize, text: &mut Vec<u16>) {
        let mut stride: usize = self.groups.iter().map(|it| it.values.len()).product();
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
        let pre_len = upstream_len(pre);
        budget.spend(pre.len())?;
        let mut acc = Vec::new();
        for (index, &acc_len) in self.upstream_lens.iter().enumerate() {
            budget.spend(cost::CALL * self.groups.len() + acc_len as usize)?;
            self.write_expansion(index, &mut acc);
            for (value, value_len) in values.iter_with_upstream_len() {
                let len = acc_len as usize + pre_len + value_len;
                budget.spend(cost::CALL + len)?;
                if drop_empties && len == 0 {
                    continue;
                }
                if !out.has_room_for(len) {
                    return Ok(out);
                }
                out.push(&[&acc, pre, value], len);
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
}

impl Expander {
    fn new(text: Vec<u16>) -> Self {
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
        Expander { text, lookahead }
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
                    Some(sequence) => sequence.expand(budget)?,
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
        // Returns whether everything fit.
        let mut push_all = |expanded: Expansions, checkpoint: usize, budget: &mut Budget<'_>| {
            for (value, len) in expanded.iter_with_upstream_len() {
                if drops_empties && len == 0 {
                    continue;
                }
                if !values.has_room_for(len) {
                    return Ok(false);
                }
                values.push(&[value], len);
            }
            budget
                .settle_memory(checkpoint, values.memory_cost())
                .map(|()| true)
        };
        let checkpoint = budget.bytes_in_use();
        let comma_parts = self.parse_comma_parts(body.clone());
        if comma_parts.len() > 1 {
            for part in comma_parts {
                let expanded = self.expand(part, Scope::InBraces, budget)?;
                if !push_all(expanded, checkpoint, budget)? {
                    break;
                }
            }
            return Ok(values);
        }
        // `x{{a,b}}y` is `x{a}y` and `x{b}y`.
        let inner = self.expand(body, Scope::InBraces, budget)?;
        let embrace = |text: &[u16]| [w!("{"), text, w!("}")].concat();
        if inner.len() == 1 {
            return Ok(Expansions::one(&embrace(&inner.units)));
        }
        budget.settle_memory(checkpoint, inner.memory_cost())?;
        let checkpoint = budget.bytes_in_use();
        for text in inner.iter() {
            let expanded = Expander::new(embrace(text)).expand_all(Scope::Embraced, budget)?;
            if !push_all(expanded, checkpoint, budget)? {
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
    fn expand(&self, budget: &mut Budget<'_>) -> Result<Expansions, Abort> {
        let mut values = Expansions::default();
        let mut text = Vec::new();
        let reverse = self.last < self.first;
        let step = if reverse { -self.step } else { self.step };
        let mut value = self.first;
        while if reverse {
            value >= self.last
        } else {
            value <= self.last
        } {
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
            budget.spend(cost::LOOKUP + text.len())?;
            if !values.has_room_for(text.len()) {
                break;
            }
            values.push(&[&text], text.len());
            value += step;
        }
        Ok(values)
    }
}
