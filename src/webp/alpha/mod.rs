//! The alpha plane of a lossy image: the `ALPH` chunk.

pub(crate) mod dec;
pub(crate) mod enc;
mod unfilters;

// The low two bits of the first byte of the chunk.
const ALPHA_NO_COMPRESSION: u8 = 0;
const ALPHA_LOSSLESS_COMPRESSION: u8 = 1;

/// `WEBP_FILTER_TYPE`, the next two bits: what each value is predicted from before compression.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Filter {
    None = 0,
    Horizontal = 1,
    Vertical = 2,
    Gradient = 3,
}
