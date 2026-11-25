//! The `ALPH` chunk, which gives a lossy image its alpha channel.

pub(crate) mod decoder;
pub(crate) mod encoder;

/// The two lowest bits of the first byte.
const NO_COMPRESSION: u8 = 0;
const LOSSLESS_COMPRESSION: u8 = 1;

/// What a sample is predicted from. The two bits above the compression.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Filter {
    None = 0,
    Horizontal = 1,
    Vertical = 2,
    Gradient = 3,
}

fn gradient(left: u8, above: u8, above_left: u8) -> u8 {
    (i16::from(left) + i16::from(above) - i16::from(above_left)).clamp(0, 255) as u8
}
