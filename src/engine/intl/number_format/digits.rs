use core::cmp::Ordering;

use bun_engine_number::NumberText;

use super::RoundingMode;

/// The magnitude of a Number as `0.digits * 10^point`.
pub(super) struct Digits {
    /// In ASCII.
    buffer: [u8; Self::CAPACITY],
    /// Neither the first nor the last is zero.
    length: usize,
    point: i32,
}

impl Digits {
    const CAPACITY: usize = 24;

    /// `None` if Number::toString takes an exponent or a word for it.
    #[inline]
    pub(super) fn new(magnitude: f64) -> Option<Digits> {
        let text = match magnitude as u32 {
            integer if f64::from(integer) == magnitude => NumberText::from(integer),
            _ if (1e-6..1e21).contains(&magnitude) => NumberText::from(magnitude),
            _ => return None,
        };
        let integer_length = text.iter().take_while(|it| it.is_ascii_digit()).count();
        let (integer, fraction) = text.split_at(integer_length);
        let fraction = fraction.get(1..).unwrap_or_default();
        let (first, second, point) = if integer == b"0" {
            let zeros = fraction.iter().take_while(|&&it| it == b'0').count();
            (&fraction[zeros..], &[][..], -(zeros as i32))
        } else {
            (integer, fraction, integer_length as i32)
        };
        let mut digits = Digits {
            buffer: [0; Self::CAPACITY],
            length: first.len() + second.len(),
            point,
        };
        let (start, rest) = (digits.buffer.get_mut(..digits.length)?).split_at_mut(first.len());
        start.copy_from_slice(first);
        rest.copy_from_slice(second);
        digits.drop_trailing(b'0');
        Some(digits)
    }

    pub(super) fn is_zero(&self) -> bool {
        self.length == 0
    }

    /// How many digits come before the decimal point. For a value below 0.1, minus the zeros that follow it.
    pub(super) fn point(&self) -> i32 {
        if self.is_zero() { 1 } else { self.point }
    }

    pub(super) fn fraction_length(&self) -> i32 {
        (self.length as i32 - self.point()).max(0)
    }

    /// The factor of `10^magnitude`.
    fn at(&self, magnitude: i32) -> u8 {
        let index = usize::try_from(self.point - 1 - magnitude).ok();
        let digit = index.and_then(|index| self.buffer[..self.length].get(index));
        digit.map_or(0, |digit| digit - b'0')
    }

    /// Writes over the zeros in `out`, which has `integer_length` places before the point.
    pub(super) fn place(&self, out: &mut [u8], integer_length: i32) -> Option<()> {
        let start = usize::try_from(integer_length - self.point()).ok()?;
        let places = out.get_mut(start..)?.get_mut(..self.length)?;
        places.copy_from_slice(&self.buffer[..self.length]);
        Some(())
    }

    pub(super) fn multiply_by_power_of_ten(&mut self, exponent: i32) {
        self.point += exponent;
    }

    /// To a multiple of `10^magnitude`.
    pub(super) fn round(&mut self, magnitude: i32, mode: RoundingMode, is_negative: bool) {
        let kept = self.point - magnitude;
        if self.is_zero() || kept >= self.length as i32 {
            return;
        }
        let rest_to_half =
            (self.at(magnitude - 1).cmp(&5)).then((self.length as i32).cmp(&(kept + 1)));
        let expands = match (mode, rest_to_half) {
            (RoundingMode::Ceil, _) | (RoundingMode::HalfCeil, Ordering::Equal) => !is_negative,
            (RoundingMode::Floor, _) | (RoundingMode::HalfFloor, Ordering::Equal) => is_negative,
            (RoundingMode::Expand, _) | (RoundingMode::HalfExpand, Ordering::Equal) => true,
            (RoundingMode::Trunc, _) | (RoundingMode::HalfTrunc, Ordering::Equal) => false,
            (RoundingMode::HalfEven, Ordering::Equal) => self.at(magnitude) % 2 == 1,
            (_, order) => order == Ordering::Greater,
        };
        self.length = kept.max(0) as usize;
        if !expands {
            return self.drop_trailing(b'0');
        }
        self.drop_trailing(b'9');
        match self.buffer[..self.length].last_mut() {
            Some(last) => *last += 1,
            None => {
                self.buffer[0] = b'1';
                self.length = 1;
                self.point = self.point.max(magnitude) + 1;
            }
        }
    }

    fn drop_trailing(&mut self, digit: u8) {
        while self.buffer[..self.length].last() == Some(&digit) {
            self.length -= 1;
        }
    }
}
