use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::types::int_types::{PostgresInt32, PostgresShort};
use bun_sql::shared::Data;
use bun_str::String as BunString;

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

// Zig: `fn NewReaderWrap(comptime Context: type, comptime markMessageStartFn_, ...) type { return struct { wrapped: Context, ... } }`
// The fn-pointer params collapse into the `ReaderContext` trait bound.
pub struct NewReaderWrap<Context: ReaderContext> {
    pub wrapped: Context,
}

pub type Ctx<Context> = Context;

impl<Context: ReaderContext> NewReaderWrap<Context> {
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
        if expected > -1 {
            self.ensure_capacity(usize::try_from(expected.saturating_sub(4)).unwrap())?;
        }

        Ok(expected)
    }

    // Zig: `pub const bytes = read;`
    #[inline]
    pub fn bytes(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        self.read(count)
    }

    pub fn string(&mut self) -> Result<BunString, AnyPostgresError> {
        let result = self.read_z()?;
        // TODO(port): Zig `borrowUTF8` borrows `result.slice()` then drops `result`
        // via `defer result.deinit()` — that would dangle in Rust. Phase B must
        // confirm whether `Data` here is always a borrow into the connection
        // buffer (so the slice outlives `result`), or switch to an owning ctor.
        Ok(BunString::borrow_utf8(result.slice()))
    }
}

// Zig: `pub fn NewReader(comptime Context: type) type { return NewReaderWrap(Context, Context.markMessageStart, ...); }`
// The trait bound on `NewReaderWrap` already enforces the method set, so this is a plain alias.
pub type NewReader<Context> = NewReaderWrap<Context>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/NewReader.zig (120 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime fn-ptr params folded into ReaderContext trait; ProtocolInt trait stands in for @sizeOf/@byteSwap; string() borrow-vs-drop ordering needs Phase B audit
// ──────────────────────────────────────────────────────────────────────────
