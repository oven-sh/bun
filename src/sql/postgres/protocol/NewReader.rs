use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresShort};
use crate::shared::Data;
use bun_core::String as BunString;

/// Trait capturing the methods `NewReaderWrap` requires of its wrapped context.
pub trait ReaderContext {
    fn mark_message_start(&mut self);
    fn peek(&self) -> &[u8];
    fn skip(&mut self, count: usize);
    fn ensure_length(&mut self, count: usize) -> bool;
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError>;
    fn read_z(&mut self) -> Result<Data, AnyPostgresError>;
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

// Blanket impl so `NewReaderWrap<&mut C>` works for callers that reborrow.
impl<C: ReaderContext + ?Sized> ReaderContext for &mut C {
    #[inline]
    fn mark_message_start(&mut self) {
        (**self).mark_message_start()
    }
    #[inline]
    fn peek(&self) -> &[u8] {
        (**self).peek()
    }
    #[inline]
    fn skip(&mut self, count: usize) {
        (**self).skip(count)
    }
    #[inline]
    fn ensure_length(&mut self, count: usize) -> bool {
        (**self).ensure_length(count)
    }
    #[inline]
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        (**self).read(count)
    }
    #[inline]
    fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        (**self).read_z()
    }
}

pub struct NewReaderWrap<Context: ReaderContext> {
    pub wrapped: Context,
}

pub type Ctx<Context> = Context;

impl<Context: ReaderContext> NewReaderWrap<Context> {
    /// Reborrow as `NewReaderWrap<&mut Context>` so the same reader can be
    /// passed by-value into per-message handlers across loop iterations.
    #[inline]
    pub fn reborrow(&mut self) -> NewReaderWrap<&mut Context> {
        NewReaderWrap {
            wrapped: &mut self.wrapped,
        }
    }

    #[inline]
    pub fn mark_message_start(&mut self) {
        self.wrapped.mark_message_start();
    }

    #[inline]
    pub fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        self.wrapped.read(count)
    }

    #[inline]
    pub fn eat_message(&mut self, msg_: &'static [u8]) -> Result<(), AnyPostgresError> {
        let msg = &msg_[1..];
        self.ensure_capacity(msg.len())?;

        let input = self.wrapped.read(msg.len())?;
        if input.slice() == msg {
            return Ok(());
        }
        Err(AnyPostgresError::InvalidMessage)
    }

    pub fn skip(&mut self, count: usize) -> Result<(), AnyPostgresError> {
        self.wrapped.skip(count);
        Ok(())
    }

    pub fn peek(&self) -> &[u8] {
        self.wrapped.peek()
    }

    #[inline]
    pub fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        self.wrapped.read_z()
    }

    #[inline]
    pub fn ensure_capacity(&mut self, count: usize) -> Result<(), AnyPostgresError> {
        if !self.wrapped.ensure_length(count) {
            return Err(AnyPostgresError::ShortRead);
        }
        Ok(())
    }

    pub fn int<Int: ProtocolInt>(&mut self) -> Result<Int, AnyPostgresError> {
        let data = self.read(Int::SIZE)?;
        Ok(Int::from_be_slice(data.slice()))
    }

    pub fn peek_int<Int: ProtocolInt>(&self) -> Option<Int> {
        let remain = self.peek();
        if remain.len() < Int::SIZE {
            return None;
        }
        Some(Int::from_be_slice(&remain[0..Int::SIZE]))
    }

    pub fn expect_int<Int: ProtocolInt>(&mut self, value: Int) -> Result<bool, AnyPostgresError> {
        let actual = self.int::<Int>()?;
        Ok(actual == value)
    }

    pub fn int4(&mut self) -> Result<PostgresInt32, AnyPostgresError> {
        self.int::<PostgresInt32>()
    }

    pub fn short(&mut self) -> Result<PostgresShort, AnyPostgresError> {
        self.int::<PostgresShort>()
    }

    pub fn length(&mut self) -> Result<PostgresInt32, AnyPostgresError> {
        let expected = self.int::<PostgresInt32>()?;
        // The length of every Postgres v3 message is a signed Int32 that
        // includes its own 4 bytes, so a value below 4 (or negative, i.e. the
        // sign bit set on the wire) is malformed. `expected` is server-controlled.
        if expected < 4 || expected > i32::MAX as u32 {
            return Err(AnyPostgresError::InvalidMessageLength);
        }
        self.ensure_capacity((expected - 4) as usize)?;

        Ok(expected)
    }

    pub fn skip_message(&mut self) -> Result<(), AnyPostgresError> {
        let length = self.length()?;
        self.skip(usize::try_from(length - 4).expect("int cast"))
    }

    #[inline]
    pub fn bytes(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        self.read(count)
    }

    /// Returns a `BunString` that BORROWS the connection read buffer.
    ///
    /// Invariant: callers must not hold the returned `BunString` past the next
    /// buffer fill — `borrow_utf8` stores a raw pointer with no lifetime, so
    /// the string is only valid until more data is read into the buffer.
    /// (The bytes live in the connection buffer, not the `Data` wrapper.)
    pub fn string(&mut self) -> Result<BunString, AnyPostgresError> {
        let result = self.read_z()?;
        Ok(BunString::borrow_utf8(result.slice()))
    }
}

// (duplicate blanket impl + reborrow removed — defined above at L47/L69)

// The trait bound on `NewReaderWrap` already enforces the method set, so this is a plain alias.
pub type NewReader<Context> = NewReaderWrap<Context>;
