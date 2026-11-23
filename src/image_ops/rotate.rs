use super::{Image, Pixel, fill_up};
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// The columns of four rows of four pixels, in the order in which they become rows.
#[simd]
fn columns<const CLOCKWISE: bool>([a, b, c, d]: [u32x4<S>; 4]) -> [u32x4<S>; 4] {
    let ([ab0, ab1], [cd0, cd1]) = (a.interleave(b), c.interleave(d));
    let ([w, x], [y, z]) = (
        ab0.bitcast::<u64>().interleave(cd0.bitcast()),
        ab1.bitcast::<u64>().interleave(cd1.bitcast()),
    );
    let [w, x, y, z] = if CLOCKWISE {
        [w, x, y, z]
    } else {
        [z, y, x, w]
    };
    [w.bitcast(), x.bitcast(), y.bitcast(), z.bitcast()]
}

/// The rows from `top` on, with which `out` starts, in tiles of 4 by 4 pixels.
#[simd]
fn turn_tiles<const CLOCKWISE: bool>(
    image: Image<'_>,
    top: usize,
    tiles: usize,
    out: &mut [Pixel],
) {
    let Image {
        pixels,
        width,
        height,
    } = image;
    let x = if CLOCKWISE {
        top
    } else {
        width - top - 4 * tiles
    };
    let stride = height;
    for left in (0..height).step_by(4) {
        // The last ones overlap those before them.
        let left = left.min(height - 4);
        let row = |i: usize| {
            let y = if CLOCKWISE {
                height - 1 - left - i
            } else {
                left + i
            };
            &pixels[y * width + x..].as_chunks::<4>().0[..tiles]
        };
        let (rows, mut at) = ([row(0), row(1), row(2), row(3)], left);
        for i in 0..tiles {
            let i = if CLOCKWISE { i } else { tiles - 1 - i };
            let load = |j: usize| u32x4::load_bytes(rows[j][i].as_flattened());
            let columns = columns::<CLOCKWISE, S>([load(0), load(1), load(2), load(3)]);
            let mut to = RowsMut::new(&mut out[at..], stride, 4, 4);
            unroll!(for j in 0..4 {
                columns[j].store_bytes(to.row(j).as_flattened_mut());
            });
            at += 4 * stride;
        }
    }
}

/// So many pixels are moved sooner than steps are set up.
pub(crate) const FEW: usize = 96;

/// Four rows of `out` at a time, with nothing to zero first. The image has to stay in the cache, as it is read four times.
#[simd]
fn turn_in_order<const CLOCKWISE: bool>(image: Image<'_>, out: &mut Output<'_, Pixel>) {
    let Image {
        pixels,
        width,
        height,
    } = image;
    let mut top = 0;
    while top < width {
        // The last ones overlap those before them.
        top = top.min(width - 4);
        out.truncate(top * height);
        let from = &pixels[if CLOCKWISE { top } else { width - top - 4 }..];
        out.streams::<4, _>(height, |rows| {
            let push_tile = |left: usize, rows: &mut [Output<'_, Pixel>; 4]| {
                let y = if CLOCKWISE { height - 4 - left } else { left };
                let stride = width;
                let tile = Rows::new(&from[y * stride..], stride, 4, 4);
                let load = |j: usize| u32x4::load_bytes(tile.row(j).as_flattened());
                let columns = columns::<CLOCKWISE, S>(if CLOCKWISE {
                    [load(3), load(2), load(1), load(0)]
                } else {
                    [load(0), load(1), load(2), load(3)]
                });
                unroll!(for i in 0..4 {
                    rows[i].push(&pixels_of(columns[i]));
                });
            };
            for tile in 0..(height - 1) / 4 {
                push_tile(4 * tile, rows);
            }
            unroll!(for i in 0..4 {
                rows[i].truncate(height - 4);
            });
            push_tile(height - 4, rows);
        });
        top += 4;
    }
}

#[simd]
fn pixels_of(v: u32x4<S>) -> [Pixel; 4] {
    let mut pixels = [[0; 4]; 4];
    v.store_bytes(pixels.as_flattened_mut());
    pixels
}

/// Two or three rows.
#[simd]
fn turn_strip<const CLOCKWISE: bool>(image: Image<'_>, out: &mut Vec<Pixel>) {
    let Image {
        pixels,
        width,
        height,
    } = image;
    // Four pixels are stored for each column, so there has to be one more.
    let tiles = (width - 1) / 4;
    let x = if CLOCKWISE { 0 } else { width - 4 * tiles };
    let row = |i: usize| {
        let i = i.min(height - 1);
        let y = if CLOCKWISE { height - 1 - i } else { i };
        &pixels[y * width + x..].as_chunks::<4>().0[..tiles]
    };
    let rows = [row(0), row(1), row(2)];
    {
        let out = &mut Output::append(out, pixels.len());
        for i in 0..tiles {
            let i = if CLOCKWISE { i } else { tiles - 1 - i };
            let load = |j: usize| u32x4::load_bytes(rows[j][i].as_flattened());
            for column in columns::<CLOCKWISE, S>([load(0), load(1), load(2), load(2)]) {
                out.push_with_slack((&pixels_of(column)).first_n(height));
            }
        }
    }
    turn_pixels::<CLOCKWISE>(image, 4 * tiles, out);
}

/// The rows of `out` from `top` on.
#[inline(always)]
fn turn_pixels<const CLOCKWISE: bool>(image: Image<'_>, top: usize, out: &mut Vec<Pixel>) {
    let rows = || image.pixels.chunks_exact(image.width);
    for i in top..image.width {
        if CLOCKWISE {
            out.extend(rows().rev().map(|row| row[i]));
        } else {
            out.extend(rows().map(|row| row[image.width - 1 - i]));
        }
    }
}

/// Fills `out`, which is empty and has the room. There are two rows or more. Wider vectors are no faster.
#[kernel(Upto<B16>)]
pub(crate) fn quarter_turn<const CLOCKWISE: bool>(image: Image<'_>, out: &mut Vec<Pixel>) {
    /// How many rows of `out` are zeroed at a time, to be written while they are in the cache.
    const BAND: usize = 64;
    const CACHED: usize = 512 * 512;
    let Image {
        pixels,
        width,
        height,
    } = image;
    if width < 4 {
        return turn_pixels::<CLOCKWISE>(image, 0, out);
    }
    if height < 4 {
        return turn_strip::<CLOCKWISE, S>(image, out);
    }
    // Many rows of `out` with up to two tiles do not pay for what `turn_in_order` sets up.
    if pixels.len() <= CACHED && (height > 8 || width < 2 * BAND) {
        return turn_in_order::<CLOCKWISE, S>(image, &mut Output::append(out, pixels.len()));
    }
    let mut top = 0;
    while top < width {
        let rows = ((width - top) / 4 * 4).clamp(4, BAND);
        top = top.min(width - rows);
        fill_up(out, (top + rows) * height, [0; 4]);
        turn_tiles::<CLOCKWISE, S>(image, top, rows / 4, &mut out[top * height..]);
        top += rows;
    }
}

/// `STEP` pixels at a time, in vectors of `W`. The rows have at least so many.
#[simd]
fn reverse_steps<W: Width, const STEP: usize>(
    pixels: &[Pixel],
    width: usize,
    out: &mut Output<'_, Pixel>,
) {
    // One instruction. If the compiler knew the order, it would make two of it.
    let order = Simd::<u32, W, S>::iota(0).reverse().black_box();
    let push_reversed = |from: &[Pixel], out: &mut Output<'_, Pixel>| {
        let (from, mut reversed) = (from[..STEP].as_flattened(), [[0; 4]; STEP]);
        for at in (0..4 * STEP).step_by(W::BYTES) {
            let from = Simd::<u32, W, S>::load_bytes(&from[4 * STEP - W::BYTES - at..]);
            let to = &mut reversed.as_flattened_mut()[at..];
            if STEP > 1 {
                from.swizzle_dyn_relaxed(order)
            } else {
                from
            }
            .store_bytes(to);
        }
        out.push(&reversed);
    };
    let mut next = pixels;
    while let Some((row, rest)) = next.split_at_checked(width) {
        next = rest;
        let out = &mut out.limit(width);
        for (i, from) in row.rchunks_exact(STEP).enumerate() {
            // The hardware doesn't expect the next row after one that went backward.
            if STEP == 16 && !next.is_empty() {
                prefetch(next, i * STEP);
            }
            push_reversed(from, out);
        }
        if !width.is_multiple_of(STEP) {
            out.truncate(width - STEP);
            push_reversed(row, out);
        }
    }
}

/// Appends to `out`, which has the room.
#[kernel]
pub(crate) fn reverse_rows(pixels: &[Pixel], width: usize, out: &mut Vec<Pixel>) {
    let out = &mut Output::append(out, pixels.len());
    match width {
        16.. => reverse_steps::<Native<S>, 16, S>(pixels, width, out),
        8.. => reverse_steps::<Upto<B32, S>, 8, S>(pixels, width, out),
        4.. => reverse_steps::<B16, 4, S>(pixels, width, out),
        _ => reverse_steps::<B4, 1, S>(pixels, width, out),
    }
}
