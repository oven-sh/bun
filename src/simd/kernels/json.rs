//! Stage 1 in the manner of simdjson.
use crate::ByteSet;
use bun_simd::{Out, blocks};
use class::{STRUCTURAL, WHITESPACE};

pub use simd::index_chunk;

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

pub const HAS_BACKSLASH_IN_STRING: u32 = 1 << 0;
pub const HAS_CONTROL_IN_STRING: u32 = 1 << 1;

/// How the chunk before ended.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct State {
    pub is_escaped: bool,
    pub is_in_string: bool,
    pub is_in_scalar: bool,
}

#[bun_simd::foreach_target]
mod simd {
    use crate::byte_set::simd::this_target::class;
    use isa::U8;

    /// `None` if the scalar indexer has to take over: there is an oddity, or no more room.
    #[export(up_to = neon)]
    pub fn index_chunk<'a>(
        text: &[u8],
        base_offset: usize,
        out: Out<'a, u32>,
        dirty_out: &mut [u64],
        state: &mut State,
    ) -> Option<(&'a mut [u32], u32)> {
        let mut prev_escaped = u64::from(state.is_escaped);
        let mut prev_in_string = u64::from(state.is_in_string).wrapping_neg();
        let mut prev_scalar = u64::from(state.is_in_scalar);
        let (mut bs_in_str, mut ctrl_in_str, mut dirty_acc) = (0u64, 0u64, 0u64);
        let mut out = out.into_writer();

        for (block, bytes) in blocks(text, &mut [b' '; 64]).enumerate() {
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
                *dirty_out.get_mut(block >> 6)? = core::mem::take(&mut dirty_acc);
            }
            if odd & !in_str != 0 || out.remaining() < 64 {
                return None;
            }

            let scalar = !opws & !in_str & !real_quote;
            let scalar_start = scalar & !((scalar << 1) | prev_scalar);
            prev_scalar = scalar >> 63;
            let emit = (op & !in_str) | real_quote | scalar_start;

            isa::bit_indices(emit).push_to(&mut out, (base_offset + 64 * block) as u32);
        }

        let count = text.len().div_ceil(64);
        if count & 63 != 0 {
            *dirty_out.get_mut(count >> 6)? = dirty_acc;
        }
        *state = State {
            is_escaped: prev_escaped != 0,
            is_in_string: prev_in_string != 0,
            is_in_scalar: prev_scalar != 0,
        };
        let backslash = u32::from(bs_in_str != 0) * HAS_BACKSLASH_IN_STRING;
        let control = u32::from(ctrl_in_str != 0) * HAS_CONTROL_IN_STRING;
        Some((out.finish(), backslash | control))
    }
}
