//! Parses number patterns such as "¤#,##0.00;(¤#,##0.00)". ICU4C: number_patternstring.cpp

use crate::common::locid::Locale;
use crate::common::memory::{Appendable, try_concat};
use crate::common::slice_ext::{SliceExt, to_int32};
use crate::common::unistr::UStr;
use crate::common::uresimp::ures_open;
use crate::common::utypes::*;
use crate::i18n::number_rounding::Digits;
use std::mem::take;
use std::ops::Range;

const HASH: u16 = '#' as u16;
const QUOTE: u16 = '\'' as u16;
const STAR: u16 = '*' as u16;
const PLUS: u16 = '+' as u16;
const COMMA: u16 = ',' as u16;
const MINUS: u16 = '-' as u16;
const PERIOD: u16 = '.' as u16;
const ZERO: u16 = '0' as u16;
const NINE: u16 = '9' as u16;
const SEMICOLON: u16 = ';' as u16;
const AT: u16 = '@' as u16;
const EXPONENT: u16 = 'E' as u16;
const TILDE: u16 = '~' as u16;
const CURRENCY: u16 = '¤' as u16;
const PER_MILLE: u16 = '‰' as u16;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum PatternSignType {
    Pos,
    PosSign,
    Neg,
}

#[derive(Default)]
struct Affixes {
    prefix: Range<usize>,
    suffix: Range<usize>,
    has_minus_sign: bool,
}

#[derive(Default)]
struct Body {
    integer_total: usize,
    integer_zeros: usize,
    fraction_total: usize,
    fraction_zeros: usize,
    group_sizes: Option<(i32, i32)>,
}

pub(crate) struct ParsedPatternInfo {
    pattern: Vec<u16>,
    positive: Affixes,
    negative: Option<Affixes>,
    /// False for a compact pattern such as "mille".
    pub(crate) has_body: bool,
    pub(crate) min_integer_digits: i32,
    pub(crate) fraction_digits: Digits,
    /// The sizes of the last group and of the others.
    pub(crate) group_sizes: Option<(i32, i32)>,
}

struct Parser<'a> {
    pattern: &'a [u16],
    offset: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u16> {
        self.pattern.get(self.offset).copied()
    }

    fn consume(&mut self, unit: u16) -> bool {
        let is_next = self.peek() == Some(unit);
        self.offset += usize::from(is_next);
        is_next
    }

    fn consume_run(&mut self, unit: u16) -> usize {
        std::iter::from_fn(|| self.consume(unit).then_some(())).count()
    }

    fn consume_subpattern(&mut self) -> Result<(Affixes, Body), UErrorCode> {
        let mut affixes = Affixes::default();
        affixes.prefix = self.consume_affix(&mut affixes)?;
        let body = self.consume_body()?;
        affixes.suffix = self.consume_affix(&mut affixes)?;
        Ok((affixes, body))
    }

    /// Stops at unsupported symbols, which makes them errors.
    fn consume_affix(&mut self, affixes: &mut Affixes) -> Result<Range<usize>, UErrorCode> {
        let start = self.offset;
        while let Some(unit) = self.peek() {
            match unit {
                HASH | SEMICOLON | PERIOD | COMMA | ZERO..=NINE => break,
                AT | STAR | PLUS | PER_MILLE => break,
                CURRENCY if self.pattern.char_at(self.offset + 1) == CURRENCY => break,
                MINUS => affixes.has_minus_sign = true,
                QUOTE => {
                    let closing = self.pattern.index_of_unit(QUOTE, self.offset + 1);
                    self.offset = closing.ok_or(U_PATTERN_SYNTAX_ERROR)?;
                }
                _ => {}
            }
            self.offset += 1;
        }
        Ok(start..self.offset)
    }

    fn consume_body(&mut self) -> Result<Body, UErrorCode> {
        let mut body = Body::default();
        let (mut commas, mut group, mut previous_group) = (0, 0, 0);
        while let Some(unit @ (COMMA | HASH | ZERO)) = self.peek() {
            self.offset += 1;
            if unit == COMMA {
                (commas, previous_group) = (commas + 1, take(&mut group));
            } else if unit == HASH && body.integer_zeros > 0 {
                return Err(U_UNEXPECTED_TOKEN);
            } else {
                group += 1;
                body.integer_total += 1;
                body.integer_zeros += usize::from(unit == ZERO);
            }
        }
        body.group_sizes = match (commas, group, previous_group) {
            (0, ..) => None,
            (_, 0, _) | (2.., _, 0) => return Err(U_UNEXPECTED_TOKEN),
            (1, ..) => Some((group, group)),
            _ => Some((group, previous_group)),
        };
        let has_period = self.consume(PERIOD);
        if has_period {
            body.fraction_zeros = self.consume_run(ZERO);
            body.fraction_total = body.fraction_zeros + self.consume_run(HASH);
        }
        if (has_period && body.fraction_total == 0) || self.peek() == Some(EXPONENT) {
            return Err(U_UNSUPPORTED_ERROR);
        }
        Ok(body)
    }
}

impl ParsedPatternInfo {
    /// Loads the pattern `key`, such as "decimalFormat", of the numbering system, or else of "latn".
    pub(crate) fn load(locale: &Locale, ns_name: &[u8], key: &[u8]) -> Result<Self, UErrorCode> {
        let bundle = ures_open(None, locale.get_name())?;
        let get_pattern = |ns_name: &[u8]| {
            let path = try_concat(&[b"NumberElements/", ns_name, b"/patterns/", key])?;
            bundle.get_string_by_key_with_fallback(&path)
        };
        let pattern = get_pattern(ns_name).or_else(|_| get_pattern(b"latn"))?;
        Self::parse(pattern.units().try_to_vec()?)
    }

    pub(crate) fn parse(pattern: Vec<u16>) -> Result<Self, UErrorCode> {
        let mut parser = Parser {
            pattern: &pattern,
            offset: 0,
        };
        let (positive, body) = parser.consume_subpattern()?;
        let mut negative = None;
        if parser.consume(SEMICOLON) && parser.peek().is_some() {
            negative = Some(parser.consume_subpattern()?.0);
        }
        if parser.peek().is_some() {
            return Err(U_UNQUOTED_SPECIAL);
        }
        Ok(Self {
            pattern,
            positive,
            negative,
            has_body: body.integer_total > 0,
            min_integer_digits: to_int32(body.integer_zeros),
            fraction_digits: Digits::new(body.fraction_zeros, body.fraction_total),
            group_sizes: body.group_sizes,
        })
    }

    pub(crate) fn has_affixes(&self) -> bool {
        self.negative.is_some()
            || !self.positive.prefix.is_empty()
            || !self.positive.suffix.is_empty()
    }

    /// Replaces `output` with the prefix or suffix for `sign_type`, still in pattern syntax.
    pub(crate) fn write_affix(
        &self,
        is_prefix: bool,
        sign_type: PatternSignType,
        approximately: bool,
        output: &mut Vec<u16>,
    ) {
        let sign: &[u16] = match (approximately, sign_type) {
            (true, PatternSignType::PosSign) => &[TILDE, PLUS],
            (true, PatternSignType::Neg) => &[TILDE, MINUS],
            (true, PatternSignType::Pos) => &[TILDE],
            (false, PatternSignType::PosSign) => &[PLUS],
            (false, _) => &[MINUS],
        };
        let has_sign = approximately || sign_type != PatternSignType::Pos;
        let negative = self.negative.as_ref().filter(|negative| {
            sign_type == PatternSignType::Neg || (negative.has_minus_sign && has_sign)
        });
        let prepends_sign = is_prefix && has_sign && negative.is_none();
        let Affixes { prefix, suffix, .. } = negative.unwrap_or(&self.positive);
        let affix = self
            .pattern
            .slice(if is_prefix { prefix } else { suffix }.clone());
        output.clear();
        _ = output.reserve_append(affix.len() + usize::from(prepends_sign));
        for &unit in prepends_sign.then_some(&MINUS).into_iter().chain(affix) {
            match unit {
                MINUS => output.add_all(sign),
                _ => output.add(unit),
            }
        }
    }
}
