//! The separators, signs and digits of a locale. ICU4C: dcfmtsym.cpp

use crate::common::charstr::SmallChars;
use crate::common::locid::Locale;
use crate::common::memory::{Appendable, defer_oom};
use crate::common::resource::ResourceValue;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::unistr::SmallUString;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::measunit::CurrencyCode;
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
}

const SYMBOL_COUNT: usize = Symbol::NaN as usize + 1;

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
        _ => return None,
    })
}

pub(crate) struct DecimalFormatSymbols {
    symbols: [SmallUString; SYMBOL_COUNT],
    digits: [u32; 10],
    locale: Locale,
    /// "latn" if the numbering system of the locale is algorithmic.
    numbering_system: Name,
    currency_pattern: Option<Vec<u16>>,
    /// The values of `insertBetween` in `beforeCurrency` and `afterCurrency`.
    before_currency: SmallUString,
    after_currency: SmallUString,
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

    pub(crate) fn new_with_numbering_system(
        locale: &Locale,
        system: &NumberingSystem,
    ) -> Result<Self, UErrorCode> {
        let mut this = Self {
            symbols: [const { SmallUString::new() }; SYMBOL_COUNT],
            digits: std::array::from_fn(|digit| 0x30 + digit as u32),
            locale: locale.clone(),
            numbering_system: LATN,
            currency_pattern: None,
            before_currency: SmallUString::new(),
            after_currency: SmallUString::new(),
        };
        if !system.is_algorithmic() {
            this.numbering_system = system.name;
            let digits = utf16::code_points(system.get_description());
            (this.digits.iter_mut().zip(digits)).for_each(|(digit, c)| *digit = c);
        }
        this.load_symbols()?;
        // Of some languages `--trim` removes nothing else that is read here. Opening a removed item ends the process.
        ures_open(Some(U_ICUDATA_CURR), locale.get_name())?;
        Ok(this)
    }

    fn load_symbols(&mut self) -> Result<(), UErrorCode> {
        let bundle = ures_open(None, self.locale.get_name())?;
        let system = self.numbering_system;
        let mut seen = 0u32;
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

        for (monetary, standard) in [
            (Symbol::MonetarySeparator, Symbol::DecimalSeparator),
            (Symbol::MonetaryGroupingSeparator, Symbol::GroupingSeparator),
        ] {
            if seen & 1 << monetary as u32 == 0 {
                let standard = self.get_const_symbol(standard).iter().copied();
                self.put(monetary, to_small_string(standard));
            }
        }
        if self.symbols.iter().any(|symbol| symbol.is_empty()) {
            return Err(U_MISSING_RESOURCE_ERROR);
        }
        Ok(())
    }

    /// Loads the spacing, and the pattern and separators that `currency` may have in the locale.
    pub(crate) fn set_currency(&mut self, currency: CurrencyCode) -> Result<(), UErrorCode> {
        let bundle = ures_open(Some(U_ICUDATA_CURR), self.locale.get_name())?;
        let found = (bundle.get_by_key_with_fallback(b"Currencies"))
            .and_then(|all| all.get_by_key_with_fallback(&currency.map(|c| c as u8)));
        if let Ok(found) = found
            && found.get_size() > 2
        {
            let format = found.get_by_index(2)?;
            let part = |index| {
                ures_get_data_string_by_index(&format, index)
                    .map(|part| part.unwrap_or(DataString::EMPTY).units())
            };
            self.currency_pattern = Some(part(0)?.try_to_vec()?);
            self.put(Symbol::MonetarySeparator, to_small_string(part(1)?.iter()));
            self.put(
                Symbol::MonetaryGroupingSeparator,
                to_small_string(part(2)?.iter()),
            );
        }
        self.load_spacing(&bundle)
    }

    /// Fails unless the sets of characters are those that `CurrencySpacing` tests.
    fn load_spacing(&mut self, bundle: &UResourceBundle) -> Result<(), UErrorCode> {
        let mut sink = |sides: &ResourceValue| {
            for (key, side) in sides.get_table()?.iter() {
                let insert_between = match key {
                    b"beforeCurrency" => &mut self.before_currency,
                    _ => &mut self.after_currency,
                };
                for (key, value) in side.get_table()?.iter() {
                    let value = value.get_string()?;
                    match key {
                        b"insertBetween" if insert_between.is_empty() => {
                            *insert_between = to_small_string(value.iter())
                        }
                        b"insertBetween" => {}
                        b"currencyMatch" if value.eq_bytes(b"[[:^S:]&[:^Z:]]") => {}
                        b"surroundingMatch" if value.eq_bytes(b"[:digit:]") => {}
                        _ => return Err(U_UNSUPPORTED_ERROR),
                    }
                }
            }
            Ok(())
        };
        ures_get_all_items_with_fallback(bundle, b"currencySpacing", &mut sink)
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

    /// Returns the digit zero if the digits are ten consecutive code units.
    pub(crate) fn zero_unit(&self) -> Option<u16> {
        let [zero, .., nine] = self.digits;
        (nine <= 0xffff && self.digits.into_iter().eq(zero..zero + 10)).then_some(zero as u16)
    }

    pub(crate) fn currency_spacing(&self, before_currency: bool) -> &[u16] {
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

    pub(crate) fn get_numbering_system_name(&self) -> &[u8] {
        &self.numbering_system
    }
}
