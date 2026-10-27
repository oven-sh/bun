//! `alpha_dec.c`: the alpha plane of a lossy image.

use super::unfilters::unfilter;
use super::{ALPHA_LOSSLESS_COMPRESSION, ALPHA_NO_COMPRESSION, Filter};
use crate::util::{SliceExt, try_vec};
use crate::{Error, vp8l};

const ALPHA_PREPROCESSED_LEVELS: u8 = 1;

/// The alpha values of an `ALPH` payload. Malformed data is a `BitstreamError`, also where libwebp says out of memory.
pub(crate) fn decode(data: &[u8], width: usize, height: usize) -> Result<Vec<u8>, Error> {
    if width == 0 || height == 0 {
        return Err(Error::Bug);
    }
    let mut plane = try_vec(0, width * height)?;

    let Some((&header, alpha_data @ [_, ..])) = data.split_first() else {
        return Err(Error::BitstreamError);
    };
    let method = header & 0x03;
    let filter = match (header >> 2) & 0x03 {
        0 => Filter::None,
        1 => Filter::Horizontal,
        2 => Filter::Vertical,
        _ => Filter::Gradient,
    };
    let pre_processing = (header >> 4) & 0x03;
    let rsrv = (header >> 6) & 0x03;
    if pre_processing > ALPHA_PREPROCESSED_LEVELS || rsrv != 0 {
        return Err(Error::BitstreamError);
    }

    match method {
        ALPHA_NO_COMPRESSION => {
            let deltas = alpha_data.get(..plane.len()).ok_or(Error::BitstreamError)?;
            plane.write_at(0, deltas)?;
        }
        ALPHA_LOSSLESS_COMPRESSION => {
            vp8l::dec::decode_alpha(alpha_data, width, height, &mut plane)?;
        }
        _ => return Err(Error::BitstreamError),
    }
    unfilter(filter, &mut plane, width)?;
    Ok(plane)
}
