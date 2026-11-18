//! The sixteen digits of a number below 10^16.

use core::array::from_fn;

use crate::digit_words::{split_sixteen_digits, spread_digits, store, to_characters};

#[cfg_attr(test, derive(Debug, PartialEq, Eq))]
pub(crate) struct Written {
    pub(crate) first_eight: u64,
    pub(crate) second_eight: u64,
    /// How many digits there are up to the last nonzero one. Meaningless if there is none.
    pub(crate) count: usize,
}

#[inline(always)]
pub(crate) fn write_sixteen_digits(number: u64, out: &mut [u8; 16]) -> Written {
    if cfg!(target_arch = "x86_64") {
        in_four_lanes(number, out)
    } else {
        in_two_words(number, out)
    }
}

#[inline(always)]
fn in_two_words(number: u64, out: &mut [u8; 16]) -> Written {
    let (upper, lower) = split_sixteen_digits(number);
    let (upper, lower) = (spread_digits(upper), spread_digits(lower));
    store(out, 0, to_characters(upper));
    store(out, 8, to_characters(lower));
    let reversed = u128::from(lower.swap_bytes()) << 64 | u128::from(upper.swap_bytes());
    Written {
        first_eight: to_characters(upper),
        second_eight: to_characters(lower),
        count: 16 - reversed.leading_zeros() as usize / 8,
    }
}

/// Some processors have one integer multiplier behind a short queue. Four lanes that are worked on alike compile to
/// vector instructions, which is only dependable in a caller without branches.
#[inline(always)]
fn in_four_lanes(number: u64, out: &mut [u8; 16]) -> Written {
    let upper = (number / 100_000_000) as u32;
    let dividends = [
        ((u64::from(upper) * 109_951_163) >> 40) as u32,
        upper,
        (number / 10_000) as u32,
        number as u32,
    ];
    let quotients = [0, dividends[0], dividends[1], dividends[2]];
    let digits: [u32; 4] = from_fn(|lane| {
        let four = dividends[lane].wrapping_sub(quotients[lane].wrapping_mul(10_000)) & 0x3fff;
        let by_10 = (four * 6554) & 0xffff_0000;
        let by_100 = ((four * 5243) >> 11) & 0xffff_ff00;
        let by_1000 = (four * 8389) >> 23;
        // Ten times each quotient, taken from the byte above, leaves one digit there.
        (four << 24).wrapping_sub((by_10 + by_100 + by_1000).wrapping_mul(10 * 256 - 1))
    });
    let characters = digits.map(|lane| lane | u32::from_le_bytes([b'0'; 4]));
    for (chunk, lane) in out.as_chunks_mut().0.iter_mut().zip(characters) {
        *chunk = lane.to_le_bytes();
    }

    // The exponent of a float is the position of the top bit of the integer it is made from. A zero ends up negative.
    let [a, b, c, d]: [i32; 4] = from_fn(|lane| {
        (digits[lane] as i32 as f32).to_bits() as i32 + ((32 * lane as i32 + 8 - 127) << 23)
    });
    Written {
        first_eight: u64::from(characters[0]) | u64::from(characters[1]) << 32,
        second_eight: u64::from(characters[2]) | u64::from(characters[3]) << 32,
        count: (a.max(b).max(c).max(d) as u32 >> (23 + 3)) as usize,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_engine_standalone as _;

    #[test]
    fn both_ways_agree() {
        for group in 1..10_000 {
            for factor in [1, 10_000, 100_010_000, 1_000_000_000_000, 1_000_100_010_001] {
                let number = group * factor;
                let (mut a, mut b) = ([0; 16], [0; 16]);
                assert_eq!(in_two_words(number, &mut a), in_four_lanes(number, &mut b));
                assert_eq!(a, b);
                assert_eq!(a, format!("{number:016}").as_bytes());
            }
        }
    }
}
