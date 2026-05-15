use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresShort};
use crate::shared::Data;
use bun_core::String as BunString;

/// Trait capturing the methods `NewReaderWrap` expected as comptime fn params.
/// Zig passed these as `comptime fn(ctx: Context) ...` arguments and `NewReader`
/// filled them in from `Context.markMessageStart`, `Context.peek`, etc. — i.e.
/// structural duck-typing. In Rust the trait bound IS that check.
// TODO(port): narrow error set
pub trait ReaderContext {
    fn mark_message_start(&mut self);
    fn peek(&self) -> &[u8];
    fn skip(&mut self, count: usize);
    fn ensure_length(&mut self, count: usize) -> bool;
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError>;
    fn read_z(&mut self) -> Result<Data, AnyPostgresError>;
}

/// Helper trait for `int<Int>()` / `peek_int<Int>()` — Zig used `@sizeOf(Int)`,
/// `@bitCast`, and `@byteSwap` to read a big-endian integer of arbitrary width.
/// Rust has no std trait for `from_be_bytes`, so we mint a tiny one.
// TODO(port): consider moving to a shared int-read helper if other protocol files need it
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

// Blanket impl so `NewReaderWrap<&mut C>` works — Zig passed the wrapped struct
// by-value (implicit copy) through the dispatch loop; in Rust the inner
// `Context` is non-`Copy` (holds `&mut usize`), so callers reborrow instead.
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

// Zig: `fn NewReaderWrap(comptime Context: type, comptime markMessageStartFn_, ...) type { return struct { wrapped: Context, ... } }`
// The fn-pointer params collapse into the `ReaderContext` trait bound.
pub struct NewReaderWrap<Context: ReaderContext> {
    pub wrapped: Context,
}

pub type Ctx<Context> = Context;

impl<Context: ReaderContext> NewReaderWrap<Context> {
    /// Reborrow as `NewReaderWrap<&mut Context>` so the same reader can be
    /// passed by-value into per-message handlers across loop iterations
    /// (Zig relied on implicit struct copy of the pointer-carrying wrapper).
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
        let slice = data.slice();
        if slice.len() < Int::SIZE {
            return Err(AnyPostgresError::ShortRead);
        }
        // Zig special-cased `Int == u8` to skip the byte-swap; `from_be_slice`
        // for a 1-byte int is already a no-op swap, so no branch needed here.
        Ok(Int::from_be_slice(&slice[0..Int::SIZE]))
    }

    pub fn peek_int<Int: ProtocolInt>(&self) -> Option<Int> {
        let remain = self.peek();
        if remain.len() < Int::SIZE {
            return None;
        }
        Some(Int::from_be_slice(&remain[0..Int::SIZE]))
    }

    pub fn expect_int<Int: ProtocolInt>(&mut self, value: Int) -> Result<bool, AnyPostgresError> {
        // PERF(port): `value` was `comptime comptime_int` — profile in Phase B
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
        // PORT NOTE: Zig `expected > -1` — `int4` is u32 so always nonnegative; preserved
        // as the saturating sub guarding underflow when len < 4.
        self.ensure_capacity(expected.saturating_sub(4) as usize)?;

        Ok(expected)
    }

    // Zig: `pub const bytes = read;`
    #[inline]
    pub fn bytes(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        self.read(count)
    }

    pub fn string(&mut self) -> Result<BunString, AnyPostgresError> {
        let result = self.read_z()?;
        // PORT NOTE: Zig `borrowUTF8` borrows `result.slice()` then drops `result`
        // via `defer result.deinit()`. `Data` here is `Temporary` (points into the
        // connection buffer), so the bytes outlive the `Data` wrapper itself;
        // `borrow_utf8` stores a raw pointer (no lifetime) so this matches Zig
        // semantics 1:1. Phase B: audit that no caller holds the returned
        // `BunString` past the next buffer fill.
        Ok(BunString::borrow_utf8(result.slice()))
    }
}

// (duplicate blanket impl + reborrow removed — defined above at L47/L69)

// Zig: `pub fn NewReader(comptime Context: type) type { return NewReaderWrap(Context, Context.markMessageStart, ...); }`
// The trait bound on `NewReaderWrap` already enforces the method set, so this is a plain alias.
pub type NewReader<Context> = NewReaderWrap<Context>;

// ported from: src/sql/postgres/protocol/NewReader.zig
