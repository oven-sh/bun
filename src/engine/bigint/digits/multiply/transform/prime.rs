//! Arithmetic modulo primes just below 2^62, so that residues can be left as large as four times the prime.
//! Harvey, Faster arithmetic for number-theoretic transforms.

use core::hint::select_unpredictable;

use crate::digits::join;

/// The primes have roots of unity of order `2^MAX_ORDER_BITS`.
pub(super) const MAX_ORDER_BITS: usize = 24;

pub(super) const PRIMES: [Prime; 3] = [
    Prime::new(0x3fff_ffff_fa00_0001, 3),
    Prime::new(0x3fff_ffff_f900_0001, 5),
    Prime::new(0x3fff_ffff_ea00_0001, 5),
];

pub(super) struct Prime {
    pub(super) modulus: Modulus,
    /// The one at `i` has order `2^(i + 2)` and is the square of the next.
    pub(super) roots: [Factor; MAX_ORDER_BITS - 1],
}

impl Prime {
    const fn new(value: u64, non_residue: u64) -> Prime {
        let modulus = Modulus::new(value);
        let mut root = modulus.power(non_residue, (value - 1) >> MAX_ORDER_BITS);
        let mut roots = [modulus.factor(1); MAX_ORDER_BITS - 1];
        let mut index = roots.len();
        while index > 0 {
            index -= 1;
            roots[index] = modulus.factor(root);
            root = modulus.product(root, root);
        }
        assert!(root == value - 1);
        Prime { modulus, roots }
    }
}

/// A residue to multiply many others by.
#[derive(Clone, Copy)]
pub(super) struct Factor {
    value: u64,
    /// `value * 2^64 / modulus`
    quotient: u64,
}

#[derive(Clone, Copy)]
pub(super) struct Modulus {
    pub(super) value: u64,
    /// Modulo 2^64.
    inverse: u64,
}

#[inline(always)]
const fn high_product(a: u64, b: u64) -> u64 {
    ((a as u128 * b as u128) >> 64) as u64
}

impl Modulus {
    const fn new(value: u64) -> Modulus {
        let mut inverse = value;
        while value.wrapping_mul(inverse) != 1 {
            inverse = inverse.wrapping_mul(2u64.wrapping_sub(value.wrapping_mul(inverse)));
        }
        Modulus { value, inverse }
    }

    pub(super) const fn product(self, a: u64, b: u64) -> u64 {
        (a as u128 * b as u128 % self.value as u128) as u64
    }

    const fn power(self, mut base: u64, mut exponent: u64) -> u64 {
        let mut power = 1;
        while exponent != 0 {
            if exponent & 1 != 0 {
                power = self.product(power, base);
            }
            base = self.product(base, base);
            exponent >>= 1;
        }
        power
    }

    pub(super) const fn reciprocal(self, a: u64) -> u64 {
        self.power(a, self.value - 2)
    }

    /// `a * 2^64`
    pub(super) const fn times_radix(self, a: u64) -> u64 {
        (((a as u128) << 64) % self.value as u128) as u64
    }

    pub(super) const fn factor(self, value: u64) -> Factor {
        Factor {
            value,
            quotient: (((value as u128) << 64) / self.value as u128) as u64,
        }
    }

    /// Goes by way of `value * 2^64 - quotient * modulus`, from which both fields follow without a division.
    #[inline(always)]
    pub(super) fn factor_product(self, a: Factor, b: Factor) -> Factor {
        let left = a.quotient.wrapping_mul(self.value).wrapping_neg();
        let left = below(self.multiply(left, b), self.value);
        let quotient = left.wrapping_mul(self.inverse).wrapping_neg();
        Factor {
            value: high_product(quotient, self.value).wrapping_add(1),
            quotient,
        }
    }

    #[inline(always)]
    pub(super) fn twice(self) -> u64 {
        self.value << 1
    }

    /// Less than twice the modulus, for any `a`.
    #[inline(always)]
    pub(super) fn multiply(self, a: u64, factor: Factor) -> u64 {
        let quotient = high_product(a, factor.quotient);
        a.wrapping_mul(factor.value)
            .wrapping_sub(quotient.wrapping_mul(self.value))
    }

    /// `a / 2^64` for `a < modulus * 2^64`. Less than the modulus.
    #[inline(always)]
    pub(super) fn divide_by_radix(self, a: u128) -> u64 {
        let multiple = high_product((a as u64).wrapping_mul(self.inverse), self.value);
        not_negative(((a >> 64) as u64).wrapping_sub(multiple), self.value)
    }

    /// `a / 2^64` for `a < 4 * modulus * 2^64`. Less than twice the modulus.
    #[inline(always)]
    pub(super) fn divide_wide_by_radix(self, a: u128) -> u64 {
        self.divide_by_radix(join(a as u64, self.narrow((a >> 64) as u64)))
    }

    /// From below four times the modulus to below twice.
    #[inline(always)]
    pub(super) fn narrow(self, a: u64) -> u64 {
        below(a, self.twice())
    }

    /// `a + b`, all below twice the modulus.
    #[inline(always)]
    pub(super) fn add(self, a: u64, b: u64) -> u64 {
        self.narrow(a.wrapping_add(b))
    }

    /// `a - b`, of two below twice the modulus. Below four times the modulus.
    #[inline(always)]
    pub(super) fn subtract_wide(self, a: u64, b: u64) -> u64 {
        a.wrapping_sub(b).wrapping_add(self.twice())
    }

    /// `a - b`, all below twice the modulus.
    #[inline(always)]
    pub(super) fn subtract(self, a: u64, b: u64) -> u64 {
        not_negative(a.wrapping_sub(b), self.twice())
    }

    /// `a / 2`, both below twice the modulus.
    #[inline(always)]
    pub(super) fn halve(self, a: u64) -> u64 {
        a.wrapping_add(select_unpredictable(a & 1 != 0, self.value, 0)) >> 1
    }
}

/// `a`, less `bound` if it reaches that. They are less than 2^63 apart.
#[inline(always)]
fn below(a: u64, bound: u64) -> u64 {
    let difference = a.wrapping_sub(bound);
    select_unpredictable((difference as i64) < 0, a, difference)
}

/// `a`, plus `bound` if it is negative.
#[inline(always)]
fn not_negative(a: u64, bound: u64) -> u64 {
    a.wrapping_add(select_unpredictable((a as i64) < 0, bound, 0))
}
