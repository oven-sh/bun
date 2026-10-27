//! Fixed prefix codes, for the qualities that have no time to build their own.
#![allow(clippy::indexing_slicing, reason = "evaluated by the compiler")]

use super::bit_writer::BitWriter;
use crate::common::constants::{
    CODE_LENGTH_CODES, NUM_COMMAND_SYMBOLS, REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH,
};
use crate::util::Checked;

/// The codes of the canonical prefix code with code lengths `depth`, with their bits in the order they are written in.
const fn canonical_code<const N: usize>(depth: &[u8; N]) -> [u16; N] {
    let mut bl_count = [0u16; 16];
    let mut i = 0;
    while i < N {
        bl_count[depth[i] as usize] += 1;
        i += 1;
    }
    bl_count[0] = 0;
    let mut next_code = [0u16; 16];
    let mut code = 0u16;
    i = 1;
    while i < 16 {
        code = (code + bl_count[i - 1]) << 1;
        next_code[i] = code;
        i += 1;
    }
    let mut bits = [0u16; N];
    i = 0;
    while i < N {
        let d = depth[i] as usize;
        if d != 0 {
            bits[i] = next_code[d].reverse_bits() >> (16 - d);
            next_code[d] += 1;
        }
        i += 1;
    }
    bits
}

/// A code for code lengths.
pub(crate) static CODE_LENGTH_DEPTH: [u8; CODE_LENGTH_CODES] = CODE_LENGTH_DEPTH_;
const CODE_LENGTH_DEPTH_: [u8; CODE_LENGTH_CODES] = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 0, 4, 4];
pub(crate) static CODE_LENGTH_BITS: [u16; CODE_LENGTH_CODES] = CODE_LENGTH_BITS_;
const CODE_LENGTH_BITS_: [u16; CODE_LENGTH_CODES] = canonical_code(&CODE_LENGTH_DEPTH_);

/// Announces the code of [`CODE_LENGTH_DEPTH`].
pub(crate) fn store_static_code_length_code(bw: &mut BitWriter<'_>) -> Checked {
    bw.write_bits(40, 0x00FF_5555_5554)
}

/// Some bits and how many they are.
#[derive(Clone, Copy)]
pub(crate) struct Bits {
    pub(crate) bits: u32,
    pub(crate) depth: u8,
}

/// `repeat_code`s, in the code of [`CODE_LENGTH_DEPTH`], for a run of `reps + 3`. Each has `extra_bits` extra bits.
const fn repeat_codes(mut reps: usize, repeat_code: usize, extra_bits: u8) -> Bits {
    let mut result = Bits { bits: 0, depth: 0 };
    loop {
        // The last code is found first.
        let extra = (reps & ((1 << extra_bits) - 1)) as u32;
        let code = CODE_LENGTH_BITS_[repeat_code] as u32 | (extra << CODE_LENGTH_DEPTH_[repeat_code]);
        let depth = CODE_LENGTH_DEPTH_[repeat_code] + extra_bits;
        result.bits = (result.bits << depth) | code;
        result.depth += depth;
        reps >>= extra_bits;
        if reps == 0 {
            return result;
        }
        reps -= 1;
    }
}

/// `ZERO_REPS[n]` is a run of `n` code lengths of 0.
pub(crate) static ZERO_REPS: [Bits; NUM_COMMAND_SYMBOLS] = {
    let zero = Bits { bits: CODE_LENGTH_BITS_[0] as u32, depth: CODE_LENGTH_DEPTH_[0] };
    let mut table = [Bits { bits: 0, depth: 0 }; NUM_COMMAND_SYMBOLS];
    let mut reps = 1;
    while reps < NUM_COMMAND_SYMBOLS {
        table[reps] = match reps {
            1 => zero,
            2 => Bits { bits: zero.bits | (zero.bits << zero.depth), depth: 2 * zero.depth },
            11 => {
                let rest = repeat_codes(10 - 3, REPEAT_ZERO_CODE_LENGTH, 3);
                Bits { bits: zero.bits | (rest.bits << zero.depth), depth: zero.depth + rest.depth }
            }
            _ => repeat_codes(reps - 3, REPEAT_ZERO_CODE_LENGTH, 3),
        };
        reps += 1;
    }
    table
};

/// `NON_ZERO_REPS[n]` repeats the previous code length `n + 3` times.
pub(crate) static NON_ZERO_REPS: [Bits; NUM_COMMAND_SYMBOLS] = {
    let mut table = [Bits { bits: 0, depth: 0 }; NUM_COMMAND_SYMBOLS];
    let mut reps = 0;
    while reps < NUM_COMMAND_SYMBOLS {
        table[reps] = repeat_codes(reps, REPEAT_PREVIOUS_CODE_LENGTH, 2);
        reps += 1;
    }
    table
};

/// A code for insert-and-copy lengths.
pub(crate) static STATIC_COMMAND_CODE_DEPTH: [u8; NUM_COMMAND_SYMBOLS] = STATIC_COMMAND_CODE_DEPTH_;
const STATIC_COMMAND_CODE_DEPTH_: [u8; NUM_COMMAND_SYMBOLS] = {
    let mut depth = [9; NUM_COMMAND_SYMBOLS];
    let mut i = 448;
    while i < NUM_COMMAND_SYMBOLS {
        depth[i] = 11;
        i += 1;
    }
    depth
};
pub(crate) static STATIC_COMMAND_CODE_BITS: [u16; NUM_COMMAND_SYMBOLS] = canonical_code(&STATIC_COMMAND_CODE_DEPTH_);

/// Announces the code of [`STATIC_COMMAND_CODE_DEPTH`].
pub(crate) fn store_static_command_huffman_tree(bw: &mut BitWriter<'_>) -> Checked {
    bw.write_bits(56, 0x0092_6244_1630_7003)?;
    bw.write_bits(3, 0)
}

/// A code for distances.
pub(crate) static STATIC_DISTANCE_CODE_DEPTH: [u8; 64] = [6; 64];
pub(crate) static STATIC_DISTANCE_CODE_BITS: [u16; 64] = canonical_code(&[6; 64]);

/// Announces the code of [`STATIC_DISTANCE_CODE_DEPTH`].
pub(crate) fn store_static_distance_huffman_tree(bw: &mut BitWriter<'_>) -> Checked {
    bw.write_bits(28, 0x0369_DC03)
}
