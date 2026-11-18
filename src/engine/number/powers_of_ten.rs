//! The leading 128 bits of the powers of ten that conversions of doubles scale by.

pub(crate) const MIN_POWER: i32 = -342;
pub(crate) const MAX_POWER: i32 = 341;

/// `high * 2^64 + low` is `10^n * 2^(127 - floor_log2_of_power_of_ten(n))`, rounded up.
#[derive(Clone, Copy)]
pub(crate) struct PowerOfTen {
    pub(crate) high: u64,
    pub(crate) low: u64,
}

static POWERS: [PowerOfTen; (MAX_POWER - MIN_POWER + 1) as usize] = powers();

/// 10^0 to 10^19.
pub(crate) static SMALL_POWERS: [u64; 20] = {
    let mut powers = [1; 20];
    let mut n = 1;
    while n < powers.len() {
        powers[n] = powers[n - 1] * 10;
        n += 1;
    }
    powers
};

#[inline(always)]
pub(crate) fn power_of_ten(n: i32) -> PowerOfTen {
    POWERS[(n - MIN_POWER) as usize]
}

/// For `n` from -642 to 642.
#[inline(always)]
pub(crate) const fn floor_log2_of_power_of_ten(n: i32) -> i32 {
    (n * 217_706) >> 16
}

/// For `n` from -2620 to 2620.
#[inline(always)]
pub(crate) const fn floor_log10_of_power_of_two(n: i32) -> i32 {
    (n * 315_653) >> 20
}

/// The largest `power` with `2^n * 10^power < 1`, and by how many bits the product is short of 1/2 or more.
#[inline(always)]
pub(crate) const fn power_just_below_inverse_of_power_of_two(n: i32) -> (i32, u32) {
    // -log10(2^n) with 20 binary places, moved up to be positive.
    let logarithm = ((-MIN_POWER << 20) - 1 - n * 315_653) as u32;
    let fraction = logarithm & ((1 << 20) - 1);
    (
        (logarithm >> 20) as i32 + MIN_POWER,
        (fraction * 3401) >> 30,
    )
}

const LIMBS: usize = 15;

/// `limbs`, most significant first, plus a fraction if `has_fraction`.
const fn leading_bits(limbs: &[u64; LIMBS], has_fraction: bool) -> PowerOfTen {
    let mut top = 0;
    while limbs[top] == 0 {
        top += 1;
    }
    let shift = limbs[top].leading_zeros();
    let upper = (limbs[top] as u128) << 64 | limbs[top + 1] as u128;
    let third = (limbs[top + 2] as u128) << shift;
    let mut is_inexact = has_fraction || third as u64 != 0;
    let mut rest = top + 3;
    while rest < LIMBS {
        is_inexact |= limbs[rest] != 0;
        rest += 1;
    }
    let bits = (upper << shift | third >> 64) + is_inexact as u128;
    // So `high * 2^64` is never above the power.
    assert!(!is_inexact || bits as u64 != 0);
    PowerOfTen {
        high: (bits >> 64) as u64,
        low: bits as u64,
    }
}

const fn powers() -> [PowerOfTen; (MAX_POWER - MIN_POWER + 1) as usize] {
    let mut powers = [PowerOfTen { high: 0, low: 0 }; _];

    let mut multiple = [0; LIMBS];
    multiple[LIMBS - 3] = 1;
    let mut n = 0;
    while n <= MAX_POWER {
        powers[(n - MIN_POWER) as usize] = leading_bits(&multiple, false);
        let mut carry = 0;
        let mut at = LIMBS;
        while at > 0 {
            at -= 1;
            let product = multiple[at] as u128 * 5 + carry;
            multiple[at] = product as u64;
            carry = product >> 64;
        }
        assert!(carry == 0);
        n += 1;
    }

    let mut quotient = [0; LIMBS];
    quotient[0] = 1 << 63;
    n = -1;
    while n >= MIN_POWER {
        let mut remainder = 0;
        let mut at = 0;
        while at < LIMBS {
            let dividend = remainder << 64 | quotient[at] as u128;
            quotient[at] = (dividend / 5) as u64;
            remainder = dividend % 5;
            at += 1;
        }
        powers[(n - MIN_POWER) as usize] = leading_bits(&quotient, true);
        n -= 1;
    }
    powers
}
