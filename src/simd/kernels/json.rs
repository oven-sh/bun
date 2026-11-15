//! Port of highway_json.cpp: stage 1 in the manner of simdjson.
use core::mem::MaybeUninit;

const LUT_LO: [u8; 16] = [
    0x50, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x60, 0x40, 0x48, 0x4c, 0x41, 0x42, 0x49, 0x40, 0x60,
];
const LUT_HI: [u8; 16] = [
    0x48, 0x40, 0x32, 0x04, 0x00, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0,
];
const STRUCTURAL: u8 = 0x07;
const WHITESPACE: u8 = 0x18;
const ODDITY: u8 = 0x20;
const CONTROL: u8 = 0x40;
/// The scalar indexer has to take over: there is an oddity, or no more room.
const GIVES_UP: u32 = 1 << 3;

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, U32};

    #[export]
    pub fn index_chunk(
        input: &[u8],
        base_offset: usize,
        out: &mut [MaybeUninit<u32>],
        dirty_out: &mut [u64],
        state: &mut [u64; 3],
    ) -> (usize, u32) {
        let (lut_lo, lut_hi) = (U8::table(&LUT_LO), U8::table(&LUT_HI));
        let [mut prev_escaped, mut prev_in_string, mut prev_scalar] = *state;
        let (mut bs_in_str, mut ctrl_in_str, mut dirty_acc) = (0u64, 0u64, 0u64);
        let mut n_out = 0;
        let mut tail = [0u8; 64];

        for (block, bytes) in input.chunks(64).enumerate() {
            let (bytes, valid): (&[u8; 64], u64) = match bytes.as_array() {
                Some(whole) => (whole, u64::MAX),
                None => {
                    tail[..bytes.len()].copy_from_slice(bytes);
                    (&tail, (1 << bytes.len()) - 1)
                }
            };
            let [bs, quote, op, opws, odd, ctrl] = isa::bits_of(bytes, |v| {
                let class = lut_lo.lookup(v & 0x0F) & lut_hi.lookup(v >> 4);
                let lacks = |bits: u8| (class & bits).eq(0);
                [
                    v.eq(b'\\'),
                    v.eq(b'"'),
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

            bs_in_str |= bs & in_str & valid;
            ctrl_in_str |= ctrl & in_str & valid;
            dirty_acc |= u64::from((bs | ctrl) & in_str & valid != 0) << (block & 63);
            if block & 63 == 63 {
                let Some(dirty) = dirty_out.get_mut(block >> 6) else {
                    return (0, GIVES_UP);
                };
                *dirty = core::mem::take(&mut dirty_acc);
            }
            if odd & !in_str & valid != 0 {
                return (0, GIVES_UP);
            }

            let scalar = !opws & !in_str & !real_quote;
            let scalar_start = scalar & !((scalar << 1) | prev_scalar);
            prev_scalar = scalar >> 63;
            let emit = ((op & !in_str) | real_quote | scalar_start) & valid;

            // One check for the block: what it emits fits 64 slots, whole vectors included.
            let Some(window) = out
                .get_mut(n_out..)
                .and_then(|rest| rest.first_chunk_mut::<64>())
            else {
                return (0, GIVES_UP);
            };
            let base = (base_offset + 64 * block) as u32;
            for k in (0..64).step_by(U32::LANES) {
                let before = (emit & ((1 << k) - 1)).count_ones() as usize;
                (U32::iota() + (base + k as u32))
                    .compress(emit >> k)
                    .write_to(&mut window[before..]);
            }
            n_out += emit.count_ones() as usize;
        }

        let blocks = input.len().div_ceil(64);
        if blocks & 63 != 0 {
            let Some(dirty) = dirty_out.get_mut(blocks >> 6) else {
                return (0, GIVES_UP);
            };
            *dirty = dirty_acc;
        }
        *state = [prev_escaped, prev_in_string, prev_scalar];
        (
            n_out,
            u32::from(bs_in_str != 0) | u32::from(ctrl_in_str != 0) << 1,
        )
    }
}
