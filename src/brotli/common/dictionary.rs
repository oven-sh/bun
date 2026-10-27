//! Appendix A. Static Dictionary Data.

pub(crate) const MIN_DICTIONARY_WORD_LENGTH: usize = 4;
pub(crate) const MAX_DICTIONARY_WORD_LENGTH: usize = 24;

/// The words, by length and then by index. SHA-256 20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70.
pub(crate) static DATA: &[u8; 122_784] = include_bytes!("dictionary.bin");

/// There are `1 << SIZE_BITS_BY_LENGTH[n]` words of `n` bytes, or none where it is 0.
pub(crate) static SIZE_BITS_BY_LENGTH: [u8; 32] = [
    0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5, 0, 0, 0, 0,
    0, 0, 0,
];

/// Where in [`DATA`] the words of `n` bytes start.
pub(crate) static OFFSETS_BY_LENGTH: [u32; 32] = {
    let mut offsets = [0u32; 32];
    let mut n = 0usize;
    #[allow(clippy::indexing_slicing, reason = "evaluated by the compiler")]
    while n < 31 {
        let bits = SIZE_BITS_BY_LENGTH[n];
        offsets[n + 1] = offsets[n] + if bits == 0 { 0 } else { (n as u32) << bits };
        n += 1;
    }
    offsets
};
