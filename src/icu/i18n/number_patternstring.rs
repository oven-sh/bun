//! Parses number patterns such as "¤#,##0.00;(¤#,##0.00)". ICU4C: number_patternstring.cpp

use crate::common::locid::Locale;
use crate::common::memory::{Appendable, TryClone, try_collect, try_concat};
use crate::common::slice_ext::{SliceExt, to_int32};
use crate::common::unistr::UStr;
use crate::common::uresimp::ures_open;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::double_conversion::digits_to_double;
use crate::i18n::number_affixutils::{estimate_length, has_currency_plural_name};
use crate::i18n::number_decimfmtprops::DecimalFormatProperties;
use crate::i18n::number_padding::{PadPosition, Padder};
use std::ops::Range;

const HASH: u16 = '#' as u16;
const PERCENT: u16 = '%' as u16;
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

#[derive(Clone, Default)]
struct Affixes {
    prefix: Range<usize>,
    suffix: Range<usize>,
    has_minus_sign: bool,
    has_plus_sign: bool,
}

/// What else the parser finds in a subpattern.
#[derive(Default)]
struct Body {
    has_percent_sign: bool,
    has_per_mille_sign: bool,
    /// In an affix.
    has_currency_sign: bool,
    has_adjacent_currency_signs: bool,
    /// Whether an affix of the negative subpattern has one.
    is_followed_by_currency_sign: bool,
    /// The sizes of the last groups, 16 bits each, the last in the lowest bits. 0xffff marks a missing group.
    grouping_sizes: u64,
    integer_trailing_hash_signs: usize,
    integer_numerals: usize,
    integer_at_signs: usize,
    integer_total: usize,
    fraction_numerals: usize,
    fraction_total: usize,
    has_decimal: bool,
    has_currency_decimal: bool,
    exponent_has_plus_sign: bool,
    exponent_zeros: usize,
    /// The integer and fraction parts.
    mantissa: Range<usize>,
    width: usize,
    padding: Option<(PadPosition, Range<usize>)>,
}

impl Body {
    fn groupings(&self) -> [i16; 3] {
        [0, 16, 32].map(|shift| (self.grouping_sizes >> shift) as i16)
    }
}

pub(crate) struct ParsedPatternInfo {
    pattern: Vec<u16>,
    positive: Affixes,
    negative: Option<Affixes>,
    /// False for a compact pattern such as "mille".
    pub(crate) has_body: bool,
    pub(crate) has_currency_sign: bool,
    /// "0¤00"
    pub(crate) currency_as_decimal: bool,
    /// Whether the name of the currency depends on the number.
    pub(crate) needs_plurals: bool,
    /// The sizes of the last three groups, the last first. A missing group has -1.
    pub(crate) groupings: [i16; 3],
}

impl TryClone for ParsedPatternInfo {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        Ok(Self {
            pattern: self.pattern.try_clone()?,
            positive: self.positive.clone(),
            negative: self.negative.clone(),
            ..*self
        })
    }
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

    /// `body` has the default values.
    fn consume_subpattern(&mut self, body: &mut Body) -> Result<Affixes, UErrorCode> {
        let mut affixes = Affixes::default();
        body.grouping_sizes = 0xffff_ffff_0000;
        self.consume_padding(PadPosition::BeforePrefix, body)?;
        affixes.prefix = self.consume_affix(&mut affixes, body)?;
        self.consume_padding(PadPosition::AfterPrefix, body)?;
        let start = self.offset;
        self.consume_format(body)?;
        body.mantissa = start..self.offset;
        self.consume_exponent(body)?;
        body.width = self.offset - start;
        self.consume_padding(PadPosition::BeforeSuffix, body)?;
        affixes.suffix = self.consume_affix(&mut affixes, body)?;
        self.consume_padding(PadPosition::AfterSuffix, body)?;
        Ok(affixes)
    }

    #[inline]
    fn consume_padding(&mut self, at: PadPosition, body: &mut Body) -> Result<(), UErrorCode> {
        if self.consume(STAR) {
            let start = self.offset;
            self.consume_literal()?;
            if body.padding.replace((at, start..self.offset)).is_some() {
                return Err(U_PATTERN_SYNTAX_ERROR);
            }
        }
        Ok(())
    }

    fn consume_affix(
        &mut self,
        affixes: &mut Affixes,
        body: &mut Body,
    ) -> Result<Range<usize>, UErrorCode> {
        let start = self.offset;
        while let Some(unit) = self.peek() {
            match unit {
                HASH | AT | SEMICOLON | STAR | PERIOD | COMMA | ZERO..=NINE => break,
                PERCENT => body.has_percent_sign = true,
                PER_MILLE => body.has_per_mille_sign = true,
                CURRENCY => {
                    body.has_currency_sign = true;
                    body.has_adjacent_currency_signs |=
                        self.pattern.char_at(self.offset + 1) == CURRENCY;
                }
                MINUS => affixes.has_minus_sign = true,
                PLUS => affixes.has_plus_sign = true,
                QUOTE => self.skip_to_closing_quote()?,
                _ => {}
            }
            self.offset += 1;
        }
        Ok(start..self.offset)
    }

    fn skip_to_closing_quote(&mut self) -> Result<(), UErrorCode> {
        let closing = self.pattern.index_of_unit(QUOTE, self.offset + 1);
        self.offset = closing.ok_or(U_PATTERN_SYNTAX_ERROR)?;
        Ok(())
    }

    /// Consumes a code point or a quoted string.
    #[cold]
    fn consume_literal(&mut self) -> Result<(), UErrorCode> {
        if self.peek().ok_or(U_PATTERN_SYNTAX_ERROR)? == QUOTE {
            self.skip_to_closing_quote()?;
        }
        utf16::fwd_1(self.pattern, &mut self.offset);
        Ok(())
    }

    fn consume_format(&mut self, body: &mut Body) -> Result<(), UErrorCode> {
        self.consume_integer_format(body)?;
        body.has_currency_decimal = matches!(
            *self.pattern.slice(self.offset..),
            [CURRENCY, HASH | ZERO..=NINE, ..]
        );
        body.has_decimal = self.consume(if body.has_currency_decimal {
            CURRENCY
        } else {
            PERIOD
        });
        if body.has_decimal {
            self.consume_fraction_format(body)?;
        }
        Ok(())
    }

    fn consume_integer_format(&mut self, body: &mut Body) -> Result<(), UErrorCode> {
        while let Some(unit @ (COMMA | HASH | AT | ZERO..=NINE)) = self.peek() {
            self.offset += 1;
            match unit {
                COMMA => {
                    body.grouping_sizes <<= 16;
                    continue;
                }
                HASH | AT if body.integer_numerals > 0 => return Err(U_UNEXPECTED_TOKEN),
                HASH => body.integer_trailing_hash_signs += usize::from(body.integer_at_signs > 0),
                AT if body.integer_trailing_hash_signs > 0 => return Err(U_UNEXPECTED_TOKEN),
                AT => body.integer_at_signs += 1,
                _ if body.integer_at_signs > 0 => return Err(U_UNEXPECTED_TOKEN),
                _ => body.integer_numerals += 1,
            }
            // A size beyond 16 bits carries into the next.
            body.grouping_sizes = body.grouping_sizes.wrapping_add(1);
            body.integer_total += 1;
        }
        match body.groupings() {
            [0, second, _] if second != -1 => Err(U_UNEXPECTED_TOKEN),
            [_, 0, third] if third != -1 => Err(U_PATTERN_SYNTAX_ERROR),
            _ => Ok(()),
        }
    }

    fn consume_fraction_format(&mut self, body: &mut Body) -> Result<(), UErrorCode> {
        while let Some(unit @ (HASH | ZERO..=NINE)) = self.peek() {
            self.offset += 1;
            if unit != HASH {
                if body.fraction_total > body.fraction_numerals {
                    return Err(U_UNEXPECTED_TOKEN);
                }
                body.fraction_numerals += 1;
            }
            body.fraction_total += 1;
        }
        Ok(())
    }

    fn consume_exponent(&mut self, body: &mut Body) -> Result<(), UErrorCode> {
        if self.consume(EXPONENT) {
            if !matches!(body.groupings(), [_, -1, _]) {
                return Err(U_PATTERN_SYNTAX_ERROR);
            }
            body.exponent_has_plus_sign = self.consume(PLUS);
            while self.consume(ZERO) {
                body.exponent_zeros += 1;
            }
        }
        Ok(())
    }
}

/// Returns the pattern `key`, such as "decimalFormat", of the numbering system, else of "latn", else the empty pattern.
pub(crate) fn load_pattern(
    locale: &Locale,
    ns_name: &[u8],
    key: &[u8],
) -> Result<Vec<u16>, UErrorCode> {
    let bundle = ures_open(None, locale.get_name())?;
    let get_pattern = |ns_name: &[u8]| {
        let path = try_concat(&[b"NumberElements/", ns_name, b"/patterns/", key])?;
        bundle.get_string_by_key_with_fallback(&path)
    };
    let mut pattern = get_pattern(ns_name);
    if pattern.is_err() && ns_name != b"latn" {
        pattern = get_pattern(b"latn");
    }
    pattern.map_or(Ok(Vec::new()), |pattern| pattern.until_nul().try_to_vec())
}

impl ParsedPatternInfo {
    pub(crate) fn load(locale: &Locale, ns_name: &[u8], key: &[u8]) -> Result<Self, UErrorCode> {
        Self::parse(load_pattern(locale, ns_name, key)?)
    }

    pub(crate) fn parse(pattern: Vec<u16>) -> Result<Self, UErrorCode> {
        Self::parse_with_body(pattern, &mut Body::default())
    }

    /// Fills in the body of the positive subpattern.
    fn parse_with_body(pattern: Vec<u16>, body: &mut Body) -> Result<Self, UErrorCode> {
        let mut parser = Parser {
            pattern: &pattern,
            offset: 0,
        };
        let positive = parser.consume_subpattern(body)?;
        let mut has_currency_sign = body.has_currency_sign || body.has_currency_decimal;
        let mut may_need_plurals = body.has_adjacent_currency_signs;
        let mut negative = None;
        if parser.consume(SEMICOLON) && parser.peek().is_some() {
            let mut second = Body::default();
            negative = Some(parser.consume_subpattern(&mut second)?);
            body.is_followed_by_currency_sign = second.has_currency_sign;
            has_currency_sign |= second.has_currency_sign || second.has_currency_decimal;
            may_need_plurals |= second.has_adjacent_currency_signs;
        }
        if parser.peek().is_some() {
            return Err(U_UNQUOTED_SPECIAL);
        }
        Ok(Self {
            // The signs are counted in the whole pattern, so one that pads joins those after it.
            needs_plurals: may_need_plurals && has_currency_plural_name(&pattern),
            pattern,
            positive,
            negative,
            has_body: body.integer_total > 0,
            has_currency_sign,
            currency_as_decimal: body.has_currency_decimal,
            groupings: body.groupings(),
        })
    }

    /// Splits `pattern` into its affixes and its other settings. ICU4C: number_patternstring.cpp, patternInfoToProperties
    pub(crate) fn parse_to_properties(
        pattern: Vec<u16>,
    ) -> Result<(Self, DecimalFormatProperties), UErrorCode> {
        let mut body = Body::default();
        let mut parsed = Self::parse_with_body(pattern, &mut body)?;
        let properties = if parsed.pattern.is_empty() {
            DecimalFormatProperties::default()
        } else {
            parsed.properties(&body)?
        };
        let mut subpatterns = std::iter::once(&parsed.positive).chain(&parsed.negative);
        let has_plural_name = |affixes: &Affixes| {
            let [prefix, suffix] = parsed.texts(affixes);
            has_currency_plural_name(prefix) || has_currency_plural_name(suffix)
        };
        parsed.needs_plurals = subpatterns.any(has_plural_name);
        parsed.has_currency_sign = body.has_currency_decimal
            || body.has_currency_sign
            || body.is_followed_by_currency_sign;
        parsed.has_body = true;
        Ok((parsed, properties))
    }

    fn properties(&self, body: &Body) -> Result<DecimalFormatProperties, UErrorCode> {
        let mut properties = DecimalFormatProperties::default();
        let [grouping1, grouping2, grouping3] = self.groupings.map(i32::from);
        properties.grouping_used = grouping2 != -1;
        properties.grouping_size = if grouping2 != -1 { grouping1 } else { -1 };
        properties.secondary_grouping_size = if grouping3 != -1 { grouping2 } else { -1 };

        let integer_numerals = to_int32(body.integer_numerals);
        let fraction_numerals = to_int32(body.fraction_numerals);
        let (min_int, min_frac) = if body.integer_total == 0 && body.fraction_total > 0 {
            // ".##"
            (0, fraction_numerals.max(1))
        } else if integer_numerals == 0 && fraction_numerals == 0 {
            // "#.##"
            (1, 0)
        } else {
            (integer_numerals, fraction_numerals)
        };

        let has_at_signs = body.integer_at_signs > 0;
        if has_at_signs {
            properties.minimum_significant_digits = to_int32(body.integer_at_signs);
            properties.maximum_significant_digits =
                to_int32(body.integer_at_signs + body.integer_trailing_hash_signs);
        } else if !body.has_currency_sign && !body.has_currency_decimal {
            properties.minimum_fraction_digits = min_frac;
            properties.maximum_fraction_digits = to_int32(body.fraction_total);
            properties.rounding_increment = self.rounding_increment(body)?;
        }
        properties.decimal_separator_always_shown = body.has_decimal && body.fraction_total == 0;

        properties.minimum_integer_digits = min_int;
        if body.exponent_zeros > 0 {
            properties.exponent_sign_always_shown = body.exponent_has_plus_sign;
            properties.minimum_exponent_digits = to_int32(body.exponent_zeros);
            (
                properties.minimum_integer_digits,
                properties.maximum_integer_digits,
            ) = if has_at_signs {
                (1, -1)
            } else {
                (integer_numerals, to_int32(body.integer_total))
            };
        }

        properties.padder = body.padding.clone().map(|(position, padding)| {
            let [prefix, suffix] = self.texts(&self.positive);
            let padding = match self.pattern.slice(padding) {
                [QUOTE, QUOTE] => &[QUOTE],
                [QUOTE, quoted @ .., QUOTE] => quoted,
                code_point => code_point,
            };
            Padder {
                width: body.width + estimate_length(prefix) + estimate_length(suffix),
                code_point: utf16::get(padding, 0),
                position,
            }
        });

        if body.has_percent_sign {
            properties.magnitude_multiplier = 2;
        } else if body.has_per_mille_sign {
            properties.magnitude_multiplier = 3;
        }
        Ok(properties)
    }

    /// Returns 0.05 for "#,##0.05", and 0 if there is none.
    fn rounding_increment(&self, body: &Body) -> Result<f64, UErrorCode> {
        let mantissa = self.pattern.slice(body.mantissa.clone());
        let significant = mantissa.split_while(|unit| !(ZERO + 1..=NINE).contains(unit));
        let digits = (significant.1.iter().rev())
            .filter(|unit| (ZERO..=NINE).contains(unit))
            .map(|&digit| (digit - ZERO) as u8);
        let digits = try_collect(digits)?;
        let point = digits.len() as i64 - body.fraction_numerals as i64;
        Ok(if digits.is_empty() {
            0.0
        } else {
            digits_to_double(&digits, point)
        })
    }

    fn texts(&self, affixes: &Affixes) -> [&[u16]; 2] {
        [&affixes.prefix, &affixes.suffix].map(|affix| self.pattern.slice(affix.clone()))
    }

    /// Returns whether the only affix is a minus sign before a negative number.
    pub(crate) fn has_trivial_affixes(&self) -> bool {
        matches!(self.texts(&self.positive), [[], []])
            && (self.negative.iter()).all(|negative| matches!(self.texts(negative), [[MINUS], []]))
    }

    /// Replaces `output` with the prefix or suffix for `sign_type`, still in pattern syntax.
    pub(crate) fn write_affix(
        &self,
        is_prefix: bool,
        sign_type: PatternSignType,
        approximately: bool,
        per_mille_replaces_percent: bool,
        output: &mut Vec<u16>,
    ) {
        let is_negative = sign_type == PatternSignType::Neg;
        let adds_plus = sign_type == PatternSignType::PosSign && !self.positive.has_plus_sign;
        let sign: &[u16] = match (approximately, adds_plus) {
            (true, true) => &[TILDE, PLUS],
            (true, false) if is_negative => &[TILDE, MINUS],
            (true, false) => &[TILDE],
            (false, true) => &[PLUS],
            (false, false) => &[MINUS],
        };
        let has_sign = approximately || adds_plus || is_negative;
        let negative = (self.negative.as_ref())
            .filter(|negative| is_negative || (negative.has_minus_sign && has_sign));
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
                PERCENT if per_mille_replaces_percent => output.add(PER_MILLE),
                _ => output.add(unit),
            }
        }
    }
}
