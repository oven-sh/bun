//! The arithmetic is that of libwebp (LICENSE.md): <https://github.com/webmproject/libwebp/tree/4fa21912338357f89e4fd51cf2368325b59e9bd9/src>
mod colors;
mod dct;
mod decoder;
mod encoder;

use bun_simd::{Isa, Lane, Vector};

// `None` means that the arguments do not fit together. A part of the work may be done.
pub use {colors::*, dct::*, decoder::*, encoder::*};

type Rgba = [u8; 4];

/// With the index of the vector above that of the lane in 16 bytes, rotates the bits of both `times`.
#[inline(always)]
fn rotate<T: Lane, const N: usize, I: Isa, const K: usize>(
    v: &mut [Vector<T, N, I>; K],
    times: usize,
) {
    #[rustc_unroll(full)]
    for _ in 0..times {
        let from = *v;
        #[rustc_unroll(full)]
        for i in 0..K / 2 {
            (v[2 * i], v[2 * i + 1]) = from[i].interleave_in_blocks(from[i + K / 2]);
        }
    }
}
