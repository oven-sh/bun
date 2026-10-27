//! The lossy decoder.

use crate::{DecodeError, Output};

pub(crate) const FRAME_HEADER_SIZE: usize = 10;

/// `VP8GetInfo`: the width and the height, if `data` starts like a key frame that fits in `chunk_size` bytes.
pub(crate) fn get_info(data: &[u8], chunk_size: usize) -> Option<(u32, u32)> {
    let &[b0, b1, b2, s0, s1, s2, w0, w1, h0, h1] = data.first_chunk::<FRAME_HEADER_SIZE>()?;
    if [s0, s1, s2] != [0x9d, 0x01, 0x2a] {
        return None;
    }
    let bits = u32::from_le_bytes([b0, b1, b2, 0]);
    let is_key_frame = bits & 1 == 0;
    let profile = (bits >> 1) & 7;
    let is_shown = (bits >> 4) & 1 != 0;
    let partition_length = (bits >> 5) as usize;
    let width = u32::from(u16::from_le_bytes([w0, w1]) & 0x3fff);
    let height = u32::from(u16::from_le_bytes([h0, h1]) & 0x3fff);
    if !is_key_frame
        || profile > 3
        || !is_shown
        || partition_length >= chunk_size
        || width == 0
        || height == 0
    {
        return None;
    }
    Some((width, height))
}

/// `VP8GetHeaders` and `VP8Decode`. `data` starts at the frame header and goes on to the end of the file. `alpha` is
/// the payload of the `ALPH` chunk.
pub(crate) fn decode(
    _data: &[u8],
    _alpha: Option<&[u8]>,
    _output: &mut Output<'_>,
) -> Result<(), DecodeError> {
    Err(DecodeError::UnsupportedFeature)
}
