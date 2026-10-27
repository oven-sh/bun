//! The lossless decoder.

use crate::{DecodeError, Output};

pub(crate) const FRAME_HEADER_SIZE: usize = 5;
const MAGIC_BYTE: u8 = 0x2f;

pub(crate) struct Info {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// `VP8LCheckSignature`
pub(crate) fn check_signature(data: &[u8]) -> bool {
    matches!(data.first_chunk::<FRAME_HEADER_SIZE>(), Some(&[MAGIC_BYTE, _, _, _, last]) if last >> 5 == 0)
}

/// `VP8LGetInfo`
pub(crate) fn get_info(data: &[u8]) -> Option<Info> {
    if !check_signature(data) {
        return None;
    }
    let &[_, b0, b1, b2, b3] = data.first_chunk::<FRAME_HEADER_SIZE>()?;
    let bits = u32::from_le_bytes([b0, b1, b2, b3]);
    Some(Info {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
    })
}

/// `VP8LDecodeHeader` and `VP8LDecodeImage`. `data` starts at the signature byte and goes on to the end of the file.
pub(crate) fn decode(_data: &[u8], _output: &mut Output<'_>) -> Result<(), DecodeError> {
    Err(DecodeError::UnsupportedFeature)
}
