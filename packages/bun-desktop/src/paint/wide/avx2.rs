use std::arch::x86_64::*;

use super::super::scan::Floats;
use super::{Pixel, Samples};

pub type Eight = __m256i;
/// Two 16-bit numbers for each pixel.
pub type Factors = __m256i;

pub fn is_available() -> bool {
    is_x86_feature_detected!("avx2")
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn scale(pixels: Eight, by: Factors) -> Eight {
    let multiply = |it| {
        _mm256_mulhi_epu16(
            _mm256_add_epi16(_mm256_mullo_epi16(it, by), _mm256_set1_epi16(128)),
            _mm256_set1_epi16(257),
        )
    };
    let (even, odd) = (
        _mm256_and_si256(pixels, _mm256_set1_epi16(255)),
        _mm256_srli_epi16::<8>(pixels),
    );
    _mm256_or_si256(multiply(even), _mm256_slli_epi16::<8>(multiply(odd)))
}

#[cfg(any(test, windows))]
#[inline]
#[target_feature(enable = "avx2")]
pub fn scale_channels(pixels: Eight, by: Eight) -> Eight {
    let multiply = |a, b| {
        _mm256_mulhi_epu16(
            _mm256_add_epi16(_mm256_mullo_epi16(a, b), _mm256_set1_epi16(128)),
            _mm256_set1_epi16(257),
        )
    };
    let low = _mm256_set1_epi16(255);
    let even = multiply(_mm256_and_si256(pixels, low), _mm256_and_si256(by, low));
    _mm256_or_si256(
        even,
        _mm256_slli_epi16::<8>(multiply(
            _mm256_srli_epi16::<8>(pixels),
            _mm256_srli_epi16::<8>(by),
        )),
    )
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn add(a: Eight, b: Eight) -> Eight {
    _mm256_adds_epu8(a, b)
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn weigh(a: Eight, by_a: Factors, b: Eight, by_b: Factors) -> Eight {
    let sum = |a, b| {
        let sum = _mm256_min_epu16(
            _mm256_adds_epu16(_mm256_mullo_epi16(a, by_a), _mm256_mullo_epi16(b, by_b)),
            _mm256_set1_epi16(65025u16.cast_signed()),
        );
        _mm256_mulhi_epu16(
            _mm256_add_epi16(sum, _mm256_set1_epi16(128)),
            _mm256_set1_epi16(257),
        )
    };
    let even = sum(
        _mm256_and_si256(a, _mm256_set1_epi16(255)),
        _mm256_and_si256(b, _mm256_set1_epi16(255)),
    );
    _mm256_or_si256(
        even,
        _mm256_slli_epi16::<8>(sum(_mm256_srli_epi16::<8>(a), _mm256_srli_epi16::<8>(b))),
    )
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn change(by: Factors, [and, xor]: [Factors; 2]) -> Factors {
    _mm256_xor_si256(_mm256_and_si256(by, and), xor)
}

/// How much is left of what is behind.
#[inline]
#[target_feature(enable = "avx2")]
pub fn kept(pixels: Eight) -> Factors {
    let alphas = _mm256_broadcastsi128_si256(_mm_setr_epi8(
        3, -1, 3, -1, 7, -1, 7, -1, 11, -1, 11, -1, 15, -1, 15, -1,
    ));
    _mm256_shuffle_epi8(_mm256_xor_si256(pixels, _mm256_set1_epi8(-1)), alphas)
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn is_opaque(pixels: Eight) -> bool {
    _mm256_testc_si256(pixels, _mm256_set1_epi32(255 << 24)) != 0
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn is_clear(pixels: Eight) -> bool {
    _mm256_testz_si256(pixels, pixels) != 0
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn splat(by: u8) -> Factors {
    _mm256_set1_epi16(by.into())
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn spread(by: u64) -> Factors {
    let order = _mm256_setr_epi8(
        0, -1, 0, -1, 1, -1, 1, -1, 2, -1, 2, -1, 3, -1, 3, -1, 4, -1, 4, -1, 5, -1, 5, -1, 6, -1,
        6, -1, 7, -1, 7, -1,
    );
    _mm256_shuffle_epi8(_mm256_set1_epi64x(by.cast_signed()), order)
}

#[inline(always)]
pub fn prefetch(pixel: *const Pixel) {
    // SAFETY: it is a hint, for which any address will do.
    unsafe { _mm_prefetch::<_MM_HINT_T0>(pixel.cast()) };
}

/// Only for functions that have the feature.
#[derive(Clone, Copy)]
pub struct Numbers(__m256);

macro_rules! operations {
    ($($name:ident($a:ident, $b:ident) $body:expr;)*) => {$(
        #[inline(always)]
        fn $name(self, Numbers($b): Self) -> Self {
            let $a = self.0;
            // SAFETY: the processor has the instructions.
            Numbers(unsafe { $body })
        }
    )*};
}

impl Floats for Numbers {
    type Order = __m256i;

    #[inline(always)]
    fn choice(bits: u32) -> Self {
        // SAFETY: the processor has the instructions.
        Numbers(unsafe {
            _mm256_castsi256_ps(_mm256_sllv_epi32(
                _mm256_set1_epi32(bits.cast_signed()),
                _mm256_setr_epi32(31, 30, 29, 28, 27, 26, 25, 24),
            ))
        })
    }

    #[inline(always)]
    fn or(self, other: Self, choice: Self) -> Self {
        // SAFETY: likewise.
        Numbers(unsafe { _mm256_blendv_ps(other.0, self.0, choice.0) })
    }

    #[inline(always)]
    fn order(indices: [u8; 8]) -> __m256i {
        // SAFETY: likewise.
        unsafe { _mm256_cvtepu8_epi32(_mm_cvtsi64_si128(i64::from_le_bytes(indices))) }
    }

    #[inline(always)]
    fn reorder(self, order: __m256i) -> Self {
        // SAFETY: likewise.
        Numbers(unsafe { _mm256_permutevar8x32_ps(self.0, order) })
    }

    #[inline(always)]
    fn apart<R>(f: impl FnOnce() -> R) -> R {
        #[inline(never)]
        #[target_feature(enable = "avx2")]
        fn call<R>(f: impl FnOnce() -> R) -> R {
            f()
        }
        // SAFETY: the processor has the instructions.
        unsafe { call(f) }
    }

    #[inline(always)]
    fn all(self) -> [f32; 8] {
        // SAFETY: both are 32 bytes, for which any value will do.
        unsafe { std::mem::transmute::<__m256, [f32; 8]>(self.0) }
    }

    #[inline(always)]
    fn trunc(self) -> Self {
        // SAFETY: the processor has the instructions.
        Numbers(unsafe { _mm256_cvtepi32_ps(_mm256_cvttps_epi32(self.0)) })
    }

    #[inline(always)]
    fn whole(self) -> [i32; 8] {
        // SAFETY: likewise, and both are 32 bytes, for which any value will do.
        unsafe { std::mem::transmute::<__m256i, [i32; 8]>(_mm256_cvttps_epi32(self.0)) }
    }

    #[inline(always)]
    fn above(self, other: Self) -> u32 {
        // SAFETY: likewise.
        unsafe { _mm256_movemask_ps(_mm256_cmp_ps::<_CMP_GT_OQ>(self.0, other.0)) }.cast_unsigned()
    }

    #[inline(always)]
    fn new(all: [f32; 8]) -> Self {
        // SAFETY: both are 32 bytes, for which any value will do.
        Numbers(unsafe { std::mem::transmute::<[f32; 8], __m256>(all) })
    }

    operations! {
        add(a, b) _mm256_add_ps(a, b);
        sub(a, b) _mm256_sub_ps(a, b);
        mul(a, b) _mm256_mul_ps(a, b);
        min(a, b) _mm256_min_ps(a, b);
        max(a, b) _mm256_max_ps(a, b);
        after(a, b) _mm256_permutevar8x32_ps(_mm256_blend_ps::<0x80>(a, b), _mm256_setr_epi32(7, 0, 1, 2, 3, 4, 5, 6));
    }

    #[inline(always)]
    fn sqrt(self) -> Self {
        // SAFETY: the processor has the instructions.
        Numbers(unsafe { _mm256_sqrt_ps(self.0) })
    }

    #[inline(always)]
    fn bytes(self) -> [u8; 8] {
        // SAFETY: the processor has the instructions.
        unsafe {
            let all = _mm256_cvttps_epi32(self.0);
            let words = _mm_packs_epi32(
                _mm256_castsi256_si128(all),
                _mm256_extracti128_si256::<1>(all),
            );
            _mm_cvtsi128_si64(_mm_packus_epi16(words, words)).to_le_bytes()
        }
    }
}

/// `color` through `Floats::bytes` of the alphas.
#[inline]
#[target_feature(enable = "avx2")]
pub fn cover(pixels: Eight, color: Eight, alphas: Numbers) -> Eight {
    let multiply = |it, by| {
        _mm256_mulhi_epu16(
            _mm256_add_epi16(_mm256_mullo_epi16(it, by), _mm256_set1_epi16(128)),
            _mm256_set1_epi16(257),
        )
    };
    let halves = |it| {
        (
            _mm256_and_si256(it, _mm256_set1_epi16(255)),
            _mm256_srli_epi16::<8>(it),
        )
    };
    let by = _mm256_cvttps_epi32(alphas.0);
    let by = _mm256_packs_epi32(by, by);
    let by = _mm256_shuffle_epi8(
        _mm256_packus_epi16(by, by),
        _mm256_broadcastsi128_si256(_mm_setr_epi8(
            0, -1, 0, -1, 1, -1, 1, -1, 2, -1, 2, -1, 3, -1, 3, -1,
        )),
    );
    let ((even, odd), (even_below, odd_below)) = (halves(color), halves(pixels));
    let (even, odd) = (multiply(even, by), multiply(odd, by));
    let alphas = _mm256_broadcastsi128_si256(_mm_setr_epi8(
        2, -1, 2, -1, 6, -1, 6, -1, 10, -1, 10, -1, 14, -1, 14, -1,
    ));
    let kept = _mm256_xor_si256(_mm256_shuffle_epi8(odd, alphas), _mm256_set1_epi16(255));
    let (even, odd) = (
        _mm256_add_epi16(even, multiply(even_below, kept)),
        _mm256_add_epi16(odd, multiply(odd_below, kept)),
    );
    _mm256_or_si256(even, _mm256_slli_epi16::<8>(odd))
}

#[inline]
#[target_feature(enable = "avx2")]
pub fn spread_pairs(by: [[u8; 2]; 8]) -> [Factors; 2] {
    let first = _mm256_setr_epi8(
        0, -1, 0, -1, 2, -1, 2, -1, 4, -1, 4, -1, 6, -1, 6, -1, 8, -1, 8, -1, 10, -1, 10, -1, 12,
        -1, 12, -1, 14, -1, 14, -1,
    );
    // SAFETY: both are 16 bytes, for which any value will do.
    let by =
        _mm256_broadcastsi128_si256(unsafe { std::mem::transmute::<[[u8; 2]; 8], __m128i>(by) });
    [
        _mm256_shuffle_epi8(by, first),
        _mm256_shuffle_epi8(by, _mm256_or_si256(first, _mm256_set1_epi8(1))),
    ]
}

/// Between the pixels at the indices and those after them.
///
/// # Safety
/// They are all readable.
#[inline]
#[target_feature(enable = "avx2")]
unsafe fn neighbors(texels: *const Pixel, [a, b, c, d]: [u32; 4]) -> __m256i {
    // SAFETY: the caller's contract.
    let pair = |index: u32| unsafe { texels.add(index as usize).cast::<i64>().read_unaligned() };
    let neighbors = _mm256_broadcastsi128_si256(_mm_setr_epi8(
        0, 4, 1, 5, 2, 6, 3, 7, 8, 12, 9, 13, 10, 14, 11, 15,
    ));
    _mm256_shuffle_epi8(
        _mm256_setr_epi64x(pair(a), pair(b), pair(c), pair(d)),
        neighbors,
    )
}

/// # Safety
/// Likewise.
#[inline]
#[target_feature(enable = "avx2")]
unsafe fn across(texels: *const Pixel, at: [u32; 4], weights: __m256i) -> __m256i {
    // SAFETY: the caller's contract.
    _mm256_maddubs_epi16(
        weights,
        _mm256_xor_si256(unsafe { neighbors(texels, at) }, _mm256_set1_epi8(i8::MIN)),
    )
}

pub struct Stretcher(__m256i);

impl Stretcher {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn new(step: i32) -> Self {
        Stretcher(_mm256_mullo_epi32(
            _mm256_setr_epi32(0, 1, 2, 3, 4, 5, 6, 7),
            _mm256_set1_epi32(step),
        ))
    }

    /// # Safety
    /// There is a texel after that at `last`, which is not negative.
    #[inline]
    #[target_feature(enable = "avx2")]
    pub unsafe fn at(&self, line: *const Pixel, start: i32, last: i32) -> Eight {
        let low = _mm256_broadcastsi128_si256(_mm_setr_epi8(
            1, -1, 1, -1, 1, -1, 1, -1, 5, -1, 5, -1, 5, -1, 5, -1,
        ));
        let x = _mm256_min_epi32(
            _mm256_max_epi32(
                _mm256_add_epi32(_mm256_set1_epi32(start), self.0),
                _mm256_setzero_si256(),
            ),
            _mm256_set1_epi32(last),
        );
        let [a, b, c, d, e, f, g, h] =
            super::store(_mm256_srli_epi32::<16>(x)).map(u32::from_ne_bytes);
        let mix = |pairs, spread| {
            let difference = _mm256_sub_epi16(
                _mm256_srli_epi16::<8>(pairs),
                _mm256_and_si256(pairs, _mm256_set1_epi16(255)),
            );
            let change = _mm256_add_epi16(
                _mm256_mullo_epi16(difference, _mm256_shuffle_epi8(x, spread)),
                _mm256_set1_epi16(128),
            );
            _mm256_srli_epi16::<8>(_mm256_add_epi16(_mm256_slli_epi16::<8>(pairs), change))
        };
        // SAFETY: the caller's contract.
        let (first, second) =
            unsafe { (neighbors(line, [a, b, e, f]), neighbors(line, [c, d, g, h])) };
        _mm256_packus_epi16(
            mix(first, low),
            mix(second, _mm256_or_si256(low, _mm256_set1_epi8(8))),
        )
    }
}

pub struct Sampler<'a> {
    rows: [&'a [Pixel]; 2],
    width: __m256i,
    steps: [__m256i; 2],
    last: [__m256i; 2],
}

impl<'a> Sampler<'a> {
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn new(source: &Samples<'a>) -> Self {
        assert!(super::has_margin(source));
        let steps = source.step.map(|it| {
            _mm256_mullo_epi32(
                _mm256_setr_epi32(0, 1, 2, 3, 4, 5, 6, 7),
                _mm256_set1_epi32(it),
            )
        });
        let (rows, last) = (
            [source.texels, &source.texels[source.width..]],
            source.last.map(|it| _mm256_set1_epi32(it)),
        );
        Sampler {
            rows,
            width: _mm256_set1_epi32(source.width as i32),
            steps,
            last,
        }
    }

    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn at(&self, start: [i32; 2]) -> Eight {
        let low = _mm256_broadcastsi128_si256(_mm_setr_epi8(
            0, 1, 0, 1, 0, 1, 0, 1, 4, 5, 4, 5, 4, 5, 4, 5,
        ));
        let high = _mm256_or_si256(low, _mm256_set1_epi8(8));
        let place =
            |axis: usize| _mm256_add_epi32(_mm256_set1_epi32(start[axis]), self.steps[axis]);
        let clamp = |it, last| _mm256_min_epi32(_mm256_max_epi32(it, _mm256_setzero_si256()), last);
        let (x, y) = (clamp(place(0), self.last[0]), clamp(place(1), self.last[1]));
        let line = _mm256_mullo_epi32(_mm256_srli_epi32::<16>(y), self.width);
        let [a, b, c, d, e, f, g, h] =
            super::store(_mm256_add_epi32(line, _mm256_srli_epi32::<16>(x)))
                .map(u32::from_ne_bytes);
        let right = _mm256_and_si256(_mm256_srli_epi32::<9>(x), _mm256_set1_epi32(127));
        let weights = _mm256_add_epi32(
            _mm256_sub_epi32(_mm256_slli_epi32::<8>(right), right),
            _mm256_set1_epi32(128),
        );
        let down = _mm256_and_si256(_mm256_srli_epi32::<1>(y), _mm256_set1_epi32(0x7F00));
        let mix = |above, below, spread| {
            let change = _mm256_mulhrs_epi16(
                _mm256_sub_epi16(below, above),
                _mm256_shuffle_epi8(down, spread),
            );
            _mm256_srli_epi16::<7>(_mm256_add_epi16(
                _mm256_add_epi16(above, change),
                _mm256_set1_epi16(128 * 128 + 64),
            ))
        };
        let (first, second) = (
            _mm256_shuffle_epi8(weights, low),
            _mm256_shuffle_epi8(weights, high),
        );
        let (above, below) = (self.rows[0].as_ptr(), self.rows[1].as_ptr());
        // SAFETY: the column and the row are at most the last ones, after which there is another.
        let (first, second) = unsafe {
            let first = mix(
                across(above, [a, b, e, f], first),
                across(below, [a, b, e, f], first),
                low,
            );
            (
                first,
                mix(
                    across(above, [c, d, g, h], second),
                    across(below, [c, d, g, h], second),
                    high,
                ),
            )
        };
        _mm256_packus_epi16(first, second)
    }
}
