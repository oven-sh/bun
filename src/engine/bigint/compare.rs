use core::cmp::Ordering;

use crate::{BigIntRef, digits};

impl PartialEq for BigIntRef<'_> {
    #[inline]
    fn eq(&self, other: &BigIntRef<'_>) -> bool {
        self.is_negative == other.is_negative
            && self.digits.len() == other.digits.len()
            && match (self.digits, other.digits) {
                ([a, rest_of_a @ ..], [b, rest_of_b @ ..]) => {
                    a == b && (rest_of_a.is_empty() || rest_of_a == rest_of_b)
                }
                _ => true,
            }
    }
}

impl Eq for BigIntRef<'_> {}

impl PartialOrd for BigIntRef<'_> {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for BigIntRef<'_> {
    #[inline]
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.is_negative, other.is_negative) {
            (false, false) => digits::compare(self.digits, other.digits),
            (true, true) => digits::compare(other.digits, self.digits),
            (false, true) => Ordering::Greater,
            (true, false) => Ordering::Less,
        }
    }
}

impl BigIntRef<'_> {
    /// By mathematical value. `None` for NaN.
    #[inline]
    pub fn cmp_number(self, number: f64) -> Option<Ordering> {
        match self.to_safe_integer() {
            Some(exact) => exact.partial_cmp(&number),
            None => self.cmp_number_when_large(number),
        }
    }

    fn cmp_number_when_large(self, number: f64) -> Option<Ordering> {
        if number.is_nan() {
            return None;
        }
        let magnitudes = if self.is_negative != number.is_sign_negative() {
            Ordering::Greater
        } else {
            let bits = number.abs().to_bits();
            let number_length = (bits >> 52).saturating_sub(1022) as usize;
            let number_top = bits << 11 | 1 << 63;
            if number.is_infinite() {
                Ordering::Less
            } else {
                digits::bit_length(self.digits)
                    .cmp(&number_length)
                    .then_with(|| digits::top_bits(self.digits).cmp(&number_top))
                    .then_with(|| digits::has_bits_below_top(self.digits).cmp(&false))
            }
        };
        Some(if self.is_negative {
            magnitudes.reverse()
        } else {
            magnitudes
        })
    }
}
