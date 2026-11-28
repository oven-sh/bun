use super::{Image, Pixel};
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// x64 multiplies and adds neighboring lanes, so it has R and G of all colors interleaved, then B and A.
const PLANES: usize = if cfg!(target_arch = "aarch64") { 4 } else { 2 };
#[simd]
type Keys = Simd<i32, Native<S>, S>;

/// The nearest color `c` to `p` has the least `c * c - 2 * c * p`. That is the key, above 8 bits for the index.
struct Search {
    len: usize,
    squares: [i32; 256],
    factors: [[i16; 1024 / PLANES]; PLANES],
    colors: [Pixel; 256],
}

#[simd]
impl Search {
    fn new(palette: &[Pixel]) -> Self {
        let len = palette.len().next_multiple_of(Keys::LANES);
        let mut search = Self {
            len,
            squares: [i32::MAX; 256],
            factors: [[0; _]; _],
            colors: [[0; 4]; 256],
        };
        for (i, &color) in palette.iter().enumerate().take(256) {
            search.colors[i] = color;
            search.squares[i] =
                color.iter().map(|&c| i32::from(c).pow(2)).sum::<i32>() << 8 | i as i32;
            for (c, value) in color.into_iter().enumerate() {
                search.factors[c * PLANES / 4][(4 * i + c * PLANES % 4) / PLANES] =
                    -4 * i16::from(value);
            }
        }
        search
    }

    /// The lanes of `color` are 0 to 255.
    fn nearest(&self, color: i32x4<S>) -> u8 {
        let color = (color << 7).saturating_cast::<i16>();
        let mut best = Keys::splat(i32::MAX);
        for at in (0..self.len.min(256)).step_by(Keys::LANES) {
            let mut key = Keys::load_at(&self.squares, at);
            for (i, plane) in self.factors.iter().enumerate() {
                key = if PLANES == 4 {
                    key + Simd::<i16, Half<Native<S>>, S>::load_at(plane, at)
                        .cast_mul::<i32>(color[i])
                        .resize()
                } else {
                    i16xN::load_at(plane, 2 * at).dot_add_relaxed::<i32>(
                        Keys::splat(color.bitcast::<i32>()[i]).bitcast(),
                        key,
                    )
                };
            }
            best = best.simd_min(key);
        }
        best.reduce_min() as u8
    }
}

#[simd]
fn widen(pixel: Pixel) -> i32x4<S> {
    u8x4::from(pixel).cast()
}

#[kernel]
pub(crate) fn nearest(pixels: &[Pixel], palette: &[Pixel], indices: &mut [u8]) {
    let search = Search::new(palette);
    for (&pixel, index) in pixels.iter().zip(indices) {
        *index = search.nearest(widen(pixel));
    }
}

/// Floyd–Steinberg error diffusion: what a pixel misses its color by goes to the neighbors that are still to come, in
/// sixteenths. The direction changes with each row, against the artefacts of a fixed one.
///
/// ```text
/// ·   X   7
/// 3   5   1
/// ```
///
/// `errors` has zeros, for a row and one more on each side. They need 32 bits: where the palette doesn't span the
/// range of the image, they grow without bound.
#[kernel]
pub(crate) fn dither(
    image: Image<'_>,
    palette: &[Pixel],
    errors: &mut [[i32; 4]],
    indices: &mut [u8],
) {
    let (search, width) = (Search::new(palette), image.width);
    let errors = &mut errors[..width + 2];
    let rows = image
        .pixels
        .chunks_exact(width)
        .zip(indices.chunks_exact_mut(width));
    for (y, (row, indices)) in rows.enumerate() {
        let (mut x, step) = if y % 2 == 0 { (0, 1) } else { (width - 1, -1) };
        // For the next pixel, and so far for those below the last one and below this one.
        let [mut ahead, mut behind, mut below] = [i32x4::zero(); 3];
        for _ in 0..width {
            let wanted = widen(row[x]) + i32x4::from(errors[x + 1]) + ahead;
            let index = search.nearest(wanted.simd_clamp(0, 255));
            indices[x] = index;
            let error = wanted - widen(search.colors[usize::from(index)]);
            ahead = (error * 7) >> 4;
            // Where it was used already, `errors` is for the next row.
            errors[(x + 1).wrapping_sub_signed(step)] = (behind + ((error * 3) >> 4)).to_array();
            behind = below + ((error * 5) >> 4);
            below = error >> 4;
            x = x.wrapping_add_signed(step);
        }
        errors[x.wrapping_add(1).wrapping_sub_signed(step)] = behind.to_array();
    }
}

#[kernel]
pub(crate) fn extremes(pixels: &[u32]) -> [Pixel; 2] {
    let join = |[a, b]: [u8xN<S>; 2], [c, d]: [u8xN<S>; 2]| [a.simd_max(c), b.simd_max(d)];
    let all = over(pixels).pad(pixels.first().copied().unwrap_or_default());
    let both = all.fold(
        [u8xN::zero(); 2],
        |both, v| join(both, [!v.bitcast(), v.bitcast()]),
        join,
    );
    let [not_min, max] = array::map(both, |it| {
        let mut max = u8x4::zero();
        it.for_each_part(|_, part| max = max.simd_max(part));
        max
    });
    [(!not_min).to_array(), max.to_array()]
}
