//! Formats the integers of dates, without grouping. ICU4C: number_simple.cpp

use crate::common::locid::Locale;
use crate::common::utypes::*;
use crate::i18n::dcfmtsym::DecimalFormatSymbols;
use crate::i18n::formatted_string_builder::{FormattedStringBuilder, UNDEFINED_FIELD};
use crate::i18n::measunit::NO_CURRENCY;
use crate::i18n::number_decimalquantity::{DecimalQuantity, Signum};
use crate::i18n::number_fluent::{SignDisplay, UnitWidth};
use crate::i18n::number_formatimpl::NumberWriter;
use crate::i18n::number_grouping::Grouper;
use crate::i18n::number_modifiers::{AdoptingSignumModifierStore, Modifier};
use crate::i18n::number_patternmodifier::PatternModifier;
use crate::i18n::number_patternstring::ParsedPatternInfo;
use crate::i18n::standardplural::PluralForm;
use std::sync::Arc;

pub(crate) struct SimpleNumberFormatter {
    writer: NumberWriter,
    modifiers: AdoptingSignumModifierStore,
}

impl SimpleNumberFormatter {
    pub(crate) fn new(
        locale: &Locale,
        symbols: Arc<DecimalFormatSymbols>,
    ) -> Result<Self, UErrorCode> {
        let ns_name = symbols.get_numbering_system_name();
        let pattern = ParsedPatternInfo::load(locale, &ns_name, b"decimalFormat")?;
        let grouping = Grouper::OFF.resolve(pattern.groupings, locale);
        let modifier = PatternModifier {
            sign_display: SignDisplay::ExceptZero,
            approximately: false,
            per_mille_replaces_percent: false,
            symbols,
            currency: NO_CURRENCY,
            unit_width: UnitWidth::Short,
            rules: None,
        };
        let pattern = (&pattern, UNDEFINED_FIELD);
        Ok(Self {
            modifiers: modifier.create_immutable_for_plural(pattern, PluralForm::Other)?,
            writer: NumberWriter {
                grouping,
                is_currency: false,
                always_shows_decimal: false,
                currency_as_decimal: None,
                symbols: modifier.symbols,
            },
        })
    }

    /// Returns whether a number that is not negative consists of its digits alone.
    pub(crate) fn has_bare_digits(&self) -> bool {
        let modifier = self.modifiers.get(Signum::PosZero);
        modifier.code_point_count() == 0 && !modifier.overwrite
    }

    /// Writes the last `max_digits` digits of `value`, padded to `min_digits`, to `string`, which must be empty.
    pub(crate) fn write(
        &self,
        value: i32,
        min_digits: i32,
        max_digits: i32,
        string: &mut FormattedStringBuilder,
    ) -> Result<(), UErrorCode> {
        let (digits, limit) = (value.unsigned_abs(), 10u32.checked_pow(max_digits as u32));
        let kept = limit.and_then(|limit| digits.checked_rem(limit));
        let mut quantity = DecimalQuantity::from_integer(kept.unwrap_or(digits).into());
        quantity.increase_min_integer_to(min_digits.min(max_digits));
        let length = self.writer.write(&quantity, string, 0)?;
        let signum = if value < 0 {
            Signum::Neg
        } else {
            Signum::PosZero
        };
        self.modifiers.get(signum).apply(string, 0, length);
        string.outcome()
    }
}
