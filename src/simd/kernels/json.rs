//! Stage 1 in the manner of simdjson.
use crate::ByteSet;
use bun_simd::{Out, blocks};
use class::{STRUCTURAL, WHITESPACE};

const CLASSES: ByteSet = ByteSet {
    rows: [
        0x48, 0x40, 0x32, 0x04, 0x00, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    columns: [
        0x50, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x60, 0x40, 0x48, 0x4c, 0x41, 0x42, 0x49, 0x40,
        0x60,
    ],
};
/// For the scalar indexer, which has to agree with the kernel.
pub mod class {
    pub static OF_BYTE: [u8; 256] = super::CLASSES.classes();
    pub const STRUCTURAL: u8 = 0x07;
    pub const WHITESPACE: u8 = 0x18;
}
/// `/` and `'`
const ODDITY: u8 = 0x20;
/// Below 0x20
const CONTROL: u8 = 0x40;
/// The scalar indexer has to take over: there is an oddity, or no more room.
const GIVES_UP: u32 = 1 << 3;

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use crate::byte_set::simd::this_target::class;
    use isa::U8;

    #[export(up_to = neon)]
    pub fn index_chunk<'a>(
        input: &[u8],
        base_offset: usize,
        out: Out<'a, u32>,
        dirty_out: &mut [u64],
        state: &mut [u64; 3],
    ) -> (&'a mut [u32], u32) {
        let [mut prev_escaped, mut prev_in_string, mut prev_scalar] = *state;
        let (mut bs_in_str, mut ctrl_in_str, mut dirty_acc) = (0u64, 0u64, 0u64);
        let mut out = out.into_writer();

        for (block, bytes) in blocks(input, &mut [b' '; 64]).enumerate() {
            let [bs, quote, op, opws, odd, ctrl] = U8::bitmasks(bytes, |v| {
                let class = class(v, &CLASSES);
                let lacks = |bits: u8| (class & bits).simd_eq(0);
                [
                    v.simd_eq(b'\\'),
                    v.simd_eq(b'"'),
                    lacks(STRUCTURAL),
                    lacks(STRUCTURAL | WHITESPACE),
                    lacks(ODDITY),
                    lacks(CONTROL),
                ]
            });
            let (op, opws, odd, ctrl) = (!op, !opws, !odd, !ctrl);

            let escaped = if bs == 0 {
                core::mem::take(&mut prev_escaped)
            } else {
                const EVEN: u64 = 0x5555_5555_5555_5555;
                let bs = bs & !prev_escaped;
                let follows_escape = (bs << 1) | prev_escaped;
                let (on_even, carry) = (bs & !EVEN & !follows_escape).overflowing_add(bs);
                prev_escaped = u64::from(carry);
                (EVEN ^ (on_even << 1)) & follows_escape
            };

            let real_quote = quote & !escaped;
            let in_str = isa::prefix_xor(real_quote) ^ prev_in_string;
            prev_in_string = ((in_str as i64) >> 63) as u64;

            bs_in_str |= bs & in_str;
            ctrl_in_str |= ctrl & in_str;
            dirty_acc |= u64::from((bs | ctrl) & in_str != 0) << (block & 63);
            if block & 63 == 63 {
                let Some(dirty) = dirty_out.get_mut(block >> 6) else {
                    return (&mut [], GIVES_UP);
                };
                *dirty = core::mem::take(&mut dirty_acc);
            }
            if odd & !in_str != 0 || out.remaining() < 64 {
                return (&mut [], GIVES_UP);
            }

            let scalar = !opws & !in_str & !real_quote;
            let scalar_start = scalar & !((scalar << 1) | prev_scalar);
            prev_scalar = scalar >> 63;
            let emit = (op & !in_str) | real_quote | scalar_start;

            isa::bit_indices(emit).push_to(&mut out, (base_offset + 64 * block) as u32);
        }

        let count = input.len().div_ceil(64);
        if count & 63 != 0 {
            let Some(dirty) = dirty_out.get_mut(count >> 6) else {
                return (&mut [], GIVES_UP);
            };
            *dirty = dirty_acc;
        }
        *state = [prev_escaped, prev_in_string, prev_scalar];
        (
            out.finish(),
            u32::from(bs_in_str != 0) | u32::from(ctrl_in_str != 0) << 1,
        )
    }
}
