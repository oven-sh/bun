//! TEMPORARY: internals for the differential harness.
#![allow(unreachable_pub, missing_docs)]

pub fn assemble(
    width: usize,
    height: usize,
    bitstream: Vec<u8>,
    is_lossless: bool,
    alpha: Option<Vec<u8>>,
    lossless_has_alpha: bool,
    icc: Option<&[u8]>,
) -> Result<Vec<u8>, crate::EncodeError> {
    crate::container::assemble(
        &crate::container::Image {
            width,
            height,
            bitstream,
            is_lossless,
            alpha,
            lossless_has_alpha,
        },
        icc,
    )
}
