//! For `bun_zstd_decoder`, which is linked without the C++ objects too.

#[cfg(not(miri))]
macro_rules! lines {
    ($($line:expr),* $(,)?) => { concat!($($line, "\n"),*) };
}

mod checksum;
mod literals;
mod sequences;

pub use checksum::consume_stripes;
pub use literals::HuffmanTable;
pub use sequences::{CHUNK, CODES_MAX, Codes, Reader, Sequence, Sequences, Tables};

/// What was written, and room behind it.
pub struct Tape<'a> {
    start: *mut u8,
    initialized: usize,
    capacity: usize,
    vec: Option<&'a mut Vec<u8>>,
}

impl<'a> Tape<'a> {
    pub fn slice(bytes: &'a mut [u8]) -> Self {
        Self {
            start: bytes.as_mut_ptr(),
            initialized: bytes.len(),
            capacity: bytes.len(),
            vec: None,
        }
    }

    /// From `start` on, with the spare capacity. `vec` gets longer by what is written there.
    pub fn vec(vec: &'a mut Vec<u8>, start: usize) -> Self {
        let start = start.min(vec.len());
        Self {
            start: vec.as_mut_ptr().wrapping_add(start),
            initialized: vec.len() - start,
            capacity: vec.capacity() - start,
            vec: Some(vec),
        }
    }

    /// SAFETY: so many bytes are initialized.
    #[inline(always)]
    unsafe fn extend_to(self, len: usize) {
        if let Some(vec) = self.vec {
            // SAFETY: as the caller promises.
            unsafe { vec.set_len(vec.len() + len.saturating_sub(self.initialized)) };
        }
    }
}

/// 8 bytes from `start` on. Zeros are around `src`.
#[inline(always)]
fn load(src: &[u8], start: isize) -> u64 {
    #[cold]
    fn near_an_end(src: &[u8], start: isize) -> u64 {
        let bytes = src.iter().skip(start.max(0) as usize).take(8);
        let word = bytes.rfold(0, |word, &byte| word << 8 | u64::from(byte));
        word.unbounded_shl(8 * start.clamp(-8, 0).unsigned_abs() as u32)
    }

    match src.get(start as usize..).and_then(<[u8]>::first_chunk) {
        Some(word) => u64::from_le_bytes(*word),
        None => near_an_end(src, start),
    }
}
