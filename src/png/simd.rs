//! The loops of the scanline filters.
//!
//! `x` is a byte of the row, `a` the byte one pixel to its left, `b` the byte above it and `c` the byte above `a`.
//! Left of the row `a` and `c` are zero.
// Undoing Average and Paeth is one long chain, each pixel waiting for the one before it, and a comparison that goes
// through a mask register of AVX-512 makes the chain half as long again.

use bun_simd::prelude::*;

targets!(Upto<B32>);

/// What Sub is undone for at once.
const BLOCK: usize = 16;
/// From a block that is not flat to the next look, or a photo would pay for the looking.
const BUSY: usize = 4 * BLOCK;

/// A pixel of `BPP` bytes, in the first lanes. Arithmetic on less than 8 bytes is slow on NEON.
#[simd]
fn load<const BPP: usize>(pixel: &[u8; BPP]) -> u8x8<S> {
    if const { BPP == 4 } {
        return u8x4::load(pixel).resize();
    }
    let mut bytes = [0; 8];
    // Not `copy_from_slice()`, whose check for overlap in hardened builds keeps this in memory.
    if let Some(first) = bytes.first_chunk_mut() {
        *first = *pixel;
    }
    u8x8::from(bytes)
}
#[simd]
fn store<const BPP: usize>(v: u8x8<S>, pixel: &mut [u8; BPP]) {
    if let Some(first) = v.to_array().first_chunk() {
        *pixel = *first;
    }
}
#[simd]
fn load_wide<const BPP: usize>(pixel: &[u8; BPP]) -> i16x8<S> {
    load(pixel).cast()
}
/// The last pixel of `before`, if any.
#[simd]
fn load_last<const BPP: usize>(before: &[u8]) -> u8x8<S> {
    load::<BPP, S>(before.last_chunk().unwrap_or(&[0; BPP]))
}

/// The pixel is at the start of `v` or at its end.
#[simd]
fn repeat<const BPP: usize>(v: u8x16<S>, last: bool) -> u8x16<S> {
    macro_rules! repeat {
        ($t:ty, $last:literal) => {{
            let v = v.bitcast::<$t>();
            if last {
                v.splat_lane::<$last>()
            } else {
                v.splat_lane::<0>()
            }
            .bitcast()
        }};
    }
    match BPP {
        1 => repeat!(u8, 15),
        2 => repeat!(u16, 7),
        _ => repeat!(u32, 3),
    }
}

/// `a` is the pixel in front of `block`, repeated. Returns the last pixel of `block`, repeated.
#[simd]
fn sub_block<const BPP: usize>(a: u8x16<S>, block: &mut [u8; BLOCK]) -> u8x16<S> {
    let mut x = u8x16::from(*block);
    if BPP <= 1 {
        x += x.shift_elements_right::<1>(0)
    }
    if BPP <= 2 {
        x += x.shift_elements_right::<2>(0)
    }
    x += x.shift_elements_right::<4>(0);
    x += x.shift_elements_right::<8>(0);
    *block = (x + a).to_array();
    // Only this addition waits for the block before.
    a + repeat::<BPP, S>(x, true).black_box()
}

#[simd]
fn unfilter_sub<const BPP: usize>(row: &mut [u8]) {
    let mut a = u8x8::zero();
    if BLOCK.is_multiple_of(BPP) {
        let (blocks, rest) = row.as_chunks_mut();
        let mut repeated = u8x16::zero();
        for block in blocks {
            repeated = sub_block::<BPP, S>(repeated, block);
        }
        a = repeated.resize();
        for pixel in rest.as_chunks_mut::<BPP>().0 {
            not_unrolled();
            a += load(pixel);
            store(a, pixel);
        }
        return;
    }
    for pixel in row.as_chunks_mut::<BPP>().0 {
        a += load(pixel);
        store(a, pixel);
    }
}

#[simd]
#[inline(never)]
fn unfilter_up(row: &mut [u8], above: &[u8]) {
    over_mut(row).zip(above).map(|(x, b)| x + b);
}

#[simd]
fn unfilter_average<const BPP: usize>(row: &mut [u8], above: &[u8]) {
    // The average that is rounded down is `!(!a).midpoint_up(!b)`, and `!(x + !y)` is `y - x`.
    let mut not_a = u8x8::splat(!0);
    for (x, b) in row
        .as_chunks_mut::<BPP>()
        .0
        .iter_mut()
        .zip(above.as_chunks::<BPP>().0)
    {
        not_a = not_a.midpoint_up(!load(b)) - load(x);
        store(!not_a, x);
    }
}

/// As in `paeth_pixels()`. With one byte at a time a vector has nothing to gain, and its steps take longer.
/// With target features, LLVM picks `cmovbe`, which is slow on Intel's CPUs.
#[simd]
#[inline(always)]
fn paeth_bytes(before: &[u8], row: &mut [u8], above_before: &[u8], above: &[u8]) {
    let mut a = before.last().map_or(0, |&it| it as i32);
    let mut c = above_before.last().map_or(0, |&it| it as i32);
    for (x, &b) in row.iter_mut().zip(above) {
        let b = b as i32;
        let (threshold, low, high) = (3 * c - b - a, a.min(b), a.max(b));
        let low_or_c = if high > threshold { c } else { low };
        *x = x.wrapping_add(if threshold > low { low_or_c } else { high } as u8);
        (a, c) = (*x as i32, b);
    }
}

/// `row[from..to]`, which holds whole pixels.
#[simd]
fn paeth_pixels<const BPP: usize>(row: &mut [u8], above: &[u8], from: usize, to: usize) {
    let ((before, row), (above_before, above)) =
        (row[..to].split_at_mut(from), above[..to].split_at(from));
    if BPP == 1 {
        return paeth_bytes(before, row, above_before, above);
    }
    // The sum of two bytes without its carry.
    let add = |x: i16x8<S>, y: i16x8<S>| (x.bitcast::<u8>() + y.bitcast()).bitcast::<i16>();
    let mut a = load_last::<BPP, S>(before).cast::<i16>();
    let mut c = load_last::<BPP, S>(above_before).cast::<i16>();
    let (row, above) = (row.as_chunks_mut::<BPP>().0, above.as_chunks::<BPP>().0);
    if row.is_empty() {
        return;
    }
    let (mut x, mut b) = (load_wide::<BPP, S>(&row[0]), load_wide::<BPP, S>(&above[0]));
    // A turn ahead, so that LLVM doesn't put them on the way from one `a` to the next.
    let (mut three_c_minus_b, mut x_plus_c) = (c + c + c - b, add(x, c));
    for i in 0..row.len() {
        not_unrolled();
        // The one of a, b and c nearest to a + b - c, in fewer steps from `a` than by the three distances.
        // https://github.com/nothings/stb/blob/013ac3beddff3dbffafd5177e7972067cd2b5083/stb_image.h#L4657
        let (threshold, low, high) = (three_c_minus_b - a, a.simd_min(b), a.simd_max(b));
        let low_or_c = high.simd_gt(threshold).select(x_plus_c, add(x, low));
        a = threshold.simd_gt(low).select(low_or_c, add(x, high));
        store(a.saturating_cast::<u8>(), &mut row[i]);
        let (Some(next_x), Some(next_b)) = (row.get(i + 1), above.get(i + 1)) else {
            return;
        };
        (x, c, b) = (load_wide::<BPP, S>(next_x), b, load_wide::<BPP, S>(next_b));
        (three_c_minus_b, x_plus_c) = (c + c + c - b, add(x, c));
    }
}

/// Whether the block at `at` repeats the pixel in front of it.
#[simd]
fn is_flat<const BPP: usize>(above: &[u8], at: usize) -> bool {
    above
        .get(at.wrapping_sub(BPP)..at + BLOCK)
        .is_some_and(|both| u8x16::load(both) == u8x16::load_last(both))
}

/// Out of line, or the other filters would save the registers that it takes.
#[simd]
#[inline(never)]
fn unfilter_paeth<const BPP: usize>(row: &mut [u8], above: &[u8]) {
    let (len, mut i) = (row.len(), 0);
    let above = &above[..len];
    while i + BPP <= len {
        // Where the row above repeats a pixel, b = c, so `a` is the nearest and Paeth is Sub.
        if is_flat::<BPP, S>(above, i) {
            let mut a = repeat::<BPP, S>(load_last::<BPP, S>(&row[..i]).resize(), false);
            while let Some(block) = row[i..].first_chunk_mut() {
                a = sub_block::<BPP, S>(a, block);
                i += BLOCK;
                if !is_flat::<BPP, S>(above, i) {
                    break;
                }
            }
            continue;
        }
        let mut end = i + BUSY;
        while end < len && !is_flat::<BPP, S>(above, end) {
            end += BUSY;
        }
        end = end.min(len);
        paeth_pixels::<BPP, S>(row, above, i, end);
        i = end;
    }
}

#[simd]
fn unfilter_for<const BPP: usize>(filter_type: u8, row: &mut [u8], above: &[u8]) {
    match filter_type {
        1 => unfilter_sub::<BPP, S>(row),
        2 => unfilter_up(row, above),
        3 => unfilter_average::<BPP, S>(row, above),
        4 if row.len() <= BUSY || !BLOCK.is_multiple_of(BPP) => {
            paeth_pixels::<BPP, S>(row, above, 0, row.len())
        }
        4 => unfilter_paeth::<BPP, S>(row, above),
        _ => {}
    }
}

/// Undoes filter type 1 (Sub), 2 (Up), 3 (Average) or 4 (Paeth) on `row`, whose pixels have 1, 2, 4 or 6 bytes.
/// Another filter type or pixel size leaves `row` as it is. `above` is as long as `row`.
#[kernel]
#[inline(never)]
pub(crate) fn unfilter(filter_type: u8, bytes_per_pixel: usize, row: &mut [u8], above: &[u8]) {
    let above = &above[..row.len()];
    match bytes_per_pixel {
        1 => unfilter_for::<1, S>(filter_type, row, above),
        2 => unfilter_for::<2, S>(filter_type, row, above),
        4 => unfilter_for::<4, S>(filter_type, row, above),
        6 => unfilter_for::<6, S>(filter_type, row, above),
        _ => {}
    }
}

/// How many rows are undone side by side.
pub(crate) const ROWS: usize = 8;
/// In bytes. Shorter rows gain nothing.
pub(crate) const LONG: usize = 256;
/// By how many bytes each of them lags behind the row above: what it needs of that was done two steps before.
const LAG: usize = 2 * 4;

/// A vector has a pixel of each row. While a pixel waits for the one before it, the other rows go on.
#[simd]
#[inline(never)]
fn unfilter_side_by_side<const ONLY_PAETH: bool>(types: [u8; ROWS], all: &mut [u8], len: usize) {
    let types = if ONLY_PAETH { [4; ROWS] } else { types };
    let types = (u8x8::from(types).cast::<u32>() * 0x0101_0101).bitcast::<u8>();
    let [is_sub, is_up, is_average, is_paeth] = array::from_fn(|i| types.simd_eq(i as u8 + 1));
    // With b = 0, Paeth picks `a` if c = 0, and 0 if c = 255.
    let no_c = (is_sub | is_paeth).select(0, u8x32::splat(255));
    let (mut a, mut before_a, mut c) = (u8x32::zero(), u8x32::zero(), no_c);

    // The first row starts early, so that the last one ends with a block.
    let (early, lag) = (
        (len + (ROWS - 1) * LAG).wrapping_neg() % BLOCK,
        (ROWS - 1) * LAG,
    );
    let mut first = [0; 2 * BLOCK];
    u8x16::load(all).store(&mut first[early..]);
    let mut above = u32x4::load_bytes(&first);
    for at in (len - early..2 * len + lag).step_by(BLOCK) {
        let mut rows = RowsMut::new(&mut all[at..], len - LAG, BLOCK, ROWS);
        let load = |i| u32x4::load_bytes(rows.rows().row(i));
        let there =
            u32x8::transpose_in_blocks::<4>(array::from_fn(|i| load(i).concat(load(i + 4))));
        // Before its start and after its end, a row has pixels of its neighbors. They count as zero, and stay as they are.
        let is_at_edge = at < len + lag || at + BLOCK > 2 * len;
        let is_inside = |step: usize| {
            let x = u32x8::splat((at + 4 * step).wrapping_sub(len) as u32)
                - u32x8::iota(0) * LAG as u32;
            x.simd_lt(len as u32)
        };
        let mut x = there;
        if is_at_edge {
            x = array::from_fn(|step| is_inside(step).select(x[step], 0));
        }
        unroll!(for step in 0..4 {
            let b = before_a
                .bitcast::<u32>()
                .shift_elements_right::<1>(u32x8::splat(above[step]));
            let b = b.bitcast::<u8>();
            let plain =
                x[step].bitcast::<u8>() + is_up.select(b, 0) + is_average.select(a.midpoint(b), 0);
            let b = is_paeth.select(b, 0);
            // The tests of `paeth_pixels()` in bytes, by how far it is from `c` to the higher and to the lower of `a` and `b`.
            let (up, down) = (
                a.simd_max(b).saturating_sub(c),
                c.saturating_sub(a.simd_min(b)),
            );
            let if_twice = |far: u8x32<S>, near: u8x32<S>| {
                near.saturating_add(near).simd_le(far).select(far, 0)
            };
            let undone = (plain + c).black_box() + if_twice(up, down) - if_twice(down, up);
            (before_a, a, c) = (a, undone, b | no_c);
            x[step] = a.bitcast();
        });
        if is_at_edge {
            x = array::from_fn(|step| is_inside(step).select(x[step], there[step]));
        }
        let x = u32x8::transpose_in_blocks(x);
        unroll!(for i in 0..4 {
            let [upper, lower] = x[i].split();
            upper.store_bytes(rows.row(i));
            lower.store_bytes(rows.row(i + 4));
        });
        above = u32x4::load_bytes(&all[at + BLOCK - len..]);
    }
}

/// As [`unfilter()`] for each of the rows of `all` but for the first. They have `len` bytes, at least `LONG`, and their pixels have 4.
#[kernel]
#[inline(never)]
pub(crate) fn unfilter_rows(types: &[u8], all: &mut [u8], len: usize) {
    if let Ok(types) = <[u8; ROWS]>::try_from(types)
        && len < u32::MAX as usize / 2
    {
        // In thirds of the time that Paeth takes for a byte.
        let looks = (BUSY..len).step_by(BUSY);
        let flat = looks.filter(|&at| is_flat::<4, S>(all, at)).count() * BUSY;
        let alone = |&it| match it {
            4 => 3 * (len - flat),
            3 => len,
            _ => 0,
        };
        let together = pick! { neon => 6, avx2 => 8, _ => 12 };
        if types.iter().map(alone).sum::<usize>() > together * (len + ROWS * LAG) {
            return match types {
                [4, 4, 4, 4, 4, 4, 4, 4] => unfilter_side_by_side::<true, S>(types, all, len),
                _ => unfilter_side_by_side::<false, S>(types, all, len),
            };
        }
    }
    let (mut above, rows) = all.split_at_mut(len);
    for (&filter_type, row) in types.iter().zip(rows.chunks_exact_mut(len)) {
        unfilter_for::<4, S>(filter_type, row, &above[..len]);
        above = row;
    }
}

/// No more bytes are read or written behind a row.
pub(crate) const SLACK: usize = 64;

/// Appends the `count` pixels of `row`, which have `channels` samples of `BYTES` bytes. The first byte counts.
#[kernel]
#[inline(never)]
pub(crate) fn push_as_rgba<const BYTES: usize>(
    row: &[u8],
    count: usize,
    channels: usize,
    rgba: &mut Vec<u8>,
) {
    // Where the bytes of four pixels are among their samples.
    let first = match channels {
        1 => 0x8000_0000,
        2 => 0x0100_0000,
        3 => 0x8002_0100,
        _ => 0x0302_0100,
    };
    let order = (u32x4::iota(0) * (0x0101_0101 * channels as u32) + first).bitcast::<u8>();
    let samples = |from: &[u8]| match BYTES {
        1 => u8x16::load(from),
        _ => u8x32::load(from).bitcast::<u16>().cast(),
    };
    let (eights, step) = (count.div_ceil(8), 4 * BYTES * channels);
    let out = &mut Output::append(rgba, 32 * eights);
    let [even, odd] = array::from_fn(|i| Rows::new(&row[i * step..], 2 * step, 16 * BYTES, eights));
    for i in 0..eights {
        let both = samples(even.row(i)).concat(samples(odd.row(i)));
        out.push(both.in_blocks().lookup_bytes(order.concat(order)));
    }
    out.truncate(4 * count);
}

/// All pixels become opaque but those of the color `transparent`.
#[kernel]
pub(crate) fn set_alpha(rgba: &mut [u8], transparent: Option<[u8; 3]>) {
    let alpha = u32::from_ne_bytes([0, 0, 0, 255]);
    // No opaque pixel is zero.
    let transparent = transparent.map_or(0, |[r, g, b]| u32::from_ne_bytes([r, g, b, 255]));
    over_mut(rgba).map(|v| {
        let v = v.bitcast::<u32>() | alpha;
        (v ^ v.simd_eq(transparent).select(alpha, u32xN::zero())).bitcast()
    });
}

/// Returns the bytes as they are, and in all four filters.
#[simd]
fn filter<W: Width>([x, a, b, c]: [Simd<u8, W, S>; 4]) -> [Simd<u8, W, S>; 5] {
    // The distances of a + b - c from a, b and c. The last is |(a - c) + (b - c)|: their sum if c is on one side of
    // both, and then that it saturates does not matter, because it is not the least.
    let (pa, pb) = (b.abs_diff(c), a.abs_diff(c));
    let c_is_between = a.simd_ge(c) ^ b.simd_ge(c);
    let pc = c_is_between.select(pa.abs_diff(pb), pa.saturating_add(pb));
    let least = pa.simd_min(pb).simd_min(pc);
    let nearest = pa.simd_eq(least).select(a, pb.simd_eq(least).select(b, c));
    [
        x,
        x - a,
        x - b,
        x - (a.midpoint_up(b) - ((a ^ b) & 1)),
        x - nearest,
    ]
}

/// How far the bytes are from zero, taken as signed.
#[simd]
fn distances<W: Width>(v: Simd<u8, W, S>) -> Simd<u64, W, S> {
    v.cast_signed().abs().cast_unsigned().sum_groups::<u64>()
}

/// Applies filter types 1 to 4 to `row`: `filtered[t - 1]` is for type `t`. All are as long as `row`.
/// Returns, for types 0 to 4, how far the filtered bytes are from zero, taken as signed and added up.
#[kernel]
#[inline(never)]
pub(crate) fn filter_rgba(
    row: &[[u8; 4]],
    above: &[[u8; 4]],
    filtered: [&mut [u8]; 4],
) -> [u64; 5] {
    let (Some(&x), Some(&b)) = (row.first(), above.first()) else {
        return [0; 5];
    };
    let (row, above) = (row.as_flattened(), above[..row.len()].as_flattened());
    let (len, n) = (row.len(), u8xN::LANES);
    let [f0, f1, f2, f3] = filtered;
    let to = [
        &mut f0[..len],
        &mut f1[..len],
        &mut f2[..len],
        &mut f3[..len],
    ];

    // The first pixel has nothing to its left.
    let out = filter([
        u8x4::from(x).resize(),
        u8xN::zero(),
        u8x4::from(b).resize(),
        u8xN::zero(),
    ]);
    let mut sums = [u64xN::zero(); 5];
    for i in 0..5 {
        sums[i] = distances(out[i]);
    }
    for i in 0..4 {
        out[i + 1].resize::<B4>().store(to[i]);
    }
    if len < 4 + n {
        let out = filter([
            u8xN::load_or_default(&row[4..]),
            u8xN::load_or_default(&row[..len - 4]),
            u8xN::load_or_default(&above[4..]),
            u8xN::load_or_default(&above[..len - 4]),
        ]);
        for i in 0..5 {
            sums[i] += distances(out[i]);
        }
        for i in 0..4 {
            out[i + 1].store_partial(&mut to[i][4..]);
        }
    } else {
        // All are as long, so that the condition of the loop is what the accesses check.
        let rest = len - 4;
        let from = [&row[4..], &row[..rest], &above[4..], &above[..rest]];
        let [f0, f1, f2, f3] = to;
        let to = [&mut f0[4..], &mut f1[4..], &mut f2[4..], &mut f3[4..]];
        let mut step = |at: usize, done: usize| {
            let out = filter([
                u8xN::load_at(from[0], at),
                u8xN::load_at(from[1], at),
                u8xN::load_at(from[2], at),
                u8xN::load_at(from[3], at),
            ]);
            for i in 0..5 {
                sums[i] += distances(mask8xN::first_n(done).select(0, out[i]));
            }
            for i in 0..4 {
                out[i + 1].store_at(to[i], at);
            }
        };
        let (mut at, last) = (0, rest - n);
        while at < last {
            step(at, 0);
            at += n;
        }
        step(last, at - last);
    }
    [
        sums[0].reduce_sum(),
        sums[1].reduce_sum(),
        sums[2].reduce_sum(),
        sums[3].reduce_sum(),
        sums[4].reduce_sum(),
    ]
}
