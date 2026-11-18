use core::ffi::CStr;
use core::ops::Deref;

use crate::{Buffer, Error, Result};

/// An identifier with the terminator that ICU reads it up to.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CText(Buffer<u8>);

impl CText {
    /// Fails if a byte is zero.
    pub fn new(bytes: &[u8]) -> Result<CText> {
        let mut buffer = Buffer::new();
        buffer
            .try_reserve_exact(bytes.len() + 1)
            .map_err(|_| Error::MEMORY_ALLOCATION)?;
        buffer.extend_from_slice(bytes);
        CText::from_buffer(buffer)
    }

    /// Fails if a byte is zero.
    pub fn from_buffer(mut buffer: Buffer<u8>) -> Result<CText> {
        buffer
            .try_reserve(1)
            .map_err(|_| Error::MEMORY_ALLOCATION)?;
        buffer.push(0);
        match CStr::from_bytes_with_nul(&buffer) {
            Ok(_) => Ok(CText(buffer)),
            Err(_) => Err(Error::ILLEGAL_ARGUMENT),
        }
    }
}

impl Deref for CText {
    type Target = CStr;

    #[inline]
    fn deref(&self) -> &CStr {
        // SAFETY: `from_buffer` checked that the last byte is the only zero.
        unsafe { CStr::from_bytes_with_nul_unchecked(&self.0) }
    }
}
