//! The formatter for one set of settings and one locale. ICU4C: number_formatimpl.cpp

use crate::common::memory::{TryClone, try_box, try_box_result, try_shared, try_to_vec};
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::measunit::{MeasureUnit, NO_CURRENCY};
use crate::i18n::number_compact::CompactHandler;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_fluent::{
    Layout, MacroProps, Notation, PatternProps, UFormattedNumberData, UnitWidth,
};
use crate::i18n::number_grouping::Grouping;
use crate::i18n::number_longnames::{LongNameHandler, MixedUnitLongNameHandler, MixedValue};
use crate::i18n::number_modifiers::{MiddleModifier, Modifier, OuterModifier};
use crate::i18n::number_padding::Padder;
use crate::i18n::number_patternmodifier::{ImmutablePatternModifier, PatternModifier};
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::number_rounding::{Rounding, RoundingImpl};
use crate::i18n::number_scientific::{ScientificHandler, ScientificModifier};
use crate::i18n::numsys::{Name, NumberingSystem};
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
    pub(crate) always_shows_decimal: bool,
    pub(crate) currency_as_decimal: Option<Vec<u16>>,
    pub(crate) symbols: Arc<DecimalFormatSymbols>,
}

pub(crate) struct NumberFormatterImpl {
    pub(crate) writer: NumberWriter,
    /// The numbering system whose patterns apply.
    pub(crate) ns_name: Name,
    scale: i32,
    rounder: RoundingImpl,
    min_integer_digits: i32,
    scientific: Option<ScientificHandler>,
    long_names: Option<Box<LongNameHandler>>,
    compact: Option<Box<CompactHandler>>,
    pattern: ParsedPatternInfo,
    pattern_modifier: PatternModifier,
    /// `None` for `BuildMode::OneShot`.
    immutable: Option<ImmutablePatternModifier>,
    rare: Option<Box<RareSettings>>,
}

/// What neither the linked data nor a range needs.
struct RareSettings {
    /// -1 if there is no maximum.
    max_integer_digits: i32,
    padder: Option<Padder>,
    mixed_names: Option<MixedUnitLongNameHandler>,
}

/// Also returns the name of the numbering system whose patterns apply.
fn load_symbols(macros: &MacroProps) -> Result<(Arc<DecimalFormatSymbols>, Name), UErrorCode> {
    let system = NumberingSystem::create_instance_for_locale(&macros.locale)?;
    let symbols = match &macros.symbols {
        Some(symbols) => Arc::clone(symbols),
        None => try_shared(DecimalFormatSymbols::new_with_currency(
            &macros.locale,
            &system,
            macros.unit.currency(),
        )?)?,
    };
    Ok((symbols, system.name))
}

impl RareSettings {
    #[cold]
    fn new(macros: &MacroProps, layout: &Layout) -> Result<Box<Self>, UErrorCode> {
        let load = |unit| MixedUnitLongNameHandler::new(&macros.locale, unit, macros.unit_width);
        try_box(Self {
            max_integer_digits: layout.max_integer_digits,
            padder: layout.padder,
            mixed_names: macros.unit.as_mixed().map(load).transpose()?,
        })
    }
}

impl NumberFormatterImpl {
    // ICU4C: number_formatimpl.cpp, NumberFormatterImpl::macrosToMicroGenerator
    pub(crate) fn new(macros: &MacroProps, mode: BuildMode) -> Result<Self, UErrorCode> {
        let (locale, unit, unit_width) = (&macros.locale, &macros.unit, macros.unit_width);
        let is_full_name = unit_width == UnitWidth::FullName;
        let is_compact = matches!(macros.notation, Notation::Compact { .. });
        let is_permille = unit.is_permille();
        let uses_percent_pattern =
            (is_permille || unit.is_percent()) && !is_full_name && !is_compact;
        let currency = unit.currency();
        let has_currency_symbol = currency.is_some() && !is_full_name;

        let (symbols, ns_name) = load_symbols(macros)?;
        let pattern_of_locale = || {
            let key: &[u8] = match symbols.get_currency_pattern() {
                Some(pattern) if has_currency_symbol => {
                    return ParsedPatternInfo::parse(try_to_vec(pattern)?);
                }
                _ if uses_percent_pattern => b"percentFormat",
                _ if !has_currency_symbol => b"decimalFormat",
                _ if macros.is_accounting => b"accountingFormat",
                _ => b"currencyFormat",
            };
            ParsedPatternInfo::load(locale, &ns_name, key)
        };
        let pattern = match macros.from_pattern.as_deref() {
            None => pattern_of_locale(),
            Some(PatternProps {
                affixes, status, ..
            }) => status.and_then(|()| affixes.try_clone()),
        }?;
        let (mut groupings, mut layout) = (pattern.groupings, &Layout::DEFAULT);
        if let Some(from_pattern) = &macros.from_pattern {
            layout = &from_pattern.layout;
            groupings = pattern_of_locale()?.groupings;
        }

        let mut rounder = macros.rounder;
        if let (None, Some(currency)) = (rounder.rounding, currency) {
            rounder.rounding = Some(Rounding::for_currency(currency)?);
        }
        let grouping = macros.grouper.resolve(groupings, locale);

        let mut pattern_modifier = PatternModifier {
            sign_display: macros.sign,
            approximately: mode == BuildMode::ReusableApproximately,
            per_mille_replaces_percent: is_permille,
            symbols: Arc::clone(&symbols),
            currency: currency.unwrap_or(NO_CURRENCY),
            unit_width,
            rules: None,
        };
        if pattern.needs_plurals {
            pattern_modifier.rules = Some(try_box(PluralRules::cardinal(locale)?)?);
        }
        let mut immutable = None;
        if mode != BuildMode::OneShot {
            immutable = Some(pattern_modifier.create_immutable((&pattern, UNDEFINED_FIELD))?);
        }
        let mut currency_as_decimal = None;
        if pattern.currency_as_decimal {
            currency_as_decimal = Some(pattern_modifier.currency_symbol()?);
        }

        let (mut long_names, mut rare) = (None, None);
        let mixed = unit.as_mixed();
        if mixed.is_some() || layout.max_integer_digits != -1 || layout.padder.is_some() {
            rare = Some(RareSettings::new(macros, layout)?);
        }
        if mixed.is_none()
            && !matches!(unit, MeasureUnit::None)
            && !has_currency_symbol
            && !uses_percent_pattern
        {
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
                    CompactHandler::new(locale, &ns_name, is_long, has_currency_symbol, rules);
                let mut handler: Box<CompactHandler> = try_box_result(&mut handler)?;
                if mode != BuildMode::OneShot {
                    handler.precompute_all_modifiers(&pattern_modifier)?;
                }
                compact = Some(handler);
            }
        }

        Ok(Self {
            writer: NumberWriter {
                grouping,
                is_currency: currency.is_some(),
                always_shows_decimal: layout.always_shows_decimal,
                currency_as_decimal,
                symbols,
            },
            ns_name,
            scale: macros.scale,
            rounder,
            min_integer_digits: macros.min_integer_digits,
            scientific,
            long_names,
            compact,
            pattern,
            pattern_modifier,
            immutable,
            rare,
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
        if let Some(rare) = &self.rare {
            return self.format_rare(rare, quantity, string);
        }
        let modifiers = self.pre_process(quantity, None)?;
        let end = self.writer.write(quantity, string, 0)?;
        let end = modifiers.inner.apply(string, 0, end);
        let end = modifiers.middle.apply(string, 0, end);
        modifiers.outer.apply(string, 0, end);
        Ok(())
    }

    #[cold]
    fn format_rare(
        &self,
        rare: &RareSettings,
        quantity: &mut DecimalQuantity,
        string: &mut FormattedStringBuilder,
    ) -> Result<(), UErrorCode> {
        let mixed = (rare.mixed_names.as_ref()).map(|names| names.convert(quantity, &self.rounder));
        let mut mixed = mixed.transpose()?;
        let modifiers = self.pre_process(quantity, mixed.as_mut())?;
        if rare.max_integer_digits != -1 {
            quantity.apply_max_integer(rare.max_integer_digits);
        }
        let end = self.writer.write(quantity, string, 0)?;
        let end = modifiers.inner.apply(string, 0, end);
        if let Some(padder) = &rare.padder {
            padder.pad_and_apply(&modifiers.middle, string, end);
            return Ok(());
        }
        let end = modifiers.middle.apply(string, 0, end);
        if let Some(outer) = mixed.and_then(|mixed| mixed.modifier) {
            outer.apply(string, 0, end);
        }
        Ok(())
    }

    /// Scales and rounds `quantity`, and selects its modifiers.
    pub(crate) fn pre_process(
        &self,
        quantity: &mut DecimalQuantity,
        mixed: Option<&mut MixedValue>,
    ) -> Result<Modifiers<'_>, UErrorCode> {
        let (mut rounder, mut inner, mut middle, mut outer) = (self.rounder, None, None, None);
        quantity.adjust_magnitude(self.scale);
        if let Some(scientific) = &self.scientific {
            inner = scientific.process_quantity(quantity, &mut rounder, &self.writer.symbols)?;
        }
        // The name of the unit is selected before compact notation scales the number.
        if let Some(long_names) = &self.long_names {
            outer = Some(long_names.modifier_for(quantity, &rounder)?);
        } else if let Some(mixed) = mixed {
            mixed.select_names(quantity, &rounder)?;
        }
        if let Some(compact) = &self.compact {
            middle = compact.process_quantity(quantity, &mut rounder, &self.pattern_modifier)?;
        }
        rounder.apply(quantity)?;
        let middle = match (middle, &self.immutable) {
            (Some(middle), _) => middle,
            (None, Some(immutable)) => {
                immutable.modifier_for_quantity(&self.pattern_modifier, &rounder, quantity)?
            }
            (None, None) => self.pattern_modifier.create_one_shot(
                (&self.pattern, UNDEFINED_FIELD),
                quantity.signum(),
                self.pattern_modifier.plural_form(&rounder, quantity)?,
            )?,
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
        if fraction_count > 0 || self.always_shows_decimal {
            let symbol = if self.is_currency {
                Symbol::MonetarySeparator
            } else {
                Symbol::DecimalSeparator
            };
            let (separator, field) = match &self.currency_as_decimal {
                Some(currency) => (currency.as_slice(), UNUM_CURRENCY_FIELD),
                None => (
                    symbols.get_const_symbol(symbol),
                    UNUM_DECIMAL_SEPARATOR_FIELD,
                ),
            };
            end += string.insert(end, separator, Field::number(field));
        }
        for magnitude in (-fraction_count..0).rev() {
            let digit = symbols.digit(quantity.get_digit(magnitude));
            end += string.insert_code_point(end, digit, Field::number(UNUM_FRACTION_FIELD));
        }
        if end == index {
            let field = Field::number(UNUM_INTEGER_FIELD);
            end += string.insert_code_point(index, symbols.digit(0), field);
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
