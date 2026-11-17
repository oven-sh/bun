use std::arch::aarch64::*;

use super::{Pixel, Samples};

pub type Eight = [uint8x16_t; 2];
/// One for each byte.
pub type Factors = [uint8x16_t; 2];

pub fn is_available() -> bool {
    cfg!(target_feature = "neon")
}

#[inline(always)]
fn bytes(all: [u8; 16]) -> uint8x16_t {
    // SAFETY: both are 16 bytes, for which any value will do.
    unsafe { std::mem::transmute(all) }
}

/// For each of four pixels the byte of `table` at an index.
#[inline]
#[target_feature(enable = "neon")]
fn pick(table: uint8x16_t, [a, b, c, d]: [u8; 4]) -> uint8x16_t {
    vqtbl1q_u8(
        table,
        bytes([a, a, a, a, b, b, b, b, c, c, c, c, d, d, d, d]),
    )
}

#[inline]
#[target_feature(enable = "neon")]
fn multiply(a: uint8x16_t, b: uint8x16_t) -> uint8x16_t {
    let (low, high) = (
        vmull_u8(vget_low_u8(a), vget_low_u8(b)),
        vmull_high_u8(a, b),
    );
    vraddhn_high_u16(
        vraddhn_u16(low, vrshrq_n_u16::<8>(low)),
        high,
        vrshrq_n_u16::<8>(high),
    )
}

#[inline]
#[target_feature(enable = "neon")]
pub fn scale(pixels: Eight, by: Factors) -> Eight {
    [multiply(pixels[0], by[0]), multiply(pixels[1], by[1])]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn add(a: Eight, b: Eight) -> Eight {
    [vqaddq_u8(a[0], b[0]), vqaddq_u8(a[1], b[1])]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn weigh(a: Eight, by_a: Factors, b: Eight, by_b: Factors) -> Eight {
    let four = |half: usize| {
        let (a, by_a, b, by_b) = (a[half], by_a[half], b[half], by_b[half]);
        let low = vqaddq_u16(
            vmull_u8(vget_low_u8(a), vget_low_u8(by_a)),
            vmull_u8(vget_low_u8(b), vget_low_u8(by_b)),
        );
        let high = vqaddq_u16(vmull_high_u8(a, by_a), vmull_high_u8(b, by_b));
        let (low, high) = (
            vminq_u16(low, vdupq_n_u16(65025)),
            vminq_u16(high, vdupq_n_u16(65025)),
        );
        vraddhn_high_u16(
            vraddhn_u16(low, vrshrq_n_u16::<8>(low)),
            high,
            vrshrq_n_u16::<8>(high),
        )
    };
    [four(0), four(1)]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn change(by: Factors, [and, xor]: [Factors; 2]) -> Factors {
    [
        veorq_u8(vandq_u8(by[0], and[0]), xor[0]),
        veorq_u8(vandq_u8(by[1], and[1]), xor[1]),
    ]
}

/// How much is left of what is behind.
#[inline]
#[target_feature(enable = "neon")]
pub fn kept(pixels: Eight) -> Factors {
    [
        pick(vmvnq_u8(pixels[0]), [3, 7, 11, 15]),
        pick(vmvnq_u8(pixels[1]), [3, 7, 11, 15]),
    ]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn is_opaque(pixels: Eight) -> bool {
    vminvq_u32(vreinterpretq_u32_u8(vandq_u8(pixels[0], pixels[1]))) >= 255 << 24
}

#[inline]
#[target_feature(enable = "neon")]
pub fn is_clear(pixels: Eight) -> bool {
    vmaxvq_u32(vreinterpretq_u32_u8(vorrq_u8(pixels[0], pixels[1]))) == 0
}

#[inline]
#[target_feature(enable = "neon")]
pub fn splat(by: u8) -> Factors {
    [vdupq_n_u8(by); 2]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn spread(by: u64) -> Factors {
    let by = vreinterpretq_u8_u64(vdupq_n_u64(by));
    [pick(by, [0, 1, 2, 3]), pick(by, [4, 5, 6, 7])]
}

#[inline]
#[target_feature(enable = "neon")]
pub fn spread_pairs(by: [[u8; 2]; 8]) -> [Factors; 2] {
    // SAFETY: both are 16 bytes, for which any value will do.
    let by = unsafe { std::mem::transmute::<[[u8; 2]; 8], uint8x16_t>(by) };
    [
        [pick(by, [0, 2, 4, 6]), pick(by, [8, 10, 12, 14])],
        [pick(by, [1, 3, 5, 7]), pick(by, [9, 11, 13, 15])],
    ]
}

/// Between the pixels at the indices and those after them.
///
/// # Safety
/// They are all readable.
#[inline]
#[target_feature(enable = "neon")]
unsafe fn across(
    texels: *const Pixel,
    [a, b, c, d]: [u32; 4],
    right: uint8x16_t,
) -> [int16x8_t; 2] {
    // SAFETY: the caller's contract.
    let pair = |index: u32| {
        vcreate_u32(unsafe { texels.add(index as usize).cast::<u64>().read_unaligned() })
    };
    let (first, second, left) = (
        vcombine_u32(pair(a), pair(b)),
        vcombine_u32(pair(c), pair(d)),
        vsubq_u8(vdupq_n_u8(64), right),
    );
    let (near, far) = (
        vreinterpretq_u8_u32(vuzp1q_u32(first, second)),
        vreinterpretq_u8_u32(vuzp2q_u32(first, second)),
    );
    let low = vmlal_u8(
        vmull_u8(vget_low_u8(near), vget_low_u8(left)),
        vget_low_u8(far),
        vget_low_u8(right),
    );
    [
        vreinterpretq_s16_u16(low),
        vreinterpretq_s16_u16(vmlal_high_u8(vmull_high_u8(near, left), far, right)),
    ]
}

pub struct Sampler<'a> {
    rows: [&'a [Pixel]; 2],
    width: u32,
    /// For each half.
    steps: [[int32x4_t; 2]; 2],
    last: [int32x4_t; 2],
}

impl<'a> Sampler<'a> {
    #[inline]
    #[target_feature(enable = "neon")]
    pub fn new(source: &Samples<'a>) -> Self {
        assert!(super::has_margin(source));
        let count = |from: u8| {
            vreinterpretq_s32_u8(bytes([
                from,
                0,
                0,
                0,
                from + 1,
                0,
                0,
                0,
                from + 2,
                0,
                0,
                0,
                from + 3,
                0,
                0,
                0,
            ]))
        };
        let steps = [0, 4].map(|from| source.step.map(|it| vmulq_n_s32(count(from), it)));
        let (rows, last) = (
            [source.texels, &source.texels[source.width..]],
            source.last.map(|it| vdupq_n_s32(it)),
        );
        Sampler {
            rows,
            width: source.width as u32,
            steps,
            last,
        }
    }

    #[inline]
    #[target_feature(enable = "neon")]
    fn four(&self, start: [i32; 2], steps: [int32x4_t; 2]) -> uint8x16_t {
        let place = |axis: usize| {
            vreinterpretq_u32_s32(vminq_s32(
                vmaxq_s32(
                    vaddq_s32(vdupq_n_s32(start[axis]), steps[axis]),
                    vdupq_n_s32(0),
                ),
                self.last[axis],
            ))
        };
        let (x, y) = (place(0), place(1));
        let at = vmlaq_n_u32(vshrq_n_u32::<16>(x), vshrq_n_u32::<16>(y), self.width);
        let at = [
            vgetq_lane_u32::<0>(at),
            vgetq_lane_u32::<1>(at),
            vgetq_lane_u32::<2>(at),
            vgetq_lane_u32::<3>(at),
        ];
        let right = pick(vshrq_n_u8::<2>(vreinterpretq_u8_u32(x)), [1, 5, 9, 13]);
        let down = vreinterpretq_u8_u32(vandq_u32(vshrq_n_u32::<1>(y), vdupq_n_u32(0x7E00)));
        let mix = |above, below, from: u8| {
            let order = vaddq_u8(
                bytes([0, 1, 0, 1, 0, 1, 0, 1, 4, 5, 4, 5, 4, 5, 4, 5]),
                vdupq_n_u8(from),
            );
            vaddq_s16(
                above,
                vqrdmulhq_s16(
                    vsubq_s16(below, above),
                    vreinterpretq_s16_u8(vqtbl1q_u8(down, order)),
                ),
            )
        };
        // SAFETY: the column and the row are at most the last ones, after which there is another.
        let (above, below) = unsafe {
            (
                across(self.rows[0].as_ptr(), at, right),
                across(self.rows[1].as_ptr(), at, right),
            )
        };
        vqrshrun_high_n_s16::<6>(
            vqrshrun_n_s16::<6>(mix(above[0], below[0], 0)),
            mix(above[1], below[1], 8),
        )
    }

    #[inline]
    #[target_feature(enable = "neon")]
    pub fn at(&self, start: [i32; 2]) -> Eight {
        [
            self.four(start, self.steps[0]),
            self.four(start, self.steps[1]),
        ]
    }
}
