use crate::{Error, Result};

/// A cursor over bytes from the network or a file. Every read is checked.
#[derive(Clone, Copy)]
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }

    pub(crate) fn remaining(&self) -> &'a [u8] {
        self.data.get(self.position..).unwrap_or(&[])
    }

    pub(crate) fn len(&self) -> usize {
        self.remaining().len()
    }

    pub(crate) fn position(&self) -> usize {
        self.position
    }

    pub(crate) fn set_position(&mut self, position: usize) -> Result<()> {
        if position > self.data.len() {
            return Err(Error::EFORMERR);
        }
        self.position = position;
        Ok(())
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

    pub(crate) fn be16(&mut self) -> Result<u16> {
        self.array().map(u16::from_be_bytes)
    }

    pub(crate) fn be32(&mut self) -> Result<u32> {
        self.array().map(u32::from_be_bytes)
    }
}

/// 0x20 through 0x7e.
pub(crate) fn is_print(byte: u8) -> bool {
    matches!(byte, 0x20..=0x7e)
}

pub(crate) fn all_print(bytes: &[u8]) -> bool {
    bytes.iter().all(|&byte| is_print(byte))
}

/// Letters, digits and `-._/*`: what a host name is made of, plus `_` (SRV), `/` (classless in-addr.arpa) and `*` (wildcards seen in CNAMEs).
pub(crate) fn is_hostname_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'/' | b'*')
}
