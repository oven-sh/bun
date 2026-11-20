//! The JPEG kernels on every target, against the formulas.
#![forbid(unsafe_code)]
mod common;
use bun_simd::{Target, limit_to};
use bun_simd_kernels::jpeg::Chroma::{self, Full, HalfSize, HalfWidth};
use bun_simd_kernels::jpeg::{self, Block, ROW_SLACK as SLACK};
use common::{check, check_against_portable, random, sample};
use core::array::from_fn;
use core::f64::consts::{PI, SQRT_2};

/// Returns 32 bits.
fn bits() -> impl FnMut() -> u32 {
    let mut below = random();
    move || below(u32::MAX as usize) as u32
}

fn digest(bytes: impl IntoIterator<Item = u8>, so_far: u32) -> u32 {
    let add = |sum: u32, byte| (sum ^ u32::from(byte)).wrapping_mul(16777619);
    bytes.into_iter().fold(so_far, add)
}

const SIZES: [usize; 10] = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14];
const ZERO: Block = Block([0; 64]);

fn place(row: usize, column: usize) -> usize {
    [0, 32, 16, 33, 1, 48, 17, 49][row] + [0, 8, 2, 10, 4, 12, 6, 14][column]
}

fn zigzag() -> Vec<usize> {
    let mut all: Vec<_> = (0..64).map(|i| (i / 8, i % 8)).collect();
    all.sort_by_key(|&(y, x)| (y + x, if (y + x) % 2 == 0 { x } else { y }));
    all.into_iter().map(|(y, x)| place(y, x)).collect()
}

/// What each coefficient adds to each sample.
fn basis(size: usize) -> Vec<[f64; 8]> {
    let wave = |x: usize, k: usize| {
        let angle = (2 * x + 1) as f64 * k as f64 * PI / (2 * size) as f64;
        angle.cos() * if k == 0 { 1.0 } else { SQRT_2 }
    };
    if let 2 | 4 = size {
        let mean = |of: &[[f64; 8]], k| of.iter().map(|it| it[k] / of.len() as f64).sum();
        let means = |of| from_fn(|k| mean(of, k));
        return basis(8).chunks(8 / size).map(means).collect();
    }
    let row = |x| from_fn(|k| if k < size { wave(x, k) } else { 0.0 });
    (0..size).map(row).collect()
}

fn inverse(blocks: &[Block], quant: &Block, size: usize) -> Vec<Vec<u8>> {
    let (len, stride) = (blocks.len() * size, blocks.len() * size + SLACK + 3);
    let mut out = vec![7; size * stride - 3];
    jpeg::inverse_transform(blocks, quant, size, &mut out, stride).unwrap();
    let is_untouched = |row: &[u8]| row[len + SLACK..].iter().all(|&it| it == 7);
    assert!(out.chunks(stride).all(is_untouched));
    out.chunks(stride).map(|row| row[..len].to_vec()).collect()
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn inverse_transform_is_close_to_the_exact_one() {
    let mut next = bits();
    for (round, size) in (0..40).flat_map(|round| SIZES.map(|size| (round, size))) {
        let quant = Block(from_fn(|_| 1 + next() as i16 % 2 * 2));
        let mut coefficient = |i| match next() % (1 + round * 3) * i as u32 {
            0 => next() as i8 as i16 / 2,
            _ => 0,
        };
        let blocks: [_; 3] = from_fn(|_| Block(from_fn(&mut coefficient)));
        let basis = basis(size);
        let exact = |y: usize, x: usize| {
            let term = |i: usize| {
                let (v, u, at) = (i / 8, i % 8, place(i / 8, i % 8));
                let value = f64::from(blocks[x / size].0[at] * quant.0[at]);
                value * basis[y][v] * basis[x % size][u]
            };
            ((0..64).map(term).sum::<f64>() / 8.0 + 128.0).clamp(0.0, 255.0)
        };
        limit_to(Target::Portable);
        let got = inverse(&blocks, &quant, size);
        for (y, x) in (0..size).flat_map(|y| (0..3 * size).map(move |x| (y, x))) {
            assert!((f64::from(got[y][x]) - exact(y, x)).abs() < 1.0);
        }
        check(got, || inverse(&blocks, &quant, size));
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn inverse_transform_of_any_coefficients() {
    let (mut next, mut all) = (bits(), 0);
    for (round, size) in (0..200).flat_map(|round| SIZES.map(|size| (round, size))) {
        let quant = Block(from_fn(|_| next() as i16 >> (round % 16)));
        let blocks: [_; 2] = from_fn(|_| Block(from_fn(|_| next() as i16 >> (round / 16))));
        check_against_portable(|| inverse(&blocks, &quant, size));
        all = digest(inverse(&blocks, &quant, size).concat(), all);
    }
    assert_eq!(all, 1207272743);
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn flat_blocks() {
    for dc in (i16::MIN..=i16::MAX).step_by(7) {
        // The product has 16 bits.
        let step = if dc % 8 == 0 { 255 } else { 1 };
        let mut block = ZERO;
        block.0[0] = dc;
        let mean = (((i32::from(dc.wrapping_mul(step)) + 4) >> 3) + 128).clamp(0, 255) as u8;
        for size in [5, 8, 14] {
            check(vec![vec![mean; size]; size], || {
                inverse(&[block], &Block([step; 64]), size)
            });
        }
    }
    for (first, last) in (1..64).flat_map(|first| (first..64).map(move |last| (first, last))) {
        for [a, between, b] in [[1, 0, 1], [1, 0, -1], [1; 3], [-1; 3], [256, 0, 256]] {
            let mut block = ZERO;
            block.0[first..=last].fill(between);
            (block.0[first], block.0[last]) = (a, b);
            check(true, || {
                inverse(&[block], &Block([100; 64]), 8) != [[128; 8]; 8]
            });
        }
    }
}

fn forward<const MASKS: usize>(
    samples: &[u8],
    divisors: &[Block; 2],
) -> Vec<([i16; 64], [u64; MASKS])> {
    let (mut blocks, mut masks) = ([Block([-1; 64]); 2], [[!0; MASKS]; 2]);
    jpeg::forward_transform(samples, 19, divisors, &mut blocks, &mut masks).unwrap();
    blocks.map(|it| it.0).into_iter().zip(masks).collect()
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn forward_transform() {
    let mut all = 0;
    let (mut next, zigzag, basis) = (bits(), zigzag(), basis(8));
    for round in 0..300 {
        let mut sample = |_| match round % 3 {
            0 => next() as u8,
            1 => (next() as u8 & 1).wrapping_neg(),
            _ => 100 + next() as u8 % 8,
        };
        let samples: Vec<u8> = (0..7 * 19 + 16).map(&mut sample).collect();
        let steps: [u32; 64] = from_fn(|_| 8 * (1 + next() % [1, 4, 255][round / 3 % 3]));
        let divisors = [
            steps.map(|it| (1u32 << (15 + it.ilog2())).div_ceil(it).min(0x7FFF) as i16),
            steps.map(|it| 1 << (14 - it.ilog2())),
        ]
        .map(Block);

        limit_to(Target::Portable);
        let want = forward::<4>(&samples, &divisors);
        for (x, (block, masks)) in want.iter().enumerate() {
            all = digest(block.map(i16::to_le_bytes).concat(), all);
            for (v, u) in (0..8).flat_map(|v| (0..8).map(move |u| (v, u))) {
                let term = |i: usize| {
                    let centered = f64::from(samples[i / 8 * 19 + 8 * x + i % 8]) - 128.0;
                    centered * basis[i / 8][v] * basis[i % 8][u]
                };
                let (step, exact) = (
                    f64::from(steps[place(v, u)]),
                    (0..64).map(term).sum::<f64>(),
                );
                let error = exact / step - f64::from(block[place(v, u)]);
                assert!(error.abs() <= 0.5 + 2.0 / step, "{error}");
                let k = zigzag.iter().position(|&at| at == place(v, u)).unwrap();
                assert!(exact.abs() <= 2.0 || (masks[3] >> k & 1 != 0) == (exact < 0.0));
            }
            let mask = |is: fn(i16) -> bool| -> u64 {
                let bit = |(k, &at): (usize, &usize)| u64::from(is(block[at])) << k;
                zigzag.iter().enumerate().map(bit).sum()
            };
            let planes = [
                mask(|it| it.abs() & 1 != 0),
                mask(|it| it.abs() & 2 != 0),
                mask(|it| it.abs() > 3),
            ];
            assert_eq!(masks[..3], planes);
            assert_eq!(masks[3] & mask(|it| it != 0), mask(|it| it < 0));
        }
        let not_zero = |&(block, [a, b, c, _]): &(_, [u64; 4])| (block, [a | b | c]);
        check(want.iter().map(not_zero).collect(), || {
            forward::<1>(&samples, &divisors)
        });
        check(want, || forward::<4>(&samples, &divisors));
    }
    assert_eq!(all, 1012887884);
}

/// jdcolor.c
fn rgba(y: u8, cb: u8, cr: u8) -> [u8; 4] {
    let (y, cb, cr) = (i32::from(y), i32::from(cb) - 128, i32::from(cr) - 128);
    let plus = |sum: i32| (y + ((sum + 32768) >> 16)).clamp(0, 255) as u8;
    let green = -22554 * cb - 46802 * cr;
    [plus(91881 * cr), plus(green), plus(116130 * cb), 255]
}

fn converted(y: &[u8], chroma: Chroma<'_>, width: usize, room: usize) -> Option<Vec<[u8; 4]>> {
    let mut out = Vec::with_capacity(1 + room);
    out.push([9; 4]);
    let fits = jpeg::ycc_to_rgba(y, chroma, width, &mut out);
    assert_eq!(out.len(), 1 + fits.map_or(0, |()| width));
    fits.map(|()| out.split_off(1))
}

#[test]
fn each_chroma() {
    let cr: [u8; 256] = from_fn(|i| i as u8);
    for (cb, y) in sample((0..=255).zip(0..), 256) {
        let (y, cb): ([u8; 256], _) = (from_fn(|i| (i * 7 + y * 31) as u8), [cb; 256]);
        let want = (0..256).map(|i| rgba(y[i], cb[i], cr[i])).collect();
        check(Some(want), || {
            converted(&y, Full { cb: &cb, cr: &cr }, 256, 256)
        });
    }
}

#[test]
fn upsampled_chroma() {
    let mut next = bits();
    for round in sample(0..400, 400) {
        let (width, mask) = (1 + (round + 32) % 96, [0xFF, 0x81][round % 2]);
        let padded = width.next_multiple_of(32);
        let mut row = |len| -> Vec<u8> {
            let sample = |it: u8| {
                if mask == 0xFF {
                    it
                } else {
                    (it & 1).wrapping_neg()
                }
            };
            (0..len).map(|_| sample(next() as u8)).collect()
        };
        let y = row(padded);
        let [a, b, c, d] = [(); 4].map(|()| row(padded / 2 + 4));
        // jdsample.c
        let across =
            |at: &dyn Fn(usize) -> u32, x: usize| 3 * at(x / 2 + 1) + at(x / 2 + x % 2 * 2);
        let h2v1 = |row: &[u8], x| ((across(&|i| row[i].into(), x) + [1, 2][x % 2]) >> 2) as u8;
        let h2v2 = |near: &[u8], far: &[u8], x| {
            let column = |i: usize| 3 * u32::from(near[i]) + u32::from(far[i]);
            ((across(&column, x) + [8, 7][x % 2]) >> 4) as u8
        };
        let want = (0..width).map(|x| rgba(y[x], h2v1(&a, x), h2v1(&c, x)));
        check(Some(want.collect()), || {
            converted(&y, HalfWidth { cb: &a, cr: &c }, width, padded)
        });
        let want = (0..width).map(|x| rgba(y[x], h2v2(&a, &b, x), h2v2(&c, &d, x)));
        check(Some(want.collect()), || {
            let (cb, cr) = ([&a[..], &b], [&c[..], &d]);
            converted(&y, HalfSize { cb, cr }, width, padded)
        });
    }
}

/// jccolor.c
fn ycc([r, g, b, _]: [u8; 4]) -> [u32; 3] {
    let (r, g, b, bias) = (
        i32::from(r),
        i32::from(g),
        i32::from(b),
        (128 << 16) + 32767,
    );
    [
        19595 * r + 38470 * g + 7471 * b + 32768,
        -11059 * r - 21709 * g + 32768 * b + bias,
        32768 * r - 27439 * g - 5329 * b + bias,
    ]
    .map(|sum| (sum >> 16) as u32)
}

fn check_split(pixels: &[[u8; 4]], width: usize) {
    let height = pixels.len() / width;
    let average = |plane: usize, i: usize| {
        let at = i / (width / 2) * 2 * width + i % (width / 2) * 2;
        let sum = [at, at + 1, at + width, at + width + 1].map(|at| ycc(pixels[at])[plane]);
        ((sum.iter().sum::<u32>() + [1, 2][i % 2]) >> 2) as u8
    };
    let want = [
        pixels.iter().map(|&it| ycc(it)[0] as u8).collect(),
        (0..pixels.len() / 4).map(|i| average(1, i)).collect(),
        (0..pixels.len() / 4).map(|i| average(2, i)).collect(),
    ];
    check(want, || {
        let mut planes = [1, 4, 4].map(|it| vec![0; pixels.len() / it]);
        let into = planes.each_mut().map(|it| &mut it[..]);
        jpeg::rgba_to_ycc420(pixels, width, width, height / 2, into, width / 2).unwrap();
        planes
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn split_colors() {
    let mut next = bits();
    for round in 0..200 {
        let pixel = |_| next().to_le_bytes();
        let width = 32 * (1 + round % 3);
        check_split(&(0..4 * width).map(pixel).collect::<Vec<_>>(), width);
    }
    // Each difference to green, next to an even one and to an odd one.
    for (green, other) in [(0, 0), (0, 1), (255, 0), (255, 1)] {
        let reds = (0..1024).map(|i| [(i / 2) as u8, green, other, 0]);
        let blues = reds.clone().map(|[r, g, b, a]| [b, g, r, a]);
        check_split(&reds.chain(blues).collect::<Vec<_>>(), 512);
    }
}

#[test]
#[ignore = "slow"]
fn split_each_color() {
    for red in 0..=255 {
        let pixel = |i: usize| [red, (i / 1024) as u8, (i / 2) as u8, i as u8];
        check_split(&(0..1 << 18).map(pixel).collect::<Vec<_>>(), 512);
    }
}

const HUGE: usize = 1 << (usize::BITS - 1);

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn blocks_that_do_not_fit() {
    let fits = |size, len, stride| {
        jpeg::inverse_transform(&[ZERO; 2], &ZERO, size, &mut vec![0; len], stride)
    };
    for size in [0, 1, 9, 11, 13, 15, 16] {
        check(None, || fits(size, 4096, 64));
    }
    for size in SIZES {
        let len = (size - 1) * 64 + size + SLACK;
        check(Some(()), || fits(size, len, 64));
        for (len, stride) in [(len - 1, 64), (4096, HUGE), (4096, usize::MAX)] {
            check(None, || fits(size, len, stride));
        }
    }

    let fits = |[len, stride, masks]: [usize; 3]| {
        let (samples, mut masks) = (vec![0; len], vec![[0; 4]; masks]);
        jpeg::forward_transform(&samples, stride, &[ZERO; 2], &mut [ZERO; 2], &mut masks)
    };
    let (len, overflows) = (7 * 20 + 16, usize::MAX / 7 + 1);
    check(Some(()), || fits([len, 20, 2]));
    for misfit in [
        [len - 1, 20, 2],
        [len, 20, 1],
        [len, 20, 3],
        [len, overflows, 2],
    ] {
        check(None, || fits(misfit));
    }
}

#[test]
fn rows_that_do_not_fit() {
    for (groups, nth) in sample((0..5).flat_map(|nth| [(2, nth), (1, nth)]), 10) {
        let (full, half) = (&[0; 64][..32 * groups], &[0; 36][..16 * groups + 4]);
        let (len, few) = (full.len(), full.len() - 31);
        let rows = |row: &'static [u8]| [0, 1, 2, 3].map(|i| &row[usize::from(i == nth)..]);
        let ([cb, cr, ..], [a, b, c, d]) = (rows(full), rows(half));
        let (not_halved, half_width) = (Full { cb, cr }, HalfWidth { cb: a, cr: b });
        let (cb, cr) = ([a, b], [c, d]);
        for (chroma, count) in [(not_halved, 2), (half_width, 2), (HalfSize { cb, cr }, 4)] {
            check(nth >= count, || converted(full, chroma, few, len).is_some());
            for (y, width, room) in [
                (&full[1..], few, len),
                (full, few, len - 1),
                (full, !0, len),
            ] {
                check(None, || converted(y, chroma, width, room));
            }
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn planes_that_do_not_fit() {
    let fits = |lens: [usize; 4], [rgba_stride, width, row_pairs, chroma_stride]: [usize; 4]| {
        let rgba = vec![[0; 4]; lens[0]];
        let [_, mut y, mut cb, mut cr] = lens.map(|len| vec![0; len]);
        let ycc = [&mut *y, &mut *cb, &mut *cr];
        jpeg::rgba_to_ycc420(&rgba, rgba_stride, width, row_pairs, ycc, chroma_stride)
    };
    let lens = [5 * 70 + 32, 5 * 40 + 32, 2 * 20 + 16, 2 * 20 + 16];
    for it in [
        [70, 32, 3, 20],
        [0, 32, 3, 20],
        [70, 0, 3, 20],
        [70, 32, 0, 20],
    ] {
        check(Some(()), || fits(lens, it));
    }
    for nth in 0..4 {
        let mut lens = lens;
        lens[nth] -= 1;
        check(None, || fits(lens, [70, 32, 3, 20]));
    }
    for misfit in [
        [HUGE, 32, 1, 20],
        [0, 32, HUGE, 20],
        [70, 32, 1, HUGE + 20],
        [70, 32, 1, 15],
    ] {
        check(None, || fits(lens, misfit));
    }
    for width in [16, 30, 34] {
        check(None, || fits(lens, [70, width, 1, 20]));
    }
}
