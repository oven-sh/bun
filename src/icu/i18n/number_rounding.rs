//! Rounding to fraction digits, significant digits or increments. ICU4C: number_rounding.cpp

use crate::common::memory::TryClone;
use crate::common::ucurr::{ucurr_get_default_fraction_digits, ucurr_get_rounding_increment};
use crate::common::utypes::*;
use crate::i18n::measunit::CurrencyCode;
use crate::i18n::number_decimalquantity::{DecimalQuantity, RoundingMode};
use crate::i18n::plurrule::{IFixedDecimal, PluralOperand, PluralRules};
use crate::i18n::standardplural::PluralForm;

pub(crate) const MAX_INT_FRAC_SIG: i32 = 999;

#[derive(Clone, Copy)]
pub(crate) struct Digits {
    pub(crate) min: i16,
    pub(crate) max: i16,
}

impl Digits {
    /// Values beyond 16 bits wrap. A `max` of -1 stands for more digits than a `f64` or an `i64` has.
    pub(crate) const fn new(min: i32, max: i32) -> Self {
        Self {
            min: min as i16,
            max: if max as i16 == -1 {
                i16::MAX
            } else {
                max as i16
            },
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Rounding {
    Unlimited,
    Fraction(Digits),
    Significant(Digits),
    FractionSignificant {
        fraction: Digits,
        significant: Digits,
        /// The setting that keeps more digits applies.
        relaxed: bool,
    },
    /// Rounds to a multiple of `mantissa` * 10^`magnitude`.
    Increment {
        mantissa: u64,
        magnitude: i16,
        min_fraction: i16,
    },
    /// The digits of a currency are out of range, so every number fails.
    OutOfBounds,
}

impl Rounding {
    /// `min_fraction` is not negative.
    pub(crate) fn increment(increment: f64, min_fraction: i32) -> Result<Self, UErrorCode> {
        if !(increment > 0.0 && min_fraction <= MAX_INT_FRAC_SIG) {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let mut quantity = DecimalQuantity::new();
        quantity.set_to_double(increment);
        quantity.round_to_infinity();
        let magnitude = quantity.adjust_to_zero_scale() as i16;
        Ok(Self::Increment {
            mantissa: quantity.to_long() as u64,
            magnitude,
            min_fraction: min_fraction as i16,
        })
    }

    // ICU4C: number_rounding.cpp, Precision::withCurrency
    pub(crate) fn for_currency(currency: CurrencyCode) -> Result<Self, UErrorCode> {
        let increment = ucurr_get_rounding_increment(&currency)?;
        let digits = ucurr_get_default_fraction_digits(&currency)?;
        if !(0..=MAX_INT_FRAC_SIG).contains(&digits) {
            return Ok(Self::OutOfBounds);
        }
        if increment == 0.0 {
            return Ok(Self::Fraction(Digits::new(digits, digits)));
        }
        Self::increment(increment, digits)
    }
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

    /// Returns the plural form of a rounded copy of `quantity`.
    #[inline(always)]
    pub(crate) fn get_plural_safe(
        &self,
        rules: &PluralRules,
        quantity: &DecimalQuantity,
    ) -> Result<PluralForm, UErrorCode> {
        let mut rounded = quantity.try_clone()?;
        self.apply(&mut rounded)?;
        Ok(rules.select(&rounded))
    }

    pub(crate) fn apply(&self, value: &mut DecimalQuantity) -> Result<(), UErrorCode> {
        let Some(rounding) = self.rounding else {
            return Ok(());
        };
        let display_magnitude = match rounding {
            Rounding::Unlimited => {
                value.round_to_infinity();
                0
            }
            Rounding::Fraction(digits) => {
                value.round_to_magnitude(-i32::from(digits.max), self.mode);
                -i32::from(digits.min)
            }
            Rounding::Significant(digits) => {
                value.round_to_magnitude(magnitude_of_significant(value, digits.max), self.mode);
                if value.is_zeroish() && digits.min > 0 {
                    value.increase_min_integer_to(1);
                }
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
                magnitude,
                min_fraction,
            } => {
                match mantissa {
                    1 => value.round_to_magnitude(magnitude.into(), self.mode),
                    5 => value.round_to_nickel(magnitude.into(), self.mode),
                    _ => value.round_to_increment(mantissa, magnitude.into(), self.mode)?,
                }
                -i32::from(min_fraction)
            }
            Rounding::OutOfBounds => return Err(U_INTERNAL_PROGRAM_ERROR),
        };
        if !self.hide_zeros_if_whole || value.get_plural_operand(PluralOperand::T) != 0.0 {
            value.set_min_fraction(display_magnitude.wrapping_neg().max(0));
        }
        Ok(())
    }
}
