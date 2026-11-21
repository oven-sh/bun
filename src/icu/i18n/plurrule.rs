//! Selects the plural form of a number by rules such as "i = 1 and v = 0". ICU4C: plurrule.cpp

use crate::common::locid::Locale;
use crate::common::memory::{try_box, try_collect, try_push};
use crate::common::putil::double_to_int64;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::uloc_get_parent;
use crate::common::umutex::StaticMap;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::double_conversion::magnitude_of_last_digit;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::pluralranges::StandardPluralRanges;
use crate::i18n::standardplural::PluralForm;
use bun_core::strings;

pub(crate) type UPluralType = i32;
const UPLURAL_TYPE_CARDINAL: UPluralType = 0;
const UPLURAL_TYPE_ORDINAL: UPluralType = 1;

/// <https://unicode.org/reports/tr35/tr35-numbers.html#Operands>
#[derive(Clone, Copy)]
pub(crate) enum PluralOperand {
    N,
    I,
    F,
    T,
    V,
    E,
}

pub(crate) trait IFixedDecimal {
    fn get_plural_operand(&self, operand: PluralOperand) -> f64;
}

struct Rule {
    form: PluralForm,
    /// Adjacent relations are joined by "and", or by "or" where `followed_by_or` is set.
    condition: Vec<Relation>,
}

/// "n % 100 != 11..14,19"
struct Relation {
    operand: PluralOperand,
    modulus: Option<i32>,
    negated: bool,
    ranges: Vec<(i32, i32)>,
    followed_by_or: bool,
}

impl Relation {
    fn is_fulfilled(&self, number: &dyn IFixedDecimal) -> bool {
        let value = number.get_plural_operand(self.operand);
        let n = self.modulus.map_or(value, |modulus| fmod(value, modulus));
        let contains = |&(low, high)| f64::from(low) <= n && n <= f64::from(high);
        (self.ranges.iter().any(contains) && value == value.floor()) != self.negated
    }
}

fn fmod(n: f64, modulus: i32) -> f64 {
    let integer = n as i32;
    match integer.checked_rem(modulus) {
        Some(remainder) if f64::from(integer) == n => f64::from(remainder),
        _ => n % f64::from(modulus),
    }
}

impl Rule {
    fn is_fulfilled(&self, number: &dyn IFixedDecimal) -> bool {
        let mut alternatives = self
            .condition
            .split_inclusive(|relation| relation.followed_by_or);
        alternatives.any(|relations| {
            relations
                .iter()
                .all(|relation| relation.is_fulfilled(number))
        })
    }
}

fn parse_number(digits: &[u8]) -> Option<i32> {
    str::from_utf8(digits).ok()?.parse().ok()
}

/// Returns `None` after a syntax error or a failed allocation.
fn parse_condition(text: &[u8]) -> Option<Vec<Relation>> {
    let (mut words, mut condition) = (strings::tokenize(text, b" "), Vec::new());
    while let Some(operand) = words.next() {
        let operand = match operand {
            b"n" => PluralOperand::N,
            b"i" => PluralOperand::I,
            b"f" => PluralOperand::F,
            b"t" => PluralOperand::T,
            b"v" => PluralOperand::V,
            b"e" => PluralOperand::E,
            _ => return None,
        };
        let (mut operator, mut modulus) = (words.next()?, None);
        if operator == b"%" {
            modulus = Some(parse_number(words.next()?)?);
            operator = words.next()?;
        }
        let mut ranges = Vec::new();
        for range in strings::split(words.next()?, b",") {
            let (low, high) = strings::split_once(range, b"..").unwrap_or((range, range));
            try_push(&mut ranges, (parse_number(low)?, parse_number(high)?)).ok()?;
        }
        let relation = Relation {
            operand,
            modulus,
            negated: match operator {
                b"=" => false,
                b"!=" => true,
                _ => return None,
            },
            ranges,
            followed_by_or: match words.next() {
                Some(b"or") => true,
                Some(b"and") | None => false,
                _ => return None,
            },
        };
        try_push(&mut condition, relation).ok()?;
    }
    Some(condition)
}

/// Leaves out "other", which has no condition.
fn parse_rules(plurals: &UResourceBundle, set: &[u8]) -> Result<Vec<Rule>, UErrorCode> {
    let table = plurals.get_by_key(b"rules")?.get_by_key(set)?;
    let mut rules = Vec::new();
    for (keyword, text) in table.get_value().get_table()?.iter() {
        let form = PluralForm::from_keyword(keyword).ok_or(U_UNEXPECTED_TOKEN)?;
        if form != PluralForm::Other {
            // Samples follow the '@'.
            let text = text.get_string()?.iter();
            let text = text.take_while(|&unit| unit != u16::from(b'@'));
            let condition = parse_condition(&try_collect(text.map(|unit| unit as u8))?);
            let condition = condition.ok_or(U_UNEXPECTED_TOKEN)?;
            try_push(&mut rules, Rule { form, condition })?;
        }
    }
    Ok(rules)
}

/// Returns the rules of `base_name` or of its nearest parent that has any. `table` maps locales to sets of rules.
fn load_rules(base_name: &[u8], table: &[u8]) -> Result<&'static [Rule], UErrorCode> {
    static PARSED: StaticMap<Vec<u8>, &'static Vec<Rule>> = StaticMap::new();
    let plurals = ures_open_direct(None, b"plurals")?;
    let locales = plurals.get_by_key(table)?;
    let mut name = base_name;
    let set = loop {
        if name.is_empty() {
            return Ok(&[]);
        }
        if let Ok(set) = locales.get_string_by_key(name) {
            break try_collect(invariant_prefix(set.iter()))?;
        }
        name = uloc_get_parent(name);
    };
    if let Some(parsed) = PARSED.get(&set) {
        return Ok(parsed);
    }
    let parsed = try_box(parse_rules(&plurals, &set)?)?;
    PARSED
        .get_or_insert_with(set, || Box::leak(parsed))
        .map(Vec::as_slice)
}

#[derive(Clone, Copy)]
pub(crate) struct PluralRules {
    rules: &'static [Rule],
    ranges: StandardPluralRanges,
}

impl PluralRules {
    pub(crate) fn for_locale(locale: &Locale, type_: UPluralType) -> Result<Self, UErrorCode> {
        match type_ {
            UPLURAL_TYPE_CARDINAL => Self::cardinal(locale),
            UPLURAL_TYPE_ORDINAL => Self::load(locale, b"locales_ordinals"),
            _ => Err(U_UNSUPPORTED_ERROR),
        }
    }

    pub(crate) fn cardinal(locale: &Locale) -> Result<Self, UErrorCode> {
        static CACHE: LocaleCache<PluralRules> = LocaleCache::new();
        let name = locale.get_name();
        // An entry depends on nothing but its key.
        let load = || Self::load(&Locale::from_name(name), b"locales");
        let rules = CACHE.get_or_create(name, load);
        rules.map(|rules| *rules)
    }

    fn load(locale: &Locale, table: &[u8]) -> Result<Self, UErrorCode> {
        Ok(Self {
            rules: load_rules(locale.get_base_name(), table)?,
            ranges: StandardPluralRanges::for_language(locale.get_language())?,
        })
    }

    fn select_finite(&self, number: &dyn IFixedDecimal) -> PluralForm {
        let rule = self.rules.iter().find(|rule| rule.is_fulfilled(number));
        rule.map_or(PluralForm::Other, |rule| rule.form)
    }

    /// `number` is finite and not negative.
    pub(crate) fn select_double(&self, number: f64) -> PluralForm {
        self.select_finite(&FixedDecimal::new(number))
    }

    pub(crate) fn select(&self, number: &DecimalQuantity) -> PluralForm {
        if number.is_nan() || number.is_infinite() {
            PluralForm::Other
        } else {
            self.select_finite(number)
        }
    }

    pub(crate) fn select_range(
        &self,
        first: &DecimalQuantity,
        second: &DecimalQuantity,
    ) -> PluralForm {
        self.ranges.resolve(self.select(first), self.select(second))
    }

    pub(crate) fn get_keywords(&self) -> PluralKeywordEnumeration {
        PluralKeywordEnumeration {
            rules: self.rules,
            position: 0,
        }
    }

    /// Returns the forms of the locale but `Other`.
    pub(crate) fn forms(&self) -> impl Iterator<Item = PluralForm> {
        self.rules.iter().map(|rule| rule.form)
    }
}

pub(crate) struct PluralKeywordEnumeration {
    rules: &'static [Rule],
    position: usize,
}

impl StringEnumeration for PluralKeywordEnumeration {
    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        if self.position > self.rules.len() {
            return Ok(None);
        }
        let rule = self.rules.get(self.position);
        self.position += 1;
        let form = rule.map_or(PluralForm::Other, |rule| rule.form);
        Ok(Some(Item::Chars(form.keyword())))
    }
}

/// The plural operands of an unformatted `f64`.
struct FixedDecimal {
    source: f64,
    int_value: i64,
    fraction_digit_count: i32,
    fraction_digits: i64,
}

impl FixedDecimal {
    fn new(source: f64) -> Self {
        let fraction_digit_count = Self::decimals(source);
        Self {
            source,
            // 2^63 itself is converted, with the result of the processor.
            int_value: if source > i64::MAX as f64 {
                0
            } else {
                double_to_int64(source)
            },
            fraction_digit_count,
            fraction_digits: Self::fractional_digits(source, fraction_digit_count),
        }
    }

    /// Returns the number of fraction digits, excluding trailing zeros.
    fn decimals(n: f64) -> i32 {
        for (count, power) in (0..).zip([1.0, 10.0, 100.0, 1000.0]) {
            let scaled = n * power;
            if scaled == scaled.floor() {
                return count;
            }
        }
        -magnitude_of_last_digit(n)
    }

    /// Returns the first `count` fraction digits as an integer, saturating at `i64::MAX`.
    fn fractional_digits(n: f64, count: i32) -> i64 {
        let power = match count {
            0 => return 0,
            1 => 10.0,
            2 => 100.0,
            3 => 1000.0,
            _ => 10.0f64.powf(f64::from(count)),
        };
        ((n - n.floor()) * power + 0.5) as i64
    }
}

impl IFixedDecimal for FixedDecimal {
    fn get_plural_operand(&self, operand: PluralOperand) -> f64 {
        match operand {
            PluralOperand::N => self.source,
            PluralOperand::I => self.int_value as f64,
            PluralOperand::F => self.fraction_digits as f64,
            PluralOperand::T => {
                let mut digits = self.fraction_digits;
                while digits != 0 && digits % 10 == 0 {
                    digits /= 10;
                }
                digits as f64
            }
            PluralOperand::V => f64::from(self.fraction_digit_count),
            PluralOperand::E => 0.0,
        }
    }
}
