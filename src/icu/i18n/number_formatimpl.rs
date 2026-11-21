//! The formatter for one set of settings and one locale. ICU4C: number_formatimpl.cpp

use crate::common::charstr::SmallChars;
use crate::common::locid::Locale;
use crate::common::memory::{try_box_result, try_shared, try_to_vec};
use crate::common::uloc::ulocimp_get_name_to;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::measunit::MeasureUnit;
use crate::i18n::number_compact::CompactHandler;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::{MacroProps, Notation, UFormattedNumberData, UnitWidth};
use crate::i18n::number_grouping::Grouping;
use crate::i18n::number_longnames::LongNameHandler;
use crate::i18n::number_modifiers::{
    AdoptingSignumModifierStore, MiddleModifier, Modifier, OuterModifier,
};
use crate::i18n::number_patternmodifier::PatternModifier;
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::RoundingImpl;
use crate::i18n::number_scientific::{ScientificHandler, ScientificModifier};
use crate::i18n::numsys::NumberingSystem;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::unicode::unum::*;
use std::sync::Arc;

const MAX_FORMATTED_DIGITS: i32 = 999999;

fn checked_digit_count(count: i64) -> Result<i32, UErrorCode> {
    i32::try_from(count)
        .ok()
        .filter(|&count| count <= MAX_FORMATTED_DIGITS)
        .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum BuildMode {
    /// Builds only the modifier that the number needs.
    OneShot,
    Reusable,
    /// Adds the approximately sign: "~5".
    ReusableApproximately,
}

/// The modifiers for one number, in the order in which they are applied.
pub(crate) struct Modifiers<'a> {
    pub(crate) inner: Option<ScientificModifier<'a>>,
    pub(crate) middle: MiddleModifier<'a>,
    pub(crate) outer: Option<OuterModifier<'a>>,
}

pub(crate) struct NumberWriter {
    pub(crate) grouping: Option<Grouping>,
    pub(crate) is_currency: bool,
    pub(crate) symbols: Arc<DecimalFormatSymbols>,
}

pub(crate) struct NumberFormatterImpl {
    pub(crate) writer: NumberWriter,
    scale: i32,
    rounder: RoundingImpl,
    min_integer_digits: i32,
    scientific: Option<ScientificHandler>,
    long_names: Option<Box<LongNameHandler>>,
    compact: Option<Box<CompactHandler>>,
    pattern: ParsedPatternInfo,
    pattern_modifier: PatternModifier,
    /// `None` for `BuildMode::OneShot`.
    immutable: Option<AdoptingSignumModifierStore>,
}

/// Fails if `locale` is bogus or has no room for one more keyword.
fn load_symbols(locale: &Locale, unit: MeasureUnit) -> Result<DecimalFormatSymbols, UErrorCode> {
    let system = NumberingSystem::create_instance_for_locale(locale)?;
    let mut with_currency = locale.clone();
    with_currency.set_keyword_value(b"currency", b"XXX")?;
    let mut symbols = DecimalFormatSymbols::new_with_numbering_system(&with_currency, &system)?;
    ulocimp_get_name_to(with_currency.get_name(), &mut SmallChars::new())
        .or(Err(U_ILLEGAL_ARGUMENT_ERROR))?;
    if let MeasureUnit::Currency(currency) = unit {
        symbols.set_currency(currency)?;
    }
    Ok(symbols)
}

impl NumberFormatterImpl {
    // ICU4C: number_formatimpl.cpp, NumberFormatterImpl::macrosToMicroGenerator
    pub(crate) fn new(macros: &MacroProps, mode: BuildMode) -> Result<Self, UErrorCode> {
        let (locale, unit, unit_width) = (&macros.locale, macros.unit, macros.unit_width);
        let is_full_name = unit_width == UnitWidth::FullName;
        let is_compact = matches!(macros.notation, Notation::Compact { .. });
        let uses_percent_pattern = unit == MeasureUnit::PERCENT && !is_full_name && !is_compact;
        let currency = match unit {
            MeasureUnit::Currency(currency) => Some((currency, unit_width)),
            _ => None,
        };
        let has_currency_symbol = currency.is_some() && !is_full_name;

        let symbols = match &macros.symbols {
            Some(symbols) => Arc::clone(symbols),
            None => try_shared(load_symbols(locale, unit)?)?,
        };
        let ns_name = symbols.get_numbering_system_name();
        let own_pattern = (symbols.get_currency_pattern())
            .filter(|_| has_currency_symbol)
            .or(macros.pattern.as_deref());
        let pattern = match own_pattern {
            Some(pattern) => ParsedPatternInfo::parse(try_to_vec(pattern)?),
            None if uses_percent_pattern => {
                ParsedPatternInfo::load(locale, ns_name, b"percentFormat")
            }
            None if !has_currency_symbol => {
                ParsedPatternInfo::load(locale, ns_name, b"decimalFormat")
            }
            None if macros.is_accounting => {
                ParsedPatternInfo::load(locale, ns_name, b"accountingFormat")
            }
            None => ParsedPatternInfo::load(locale, ns_name, b"currencyFormat"),
        }?;

        let pattern_modifier = PatternModifier {
            sign_display: macros.sign,
            approximately: mode == BuildMode::ReusableApproximately,
            symbols: Arc::clone(&symbols),
            currency,
        };
        let mut immutable = None;
        if mode != BuildMode::OneShot {
            immutable = Some(pattern_modifier.create_immutable((&pattern, UNDEFINED_FIELD))?);
        }

        let mut long_names = None;
        if unit != MeasureUnit::None && !has_currency_symbol && !uses_percent_pattern {
            let mut handler = LongNameHandler::new(locale, unit, unit_width);
            long_names = Some(try_box_result(&mut handler)?);
        }

        let (mut scientific, mut compact) = (None, None);
        match macros.notation {
            Notation::Simple => {}
            Notation::Scientific(handler) => scientific = Some(handler),
            Notation::Compact { is_long } => {
                let rules = PluralRules::cardinal(locale)?;
                let mut handler =
                    CompactHandler::new(locale, ns_name, is_long, has_currency_symbol, rules);
                let mut handler: Box<CompactHandler> = try_box_result(&mut handler)?;
                if mode != BuildMode::OneShot {
                    handler.precompute_all_modifiers(&pattern_modifier)?;
                }
                compact = Some(handler);
            }
        }

        Ok(Self {
            writer: NumberWriter {
                grouping: macros.grouper.resolve(&pattern, locale),
                is_currency: currency.is_some(),
                symbols,
            },
            scale: macros.scale,
            rounder: macros.rounder,
            min_integer_digits: macros.min_integer_digits,
            scientific,
            long_names,
            compact,
            pattern,
            pattern_modifier,
            immutable,
        })
    }

    /// Formats `results.quantity`, modifying it, into the string of `results`, which must be empty.
    pub(crate) fn format(&self, results: &mut UFormattedNumberData) -> Result<(), UErrorCode> {
        self.format_to(&mut results.quantity, results.base.get_string_ref())
    }

    pub(crate) fn format_to(
        &self,
        quantity: &mut DecimalQuantity,
        string: &mut FormattedStringBuilder,
    ) -> Result<(), UErrorCode> {
        let modifiers = self.pre_process(quantity)?;
        let end = self.writer.write(quantity, string, 0)?;
        let end = modifiers.inner.apply(string, 0, end);
        let end = modifiers.middle.apply(string, 0, end);
        modifiers.outer.apply(string, 0, end);
        Ok(())
    }

    /// Scales and rounds `quantity`, and selects its modifiers.
    pub(crate) fn pre_process(
        &self,
        quantity: &mut DecimalQuantity,
    ) -> Result<Modifiers<'_>, UErrorCode> {
        let (mut rounder, mut inner, mut middle, mut outer) = (self.rounder, None, None, None);
        quantity.adjust_magnitude(self.scale);
        if let Some(scientific) = self.scientific {
            inner = scientific.process_quantity(quantity, &mut rounder, &self.writer.symbols)?;
        }
        // The name of the unit is selected before compact notation scales the number.
        if let Some(long_names) = &self.long_names {
            outer = Some(long_names.modifier_for(quantity, &rounder)?);
        }
        if let Some(compact) = &self.compact {
            middle = compact.process_quantity(quantity, &mut rounder, &self.pattern_modifier)?;
        }
        rounder.apply(quantity)?;
        let middle = match (middle, &self.immutable) {
            (Some(middle), _) => middle,
            (None, Some(immutable)) => MiddleModifier::Borrowed(immutable.get(quantity.signum())),
            (None, None) => (self.pattern_modifier)
                .create_one_shot((&self.pattern, UNDEFINED_FIELD), quantity.signum())?,
        };
        quantity.increase_min_integer_to(self.min_integer_digits);
        Ok(Modifiers {
            inner,
            middle,
            outer,
        })
    }
}

impl NumberWriter {
    /// Inserts the number without affixes at `index` of `string`. Returns the number of code units added.
    pub(crate) fn write(
        &self,
        quantity: &DecimalQuantity,
        string: &mut FormattedStringBuilder,
        index: usize,
    ) -> Result<usize, UErrorCode> {
        let symbols = &*self.symbols;
        if quantity.is_infinite() || quantity.is_nan() {
            let symbol = if quantity.is_infinite() {
                Symbol::Infinity
            } else {
                Symbol::NaN
            };
            return Ok(string.insert(
                index,
                symbols.get_const_symbol(symbol),
                Field::number(UNUM_INTEGER_FIELD),
            ));
        }
        let integer_count =
            checked_digit_count(i64::from(quantity.get_upper_display_magnitude()) + 1)?;
        let fraction_count =
            checked_digit_count(-i64::from(quantity.get_lower_display_magnitude()))?;

        let mut end = index + self.write_integer_digits(quantity, integer_count, string, index);
        if fraction_count > 0 {
            let separator = symbols.get_const_symbol(if self.is_currency {
                Symbol::MonetarySeparator
            } else {
                Symbol::DecimalSeparator
            });
            end += string.insert(end, separator, Field::number(UNUM_DECIMAL_SEPARATOR_FIELD));
        }
        for magnitude in (-fraction_count..0).rev() {
            let digit = symbols.digit(quantity.get_digit(magnitude));
            end += string.insert_code_point(end, digit, Field::number(UNUM_FRACTION_FIELD));
        }
        Ok(end - index)
    }

    /// Inserts the digits at `index`, least significant first. Returns the number of code units added.
    fn write_integer_digits(
        &self,
        quantity: &DecimalQuantity,
        count: i32,
        string: &mut FormattedStringBuilder,
        index: usize,
    ) -> usize {
        let separator = self.symbols.get_const_symbol(if self.is_currency {
            Symbol::MonetaryGroupingSeparator
        } else {
            Symbol::GroupingSeparator
        });
        let mut length = 0;
        for magnitude in 0..count {
            if let Some(grouping) = &self.grouping
                && grouping.group_at_position(magnitude, count)
            {
                let field = Field::number(UNUM_GROUPING_SEPARATOR_FIELD);
                length += string.insert(index, separator, field);
            }
            let digit = self.symbols.digit(quantity.get_digit(magnitude));
            length += string.insert_code_point(index, digit, Field::number(UNUM_INTEGER_FIELD));
        }
        length
    }
}
