//! Rounding to fraction digits, significant digits or increments. ICU4C: number_rounding.cpp

use crate::common::utypes::UErrorCode;
use crate::i18n::number_decimalquantity::{DecimalQuantity, RoundingMode};
use crate::i18n::plurrule::{IFixedDecimal, PluralOperand};

#[derive(Clone, Copy)]
pub(crate) struct Digits {
    pub(crate) min: i16,
    pub(crate) max: i16,
}

impl Digits {
    pub(crate) const fn new(min: usize, max: usize) -> Self {
        Self {
            min: min as i16,
            max: max as i16,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Rounding {
    Fraction(Digits),
    Significant(Digits),
    FractionSignificant {
        fraction: Digits,
        significant: Digits,
        /// The setting that keeps more digits applies.
        relaxed: bool,
    },
    /// Rounds to a multiple of `mantissa` / 10^`fraction_digits`.
    Increment {
        mantissa: u16,
        fraction_digits: i16,
    },
}

/// Returns the power of ten of the last of `count` significant digits.
fn magnitude_of_significant(value: &DecimalQuantity, count: i16) -> i32 {
    let magnitude = if value.is_zeroish() {
        0
    } else {
        value.get_magnitude()
    };
    magnitude.wrapping_sub(count.into()).wrapping_add(1)
}

pub(crate) trait MultiplierProducer {
    /// Returns the shift in powers of ten: -3 for magnitude 5, which is formatted as "100K".
    fn get_multiplier(&self, magnitude: i32) -> i32;
}

#[derive(Clone, Copy)]
pub(crate) struct RoundingImpl {
    /// `None` once the number is rounded.
    pub(crate) rounding: Option<Rounding>,
    pub(crate) mode: RoundingMode,
    pub(crate) hide_zeros_if_whole: bool,
}

impl RoundingImpl {
    /// Scales `input`, which must not be zeroish, as `producer` chooses and rounds it. Returns the multiplier.
    pub(crate) fn choose_multiplier_and_apply(
        &self,
        input: &mut DecimalQuantity,
        producer: &dyn MultiplierProducer,
    ) -> Result<i32, UErrorCode> {
        debug_assert!(!input.is_zeroish());
        let magnitude = input.get_magnitude();
        let multiplier = producer.get_multiplier(magnitude);
        input.adjust_magnitude(multiplier);
        self.apply(input)?;
        if input.is_zeroish() || input.get_magnitude() == magnitude.wrapping_add(multiplier) {
            return Ok(multiplier);
        }
        // 999.9 has become 1000, which may need the multiplier of 1K.
        let next_multiplier = producer.get_multiplier(magnitude.wrapping_add(1));
        if next_multiplier == multiplier {
            return Ok(multiplier);
        }
        input.adjust_magnitude(next_multiplier.wrapping_sub(multiplier));
        self.apply(input).map(|()| next_multiplier)
    }

    pub(crate) fn apply(&self, value: &mut DecimalQuantity) -> Result<(), UErrorCode> {
        let Some(rounding) = self.rounding else {
            return Ok(());
        };
        let display_magnitude = match rounding {
            Rounding::Fraction(digits) => {
                value.round_to_magnitude(-i32::from(digits.max), self.mode);
                -i32::from(digits.min)
            }
            Rounding::Significant(digits) => {
                value.round_to_magnitude(magnitude_of_significant(value, digits.max), self.mode);
                magnitude_of_significant(value, digits.min)
            }
            Rounding::FractionSignificant {
                fraction,
                significant,
                relaxed,
            } => {
                let by_fraction = -i32::from(fraction.max);
                let by_significant = magnitude_of_significant(value, significant.max);
                let old_magnitude = value.get_magnitude();
                let magnitude = if relaxed {
                    by_fraction.min(by_significant)
                } else {
                    by_fraction.max(by_significant)
                };
                value.round_to_magnitude(magnitude, self.mode);
                // A tie goes to the fraction digits if rounding has changed the magnitude (9.99 to 10.0).
                let significant_is_finer =
                    if !value.is_zeroish() && value.get_magnitude() != old_magnitude {
                        by_significant < by_fraction
                    } else {
                        by_significant <= by_fraction
                    };
                if relaxed == significant_is_finer {
                    magnitude_of_significant(value, significant.min)
                } else {
                    -i32::from(fraction.min)
                }
            }
            Rounding::Increment {
                mantissa,
                fraction_digits,
            } => {
                let magnitude = -i32::from(fraction_digits);
                if mantissa == 5 {
                    value.round_to_nickel(magnitude, self.mode);
                } else {
                    value.round_to_increment(mantissa, magnitude, self.mode)?;
                }
                magnitude
            }
        };
        if !self.hide_zeros_if_whole || value.get_plural_operand(PluralOperand::T) != 0.0 {
            value.set_min_fraction(display_magnitude.wrapping_neg().max(0));
        }
        Ok(())
    }
}
