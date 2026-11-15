//! Port of highway_png.cpp. `a` is left of the byte `x`, `b` is above it, and `c` is above `a`.

use core::ops::{Add, Sub};

type Rgba = [u8; 4];

#[inline(always)]
fn before<const BPP: usize>(row: &[[u8; BPP]], at: usize) -> [u8; BPP] {
    at.checked_sub(1).map_or([0; BPP], |at| row[at])
}

/// `step(x, [b, c, 3c - b])` for each pixel after the first `from`. There has to be one.
#[inline(always)]
fn for_each_with_above<P: Copy, V: Copy + Add<Output = V> + Sub<Output = V>>(
    (row, above, from): (&mut [P], &[P], usize),
    mut c: V,
    load: impl Fn(P) -> V,
    mut step: impl FnMut(&mut P, [V; 3]),
) {
    let (last, row) = row[from..].split_last_mut().unwrap();
    let mut b = load(above[from]);
    // An iteration ahead, or LLVM takes `a` in first, which is what each pixel waits for.
    let mut three_c_minus_b = c + c + c - b;
    for (x, &next) in row.iter_mut().zip(&above[from + 1..]) {
        step(x, [b, c, three_c_minus_b]);
        (c, b) = (b, load(next));
        three_c_minus_b = c + c + c - b;
    }
    step(last, [b, c, three_c_minus_b]);
}

fn paeth_bytes<const BPP: usize>(row: &mut [[u8; BPP]], above: &[[u8; BPP]], from: usize) {
    let load = |pixel: [u8; BPP]| i32::from(pixel[0]);
    let (mut a, c) = (load(before(row, from)), load(before(above, from)));
    for_each_with_above((row, above, from), c, load, |x, [b, c, three_c_minus_b]| {
        let (threshold, low, high) = (three_c_minus_b - a, a.min(b), a.max(b));
        let low_or_c = if high > threshold { c } else { low };
        x[0] = x[0].wrapping_add(if threshold > low { low_or_c } else { high } as u8);
        a = load(*x);
    });
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::x128::{I16, U8, U16, U64};

    fn load_pixel<const BPP: usize>(pixel: [u8; BPP]) -> U8 {
        let mut bytes = [0; 8];
        bytes[..BPP].copy_from_slice(&pixel);
        U64::from_first(u64::from_le_bytes(bytes)).bitcast()
    }

    fn first_pixel<const BPP: usize>(v: U8) -> [u8; BPP] {
        *v.to_array().first_chunk().unwrap()
    }

    /// Returns how far the bytes are from zero for each filter type. Panics unless `row` is shortest.
    #[export(up_to = avx2)]
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
            let c_is_between = a.simd_ge(c) ^ b.simd_ge(c);
            let pc = c_is_between.select(pa.abs_diff(pb), pa.saturating_add(pb));
            let least = pa.simd_min(pb).simd_min(pc);
            let nearest = pa.simd_eq(least).select(a, pb.simd_eq(least).select(b, c));
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

    /// In a vector that has whole pixels.
    fn repeat_pixel<const BPP: usize>(v: U8, at: u8) -> U8 {
        v.lookup((U8::iota() & (BPP as u8 - 1)) + at)
    }

    /// `a` repeats the pixel before `block`. The result repeats its last pixel.
    fn sub_block<const BPP: usize>(a: U8, block: &mut [u8; 16]) -> U8 {
        let mut x = U8::load(block);
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
        x += a;
        x.store(block);
        repeat_pixel::<BPP>(x, 16 - BPP as u8)
    }

    fn unfilter_sub<const BPP: usize>(mut row: &mut [u8]) {
        let mut a = U8::zero();
        if BPP.is_power_of_two() {
            let blocks;
            (blocks, row) = row.as_chunks_mut();
            for block in blocks {
                a = sub_block::<BPP>(a, block);
            }
        }
        for pixel in row.as_chunks_mut::<BPP>().0 {
            a += load_pixel(*pixel);
            *pixel = first_pixel(a);
        }
    }

    #[inline(never)]
    fn unfilter_up(row: &mut [u8], above: &[u8]) {
        isa::U8::zip_in_place(row, above, |x, b| x + b);
    }

    fn unfilter_average<const BPP: usize>(row: &mut [[u8; BPP]], above: &[[u8; BPP]]) {
        let mut a = U8::zero();
        for (pixel, &b) in row.iter_mut().zip(above) {
            let b = load_pixel(b);
            a = load_pixel(*pixel) + (a + b - a.average_round(b));
            *pixel = first_pixel(a);
        }
    }

    fn paeth_pixels<const BPP: usize>(row: &mut [[u8; BPP]], above: &[[u8; BPP]], from: usize) {
        if BPP == 1 {
            return paeth_bytes(row, above, from);
        }
        let load = |pixel| U16::widen_lower(load_pixel(pixel)).bitcast::<I16>();
        let add = |x: I16, y: I16| (x.bitcast::<U8>() + y.bitcast::<U8>()).bitcast::<I16>();
        let (mut a, c) = (load(before(row, from)), load(before(above, from)));
        for_each_with_above(
            (row, above, from),
            c,
            load,
            |pixel, [b, c, three_c_minus_b]| {
                let (x, threshold) = (load(*pixel), three_c_minus_b - a);
                let (low, high) = (a.simd_min(b), a.simd_max(b));
                let low_or_c = high.simd_gt(threshold).select(add(x, c), add(x, low));
                a = threshold.simd_gt(low).select(low_or_c, add(x, high));
                *pixel = first_pixel(U8::saturating_narrow(a, a));
            },
        );
    }

    /// The block at `at` repeats the pixel before it.
    fn is_flat<const BPP: usize>(above: &[[u8; BPP]], at: usize) -> bool {
        let pixels = above.get(at.wrapping_sub(1)..at + 16 / BPP);
        pixels.map(<[_]>::as_flattened).is_some_and(|bytes| {
            let (here, before) = (U8::from_slice(&bytes[BPP..]), U8::from_slice(bytes));
            here.simd_eq(before).all()
        })
    }

    fn unfilter_paeth<const BPP: usize>(row: &mut [[u8; BPP]], above: &[[u8; BPP]]) {
        if !BPP.is_power_of_two() && !row.is_empty() {
            return paeth_pixels(row, above, 0);
        }
        let mut at = 0;
        while at < row.len() {
            // There, `b` is `c`, so `a` is the nearest.
            if is_flat(above, at) {
                let mut a = repeat_pixel::<BPP>(load_pixel(row[at - 1]), 0);
                while is_flat(above, at) {
                    let block = row[at..].as_flattened_mut().first_chunk_mut().unwrap();
                    a = sub_block::<BPP>(a, block);
                    at += 16 / BPP;
                }
                continue;
            }
            let mut end = at + 64 / BPP;
            while end < row.len() && !is_flat(above, end) {
                end += 64 / BPP;
            }
            end = end.min(row.len());
            paeth_pixels(&mut row[..end], above, at);
            at = end;
        }
    }

    #[inline(always)]
    fn unfilter_pixels<const BPP: usize>(filter_type: u8, row: &mut [u8], above: &[u8]) {
        match filter_type {
            1 => unfilter_sub::<BPP>(row),
            2 => unfilter_up(row, above),
            3 => unfilter_average::<BPP>(row.as_chunks_mut().0, above.as_chunks().0),
            4 => unfilter_paeth::<BPP>(row.as_chunks_mut().0, above.as_chunks().0),
            _ => {}
        }
    }

    /// Panics if `above` is shorter than `row`.
    #[export(up_to = avx2)]
    pub fn unfilter(filter_type: u8, bytes_per_pixel: usize, row: &mut [u8], above: &[u8]) {
        let above = &above[..row.len()];
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
