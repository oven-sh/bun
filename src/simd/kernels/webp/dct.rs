use super::rotate;
use core::array::from_fn;

pub use simd::inverse_dct;

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
pub(super) mod simd {
    use isa::I16;

    /// RFC 6386, 14.4. The factors are 85627 and 35468, less 65536.
    #[inline(always)]
    pub fn inverse_dct_pass([q0, q1, q2, q3]: [I16; 4]) -> [I16; 4] {
        let (cos, sin) = (I16::splat(20091), I16::splat(-30068));
        let c = q1 - q3 + q1.mul_high(sin) - q3.mul_high(cos);
        let d = q1 + q3 + q1.mul_high(cos) + q3.mul_high(sin);
        let (a, b) = (q0 + q2, q0 - q2);
        [a + d, b + c, b - c, a - d]
    }

    /// For 6 times 4 blocks side by side. 4 with no bit in `non_zero` stay. Others with none are zero.
    #[export]
    pub fn inverse_dct(coefficients: &mut [[i16; 64]; 6], mut non_zero: u32) {
        const BLOCKS: usize = I16::LEN / 4;
        const { assert!(BLOCKS <= 4) };
        // All sums wrap, as in `Transform_SSE2` of libwebp.
        #[rustc_unroll(never)]
        for block in 0..24 / BLOCKS {
            let is_any = !non_zero.is_multiple_of(1 << BLOCKS);
            non_zero >>= BLOCKS;
            if !is_any {
                continue;
            }
            let (y, x) = (block * BLOCKS / 4, block * BLOCKS % 4 * 4);
            let rows = coefficients[y].as_chunks_mut::<16>().0;
            let mut v = inverse_dct_pass(from_fn(|i| I16::from_slice(&rows[i][x..])));
            rotate(&mut v, 3);
            v[0] += 4;
            v = inverse_dct_pass(v);
            rotate(&mut v, 2);
            for i in 0..4 {
                (v[i] >> 3).copy_to_slice(&mut rows[i][x..]);
            }
        }
    }
}
