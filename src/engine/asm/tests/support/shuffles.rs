//! Patterns for tests of shuffles.

#![allow(dead_code, reason = "each test uses a part")]

use std::array;

use bun_engine_asm::lanes::ZERO;

use crate::vectors::Random;

type Pattern = [u8; 16];

/// `source` gives for each lane of `bytes` bytes a lane of both vectors, or a greater number for zero.
fn of_lanes(bytes: u8, source: impl Fn(u8) -> u8) -> Pattern {
    array::from_fn(|byte| match source(byte as u8 / bytes) {
        lane if lane < 32 / bytes => lane * bytes + byte as u8 % bytes,
        _ => ZERO,
    })
}

/// All there are with lanes of 32 bits, each of which may be zero.
pub(crate) fn of_wide_lanes() -> Vec<Pattern> {
    let digit = |number: u32, place: u8| (number / 9u32.pow(place.into()) % 9) as u8;
    (0..9u32.pow(4))
        .map(|number| of_lanes(4, |lane| digit(number, lane)))
        .collect()
}

fn indices(pattern: Pattern, f: impl Fn(u8) -> u8) -> Pattern {
    pattern.map(|index| if index < 32 { f(index) } else { index })
}

fn interleavings() -> Vec<Pattern> {
    let mut all = Vec::new();
    for bytes in [1, 2, 4, 8] {
        let count = 16 / bytes;
        for odd in [0, 1] {
            all.extend([
                of_lanes(bytes, |i| i % 2 * count + odd * count / 2 + i / 2),
                of_lanes(bytes, |i| i % 2 * (count + count / 2) + i / 2),
                of_lanes(bytes, |i| 2 * i + odd),
                of_lanes(bytes, |i| 2 * i + (odd ^ (2 * i / count))),
                of_lanes(bytes, |i| i % 2 * count + (i & !1) + odd),
                of_lanes(bytes, |i| i + (i + odd) % 2 * count),
            ]);
        }
    }
    all
}

/// One byte is from the other vector, or zero.
pub(crate) fn interleavings_but_for_a_byte() -> Vec<Pattern> {
    let mut all = Vec::new();
    for pattern in interleavings() {
        for byte in 0..16 {
            for index in [pattern[byte] ^ 16, ZERO] {
                let mut changed = pattern;
                changed[byte] = index;
                all.push(changed);
            }
        }
    }
    all
}

/// Bytes gathered from one vector in place of a lane of the other, which stays as it is.
pub(crate) fn prepared_lanes() -> Vec<Pattern> {
    let gathers: [fn(u8, u8) -> u8; 4] = [
        |byte, _| 2 * byte,
        |byte, _| 2 * byte + 1,
        |byte, bytes| bytes - 1 - byte,
        |byte, _| byte + 3,
    ];
    let mut all = Vec::new();
    for bytes in [2, 4, 8] {
        for lane in 0..16 / bytes {
            for gather in gathers {
                all.extend([0, 16].map(|from| {
                    array::from_fn(|place| match place as u8 {
                        place if place / bytes == lane => from + gather(place % bytes, bytes),
                        place => 16 - from + place,
                    })
                }));
            }
        }
    }
    all
}

/// What processors have instructions for, with the operands in any order, the same, or zero.
pub(crate) fn with_names() -> Vec<Pattern> {
    let mut all = interleavings();
    for bytes in [1, 2, 4, 8] {
        let count = 16 / bytes;
        for lane in 0..count {
            all.extend([
                of_lanes(bytes, |_| lane),
                of_lanes(bytes, |i| i + lane),
                of_lanes(bytes, |i| i ^ lane),
                of_lanes(bytes, |i| if i < lane { i } else { i + count }),
                of_lanes(bytes, |i| if i == 0 { lane } else { ZERO }),
            ]);
            for from in 0..count {
                all.push(of_lanes(
                    bytes,
                    |i| if i == lane { count + from } else { i },
                ));
            }
        }
        for by in 1..bytes {
            all.extend([
                of_lanes(1, |i| if i % bytes < by { ZERO } else { i - by }),
                of_lanes(1, |i| if i % bytes + by < bytes { i + by } else { ZERO }),
                of_lanes(1, |i| i / bytes * bytes + (i + by) % bytes),
            ]);
        }
        for wide in [2, 4, 8].map(|factor| factor * bytes) {
            all.push(of_lanes(bytes, |i| match i * bytes % wide {
                0 => i * bytes / wide,
                _ => ZERO,
            }));
        }
    }
    for order in 0..=255 {
        let lane = |i: u8| order >> (2 * (i % 4)) & 3;
        all.extend([
            of_lanes(2, |i| if i < 4 { lane(i) } else { i }),
            of_lanes(2, |i| if i < 4 { i } else { 4 + lane(i) }),
            of_lanes(2, |i| i + (order >> i & 1) * 8),
        ]);
    }
    let variants = all.into_iter().flat_map(|pattern| {
        [
            pattern,
            indices(pattern, |i| i ^ 16),
            indices(pattern, |i| i % 16),
            indices(pattern, |i| i | 16),
            indices(pattern, |i| if i < 16 { i } else { ZERO }),
            indices(pattern, |i| if i < 16 { ZERO } else { i }),
        ]
    });
    let mut all: Vec<_> = variants.collect();
    all.sort_unstable();
    all.dedup();
    all
}

/// One after another, one for each operand of another, or with a few bytes changed.
pub(crate) fn near_names(count: usize, random: &mut Random) -> Vec<Pattern> {
    let named = with_names();
    let patterns = (0..count).map(|index| {
        let [mut pattern, first, second] = [(); 3].map(|()| named[random.below(named.len())]);
        let operands = [indices(first, |i| i % 16), indices(second, |i| i | 16)];
        match index % 3 {
            0 => indices(pattern, |i| first[usize::from(i % 16)]),
            1 => indices(pattern, |i| operands.as_flattened()[usize::from(i)]),
            _ => {
                for _ in 0..=random.below(2) {
                    pattern[random.below(16)] = random.below(34) as u8;
                }
                pattern
            }
        }
    });
    patterns.collect()
}

/// Of lanes of any size, from all of both vectors or from parts of them.
pub(crate) fn random(count: usize, random: &mut Random) -> Vec<Pattern> {
    let patterns = (0..count).map(|index| {
        let bytes = [1, 2][index % 2];
        let lanes = 32 / bytes;
        let parts = [u32::MAX, 0xff00_00ff, 0x00ff_ff00, 0xf0f0_0f0f, 0x3333_cccc][index / 2 % 5];
        let allowed = parts & (random.next() | random.next()) as u32;
        let mut choices: Vec<_> = (0..lanes)
            .filter(|lane| allowed >> (lane * bytes) & 1 != 0)
            .collect();
        if choices.is_empty() || index / 10 % 2 == 0 {
            choices.push(lanes);
        }
        let sources: [u8; 16] = array::from_fn(|_| choices[random.below(choices.len())] as u8);
        let pattern = of_lanes(bytes as u8, |i| sources[usize::from(i)]);
        pattern.map(|index| match index {
            ZERO => 32 + random.below(224) as u8,
            _ => index,
        })
    });
    patterns.collect()
}
