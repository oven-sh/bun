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
// `Vec::shrink_to_fit()` aborts if it is refused memory: test/internal/source-lints/image-refusable-memory.test.ts.
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

/// What `Bun.Image` cannot reach. The kernels are only linked into the full binary, so this runs under Miri and calls none.
#[cfg(test)]
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
