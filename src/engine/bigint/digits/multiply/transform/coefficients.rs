//! Between digits and the coefficients of a polynomial in a power of two.

use super::prime::{Modulus, PRIMES};
use super::tree::keep_scalar;
use crate::digits::{add_with_carry, join, unroll};
use crate::{Error, Work};

/// The bits in a coefficient.
#[derive(Clone, Copy)]
pub(super) enum Width {
    Bits80 = 80,
    Bits84 = 84,
    Bits88 = 88,
}

/// Names the number of coefficients in the smallest group that takes whole digits, and the number of those.
macro_rules! with_groups {
    ($width:expr, $($function:ident)::+($($argument:expr),*)) => {
        match $width {
            Width::Bits80 => $($function)::+::<4, 5>($($argument),*),
            Width::Bits84 => $($function)::+::<16, 21>($($argument),*),
            Width::Bits88 => $($function)::+::<8, 11>($($argument),*),
        }
    };
}

impl Width {
    /// A coefficient of the product is a sum of as many terms as the short operand has coefficients. It has to be
    /// less than the product of the primes, which is just short of 2^186.
    pub(super) fn for_short_operand(length: usize) -> Width {
        let fits = |width: Width| width.count(length) < (1 << (186 - 2 * width as u32)) - 1;
        if fits(Width::Bits88) {
            Width::Bits88
        } else if fits(Width::Bits84) {
            Width::Bits84
        } else {
            Width::Bits80
        }
    }

    pub(super) fn count(self, length: usize) -> usize {
        (length * 64).div_ceil(self as usize)
    }

    pub(super) fn length_within(self, count: usize) -> usize {
        count * self as usize / 64
    }

    /// Writes whole groups of coefficients, below twice the modulus.
    pub(super) fn read(self, out: &mut [u64], digits: &[u64], modulus: Modulus) {
        with_groups!(self, read(out, digits, modulus));
    }
}

/// The 64 bits from `at` on.
#[inline(always)]
fn bits_at<const N: usize>(digits: &[u64; N], at: usize) -> u64 {
    let (index, shift) = (at / 64, at % 64);
    if shift != 0 && index + 1 < N {
        digits[index] >> shift | digits[index + 1] << (64 - shift)
    } else {
        digits[index] >> shift
    }
}

#[inline(always)]
fn read_group<const COUNT: usize, const DIGITS: usize>(
    out: &mut [u64; COUNT],
    digits: &[u64; DIGITS],
    excess: u64,
) {
    let bits = 64 * DIGITS / COUNT;
    unroll!(16, i in 0, COUNT => {
        let low = bits_at(digits, i * bits) & ((1 << 62) - 1);
        let high = bits_at(digits, i * bits + 62) & ((1 << (bits - 62)) - 1);
        out[i] = low.wrapping_add(high.wrapping_mul(excess));
        keep_scalar();
    });
}

fn read<const COUNT: usize, const DIGITS: usize>(
    out: &mut [u64],
    digits: &[u64],
    modulus: Modulus,
) {
    let excess = (1 << 62) - modulus.value;
    let (groups, rest) = digits.as_chunks::<DIGITS>();
    let (out, out_rest) = out.as_chunks_mut::<COUNT>().0.split_at_mut(groups.len());
    for (out, group) in out.iter_mut().zip(groups) {
        read_group(out, group, excess);
    }
    if !rest.is_empty() {
        let mut padded = [0; DIGITS];
        padded[..rest.len()].copy_from_slice(rest);
        read_group(&mut out_rest[0], &padded, excess);
    }
}

/// Garner's form of the Chinese remainder theorem: the number is `t0 + p0 * t1 + p0 * p1 * t2`.
pub(super) struct Combination {
    /// What the residue modulo each prime is multiplied by.
    scales: [u64; 3],
}

const P0: Modulus = PRIMES[0].modulus;
const P1: Modulus = PRIMES[1].modulus;
const P2: Modulus = PRIMES[2].modulus;
const P0_P1: u128 = P0.value as u128 * P1.value as u128;
const RECIPROCALS: [u64; 3] = [
    1,
    P1.reciprocal(P0.value),
    P2.reciprocal(P2.product(P0.value, P1.value)),
];
const T0_IN_T1: u64 = P1.times_radix(P1.value - RECIPROCALS[1]);
const T0_IN_T2: u64 = P2.times_radix(P2.value - RECIPROCALS[2]);
const T1_IN_T2: u64 = P2.times_radix(P2.value - P2.reciprocal(P1.value));

impl Combination {
    /// For residues that were taken times `2^(scale_bits - 64)`.
    pub(super) fn new(scale_bits: u32) -> Combination {
        Combination {
            scales: core::array::from_fn(|i| {
                let modulus = PRIMES[i].modulus;
                let scale = (1u128 << (127 - scale_bits) << 1) % u128::from(modulus.value);
                modulus.product(scale as u64, RECIPROCALS[i])
            }),
        }
    }

    #[inline(always)]
    fn apply(&self, r0: u64, r1: u64, r2: u64) -> [u64; 3] {
        let wide = |a: u64, b: u64| u128::from(a) * u128::from(b);
        let t0 = P0.divide_by_radix(wide(r0, self.scales[0]));
        let t1 = wide(r1, self.scales[1]).wrapping_add(wide(t0, T0_IN_T1));
        let t1 = P1.divide_by_radix(t1);
        let t2 = wide(r2, self.scales[2]).wrapping_add(wide(t0, T0_IN_T2));
        let t2 = P2.divide_by_radix(t2.wrapping_add(wide(t1, T1_IN_T2)));
        let low = wide(t1, P0.value).wrapping_add(u128::from(t0));
        let (first, carry) = t2.carrying_mul(P0_P1 as u64, low as u64);
        let (second, third) = t2.carrying_mul_add((P0_P1 >> 64) as u64, (low >> 64) as u64, carry);
        [first, second, third]
    }

    /// Not in the loop of its caller, where some AArch64 targets would branch on the signs and carries.
    #[inline(never)]
    fn write_group<const COUNT: usize, const DIGITS: usize>(
        &self,
        out: &mut [u64; DIGITS],
        residues: [&[u64; COUNT]; 3],
        above: &mut u128,
    ) {
        let bits = 64 * DIGITS / COUNT;
        *out = [0; DIGITS];
        unroll!(16, i in 0, COUNT => {
            let [first, second, third] = self.apply(residues[0][i], residues[1][i], residues[2][i]);
            let (first, carry) = first.overflowing_add(*above as u64);
            let (second, carry) = add_with_carry(second, (*above >> 64) as u64, carry);
            *above = join(second, third.wrapping_add(u64::from(carry))) >> (bits - 64);
            let second = second & ((1 << (bits - 64)) - 1);
            let (index, shift) = (i * bits / 64, i * bits % 64);
            out[index] |= first << shift;
            out[index + 1] = second << shift | first >> 1 >> (63 - shift);
            if shift + bits > 128 {
                out[index + 2] = second >> (64 - shift);
            }
        });
    }

    /// There are residues enough to fill `out`, in whole groups.
    pub(super) fn write(
        &self,
        width: Width,
        out: &mut [u64],
        residues: [&[u64]; 3],
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        with_groups!(width, Self::write_groups(self, out, residues, work))
    }

    fn write_groups<const COUNT: usize, const DIGITS: usize>(
        &self,
        out: &mut [u64],
        residues: [&[u64]; 3],
        work: &mut Work<'_>,
    ) -> Result<(), Error> {
        let [r0, r1, r2] = residues.map(|residues| residues.as_chunks::<COUNT>().0);
        let mut above = 0;
        for (out, ((r0, r1), r2)) in out.chunks_mut(DIGITS).zip(r0.iter().zip(r1).zip(r2)) {
            work.spend(16 * COUNT)?;
            if let Some(out) = out.as_mut_array::<DIGITS>() {
                self.write_group(out, [r0, r1, r2], &mut above);
            } else {
                let mut last = [0; DIGITS];
                self.write_group(&mut last, [r0, r1, r2], &mut above);
                out.copy_from_slice(&last[..out.len()]);
            }
        }
        Ok(())
    }
}
