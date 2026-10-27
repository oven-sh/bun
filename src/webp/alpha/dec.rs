//! `alpha_dec.c`

use crate::DecodeError;

/// The `width * height` alpha values of an `ALPH` payload.
pub(crate) fn decode(_data: &[u8], _width: usize, _height: usize) -> Result<Vec<u8>, DecodeError> {
    Err(DecodeError::UnsupportedFeature)
}
