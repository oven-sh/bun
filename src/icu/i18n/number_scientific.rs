//! Scientific and engineering notation. ICU4C: number_scientific.cpp

use crate::common::utypes::UErrorCode;
use crate::i18n::dcfmtsym::{DecimalFormatSymbols, Symbol};
use crate::i18n::formatted_string_builder::{Field, FormattedStringBuilder};
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_modifiers::Modifier;
use crate::i18n::number_rounding::{MultiplierProducer, RoundingImpl};
use crate::i18n::unicode::unum::*;

/// Appends an exponent such as "E-5".
pub(crate) struct ScientificModifier<'a> {
    pub(crate) exponent: i32,
    symbols: &'a DecimalFormatSymbols,
}

impl Modifier for Option<ScientificModifier<'_>> {
    fn apply(&self, output: &mut FormattedStringBuilder, _left: usize, right: usize) -> usize {
        let &Some(ScientificModifier { exponent, symbols }) = self else {
            return right;
        };
        let mut end = right;
        let mut append = |symbol, field| {
            end += output.insert(end, symbols.get_const_symbol(symbol), Field::number(field))
        };
        append(Symbol::Exponential, UNUM_EXPONENT_SYMBOL_FIELD);
        if exponent < 0 {
            append(Symbol::MinusSign, UNUM_EXPONENT_SIGN_FIELD);
        }
        let (start, mut rest) = (end, exponent.unsigned_abs());
        loop {
            let digit = symbols.digit((rest % 10) as u8);
            end += output.insert_code_point(start, digit, Field::number(UNUM_EXPONENT_FIELD));
            rest /= 10;
            if rest == 0 {
                return end;
            }
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum ScientificHandler {
    Scientific,
    /// The exponent is a multiple of 3.
    Engineering,
}

impl MultiplierProducer for ScientificHandler {
    fn get_multiplier(&self, magnitude: i32) -> i32 {
        match self {
            Self::Scientific => magnitude.wrapping_neg(),
            Self::Engineering => magnitude.rem_euclid(3).wrapping_sub(magnitude),
        }
    }
}

impl ScientificHandler {
    /// Chooses the exponent and rounds. Infinity and NaN have no exponent.
    pub(crate) fn process_quantity<'a>(
        self,
        quantity: &mut DecimalQuantity,
        rounder: &mut RoundingImpl,
        symbols: &'a DecimalFormatSymbols,
    ) -> Result<Option<ScientificModifier<'a>>, UErrorCode> {
        if quantity.is_infinite() || quantity.is_nan() {
            return Ok(None);
        }
        let multiplier = if quantity.is_zeroish() {
            rounder.apply(quantity).map(|()| 0)
        } else {
            rounder.choose_multiplier_and_apply(quantity, &self)
        }?;
        let exponent = multiplier.wrapping_neg();
        quantity.adjust_exponent(exponent);
        rounder.rounding = None;
        Ok(Some(ScientificModifier { exponent, symbols }))
    }
}
