//! Selects the plural form of a number by rules such as "i = 1 and v = 0". ICU4C: plurrule.cpp

use crate::common::locid::Locale;
use crate::common::memory::{
    Appendable, check_oom, oom_checked, try_box, try_collect, try_cstring, try_push,
};
use crate::common::putil::double_to_int64;
use crate::common::slice_ext::SliceExt;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::uloc_get_parent;
use crate::common::umutex::StaticMap;
use crate::common::uresdata::DataKey;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::double_conversion::magnitude_of_last_digit;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::pluralranges::StandardPluralRanges;
use crate::i18n::standardplural::PluralForm;
use std::borrow::Cow;
use std::ffi::CStr;
use std::mem::{replace, take};

pub(crate) type UPluralType = i32;
pub(crate) const UPLURAL_TYPE_CARDINAL: UPluralType = 0;
pub(crate) const UPLURAL_TYPE_ORDINAL: UPluralType = 1;

/// <https://unicode.org/reports/tr35/tr35-numbers.html#Operands>
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum PluralOperand {
    #[default]
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
    /// `Other` for a custom keyword.
    form: PluralForm,
    /// Owned if it is custom.
    keyword: Cow<'static, CStr>,
    /// Adjacent relations are joined by "and", or by "or" where `followed_by_or` is set.
    condition: Vec<Relation>,
}

static OTHER_RULE: Rule = Rule {
    form: PluralForm::Other,
    keyword: Cow::Borrowed(c"other"),
    condition: Vec::new(),
};

/// An end of a range that has not been parsed yet.
const UNSET: i32 = -1;

/// "n % 100 != 11..14,19"
#[derive(Default)]
struct Relation {
    operand: PluralOperand,
    modulus: Option<i32>,
    negated: bool,
    /// Empty if there is nothing to compare with, as in "n % 3" or an empty condition.
    ranges: Vec<(i32, i32)>,
    /// False for "is 1".
    has_range_list: bool,
    /// True for "in 1..3,5" and "= 1", false for "within 1..3".
    integers_only: bool,
    followed_by_or: bool,
}

impl Relation {
    fn is_fulfilled(&self, number: &dyn IFixedDecimal) -> bool {
        let value = number.get_plural_operand(self.operand);
        let n = self.modulus.map_or(value, |modulus| fmod(value, modulus));
        let contains = |&(low, high)| f64::from(low) <= n && n <= f64::from(high);
        let passes = if self.ranges.iter().any(contains) {
            value == value.floor() || !self.integers_only
        } else {
            self.ranges.is_empty()
        };
        passes != self.negated
    }

    fn start_range_list(&mut self, token: Token) -> Result<(), UErrorCode> {
        self.negated |= token == Token::NotEqual;
        self.integers_only = token != Token::Within;
        if replace(&mut self.has_range_list, true) {
            return Err(U_UNEXPECTED_TOKEN);
        }
        self.ranges.clear();
        self.start_next_range()
    }

    fn start_next_range(&mut self) -> Result<(), UErrorCode> {
        if !self.has_range_list {
            return Err(U_UNEXPECTED_TOKEN);
        }
        try_push(&mut self.ranges, (UNSET, UNSET))
    }

    fn add_number(&mut self, number: i32) -> Result<(), UErrorCode> {
        let Some((low, high)) = self.ranges.last_mut().filter(|_| self.has_range_list) else {
            self.ranges.clear();
            return try_push(&mut self.ranges, (number, number));
        };
        if *low == UNSET {
            *low = number;
        }
        *high = number;
        if *low > number {
            Err(U_UNEXPECTED_TOKEN)
        } else {
            Ok(())
        }
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
    fn is_other(&self) -> bool {
        self.form == PluralForm::Other && matches!(self.keyword, Cow::Borrowed(_))
    }

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

#[derive(Clone, Copy, PartialEq)]
enum Token<'a> {
    Keyword(&'a [u8]),
    Number(&'a [u8]),
    Operand(PluralOperand),
    Colon,
    Semicolon,
    Comma,
    At,
    DotDot,
    And,
    Or,
    Mod,
    Not,
    In,
    Within,
    Is,
    Equal,
    NotEqual,
    /// "integer" or "decimal"
    SampleType,
}

impl Token<'_> {
    /// The first word of a rule is a keyword even if it is reserved.
    fn resolve_reserved_word(self) -> Self {
        let Token::Keyword(word) = self else {
            return self;
        };
        match word {
            b"n" => Token::Operand(PluralOperand::N),
            b"i" => Token::Operand(PluralOperand::I),
            b"f" => Token::Operand(PluralOperand::F),
            b"t" => Token::Operand(PluralOperand::T),
            b"e" | b"c" => Token::Operand(PluralOperand::E),
            b"v" => Token::Operand(PluralOperand::V),
            b"is" => Token::Is,
            b"and" => Token::And,
            b"in" => Token::In,
            b"within" => Token::Within,
            b"not" => Token::Not,
            b"mod" => Token::Mod,
            b"or" => Token::Or,
            b"decimal" | b"integer" => Token::SampleType,
            _ => self,
        }
    }
}

/// The unread rest of the rules, from `to_rule_char`.
struct Tokenizer<'a>(&'a [u8]);

/// Maps '…' to '~', which has the same effect, and any other unit beyond ASCII to NUL, which starts no token.
fn to_rule_char(unit: u16) -> u8 {
    match unit {
        0..0x80 => unit as u8,
        0x2026 => b'~',
        _ => 0,
    }
}

fn is_in_samples(c: u8) -> bool {
    matches!(c, b'0'..=b':' | b'a'..=b'z' | b' ' | b'!' | b'%' | b',' | b'.' | b'=' | b'~')
}

impl<'a> Tokenizer<'a> {
    // ICU4C: plurrule.cpp, PluralRuleParser::getNextToken
    fn next_token(&mut self) -> Result<Token<'a>, UErrorCode> {
        let rest = self.0.split_while(|&c| c == b' ').1;
        let (length, token) = match rest {
            [b'0'..=b'9', ..] => {
                let digits = rest.split_while(u8::is_ascii_digit).0;
                (digits.len(), Token::Number(digits))
            }
            [b'a'..=b'z', ..] => {
                let word = rest.split_while(u8::is_ascii_lowercase).0;
                (word.len(), Token::Keyword(word))
            }
            [b':', ..] => (1, Token::Colon),
            [b';', ..] => (1, Token::Semicolon),
            [b',', ..] => (1, Token::Comma),
            [b'=', ..] => (1, Token::Equal),
            [b'%', ..] => (1, Token::Mod),
            [b'@', ..] => (1, Token::At),
            [b'!', b'=', ..] => (2, Token::NotEqual),
            [b'.', b'.', ..] => (2, Token::DotDot),
            _ => return Err(U_UNEXPECTED_TOKEN),
        };
        self.0 = rest.slice(length..);
        Ok(token)
    }

    /// Parses a rule after its keyword. ICU4C: plurrule.cpp, PluralRuleParser::parse, checkSyntax
    fn parse_condition(&mut self) -> Result<Vec<Relation>, UErrorCode> {
        use Token::*;
        let (mut condition, mut relation, mut previous) =
            (Vec::new(), Relation::default(), Keyword(&[]));
        while previous != Semicolon {
            let mut token = self.next_token()?.resolve_reserved_word();
            match (previous, token) {
                (Keyword(_), Colon) | (Colon | Number(_), At) | (Operand(_) | Number(_), Is) => {}
                (Number(_), DotDot | Semicolon) | (Operand(_), Mod) => {}
                (Number(_), And | Or) => {
                    relation.followed_by_or = token == Or;
                    condition.add(take(&mut relation));
                }
                (Colon | And | Or, Operand(operand)) => relation.operand = operand,
                (Mod, Number(digits)) => relation.modulus = Some(parse_number(digits)?),
                (Operand(_) | Number(_) | Is, Not) => relation.negated = true,
                (Operand(_) | Number(_), Equal | NotEqual)
                | (Operand(_) | Number(_) | Not, In | Within) => {
                    relation.start_range_list(token)?;
                }
                (Number(_), Comma) => relation.start_next_range()?,
                (Is | Not | In | Within | Equal | NotEqual | DotDot | Comma, Number(digits)) => {
                    relation.add_number(parse_number(digits)?)?;
                }
                (At, SampleType) => {
                    self.0 = self.0.split_while(|&c| is_in_samples(c)).1;
                    token = self.next_token()?;
                }
                _ => return Err(U_UNEXPECTED_TOKEN),
            }
            previous = token;
        }
        condition.add(relation);
        Ok(condition)
    }
}

fn parse_number(digits: &[u8]) -> Result<i32, UErrorCode> {
    let add = |number: i32, &digit: &u8| number.checked_mul(10)?.checked_add((digit - b'0').into());
    digits.iter().try_fold(0, add).ok_or(U_UNEXPECTED_TOKEN)
}

/// Leaves out "other" unless it is the first of several rules: only there does its condition count. `text` is empty or ends with ';'.
fn parse(text: &[u8]) -> Result<Vec<Rule>, UErrorCode> {
    let (mut tokens, mut rules) = (Tokenizer(text), Vec::new());
    while !tokens.0.is_empty() {
        let Token::Keyword(keyword) = tokens.next_token()? else {
            return Err(U_UNEXPECTED_TOKEN);
        };
        let form = PluralForm::from_keyword(keyword);
        let condition = tokens.parse_condition()?;
        if form != Some(PluralForm::Other) || rules.is_empty() {
            rules.add(Rule {
                form: form.unwrap_or(PluralForm::Other),
                keyword: match form {
                    Some(form) => Cow::Borrowed(form.keyword()),
                    None => Cow::Owned(try_cstring(keyword)?),
                },
                condition,
            });
        }
    }
    if let [only] = &*rules
        && only.is_other()
    {
        rules.clear();
    }
    oom_checked(rules)
}

/// Joins the items of `set` as "keyword:condition;". A condition can have more rules after a ';'.
fn join_rules(set: &UResourceBundle) -> Result<Vec<u8>, UErrorCode> {
    let (mut text, keywords) = (Vec::new(), set.get_value().get_table().ok());
    for index in 0..set.get_size() {
        let keyword = keywords.and_then(|keywords| keywords.key_at(index));
        let keyword = keyword.map(DataKey::as_bytes).unwrap_or_default();
        let condition = ures_get_string_by_index(set, index)?.unwrap_or_default();
        text.add_all(keyword);
        text.add(b':');
        text.add_each(condition.iter().map(to_rule_char));
        text.add(b';');
    }
    oom_checked(text)
}

/// Returns the name of the rules of `base_name` or of its nearest parent that has any. `table` maps locales to names.
fn find_set(
    plurals: &UResourceBundle,
    base_name: &[u8],
    table: &[u8],
) -> Result<Vec<u8>, UErrorCode> {
    let locales = plurals.get_by_key(table)?;
    let mut name = base_name;
    loop {
        if let Ok(set) = locales.get_string_by_key(name) {
            return try_collect(invariant_prefix(set.iter()));
        }
        name = uloc_get_parent(name);
        if name.is_empty() {
            return Err(U_MISSING_RESOURCE_ERROR);
        }
    }
}

/// Without data there are no rules, and every number is "other".
fn load_rules(base_name: &[u8], table: &[u8]) -> Result<&'static [Rule], UErrorCode> {
    static PARSED: StaticMap<Vec<u8>, &'static Vec<Rule>> = StaticMap::new();
    let no_rules = || check_oom().map(|()| [].as_slice());
    let Ok(plurals) = ures_open_direct(None, b"plurals") else {
        return no_rules();
    };
    let Ok(name) = find_set(&plurals, base_name, table) else {
        return no_rules();
    };
    if let Some(parsed) = PARSED.get(&name) {
        return Ok(parsed);
    }
    let sets = plurals.get_by_key(b"rules");
    let Ok(set) = sets.and_then(|sets| sets.get_by_key(&name)) else {
        return no_rules();
    };
    let parsed = try_box(parse(&join_rules(&set)?)?)?;
    PARSED
        .get_or_insert_with(name, || Box::leak(parsed))
        .map(Vec::as_slice)
}

const ORDINALS: &[u8] = b"locales_ordinals";

#[derive(Clone, Copy)]
pub(crate) struct PluralRules {
    rules: &'static [Rule],
    ranges: StandardPluralRanges,
}

impl PluralRules {
    pub(crate) fn for_locale(locale: &Locale, type_: UPluralType) -> Result<Self, UErrorCode> {
        match type_ {
            UPLURAL_TYPE_CARDINAL => Self::cardinal(locale),
            UPLURAL_TYPE_ORDINAL => Self::load(locale, ORDINALS),
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

    pub(crate) fn ordinal_without_ranges(locale: &Locale) -> Result<Self, UErrorCode> {
        Ok(Self {
            rules: load_rules(locale.get_base_name(), ORDINALS)?,
            ranges: StandardPluralRanges::default(),
        })
    }

    fn select_finite(&self, number: &dyn IFixedDecimal) -> &'static Rule {
        let rule = self.rules.iter().find(|rule| rule.is_fulfilled(number));
        rule.unwrap_or(&OTHER_RULE)
    }

    fn select_rule(&self, number: &DecimalQuantity) -> &'static Rule {
        if number.is_nan() || number.is_infinite() {
            &OTHER_RULE
        } else {
            self.select_finite(number)
        }
    }

    /// `number` is finite and not negative.
    pub(crate) fn select_double(&self, number: f64) -> PluralForm {
        self.select_finite(&FixedDecimal::new(number)).form
    }

    /// Returns `Other` for a custom keyword.
    pub(crate) fn select(&self, number: &DecimalQuantity) -> PluralForm {
        self.select_rule(number).form
    }

    pub(crate) fn select_keyword(&self, number: &DecimalQuantity) -> &'static CStr {
        &self.select_rule(number).keyword
    }

    pub(crate) fn select_range(
        &self,
        first: &DecimalQuantity,
        second: &DecimalQuantity,
    ) -> PluralForm {
        self.ranges.resolve(self.select(first), self.select(second))
    }

    pub(crate) fn get_keywords(&self) -> PluralKeywordEnumeration {
        let has_other = self.rules.first().is_some_and(Rule::is_other);
        PluralKeywordEnumeration {
            rules: self.rules,
            count: self.rules.len() + usize::from(!has_other),
            position: 0,
        }
    }

    /// Returns the forms of the rules. `Other` may be missing.
    pub(crate) fn forms(&self) -> impl Iterator<Item = PluralForm> {
        self.rules.iter().map(|rule| rule.form)
    }
}

pub(crate) struct PluralKeywordEnumeration {
    rules: &'static [Rule],
    count: usize,
    position: usize,
}

impl StringEnumeration for PluralKeywordEnumeration {
    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        if self.position == self.count {
            return Ok(None);
        }
        let rule = self.rules.get(self.position);
        self.position += 1;
        Ok(Some(Item::Chars(&rule.unwrap_or(&OTHER_RULE).keyword)))
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
