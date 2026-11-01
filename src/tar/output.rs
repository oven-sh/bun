//! Where bytes go.

use crate::error::Result;

/// The size of each write matters: behind a compressor it decides what the compressed bytes are.
pub trait Output {
    fn write(&mut self, bytes: &[u8]) -> Result<()>;
}

impl Output for Vec<u8> {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.try_reserve(bytes.len())?;
        self.extend_from_slice(bytes);
        Ok(())
    }
}

impl<F: FnMut(&[u8])> Output for F {
    fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self(bytes);
        Ok(())
    }
}
