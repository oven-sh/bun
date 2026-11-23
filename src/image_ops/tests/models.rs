//! The kernels for all targets against plain loops, and what `Bun.Image` cannot bring about: memory that is refused at a
//! given point, and sizes that do not match.

use bun_image_ops::{Error, Filter, Image, Pixel, Result, extremes, modulate};
use bun_simd::target::{Target, reset_cpu, set_cpu};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    /// How many allocations are granted before one is refused.
    static GRANTS: Cell<Option<usize>> = const { Cell::new(None) };
}

struct Refusing;

// SAFETY: what is not refused is left to `System`.
unsafe impl GlobalAlloc for Refusing {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let grants = GRANTS.get();
        GRANTS.set(grants.and_then(|it| it.checked_sub(1)));
        if grants == Some(0) {
            return std::ptr::null_mut();
        }
        // SAFETY: the caller's promises are passed on.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: as above.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Refusing = Refusing;

const FILTERS: [Filter; 9] = [
    Filter::Box,
    Filter::Bilinear,
    Filter::Lanczos3,
    Filter::Mitchell,
    Filter::Nearest,
    Filter::Cubic,
    Filter::Lanczos2,
    Filter::Mks2013,
    Filter::Mks2021,
];
const STEP: usize = if cfg!(miri) { 5 } else { 1 };
const SIDES: &[u32] = if cfg!(miri) {
    &[1, 5]
} else {
    &[1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 31, 32, 33, 50]
};

fn noise(len: u32, mut state: u32) -> Vec<Pixel> {
    let mut next = |_| {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        (state ^ state >> 15)
            .wrapping_mul(0x2c1b_3c6d)
            .to_be_bytes()
    };
    (0..len).map(&mut next).collect()
}

fn for_each_size(more: &[(u32, u32)], test: impl Fn(Image<'_>, &[Pixel], u32, u32) -> Result<()>) {
    let sizes = SIDES
        .iter()
        .flat_map(|&w| SIDES.iter().map(move |&h| (w, h)));
    for (w, h) in sizes.skip(STEP * 3 / 5).chain(more.iter().copied()) {
        let pixels = noise(w * h, w);
        let image = Image::new(pixels.as_flattened(), w, h);
        assert_eq!(image.and_then(|image| test(image, &pixels, w, h)), Ok(()));
    }
}

fn rotates_and_flips() {
    let large: &[_] = if cfg!(miri) {
        &[(6, 3)]
    } else {
        &[
            (515, 513),
            (512, 516),
            (6, 50_001),
            (60_001, 5),
            (131, 4),
            (132, 5),
            (128, 8),
        ]
    };
    for_each_size(large, |image, pixels, w, h| {
        let model = |w: u32, h: u32, from: &dyn Fn(u32, u32) -> u32| -> Vec<u8> {
            (0..w * h)
                .flat_map(|i| pixels[from(i % w, i / w) as usize])
                .collect()
        };
        assert_eq!(image.rotate(0)?, pixels.as_flattened());
        assert_eq!(image.rotate(90)?, model(h, w, &|x, y| (h - 1 - x) * w + y));
        assert_eq!(
            image.rotate(180)?,
            model(w, h, &|x, y| (h - 1 - y) * w + w - 1 - x)
        );
        assert_eq!(image.rotate(270)?, model(h, w, &|x, y| x * w + w - 1 - y));
        assert_eq!(
            image.flip_horizontally()?,
            model(w, h, &|x, y| y * w + w - 1 - x)
        );
        assert_eq!(
            image.flip_vertically()?,
            model(w, h, &|x, y| (h - 1 - y) * w + x)
        );
        Ok(())
    });
}

fn resizing_keeps_what_it_can() {
    for_each_size(&[], |image, pixels, w, h| {
        let flat = [173, 0, 255, 1].repeat((w * h) as usize);
        for filter in FILTERS.into_iter().step_by(STEP) {
            let resized = Image::new(&flat, w, h)?.resize(h, w, filter)?;
            assert_eq!(resized, flat, "{filter:?}");
        }
        let exact = [
            Filter::Lanczos3,
            Filter::Box,
            Filter::Bilinear,
            Filter::Nearest,
            Filter::Cubic,
        ];
        for filter in exact.into_iter().step_by(STEP) {
            assert_eq!(
                image.resize(w, h, filter)?,
                pixels.as_flattened(),
                "{filter:?}"
            );
        }
        let doubled =
            (0..4 * w * h).flat_map(|i| pixels[(i / (4 * w) * w + i % (2 * w) / 2) as usize]);
        assert_eq!(
            image.resize(2 * w, 2 * h, Filter::Nearest)?,
            doubled.collect::<Vec<_>>()
        );
        Ok(())
    });
}

/// The output must not change. `RECORDED` has a checksum of it for each filter.
fn resizes_as_recorded() {
    const RECORDED: [u32; 9] = [
        2221344718, 1655039028, 2588858793, 850566421, 3101487290, 3220616030, 3618803591,
        986290389, 701465370,
    ];
    let pixels = noise(20_000, 1);
    let found = FILTERS.map(|filter| {
        let mut sum = 0u32;
        for [w, h] in [[200, 100], [37, 41], [5000, 4], [3, 5000], [1, 1]] {
            for [to_w, to_h] in [[100, 50], [1, 1], [7, 90], [61, 3], [16, 16]] {
                let resized = Image::new(pixels.as_flattened(), w, h)
                    .and_then(|it| it.resize(to_w, to_h, filter));
                let add = |sum: u32, byte| sum.wrapping_mul(16777619) ^ u32::from(byte);
                sum = resized.unwrap().into_iter().fold(sum, add);
            }
        }
        sum
    });
    assert_eq!(found, RECORDED);
}

/// The rows don't depend on each other, but how they are done depends on how many there are.
fn resizes_many_rows_as_one() {
    const ROWS: u32 = 35;
    let more = (250..270).chain([515, 700, 1030]);
    for (w, filter) in (1..40).chain(more).zip(FILTERS.into_iter().cycle()) {
        let pixels = noise(w * ROWS, w);
        for to in [1, w / 7 + 1, w / 4 + 1, w / 2 + 1, w * 2 / 3 + 1, w + 3] {
            let resize = |pixels: &[Pixel], filter| {
                let h = pixels.len() as u32 / w;
                let image = Image::new(pixels.as_flattened(), w, h);
                image.and_then(|it| it.resize(to, h, filter)).unwrap()
            };
            let keeps_rows =
                !matches!(filter, Filter::Mitchell | Filter::Mks2013 | Filter::Mks2021);
            for filter in [Filter::Lanczos3]
                .into_iter()
                .chain(keeps_rows.then_some(filter))
            {
                let rows = pixels.chunks(w as usize);
                let alone: Vec<u8> = rows.flat_map(|row| resize(row, filter)).collect();
                assert!(resize(&pixels, filter) == alone, "{w} {to} {filter:?}");
            }
        }
    }
}

fn resizes_long_lines() {
    let pixels = noise(70_000, 1);
    for (w, h) in [(70_000, 1), (1, 70_000)] {
        let image = Image::new(pixels.as_flattened(), w, h).unwrap();
        assert!(image.resize(w, h, Filter::Bilinear).unwrap() == pixels.as_flattened());
    }
}

fn finds_each_of_256_colors() {
    let palette = noise(256, 7);
    let image = Image::new(palette.as_flattened(), 16, 16).unwrap();
    for dither in [false, true] {
        assert_eq!(image.to_indices(&palette, dither), Ok((0..=255).collect()));
    }
}

#[bun_simd::kernel(Upto<B32>)]
fn is_fused() -> bool {
    bun_simd::has!(fma)
}

fn modulates() {
    // The product and the sum of these numbers are exact in `f64`.
    let mul_add = |a: f32, b: f32, c: f32| {
        if is_fused() {
            (f64::from(a) * f64::from(b) + f64::from(c)) as f32
        } else {
            a * b + c
        }
    };
    for (len, [brightness, saturation]) in (0..if cfg!(miri) { 6 } else { 70 }).zip(
        [[1.0, 0.0], [0.5, 1.0], [1.37, 2.11], [1e4, 1e4], [0.0, 3.0]]
            .into_iter()
            .cycle(),
    ) {
        let mut found = noise(len, len);
        // Fused and separate steps differ for these.
        if len > 2 {
            found.extend([[188, 2, 1, 0], [26, 76, 1, 0], [15, 0, 6, 0]]);
        }
        let model = found.iter().map(|&[r, g, b, alpha]| {
            let luma = mul_add(g.into(), 0.587, f32::from(b) * 0.114);
            let luma = mul_add(r.into(), 0.299, luma);
            let [r, g, b] = [r, g, b]
                .map(|c| (mul_add(f32::from(c) - luma, saturation, luma) * brightness + 0.5) as u8);
            [r, g, b, alpha]
        });
        let model: Vec<_> = model.collect();
        modulate(found.as_flattened_mut(), brightness, saturation);
        assert_eq!(found, model);
    }
}

fn nearest(palette: &[Pixel], color: [i32; 4]) -> u8 {
    let distance = |to: Pixel| {
        (0..4)
            .map(|c| (color[c].clamp(0, 255) - i32::from(to[c])).pow(2))
            .sum::<i32>()
    };
    (0..=255)
        .zip(palette)
        .min_by_key(|&(_, &to)| distance(to))
        .unwrap()
        .0
}

fn dithered(pixels: &[Pixel], w: usize, palette: &[Pixel]) -> Vec<u8> {
    let mut wanted: Vec<_> = pixels.iter().map(|pixel| pixel.map(i32::from)).collect();
    wanted.resize(pixels.len() + w, [0; 4]);
    let mut indices = vec![0; pixels.len()];
    for i in 0..pixels.len() {
        let (y, step) = (i / w, if i / w % 2 == 0 { 1 } else { -1 });
        let x = if step == 1 { i % w } else { w - 1 - i % w };
        let (here, index) = (wanted[y * w + x], nearest(palette, wanted[y * w + x]));
        indices[y * w + x] = index;
        for (dx, dy, part) in [(step, 0, 7), (-step, 1, 3), (0, 1, 5), (step, 1, 1)] {
            if let Some(x) = x.checked_add_signed(dx).filter(|&x| x < w) {
                for c in 0..4 {
                    wanted[(y + dy) * w + x][c] +=
                        ((here[c] - i32::from(palette[usize::from(index)][c])) * part) >> 4;
                }
            }
        }
    }
    indices
}

fn finds_the_first_of_the_nearest_colors() {
    for_each_size(&[], |image, pixels, w, h| {
        let mut palette = noise(1 + (w * h * 5 / STEP as u32) % 256, h);
        if w % 2 == 0 {
            palette
                .iter_mut()
                .for_each(|color| *color = color.map(|c| 255 * (c & 1)));
        }
        let model = pixels
            .iter()
            .map(|pixel| nearest(&palette, pixel.map(i32::from)));
        assert_eq!(
            image.to_indices(&palette, false)?,
            model.collect::<Vec<_>>()
        );
        assert_eq!(
            image.to_indices(&palette, true)?,
            dithered(pixels, w as usize, &palette)
        );
        Ok(())
    });
}

fn finds_the_extremes() {
    for len in (1..70).step_by(if cfg!(miri) { 30 } else { 1 }) {
        let pixels = noise(len, len);
        let channel = |c: usize| pixels.iter().map(move |it| it[c]);
        let words: Vec<u32> = pixels.iter().map(|&it| u32::from_le_bytes(it)).collect();
        let [min, max] = extremes(&words).map(|it| it.map(Some));
        assert_eq!(min, [0, 1, 2, 3].map(|c| channel(c).min()));
        assert_eq!(max, [0, 1, 2, 3].map(|c| channel(c).max()));
    }
}

/// One test, because the target is the same for all threads.
#[test]
fn all_targets_agree_with_the_models() {
    for &target in Target::ALL {
        if set_cpu(target) {
            rotates_and_flips();
            resizing_keeps_what_it_can();
            modulates();
            finds_the_first_of_the_nearest_colors();
            finds_the_extremes();
            // Miri makes `sin()` inexact, or takes too long.
            if !cfg!(miri) {
                resizes_as_recorded();
                resizes_many_rows_as_one();
                resizes_long_lines();
                finds_each_of_256_colors();
            }
        }
    }
    reset_cpu();
}

#[test]
fn sizes_have_to_match() -> Result<()> {
    for (len, w, h) in [
        (23, 3, 2),
        (0, 0, 0),
        (4, 1, 0),
        (4, 0, 1),
        (24, u32::MAX, u32::MAX),
    ] {
        assert_eq!(
            Image::new(&[0; 24][..len], w, h).err(),
            Some(Error::InvalidSize)
        );
    }
    let image = Image::new(&[0; 24], 3, 2)?;
    assert_eq!(image.resize(0, 1, Filter::Box), Err(Error::InvalidSize));
    assert_eq!(image.resize(1, 0, Filter::Box), Err(Error::InvalidSize));
    assert_eq!(
        image.resize(u32::MAX, u32::MAX, Filter::Box),
        Err(Error::OutOfMemory)
    );
    assert_eq!(image.to_indices(&[], false), Err(Error::InvalidSize));
    assert_eq!(
        image.to_indices(&[[0; 4]; 257], true),
        Err(Error::InvalidSize)
    );
    Ok(())
}

#[test]
fn a_refusal_is_an_error() -> Result<()> {
    let pixels = noise(192, 1);
    let image = Image::new(pixels.as_flattened(), 6, 5)?;
    let all: [&dyn Fn() -> Result<Vec<u8>>; 10] = [
        &|| Image::new(pixels.as_flattened(), 6, 32)?.resize(9, 2, Filter::Lanczos3),
        &|| Image::new(pixels.as_flattened(), 9, 3)?.rotate(90),
        &|| image.resize(3, 7, Filter::Lanczos3),
        &|| image.rotate(0),
        &|| image.rotate(90),
        &|| image.rotate(180),
        &|| image.flip_horizontally(),
        &|| image.flip_vertically(),
        &|| image.to_indices(&pixels[..9], false),
        &|| image.to_indices(&pixels[..9], true),
    ];
    // The first takes minutes there.
    for run in &all[usize::from(cfg!(miri))..] {
        for grants in 0.. {
            GRANTS.set(Some(grants));
            let result = run();
            if GRANTS.take().is_some() {
                assert!(grants > 0 && result.is_ok());
                break;
            }
            assert_eq!(result, Err(Error::OutOfMemory));
        }
    }
    Ok(())
}
