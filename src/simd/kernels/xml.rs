//! Port of highway_xml.cpp.
use bun_simd::{Out, blocks};
use class::{ANYWHERE, GT, IN_TAG, LT};

const LUT_LO: [u8; 16] = [
    0x03, 0x03, 0x13, 0x03, 0x03, 0x03, 0x07, 0x13, 0x03, 0x0a, 0x0a, 0x03, 0x43, 0x23, 0x83, 0x03,
];
const LUT_HI: [u8; 16] = [0x09, 0x02, 0x14, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
/// For the scalar code of the parser, which has to agree with the kernels.
pub mod class {
    pub static OF_BYTE: [u8; 256] = crate::classes_of_bytes(super::LUT_LO, super::LUT_HI);
    /// `&`, and control characters but for tab and newline
    pub const ANYWHERE: u8 = 0x07;
    /// Tab, newline, quotes and `=`
    pub const IN_TAG: u8 = 0x38;
    pub const LT: u8 = 0x40;
    pub const GT: u8 = 0x80;
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{Mask, U8, U16};

    /// `<`, `>`, and the bytes that lack each class.
    fn classify(v: U8) -> [Mask<u8, { U8::LEN }>; 4] {
        let class = U8::repeat_16(LUT_LO).lookup(v & 0x0F) & U8::repeat_16(LUT_HI).lookup(v >> 4);
        let lacks = |bits: u8| (class & bits).simd_eq(0);
        [
            v.simd_eq(b'<'),
            v.simd_eq(b'>'),
            lacks(ANYWHERE | LT | GT),
            lacks(IN_TAG),
        ]
    }

    /// `is_open` tells whether the block before ended between `<` and `>`.
    #[inline(always)]
    fn structural([opens, closes, not_anywhere, not_in_tag]: [u64; 4], is_open: &mut bool) -> u64 {
        let inside;
        (inside, *is_open) = opens.carrying_add(!closes, *is_open);
        !not_anywhere | !not_in_tag & (inside ^ !closes)
    }

    /// Panics unless there is room for 64 more than `input` has.
    #[export]
    pub fn index_chunk<'a>(
        input: &[u8],
        base_offset: usize,
        out: Out<'a, u32>,
        state: &mut [u64; 3],
    ) -> &'a mut [u32] {
        let (mut out, mut is_open) = (out.into_writer(), state[0] != 0);
        let [_, mut ef_before, mut bf_before] = *state;
        for (i, block) in blocks(input, &mut [b' '; 64]).enumerate() {
            let [a, b, c, d, ef, bf, be_or_bf] = U8::bitmasks(block, |v| {
                let [a, b, c, d] = classify(v);
                [
                    a,
                    b,
                    c,
                    d,
                    v.simd_eq(0xEF),
                    v.simd_eq(0xBF),
                    (v | 1).simd_eq(0xBF),
                ]
            });
            // U+FFFE and U+FFFF
            let no_char = be_or_bf & (bf << 1 | bf_before >> 63) & (ef << 2 | ef_before >> 62);
            (ef_before, bf_before) = (ef, bf);
            let bits = structural([a, b, c, d], &mut is_open) | no_char;
            isa::bit_indices(bits).push_to(&mut out, (base_offset + 64 * i) as u32);
        }
        *state = [is_open.into(), ef_before, bf_before];
        out.finish()
    }

    /// The same for UTF-16. The next call decides on a lead surrogate that ends the last whole block.
    #[export]
    pub fn index_chunk16<'a>(
        input: &[u16],
        base_offset: usize,
        out: Out<'a, u32>,
        state: &mut [u64; 3],
    ) -> &'a mut [u32] {
        let (mut out, mut is_open) = (out.into_writer(), state[0] != 0);
        let mut lead_before = state[1];
        for (i, block) in blocks(input, &mut [0x20; 64]).enumerate() {
            let base = (base_offset + 64 * i) as u32;
            let [a, b, c, d, no_char, lead, trail] = U8::bitmasks_of_chunks(block, |units| {
                let bytes = |at: usize| U16::from_slice(&units[at..]).bitcast::<U8>();
                let (low, high) = bytes(0).deinterleave(bytes(U16::LEN));
                let [a, b, c, d] = classify(high.simd_eq(0).select(low, b'a'));
                let plane = high & 0xFC;
                let no_char = (high & (low | 1)).simd_eq(0xFF);
                [
                    a,
                    b,
                    c,
                    d,
                    no_char,
                    plane.simd_eq(0xD8),
                    plane.simd_eq(0xDC),
                ]
            });
            let lone = trail & !(lead << 1 | lead_before) | lead & !(trail >> 1 | 1 << 63);
            if lead_before & !trail != 0 {
                out.push([base - 1]);
            }
            lead_before = lead >> 63;
            let bits = structural([a, b, c, d], &mut is_open) | no_char | lone;
            isa::bit_indices(bits).push_to(&mut out, base);
        }
        (state[0], state[1]) = (is_open.into(), lead_before);
        out.finish()
    }
}
