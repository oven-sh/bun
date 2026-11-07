//! The alpha plane of a lossy image: the `ALPH` chunk.

pub(crate) mod dec;
pub(crate) mod enc;
mod filters;

// The low two bits of the first byte of the chunk.
const ALPHA_NO_COMPRESSION: u8 = 0;
const ALPHA_LOSSLESS_COMPRESSION: u8 = 1;
