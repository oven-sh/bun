use crate::{Error, Result};

/// A cursor over the bytes of a message. Every read is checked.
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }

    fn remaining(&self) -> &'a [u8] {
        self.data.get(self.position..).unwrap_or(&[])
    }

    pub(crate) fn remaining_len(&self) -> usize {
        self.remaining().len()
    }

    pub(crate) fn position(&self) -> usize {
        self.position
    }

    /// `None`: there is no such position.
    pub(crate) fn set_position(&mut self, position: usize) -> Option<()> {
        if position > self.data.len() {
            return None;
        }
        self.position = position;
        Some(())
    }

    pub(crate) fn bytes(&mut self, len: usize) -> Result<&'a [u8]> {
        let bytes = self.remaining().get(..len).ok_or(Error::EBADRESP)?;
        self.position += len;
        Ok(bytes)
    }

    pub(crate) fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        self.bytes(N)?.try_into().map_err(|_| Error::EBADRESP)
    }

    pub(crate) fn u8(&mut self) -> Result<u8> {
        self.array::<1>().map(|[byte]| byte)
    }

    pub(crate) fn u16(&mut self) -> Result<u16> {
        self.array().map(u16::from_be_bytes)
    }

    pub(crate) fn u32(&mut self) -> Result<u32> {
        self.array().map(u32::from_be_bytes)
    }
}
