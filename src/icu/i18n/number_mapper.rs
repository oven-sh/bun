//! Maps the properties of a decimal format to the settings of a number formatter. ICU4C: number_mapper.cpp

use crate::common::locid::Locale;
use crate::common::memory::try_box;
use crate::common::ucurr::{ucurr_for_locale, ucurr_get_default_fraction_digits};
use crate::common::uinvchar::uprv_is_invariant_ustring;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::measunit::{CurrencyCode, MeasureUnit, NO_CURRENCY};
use crate::i18n::number_decimfmtprops::DecimalFormatProperties;
use crate::i18n::number_fluent::{Layout, MacroProps, Notation, PatternProps};
use crate::i18n::number_grouping::Grouper;
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::{Digits, MAX_INT_FRAC_SIG, Rounding};
use crate::i18n::number_scientific::ScientificHandler;
use std::sync::Arc;

// ICU4C: number_currencysymbols.cpp, resolveCurrency
fn resolve_currency(locale: &Locale) -> Result<CurrencyCode, UErrorCode> {
    match ucurr_for_locale(locale.get_name()) {
        Err(_) | Ok([0, ..]) => Ok(NO_CURRENCY),
        Ok([_, 0, _] | [_, _, 0]) => Err(U_ILLEGAL_ARGUMENT_ERROR),
        Ok(code) if !uprv_is_invariant_ustring(code) => Err(U_ILLEGAL_ARGUMENT_ERROR),
        Ok(code) => Ok(code.map(|unit| (unit as u8).to_ascii_uppercase().into())),
    }
}

// ICU4C: number_grouping.cpp, Grouper::forProperties
fn grouper_for_properties(properties: &DecimalFormatProperties) -> Grouper {
    if !properties.grouping_used {
        return Grouper::OFF;
    }
    let grouping1 = properties.grouping_size as i16;
    let grouping2 = properties.secondary_grouping_size as i16;
    let grouping1 = if grouping1 > 0 || grouping2 <= 0 {
        grouping1
    } else {
        grouping2
    };
    // This size means that none is set.
    if grouping1 == -3 {
        return Grouper::AUTO;
    }
    Grouper {
        grouping1,
        grouping2: if grouping2 > 0 { grouping2 } else { grouping1 },
        min_grouping: properties.minimum_grouping_digits as i16,
    }
}

/// Returns whether a positive increment is too small to matter with `max_frac` fraction digits.
fn ignores_rounding_increment(increment: f64, max_frac: i32) -> bool {
    let mut scaled = increment * 2.0;
    max_frac >= 0
        && (0..=max_frac).all(|_| {
            let is_small = scaled <= 1.0;
            scaled *= 10.0;
            is_small
        })
}

/// Uses the counts of digits as they were set, not as `old_to_new` adjusts them.
fn scientific_rounding(properties: &DecimalFormatProperties) -> Rounding {
    let min_int = properties.minimum_integer_digits;
    let min_frac = properties.minimum_fraction_digits;
    let max_frac = properties.maximum_fraction_digits;
    if min_int == 0 && max_frac == 0 {
        // "#E0", "##E0"
        Rounding::Unlimited
    } else if min_int == 0 && min_frac == 0 {
        // "#.##E0"
        Rounding::Significant(Digits::new(1, max_frac.wrapping_add(1)))
    } else {
        let max_sig = min_int.wrapping_add(max_frac);
        let min_int = if properties.maximum_integer_digits > min_int {
            min_int.min(1)
        } else {
            min_int
        };
        Rounding::Significant(Digits::new(min_int.wrapping_add(min_frac), max_sig))
    }
}

/// Fills in the digits of the currency. No setter leaves a maximum without a minimum.
#[cold]
fn apply_currency(
    currency: CurrencyCode,
    (min_frac, max_frac): (&mut i32, &mut i32),
) -> Result<(), UErrorCode> {
    if *max_frac != -1 {
        return Ok(());
    }
    let found = ucurr_get_default_fraction_digits(&currency);
    let digits = found.unwrap_or(2);
    if *min_frac == -1 {
        *min_frac = digits;
    }
    *max_frac = digits.max(*min_frac);
    found.map(drop)
}

/// Also returns whether the lookups for the currency succeeded. The settings are usable after a failure.
pub(crate) fn old_to_new(
    affixes: ParsedPatternInfo,
    properties: &DecimalFormatProperties,
    symbols: &Arc<DecimalFormatSymbols>,
) -> Result<(MacroProps, Result<(), UErrorCode>), UErrorCode> {
    let mut macros = MacroProps::new(symbols.get_locale().clone());
    macros.symbols = Some(Arc::clone(symbols));
    macros.grouper = grouper_for_properties(properties);
    macros.scale = properties.magnitude_multiplier;

    let mut max_int = properties.maximum_integer_digits;
    let mut min_int = properties.minimum_integer_digits;
    let mut max_frac = properties.maximum_fraction_digits;
    let mut min_frac = properties.minimum_fraction_digits;
    let min_sig = properties.minimum_significant_digits;
    let max_sig = properties.maximum_significant_digits;
    let increment = properties.rounding_increment;
    let explicit_min_max_frac = min_frac != -1 || max_frac != -1;
    let (mut currency, mut currency_status) = (None, Ok(()));
    if affixes.has_currency_sign {
        let resolved = resolve_currency(symbols.get_locale());
        let code = *currency.insert(resolved.unwrap_or(NO_CURRENCY));
        currency_status =
            apply_currency(code, (&mut min_frac, &mut max_frac)).and_then(|()| resolved.map(drop));
        macros.unit = MeasureUnit::Currency(code);
    }
    // The minimum overrides the maximum if the two conflict.
    if min_int == 0 && max_frac != 0 {
        if min_frac < 0 || (min_frac == 0 && max_int == 0) {
            min_frac = 1;
        }
    } else {
        min_frac = min_frac.max(0);
        min_int = if min_int > MAX_INT_FRAC_SIG {
            1
        } else {
            min_int.max(1)
        };
    }
    max_frac = if max_frac < 0 {
        -1
    } else {
        max_frac.max(min_frac)
    };
    max_int = if (0..=MAX_INT_FRAC_SIG).contains(&max_int) {
        max_int.max(min_int)
    } else {
        -1
    };

    let (mut status, mut rounds_fraction) = (Ok(()), false);
    if increment != 0.0 && !ignores_rounding_increment(increment, max_frac) {
        let rounding = Rounding::increment(increment, min_frac);
        (macros.rounder.rounding, status) = (rounding.ok(), rounding.map(drop));
    } else if increment == 0.0 && min_sig != -1 {
        let min_sig = min_sig.min(MAX_INT_FRAC_SIG);
        let digits = Digits::new(min_sig, max_sig.min(MAX_INT_FRAC_SIG));
        macros.rounder.rounding = Some(Rounding::Significant(digits));
    } else if explicit_min_max_frac {
        macros.rounder.rounding = Some(Rounding::Fraction(Digits::new(min_frac, max_frac)));
        rounds_fraction = true;
    } else if let Some(currency) = currency {
        macros.rounder.rounding = None;
        currency_status = Rounding::for_currency(currency)
            .map(drop)
            .and(currency_status);
    }

    if properties.minimum_exponent_digits != -1 {
        if max_int > 8 {
            max_int = min_int;
        } else if max_int > min_int && min_int > 1 {
            min_int = 1;
        }
        macros.notation = Notation::Scientific(ScientificHandler {
            engineering_interval: max_int as i8,
            require_min_int: max_int == min_int,
            min_exponent_digits: properties.minimum_exponent_digits as i16,
            always_shows_sign: properties.exponent_sign_always_shown,
        });
        if rounds_fraction {
            macros.rounder.rounding = Some(scientific_rounding(properties));
        }
    }
    macros.min_integer_digits = min_int;
    macros.from_pattern = Some(try_box(PatternProps {
        affixes,
        layout: Layout {
            max_integer_digits: max_int,
            always_shows_decimal: properties.decimal_separator_always_shown,
            padder: properties.padder,
        },
        status,
    })?);
    Ok((macros, currency_status))
}
