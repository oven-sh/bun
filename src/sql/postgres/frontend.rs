//! The messages that the client sends.

use crate::postgres::AnyPostgresError;

type Result = core::result::Result<(), AnyPostgresError>;

pub const SYNC: [u8; 5] = *b"S\0\0\0\x04";
pub const TERMINATE: [u8; 5] = *b"X\0\0\0\x04";
/// The unnamed portal, with no limit on the rows.
pub const EXECUTE_AND_SYNC: [u8; 15] = *b"E\0\0\0\x09\0\0\0\0\0S\0\0\0\x04";
pub(crate) const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f];

/// Where an Int32 length goes once what it counts is written.
#[must_use]
pub struct Length(usize);

impl Length {
    pub fn reserve(out: &mut Vec<u8>) -> Length {
        let at = out.len();
        out.extend_from_slice(&[0; 4]);
        Length(at)
    }

    /// Of a message: it counts itself.
    pub fn end_message(self, out: &mut [u8]) -> Result {
        let length = out.len() - self.0;
        self.fill(out, length)
    }

    pub fn end_value(self, out: &mut [u8]) -> Result {
        let length = out.len() - self.0 - 4;
        self.fill(out, length)
    }

    fn fill(self, out: &mut [u8], length: usize) -> Result {
        let length = i32::try_from(length).map_err(|_| AnyPostgresError::InvalidMessageLength)?;
        out[self.0..][..4].copy_from_slice(&length.to_be_bytes());
        Ok(())
    }
}

pub fn begin(out: &mut Vec<u8>, tag: u8) -> Length {
    out.push(tag);
    Length::reserve(out)
}

pub fn count(out: &mut Vec<u8>, count: usize) -> Result {
    let count = u16::try_from(count).map_err(|_| AnyPostgresError::TooManyParameters)?;
    out.extend_from_slice(&count.to_be_bytes());
    Ok(())
}

pub fn message(out: &mut Vec<u8>, tag: u8, body: &[&[u8]]) -> Result {
    let length = begin(out, tag);
    body.iter().for_each(|part| out.extend_from_slice(part));
    length.end_message(out)
}

pub fn query(out: &mut Vec<u8>, text: &[u8]) -> Result {
    message(out, b'Q', &[text, b"\0"])
}

pub fn parse(out: &mut Vec<u8>, name: &[u8], text: &[u8], types: &[u32]) -> Result {
    let length = begin(out, b'P');
    [name, b"\0", text, b"\0"]
        .iter()
        .for_each(|part| out.extend_from_slice(part));
    count(out, types.len())?;
    types
        .iter()
        .for_each(|oid| out.extend_from_slice(&oid.to_be_bytes()));
    length.end_message(out)
}

pub fn describe_statement(out: &mut Vec<u8>, name: &[u8]) -> Result {
    message(out, b'D', &[b"S", name, b"\0"])
}

pub fn close_statement(out: &mut Vec<u8>, name: &[u8]) -> Result {
    message(out, b'C', &[b"S", name, b"\0"])
}

pub fn copy_data(out: &mut Vec<u8>, data: &[u8]) -> Result {
    message(out, b'd', &[data])
}

pub fn copy_fail(out: &mut Vec<u8>, reason: &[u8]) -> Result {
    message(out, b'f', &[reason, b"\0"])
}
