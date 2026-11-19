//! What the tests in test/js/bun/image cannot bring about: memory that is refused at a given point, and arguments that
//! `Bun.Image` does not pass.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fmt::Debug;
use std::panic::{AssertUnwindSafe, catch_unwind};

use bun_highway::webp::{self as kernels, FilterStrength, LumaCandidates, Macroblock, Plane};
use bun_webp::{Compression, Decoder, Error, Result, encode};

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

/// The kernels ask for no memory, and are not linked.
mod native_test_shims {
    use super::{LumaCandidates, Macroblock};

    type P = *const u8;

    macro_rules! do_nothing {
        ($(fn $name:ident($($argument:ty),*) $(-> $result:ty)?;)*) => {$(
            #[unsafe(no_mangle)]
            extern "C" fn $name($(_: $argument),*) $(-> $result)? {
                Default::default()
            }
        )*};
    }

    do_nothing! {
        fn highway_webp_inverse_dct(P, u32);
        fn highway_webp_reconstruct_subblocks(P, P, P, P, P, P);
        fn highway_webp_filter_normally(P, usize, P, P, usize, P, usize, bool);
        fn highway_webp_filter_simply(P, usize, P, usize, bool);
        fn highway_webp_upsample(P, P, P, P, usize);
        fn highway_webp_undo_prediction(P, P, usize, P, u32);
        fn highway_webp_undo_cross_color(P, usize, P, u32);
        fn highway_webp_analyze(P, P, P, P);
        fn highway_webp_try_straight_modes(u64, u64, u8, usize, P, P, i32, P) -> u8;
        fn highway_webp_try_diagonal_modes(u64, u64, u8, usize, P, P, i32, P) -> u8;
        fn highway_webp_try_chroma_modes(P, P, u64, P, P, P) -> bool;
    }

    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_webp_yuv_to_rgba(
        _: P,
        _: P,
        _: P,
        _: P,
        rgba: *mut [u8; 4],
        width: usize,
    ) {
        // SAFETY: there is room for `width` pixels, which the caller takes to be written.
        unsafe { rgba.write_bytes(0, width) };
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_webp_convert(
        &[&[[red, ..], ..], ..]: &[&[[u8; 4]; 16]; 16],
        _: P,
        _: P,
        out: &mut Macroblock,
    ) {
        out.luma[0][0][0] = red;
    }

    /// A macroblock that starts with red gets subblock modes. The others get many tokens, which make no sense, and some
    /// levels of 1, whose signs make the frame outgrow its room.
    #[unsafe(no_mangle)]
    extern "C" fn highway_webp_try_luma_modes(
        samples: &Macroblock,
        _: P,
        _: u64,
        _: u8,
        _: P,
        _: P,
        _: P,
        out: &mut LumaCandidates,
    ) -> u8 {
        out.squared_errors = [(i32::from(samples.luma[0][0][0]) - 1) << 20; 4];
        out.ends = [[[[4 * 16; _]; _]; _]; _];
        out.blocks[0].symbols = [[[0x0101; _]; _]; _];
        0
    }
}

/// Once for each allocation. One that cannot be refused ends the process.
fn refuse_each_allocation<T: PartialEq + Debug>(run: impl Fn() -> Result<T>) -> T {
    let expected = run().unwrap();
    for grants in 0.. {
        GRANTS.set(Some(grants));
        let result = run();
        if GRANTS.take().is_some() {
            assert!(grants > 0);
            assert_eq!(result.as_ref(), Ok(&expected));
            break;
        }
        assert!(matches!(result, Err(Error::Alloc(_))), "{grants}");
    }
    expected
}

type Paint = fn(u32, u32, [u8; 4]) -> [u8; 4];

/// `paint` gets x, y and noise.
fn picture(width: u32, height: u32, paint: Paint) -> Vec<u8> {
    let mut state = 1u32;
    let mut noise = || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state.to_le_bytes()
    };
    let positions = (0..height).flat_map(|y| (0..width).map(move |x| (x, y)));
    positions.flat_map(|(x, y)| paint(x, y, noise())).collect()
}

fn there(width: u32, height: u32, compression: Compression, paint: Paint) -> Vec<u8> {
    let rgba = picture(width, height, paint);
    refuse_each_allocation(|| encode(&rgba, width, height, compression, Some(b"profile")))
}

fn back(file: &[u8]) {
    refuse_each_allocation(|| {
        let image = Decoder::new(file)?.decode()?;
        Ok((image.rgba, image.icc_profile))
    });
}

#[test]
fn refused_memory_is_an_error_when_lossless() {
    let pictures: [(u32, u32, Paint); _] = [
        // All transforms, and enough tiles to be sorted by their cost.
        (100, 96, |x, y, [n, ..]| {
            let slope = (x + y) as u8 + n % (2 + y as u8 / 8);
            [slope / 2, slope, x as u8, 255]
        }),
        // None, and rows that start with a copy.
        (32, 40, |x, _, [r, g, b, _]| match x / 8 % 2 {
            0 => [0; 4],
            _ => [r, g, b, 255],
        }),
        // Few colors: better off without a palette, with one, and with one that bundles.
        (40, 48, |x, y, _| [(x + y) as u8; 4]),
        (128, 80, |_, _, [n, ..]| [n % 3, n % 7, 0, 255]),
        (60, 80, |x, y, [n, ..]| {
            [(x / 5 + y / 3) as u8 % 5 + u8::from(n < 9), 0, 0, 255]
        }),
        (70, 71, |x, _, [n, ..]| match x % 2 {
            0 => [n % 16, 0, 0, 255],
            _ => [n % 2, 0, 0, 255],
        }),
    ];
    for (width, height, paint) in pictures {
        back(&there(width, height, Compression::Lossless, paint));
        back(&there(height, width, Compression::Lossless, paint));
    }
    // All four transforms, two of them behind a palette that bundles.
    back(b"RIFF \0\0\0WEBPVP8L\x13\0\0\0/\0\0\0\0=\x80\x88\x88\x08DD\xc4 \x22\x22\x10\x11\x11\0");
}

#[test]
fn refused_memory_is_an_error_when_lossy() {
    let lossy = Compression::Lossy { quality: 80 };
    let pictures: [Paint; _] = [
        |_, _, _| [1, 0, 0, 255],
        // Alpha that does not compress, with a palette, and with a filter.
        |_, _, [n, ..]| [1, 0, 0, n.max(1)],
        |x, _, _| [1, 0, 0, 1 + x as u8 % 3],
        |x, y, [n, ..]| [1, 0, 0, 1 + (x * y / 8) as u8 + n % 2],
    ];
    for paint in pictures {
        back(&there(60, 33, lossy, paint));
        back(&there(33, 60, lossy, paint));
    }
    // Some of these frames end just where their room does, and some have several pages of tokens.
    for macroblocks in 1..12 {
        there(16 * macroblocks, 16, lossy, |_, _, _| [0, 0, 0, 255]);
    }
}

#[test]
fn a_file_starts_with_riff_and_webp() {
    let file = encode(&[0; 4], 1, 1, Compression::Lossless, None).unwrap();
    let error = |file: &[u8]| Decoder::new(file).err();
    assert_eq!(error(&file), None);
    for len in 0..12 {
        assert_eq!(error(&file[..len]), Some(Error::UnexpectedEof));
    }
    for at in (0..4).chain(8..12) {
        let mut changed = file.clone();
        changed[at] ^= 1;
        assert_eq!(error(&changed), Some(Error::InvalidContainer));
    }
}

#[test]
fn alpha_is_not_decoded_for_a_frame_that_is_cut_short() {
    let error = |width: u8, height: u8, first_partition_len: u16| {
        // There is no such way to compress alpha.
        let mut file = *b"RIFF@\0\0\0WEBPVP8X\n\0\0\0\x10\0\0\0w\0\0h\0\0ALPH\x02\0\0\0\x03\0\
            VP8 \x18\0\0\0ll\0\x9d\x01*w\0h\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0";
        (file[24], file[27]) = (width - 1, height - 1);
        [file[48], file[49]] = ((first_partition_len << 5) | 16).to_le_bytes();
        (file[54], file[56]) = (width, height);
        Decoder::new(&file).and_then(Decoder::decode).err()
    };
    assert_eq!(error(8 * 16, 4 * 16, 12), Some(Error::InvalidAlpha));
    // Within the header, and within the modes of 33 macroblocks.
    assert_eq!(error(1, 1, 1), Some(Error::UnexpectedEof));
    assert_eq!(error(161, 33, 12), Some(Error::UnexpectedEof));
}

#[test]
fn the_pixels_are_as_many_as_the_dimensions_say() {
    let error = |len, width, height| {
        encode(&vec![0; len], width, height, Compression::Lossless, None).err()
    };
    assert_eq!(error(24, 3, 2), None);
    for len in [0, 20, 23, 25, 28] {
        assert_eq!(error(len, 3, 2), Some(Error::InvalidBufferSize));
    }
    assert_eq!(error(0, 0, 2), Some(Error::InvalidDimensions));
    assert_eq!(error(0, 3, 0), Some(Error::InvalidDimensions));
}

#[test]
fn quality_ends_at_100() {
    let with = |quality| encode(&[0; 4], 1, 1, Compression::Lossy { quality }, None);
    assert_ne!(with(98), with(100));
    assert_eq!(with(101), with(100));
    assert_eq!(with(255), with(100));
}

#[test]
fn an_empty_profile_is_none() {
    let with = |profile| encode(&[0; 4], 1, 1, Compression::Lossless, profile).unwrap();
    assert_eq!(with(Some(b"")), with(None));
    let mut file = with(Some(b"JUNK\0\0\0\0"));
    // The length of the ICCP chunk, which leaves what it had as a chunk of its own.
    file[34] = 0;
    let image = Decoder::new(&file).unwrap().decode().unwrap();
    assert_eq!(image.icc_profile, None);
}

/// By an assertion, as an overflow stops debug builds only.
fn is_stopped(call: impl FnOnce()) -> bool {
    catch_unwind(AssertUnwindSafe(call)).is_err_and(|message| {
        let formatted = message.downcast_ref().map(String::as_str);
        let message = formatted.or_else(|| message.downcast_ref().copied());
        message.unwrap().starts_with("assertion")
    })
}

/// `call` gets through with `enough`, and not with one less of any of them. Returns what it returns with `enough`.
fn needs<const N: usize, T>(enough: [usize; N], call: impl Fn([usize; N]) -> T) -> T {
    for i in 0..N {
        let mut fewer = enough;
        fewer[i] -= 1;
        assert!(is_stopped(|| drop(call(fewer))), "{fewer:?}");
    }
    call(enough)
}

#[test]
fn the_filters_get_whole_macroblocks_and_the_rows_above() {
    fn plane(samples: &mut [u8], stride: usize, start: usize) -> Plane<'_> {
        Plane {
            samples,
            stride,
            start,
        }
    }
    let strengths = [FilterStrength::default(); 2];
    needs([32, 2 * 32, 16 * 32], |[stride, above, below]| {
        let mut y = vec![0; above + below];
        kernels::filter_simply(plane(&mut y, stride, above), &strengths, true);
    });
    let behind = || kernels::filter_simply(plane(&mut [0; 64], 32, 1024), &strengths, true);
    assert!(is_stopped(behind));
    let [y, u, v] = [16, 8, 8].map(|size| [2 * size, 4 * 2 * size, size * 2 * size]);
    let normally = |planes: [[usize; 3]; 3]| {
        let mut planes =
            planes.map(|[stride, above, below]| (vec![0; above + below], stride, above));
        let planes = planes.each_mut().map(|it| plane(&mut it.0, it.1, it.2));
        kernels::filter_normally(planes, &strengths, true);
    };
    needs(y, |y| normally([y, u, v]));
    needs(u, |u| normally([y, u, v]));
    needs(v, |v| normally([y, u, v]));
    needs([16], |[stride]| {
        normally([y, [stride, 64, 128], [stride, 64, 128]])
    });
    needs([17], |[stride]| {
        normally([y, [stride, 68, 136], [17, 68, 136]])
    });
}

#[test]
fn rows_are_padded_to_whole_steps() {
    needs([65, 65, 128, 128], |lens| {
        let [upper, lower, mut to_upper, mut to_lower] = lens.map(|len| vec![0; len]);
        kernels::upsample([&upper, &lower], [&mut to_upper, &mut to_lower], 33);
    });
    let endless = || kernels::upsample([&[0]; 2], [&mut [], &mut []], usize::MAX);
    assert!(is_stopped(endless));
    let converted = needs([64, 64, 64, 64, 5, 33], |[y, u, v, alpha, len, room]| {
        let yuva = [y, u, v, alpha].map(|len| vec![0; len]);
        let mut rgba = Vec::with_capacity(5 + room);
        rgba.resize(len, [1; 4]);
        kernels::yuv_to_rgba(yuva.each_ref().map(Vec::as_slice), &mut rgba, 5, 33);
        rgba.len()
    });
    assert_eq!(converted, 5 + 33);
}

#[test]
fn every_pixel_has_a_tile() {
    // So that one less is one bit too many.
    let tile_bits = |spare: usize| 16 - spare as u32;
    needs([9, 9, 3], |[row, above, tiles]| {
        let [mut row, above, tiles] = [row, above, tiles].map(|len| vec![[0; 4]; len]);
        kernels::undo_prediction(&mut row, &above, &tiles, 2);
    });
    needs([1, 1], |[len, spare]| {
        let [mut row, above] = [len; 2].map(|len| vec![[0; 4]; len]);
        kernels::undo_prediction(&mut row, &above, &[[0; 4]], tile_bits(spare));
    });
    needs([3], |[tiles]| {
        kernels::undo_cross_color(&mut [[0; 4]; 9], &vec![[0; 4]; tiles], 2);
    });
    needs([1], |[spare]| {
        kernels::undo_cross_color(&mut [[0; 4]], &[[0; 4]], tile_bits(spare));
    });
}
