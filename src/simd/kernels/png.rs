//! Port of highway_png.cpp: the encoder, and the decoder for pixels of 4 bytes.

type Pixel = [u8; 4];

#[inline(always)]
fn before(row: &[Pixel], at: usize) -> Pixel {
    at.checked_sub(1).map_or([0; 4], |at| row[at])
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, U32, U64, x128};

    #[inline(always)]
    fn filter(x: U8, a: U8, b: U8, c: U8, counts: U8, sums: &mut [U64; 5]) -> [U8; 4] {
        let average = x - (a.average_round(b) - ((a ^ b) & 1));
        let (pa, pb) = (b.abs_diff(c), a.abs_diff(c));
        let c_is_between = a.simd_ge(c) ^ b.simd_ge(c);
        let pc = c_is_between.select(pa.abs_diff(pb), pa.saturating_add(pb));
        let least = pa.simd_min(pb).simd_min(pc);
        let nearest = pa.simd_eq(least).select(a, pb.simd_eq(least).select(b, c));
        let filtered = [x - a, x - b, average, x - nearest];
        let distance = |v: U8| U64::sums_of_8(v.simd_min(v.wrapping_neg()) & counts);
        sums[0] += distance(x);
        for i in 0..4 {
            sums[i + 1] += distance(filtered[i]);
        }
        filtered
    }

    #[export(up_to = avx2)]
    pub fn filter_rgba(row: &[u8], above: &[u8], filtered: [&mut [u8]; 4]) -> [u64; 5] {
        let [sub, up, average, paeth] = filtered;
        let len = row
            .len()
            .min(above.len())
            .min(sub.len().min(up.len()))
            .min(average.len().min(paeth.len()));
        let row = &row[..len];
        let (above, sub, up, average, paeth) = (
            &above[..len],
            &mut sub[..len],
            &mut up[..len],
            &mut average[..len],
            &mut paeth[..len],
        );
        let mut sums = [U64::zero(); 5];

        let left_of = |v: U8| {
            v.bitcast::<U32>()
                .shift_elements_right::<1>(0)
                .bitcast::<U8>()
        };

        if len < U8::LEN + 4 {
            let mut at = 0;
            while at < len {
                let n = (len - at).min(if at == 0 { U8::LEN - 1 } else { 4 });
                let (x, b) = (
                    U8::load_or_default(&row[at..at + n]),
                    U8::load_or_default(&above[at..at + n]),
                );
                let (a, c) = if at == 0 {
                    (left_of(x), left_of(b))
                } else {
                    (
                        U8::load_or_default(&row[at - 4..]),
                        U8::load_or_default(&above[at - 4..]),
                    )
                };
                let f = filter(
                    x,
                    a,
                    b,
                    c,
                    U8::iota().simd_lt(n as u8).to_vector(),
                    &mut sums,
                );
                f[0].store_first(&mut sub[at..at + n]);
                f[1].store_first(&mut up[at..at + n]);
                f[2].store_first(&mut average[at..at + n]);
                f[3].store_first(&mut paeth[at..at + n]);
                at += n;
            }
            return [
                sums[0].reduce_sum(),
                sums[1].reduce_sum(),
                sums[2].reduce_sum(),
                sums[3].reduce_sum(),
                sums[4].reduce_sum(),
            ];
        }

        let (x, b) = (U8::from_slice(row), U8::from_slice(above));
        let f = filter(x, left_of(x), b, left_of(b), U8::splat(0xFF), &mut sums);
        f[0].copy_to_slice(sub);
        f[1].copy_to_slice(up);
        f[2].copy_to_slice(average);
        f[3].copy_to_slice(paeth);

        let (n, left) = (U8::LEN, U8::LEN - 4);
        let inputs = (row[n..].as_chunks().0.iter().zip(row[left..].as_chunks().0)).zip(
            above[n..]
                .as_chunks()
                .0
                .iter()
                .zip(above[left..].as_chunks().0),
        );
        let outputs = (sub[n..]
            .as_chunks_mut()
            .0
            .iter_mut()
            .zip(up[n..].as_chunks_mut().0))
        .zip(
            average[n..]
                .as_chunks_mut()
                .0
                .iter_mut()
                .zip(paeth[n..].as_chunks_mut().0),
        );
        for (((x, a), (b, c)), ((sub, up), (average, paeth))) in inputs.zip(outputs) {
            let f = filter(
                U8::load(x),
                U8::load(a),
                U8::load(b),
                U8::load(c),
                U8::splat(0xFF),
                &mut sums,
            );
            f[0].store(sub);
            f[1].store(up);
            f[2].store(average);
            f[3].store(paeth);
        }
        if len % n != 0 {
            let at = len - n;
            let (x, a) = (U8::from_slice(&row[at..]), U8::from_slice(&row[at - 4..]));
            let (b, c) = (
                U8::from_slice(&above[at..]),
                U8::from_slice(&above[at - 4..]),
            );
            let f = filter(
                x,
                a,
                b,
                c,
                U8::iota().simd_gt((n - 1 - len % n) as u8).to_vector(),
                &mut sums,
            );
            f[0].copy_to_slice(&mut sub[at..]);
            f[1].copy_to_slice(&mut up[at..]);
            f[2].copy_to_slice(&mut average[at..]);
            f[3].copy_to_slice(&mut paeth[at..]);
        }
        [
            sums[0].reduce_sum(),
            sums[1].reduce_sum(),
            sums[2].reduce_sum(),
            sums[3].reduce_sum(),
            sums[4].reduce_sum(),
        ]
    }

    fn load_pixel(p: Pixel) -> x128::U8 {
        x128::U32::from_first(u32::from_le_bytes(p)).bitcast()
    }
    fn pixel_of(v: x128::U8) -> Pixel {
        v.bitcast::<x128::U32>()[0].to_le_bytes()
    }
    fn load_wide(p: Pixel) -> x128::I16 {
        x128::U16::widen_lower(load_pixel(p)).bitcast()
    }

    fn sub_block(a: x128::U8, block: &mut [u8]) -> x128::U8 {
        use x128::{U8, U32};
        let mut x = U8::from_slice(block);
        x += x
            .bitcast::<U32>()
            .shift_elements_right::<1>(0)
            .bitcast::<U8>();
        x += x
            .bitcast::<U32>()
            .shift_elements_right::<2>(0)
            .bitcast::<U8>();
        x += a;
        x.copy_to_slice(block);
        x.bitcast::<U32>().splat_last().bitcast()
    }

    fn paeth_pixels(row: &mut [Pixel], above: &[Pixel], from: usize, to: usize) {
        use x128::{I16, U8};
        let add = |x: I16, y: I16| (x.bitcast::<U8>() + y.bitcast::<U8>()).bitcast::<I16>();
        let (mut a, mut c) = (load_wide(before(row, from)), load_wide(before(above, from)));
        for (pixel, &b) in row[from..to].iter_mut().zip(&above[from..to]) {
            let (x, b) = (load_wide(*pixel), load_wide(b));
            // LLVM would take `a` in first, which is what each pixel waits for.
            let threshold = core::hint::black_box(c + c + c - b) - a;
            let (low, high) = (a.simd_min(b), a.simd_max(b));
            let low_or_c = high.simd_gt(threshold).select(add(x, c), add(x, low));
            a = threshold.simd_gt(low).select(low_or_c, add(x, high));
            *pixel = pixel_of(U8::saturating_narrow(a, a));
            c = b;
        }
    }

    fn is_flat(above: &[Pixel], at: usize) -> bool {
        above.get(at.wrapping_sub(1)..at + 4).is_some_and(|five| {
            let bytes = five.as_flattened();
            x128::U8::from_slice(&bytes[4..])
                .simd_eq(x128::U8::from_slice(bytes))
                .all()
        })
    }

    #[export(up_to = avx2)]
    pub fn unfilter4(filter_type: u8, row: &mut [u8], above: &[u8]) {
        let len = row.len().min(above.len());
        let (row, above) = (&mut row[..len], &above[..len]);
        match filter_type {
            1 => {
                let mut a = x128::U8::zero();
                let (blocks, rest) = row.as_chunks_mut::<16>();
                for block in blocks {
                    a = sub_block(a, block);
                }
                for pixel in rest.as_chunks_mut().0 {
                    a += load_pixel(*pixel);
                    *pixel = pixel_of(a);
                }
            }
            2 => {
                let Some(last_at) = row.len().checked_sub(U8::LEN) else {
                    return (U8::load_or_default(row) + U8::load_or_default(above))
                        .store_first(row);
                };
                let last = U8::from_slice(&row[last_at..]) + U8::from_slice(&above[last_at..]);
                for (x, b) in row.as_chunks_mut().0.iter_mut().zip(above.as_chunks().0) {
                    (U8::load(x) + U8::load(b)).store(x);
                }
                last.copy_to_slice(&mut row[last_at..]);
            }
            3 => {
                let mut a = x128::U8::zero();
                for (pixel, &b) in row.as_chunks_mut().0.iter_mut().zip(above.as_chunks().0) {
                    let b = load_pixel(b);
                    a = load_pixel(*pixel) + (a + b - a.average_round(b));
                    *pixel = pixel_of(a);
                }
            }
            4 => {
                let (row, above) = (row.as_chunks_mut::<4>().0, above.as_chunks::<4>().0);
                let mut i = 0;
                while i < row.len() {
                    if is_flat(above, i) {
                        let mut a = x128::U32::splat(u32::from_le_bytes(before(row, i))).bitcast();
                        loop {
                            a = sub_block(a, row[i..i + 4].as_flattened_mut());
                            i += 4;
                            if !is_flat(above, i) {
                                break;
                            }
                        }
                        continue;
                    }
                    let mut end = i + 16;
                    while end < row.len() && !is_flat(above, end) {
                        end += 16;
                    }
                    let end = end.min(row.len());
                    paeth_pixels(row, above, i, end);
                    i = end;
                }
            }
            _ => {}
        }
    }
}
