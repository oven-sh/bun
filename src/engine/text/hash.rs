//! rapidhash, cut to the 24 bits that a `StringImpl` keeps. Equal strings hash alike whichever width stores them.
//! `src/codegen/create_hash_table` computes the same function for the static property tables.

const SECRET: [u64; 3] = [
    0x2d35_8dcc_aa6c_78a5,
    0x8bb8_4b93_962e_acc9,
    0x4b33_a62e_d433_d4a3,
];
const HASH_MASK: u32 = (1 << 24) - 1;
/// Zero means "not computed yet".
const HASH_IN_PLACE_OF_ZERO: u32 = 1 << 23;

#[inline(always)]
const fn multiply(a: u64, b: u64) -> (u64, u64) {
    let product = a as u128 * b as u128;
    (product as u64, (product >> 64) as u64)
}

#[inline(always)]
const fn mix(a: u64, b: u64) -> u64 {
    let (low, high) = multiply(a, b);
    low ^ high
}

const SEED: u64 = mix(SECRET[0], SECRET[1]);
const SHORT: usize = 16;

#[inline(always)]
const fn finish(a: u64, b: u64, seed: u64, length: usize) -> u32 {
    let (low, high) = multiply(a ^ SECRET[1], b ^ seed);
    match mix(low ^ SECRET[0] ^ length as u64, high ^ SECRET[1]) as u32 & HASH_MASK {
        0 => HASH_IN_PLACE_OF_ZERO,
        hash => hash,
    }
}

/// Up to `SHORT` characters.
macro_rules! hash_short {
    ($data:expr, $read8:expr, $read32:expr) => {{
        let data = $data;
        let length = data.len();
        let (a, b) = if length >= 4 {
            let delta = if length >= 8 { 4 } else { 0 };
            (
                ($read32(data, 0) << 32) | $read32(data, length - 4),
                ($read32(data, delta) << 32) | $read32(data, length - 4 - delta),
            )
        } else if length > 0 {
            let (first, last) = ($read8(data, 0), $read8(data, length - 1));
            ((first << 56) | ($read8(data, length >> 1) << 32) | last, 0)
        } else {
            (0, 0)
        };
        finish(a, b, SEED ^ length as u64, length)
    }};
}

/// More than `SHORT` characters.
macro_rules! hash_long {
    ($data:expr, $read64:expr) => {{
        let data = $data;
        let mut seed = SEED ^ data.len() as u64;
        let mut rest = data;
        if rest.len() > 48 {
            let (mut second, mut third) = (seed, seed);
            while let Some((block, after)) = rest.split_first_chunk::<48>() {
                seed = mix($read64(block, 0) ^ SECRET[0], $read64(block, 8) ^ seed);
                second = mix($read64(block, 16) ^ SECRET[1], $read64(block, 24) ^ second);
                third = mix($read64(block, 32) ^ SECRET[2], $read64(block, 40) ^ third);
                rest = after;
            }
            seed ^= second ^ third;
        }
        if let Some(block) = rest.first_chunk::<17>() {
            seed = mix(
                $read64(block, 0) ^ SECRET[2],
                $read64(block, 8) ^ seed ^ SECRET[1],
            );
        }
        if let Some(block) = rest.first_chunk::<33>() {
            seed = mix($read64(block, 16) ^ SECRET[2], $read64(block, 24) ^ seed);
        }
        let Some(block) = data.last_chunk::<SHORT>() else {
            unreachable!()
        };
        finish($read64(block, 0), $read64(block, 8), seed, data.len())
    }};
}

#[inline(always)]
const fn byte(data: &[u8], at: usize) -> u64 {
    data[at] as u64
}

#[inline(always)]
const fn bytes32(data: &[u8], at: usize) -> u64 {
    match data.split_at(at).1.first_chunk::<4>() {
        Some(chunk) => u32::from_le_bytes(*chunk) as u64,
        None => unreachable!(),
    }
}

#[inline(always)]
const fn bytes64(data: &[u8], at: usize) -> u64 {
    match data.split_at(at).1.first_chunk::<8>() {
        Some(chunk) => u64::from_le_bytes(*chunk),
        None => unreachable!(),
    }
}

/// Of four units whose upper halves are zero.
#[inline(always)]
fn narrowed32(data: &[u16], at: usize) -> u64 {
    let units = bytes64(bun_pod::slice_as_bytes(&data[at..at + 4]), 0);
    let pairs = (units | units >> 8) & 0x0000_ffff_0000_ffff;
    (pairs | pairs >> 16) & 0xffff_ffff
}

#[inline(always)]
fn narrowed64(data: &[u16], at: usize) -> u64 {
    narrowed32(data, at) | narrowed32(data, at + 4) << 32
}

#[inline(always)]
pub const fn hash_latin1(characters: &[u8]) -> u32 {
    if characters.len() <= SHORT {
        hash_short!(characters, byte, bytes32)
    } else {
        hash_long_latin1(characters)
    }
}

#[inline(never)]
const fn hash_long_latin1(characters: &[u8]) -> u32 {
    hash_long!(characters, bytes64)
}

/// Where linear probing starts in a table of `mask + 1` slots, a power of two that can be more than there are hashes.
#[inline(always)]
pub const fn home_slot(hash: u32, mask: usize) -> usize {
    (hash as usize * ((mask >> HASH_MASK.count_ones()) + 1)) & mask
}

/// Of units that all fit in a byte.
#[inline]
pub(crate) fn hash_narrowed(units: &[u16]) -> u32 {
    if units.len() <= SHORT {
        hash_short!(units, |data: &[u16], at| u64::from(data[at]), narrowed32)
    } else {
        hash_long!(units, narrowed64)
    }
}
