//! Words in 0, 1, 2 or 4 bytes.

use bun_simd::prelude::*;
use core::mem::MaybeUninit;

targets!(Upto<B32>);

#[repr(align(16))]
struct Tables {
    packing: [[u8; 16]; 256],
    unpacking: [[u8; 16]; 256],
    sizes: [u8; 256],
}

static TABLES: Tables = {
    let mut tables = Tables {
        packing: [[0x80; 16]; 256],
        unpacking: [[0x80; 16]; 256],
        sizes: [0; 256],
    };
    let mut i = 0;
    while i < 256 * 16 {
        let (control, whole) = (i / 16, i % 16);
        if whole % 4 < (1 << (control >> (whole / 4 * 2) & 3)) >> 1 {
            let packed = tables.sizes[control];
            tables.unpacking[control][whole] = packed;
            tables.packing[control][packed as usize] = whole as u8;
            tables.sizes[control] += 1;
        }
        i += 1;
    }
    tables
};

/// Packs groups of four words. The sign of each is folded into its lowest bit, then it's written in 0, 1, 2 or 4 bytes
/// to `data`. The control byte of a group has two bits for each of its words. Returns the number of bytes used in
/// `data`.
pub fn pack_words(words: &[[u32; 4]], controls: &mut [u8], data: &mut [u8]) -> usize {
    pack(words, controls, data)
}

#[kernel]
fn pack(words: &[[u32; 4]], controls: &mut [u8], data: &mut [u8]) -> usize {
    let lowest = u8x16::from([
        0, 4, 8, 12, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
    ]);
    assert!(controls.len() == words.len() && data.len() / 16 >= words.len());
    let mut at = 0usize;
    let Some(last) = data.len().checked_sub(16) else {
        return 0;
    };
    for (&word, out) in words.iter().zip(controls) {
        assert!(at <= last);
        let word = u32x4::from(word);
        let folded = word << 1 ^ (word.cast_signed() >> 31).cast_unsigned();
        let fits = |bits: u32| (folded >> bits).simd_eq(0).to_simd::<u32>();
        let codes = 3 + fits(0) + (fits(8) + fits(16));
        let four = codes
            .in_blocks()
            .lookup_bytes_relaxed(lowest)
            .bitcast::<u32>()[0];
        let control = (four.wrapping_mul(0x0104_1040) >> 24) as usize;
        folded
            .in_blocks()
            .lookup_bytes_relaxed(u8x16::from(TABLES.packing[control]))
            .bitcast::<u8>()
            .store(&mut data[at..]);
        *out = control as u8;
        at = at.wrapping_add(TABLES.sizes[control] as usize);
    }
    at
}

/// Unpacks groups that `pack_words` packed, from the first on, as long as `data` has 16 more bytes. Returns how many it
/// wrote to `words`, and the number of their bytes.
pub fn unpack_words(
    controls: &[u8],
    data: &[u8],
    words: &mut [[MaybeUninit<u32>; 4]],
) -> (usize, usize) {
    unpack(controls, data, words)
}

#[kernel]
fn unpack(controls: &[u8], data: &[u8], words: &mut [[MaybeUninit<u32>; 4]]) -> (usize, usize) {
    assert!(words.len() == controls.len());
    let mut at = 0usize;
    let Some(last) = data.len().checked_sub(16) else {
        return (0, 0);
    };
    for (group, (&control, words)) in controls.iter().zip(words).enumerate() {
        if at > last {
            return (group, at);
        }
        let folded = u8x16::load(&data[at..])
            .in_blocks()
            .lookup_bytes_relaxed(u8x16::from(TABLES.unpacking[control as usize]));
        let folded = folded.bitcast::<u32>();
        (folded >> 1 ^ -(folded & 1)).store(words);
        at = at.wrapping_add(TABLES.sizes[control as usize] as usize);
    }
    (controls.len(), at)
}
