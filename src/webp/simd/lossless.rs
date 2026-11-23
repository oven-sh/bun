//! The lossless decoder, whose pixels have alpha last, and what the encoder counts for a tile.

use bun_simd::prelude::*;

targets!(Upto<B32>);

type Pixel = [u8; 4];
/// In the lowest four bytes. LLVM makes scalar code of some operations on four bytes, and pads them for others.
#[simd]
type VPixel = u8x16<S>;

#[simd]
#[expect(clippy::trivially_copy_pass_by_ref, reason = "loaded from where it is")]
fn load(pixel: &Pixel) -> VPixel<S> {
    // Or LLVM computes in general registers, and moves the results.
    let lanes = [u32::from_le_bytes(*pixel), 0, 0, 0];
    u32x4::from(lanes).bitcast().black_box()
}

#[simd]
fn store(v: VPixel<S>, pixel: &mut Pixel) {
    v.resize::<B4>().store(pixel);
}

#[simd]
fn predict<const MODE: u8, W: Width>(a: Simd<u8, W, S>, b: Simd<u8, W, S>) -> Simd<u8, W, S> {
    match MODE {
        2..=4 => a,
        8 | 9 => a.midpoint(b),
        _ => Simd::repeat(&[0, 0, 0, 255]),
    }
}

/// Pixels that do not depend on each other.
#[simd]
fn add_to_all<const MODE: u8>(
    mut left: VPixel<S>,
    row: &mut [Pixel],
    above: &[Pixel],
) -> VPixel<S> {
    let first = match MODE {
        3 => 2,
        2 | 9 => 1,
        _ => 0,
    };
    let n = row.len();
    let (a, b) = (
        &above[first..first + n],
        &above[2.min(first + 1)..2.min(first + 1) + n],
    );
    let ((row8, row), (a8, a), (b8, b)) = (
        row.as_chunks_mut::<8>(),
        a.as_chunks::<8>(),
        b.as_chunks::<8>(),
    );
    let mut four = repeated(left);
    for i in 0..row8.len() {
        not_unrolled();
        let predicted = predict::<MODE, _, S>(
            u8x32::load(a8[i].as_flattened()),
            u8x32::load(b8[i].as_flattened()),
        );
        let eight = u8x32::load(row8[i].as_flattened()) + predicted;
        eight.store(row8[i].as_flattened_mut());
        four = eight.split()[1];
    }
    if row.is_empty() {
        return four.shift_elements_left::<12>(0);
    }
    let at = row.len() & 4;
    if at != 0 {
        let predicted =
            predict::<MODE, _, S>(u8x16::load(a.as_flattened()), u8x16::load(b.as_flattened()));
        four = u8x16::load(row.as_flattened()) + predicted;
        four.store(row.as_flattened_mut());
        left = four.shift_elements_left::<12>(0);
    }
    for i in at..row.len() {
        not_unrolled();
        left = load(&row[i]) + predict::<MODE, _, S>(load(&a[i]), load(&b[i]));
        store(left, &mut row[i]);
    }
    if MODE == 0 {
        left = left.resize::<B4>().resize();
    }
    left
}

#[simd]
fn repeated(pixel: VPixel<S>) -> u8x16<S> {
    pixel.bitcast::<u32>().splat_lane::<0>().bitcast()
}

/// The first of four pixels, the sum of the first two and so on.
#[simd]
fn running_sums(pixels: u8x16<S>) -> u8x16<S> {
    let sums = pixels + pixels.shift_elements_right::<4>(0);
    sums + sums.shift_elements_right::<8>(0)
}

#[simd]
fn add_left(left: VPixel<S>, row: &mut [Pixel]) -> VPixel<S> {
    let mut lefts = repeated(left);
    let (quads, rest) = row.as_chunks_mut::<4>();
    for quad in quads {
        not_unrolled();
        let sums = running_sums(u8x16::load(quad.as_flattened()));
        (sums + lefts).store(quad.as_flattened_mut());
        lefts += sums.bitcast::<u32>().splat_lane::<3>().bitcast();
    }
    for pixel in rest {
        not_unrolled();
        lefts += load(pixel);
        store(lefts, pixel);
    }
    lefts.resize::<B4>().resize()
}

#[cfg(target_arch = "aarch64")]
type AverageWidth = B8;
#[cfg(not(target_arch = "aarch64"))]
type AverageWidth = B16;

/// On x86, an average that rounds down is one that rounds up with all bits inverted. To keep the pixels inverted makes
/// the way from one to the next the shortest.
#[simd]
fn add_average<const MODE: u8>(left: VPixel<S>, row: &mut [Pixel], above: &[Pixel]) -> VPixel<S> {
    const ARM: bool = cfg!(target_arch = "aarch64");
    type Few = Simd<u8, AverageWidth, S>;
    let flip = |v: Few<S>| if ARM { v } else { !v };
    let mean = |a: Few<S>, b: Few<S>| {
        if ARM { a.midpoint(b) } else { a.midpoint_up(b) }
    };
    let (mut l, mut tl) = (flip(left.resize()), flip(load(&above[0]).resize()));
    for (pixel, two) in row.iter_mut().zip(above[1..].array_windows::<2>()) {
        not_unrolled();
        // Four bytes go through a general register on Arm if the address is advanced by the load.
        let (t, tr): (Few<S>, Few<S>) = if ARM {
            let both = u8x8::load(two.as_flattened());
            (both.resize(), both.rotate_elements_left::<4>().resize())
        } else {
            (!load(&two[0]).resize(), !load(&two[1]).resize())
        };
        let predicted = match MODE {
            5 => mean(mean(l, tr), t),
            6 => mean(l, tl),
            7 => mean(l, t),
            10 => mean(mean(l, tl), mean(t, tr)),
            _ => {
                let middle = mean(l, t);
                middle
                    .saturating_add(middle.saturating_sub(tl) >> 1)
                    .saturating_sub(tl.saturating_sub(middle) >> 1)
            }
        };
        let residual: Few<S> = load(pixel).resize();
        l = if ARM {
            predicted + residual
        } else {
            predicted - residual
        };
        store(flip(l).resize(), pixel);
        tl = t;
    }
    flip(l).resize()
}

/// On x86, the other bytes are zero in both.
#[simd]
fn distance(from: VPixel<S>, tl: VPixel<S>) -> i32x4<S> {
    if cfg!(target_arch = "aarch64") {
        from.abs_diff(tl).sum_groups::<u32>().bitcast()
    } else {
        from.abs_diff_sum::<u64>(tl).bitcast()
    }
}

#[simd]
#[expect(clippy::trivially_copy_pass_by_ref, reason = "loaded from where it is")]
fn gradient<const MODE: u8>(l: VPixel<S>, above: &[Pixel; 2], pixel: &mut Pixel) -> VPixel<S> {
    let (tl, t, residual) = (load(&above[0]), load(&above[1]), load(pixel));
    let next = if MODE == 11 {
        let take_left = distance(l, tl).simd_gt(distance(t, tl));
        take_left
            .select(
                (l + residual).bitcast::<i32>(),
                (t + residual).bitcast::<i32>(),
            )
            .bitcast()
    } else {
        l.saturating_add(t.saturating_sub(tl))
            .saturating_sub(tl.saturating_sub(t))
            + residual
    };
    store(next, pixel);
    next
}

/// For predictors that give the left pixel if the two above are alike.
#[simd]
fn add_gradient<const MODE: u8>(
    mut left: VPixel<S>,
    mut row: &mut [Pixel],
    mut above: &[Pixel],
) -> VPixel<S> {
    while let (Some(top), true) = (above.first_chunk::<5>(), row.len() >= 4) {
        let (quad, rest) = row.split_at_mut(4);
        if u8x16::load(top.as_flattened()) == u8x16::load_last(top.as_flattened()) {
            let pixels = running_sums(u8x16::load(quad.as_flattened())) + repeated(left);
            pixels.store(quad.as_flattened_mut());
            left = pixels.shift_elements_left::<12>(0);
        } else {
            for (pixel, top) in quad.iter_mut().zip(top.array_windows()) {
                left = gradient::<MODE, S>(left, top, pixel);
            }
        }
        (row, above) = (rest, &above[4..]);
    }
    for (pixel, top) in row.iter_mut().zip(above.array_windows()) {
        not_unrolled();
        left = gradient::<MODE, S>(left, top, pixel);
    }
    left
}

/// `above` has one pixel more than `row` on each side. Returns the last pixel, for which a load would have to wait.
#[simd]
fn undo(mode: u8, left: VPixel<S>, row: &mut [Pixel], above: &[Pixel]) -> VPixel<S> {
    match mode {
        1 => add_left(left, row),
        2 => add_to_all::<2, S>(left, row, above),
        3 => add_to_all::<3, S>(left, row, above),
        4 => add_to_all::<4, S>(left, row, above),
        5 => add_average::<5, S>(left, row, above),
        6 => add_average::<6, S>(left, row, above),
        7 => add_average::<7, S>(left, row, above),
        8 => add_to_all::<8, S>(left, row, above),
        9 => add_to_all::<9, S>(left, row, above),
        10 => add_average::<10, S>(left, row, above),
        11 => add_gradient::<11, S>(left, row, above),
        12 => add_gradient::<12, S>(left, row, above),
        13 => add_average::<13, S>(left, row, above),
        _ => add_to_all::<0, S>(left, row, above),
    }
}

/// Undoes the predictor transform for a row other than the first. The second byte of a tile is the mode for
/// `1 << tile_bits` pixels.
#[kernel]
pub(crate) fn undo_prediction(row: &mut [Pixel], above: &[Pixel], tiles: &[Pixel], tile_bits: u32) {
    assert!(!row.is_empty() && row.len() == above.len() && tile_bits < 16);
    let mut left = load(&row[0]) + load(&above[0]);
    store(left, &mut row[0]);
    let last = row.len() - 1;
    let Some((_, mut rest)) = row[..last].split_first_mut() else {
        return;
    };
    let (mut rest_above, mut n) = (above, (1 << tile_bits) - 1);
    for tile in &tiles[..=last >> tile_bits] {
        let pixels;
        (pixels, rest) = rest.split_at_mut(rest.len().min(n));
        left = undo(tile[1] & 15, left, pixels, &rest_above[..pixels.len() + 2]);
        rest_above = &rest_above[pixels.len()..];
        n = 1 << tile_bits;
    }
    // At the top right of the last pixel is the first of its own row.
    let around = [above[last - 1], above[last], row[0]];
    let mode = tiles[last >> tile_bits][1] & 15;
    undo(mode, left, &mut row[last..], &around);
}

/// An index that gets zero.
const K: u8 = 0x80;

/// Of green and of red, for each pixel, from the tile in `tiles` that starts at byte 0 or, for pixels 4 to 7, at `second`.
#[simd]
fn multipliers<W: Width>(tiles: Simd<u8, W, S>, second: u8) -> [Simd<i16, W, S>; 2] {
    let start = (Simd::<u8, W, S>::iota(0) >> 4) * second;
    let scaled = |from: [u8; 4]| {
        let from = Simd::repeat(&from) + start;
        tiles.in_blocks().lookup_bytes(from).bitcast::<i16>() >> 6
    };
    [scaled([K, 2, K, 1]), scaled([K, K, K, 0])]
}

/// In lanes of 16 bits a pixel is red and green, then blue and alpha.
#[simd]
fn undo_colors<W: Width>(mut v: Simd<u8, W, S>, by: [Simd<i16, W, S>; 2]) -> Simd<u8, W, S> {
    // (color * multiplier) >> 5 is the upper half of twice (color << 8) * (multiplier << 2).
    let times = |color: Simd<i16, W, S>, multiplier| {
        (color.mul_high_doubled_relaxed(multiplier) & 0xff).bitcast()
    };
    let green = Simd::repeat(&[K, 1, K, 1]) | Simd::iota(0) & 12;
    v += times(v.in_blocks().lookup_bytes(green).bitcast(), by[0]);
    v + times((v.bitcast::<u32>() << 24).bitcast(), by[1])
}

#[simd]
fn undo_in_place<W: Width>(pixels: &mut [Pixel], by: [Simd<i16, W, S>; 2]) {
    undo_colors(Simd::load(pixels.as_flattened()), by).store(pixels.as_flattened_mut());
}

#[simd]
fn undo_eights(pixels: &mut [[Pixel; 8]], tile: u32) {
    let by = multipliers(u32x8::splat(tile).bitcast(), 0);
    for it in pixels {
        not_unrolled();
        undo_in_place(it, by);
    }
}

/// Undoes the cross-color transform for a row of RGBA. A tile has the multipliers red to blue, green to blue and green
/// to red for `1 << tile_bits` pixels.
#[kernel]
pub(crate) fn undo_cross_color(mut row: &mut [Pixel], mut tiles: &[Pixel], tile_bits: u32) {
    // All in one tile, and done sooner than the loops are set up.
    if let (..=4, 2.., [tile, ..]) = (row.len(), tile_bits, tiles) {
        let by = multipliers(u32x4::splat(u32::from_le_bytes(*tile)).bitcast(), 0);
        if let Some(four) = row.first_chunk_mut::<4>() {
            return undo_in_place(four, by);
        }
        for it in row {
            not_unrolled();
            store(undo_colors(load(it), by), it);
        }
        return;
    }
    assert!(tile_bits < 16 && row.len().div_ceil(1 << tile_bits) <= tiles.len());
    if tile_bits == 2 {
        let eights;
        (eights, row) = row.as_chunks_mut::<8>();
        let pairs;
        (pairs, tiles) = tiles.split_at(2 * eights.len());
        for (it, pair) in eights.iter_mut().zip(pairs.as_flattened().as_chunks().0) {
            let pair = u64x4::splat(u64::from_le_bytes(*pair));
            undo_in_place(it, multipliers(pair.bitcast(), 4));
        }
    } else if tile_bits > 2 {
        let whole = row.len() >> tile_bits;
        let (pixels, first);
        (pixels, row) = row.split_at_mut(whole << tile_bits);
        (first, tiles) = tiles.split_at(whole);
        let mut eights = pixels.as_chunks_mut().0;
        for tile in first {
            let of_tile;
            (of_tile, eights) = eights.split_at_mut(1 << (tile_bits - 3));
            undo_eights(of_tile, u32::from_le_bytes(*tile));
        }
    }
    for (pixels, tile) in row.chunks_mut(1 << tile_bits).zip(tiles) {
        let tile = u32::from_le_bytes(*tile);
        let (eights, rest) = pixels.as_chunks_mut::<8>();
        undo_eights(eights, tile);
        let (fours, rest) = rest.as_chunks_mut::<4>();
        let by = multipliers(u32x4::splat(tile).bitcast(), 0);
        for it in fours {
            not_unrolled();
            undo_in_place(it, by);
        }
        for it in rest {
            not_unrolled();
            store(undo_colors(load(it), by), it);
        }
    }
}

/// A bit for each count that is not zero.
#[kernel]
pub(crate) fn non_zero(counts: &[u16; 256]) -> [u64; 4] {
    array::from_fn(|i| {
        Simd::<u16, B128, S>::load(&counts[64 * i..])
            .simd_ne(0)
            .to_bitmask()
    })
}

/// The first count plus the last times the first weight, and so on, each divided by 100 and rounded.
#[kernel(Upto<B16>)]
pub(crate) fn weigh_ends(counts: &[u16; 255], [hundreds, rest]: &[[u32; 16]; 2]) -> u64 {
    let both = u16x16::load(counts).cast::<u32>() + u16x16::load_last(counts).reverse().cast();
    let whole = both.widening_mul_even(*hundreds) + both.widening_mul_odd(*hundreds);
    whole.reduce_sum() + u64::from(((both * *rest + 50) / 100).reduce_sum())
}

pub(crate) struct EightColors {
    /// Both in the high byte.
    pub(crate) green: [i16; 8],
    pub(crate) red: [i16; 8],
    pub(crate) blue: [i16; 8],
    /// How many pixels have it.
    pub(crate) count: [u16; 8],
}

/// Counts what the cross-color transform leaves of red, or of blue.
#[kernel(Upto<B16>)]
pub(crate) fn count_rests<const RED: bool>(
    colors: &[EightColors],
    from_green: i8,
    from_red: i8,
    counts: &mut [u16; 256],
) {
    // A 32nd of the product.
    let delta = |by: i8, color| i16x8::from(color).mul_high_doubled_relaxed(i16::from(by) << 2);
    for it in colors {
        let rest = if RED {
            i16x8::from(it.red) >> 8
        } else {
            i16x8::from(it.blue) - delta(from_red, it.red)
        };
        let rest = (rest - delta(from_green, it.green))
            .cast::<u8>()
            .bitcast::<u64>()[0];
        unroll!(for i in 0..8 {
            counts[usize::from((rest >> (8 * i)) as u8)] += it.count[i];
        });
    }
}
