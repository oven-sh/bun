//! The lossy encoder.

use crate::container::Image;
use crate::{EncodeError, Input};

/// `WebPEncodeRGBA`, without the container.
pub(crate) fn encode(_input: &Input<'_>, _quality: f32) -> Result<Image, EncodeError> {
    Err(EncodeError::Bug)
}
