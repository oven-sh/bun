//! The x87 double extended format in software: what a `long double` constant is on x86-64.
//!
//! One sign bit, a 15-bit exponent biased by 16383 and a 64-bit significand whose integer bit
//! is explicit. In memory that is ten bytes, little endian, followed by six bytes of padding.
//! Everything here rounds to nearest, ties to even, once: the x87 unit's default, and what the
//! host compiler does to a constant.

/// A binary floating format: the significand's width and the exponent range of normal numbers.
#[derive(Clone, Copy)]
pub(crate) struct Format {
    pub(crate) precision: i64,
    pub(crate) min_exponent: i64,
    pub(crate) max_exponent: i64,
}

pub(crate) const BINARY32: Format = Format {
    precision: 24,
    min_exponent: -126,
    max_exponent: 127,
};
pub(crate) const BINARY64: Format = Format {
    precision: 53,
    min_exponent: -1022,
    max_exponent: 1023,
};
const X87: Format = Format {
    precision: 64,
    min_exponent: -16382,
    max_exponent: 16383,
};

pub(crate) enum Rounded {
    Zero,
    Infinite,
    /// `significand * 2^(exponent - precision + 1)`. A normal number's significand has its top
    /// bit set; a subnormal's does not and its exponent is the format's smallest.
    Finite {
        exponent: i64,
        significand: u64,
    },
}

/// The sign of a number given by its magnitude.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Sign {
    Plus,
    Minus,
}

impl Sign {
    pub(crate) fn of(negative: bool) -> Sign {
        if negative { Sign::Minus } else { Sign::Plus }
    }
}

/// What was cut off below a significand before it was handed over to be rounded: nothing but
/// zeros, or some bit that was not (the "sticky" bit of a rounding).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Below {
    Zeros,
    NonZero,
}

impl Below {
    pub(crate) fn of(sticky: bool) -> Below {
        if sticky { Below::NonZero } else { Below::Zeros }
    }
}

/// `significand * 2^exponent` rounded to `format`, including into its subnormal range.
/// `sticky` says that nonzero bits below the significand were dropped.
pub(crate) fn round(significand: u128, exponent: i64, sticky: bool, format: Format) -> Rounded {
    if significand == 0 {
        return Rounded::Zero;
    }
    let top = 127 - i64::from(significand.leading_zeros());
    let mut unbiased = top.saturating_add(exponent);
    if unbiased > format.max_exponent {
        return Rounded::Infinite;
    }
    // How many significant bits the result can hold: fewer once it is subnormal.
    let precision = if unbiased >= format.min_exponent {
        format.precision
    } else {
        format
            .precision
            .saturating_sub(format.min_exponent.saturating_sub(unbiased))
    };
    if precision < 0 {
        return Rounded::Zero;
    }
    // Keep the top `precision` bits (0 of them: only rounding can save the value).
    let drop = top + 1 - precision;
    let mut kept = if drop <= 0 {
        significand << (-drop) as u32
    } else if drop >= 128 {
        0
    } else {
        significand >> drop as u32
    };
    if drop > 0 {
        let rest = if drop >= 128 {
            significand
        } else {
            significand & ((1u128 << drop as u32) - 1)
        };
        let half = 1u128 << (drop - 1) as u32;
        let above_half = rest > half || (rest == half && sticky);
        if above_half || (rest == half && kept & 1 == 1) {
            kept += 1;
        }
    }
    if kept == 0 {
        return Rounded::Zero;
    }
    if unbiased < format.min_exponent {
        // A carry into the top bit makes it the smallest normal number.
        return Rounded::Finite {
            exponent: format.min_exponent,
            significand: kept as u64,
        };
    }
    if kept >> format.precision as u32 != 0 {
        kept >>= 1;
        unbiased += 1;
        if unbiased > format.max_exponent {
            return Rounded::Infinite;
        }
    }
    Rounded::Finite {
        exponent: unbiased,
        significand: kept as u64,
    }
}

/// `significand * 2^exponent` as a `double`.
pub(crate) fn round_to_f64(significand: u128, exponent: i64, sticky: bool) -> f64 {
    match round(significand, exponent, sticky, BINARY64) {
        Rounded::Zero => 0.0,
        Rounded::Infinite => f64::INFINITY,
        Rounded::Finite {
            exponent,
            significand,
        } => {
            // A subnormal has no implicit bit and the biased exponent 0.
            let normal = significand >> 52 != 0;
            let biased = if normal { (exponent + 1023) as u64 } else { 0 };
            f64::from_bits((biased << 52) | (significand & ((1 << 52) - 1)))
        }
    }
}

pub(crate) fn round_to_f32(significand: u128, exponent: i64, sticky: bool) -> f32 {
    match round(significand, exponent, sticky, BINARY32) {
        Rounded::Zero => 0.0,
        Rounded::Infinite => f32::INFINITY,
        Rounded::Finite {
            exponent,
            significand,
        } => {
            let normal = significand >> 23 != 0;
            let biased = if normal { (exponent + 127) as u32 } else { 0 };
            f32::from_bits((biased << 23) | (significand as u32 & ((1 << 23) - 1)))
        }
    }
}

/// A natural number of any size, least significant word first, for the decimal conversions.
struct Big(Vec<u32>);

impl Big {
    fn from_decimal(digits: &[u8]) -> Big {
        let mut n = Big(Vec::new());
        for chunk in digits.chunks(9) {
            let mut scale = 1u32;
            let mut value = 0u32;
            for &d in chunk {
                scale *= 10;
                value = value * 10 + u32::from(d - b'0');
            }
            n.mul_small(scale);
            n.add_small(value);
        }
        n
    }

    fn mul_small(&mut self, by: u32) {
        let mut carry = 0u64;
        for w in &mut self.0 {
            let product = u64::from(*w) * u64::from(by) + carry;
            *w = product as u32;
            carry = product >> 32;
        }
        if carry != 0 {
            self.0.push(carry as u32);
        }
    }

    fn add_small(&mut self, value: u32) {
        let mut carry = u64::from(value);
        for w in &mut self.0 {
            if carry == 0 {
                return;
            }
            let sum = u64::from(*w) + carry;
            *w = sum as u32;
            carry = sum >> 32;
        }
        if carry != 0 {
            self.0.push(carry as u32);
        }
    }

    /// Divides in place and returns the remainder.
    fn div_small(&mut self, by: u32) -> u32 {
        let mut remainder = 0u64;
        for w in self.0.iter_mut().rev() {
            let value = (remainder << 32) | u64::from(*w);
            *w = (value / u64::from(by)) as u32;
            remainder = value % u64::from(by);
        }
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
        remainder as u32
    }

    fn shift_left(&mut self, bits: u64) {
        let words = (bits / 32) as usize;
        let bits = (bits % 32) as u32;
        if bits != 0 {
            let mut carry = 0u32;
            for w in &mut self.0 {
                let next = *w >> (32 - bits);
                *w = (*w << bits) | carry;
                carry = next;
            }
            if carry != 0 {
                self.0.push(carry);
            }
        }
        if words != 0 {
            let mut shifted = vec![0u32; words];
            shifted.append(&mut self.0);
            self.0 = shifted;
        }
    }

    fn bit_length(&self) -> u64 {
        match self.0.iter().rposition(|&w| w != 0) {
            Some(at) => at as u64 * 32 + u64::from(32 - self.0[at].leading_zeros()),
            None => 0,
        }
    }

    /// The top 128 bits (or all of them), how many bits below were left out, and whether any
    /// of those was set.
    fn top_bits(&self) -> (u128, u64, bool) {
        let length = self.bit_length();
        let dropped = length.saturating_sub(128);
        let mut top = 0u128;
        let mut sticky = false;
        for (at, &w) in self.0.iter().enumerate() {
            let low = at as u64 * 32;
            if low + 32 <= dropped {
                sticky |= w != 0;
                continue;
            }
            if low >= dropped {
                top |= u128::from(w) << (low - dropped) as u32;
            } else {
                let cut = (dropped - low) as u32;
                sticky |= w & ((1u32 << cut) - 1) != 0;
                top |= u128::from(w >> cut);
            }
        }
        (top, dropped, sticky)
    }
}

const TEN_TO_THE_NINTH: u32 = 1_000_000_000;

/// How many digits of a decimal constant are read exactly; what follows only breaks ties.
const MAX_DIGITS: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Extended {
    /// The sign in bit 15 above the biased exponent.
    pub(crate) sign_exponent: u16,
    pub(crate) significand: u64,
}

const EXPONENT_MASK: u16 = 0x7fff;
const INTEGER_BIT: u64 = 1 << 63;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Zero,
    Finite,
    Infinite,
    Nan,
}

impl Extended {
    pub(crate) const ZERO: Extended = Extended {
        sign_exponent: 0,
        significand: 0,
    };
    pub(crate) const INFINITY: Extended = Extended {
        sign_exponent: EXPONENT_MASK,
        significand: INTEGER_BIT,
    };
    /// The quiet NaN `__builtin_nanl("")` is.
    pub(crate) const NAN: Extended = Extended {
        sign_exponent: EXPONENT_MASK,
        significand: 0xc000_0000_0000_0000,
    };

    pub(crate) fn is_negative(self) -> bool {
        self.sign_exponent & 0x8000 != 0
    }

    pub(crate) fn negated(self) -> Extended {
        Extended {
            sign_exponent: self.sign_exponent ^ 0x8000,
            ..self
        }
    }

    fn with_sign(self, negative: bool) -> Extended {
        Extended {
            sign_exponent: (self.sign_exponent & EXPONENT_MASK) | (u16::from(negative) << 15),
            ..self
        }
    }

    fn class(self) -> Class {
        match (self.sign_exponent & EXPONENT_MASK, self.significand) {
            (EXPONENT_MASK, INTEGER_BIT) => Class::Infinite,
            (EXPONENT_MASK, _) => Class::Nan,
            (_, 0) => Class::Zero,
            _ => Class::Finite,
        }
    }

    pub(crate) fn is_nan(self) -> bool {
        self.class() == Class::Nan
    }

    pub(crate) fn is_zero(self) -> bool {
        self.class() == Class::Zero
    }

    /// The exponent of the significand's lowest bit. (A subnormal has the biased exponent 0
    /// and the scale of 1.)
    fn unit(self) -> i64 {
        i64::from((self.sign_exponent & EXPONENT_MASK).max(1)) - 16383 - 63
    }

    /// `±significand * 2^exponent`, rounded.
    pub(crate) fn from_scaled(
        sign: Sign,
        significand: u128,
        exponent: i64,
        below: Below,
    ) -> Extended {
        let magnitude = match round(significand, exponent, below == Below::NonZero, X87) {
            Rounded::Zero => Extended::ZERO,
            Rounded::Infinite => Extended::INFINITY,
            Rounded::Finite {
                exponent,
                significand,
            } => Extended {
                sign_exponent: if significand & INTEGER_BIT != 0 {
                    (exponent + 16383) as u16
                } else {
                    0
                },
                significand,
            },
        };
        magnitude.with_sign(sign == Sign::Minus)
    }

    /// The decimal constant `digits * 10^exponent` (`digits` are ASCII digits).
    pub(crate) fn from_decimal(digits: &[u8], exponent: i64) -> Extended {
        let leading_zeros = digits.iter().take_while(|&&d| d == b'0').count();
        let digits = &digits[leading_zeros..];
        let zero = b'0';
        let (digits, mut exponent, extra) = if digits.len() > MAX_DIGITS {
            let (kept, rest) = digits.split_at(MAX_DIGITS);
            (
                kept,
                exponent.saturating_add(rest.len() as i64),
                rest.iter().any(|&d| d != zero),
            )
        } else {
            (digits, exponent, false)
        };
        if digits.is_empty() {
            return Extended::ZERO;
        }
        // The largest finite value is below 10^4933 and half the smallest is above 10^-4952.
        let magnitude = exponent.saturating_add(digits.len() as i64);
        if magnitude > 4940 {
            return Extended::INFINITY;
        }
        if magnitude < -4960 {
            return Extended::ZERO;
        }
        let mut n = Big::from_decimal(digits);
        let mut sticky = extra;
        if extra {
            // One more digit that stands for everything that was cut off.
            n.mul_small(10);
            n.add_small(1);
            exponent -= 1;
            sticky = false;
        }
        let mut scale = 0i64;
        if exponent >= 0 {
            for _ in 0..exponent / 9 {
                n.mul_small(TEN_TO_THE_NINTH);
            }
            n.mul_small(10u32.pow((exponent % 9) as u32));
        } else {
            // Enough extra bits that the quotient still has more than the significand needs.
            let divisor_bits = (-exponent) as u64 * 3322 / 1000 + 1;
            let shift = (divisor_bits + 72).saturating_sub(n.bit_length());
            n.shift_left(shift);
            scale = -(shift as i64);
            for _ in 0..(-exponent) / 9 {
                sticky |= n.div_small(TEN_TO_THE_NINTH) != 0;
            }
            sticky |= n.div_small(10u32.pow(((-exponent) % 9) as u32)) != 0;
        }
        let (top, dropped, below) = n.top_bits();
        Extended::from_scaled(
            Sign::Plus,
            top,
            scale + dropped as i64,
            Below::of(sticky | below),
        )
    }

    pub(crate) fn from_f64(value: f64) -> Extended {
        let bits = value.to_bits();
        let negative = bits >> 63 != 0;
        let biased = (bits >> 52) & 0x7ff;
        let fraction = bits & ((1 << 52) - 1);
        let magnitude = match (biased, fraction) {
            (0x7ff, 0) => Extended::INFINITY,
            (0x7ff, _) => Extended {
                sign_exponent: EXPONENT_MASK,
                // Quiet, with the payload in the top bits.
                significand: 0xc000_0000_0000_0000 | (fraction << 11),
            },
            (0, _) => Extended::from_scaled(Sign::Plus, u128::from(fraction), -1074, Below::Zeros),
            _ => Extended::from_scaled(
                Sign::Plus,
                u128::from(fraction | (1 << 52)),
                biased as i64 - 1075,
                Below::Zeros,
            ),
        };
        magnitude.with_sign(negative)
    }

    pub(crate) fn from_i128(value: i128) -> Extended {
        Extended::from_scaled(Sign::of(value < 0), value.unsigned_abs(), 0, Below::Zeros)
    }

    pub(crate) fn from_u128(value: u128) -> Extended {
        Extended::from_scaled(Sign::Plus, value, 0, Below::Zeros)
    }

    pub(crate) fn to_f64(self) -> f64 {
        let magnitude = match self.class() {
            Class::Zero => 0.0,
            Class::Infinite => f64::INFINITY,
            Class::Nan => f64::from_bits(0x7ff8_0000_0000_0000 | ((self.significand << 2) >> 13)),
            Class::Finite => round_to_f64(u128::from(self.significand), self.unit(), false),
        };
        if self.is_negative() {
            -magnitude
        } else {
            magnitude
        }
    }

    pub(crate) fn to_f32(self) -> f32 {
        let magnitude = match self.class() {
            Class::Zero => 0.0,
            Class::Infinite => f32::INFINITY,
            Class::Nan => f32::NAN,
            Class::Finite => round_to_f32(u128::from(self.significand), self.unit(), false),
        };
        if self.is_negative() {
            -magnitude
        } else {
            magnitude
        }
    }

    /// Truncated toward zero. `None` when it does not fit (or is a NaN).
    pub(crate) fn to_i128(self) -> Option<i128> {
        match self.class() {
            Class::Zero => return Some(0),
            Class::Infinite | Class::Nan => return None,
            Class::Finite => {}
        }
        let unit = self.unit();
        let magnitude = if unit >= 0 {
            if unit > 64 {
                return None;
            }
            u128::from(self.significand) << unit as u32
        } else if unit <= -64 {
            0
        } else {
            u128::from(self.significand >> (-unit) as u32)
        };
        if self.is_negative() {
            if magnitude > 1 << 127 {
                return None;
            }
            Some((magnitude as i128).wrapping_neg())
        } else {
            i128::try_from(magnitude).ok()
        }
    }

    pub(crate) fn add(self, other: Extended) -> Extended {
        match (self.class(), other.class()) {
            (Class::Nan, _) => return self.quieted(),
            (_, Class::Nan) => return other.quieted(),
            (Class::Infinite, Class::Infinite) => {
                return if self.is_negative() == other.is_negative() {
                    self
                } else {
                    Extended::NAN.negated()
                };
            }
            (Class::Infinite, _) => return self,
            (_, Class::Infinite) => return other,
            (Class::Zero, Class::Zero) => {
                return Extended::ZERO.with_sign(self.is_negative() && other.is_negative());
            }
            (Class::Zero, _) => return other,
            (_, Class::Zero) => return self,
            (Class::Finite, Class::Finite) => {}
        }
        // Sixty-two bits below each significand: enough that what is shifted out of the smaller
        // operand only ever matters as "something was there".
        const GUARD: u32 = 62;
        let (large, small) = if self.unit() >= other.unit() {
            (self, other)
        } else {
            (other, self)
        };
        let unit = small.unit().max(large.unit() - i64::from(GUARD));
        let a = u128::from(large.significand) << (large.unit() - unit) as u32;
        let distance = unit - small.unit();
        let b = if distance == 0 {
            u128::from(small.significand)
        } else if distance >= 64 {
            1
        } else {
            let shifted = small.significand >> distance as u32;
            let lost = small.significand & ((1u64 << distance as u32) - 1) != 0;
            u128::from(shifted) | u128::from(lost)
        };
        if large.is_negative() == small.is_negative() {
            return Extended::from_scaled(Sign::of(large.is_negative()), a + b, unit, Below::Zeros);
        }
        if a == b {
            return Extended::ZERO;
        }
        let (negative, magnitude) = if a > b {
            (large.is_negative(), a - b)
        } else {
            (small.is_negative(), b - a)
        };
        Extended::from_scaled(Sign::of(negative), magnitude, unit, Below::Zeros)
    }

    pub(crate) fn sub(self, other: Extended) -> Extended {
        if other.is_nan() {
            return self.add(other);
        }
        self.add(other.negated())
    }

    pub(crate) fn mul(self, other: Extended) -> Extended {
        let negative = self.is_negative() != other.is_negative();
        match (self.class(), other.class()) {
            (Class::Nan, _) => self.quieted(),
            (_, Class::Nan) => other.quieted(),
            (Class::Infinite, Class::Zero) | (Class::Zero, Class::Infinite) => {
                Extended::NAN.negated()
            }
            (Class::Infinite, _) | (_, Class::Infinite) => Extended::INFINITY.with_sign(negative),
            (Class::Zero, _) | (_, Class::Zero) => Extended::ZERO.with_sign(negative),
            (Class::Finite, Class::Finite) => Extended::from_scaled(
                Sign::of(negative),
                u128::from(self.significand) * u128::from(other.significand),
                self.unit() + other.unit(),
                Below::Zeros,
            ),
        }
    }

    pub(crate) fn div(self, other: Extended) -> Extended {
        let negative = self.is_negative() != other.is_negative();
        match (self.class(), other.class()) {
            (Class::Nan, _) => return self.quieted(),
            (_, Class::Nan) => return other.quieted(),
            (Class::Infinite, Class::Infinite) | (Class::Zero, Class::Zero) => {
                return Extended::NAN.negated();
            }
            (Class::Infinite, _) | (_, Class::Zero) => {
                return Extended::INFINITY.with_sign(negative);
            }
            (_, Class::Infinite) | (Class::Zero, _) => return Extended::ZERO.with_sign(negative),
            (Class::Finite, Class::Finite) => {}
        }
        let up = self.significand.leading_zeros();
        let down = other.significand.leading_zeros();
        let dividend = u128::from(self.significand << up) << 64;
        let divisor = u128::from(other.significand << down);
        // 64 quotient bits, then 32 more, and whether anything is left after those.
        let first = dividend / divisor;
        let rest = (dividend % divisor) << 32;
        let quotient = (first << 32) | (rest / divisor);
        let sticky = rest % divisor != 0;
        let exponent = (self.unit() - i64::from(up)) - (other.unit() - i64::from(down)) - 64 - 32;
        Extended::from_scaled(Sign::of(negative), quotient, exponent, Below::of(sticky))
    }

    fn quieted(self) -> Extended {
        Extended {
            significand: self.significand | 0xc000_0000_0000_0000,
            ..self
        }
    }

    /// `None` when either is a NaN.
    pub(crate) fn compare(self, other: Extended) -> Option<std::cmp::Ordering> {
        use std::cmp::Ordering;
        if self.is_nan() || other.is_nan() {
            return None;
        }
        if self.is_zero() && other.is_zero() {
            return Some(Ordering::Equal);
        }
        let key = |x: Extended| (x.sign_exponent & EXPONENT_MASK, x.significand);
        Some(match (self.is_negative(), other.is_negative()) {
            (false, true) => Ordering::Greater,
            (true, false) => Ordering::Less,
            (false, false) => key(self).cmp(&key(other)),
            (true, true) => key(other).cmp(&key(self)),
        })
    }

    /// The object in memory: ten bytes of value and six of padding.
    pub(crate) fn to_bytes(self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        bytes[..8].copy_from_slice(&self.significand.to_le_bytes());
        bytes[8..10].copy_from_slice(&self.sign_exponent.to_le_bytes());
        bytes
    }
}
