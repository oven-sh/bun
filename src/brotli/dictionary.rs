//! RFC 7932 section 8 and appendix A: the static dictionary.

pub(crate) const MIN_WORD_LENGTH: usize = 4;
pub(crate) const MAX_WORD_LENGTH: usize = 24;
/// A transform copies [`MAX_WORD_LENGTH`] bytes, after it skipped up to nine.
pub(crate) const PADDED_WORD_LENGTH: usize = 40;

const SIZE: usize = 122_784;

static WORDS: [u8; SIZE + PADDED_WORD_LENGTH] = {
    let mut padded = [0; SIZE + PADDED_WORD_LENGTH];
    padded
        .split_at_mut(SIZE)
        .0
        .copy_from_slice(include_bytes!("dictionary.bin"));
    padded
};

const SIZE_BITS_BY_LENGTH: [u8; 32] = [
    0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5, 0, 0, 0, 0,
    0, 0, 0,
];

#[allow(clippy::indexing_slicing)] // Runs at compile time.
const OFFSETS_BY_LENGTH: [u32; 32] = {
    let mut offsets = [0; 32];
    let mut length = MIN_WORD_LENGTH;
    while length < MAX_WORD_LENGTH {
        offsets[length + 1] = offsets[length] + ((length as u32) << SIZE_BITS_BY_LENGTH[length]);
        length += 1;
    }
    offsets
};

/// There are `1 << size_bits(length)` words of a length in `MIN_WORD_LENGTH..=MAX_WORD_LENGTH`.
#[inline(always)]
#[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
pub(crate) const fn size_bits(length: usize) -> u32 {
    SIZE_BITS_BY_LENGTH[length % 32] as u32
}

/// A word and the bytes after it.
#[inline(always)]
#[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
pub(crate) const fn padded_word(
    length: usize,
    index: usize,
) -> Option<&'static [u8; PADDED_WORD_LENGTH]> {
    let offset = OFFSETS_BY_LENGTH[length % 32] as usize + length * index;
    match WORDS.split_at_checked(offset) {
        Some((_, rest)) => rest.first_chunk(),
        None => None,
    }
}
