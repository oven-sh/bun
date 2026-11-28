//! Readers of bitstreams.

use crate::error::{Error, Result};

/// The 8 bytes of `src` from `start` on. Zeros follow its end.
#[inline(always)]
pub(crate) fn load_from(src: &[u8], start: usize) -> u64 {
    #[cold]
    #[inline(never)]
    fn padded(src: &[u8], start: usize) -> u64 {
        let bytes = src.get(start..).unwrap_or_default();
        (bytes.iter().rev()).fold(0, |word, &byte| word << 8 | u64::from(byte))
    }

    match src.get(start..).and_then(<[u8]>::first_chunk) {
        Some(bytes) => u64::from_le_bytes(*bytes),
        None => padded(src, start),
    }
}

/// How many bits of `src` are below the mark that ends the stream at its end, which starts at byte `start`.
#[inline(always)]
pub(crate) fn bits_below_mark(src: &[u8], start: usize) -> Result<usize> {
    match src.get(start..) {
        Some(&[.., last @ 1..=u8::MAX]) => Ok(8 * (src.len() - 1) + last.ilog2() as usize),
        _ => Err(Error::CorruptionDetected),
    }
}
