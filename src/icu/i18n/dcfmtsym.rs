//! The separators, signs and digits of a locale. ICU4C: dcfmtsym.cpp

use crate::common::bytes::U16s;
use crate::common::charstr::SmallChars;
use crate::common::cstring::until_nul;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, defer_oom};
use crate::common::resource::ResourceValue;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::ucurr::ucurr_for_locale;
use crate::common::udata::searches_files;
use crate::common::uinvchar::uchar_to_char;
use crate::common::uloc::ulocimp_get_name_to;
use crate::common::unistr::SmallUString;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::measunit::{CurrencyCode, NO_CURRENCY};
use crate::i18n::numsys::{LATN, Name, NumberingSystem};

#[derive(Clone, Copy)]
pub(crate) enum Symbol {
    DecimalSeparator,
    GroupingSeparator,
    MonetarySeparator,
    MonetaryGroupingSeparator,
    PercentSign,
    MinusSign,
    PlusSign,
    ApproximatelySign,
    Exponential,
    Infinity,
    NaN,
    PerMilleSign,
    ExponentMultiplication,
}

const SYMBOL_COUNT: usize = Symbol::ExponentMultiplication as usize + 1;

/// In the order of `Symbol`.
const DEFAULT_SYMBOLS: [&[u16]; SYMBOL_COUNT] = [
    &[0x2e],
    &[],
    &[0x2e],
    &[],
    &[0x25],
    &[0x2d],
    &[0x2b],
    &[0x7e],
    &[0x45],
    &[0x221e],
    &[0xfffd],
    &[0x2030],
    &[0xd7],
];

fn symbol_of_key(key: &[u8]) -> Option<Symbol> {
    Some(match key {
        b"decimal" => Symbol::DecimalSeparator,
        b"group" => Symbol::GroupingSeparator,
        b"currencyDecimal" => Symbol::MonetarySeparator,
        b"currencyGroup" => Symbol::MonetaryGroupingSeparator,
        b"percentSign" => Symbol::PercentSign,
        b"minusSign" => Symbol::MinusSign,
        b"plusSign" => Symbol::PlusSign,
        b"approximatelySign" => Symbol::ApproximatelySign,
        b"exponential" => Symbol::Exponential,
        b"infinity" => Symbol::Infinity,
        b"nan" => Symbol::NaN,
        b"perMille" => Symbol::PerMilleSign,
        b"superscriptingExponent" => Symbol::ExponentMultiplication,
        _ => return None,
    })
}

/// `insert_between` goes between a currency symbol and a number whose adjacent characters are in the two sets.
pub(crate) struct Spacing {
    pub(crate) currency_match: U16s<'static>,
    pub(crate) surrounding_match: U16s<'static>,
    pub(crate) insert_between: U16s<'static>,
}

impl Spacing {
    const EMPTY: Self = Self {
        currency_match: U16s::EMPTY,
        surrounding_match: U16s::EMPTY,
        insert_between: U16s::EMPTY,
    };

    const DEFAULT: Self = Self {
        currency_match: U16s::of(&utf16_bytes::<20>(b"[:letter:]")),
        surrounding_match: U16s::of(&utf16_bytes::<18>(b"[:digit:]")),
        insert_between: U16s::of(&utf16_bytes::<2>(b" ")),
    };
}

/// `N` is twice the length of `ascii`.
const fn utf16_bytes<const N: usize>(mut ascii: &[u8]) -> [u8; N] {
    let mut bytes = [0; N];
    let mut rest = bytes.as_chunks_mut().0;
    while let ([unit, units @ ..], [c, chars @ ..]) = (rest, ascii) {
        *unit = (*c as u16).to_ne_bytes();
        (rest, ascii) = (units, chars);
    }
    bytes
}

pub(crate) struct DecimalFormatSymbols {
    symbols: [SmallUString; SYMBOL_COUNT],
    digits: [u32; 10],
    locale: Locale,
    /// "latn" unless the numbering system of the locale has ten digits.
    numbering_system: Name,
    currency_pattern: Option<Vec<u16>>,
    before_currency: Spacing,
    after_currency: Spacing,
}

#[cfg_attr(mordant, allow(error_collapsed_to_bool))] // The flag stays set.
fn to_small_string(units: impl ExactSizeIterator<Item = u16>) -> SmallUString {
    let mut text = SmallUString::new();
    let _ = defer_oom(text.set_to_units(units));
    text
}

impl DecimalFormatSymbols {
    pub(crate) fn new(locale: &Locale) -> Result<Self, UErrorCode> {
        let system = NumberingSystem::create_instance_for_locale(locale)?;
        Self::new_with_numbering_system(locale, &system)
    }

    /// For a decimal format, whose currency is that of `locale`.
    pub(crate) fn new_with_numbering_system(
        locale: &Locale,
        system: &NumberingSystem,
    ) -> Result<Self, UErrorCode> {
        let mut this = Self::without_currency(locale, system)?;
        let currency = ucurr_for_locale(locale.get_name()).ok();
        this.load_currency(currency.filter(|code| !matches!(code, [0, ..] | [_, 0, _] | [.., 0])))?;
        Ok(this)
    }

    /// Fails if `locale` is bogus or has no room for one more keyword.
    pub(crate) fn new_with_currency(
        locale: &Locale,
        system: &NumberingSystem,
        currency: Option<CurrencyCode>,
    ) -> Result<Self, UErrorCode> {
        let mut locale = locale.clone();
        locale.set_keyword_value(b"currency", b"XXX")?;
        let mut this = Self::without_currency(&locale, system)?;
        // In the linked data only the patterns of currencies have a currency sign.
        if currency.is_some() || searches_files()? {
            this.load_currency(currency.or(Some(NO_CURRENCY)))?;
        } else {
            this.check_name()?;
            ures_open(Some(U_ICUDATA_CURR), locale.get_name())?;
        }
        Ok(this)
    }

    fn without_currency(locale: &Locale, system: &NumberingSystem) -> Result<Self, UErrorCode> {
        let mut this = Self {
            symbols: [const { SmallUString::new() }; SYMBOL_COUNT],
            digits: std::array::from_fn(|digit| 0x30 + digit as u32),
            locale: locale.clone(),
            numbering_system: LATN,
            currency_pattern: None,
            before_currency: Spacing::EMPTY,
            after_currency: Spacing::EMPTY,
        };
        if system.get_radix() == 10 && !system.is_algorithmic() {
            this.numbering_system = system.name;
            let digits = utf16::code_points(system.get_description());
            (this.digits.iter_mut().zip(digits)).for_each(|(digit, c)| *digit = c);
        }
        this.load_symbols()?;
        Ok(this)
    }

    fn load_symbols(&mut self) -> Result<(), UErrorCode> {
        let bundle = ures_open(None, self.locale.get_name())?;
        let system = self.numbering_system;
        let mut seen = 0u32;
        // The longer paths skip an alias without a target.
        bundle.get_by_key_with_fallback(b"NumberElements")?;
        let mut sink = |table: &ResourceValue| {
            for (key, value) in table.get_table()?.iter() {
                if let Some(symbol) = symbol_of_key(key)
                    && seen & 1 << symbol as u32 == 0
                {
                    seen |= 1 << symbol as u32;
                    self.put(symbol, to_small_string(value.get_string()?.iter()));
                }
            }
            Ok(())
        };
        if system != LATN {
            let mut path = SmallChars::new();
            for part in [b"NumberElements/", system.as_slice(), b"/symbols"] {
                path.add_all(part);
            }
            match ures_get_all_items_with_fallback(&bundle, &path, &mut sink) {
                Ok(()) | Err(U_MISSING_RESOURCE_ERROR) => {}
                Err(code) => return Err(code),
            }
        }
        ures_get_all_items_with_fallback(&bundle, b"NumberElements/latn/symbols", &mut sink)?;

        self.put_defaults(seen);
        for (monetary, standard) in [
            (Symbol::MonetarySeparator, Symbol::DecimalSeparator),
            (Symbol::MonetaryGroupingSeparator, Symbol::GroupingSeparator),
        ] {
            if seen & 1 << monetary as u32 == 0 {
                let standard = self.get_const_symbol(standard).iter().copied();
                self.put(monetary, to_small_string(standard));
            }
        }
        Ok(())
    }

    /// `seen` has a bit for each symbol that the data have.
    fn put_defaults(&mut self, seen: u32) {
        for (index, (symbol, default)) in self.symbols.iter_mut().zip(DEFAULT_SYMBOLS).enumerate() {
            if seen & 1 << index == 0 {
                *symbol = to_small_string(default.iter().copied());
            }
        }
    }

    fn check_name(&self) -> Result<(), UErrorCode> {
        ulocimp_get_name_to(self.locale.get_name(), &mut SmallChars::new())
            .or(Err(U_ILLEGAL_ARGUMENT_ERROR))
    }

    fn load_currency(&mut self, currency: Option<CurrencyCode>) -> Result<(), UErrorCode> {
        let bundle = ures_open(Some(U_ICUDATA_CURR), self.locale.get_name())?;
        if let Some(currency) = currency {
            self.check_name()?;
            self.set_currency(&bundle, currency)?;
        }
        self.load_spacing(&bundle)
    }

    /// Loads the pattern and the separators that `currency` may have.
    fn set_currency(
        &mut self,
        bundle: &UResourceBundle,
        currency: CurrencyCode,
    ) -> Result<(), UErrorCode> {
        let found = (bundle.get_by_key_with_fallback(b"Currencies"))
            .and_then(|all| all.get_by_key_with_fallback(until_nul(&currency.map(uchar_to_char))));
        if let Ok(found) = found
            && found.get_size() > 2
            && let Ok(format) = found.get_by_index(2)
            && let Ok(pattern) = ures_get_data_string_by_index(&format, 0)
        {
            let pattern = pattern.map(|pattern| pattern.until_nul().try_to_vec());
            self.currency_pattern = pattern.transpose()?;
            if let Ok(decimal) = ures_get_data_string_by_index(&format, 1)
                && let Ok(grouping) = ures_get_data_string_by_index(&format, 2)
            {
                for (symbol, text) in [
                    (Symbol::MonetarySeparator, decimal),
                    (Symbol::MonetaryGroupingSeparator, grouping),
                ] {
                    let text = text.unwrap_or(DataString::EMPTY).units();
                    self.put(symbol, to_small_string(text.iter()));
                }
            }
        }
        Ok(())
    }

    fn load_spacing(&mut self, bundle: &UResourceBundle) -> Result<(), UErrorCode> {
        let (mut has_before, mut has_after) = (false, false);
        let mut sink = |sides: &ResourceValue| {
            for (key, side) in sides.get_table()?.iter() {
                let (has, spacing) = match key {
                    b"beforeCurrency" => (&mut has_before, &mut self.before_currency),
                    b"afterCurrency" => (&mut has_after, &mut self.after_currency),
                    _ => continue,
                };
                *has = true;
                for (key, value) in side.get_table()?.iter() {
                    let pattern = match key {
                        b"currencyMatch" => &mut spacing.currency_match,
                        b"surroundingMatch" => &mut spacing.surrounding_match,
                        b"insertBetween" => &mut spacing.insert_between,
                        _ => continue,
                    };
                    if pattern.is_empty() {
                        *pattern = value.get_string()?;
                    }
                }
            }
            Ok(())
        };
        ures_get_all_items_with_fallback(bundle, b"currencySpacing", &mut sink)?;
        if !has_before || !has_after {
            (self.before_currency, self.after_currency) = (Spacing::DEFAULT, Spacing::DEFAULT);
        }
        Ok(())
    }

    fn put(&mut self, symbol: Symbol, text: SmallUString) {
        self.symbols.set(symbol as usize, text);
    }

    #[inline]
    pub(crate) fn get_const_symbol(&self, symbol: Symbol) -> &[u16] {
        self.symbols
            .get(symbol as usize)
            .map(|text| &**text)
            .soft_unwrap()
    }

    /// `digit` is below 10.
    #[inline]
    pub(crate) fn digit(&self, digit: u8) -> u32 {
        self.digits.at(digit.into())
    }

    /// Returns the digit zero if it is one code unit and the digits are consecutive code points.
    pub(crate) fn zero_of_consecutive_digits(&self) -> Option<u16> {
        let [zero, ..] = self.digits;
        let zero_unit = u16::try_from(zero).ok();
        zero_unit.filter(|_| self.digits.into_iter().eq(zero..zero + 10))
    }

    /// Returns the digit zero if the digits are ten consecutive code units.
    pub(crate) fn zero_unit(&self) -> Option<u16> {
        (self.zero_of_consecutive_digits()).filter(|&zero| zero <= u16::MAX - 9)
    }

    pub(crate) fn currency_spacing(&self, before_currency: bool) -> &Spacing {
        if before_currency {
            &self.before_currency
        } else {
            &self.after_currency
        }
    }

    pub(crate) fn get_locale(&self) -> &Locale {
        &self.locale
    }

    pub(crate) fn get_currency_pattern(&self) -> Option<&[u16]> {
        self.currency_pattern.as_deref()
    }

    pub(crate) fn get_numbering_system_name(&self) -> Name {
        self.numbering_system
    }
}
