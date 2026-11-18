//! PNG filters. `a` is left of the byte `x`, `b` is above it, and `c` is above `a`.

use bun_simd::{Isa, opaque};
use core::hint::{black_box, select_unpredictable};

pub use simd::filter_rgba;

type Rgba = [u8; 4];

const BLOCK: usize = 16;
/// From a block that is not flat to the next look. A look at each block is hard to predict.
const BUSY: usize = 4 * BLOCK;

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::x128::{I8, I16, U8, U16, U64};

    fn load_pixel<const BPP: usize>(pixel: [u8; BPP]) -> U8 {
        let mut bytes = [0; 8];
        *bytes.first_chunk_mut().unwrap() = pixel;
        U64::from_first(u64::from_le_bytes(bytes)).bitcast()
    }

    fn first_pixel<const BPP: usize>(v: U8) -> [u8; BPP] {
        *v.to_array().first_chunk().unwrap()
    }

    /// Returns how far the bytes are from zero for each filter type. Panics unless `row` is shortest.
    #[export]
    pub fn filter_rgba(row: &[Rgba], above: &[Rgba], filtered: [&mut [Rgba]; 4]) -> [u64; 5] {
        let (len, [sub, up, average, paeth]) = (row.len(), filtered);
        let above = &above[..len];
        let filtered = [
            &mut sub[..len],
            &mut up[..len],
            &mut average[..len],
            &mut paeth[..len],
        ];
        if len > isa::U32::LEN {
            return width::full::filter_row(row, above, filtered);
        }
        if len > 4 {
            return width::x128::filter_row(row, above, filtered);
        }
        let (mut a, mut c, mut sums) = (U8::zero(), U8::zero(), [U64::zero(); 5]);
        for i in 0..len {
            let (x, b) = (load_pixel(row[i]), load_pixel(above[i]));
            let results = width::x128::filter([x, a, b, c], &mut sums);
            for k in 0..4 {
                filtered[k][i] = first_pixel(results[k]);
            }
            (a, c) = (x, b);
        }
        sums.map(|sum| sum[0])
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U64};

        #[inline(always)]
        pub fn filter([x, a, b, c]: [U8; 4], sums: &mut [U64; 5]) -> [U8; 4] {
            let average = a.average_round(b) - ((a ^ b) & 1);
            let (pa, pb) = (b.abs_diff(c), a.abs_diff(c));
            let least = pa.simd_min(pb);
            // The third distance is their difference if `c` is between the others, or else their sum.
            let is_c = (a.simd_ge(c) ^ b.simd_ge(c)) & pa.abs_diff(pb).simd_lt(least);
            let nearest = is_c.select(c, pa.simd_eq(least).select(a, b));
            let filtered = [x - a, x - b, x - average, x - nearest];
            let distance = |v: U8| U64::sums_of_8(v.simd_min(v.wrapping_neg()));
            sums[0] += distance(x);
            for k in 0..4 {
                sums[k + 1] += distance(filtered[k]);
            }
            filtered
        }

        /// For slices of the same length, which is more than that of a vector.
        #[inline(always)]
        pub fn filter_row(row: &[Rgba], above: &[Rgba], filtered: [&mut [Rgba]; 4]) -> [u64; 5] {
            const N: usize = U8::LEN;
            let (row, above) = (row.as_flattened(), above.as_flattened());
            let mut filtered = filtered.map(<[_]>::as_flattened_mut);
            let mut sums = [U64::zero(); 5];
            let mut filter_at = |at: usize, inputs| {
                let results = filter(inputs, &mut sums);
                for k in 0..4 {
                    results[k].copy_to_slice(&mut filtered[k][at..]);
                }
            };

            // Zeros add nothing to a sum, and what follows overwrites their results.
            let (last, overlap) = (row.len() - N, row.len().wrapping_neg() % N);
            let is_new = U8::iota().simd_ge(overlap as u8).to_vector();
            let new = |bytes: &[u8]| U8::from_slice(bytes) & is_new;
            let (x, a) = (new(&row[last..]), new(&row[last - 4..]));
            filter_at(last, [x, a, new(&above[last..]), new(&above[last - 4..])]);

            let (x, b) = (U8::from_slice(row), U8::from_slice(above));
            let (a, c) = (
                x.shift_elements_right::<4>(0),
                b.shift_elements_right::<4>(0),
            );
            filter_at(0, [x, a, b, c]);

            let count = (last - 1) / N;
            let [x, a, b, c] = [&row[N..], &row[N - 4..], &above[N..], &above[N - 4..]]
                .map(|bytes| &bytes.as_chunks().0[..count]);
            let [sub, up, average, paeth] =
                filtered.map(|bytes| &mut bytes[N..].as_chunks_mut().0[..count]);
            for i in 0..count {
                let inputs = [
                    U8::load(&x[i]),
                    U8::load(&a[i]),
                    U8::load(&b[i]),
                    U8::load(&c[i]),
                ];
                [sub[i], up[i], average[i], paeth[i]] = filter(inputs, &mut sums).map(U8::to_array);
            }
            sums.map(U64::reduce_sum)
        }
    }

    /// The block after `before`, whose bytes `x` have the filter Sub.
    fn sub_block<const BPP: usize>(before: U8, mut x: U8) -> U8 {
        if BPP == 1 {
            x += x.shift_elements_right::<1>(0);
        }
        if BPP <= 2 {
            x += x.shift_elements_right::<2>(0);
        }
        if BPP <= 4 {
            x += x.shift_elements_right::<4>(0);
        }
        x += x.shift_elements_right::<8>(0);
        x + before.lookup(U8::iota() | (16 - BPP as u8))
    }

    fn unfilter_sub<const BPP: usize>(mut row: &mut [u8]) {
        let mut a = U8::zero();
        if BPP.is_power_of_two() {
            let blocks;
            (blocks, row) = row.as_chunks_mut();
            for block in blocks {
                a = sub_block::<BPP>(a, U8::load(block));
                a.store(block);
            }
            a = U8::zero().shift_in::<BPP>(a);
        }
        for pixel in row.as_chunks_mut::<BPP>().0 {
            a += load_pixel(*pixel);
            *pixel = first_pixel(a);
        }
    }

    #[export]
    pub fn unfilter_up(row: &mut [u8], above: &[u8]) {
        isa::U8::zip_in_place(row, above, |x, b| x + b);
    }

    fn unfilter_average<const BPP: usize>(row: &mut [[u8; BPP]], above: &[[u8; BPP]]) {
        let mut a = U8::zero();
        for (pixel, &b) in row.iter_mut().zip(above) {
            let (x, b) = (load_pixel(*pixel), load_pixel(b));
            // LLVM would add `a` first, which is what each pixel waits for.
            a = ((x + b).opaque() + a).opaque() - a.average_round(b);
            *pixel = first_pixel(a);
        }
    }

    /// The nearest is `a` outside of `start..=start + len`. Inside it is `low` before `middle`, then `high`.
    fn paeth_limits(b: U8, c: U8) -> [U8; 5] {
        let (up, down) = (b.saturating_sub(c), c.saturating_sub(b));
        let (low, high, half) = (b.simd_min(c), b.simd_max(c), (up | down) >> 1);
        // Between `b` and `3c - 2b`
        let start = low.saturating_sub(up).saturating_sub(up.saturating_sub(1));
        let end = high
            .saturating_add(down)
            .saturating_add(down.saturating_sub(1));
        // `(3c - b) / 2`
        let above_c = c.saturating_add(half);
        let middle = down
            .simd_eq(0)
            .select(c.saturating_sub(half), above_c.saturating_add(1));
        let high = above_c.simd_eq(255).select(low, high);
        [start, end - start, middle, low, high]
    }

    /// `a` and `c` are the blocks before. Returns the last block. Each pixel waits for the one before it.
    fn paeth_blocks<const BPP: usize>(row: &mut [u8], above: &[u8], a: U8, mut c: U8) -> U8 {
        // Less 128, for signed comparisons.
        let mut a = a ^ 0x80;
        for (block, b) in row.as_chunks_mut().0.iter_mut().zip(above.as_chunks().0) {
            let (before, x, b) = (a, U8::load(block), U8::load(b));
            let [start, len, middle, low, high] = paeth_limits(b, b.shift_in::<BPP>(c));
            let [len, middle] = [len, middle].map(|v| (v ^ 0x80).bitcast::<I8>());
            let [with_low, with_high] = [low, high].map(|v| ((x ^ 0x80) + v).opaque());
            // Each turn gets one more pixel right.
            for _ in 0..BLOCK / BPP {
                a = a.shift_in::<BPP>(before);
                let is_low = middle.simd_gt(a.bitcast::<I8>()).cast();
                let is_outside = (a - start).bitcast::<I8>().simd_gt(len).cast();
                a = is_outside.select(x + a, is_low.select(with_low, with_high));
            }
            (a ^ 0x80).store(block);
            c = b;
        }
        a ^ 0x80
    }

    /// The same for pixels of one byte, with the steps in general registers.
    fn paeth_bytes(row: &mut [u8], above: &[u8], a: U8, mut c: U8) -> U8 {
        let mut a = u64::from(a[BLOCK - 1]);
        for (block, b) in row.as_chunks_mut().0.iter_mut().zip(above.as_chunks().0) {
            let (x, b) = (U8::load(block), U8::load(b));
            let [start, len, middle, low, high] = paeth_limits(b, b.shift_in::<1>(c));
            let all = [start, len, middle, x, x + low, x + high].map(U8::to_array);
            // Loads are cheaper than moves out of a vector.
            let all = black_box(&all);
            for i in 0..BLOCK {
                let [start, len, middle, x, with_low, with_high] =
                    all.each_ref().map(|it| opaque(it[i].into()));
                let inside = select_unpredictable(a < middle, with_low, with_high);
                let with_a = opaque((a + x) & 0xFF);
                a = select_unpredictable(a.wrapping_sub(start) > len, with_a, inside);
                block[i] = a as u8;
            }
            c = b;
        }
        U8::splat(a as u8)
    }

    /// Has less to do for few pixels. `a`, `c` and the result start with a pixel.
    fn paeth_pixels<const BPP: usize>(row: &mut [u8], above: &[u8], a: U8, c: U8) -> U8 {
        let widen = |v| U16::widen_lower(v).bitcast::<I16>();
        let add = |x: I16, y: I16| (x.bitcast::<U8>() + y.bitcast::<U8>()).bitcast::<I16>();
        let (mut a, mut c) = (widen(a), widen(c));
        #[rustc_unroll(never)]
        for (pixel, &b) in row
            .as_chunks_mut::<BPP>()
            .0
            .iter_mut()
            .zip(above.as_chunks::<BPP>().0)
        {
            let (x, b) = (widen(load_pixel(*pixel)), widen(load_pixel(b)));
            let threshold = (c + c + c - b).opaque() - a;
            let (low, high) = (a.simd_min(b), a.simd_max(b));
            let low_or_c = high.simd_gt(threshold).select(add(x, c), add(x, low));
            (a, c) = (threshold.simd_gt(low).select(low_or_c, add(x, high)), b);
            *pixel = first_pixel(U8::saturating_narrow(a, a));
        }
        U8::saturating_narrow(a, a)
    }

    fn unfilter_paeth<const BPP: usize>(row: &mut [u8], above: &[u8]) {
        let (mut a, mut c, mut done) = (U8::zero(), U8::zero(), 0);
        let last_pixel = |v: U8| v.shift_in::<BPP>(v);
        let (above, in_blocks) = (&above[..row.len()], row.len() / BLOCK * BLOCK);
        let are_flat_from = |at: usize| {
            let [b, c] = [at, at - BPP].map(|at| above[at..].as_chunks().0);
            (b.iter().zip(c)).map(|(b, c)| U8::load(b).simd_eq(U8::load(c)).all())
        };
        if BPP.is_power_of_two()
            && let (Some(block), Some(b)) = (row.first_chunk_mut(), above.first_chunk())
            && last_pixel(U8::load(b)).simd_eq(U8::load(b)).all()
        {
            // The first pixel adds `b`, as if that were to its left.
            (c, done) = (U8::load(b), BLOCK);
            a = sub_block::<BPP>(c, U8::load(block));
            a.store(block);
        }
        while BPP.is_power_of_two() && done < in_blocks {
            let (start, next) = (done, if done == 0 { in_blocks.min(BUSY) } else { done });
            let looks = are_flat_from(next).step_by(BUSY / BLOCK);
            done = in_blocks.min(next + looks.take_while(|is_flat| !is_flat).count() * BUSY);
            let (to, from) = (&mut row[start..done], &above[start..done]);
            a = match BPP {
                1 if !isa::Isa::HAS_SINGLE_CYCLE_OPS => paeth_bytes(to, from, a, c),
                8 => paeth_pixels::<BPP>(to, from, last_pixel(a), last_pixel(c)),
                _ => paeth_blocks::<BPP>(to, from, a, c),
            };
            // Where `b` is `c`, the filter is Sub.
            let blocks = row[done..].as_chunks_mut().0.iter_mut();
            for (block, _) in blocks.zip(are_flat_from(done)).take_while(|it| it.1) {
                a = sub_block::<BPP>(a, U8::load(block));
                a.store(block);
                done += BLOCK;
            }
            c = U8::from_slice(&above[done - BLOCK..]);
        }
        paeth_pixels::<BPP>(
            &mut row[done..],
            &above[done..],
            last_pixel(a),
            last_pixel(c),
        );
    }

    #[inline(always)]
    fn unfilter_pixels<const BPP: usize>(filter_type: u8, row: &mut [u8], above: &[u8]) {
        match filter_type {
            1 => unfilter_sub::<BPP>(row),
            3 => unfilter_average::<BPP>(row.as_chunks_mut().0, above.as_chunks().0),
            4 => unfilter_paeth::<BPP>(row, above),
            _ => {}
        }
    }

    /// `pblendvb` takes a cycle, and `vpblendvb` two or three on Intel.
    #[export(baseline)]
    pub fn unfilter_from_left(
        filter_type: u8,
        bytes_per_pixel: usize,
        row: &mut [u8],
        above: &[u8],
    ) {
        match bytes_per_pixel {
            1 => unfilter_pixels::<1>(filter_type, row, above),
            2 => unfilter_pixels::<2>(filter_type, row, above),
            4 => unfilter_pixels::<4>(filter_type, row, above),
            6 => unfilter_pixels::<6>(filter_type, row, above),
            8 => unfilter_pixels::<8>(filter_type, row, above),
            _ => {}
        }
    }
}

/// Leaves `row` as it is for another filter type or size. Panics if `above` is shorter.
#[inline]
pub fn unfilter(filter_type: u8, bytes_per_pixel: usize, row: &mut [u8], above: &[u8]) {
    let above = &above[..row.len()];
    match (filter_type, bytes_per_pixel) {
        (2, 1 | 2 | 4 | 6 | 8) => simd::unfilter_up(row, above),
        _ => simd::unfilter_from_left(filter_type, bytes_per_pixel, row, above),
    }
}
