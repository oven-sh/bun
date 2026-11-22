use core::cell::Cell;

use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresShort};
use crate::shared::stack_reader::{ShortRead, StackReader};

impl ShortRead for AnyPostgresError {
    const SHORT_READ: Self = AnyPostgresError::ShortRead;
}

/// Helper trait for `int<Int>()` / `peek_int<Int>()` — reads a big-endian
/// integer of arbitrary width. Rust has no std trait for `from_be_bytes`,
/// so we mint a tiny one.
pub trait ProtocolInt: Sized + Copy + Eq {
    const SIZE: usize;
    fn from_be_slice(bytes: &[u8]) -> Self;
}

macro_rules! impl_protocol_int {
    ($($t:ty),*) => {$(
        impl ProtocolInt for $t {
            const SIZE: usize = core::mem::size_of::<$t>();
            #[inline]
            fn from_be_slice(bytes: &[u8]) -> Self {
                let mut buf = [0u8; core::mem::size_of::<$t>()];
                buf.copy_from_slice(&bytes[..Self::SIZE]);
                <$t>::from_be_bytes(buf)
            }
        }
    )*};
}
impl_protocol_int!(u8, i8, u16, i16, u32, i32, u64, i64);

pub struct NewReader<'a> {
    wrapped: StackReader<'a>,
}

impl<'a> NewReader<'a> {
    pub fn new(buffer: &'a [u8], offset: &'a Cell<usize>, message_start: &'a Cell<usize>) -> Self {
        Self {
            wrapped: StackReader {
                buffer,
                offset,
                message_start,
            },
        }
    }

    #[inline]
    pub fn mark_message_start(&self) {
        self.wrapped.mark_message_start();
    }

    #[inline]
    pub(crate) fn read(&self, count: usize) -> Result<&'a [u8], AnyPostgresError> {
        self.wrapped.read(count)
    }

    #[inline]
    pub fn eat_message(&self, msg_: &'static [u8]) -> Result<(), AnyPostgresError> {
        let msg = &msg_[1..];
        self.ensure_capacity(msg.len())?;

        let input = self.read(msg.len())?;
        if input == msg {
            return Ok(());
        }
        Err(AnyPostgresError::InvalidMessage)
    }

    pub(crate) fn skip(&self, count: usize) -> Result<(), AnyPostgresError> {
        self.wrapped
            .skip(isize::try_from(count).unwrap_or(isize::MAX));
        Ok(())
    }

    pub fn peek(&self) -> &'a [u8] {
        self.wrapped.peek()
    }

    #[inline]
    pub(crate) fn read_z(&self) -> Result<&'a [u8], AnyPostgresError> {
        self.wrapped.read_z()
    }

    /// Read a NUL-terminated string whose terminator must appear within the
    /// next `limit` bytes. Returns `InvalidMessage` (not `ShortRead`) when it
    /// does not: the caller has already established via `length()` that those
    /// bytes are the message body, so a missing terminator is a framing
    /// violation, not a partial read. Returns the string without its NUL and
    /// the total bytes consumed (string + NUL).
    pub(crate) fn string_within(
        &self,
        limit: usize,
    ) -> Result<(&'a [u8], usize), AnyPostgresError> {
        let view = self.wrapped.peek();
        let bound = view.len().min(limit);
        let Some(zero) = bun_core::strings::index_of_char_usize(&view[..bound], 0) else {
            return Err(AnyPostgresError::InvalidMessage);
        };
        let data = self.read(zero)?;
        self.wrapped.skip(1);
        Ok((data, zero + 1))
    }

    #[inline]
    pub(crate) fn ensure_capacity(&self, count: usize) -> Result<(), AnyPostgresError> {
        if !self.wrapped.ensure_capacity(count) {
            return Err(AnyPostgresError::ShortRead);
        }
        Ok(())
    }

    pub fn int<Int: ProtocolInt>(&self) -> Result<Int, AnyPostgresError> {
        let data = self.read(Int::SIZE)?;
        Ok(Int::from_be_slice(data))
    }

    pub(crate) fn expect_int<Int: ProtocolInt>(
        &self,
        value: Int,
    ) -> Result<bool, AnyPostgresError> {
        let actual = self.int::<Int>()?;
        Ok(actual == value)
    }

    pub(crate) fn int4(&self) -> Result<PostgresInt32, AnyPostgresError> {
        self.int::<PostgresInt32>()
    }

    pub(crate) fn short(&self) -> Result<PostgresShort, AnyPostgresError> {
        self.int::<PostgresShort>()
    }

    /// The length of every Postgres v3 message is a signed Int32 that includes
    /// its own 4 bytes, so a value below 4 (or negative, i.e. the sign bit set
    /// on the wire) is malformed. `raw` is server-controlled.
    #[inline]
    fn validate_length(raw: PostgresInt32) -> Result<PostgresInt32, AnyPostgresError> {
        if raw < 4 || raw > i32::MAX as u32 {
            return Err(AnyPostgresError::InvalidMessageLength);
        }
        Ok(raw)
    }

    pub(crate) fn length(&self) -> Result<PostgresInt32, AnyPostgresError> {
        let expected = Self::validate_length(self.int::<PostgresInt32>()?)?;
        self.ensure_capacity((expected - 4) as usize)?;
        Ok(expected)
    }

    /// `length()` without consuming: validates the Int32 at the cursor and
    /// confirms the whole message body is present, but leaves both for the
    /// handler to read. Returns `(remaining, length)` where `remaining` is the
    /// buffer's byte count before the length field, so after the handler runs
    /// the frame boundary is `remaining - length`.
    pub fn peek_length(&self) -> Result<(usize, usize), AnyPostgresError> {
        let view = self.wrapped.peek();
        if view.len() < 4 {
            return Err(AnyPostgresError::ShortRead);
        }
        let raw = PostgresInt32::from_be_slice(&view[..4]);
        let length = Self::validate_length(raw)? as usize;
        if view.len() < length {
            return Err(AnyPostgresError::ShortRead);
        }
        Ok((view.len(), length))
    }

    /// `length()` minus the 4 bytes the length field itself occupies, i.e. the
    /// number of body bytes remaining in this message. Cannot underflow:
    /// `length()` has already returned `InvalidMessageLength` for any value
    /// below 4, and `ensure_capacity` has confirmed those bytes are present.
    #[inline]
    pub(crate) fn body_length(&self) -> Result<usize, AnyPostgresError> {
        Ok((self.length()? - 4) as usize)
    }

    pub fn body(&self) -> Result<&'a [u8], AnyPostgresError> {
        self.read(self.body_length()?)
    }

    pub fn skip_message(&self) -> Result<(), AnyPostgresError> {
        let body = self.body_length()?;
        self.skip(body)
    }

    #[inline]
    pub(crate) fn bytes(&self, count: usize) -> Result<&'a [u8], AnyPostgresError> {
        self.read(count)
    }
}
