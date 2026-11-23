//! Scientific and engineering notation. ICU4C: number_scientific.cpp

use crate::common::utypes::UErrorCode;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder};
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_modifiers::Modifier;
use crate::i18n::number_rounding::{MultiplierProducer, Rounding, RoundingImpl};
use crate::i18n::unicode::unum::*;

/// Appends an exponent such as "E-5".
pub(crate) struct ScientificModifier<'a> {
    pub(crate) exponent: i32,
    handler: &'a ScientificHandler,
    symbols: &'a DecimalFormatSymbols,
}

impl Modifier for Option<ScientificModifier<'_>> {
    #[inline]
    fn apply(&self, output: &mut FormattedStringBuilder, _left: usize, right: usize) -> usize {
        (self.as_ref()).map_or(right, |modifier| modifier.insert(output, right))
    }
}

impl ScientificModifier<'_> {
    #[inline(never)]
    fn insert(&self, output: &mut FormattedStringBuilder, mut end: usize) -> usize {
        let &Self {
            exponent,
            handler,
            symbols,
        } = self;
        let mut append = |symbol, field| {
            end += output.insert(end, symbols.get_const_symbol(symbol), Field::number(field))
        };
        append(Symbol::Exponential, UNUM_EXPONENT_SYMBOL_FIELD);
        if exponent < 0 {
            append(Symbol::MinusSign, UNUM_EXPONENT_SIGN_FIELD);
        } else if handler.always_shows_sign {
            append(Symbol::PlusSign, UNUM_EXPONENT_SIGN_FIELD);
        }
        let (start, mut rest, mut count) = (end, exponent.unsigned_abs(), 0);
        while count < handler.min_exponent_digits || rest > 0 {
            let digit = symbols.digit((rest % 10) as u8);
            end += output.insert_code_point(start, digit, Field::number(UNUM_EXPONENT_FIELD));
            rest /= 10;
            count += 1;
        }
        end
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ScientificHandler {
    /// The exponent is a multiple of this, or with `require_min_int` this is the number of integer digits.
    pub(crate) engineering_interval: i8,
    pub(crate) require_min_int: bool,
    pub(crate) min_exponent_digits: i16,
    pub(crate) always_shows_sign: bool,
}

impl MultiplierProducer for ScientificHandler {
    fn get_multiplier(&self, magnitude: i32) -> i32 {
        let interval = i32::from(self.engineering_interval);
        match interval {
            // "000.00E0", ".00E0"
            _ if self.require_min_int => interval - 1,
            ..=1 => 0,
            // Perf: a constant divisor.
            3 => magnitude.rem_euclid(3),
            _ => magnitude.rem_euclid(interval),
        }
        .wrapping_sub(magnitude)
    }
}

impl ScientificHandler {
    pub(crate) fn with_interval(engineering_interval: i8) -> Self {
        Self {
            engineering_interval,
            require_min_int: false,
            min_exponent_digits: 1,
            always_shows_sign: false,
        }
    }

    /// Chooses the exponent and rounds. Infinity and NaN have no exponent.
    pub(crate) fn process_quantity<'a>(
        &'a self,
        quantity: &mut DecimalQuantity,
        rounder: &mut RoundingImpl,
        symbols: &'a DecimalFormatSymbols,
    ) -> Result<Option<ScientificModifier<'a>>, UErrorCode> {
        if quantity.is_infinite() || quantity.is_nan() {
            return Ok(None);
        }
        let multiplier = if !quantity.is_zeroish() {
            rounder.choose_multiplier_and_apply(quantity, self)
        } else if self.require_min_int
            && let Some(Rounding::Significant(digits)) = rounder.rounding
        {
            // Zero is "00.000E0" for the pattern "00.000E0".
            quantity.set_min_fraction(i32::from(digits.min) - i32::from(self.engineering_interval));
            Ok(0)
        } else {
            rounder.apply(quantity).map(|()| 0)
        }?;
        let exponent = multiplier.wrapping_neg();
        quantity.adjust_exponent(exponent);
        rounder.rounding = None;
        Ok(Some(ScientificModifier {
            exponent,
            handler: self,
            symbols,
        }))
    }
}
