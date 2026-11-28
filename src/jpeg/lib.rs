//! JPEG to and from 8-bit RGBA, for `Bun.Image`. It derives from libjpeg-turbo 3.2.0, so it is based in part on the work of the Independent JPEG Group (LICENSE.md).
#![forbid(unsafe_code)]
// Images come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
// `Vec::shrink_to_fit()` aborts if it is refused memory: test/internal/source-lints/refusable-memory.test.ts.
#![feature(hint_prefetch, vec_fallible_shrink)]

// The C files and functions that comments name are in https://github.com/libjpeg-turbo/libjpeg-turbo/tree/c85e6b905bf237038faa936dab160ebfc5da0344/src
mod arithmetic;
mod bit_reader;
mod bit_writer;
mod block;
mod decoder;
mod encoder;
mod error;
mod header;
mod huffman;
mod input;
mod lossless;
mod marker;
mod output;
mod progressive;
mod progressive_encoder;
mod scan;
mod segment_writer;
mod sequential;
mod sequential_encoder;
#[expect(
    clippy::indexing_slicing,
    reason = "only arrays, and rows that were cut to one length"
)]
mod simd;
mod smoothing;
mod strips;

pub use decoder::{Decoder, Image};
pub use encoder::encode;
pub use error::{Error, Result};
pub use header::Header;

/// In a frame, and in a scan.
const MAX_COMPONENTS: usize = 4;

/// `table[index % N]`, which the compiler knows to be in bounds.
#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped<T, const N: usize>(table: &[T; N], index: usize) -> &T {
    const { assert!(N.is_power_of_two()) };
    &table[index % N]
}

#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped_mut<T, const N: usize>(table: &mut [T; N], index: usize) -> &mut T {
    const { assert!(N.is_power_of_two()) };
    &mut table[index % N]
}

/// Grows `vec` to `len`. Inlined, so that filling with zeros becomes a `memset`.
#[inline(always)]
fn fill_up<T: Copy>(vec: &mut Vec<T>, len: usize, value: T) -> Result<()> {
    vec.try_reserve_exact(len.saturating_sub(vec.len()))?;
    vec.resize(len, value);
    Ok(())
}

#[inline(always)]
fn filled<T: Copy>(len: usize, value: T) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    fill_up(&mut vec, len, value)?;
    Ok(vec)
}

/// Splits `0..len` into runs of at most `size`. Yields where each starts, and its length.
fn batches(len: usize, size: usize) -> impl Iterator<Item = [usize; 2]> {
    let starts = (0..len).step_by(size);
    starts.map(move |start| [start, size.min(len - start)])
}

/// What `Bun.Image` cannot reach, and enough of the kernels for Miri.
#[cfg(test)]
#[expect(clippy::indexing_slicing, reason = "a panic fails the test")]
mod tests {
    use super::*;
    use crate::header::{ColorSpace, Segments};
    use crate::output::Output;

    /// One gray block with the DC coefficient 5, and 8 for all quantization steps.
    fn one_block() -> Vec<u8> {
        let mut file = Vec::new();
        file.extend([0xFF, 0xD8, 0xFF, 0xDB, 0, 67, 0]);
        file.extend([8; 64]);
        file.extend([0xFF, 0xC0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
        file.extend([0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0]);
        file.extend([0b1001_0110, 0b1011_1111, 0xFF, 0xD9]);
        file
    }

    #[test]
    fn a_file_starts_with_soi() {
        for bytes in [&b""[..], b"\xFF", b"\xD8\xFF", b"\x89PNG"] {
            assert_eq!(Decoder::new(bytes).err(), Some(Error::InvalidSignature));
        }
    }

    #[test]
    fn the_smallest_scale_is_an_eighth() -> Result<()> {
        for eighths in [0, 1] {
            let image = Decoder::new(&one_block())?.decode(eighths)?;
            assert_eq!(image.rgba, [133, 133, 133, 255]);
        }
        Ok(())
    }

    #[test]
    fn a_flat_image_stays_flat_at_all_scales() -> Result<()> {
        for &progressive in &[false, true][cfg!(miri) as usize..] {
            let file = encode(&[90; 4 * 9 * 3], 9, 3, 100, progressive, None)?;
            for eighths in (2..=8).step_by(if cfg!(miri) { 7 } else { 1 }) {
                let image = Decoder::new(&file)?.decode(eighths)?;
                let pixels = image.rgba.as_chunks().0;
                assert!(pixels.iter().all(|&pixel| pixel == [90, 90, 90, 255]));
            }
        }
        Ok(())
    }

    #[test]
    fn the_kernels_refuse_what_is_too_short() {
        use simd::{Chroma, GROUP};
        let zero = block::ZERO;
        for size in (0..=16).step_by(if cfg!(miri) { 7 } else { 1 }) {
            let last = if size <= 8 { 8 } else { 16 };
            let len = size.max(1) * 64 - 64 + size + last;
            let fits = |len, stride| {
                simd::inverse_transform(&[zero; 2], &zero, size, &mut [0; 1024][..len], stride)
            };
            assert_eq!(
                fits(len, 64).is_some(),
                matches!(size, 2..=8 | 10 | 12 | 14)
            );
            assert_eq!(
                [fits(len - 1, 64), fits(len, usize::MAX), fits(len, 0)],
                [None; 3]
            );
        }

        let (full, half) = (&[0; 2 * GROUP][..], &[0; GROUP + 8][..]);
        let fits = |y: &[u8], chroma, room| {
            let mut out = Vec::new();
            out.try_reserve_exact(room).ok()?;
            simd::ycc_to_rgba(y, &chroma, GROUP + 1, &mut out).map(|()| out.len())
        };
        let kinds = |[cb, cr]: [&'static [u8]; 2], [a, b, c, d]: [&'static [u8]; 4]| {
            [
                Chroma::Full { cb, cr },
                Chroma::HalfWidth { cb: a, cr: b },
                Chroma::HalfSize {
                    cb: [a, b],
                    cr: [c, d],
                },
            ]
        };
        for chroma in kinds([full; 2], [half; 4]) {
            assert_eq!(fits(full, chroma, 2 * GROUP), Some(GROUP + 1));
            assert_eq!(
                [
                    fits(&full[1..], chroma, 2 * GROUP),
                    fits(full, chroma, 2 * GROUP - 1)
                ],
                [None; 2]
            );
        }
        for chroma in kinds([full, &full[1..]], [half, &half[..GROUP], half, half]) {
            assert_eq!(fits(full, chroma, 2 * GROUP), None);
        }

        let fits = |[rgba, y, cb, cr]: [usize; 4]| {
            let [mut a, mut b, mut c] = [[0; 4 * GROUP]; 3];
            let rgba = &[[0; 4]; 4 * GROUP][..rgba];
            simd::rgba_to_ycc420(
                rgba,
                GROUP,
                1,
                2,
                &mut a[..y],
                &mut b[..cb],
                &mut c[..cr],
                GROUP / 2,
            )
        };
        let lens = [4 * GROUP, 4 * GROUP, GROUP, GROUP];
        assert_eq!(fits(lens), Some(()));
        for i in 0..4 {
            let mut lens = lens;
            lens[i] -= 1;
            assert_eq!(fits(lens), None);
        }

        let fits = |len, masks| {
            simd::forward_transform(
                &[0; 128][..len],
                16,
                &[zero; 2],
                &mut [zero; 2],
                &mut [[0; 1]; 2][..masks],
            )
        };
        assert_eq!(
            [fits(128, 2), fits(127, 2), fits(128, 1)],
            [Some(()), None, None]
        );
    }

    #[test]
    fn the_pixels_to_encode_match_the_size() {
        for len in [0, 15, 17, 20] {
            let file = encode(&[0; 20][..len], 2, 2, 80, false, None);
            assert_eq!(file, Err(Error::InvalidBufferSize));
        }
        let size_of_32_bits = encode(&[], 1 << 15, 1 << 15, 80, false, None);
        assert_eq!(size_of_32_bits, Err(Error::InvalidBufferSize));
    }

    #[test]
    fn output_refuses_what_does_not_fit() -> Result<()> {
        let frame = Segments::new(&one_block())?.read_frame()?;
        for eighths in [1, 8] {
            let mut output = Output::new(&frame, ColorSpace::Gray, eighths)?;
            let below = output.planes[0].put(&[block::ZERO], &block::ZERO, 0, 1);
            assert_eq!(below, Err(Error::Internal));
            assert_eq!(output.into_rgba(), Err(Error::Internal));
        }
        let mut output = Output::new(&frame, ColorSpace::Rgb, 8)?;
        assert_eq!(output.finish_strip(), Err(Error::Internal));
        Ok(())
    }
}
