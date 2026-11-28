//! The structural index of JSON, as in stage 1 of simdjson.

use bun_simd::prelude::*;

pub const HAS_BACKSLASH_IN_STRING: u32 = 1 << 0;
pub const HAS_CONTROL_IN_STRING: u32 = 1 << 1;

// A byte has some of the bits of one class. Their order lets a comparison take the place of a mask and a test.
/// `/` and `'`
const ODDITY: u8 = 0x01;
pub const WHITESPACE: u8 = 0x06;
/// `{ } [ ] : ,`
pub const STRUCTURAL: u8 = 0x38;

const CLASSES: ByteClasses = ByteClasses::EMPTY
    .with(ODDITY, ByteSet::of(b"/'"))
    .with(WHITESPACE, ByteSet::of(b" \t\n\r"))
    .with(STRUCTURAL, ByteSet::of(b"{}[]:,"));

/// The class of each byte, for scalar code.
pub const BYTE_CLASS: [u8; 256] = {
    let (mut table, mut i) = ([0; 256], 0);
    while i < 256 {
        let class = CLASSES.classes_of(i as u8);
        let expected = match i as u8 {
            b'/' | b'\'' => ODDITY,
            b' ' | b'\t' | b'\n' | b'\r' => WHITESPACE,
            b'{' | b'}' | b'[' | b']' | b':' | b',' => STRUCTURAL,
            _ => 0,
        };
        assert!(class & !expected == 0 && (class == 0) == (expected == 0));
        table[i] = class;
        i += 1;
    }
    table
};

/// What a chunk leaves to the next.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct State {
    pub escaped: u64,
    pub in_string: u64,
    pub scalar: u64,
}

struct Found {
    backslashes: u64,
    controls: u64,
    indices: u64,
}

#[simd]
fn next(state: &mut State, v: u8x64<S>, valid: u64) -> Option<Found> {
    let backslash = v.simd_eq(b'\\').to_bitmask();
    let class = CLASSES.classes(v).cast_signed();

    let escaped = if backslash == 0 {
        core::mem::take(&mut state.escaped)
    } else {
        const EVEN: u64 = 0x5555_5555_5555_5555;
        let starts = backslash & !state.escaped;
        let follows = starts << 1 | state.escaped;
        let (on_even, carry) = (starts & !EVEN & !follows).overflowing_add(starts);
        state.escaped = carry as u64;
        (EVEN ^ on_even << 1) & follows
    };
    let quote = v.simd_eq(b'"').to_bitmask() & !escaped;
    let in_string = prefix_xor(quote) ^ state.in_string;
    state.in_string = (in_string as i64 >> 63) as u64;

    if class.simd_eq(ODDITY as i8).to_bitmask() & !in_string & valid != 0 {
        return None;
    }
    let scalar = !class.simd_gt(ODDITY as i8).to_bitmask() & !in_string & !quote;
    let scalar_start = scalar & !(scalar << 1 | state.scalar);
    state.scalar = scalar >> 63;
    let structural = class.simd_gt((WHITESPACE | ODDITY) as i8).to_bitmask() & !in_string;
    Some(Found {
        backslashes: backslash & in_string & valid,
        controls: v.simd_lt(0x20).to_bitmask() & in_string & valid,
        indices: (structural | quote | scalar_start) & valid,
    })
}

/// Appends `base` plus the position of each structural character, quote and start of a scalar to `out`, and returns the flags.
/// `dirty` gets a bit for each 64 bytes with a backslash or a control character in a string.
/// All chunks but the last have a multiple of 64 bytes.
///
/// With a `/` or `'` outside of a string it returns `None`, and `out` and `state` are as they were.
#[kernel]
#[inline(never)]
pub fn index_chunk(
    chunk: &[u8],
    base: u32,
    out: &mut Vec<u32>,
    dirty: &mut [u64],
    state: &mut State,
) -> Option<u32> {
    let (mut now, mut at, mut backslashes, mut controls) = (*state, base, 0, 0);
    let dirty = &mut dirty[..chunk.len().div_ceil(4096)];
    let out = &mut Output::append(out, chunk.len() + 64);
    for (group, dirty) in chunk.chunks(4096).zip(dirty) {
        let (mut word, mut bit) = (0, 1);
        for (v, valid) in u8x64::over(group).padded() {
            let Some(found) = next(&mut now, v, valid) else {
                out.truncate(0);
                return None;
            };
            if found.backslashes | found.controls != 0 {
                word |= bit;
            }
            backslashes |= found.backslashes;
            controls |= found.controls;
            set_bit_positions(found.indices, at, out);
            (bit, at) = (bit << 1, at.wrapping_add(64));
        }
        *dirty = word;
    }
    *state = now;
    let backslash = if backslashes != 0 {
        HAS_BACKSLASH_IN_STRING
    } else {
        0
    };
    let control = if controls != 0 {
        HAS_CONTROL_IN_STRING
    } else {
        0
    };
    Some(backslash | control)
}
