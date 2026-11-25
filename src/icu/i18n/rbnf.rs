//! The numerals of algorithmic numbering systems. ICU4C: rbnf.cpp, nfrs.cpp, nfrule.cpp, nfsubs.cpp

use crate::common::locid::Locale;
use crate::common::memory::{
    Appendable, TryClone, is_oom, reserve_append_exact, try_box, try_box_result, try_collect,
    try_collect_results, try_concat, try_filled, try_push, try_shared, try_to_vec,
    try_with_capacity,
};
use crate::common::patternprops::{is_white_space, skip_white_space};
use crate::common::putil::{double_to_int32, uprv_fmod, uprv_max_mantissa, uprv_round};
use crate::common::sink::TextBuf;
use crate::common::slice_ext::{SliceExt, SoftUnwrap, remove_range, to_int32};
use crate::common::sorting;
use crate::common::unistr::{UStr, eq_str, strip_prefix_str};
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::decimfmt::DecimalFormat;
use crate::i18n::number_decimalquantity::{DecimalQuantity, RoundingMode};
use crate::i18n::numfmt::NumberFormat;
use crate::i18n::plurfmt::PluralFormat;
use crate::i18n::plurrule::{PluralRules, UPLURAL_TYPE_CARDINAL, UPLURAL_TYPE_ORDINAL};
use std::cmp::Ordering;
use std::mem::discriminant;
use std::sync::Arc;

const fn c(c: char) -> u16 {
    c as u16
}

const LESS: u16 = c('<');
const GREATER: u16 = c('>');
const EQUALS: u16 = c('=');
const PERCENT: u16 = c('%');
const SEMICOLON: u16 = c(';');
const SPACE: u16 = c(' ');
const ZERO: u16 = c('0');
const NINE: u16 = c('9');
const X: u16 = c('x');

/// The result wraps, and so does a negative `exponent`.
fn util64_pow(base: i32, exponent: i16) -> u64 {
    u64::from(base as u32).wrapping_pow(u32::from(exponent as u16))
}

/// Truncates `number` after clamping its magnitude to 2^54. Returns 0 for NaN.
fn util64_from_double(number: f64) -> i64 {
    number.clamp(-uprv_max_mantissa(), uprv_max_mantissa()) as i64
}

/// Returns (7, 10) for 9621.7, whose binary fraction is 0.7000000000007276. More than 15 digits can be a rounded 1/3.
fn shortest_fraction(number: f64) -> Option<(i64, i64)> {
    let mut quantity = DecimalQuantity::new();
    quantity.set_to_double(number);
    quantity.round_to_infinity();
    let places = -quantity.get_lower_display_magnitude();
    (number > 0.0 && places <= 18 && quantity.get_magnitude() + places < 15).then(|| {
        (
            quantity.to_fraction_long(true) as i64,
            10i64.pow(places as u32),
        )
    })
}

/// Returns the least common multiple modulo 2^64, or 0 if an operand is not positive.
fn util_lcm(x: i64, y: i64) -> i64 {
    if x <= 0 || y <= 0 {
        return 0;
    }
    let (mut gcd, mut rest) = (x, y);
    while rest != 0 {
        (gcd, rest) = (rest, gcd % rest);
    }
    x.checked_div(gcd).soft_unwrap().wrapping_mul(y)
}

// The base values of the rules that are not for a range of numbers.
const NEGATIVE_NUMBER_RULE: i64 = -1;
const IMPROPER_FRACTION_RULE: i64 = -2;
const PROPER_FRACTION_RULE: i64 = -3;
const DEFAULT_RULE: i64 = -4;
const INFINITY_RULE: i64 = -5;
const NAN_RULE: i64 = -6;

/// The formatter of the number that a substitution computes.
#[derive(Clone, Copy)]
enum Target {
    RuleSet(usize),
    /// An index into `Formats::decimal`
    NumberFormat(usize),
    /// The description is invalid, and `RuleParser::extract_substitutions` has discarded the error.
    None,
}

/// A `divisor` is that of the rule and is never 0.
#[derive(Clone, Copy)]
enum Kind {
    /// `=%name=`
    SameValue,
    /// `<<` in a normal rule
    Multiplier { divisor: i64 },
    /// `>>` in a normal rule. For `>>>`, `rule_to_use` is the index of the preceding rule.
    Modulus {
        divisor: i64,
        rule_to_use: Option<u32>,
    },
    /// `<<` in `x.x`, `0.x`, `x.0`
    IntegralPart,
    /// `>>` in `x.x`, `0.x`, `x.0`. `by_digits` is true if the target is the rule's own rule set.
    FractionalPart { by_digits: bool, use_spaces: bool },
    /// `>>` in `-x`
    AbsoluteValue,
    /// `<<` in a fraction rule set
    Numerator { denominator: f64, with_zeros: bool },
}

struct NFSubstitution {
    /// The position of the result in the rule text.
    pos: usize,
    target: Target,
    kind: Kind,
}

/// `$(cardinal,one{...}other{...})$` and its range in a rule text.
struct PluralPart {
    format: PluralFormat,
    start: usize,
    end: usize,
}

struct NFRule {
    base_value: i64,
    divisor: u64,
    rule_text: Vec<u16>,
    /// In the order of their positions. The second is `None` if the first is.
    substitutions: [Option<NFSubstitution>; 2],
    plural_part: Option<Box<PluralPart>>,
}

#[derive(Default)]
struct NFRuleSet {
    rules: Vec<NFRule>,
    /// For the base values -1 to -6.
    non_numerical_rules: [Option<Box<NFRule>>; 6],
    /// If true, the base values are denominators.
    is_fraction_rule_set: bool,
    /// Of the base values of a fraction rule set, or 0 if there is none.
    least_common_multiple: i64,
}

struct Rules {
    rule_sets: Vec<NFRuleSet>,
    default_rule_set: usize,
    default_infinity_rule: NFRule,
    default_nan_rule: NFRule,
}

/// The formats that the rules use. Each counts its calls.
#[derive(Default)]
struct Formats {
    decimal: Vec<DecimalFormat>,
    /// Of all plural parts.
    plural: Option<Box<DecimalFormat>>,
}

/// Parses a number up to `end` or '>', ignoring white space, commas and periods. Also returns the rest.
fn parse_number(descriptor: &[u16], end: u16) -> Result<(i64, &[u16]), UErrorCode> {
    let (digits, rest) = descriptor.split_while(|&unit| unit != end && unit != GREATER);
    let value = digits.iter().try_fold(0i64, |value, &unit| match unit {
        ZERO..=NINE => value.checked_mul(10)?.checked_add(i64::from(unit - ZERO)),
        _ => (is_white_space(unit.into()) || unit == c(',') || unit == c('.')).then_some(value),
    });
    Ok((value.ok_or(U_PARSE_ERROR)?, rest))
}

/// Removes the apostrophe that protects leading white space.
fn strip_apostrophe(text: &[u16]) -> &[u16] {
    text.strip_prefix(&[c('\'')]).unwrap_or(text)
}

/// Returns the exponent of the highest power of `radix` that does not exceed `base_value`, if logarithms suffice to tell.
fn expected_exponent(base_value: i64, radix: i32) -> i16 {
    if base_value < 1 {
        return 0;
    }
    if let Ok(small) = u32::try_from(base_value)
        && let Some(exponent) = u32::try_from(radix)
            .ok()
            .and_then(|it| small.checked_ilog(it))
    {
        return exponent as i16;
    }
    // `black_box` keeps the compiler from using the `log` of the build host.
    let ln = |number: f64| std::hint::black_box(number).ln();
    let exponent = double_to_int32(ln(base_value as f64) / ln(f64::from(radix))) as i16;
    let next = exponent.wrapping_add(1);
    if util64_pow(radix, next) as i64 <= base_value {
        next
    } else {
        exponent
    }
}

/// What precedes the colon of a rule.
struct Descriptor {
    base_value: i64,
    divisor: u64,
    /// The middle character of `x.x`, `0.x` and `x.0`, or 0.
    decimal_point: u16,
}

impl Descriptor {
    /// Also returns the text after the descriptor. ICU4C: nfrule.cpp, NFRule::parseRuleDescriptor
    fn parse(description: &[u16]) -> Result<(Self, &[u16]), UErrorCode> {
        let of = |base_value, decimal_point| Self {
            base_value,
            divisor: 1,
            decimal_point,
        };
        let (descriptor, [_, text @ ..]) = description.split_while(|&unit| unit != c(':')) else {
            return Ok((of(0, 0), strip_apostrophe(description)));
        };
        let descriptor = match *descriptor {
            [ZERO, point, X] => of(PROPER_FRACTION_RULE, point),
            [X, point, X] => of(IMPROPER_FRACTION_RULE, point),
            [X, point, ZERO] => of(DEFAULT_RULE, point),
            [ZERO..=NINE, .., X] => of(0, 0),
            [ZERO..=NINE, ..] => Self::parse_base_value(descriptor)?,
            _ if eq_str(descriptor, "-x") => of(NEGATIVE_NUMBER_RULE, 0),
            _ if eq_str(descriptor, "NaN") => of(NAN_RULE, 0),
            _ if eq_str(descriptor, "Inf") => of(INFINITY_RULE, 0),
            _ => of(0, 0),
        };
        let text = text.slice(skip_white_space(text, 0)..);
        Ok((descriptor, strip_apostrophe(text)))
    }

    /// Parses the base value, an optional '/' and radix, and any '>', each of which lowers the exponent by one.
    fn parse_base_value(descriptor: &[u16]) -> Result<Self, UErrorCode> {
        let (base_value, mut rest) = parse_number(descriptor, c('/'))?;
        let mut radix = 10;
        if let Some(after_slash) = rest.strip_prefix(&[c('/')]) {
            let number;
            (number, rest) = parse_number(after_slash, GREATER)?;
            radix = number as i32;
            if radix == 0 {
                return Err(U_PARSE_ERROR);
            }
        }
        let mut exponent = expected_exponent(base_value, radix);
        for &unit in rest {
            if unit != GREATER || exponent <= 0 {
                return Err(U_PARSE_ERROR);
            }
            exponent -= 1;
        }
        Ok(Self {
            base_value,
            divisor: util64_pow(radix, exponent),
            decimal_point: 0,
        })
    }
}

impl NFRule {
    fn new(base_value: i64, divisor: u64, rule_text: Vec<u16>) -> Self {
        Self {
            base_value,
            divisor,
            rule_text,
            substitutions: [None, None],
            plural_part: None,
        }
    }

    /// Creates the default rule for infinity or NaN.
    fn from_symbol(base_value: i64, symbol: &[u16]) -> Result<Self, UErrorCode> {
        let text = strip_apostrophe(symbol.slice(skip_white_space(symbol, 0)..));
        Ok(Self::new(base_value, 1, try_to_vec(text)?))
    }

    fn set_base_value(&mut self, base_value: i64) {
        self.base_value = base_value;
        self.divisor = util64_pow(10, expected_exponent(base_value, 10));
        for sub in self.substitutions.iter_mut().flatten() {
            if let Kind::Multiplier { divisor } | Kind::Modulus { divisor, .. } = &mut sub.kind {
                *divisor = self.divisor as i64;
            }
        }
    }

    fn kinds(&self) -> impl Iterator<Item = Kind> {
        self.substitutions.iter().flatten().map(|sub| sub.kind)
    }

    fn has_modulus(&self) -> bool {
        self.kinds()
            .any(|kind| matches!(kind, Kind::Modulus { .. }))
    }

    /// "100: << hundred[ >>];" is split into rules for 100 and 101, and 200 rolls back to the rule for 100.
    fn should_roll_back(&self, number: i64) -> bool {
        let divides = |number: i64| number.checked_rem(self.divisor as i64) == Some(0);
        self.has_modulus() && divides(number) && !divides(self.base_value)
    }
}

impl NFRuleSet {
    fn non_numerical_rule(&self, base_value: i64) -> Option<&NFRule> {
        (self.non_numerical_rules.soft_get(!base_value as usize)?).as_deref()
    }

    /// A rule for fractions replaces an earlier one only if it `has_point_of_locale`.
    fn add_rule(&mut self, rule: NFRule, has_point_of_locale: bool) -> Result<(), UErrorCode> {
        if rule.base_value >= 0 {
            return try_push(&mut self.rules, rule);
        }
        let is_for_fractions = (DEFAULT_RULE..=IMPROPER_FRACTION_RULE).contains(&rule.base_value);
        // The successor of `i64::MAX` has no slot.
        if let Some(slot) = self.non_numerical_rules.get_mut(!rule.base_value as usize)
            && (slot.is_none() || !is_for_fractions || has_point_of_locale)
        {
            *slot = Some(try_box(rule)?);
        }
        Ok(())
    }

    /// Gives each rule without a base value the preceding value plus one, or the same value in a fraction rule set.
    fn assign_base_values(&mut self) -> Result<(), UErrorCode> {
        let mut next = 0;
        for rule in &mut self.rules {
            if rule.base_value == 0 {
                rule.set_base_value(next);
            } else if rule.base_value < next {
                return Err(U_PARSE_ERROR);
            }
            next = rule
                .base_value
                .wrapping_add(i64::from(!self.is_fraction_rule_set));
        }
        Ok(())
    }

    /// Finds the first rule below the last base value that makes the fraction an integer of up to 15 digits.
    fn find_exact_denominator_rule(
        &self,
        mut numerator: i64,
        mut denominator: i64,
    ) -> Option<&NFRule> {
        self.rules.first().filter(|first| first.base_value != 0)?;
        let last = self.rules.last()?.base_value;
        while numerator % 2 == 0 && denominator % 2 == 0 {
            (numerator, denominator) = (numerator / 2, denominator / 2);
        }
        while numerator % 5 == 0 && denominator % 5 == 0 {
            (numerator, denominator) = (numerator / 5, denominator / 5);
        }
        let [rule, next] = self.rules.array_windows().find(|[rule, _]| {
            let base = rule.base_value;
            base < last
                && base.checked_rem(denominator) == Some(0)
                && (1..10i64.pow(15)).contains(&(base / denominator * numerator))
        })?;
        let uses_next =
            next.base_value == rule.base_value && rule.base_value / denominator * numerator != 1;
        Some(if uses_next { next } else { rule })
    }

    /// Finds the closest denominator. Of two rules with that base value, the first is for the numerator 1.
    fn find_fraction_rule_set_rule(&self, number: f64) -> Option<&NFRule> {
        let multiple = self.least_common_multiple;
        if multiple == 0 {
            return None;
        }
        let numerator = util64_from_double(number * multiple as f64 + 0.5);
        let (mut difference, mut winner) = (util64_from_double(f64::MAX), 0);
        for (index, rule) in self.rules.iter().enumerate() {
            let remainder = numerator
                .wrapping_mul(rule.base_value)
                .wrapping_rem(multiple);
            let distance = remainder.min(multiple.wrapping_sub(remainder));
            if distance < difference {
                (difference, winner) = (distance, index);
                if difference == 0 {
                    break;
                }
            }
        }
        let rules = self.rules.slice(winner..);
        if let [rule, next, ..] = rules
            && next.base_value == rule.base_value
        {
            let numerator = rule.base_value as f64 * number;
            if numerator < 0.5 || numerator >= 2.0 {
                return Some(next);
            }
        }
        rules.first()
    }

    // ICU4C: nfrs.cpp, NFRuleSet::findNormalRule
    fn find_normal_rule(&self, mut number: i64) -> Option<&NFRule> {
        if number < 0 {
            if let Some(rule) = self.non_numerical_rule(NEGATIVE_NUMBER_RULE) {
                return Some(rule);
            }
            number = number.wrapping_neg();
        }
        // The steps decide which of several rules with the same base value is found.
        let (mut low, mut high) = (0, self.rules.len());
        while low < high {
            let middle = (low + high) / 2;
            let rule = self.rules.soft_get(middle)?;
            match rule.base_value.cmp(&number) {
                Ordering::Less => low = middle + 1,
                Ordering::Equal => return Some(rule),
                Ordering::Greater => high = middle,
            }
        }
        match self.rules.slice(..high).split_last() {
            Some((rule, before)) if rule.should_roll_back(number) => before.last(),
            Some((rule, _)) => Some(rule),
            None if self.rules.is_empty() => self.non_numerical_rule(DEFAULT_RULE),
            None => None,
        }
    }

    // ICU4C: nfrs.cpp, NFRuleSet::findDoubleRule
    fn find_double_rule<'a>(&'a self, number: f64, owner: &'a Rules) -> Option<&'a NFRule> {
        if number.is_nan() {
            return Some(
                self.non_numerical_rule(NAN_RULE)
                    .unwrap_or(&owner.default_nan_rule),
            );
        }
        if number < 0.0
            && let Some(rule) = self.non_numerical_rule(NEGATIVE_NUMBER_RULE)
        {
            return Some(rule);
        }
        let number = number.abs();
        if number.is_infinite() {
            return Some(
                self.non_numerical_rule(INFINITY_RULE)
                    .unwrap_or(&owner.default_infinity_rule),
            );
        }
        if number != number.floor() {
            if number < 1.0
                && let Some(rule) = self.non_numerical_rule(PROPER_FRACTION_RULE)
            {
                return Some(rule);
            }
            if let Some(rule) = self.non_numerical_rule(IMPROPER_FRACTION_RULE) {
                return Some(rule);
            }
        }
        self.non_numerical_rule(DEFAULT_RULE)
            .or_else(|| self.find_normal_rule(util64_from_double(number + 0.5)))
    }
}

/// An error can come with a substitution.
type Extracted = (Option<NFSubstitution>, Result<(), UErrorCode>);

/// The rule set of the rule that is being parsed.
#[derive(Clone, Copy)]
struct Owner {
    rule_set: usize,
    is_fraction_rule_set: bool,
    /// A description has fewer than 2^31 units.
    predecessor: Option<u32>,
}

struct RuleParser<'a> {
    locale: &'a Locale,
    symbols: Arc<DecimalFormatSymbols>,
    /// The names and indexes of all rule sets, sorted.
    names: Vec<(&'a [u16], usize)>,
    /// Indexed by rule set. True if a fractional part that has been parsed so far targets the rule set.
    is_fraction_rule_set: Vec<bool>,
    default_rule_set: usize,
    formats: Formats,
}

impl RuleParser<'_> {
    /// Returns the index of the first rule set named `name`.
    fn find_rule_set(&self, name: &[u16]) -> Result<usize, UErrorCode> {
        let found = self
            .names
            .get(self.names.partition_point(|named| named.0 < name));
        found
            .filter(|named| named.0 == name)
            .map(|named| named.1)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    }

    // ICU4C: nfrs.cpp, NFRuleSet::parseRules
    fn parse_rules(&mut self, index: usize, description: &[u16]) -> Result<NFRuleSet, UErrorCode> {
        let mut set = NFRuleSet {
            is_fraction_rule_set: self.is_fraction_rule_set.at(index),
            ..NFRuleSet::default()
        };
        let adds_rule = |&&unit: &&u16| unit == SEMICOLON || unit == c('[');
        let count = description.iter().filter(adds_rule).count();
        // A long description may fail early, or consist of rules that replace each other.
        reserve_append_exact(&mut set.rules, count.min(2000))?;
        for rule in description.split_inclusive(|&unit| unit == SEMICOLON) {
            let rule = rule.strip_suffix(&[SEMICOLON]).unwrap_or(rule);
            self.make_rules(&mut set, index, rule)?;
        }
        set.assign_base_values().map(|()| set)
    }

    /// Adds one rule, or two for "[a|b]": the first has the optional `b` in place of the brackets, the second `a`.
    fn make_rules(
        &mut self,
        set: &mut NFRuleSet,
        index: usize,
        description: &[u16],
    ) -> Result<(), UErrorCode> {
        let (descriptor, text) = Descriptor::parse(description)?;
        let (mut base_value, divisor) = (descriptor.base_value, descriptor.divisor);
        let owner = Owner {
            rule_set: index,
            is_fraction_rule_set: set.is_fraction_rule_set,
            predecessor: (set.rules.len() as u32).checked_sub(1),
        };
        let separator = self.symbols.get_const_symbol(Symbol::DecimalSeparator);
        let separator = separator.char_at(0);
        let mut add = |base_value, decimal_point, parts: &[&[u16]]| {
            let mut rule = NFRule::new(base_value, divisor, try_concat(parts)?);
            self.extract_substitutions(&mut rule, owner)?;
            set.add_rule(rule, decimal_point == separator)
        };
        let find = |wanted| text.iter().position(|&unit| unit == c(wanted));
        let allows_brackets = matches!(base_value, IMPROPER_FRACTION_RULE | DEFAULT_RULE | 0..);
        let brackets = find('[').and_then(|open| Some((open, find(']')?)));
        let Some((open, close)) = brackets.filter(|(open, close)| open < close && allows_brackets)
        else {
            return add(base_value, descriptor.decimal_point, &[text]);
        };
        let (before, bar, after) = (text.slice(..open), find('|'), text.slice(close + 1..));
        let base_values = match base_value {
            0 => None,
            IMPROPER_FRACTION_RULE => Some((PROPER_FRACTION_RULE, IMPROPER_FRACTION_RULE)),
            DEFAULT_RULE => Some((DEFAULT_RULE, IMPROPER_FRACTION_RULE)),
            base => {
                let remainder = (base as u64).checked_rem(divisor).ok_or(U_PARSE_ERROR)?;
                let next = base.wrapping_add(i64::from(!owner.is_fraction_rule_set));
                (remainder == 0).then_some((base, next))
            }
        };
        if let Some((first_base, second_base)) = base_values {
            let or_else = bar.map(|bar| text.temp_sub_string_between(bar + 1, close));
            // The first rule has no decimal point.
            add(first_base, 0, &[before, or_else.unwrap_or_default(), after])?;
            base_value = second_base;
        }
        let optional = text.temp_sub_string_between(open + 1, bar.unwrap_or(close));
        add(
            base_value,
            descriptor.decimal_point,
            &[before, optional, after],
        )
    }

    // ICU4C: nfrule.cpp, NFRule::extractSubstitutions
    fn extract_substitutions(&mut self, rule: &mut NFRule, owner: Owner) -> Result<(), UErrorCode> {
        let (first, status) = self.extract_substitution(rule, owner);
        status?;
        if let Some(first) = first {
            let (second, status) = self.extract_substitution(rule, owner);
            // An error does not count if both are of the same kind.
            if (second.as_ref())
                .is_none_or(|second| discriminant(&first.kind) != discriminant(&second.kind))
            {
                status?;
            }
            rule.substitutions = [Some(first), second];
        }
        if rule.rule_text.contains(&c('$')) {
            rule.plural_part = self.parse_plural_part(&rule.rule_text)?;
        }
        Ok(())
    }

    #[cold]
    fn parse_plural_part(&mut self, text: &[u16]) -> Result<Option<Box<PluralPart>>, UErrorCode> {
        let start = text.index_of(&[c('$'), c('(')]);
        let close = start.and_then(|start| text.index_of_from(&[c(')'), c('$')], start));
        let Some((start, close)) = start.zip(close) else {
            return Ok(None);
        };
        let comma = text.index_of_unit(c(','), start).ok_or(U_PARSE_ERROR)?;
        let is_type = |name| strip_prefix_str(text.slice(start + 2..), name).is_some();
        let plural_type = match (is_type("cardinal"), is_type("ordinal")) {
            (true, _) => UPLURAL_TYPE_CARDINAL,
            (_, true) => UPLURAL_TYPE_ORDINAL,
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        let plural_rules = PluralRules::for_locale(self.locale, plural_type)?;
        if self.formats.plural.is_none() {
            // A format with rules could need the rules that are being parsed.
            let mut format = NumberFormat::create_decimal_instance(self.locale);
            self.formats.plural = Some(try_box_result(&mut format)?);
        }
        let pattern = text.temp_sub_string_between(comma + 1, close);
        let part = PluralPart {
            format: PluralFormat::new(plural_rules, pattern)?,
            start,
            end: close + 2,
        };
        try_box(part).map(Some)
    }

    /// Removes the first token from the rule text. ICU4C: nfrule.cpp, NFRule::extractSubstitution
    fn extract_substitution(&mut self, rule: &mut NFRule, owner: Owner) -> Extracted {
        let is_text = |&unit: &u16| !matches!(unit, LESS | GREATER | EQUALS);
        let (before, token) = rule.rule_text.split_while(is_text);
        let length = match token {
            [GREATER, GREATER, GREATER, ..] => Some(3),
            // "<%name<<" is one token.
            [sign, rest @ ..] => (rest.iter().position(|unit| unit == sign))
                .map(|end| end + 2 + usize::from(*sign == LESS && rest.char_at(end + 1) == LESS)),
            [] => None,
        };
        let Some(length) = length else {
            return (None, Ok(()));
        };
        let start = before.len();
        let extracted = self.make_substitution(start, rule, owner, token.slice(..length));
        remove_range(&mut rule.rule_text, start..start + length);
        extracted
    }

    // ICU4C: nfsubs.cpp, NFSubstitution::makeSubstitution
    fn make_substitution(
        &mut self,
        pos: usize,
        rule: &NFRule,
        owner: Owner,
        token: &[u16],
    ) -> Extracted {
        let (is_triple, divisor) = (token == [GREATER; 3], rule.divisor as i64);
        let mut kind = match (token.at(0), rule.base_value) {
            (EQUALS, _) => Kind::SameValue,
            (LESS, NEGATIVE_NUMBER_RULE) => return (None, Err(U_PARSE_ERROR)),
            (_, NEGATIVE_NUMBER_RULE) => Kind::AbsoluteValue,
            (LESS, DEFAULT_RULE..=IMPROPER_FRACTION_RULE) => Kind::IntegralPart,
            (_, DEFAULT_RULE..=IMPROPER_FRACTION_RULE) => Kind::FractionalPart {
                by_digits: false,
                use_spaces: !is_triple,
            },
            (LESS, base_value) if owner.is_fraction_rule_set => Kind::Numerator {
                denominator: base_value as f64,
                with_zeros: token.ends_with(&[LESS; 2]),
            },
            _ if owner.is_fraction_rule_set => return (None, Err(U_PARSE_ERROR)),
            (LESS, _) => Kind::Multiplier { divisor },
            _ => Kind::Modulus {
                divisor,
                rule_to_use: owner.predecessor.filter(|_| is_triple),
            },
        };
        let target = match kind {
            Kind::Numerator { with_zeros, .. } => self.find_target(
                self.default_rule_set,
                token.slice(..token.len() - usize::from(with_zeros)),
            ),
            _ => self.find_target(owner.rule_set, token),
        };
        let status = match (&mut kind, target) {
            (Kind::Multiplier { divisor: 0 }, _) => Err(U_PARSE_ERROR),
            (_, Err(code)) => Err(code),
            (Kind::FractionalPart { by_digits, .. }, Ok(Target::RuleSet(set))) => {
                *by_digits = set == owner.rule_set;
                if !*by_digits {
                    self.is_fraction_rule_set.set(set, true);
                }
                Ok(())
            }
            (Kind::FractionalPart { .. } | Kind::Modulus { divisor: 0, .. }, _) => {
                Err(U_PARSE_ERROR)
            }
            _ if token == [EQUALS; 2] => Err(U_PARSE_ERROR),
            _ => Ok(()),
        };
        (
            Some(NFSubstitution {
                pos,
                target: target.unwrap_or(Target::None),
                kind,
            }),
            status,
        )
    }

    /// Resolves the text between the delimiters of `token`. `rule_set` is the target if that text is empty.
    fn find_target(&mut self, rule_set: usize, token: &[u16]) -> Result<Target, UErrorCode> {
        const POUND: u16 = c('#');
        match token {
            [_, _] | [_, GREATER, .., _] => Ok(Target::RuleSet(rule_set)),
            [_, name @ .., _] if name.at(0) == PERCENT => {
                self.find_rule_set(name).map(Target::RuleSet)
            }
            [_, pattern @ .., _] if matches!(pattern.at(0), POUND | ZERO) => {
                let target = Target::NumberFormat(self.formats.decimal.len());
                let format = DecimalFormat::with_pattern(try_to_vec(pattern)?, &self.symbols)?;
                try_push(&mut self.formats.decimal, format).map(|()| target)
            }
            // Includes "<", the shortened "<<" of a numerator.
            _ => Err(U_PARSE_ERROR),
        }
    }
}

/// Removes empty rules and the white space before each rule.
fn strip_whitespace(description: &[u16]) -> Result<Vec<u16>, UErrorCode> {
    let mut result = try_with_capacity(description.len())?;
    for rule in description.split_inclusive(|&unit| unit == SEMICOLON) {
        let rule = rule.slice(skip_white_space(rule, 0)..);
        if rule != [SEMICOLON] {
            result.add_all(rule);
        }
    }
    Ok(result)
}

/// Removes the rule set "%%lenient-parse", which holds rules for a collator.
fn remove_lenient_parse_rules(description: &mut Vec<u16>) {
    let is_rule_start = |&start: &usize| matches!(description.slice(..start), [] | [.., SEMICOLON]);
    let start = description.index_of(&from_latin1(b"%%lenient-parse:"));
    if let Some(start) = start.filter(is_rule_start) {
        let end = description.index_of_from(&[SEMICOLON, PERCENT], start);
        let end = end.map_or(description.len(), |end| end + 1);
        remove_range(description, start..end);
    }
}

/// Splits "%name: rule;rule;" into name and rules. ICU4C: nfrs.cpp, NFRuleSet::NFRuleSet
fn split_rule_set(description: &[u16]) -> Result<(&[u16], &[u16]), UErrorCode> {
    let (mut name, mut rules): (&[u16], _) = (&const { from_latin1(b"%default") }, description);
    if description.at(0) == PERCENT {
        let colon = description.index_of_unit(c(':'), 0);
        let colon = colon.filter(|&colon| colon >= 2).ok_or(U_PARSE_ERROR)?;
        name = description.slice(..colon);
        rules = description.slice(skip_white_space(description, colon + 1)..);
    }
    if rules.is_empty() {
        return Err(U_PARSE_ERROR);
    }
    let name = (name.strip_suffix(&from_latin1(b"@noparse"))).unwrap_or(name);
    Ok((name, rules))
}

fn is_public(name: &[u16]) -> bool {
    !name.starts_with(&[PERCENT; 2])
}

fn init_default_rule_set(rule_sets: &[(&[u16], &[u16])]) -> usize {
    const NAMES: [&str; 3] = ["%spellout-numbering", "%digits-ordinal", "%duration"];
    let names = || rule_sets.iter().map(|&(name, _)| name);
    (names().position(|name| NAMES.iter().any(|known| eq_str(name, known))))
        .or_else(|| names().rposition(is_public))
        .unwrap_or_else(|| rule_sets.len().saturating_sub(1))
}

impl Rules {
    /// An empty `name` stands for the default rule set. ICU4C: rbnf.cpp, RuleBasedNumberFormat::init
    fn new(
        mut description: Vec<u16>,
        locale: &Locale,
        name: &[u16],
    ) -> Result<(Self, Formats), UErrorCode> {
        let symbols = try_shared(DecimalFormatSymbols::new(locale)?)?;
        description = strip_whitespace(&description)?;
        remove_lenient_parse_rules(&mut description);
        if description.is_empty() {
            return Err(U_PARSE_ERROR);
        }
        let descriptions = description.runs_by(|&unit, &next| [unit, next] != [SEMICOLON, PERCENT]);
        let descriptions = try_collect_results(descriptions.map(split_rule_set))?;
        let mut parser = RuleParser {
            locale,
            symbols,
            names: try_collect(descriptions.iter().map(|&(name, _)| name).zip(0..))?,
            is_fraction_rule_set: try_filled(false, descriptions.len())?,
            default_rule_set: init_default_rule_set(&descriptions),
            formats: Formats::default(),
        };
        sorting::sort_in_place(&mut parser.names);
        let rules = descriptions.iter().enumerate();
        let mut rule_sets = try_collect_results(
            rules.map(|(index, &(_, rules))| parser.parse_rules(index, rules)),
        )?;
        // A rule set that precedes its first use for a fractional part has been parsed as a normal rule set.
        for (set, &is_fraction_rule_set) in rule_sets.iter_mut().zip(&parser.is_fraction_rule_set) {
            set.is_fraction_rule_set = is_fraction_rule_set;
            if is_fraction_rule_set {
                let base_values = set.rules.iter().map(|rule| rule.base_value);
                set.least_common_multiple = base_values.reduce(util_lcm).unwrap_or(0);
            }
        }
        let default_rule_set = match (name, descriptions.at(parser.default_rule_set).0) {
            ([], initial) if !is_public(initial) => parser.default_rule_set,
            ([], name) | (name, _) if is_public(name) => parser.find_rule_set(name)?,
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        let from_symbol = |base_value, symbol| {
            NFRule::from_symbol(base_value, parser.symbols.get_const_symbol(symbol))
        };
        let rules = Self {
            rule_sets,
            default_rule_set,
            default_infinity_rule: from_symbol(INFINITY_RULE, Symbol::Infinity)?,
            default_nan_rule: from_symbol(NAN_RULE, Symbol::NaN)?,
        };
        Ok((rules, parser.formats))
    }
}

const RECURSION_LIMIT: i32 = 64;

/// Two substitutions in a rule double the work at each level. The cost of a rule includes its text.
const MAX_FORMAT_WORK: u32 = 1 << 28;

const MAX_INT64_IN_DOUBLE: i64 = (1 << 53) - 1;

#[derive(Clone, Copy)]
enum Number {
    Int(i64),
    Double(f64),
}

/// Rounds to 20 fraction digits. Also returns the power of ten of the last digit to write.
fn fraction_digits(number: f64) -> (DecimalQuantity, i32) {
    let mut digits = DecimalQuantity::new();
    digits.set_to_double(number);
    digits.round_to_magnitude(-20, RoundingMode::HalfEven);
    let lowest = digits.get_lower_display_magnitude().min(-1);
    (digits, lowest)
}

#[derive(Clone, Copy)]
struct RuleCall<'a> {
    rule: &'a NFRule,
    number: Number,
    /// Can be negative if a substitution is inside a plural part.
    pos: i64,
    cycle: CycleDetector,
    recursion_count: i32,
}

/// `pos` includes the position of the substitution.
type SubstitutionCall<'a> = (RuleCall<'a>, &'a NFSubstitution);

/// Detects an infinite number that cycles through rule sets (Brent's algorithm).
#[derive(Clone, Copy, Default)]
struct CycleDetector {
    steps: u32,
    /// The index of a visited rule set, and whether the number was negative.
    saved: Option<(u32, bool)>,
}

impl CycleDetector {
    /// Returns `None` if a cycle is detected.
    fn visit(self, set: usize, number: f64) -> Option<Self> {
        // A description has fewer than 2^31 units.
        let (steps, current) = (self.steps + 1, Some((set as u32, number < 0.0)));
        (current != self.saved).then_some(Self {
            steps,
            saved: if steps.is_power_of_two() {
                current
            } else {
                self.saved
            },
        })
    }
}

impl Kind {
    /// Returns `None` if the substitution writes nothing for an integer.
    fn transform_i64(self, number: i64) -> Option<i64> {
        match self {
            Self::SameValue | Self::IntegralPart => Some(number),
            Self::Multiplier { divisor } => number.checked_div(divisor),
            Self::Modulus { divisor, .. } => number.checked_rem(divisor),
            Self::AbsoluteValue => Some(number.wrapping_abs()),
            Self::FractionalPart { .. } | Self::Numerator { .. } => None,
        }
    }

    fn transform_f64(self, number: f64, floor_quotient: bool) -> f64 {
        match self {
            Self::SameValue => number,
            Self::Multiplier { divisor } if floor_quotient => (number / divisor as f64).floor(),
            Self::Multiplier { divisor } => number / divisor as f64,
            Self::Modulus { divisor, .. } => uprv_fmod(number, divisor as f64),
            Self::IntegralPart => number.floor(),
            Self::FractionalPart { .. } => number - number.floor(),
            Self::AbsoluteValue => number.abs(),
            Self::Numerator { denominator, .. } => uprv_round(number * denominator),
        }
    }
}

/// Returns the number that selects the plural form, cast to `i32` unless the rule writes that number.
fn plural_value(number: Number, rule: &NFRule) -> i64 {
    const LIMIT: u64 = 1 << 53;
    let divisor = rule.divisor;
    let has_multiplier = (rule.kinds()).any(|kind| matches!(kind, Kind::Multiplier { .. }));
    let is_floored = has_multiplier && rule.has_modulus();
    match number {
        Number::Int(number) => {
            let quotient = (number as u64).checked_div(divisor).unwrap_or(0);
            let is_output_number =
                number >= 0 && (is_floored || quotient * divisor == number as u64);
            if is_output_number && quotient <= LIMIT {
                quotient as i64
            } else {
                i64::from(quotient as i32)
            }
        }
        Number::Double(number) => {
            let (value, is_output_number) = if (0.0..1.0).contains(&number) {
                (
                    uprv_round(number * divisor as f64),
                    divisor == rule.base_value as u64,
                )
            } else {
                let value = number / divisor as f64;
                let is_integral_part = matches!(rule.kinds().next(), Some(Kind::IntegralPart));
                (
                    value,
                    ((is_integral_part || is_floored) && number > 0.0) || value == value.floor(),
                )
            };
            if is_output_number && value.abs() <= LIMIT as f64 {
                value as i64
            } else {
                i64::from(double_to_int32(value))
            }
        }
    }
}

/// Inserts the rule text, then the second substitution, then the first. Errors and plural parts make the order visible.
struct FormatState<'a> {
    rules: &'a Rules,
    formats: &'a Formats,
    /// The text up to the end of the last insertion.
    text: &'a mut dyn TextBuf,
    /// The rest of the text in reverse order, so that an insertion does not move it.
    tail: Vec<u16>,
    /// The first substitutions of the rules whose second substitution is in progress.
    pending: Vec<SubstitutionCall<'a>>,
    work: u32,
    /// Stops all further substitutions, and is not reported.
    has_failed: bool,
    is_over_budget: bool,
}

impl<'a> FormatState<'a> {
    fn charge(&mut self, count: usize) {
        self.work = self.work.saturating_add(to_int32(count) as u32);
    }

    fn length(&self) -> usize {
        self.text.len() + self.tail.len()
    }

    /// Makes `text` end at `pos`, which is pinned to the bounds of the whole text.
    fn seek(&mut self, pos: i64) {
        let end = self.text.len();
        if pos == end as i64 {
            return;
        }
        let pos = pos.clamp(0, (end + self.tail.len()) as i64) as usize;
        self.charge(end.abs_diff(pos) / 512);
        if let Some(following) = self.text.as_slice().get(pos..) {
            // Perf: one allocation is enough for most numbers.
            if self.tail.is_empty() {
                _ = self.tail.reserve_append(32);
            }
            self.tail.add_each(following.iter().rev().copied());
            self.text.truncate(pos);
        } else {
            self.restore_tail(pos - end);
        }
    }

    fn insert(&mut self, pos: i64, piece: &[u16]) {
        if !piece.is_empty() {
            self.seek(pos);
            self.charge(32 + 2 * piece.len());
            self.text.add_all(piece);
        }
    }

    /// Moves `count` units from the tail to the end of `text`.
    fn restore_tail(&mut self, count: usize) {
        let kept = self.tail.len() - count;
        let restored = self.tail.slice_mut(kept..);
        restored.reverse();
        self.text.add_all(restored);
        self.tail.truncate(kept);
    }

    fn find_rule(&mut self, set: &'a NFRuleSet, number: Number) -> Option<&'a NFRule> {
        if set.is_fraction_rule_set {
            self.charge(set.rules.len() / 2);
        }
        match number {
            Number::Int(number) if set.is_fraction_rule_set => {
                set.find_fraction_rule_set_rule(number as f64)
            }
            Number::Double(number) if set.is_fraction_rule_set => {
                set.find_fraction_rule_set_rule(number)
            }
            Number::Int(number) => set.find_normal_rule(number),
            Number::Double(number) => set.find_double_rule(number, self.rules),
        }
    }

    /// Returns the call of the rule for `number`, or `None` if there is no rule or the recursion limit is reached.
    fn enter_rule_set(
        &mut self,
        set: &'a NFRuleSet,
        number: Number,
        pos: i64,
        recursion_count: i32,
    ) -> Option<RuleCall<'a>> {
        if recursion_count >= RECURSION_LIMIT {
            self.has_failed = true;
            return None;
        }
        let rule = self.find_rule(set, number)?;
        Some(RuleCall {
            rule,
            number,
            pos,
            cycle: CycleDetector::default(),
            recursion_count: recursion_count + 1,
        })
    }

    /// The limit of recursion covers neither `>>>` nor infinite numbers. Only digits and leading zeros use the stack.
    fn format(&mut self, set: &'a NFRuleSet, number: Number, pos: i64, recursion_count: i32) {
        let outer_pending = self.pending.len();
        let mut next = self.enter_rule_set(set, number, pos, recursion_count);
        while let Some((call, sub)) = next
            .and_then(|call| self.apply(call))
            .or_else(|| (self.pending.len() > outer_pending).then(|| self.pending.pop())?)
        {
            next = self.substitute(call, sub);
        }
    }

    /// Inserts the rule text. Returns the last substitution and pushes the first of two on `pending`.
    fn apply(&mut self, call: RuleCall<'a>) -> Option<SubstitutionCall<'a>> {
        if self.work >= MAX_FORMAT_WORK {
            (self.has_failed, self.is_over_budget) = (true, true);
            return None;
        }
        self.work += 1;
        let RuleCall {
            rule, number, pos, ..
        } = call;
        let (plural_start, growth) = match &rule.plural_part {
            Some(part) => (
                part.start,
                self.insert_with_plural_part(rule, part, number, pos),
            ),
            None => {
                self.insert(pos, &rule.rule_text);
                (0, 0)
            }
        };
        let call_of = |sub: &'a NFSubstitution| {
            let pos = pos + sub.pos as i64 + if sub.pos > plural_start { growth } else { 0 };
            (RuleCall { pos, ..call }, sub)
        };
        match &rule.substitutions {
            [Some(first), Some(second)] => {
                self.pending.add(call_of(first));
                Some(call_of(second))
            }
            [first, _] => first.as_ref().map(call_of),
        }
    }

    /// Returns the length of the inserted text minus the length of the rule text.
    fn insert_with_plural_part(
        &mut self,
        rule: &NFRule,
        part: &PluralPart,
        number: Number,
        pos: i64,
    ) -> i64 {
        let length = self.length();
        self.insert(pos, rule.rule_text.slice(part.end..));
        self.charge(16);
        let mut selected = Vec::new();
        if !self.has_failed
            && let Some(number_format) = self.formats.plural.as_ref().soft_some()
        {
            let number = plural_value(number, rule);
            match part.format.format(number_format, number, &mut selected) {
                Ok(cost) => self.charge(cost),
                Err(_) => self.has_failed = true,
            }
        }
        self.insert(pos, &selected);
        self.insert(pos, rule.rule_text.slice(..part.start));
        self.length() as i64 - (length + rule.rule_text.len()) as i64
    }

    // ICU4C: nfsubs.cpp, NFSubstitution::doSubstitution
    fn substitute(&mut self, call: RuleCall<'a>, sub: &NFSubstitution) -> Option<RuleCall<'a>> {
        if self.has_failed || is_oom() {
            return None;
        }
        match sub.target {
            Target::RuleSet(set) => self.substitute_by_rules(call, sub.kind, set),
            Target::NumberFormat(format) => {
                self.substitute_by_format(call, sub.kind, format);
                None
            }
            Target::None => None,
        }
    }

    fn substitute_by_format(&mut self, call: RuleCall, kind: Kind, format: usize) {
        let floor_quotient = call.rule.has_modulus();
        let number = match call.number {
            Number::Int(number) => match kind.transform_i64(number) {
                Some(large) if number > MAX_INT64_IN_DOUBLE => Number::Int(large),
                Some(_) => Number::Double(kind.transform_f64(number as f64, floor_quotient)),
                None => return,
            },
            Number::Double(number) => Number::Double(kind.transform_f64(number, floor_quotient)),
        };
        let checks_status = matches!(
            (call.number, kind),
            (Number::Int(_), _) | (_, Kind::Numerator { .. })
        );
        self.seek(call.pos);
        let start = self.text.len();
        if let Some(format) = self.formats.decimal.soft_get(format) {
            let result = match number {
                Number::Int(number) => format.format_int64(number, self.text),
                Number::Double(number) => format.format_double(number, self.text),
            };
            self.has_failed = result.is_err() && checks_status;
        }
        let count = self.text.len().saturating_sub(start);
        self.charge(if count == 0 { 16 } else { 48 + 2 * count });
    }

    fn substitute_by_rules(
        &mut self,
        call: RuleCall<'a>,
        kind: Kind,
        set_index: usize,
    ) -> Option<RuleCall<'a>> {
        let set = self.rules.rule_sets.soft_get(set_index)?;
        let RuleCall {
            mut pos,
            recursion_count,
            ..
        } = call;
        let number = match call.number {
            Number::Int(number) => Number::Int(kind.transform_i64(number)?),
            Number::Double(number) => Number::Double(kind.transform_f64(number, true)),
        };
        let (original, number) = match (kind, call.number, number) {
            (
                Kind::Modulus {
                    rule_to_use: Some(rule),
                    ..
                },
                ..,
            ) => {
                return set.rules.soft_get(rule as usize).map(|rule| RuleCall {
                    rule,
                    number,
                    ..call
                });
            }
            (_, Number::Double(original), Number::Double(number)) => (original, number),
            _ => return self.enter_rule_set(set, number, pos, recursion_count),
        };
        match kind {
            Kind::FractionalPart {
                by_digits: true,
                use_spaces,
            } => {
                self.charge(8);
                self.insert_digits(set, original, use_spaces, pos, recursion_count);
                return None;
            }
            Kind::FractionalPart { .. } => {
                self.charge(8);
                if recursion_count < RECURSION_LIMIT
                    && let Some((digits, denominator)) = shortest_fraction(original)
                    && let Some(rule) = set.find_exact_denominator_rule(digits, denominator)
                {
                    self.charge(set.rules.len() / 2);
                    let (number, cycle) = (
                        Number::Double(digits as f64 / denominator as f64),
                        CycleDetector::default(),
                    );
                    return Some(RuleCall {
                        rule,
                        number,
                        pos,
                        cycle,
                        recursion_count: recursion_count + 1,
                    });
                }
            }
            Kind::Numerator {
                denominator,
                with_zeros,
            } => {
                let numerator = util64_from_double(number);
                if with_zeros {
                    pos += self.insert_zeros(set, numerator, denominator, pos, recursion_count);
                }
                let number = if number == numerator as f64 {
                    Number::Int(numerator)
                } else {
                    Number::Double(number)
                };
                return self.enter_rule_set(set, number, pos, recursion_count);
            }
            _ => {}
        }
        if number.is_infinite() {
            let rule = self.find_rule(set, Number::Double(f64::INFINITY))?;
            let cycle = call.cycle.visit(set_index, number);
            self.has_failed = cycle.is_none();
            return cycle.map(|cycle| RuleCall {
                rule,
                number: Number::Double(number),
                cycle,
                ..call
            });
        }
        let is_whole = number == number.floor();
        let number = if is_whole {
            Number::Int(util64_from_double(number))
        } else {
            Number::Double(number)
        };
        self.enter_rule_set(set, number, pos, recursion_count)
    }

    /// Inserts the fraction digits starting with the last one, or a zero if there are none.
    fn insert_digits(
        &mut self,
        set: &'a NFRuleSet,
        number: f64,
        use_spaces: bool,
        pos: i64,
        recursion_count: i32,
    ) {
        let (digits, lowest) = fraction_digits(number);
        for magnitude in lowest..0 {
            if use_spaces && magnitude != lowest {
                self.insert(pos, &[SPACE]);
            }
            self.format(
                set,
                Number::Int(digits.get_digit(magnitude).into()),
                pos,
                recursion_count,
            );
        }
    }

    /// Inserts the leading zeros of the decimal expansion and returns their length.
    fn insert_zeros(
        &mut self,
        set: &'a NFRuleSet,
        numerator: i64,
        denominator: f64,
        pos: i64,
        depth: i32,
    ) -> i64 {
        let length = self.length();
        let mut product = numerator.wrapping_mul(10);
        while (product as f64) < denominator && product != 0 {
            self.insert(pos, &[SPACE]);
            self.format(set, Number::Int(0), pos, depth);
            product = product.wrapping_mul(10);
        }
        self.length() as i64 - length as i64
    }
}

pub(crate) struct RuleBasedNumberFormat {
    rules: Arc<Rules>,
    formats: Formats,
}

impl TryClone for RuleBasedNumberFormat {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        let Formats { decimal, plural } = &self.formats;
        let plural = plural.as_ref();
        Ok(Self {
            rules: Arc::clone(&self.rules),
            formats: Formats {
                decimal: try_collect_results(decimal.iter().map(DecimalFormat::try_clone))?,
                plural: (plural.map(|it| try_box_result(&mut it.try_clone()))).transpose()?,
            },
        })
    }
}

impl RuleBasedNumberFormat {
    /// Formats with the public rule set `name` of `group`, or with the default rule set if `name` is empty.
    pub(crate) fn new(locale: &Locale, group: &[u8], name: &[u16]) -> Result<Self, UErrorCode> {
        let bundle = ures_open(Some(U_ICUDATA_RBNF), locale.get_name())?;
        let groups = bundle.get_by_key_with_fallback(b"RBNFRules")?;
        let description = groups.get_by_key_with_fallback(group)?.get_string()?;
        let (rules, formats) = Rules::new(description.try_to_vec()?, locale, name)?;
        Ok(Self {
            rules: try_shared(rules)?,
            formats,
        })
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

    /// Fails only if the work exceeds the limit.
    fn format(&self, number: Number, text: &mut dyn TextBuf) -> Result<(), UErrorCode> {
        let start = text.len();
        let mut state = FormatState {
            rules: &self.rules,
            formats: &self.formats,
            text,
            tail: Vec::new(),
            pending: Vec::new(),
            work: 0,
            has_failed: false,
            is_over_budget: false,
        };
        if let Some(set) = self.rules.rule_sets.soft_get(self.rules.default_rule_set) {
            state.format(set, number, start as i64, 0);
        }
        if !state.tail.is_empty() {
            state.restore_tail(state.tail.len());
        }
        if state.is_over_budget {
            Err(U_INVALID_STATE_ERROR)
        } else {
            Ok(())
        }
    }
}
