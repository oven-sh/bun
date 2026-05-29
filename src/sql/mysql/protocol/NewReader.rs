use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::decode_length_int;
use crate::shared::data::Data;

pub trait ReaderContext: Copy {
    fn mark_message_start(self);
    // `&self` (not `self`) so the returned borrow can be tied to the context's
    // buffer lifetime; `Self: Copy` keeps the by-value call sites working.
    fn peek(&self) -> &[u8];
    fn skip(self, count: isize);
    fn ensure_capacity(self, count: usize) -> bool;
    fn read(self, count: usize) -> Result<Data, AnyMySQLError>;
    fn read_z(self) -> Result<Data, AnyMySQLError>;
    fn set_offset_from_start(self, offset: usize);
}

#[derive(Clone, Copy)]
pub struct NewReader<C: ReaderContext> {
    pub wrapped: C,
}

impl<C: ReaderContext> NewReader<C> {
    // PORT NOTE: Zig `pub const Ctx = Context` — in Rust the generic param `C` IS
    // the name; inherent associated types are unstable, so callers name `C` directly.

    pub const IS_WRAPPED: bool = true;

    pub fn mark_message_start(self) {
        self.wrapped.mark_message_start();
    }

    pub fn set_offset_from_start(self, offset: usize) {
        self.wrapped.set_offset_from_start(offset);
    }

    pub fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        self.wrapped.read(count)
    }

    pub fn skip(self, count: impl TryInto<isize>) {
        // Zig: skipFn(this.wrapped, @as(isize, @intCast(count)))
        self.wrapped
            .skip(count.try_into().ok().expect("skip count fits in isize"));
    }

    pub fn peek(&self) -> &[u8] {
        self.wrapped.peek()
    }

    pub fn read_z(self) -> Result<Data, AnyMySQLError> {
        self.wrapped.read_z()
    }

    pub fn byte(self) -> Result<u8, AnyMySQLError> {
        let data = self.read(1)?;
        Ok(data.slice()[0])
    }

    pub fn ensure_capacity(self, count: usize) -> Result<(), AnyMySQLError> {
        if !self.wrapped.ensure_capacity(count) {
            return Err(AnyMySQLError::ShortRead);
        }
        Ok(())
    }

    pub fn int<I: ReadableInt>(self) -> Result<I, AnyMySQLError> {
        let data = self.read(I::SIZE)?;
        // `defer data.deinit()` → Drop on scope exit
        if I::SIZE == 1 {
            // Zig: if (comptime Int == u8) return data.slice()[0]
            return Ok(I::from_ne_slice(&data.slice()[..1]));
        }
        // Zig: @bitCast(data.slice()[0..size].*) — native-endian byte reinterpretation
        Ok(I::from_ne_slice(&data.slice()[..I::SIZE]))
    }

    pub fn int_u24(self) -> Result<u32, AnyMySQLError> {
        let data = self.read(4)?;
        let s = data.slice();
        Ok(u32::from_le_bytes([s[0], s[1], s[2], 0]))
    }

    /// Zig `reader.int(i24)` — consume 4 bytes (see [`Self::int_u24`]), decode
    /// the low 3 little-endian bytes and sign-extend to i32.
    pub fn int_i24(self) -> Result<i32, AnyMySQLError> {
        let data = self.read(4)?;
        let s = data.slice();
        let u = u32::from_le_bytes([s[0], s[1], s[2], 0]);
        // sign-extend 24 -> 32
        Ok(((u as i32) << 8) >> 8)
    }

    pub fn encode_len_string(self) -> Result<Data, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return self.read(usize::try_from(result.value).expect("int cast"));
        }
        Err(AnyMySQLError::InvalidEncodedLength)
    }

    pub fn encoded_len_int(self) -> Result<u64, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return Ok(result.value);
        }
        Err(AnyMySQLError::InvalidEncodedInteger)
    }

    pub fn encoded_len_int_with_size(self, size: &mut usize) -> Result<u64, bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            *size += result.bytes_read;
            return Ok(result.value);
        }
        Err(bun_core::err!("InvalidEncodedInteger"))
    }
}

pub use bun_core::NativeEndianInt as ReadableInt;

pub type NewReaderOf<C> = NewReader<C>;

impl<C: ReaderContext> From<C> for NewReader<C> {
    fn from(wrapped: C) -> Self {
        Self { wrapped }
    }
}

pub trait Decode: Sized {
    fn decode_internal<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError>;

    fn decode<C: ReaderContext>(
        &mut self,
        context: impl Into<NewReader<C>>,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(context.into())
    }

    // Zig `decodeAllocator` — allocator param deleted (global mimalloc).
    fn decode_allocator<C: ReaderContext>(
        &mut self,
        context: impl Into<NewReader<C>>,
    ) -> Result<(), AnyMySQLError> {
        // TODO(port): some Zig decodeFn callees took (this, allocator, Context, ctx);
        // confirm none need a distinct arena before unifying with `decode`.
        self.decode_internal(context.into())
    }
}

// ported from: src/sql/mysql/protocol/NewReader.zig
