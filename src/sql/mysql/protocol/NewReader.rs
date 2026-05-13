use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::decode_length_int;
use crate::shared::data::Data;

/// Trait capturing the structural interface that Zig's `NewReaderWrap` took as
/// seven comptime fn params (`markMessageStartFn_`, `peekFn_`, `skipFn_`,
/// `ensureCapacityFn_`, `readFunction_`, `readZ_`, `setOffsetFromStart_`).
///
/// In Zig, `NewReader(Context)` reflected `Context.markMessageStart` etc. via
/// `@hasDecl`; in Rust the trait bound IS that check (see PORTING.md §Comptime
/// reflection).
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

// PORT NOTE: Zig's `NewReaderWrap(Context, fn, fn, fn, fn, fn, fn, fn) type`
// returned an anonymous `struct { wrapped: Context, ... }`. In Rust the comptime
// fn-pointer params collapse into the `ReaderContext` trait above, and the
// returned struct becomes this generic wrapper. `NewReader(Context)` (which
// checked `@hasDecl(Context, "is_wrapped")` to avoid double-wrapping) is
// subsumed: callers name `NewReader<C>` directly and the type system prevents
// accidental double-wrap.
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

    /// Zig `reader.int(u24)` — read 3 little-endian bytes, zero-extend to u32.
    pub fn int_u24(self) -> Result<u32, AnyMySQLError> {
        let data = self.read(3)?;
        let s = data.slice();
        Ok(u32::from_le_bytes([s[0], s[1], s[2], 0]))
    }

    /// Zig `reader.int(i24)` — read 3 little-endian bytes, sign-extend to i32.
    pub fn int_i24(self) -> Result<i32, AnyMySQLError> {
        let data = self.read(3)?;
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

/// Helper trait replacing Zig's `comptime Int: type` + `@typeInfo(Int).int.bits`
/// reflection in `int()`. The canonical native-endian int codec lives in
/// `bun_core`; re-exported here under the protocol-local name so callers
/// (`int<I: ReadableInt>()` and `bun_sql::ReadableInt`) keep their paths.
/// MySQL's u24/i24 are NOT routed through this trait — see `int_u24`/`int_i24`.
pub use bun_core::NativeEndianInt as ReadableInt;

/// Zig: `fn NewReader(comptime Context: type) type` — returned `Context` unchanged
/// if it already had `is_wrapped`, else `NewReaderWrap(Context, Context.fn...)`.
///
/// In Rust this is just the `NewReader<C>` struct above; the `@hasDecl` early-return
/// is unnecessary because Rust callers name the concrete type. Kept as a type alias
/// for diff parity.
pub type NewReaderOf<C> = NewReader<C>;

// ─── decoderWrap ──────────────────────────────────────────────────────────────
//
// Zig: `fn decoderWrap(comptime Container, comptime decodeFn) type` returned a
// struct with `decode` / `decodeAllocator` that auto-wrapped `context` into
// `.{ .wrapped = context }` when `Context` lacked `is_wrapped`.
//
// PORT NOTE: the `@hasDecl(Context, "is_wrapped")` branch collapses — in Rust,
// callers either already have a `NewReader<C>` or a bare `C: ReaderContext`, and
// `Into<NewReader<C>>` covers both. The allocator-taking variant drops its
// `std.mem.Allocator` param per PORTING.md §Allocators (non-AST crate).

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
