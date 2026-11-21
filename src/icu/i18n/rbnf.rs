//! The numerals of algorithmic numbering systems. ICU4C: rbnf.cpp, nfrs.cpp, nfrule.cpp, nfsubs.cpp

use crate::common::locid::Locale;
use crate::common::memory::{
    is_oom, reserve_append_exact, try_box_result, try_collect, try_collect_results, try_concat,
    try_push, try_shared,
};
use crate::common::putil::uprv_max_mantissa;
use crate::common::sink::TextBuf;
use crate::common::slice_ext::{SliceExt, remove_range};
use crate::common::sorting;
use crate::common::unistr::UStr;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::number_decimalquantity::{DecimalQuantity, RoundingMode};
use std::cmp::Ordering;
use std::sync::Arc;

const LESS: u16 = '<' as u16;
const GREATER: u16 = '>' as u16;
const EQUALS: u16 = '=' as u16;
const PERCENT: u16 = '%' as u16;
const COLON: u16 = ':' as u16;
const SEMICOLON: u16 = ';' as u16;
const SLASH: u16 = '/' as u16;
const SPACE: u16 = ' ' as u16;
const MINUS: u16 = '-' as u16;
const PERIOD: u16 = '.' as u16;
const OPEN: u16 = '[' as u16;
const CLOSE: u16 = ']' as u16;
const X: u16 = 'x' as u16;
/// Syntax characters that no shipped rule has.
const UNSUPPORTED: [u16; 3] = ['\'' as u16, '|' as u16, '$' as u16];

/// Truncates `number` after clamping it to 2^54.
fn util64_from_double(number: f64) -> i64 {
    number.min(uprv_max_mantissa()) as i64
}

#[derive(Clone, Copy)]
enum Descriptor {
    /// `-x`
    Negative,
    /// `x.x`
    Fraction,
    /// `100` or `1100/100`. The divisor is the highest power of the radix that does not exceed the base value.
    Normal { base_value: i64, divisor: i64 },
}

enum Substitution {
    /// `=#,##0=`
    Format(Box<DecimalFormat>),
    /// The index of the rule set that formats the part.
    Rules(Part, usize),
}

#[derive(Clone, Copy)]
enum Part {
    /// `=%name=`
    SameValue,
    /// `<<` in a normal rule
    Quotient(i64),
    /// `>>` in a normal rule
    Remainder(i64),
    /// `>>>` in a normal rule, to which no numbering system leads
    RemainderByPrecedingRule,
    /// `>>` in `-x`
    AbsoluteValue,
    /// `<<` in `x.x`
    Integer,
    /// `>>` and `>>>` in `x.x`
    FractionDigits { use_spaces: bool },
}

struct NFRule {
    text: Vec<u16>,
    /// In the order of their positions in `text`.
    substitutions: [Option<(usize, Substitution)>; 2],
}

#[derive(Default)]
struct NFRuleSet {
    /// In ascending order of the base values.
    rules: Vec<(i64, NFRule)>,
    negative: Option<NFRule>,
    fraction: Option<NFRule>,
}

fn parse_number(digits: &[u16]) -> Option<i64> {
    digits.iter().try_fold(0i64, |value, &unit| {
        let digit = char::from_u32(unit.into())?.to_digit(10)?;
        value.checked_mul(10)?.checked_add(digit.into())
    })
}

impl Descriptor {
    fn parse(text: &[u16]) -> Option<Self> {
        let (base_value, radix) = match text.split_while(|&unit| unit != SLASH) {
            ([MINUS, X], []) => return Some(Self::Negative),
            ([X, PERIOD, X], []) => return Some(Self::Fraction),
            (base_value, [_, radix @ ..]) => (base_value, parse_number(radix)?),
            (base_value, []) => (base_value, 10),
        };
        let base_value = parse_number(base_value)?;
        Some(Self::Normal {
            base_value,
            divisor: radix.pow(base_value.max(1).checked_ilog(radix)?),
        })
    }
}

impl NFRule {
    /// "100: << hundred[ >>];" is split into rules for 100 and 101, and 200 rolls back to the rule for 100.
    fn should_roll_back(&self, base_value: i64, number: i64) -> bool {
        self.substitutions.iter().flatten().any(|(_, substitution)| {
            matches!(*substitution, Substitution::Rules(Part::Remainder(divisor), _)
                if number.checked_rem(divisor) == Some(0) && base_value.checked_rem(divisor) != Some(0))
        })
    }
}

impl NFRuleSet {
    fn find_normal_rule(&self, number: i64) -> Option<&NFRule> {
        if number < 0 {
            return self.negative.as_ref();
        }
        let (mut low, mut high) = (0, self.rules.len());
        while low < high {
            let middle = (low + high) / 2;
            let (base_value, rule) = self.rules.soft_get(middle)?;
            match base_value.cmp(&number) {
                Ordering::Less => low = middle + 1,
                Ordering::Equal => return Some(rule),
                Ordering::Greater => high = middle,
            }
        }
        let ((base_value, rule), before) = self.rules.slice(..high).split_last()?;
        if rule.should_roll_back(*base_value, number) {
            before.last().map(|rule| &rule.1)
        } else {
            Some(rule)
        }
    }

    fn find_double_rule(&self, number: f64) -> Option<&NFRule> {
        let fraction = self.fraction.as_ref().filter(|_| number != number.floor());
        fraction.or_else(|| self.find_normal_rule(util64_from_double(number + 0.5)))
    }
}

struct RuleParser<'a> {
    symbols: Arc<DecimalFormatSymbols>,
    /// The names and indexes of all rule sets, sorted.
    names: Vec<(&'a [u16], usize)>,
}

impl RuleParser<'_> {
    fn find_rule_set(&self, name: &[u16]) -> Result<usize, UErrorCode> {
        let found = self.names.binary_search_by_key(&name, |named| named.0);
        let found = found.ok().and_then(|index| self.names.get(index));
        found.map(|named| named.1).ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    }

    fn parse_rule_set(&self, index: usize, rules: &[u16]) -> Result<NFRuleSet, UErrorCode> {
        let rules = rules.split_inclusive(|&unit| unit == SEMICOLON);
        let mut set = NFRuleSet::default();
        let count = |rule: &[u16]| 1 + usize::from(rule.contains(&OPEN));
        reserve_append_exact(&mut set.rules, rules.clone().map(count).sum())?;
        for rule in rules {
            self.add_rules(&mut set, index, rule)?;
        }
        if set.rules.is_sorted_by(|rule, next| rule.0 < next.0) {
            Ok(set)
        } else {
            Err(U_PARSE_ERROR)
        }
    }

    /// Text in brackets is left out for the multiples of the divisor. ICU4C: nfrule.cpp, NFRule::makeRules
    fn add_rules(&self, set: &mut NFRuleSet, index: usize, rule: &[u16]) -> Result<(), UErrorCode> {
        let (descriptor, [COLON, SPACE, text @ .., SEMICOLON]) =
            rule.split_while(|&unit| unit != COLON)
        else {
            return Err(U_PARSE_ERROR);
        };
        let descriptor = Descriptor::parse(descriptor).ok_or(U_PARSE_ERROR)?;
        if text.starts_with(&[SPACE]) || text.iter().any(|unit| UNSUPPORTED.contains(unit)) {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let make = |parts: &[&[u16]]| self.make_rule(try_concat(parts)?, descriptor, index);
        let (before, rest) = text.split_while(|&unit| unit != OPEN);
        match (descriptor, rest.split_while(|&unit| unit != CLOSE)) {
            (Descriptor::Negative, ([], [])) => set.negative = Some(make(&[text])?),
            (Descriptor::Fraction, ([], [])) => set.fraction = Some(make(&[text])?),
            (Descriptor::Normal { base_value, .. }, ([], [])) => {
                try_push(&mut set.rules, (base_value, make(&[text])?))?
            }
            (
                Descriptor::Normal {
                    mut base_value,
                    divisor,
                },
                ([_, optional @ ..], [_, after @ ..]),
            ) => {
                if base_value > 0 && base_value.checked_rem(divisor) == Some(0) {
                    try_push(&mut set.rules, (base_value, make(&[before, after])?))?;
                    base_value = base_value.saturating_add(1);
                }
                try_push(
                    &mut set.rules,
                    (base_value, make(&[before, optional, after])?),
                )?;
            }
            _ => return Err(U_PARSE_ERROR),
        }
        Ok(())
    }

    /// Moves the substitutions out of `text`. `owner` is the index of the rule set.
    fn make_rule(
        &self,
        mut text: Vec<u16>,
        descriptor: Descriptor,
        owner: usize,
    ) -> Result<NFRule, UErrorCode> {
        let mut substitutions = [None, None];
        for slot in &mut substitutions {
            let (before, token) = text.split_while(|unit| ![LESS, GREATER, EQUALS].contains(unit));
            let length = match *token {
                [] => break,
                [GREATER, GREATER, GREATER, ..] => 3,
                [sign, ..] => token.index_of_unit(sign, 1).ok_or(U_PARSE_ERROR)? + 1,
            };
            let substitution = self.make_substitution(token.slice(..length), descriptor, owner)?;
            let start = before.len();
            *slot = Some((start, substitution));
            remove_range(&mut text, start..start + length);
        }
        Ok(NFRule {
            text,
            substitutions,
        })
    }

    // ICU4C: nfsubs.cpp, NFSubstitution::makeSubstitution
    fn make_substitution(
        &self,
        token: &[u16],
        descriptor: Descriptor,
        owner: usize,
    ) -> Result<Substitution, UErrorCode> {
        let part = match (token, descriptor) {
            ([GREATER, ..], Descriptor::Negative) => Part::AbsoluteValue,
            (_, Descriptor::Negative) => return Err(U_UNSUPPORTED_ERROR),
            ([EQUALS, PERCENT, ..], _) => Part::SameValue,
            ([EQUALS, pattern @ .., _], _) => {
                let mut format = DecimalFormat::with_pattern(pattern, &self.symbols);
                return try_box_result(&mut format).map(Substitution::Format);
            }
            ([LESS, ..], Descriptor::Normal { divisor, .. }) => Part::Quotient(divisor),
            ([LESS, ..], Descriptor::Fraction) => Part::Integer,
            ([_, GREATER, _], Descriptor::Normal { .. }) => Part::RemainderByPrecedingRule,
            (_, Descriptor::Normal { divisor, .. }) => Part::Remainder(divisor),
            ([_, _], Descriptor::Fraction) => Part::FractionDigits { use_spaces: true },
            ([_, GREATER, _], Descriptor::Fraction) => Part::FractionDigits { use_spaces: false },
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        let rule_set = match token {
            [_, _] | [_, GREATER, _] => owner,
            _ => self.find_rule_set(token.slice(1..token.len() - 1))?,
        };
        Ok(Substitution::Rules(part, rule_set))
    }
}

const RECURSION_LIMIT: u32 = 64;

/// Two substitutions in a rule double the work at each level. The cost of a rule includes its text.
const MAX_FORMAT_WORK: usize = 1 << 28;

#[derive(Clone, Copy)]
enum Number {
    Int(i64),
    /// Finite and not negative.
    Double(f64),
}

struct FormatState<'a> {
    rule_sets: &'a [NFRuleSet],
    text: &'a mut dyn TextBuf,
    work: usize,
}

impl FormatState<'_> {
    fn add(&mut self, piece: &[u16]) {
        if !piece.is_empty() {
            self.text.add_all(piece);
        }
    }

    /// Writes nothing if the rule set has no rule for `number`.
    fn format(&mut self, rule_set: usize, number: Number, depth: u32) -> Result<(), UErrorCode> {
        let rule = (self.rule_sets.soft_get(rule_set)).and_then(|set| match number {
            Number::Int(number) => set.find_normal_rule(number),
            Number::Double(number) => set.find_double_rule(number),
        });
        let Some(rule) = rule else { return Ok(()) };
        self.work += 32 + 2 * rule.text.len();
        if depth >= RECURSION_LIMIT || self.work >= MAX_FORMAT_WORK || is_oom() {
            return Err(U_INVALID_STATE_ERROR);
        }
        let mut written = 0;
        for &(position, ref substitution) in rule.substitutions.iter().flatten() {
            self.add(rule.text.slice(written..position));
            written = position;
            match (substitution, number) {
                (Substitution::Format(format), Number::Int(number)) => {
                    format.format_double(number as f64, self.text)
                }
                (Substitution::Format(format), Number::Double(number)) => {
                    format.format_double(number, self.text)
                }
                (&Substitution::Rules(part, rule_set), _) => {
                    self.format_part(part, number, rule_set, depth + 1)
                }
            }?;
        }
        self.add(rule.text.slice(written..));
        Ok(())
    }

    fn format_part(
        &mut self,
        part: Part,
        number: Number,
        rule_set: usize,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        let number = match (part, number) {
            (Part::SameValue, Number::Int(number)) => Some(number),
            (Part::Quotient(divisor), Number::Int(number)) => number.checked_div(divisor),
            (Part::Remainder(divisor), Number::Int(number)) => number.checked_rem(divisor),
            (Part::AbsoluteValue, Number::Int(number)) => number.checked_abs(),
            (Part::SameValue, Number::Double(number)) if number == number.floor() => {
                Some(util64_from_double(number))
            }
            (Part::Integer, Number::Double(number)) => Some(util64_from_double(number)),
            (Part::Quotient(divisor), Number::Double(number)) => {
                Some(util64_from_double(number / divisor as f64))
            }
            (Part::Remainder(divisor), Number::Double(number)) => {
                Some(util64_from_double(number % divisor as f64))
            }
            (Part::FractionDigits { use_spaces }, Number::Double(number)) => {
                return self.format_digits(number, use_spaces, rule_set, depth);
            }
            _ => None,
        };
        let number = number.ok_or(U_UNSUPPORTED_ERROR)?;
        self.format(rule_set, Number::Int(number), depth)
    }

    /// Writes up to 20 fraction digits, or a zero if none is left.
    fn format_digits(
        &mut self,
        number: f64,
        use_spaces: bool,
        rule_set: usize,
        depth: u32,
    ) -> Result<(), UErrorCode> {
        let mut digits = DecimalQuantity::new();
        digits.set_to_double(number);
        digits.round_to_magnitude(-20, RoundingMode::HalfEven);
        for magnitude in (digits.get_lower_display_magnitude().min(-1)..0).rev() {
            if use_spaces && magnitude != -1 {
                self.text.add(SPACE);
            }
            let digit = digits.get_digit(magnitude);
            self.format(rule_set, Number::Int(digit.into()), depth)?;
        }
        Ok(())
    }
}

pub(crate) struct RuleBasedNumberFormat {
    rule_sets: Vec<NFRuleSet>,
    default_rule_set: usize,
}

impl RuleBasedNumberFormat {
    /// Formats with the rule set `name` of `group`, which must have rules for negative numbers and fractions.
    pub(crate) fn new(locale: &Locale, group: &[u8], name: &[u8]) -> Result<Self, UErrorCode> {
        let bundle = ures_open(Some(U_ICUDATA_RBNF), locale.get_name())?;
        let groups = bundle.get_by_key_with_fallback(b"RBNFRules")?;
        let description = groups.get_string_by_key_with_fallback(group)?;
        let description = description.units().try_to_vec()?;
        // "%name:rule;rule;"
        let descriptions = description
            .runs_by(|&unit, &next| [unit, next] != [SEMICOLON, PERCENT])
            .map(|description| description.split_while(|&unit| unit != COLON));
        let mut parser = RuleParser {
            symbols: try_shared(DecimalFormatSymbols::new(locale)?)?,
            names: try_collect(descriptions.clone().map(|(name, _)| name).zip(0..))?,
        };
        sorting::sort_in_place(&mut parser.names);
        let rule_sets =
            try_collect_results(descriptions.enumerate().map(|(index, (_, rules))| {
                parser.parse_rule_set(index, rules.get(1..).unwrap_or_default())
            }))?;
        let name = try_collect(name.iter().map(|&c| u16::from(c)))?;
        let default_rule_set = parser.find_rule_set(&name)?;
        match rule_sets.get(default_rule_set) {
            Some(set) if set.negative.is_some() && set.fraction.is_some() => Ok(Self {
                rule_sets,
                default_rule_set,
            }),
            _ => Err(U_UNSUPPORTED_ERROR),
        }
    }

    pub(crate) fn format_int64(
        &self,
        number: i64,
        append_to: &mut dyn TextBuf,
    ) -> Result<(), UErrorCode> {
        self.format(Number::Int(number), append_to)
    }

    /// Fails unless `number` is finite and not negative.
    pub(crate) fn format_double(
        &self,
        number: f64,
        append_to: &mut dyn TextBuf,
    ) -> Result<(), UErrorCode> {
        if !(0.0..f64::INFINITY).contains(&number) {
            return Err(U_UNSUPPORTED_ERROR);
        }
        self.format(Number::Double(number), append_to)
    }

    fn format(&self, number: Number, text: &mut dyn TextBuf) -> Result<(), UErrorCode> {
        let mut state = FormatState {
            rule_sets: &self.rule_sets,
            text,
            work: 0,
        };
        state.format(self.default_rule_set, number, 0)
    }
}
