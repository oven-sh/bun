//! Splits an amount into the parts of a mixed unit such as "foot-and-inch".

use crate::common::memory::{try_collect, try_collect_results, try_filled};
use crate::common::putil::double_to_int64;
use crate::common::slice_ext::SliceExt;
use crate::common::uarrsort::uprv_sort_array;
use crate::common::utypes::*;
use crate::i18n::measunit_extra::SingleUnitImpl;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_rounding::RoundingImpl;
use crate::i18n::units_converter::{ConversionRates, UnitsConverter, is_bigger_unit};

/// Rounds down, except that an amount within rounding error below an integer becomes that integer.
fn floor_with_tolerance(amount: f64) -> i64 {
    double_to_int64((amount * (1.0 + f64::EPSILON)).floor())
}

struct Part {
    /// Converts from the next bigger part, or from the input unit.
    converter: UnitsConverter,
    /// Position in the output unit's identifier.
    index: usize,
}

pub(crate) struct ComplexUnitsConverter {
    /// The parts with integer values, in descending order of size.
    integer_parts: Vec<Part>,
    /// The only part that can have a fraction.
    smallest: Part,
}

impl ComplexUnitsConverter {
    /// Converts from the biggest of `parts`.
    pub(crate) fn new(parts: &[SingleUnitImpl]) -> Result<Self, UErrorCode> {
        let rates = &ConversionRates::load()?;
        let mut biggest = parts.first().ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        for part in parts.iter().skip(1) {
            if is_bigger_unit(part, biggest, rates)? {
                biggest = part;
            }
        }
        let mut sorted = try_collect(parts.iter().enumerate())?;
        uprv_sort_array(&mut sorted, |left, right| {
            -i32::from(is_bigger_unit(left.1, right.1, rates) == Ok(true))
        });
        let sources = std::iter::once(biggest).chain(sorted.iter().map(|&(_, part)| part));
        let mut integer_parts =
            try_collect_results(sources.zip(&sorted).map(|(source, &(index, target))| {
                UnitsConverter::new(source, target, rates)
                    .map(|converter| Part { converter, index })
            }))?;
        let smallest = integer_parts.pop().ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        Ok(Self {
            integer_parts,
            smallest,
        })
    }

    pub(crate) fn index_of_smallest(&self) -> usize {
        self.smallest.index
    }

    /// Replaces `quantity` with the smallest part and returns the others, in the order of the identifier.
    pub(crate) fn convert(
        &self,
        quantity: &mut DecimalQuantity,
        rounder: &RoundingImpl,
    ) -> Result<Vec<i64>, UErrorCode> {
        quantity.round_to_infinity();
        let (mut amount, mut sign) = (quantity.to_double(), 1);
        if amount < 0.0 {
            (amount, sign) = (-amount, -1);
        }
        let mut values = try_filled(0, self.integer_parts.len() + 1)?;
        for part in &self.integer_parts {
            amount = part.converter.convert(amount);
            let value = if amount.is_nan() {
                0
            } else {
                floor_with_tolerance(amount)
            };
            values.set(part.index, value);
            let remainder = amount - value as f64;
            amount = if remainder < 0.0 { 0.0 } else { remainder };
        }
        amount = self.smallest.converter.convert(amount);

        if amount.is_finite() {
            let mut rounded = DecimalQuantity::new();
            rounded.set_to_double(amount);
            rounder.apply(&mut rounded)?;
            amount = self.carry(rounded.to_double(), &mut values);
        }

        values
            .iter_mut()
            .for_each(|value| *value = value.wrapping_mul(sign));
        quantity.set_to_double(amount * sign as f64);
        Ok(values)
    }

    /// Carries 12 inches into a foot, 3 feet into a yard and so on. Returns the remainder of `rounded`.
    fn carry(&self, rounded: f64, values: &mut [i64]) -> f64 {
        let Some((biggest, middle)) = self.integer_parts.split_first() else {
            return rounded;
        };
        let mut carry = floor_with_tolerance(self.smallest.converter.convert_inverse(rounded));
        if carry <= 0 {
            return rounded;
        }
        let remainder = rounded - self.smallest.converter.convert(carry as f64);
        for Part { converter, index } in middle.iter().rev() {
            let value = values.at(*index).wrapping_add(carry);
            values.set(*index, value);
            carry = floor_with_tolerance(converter.convert_inverse(value as f64));
            if carry <= 0 {
                return remainder;
            }
            values.set(
                *index,
                value.wrapping_sub(double_to_int64(converter.convert(carry as f64).round())),
            );
        }
        values.set(biggest.index, values.at(biggest.index).wrapping_add(carry));
        remainder
    }
}
