use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::types::int_types::{PostgresInt32, PostgresInt64, int32};

/// Trait expressing the structural requirements that Zig's `NewWriterWrap`
/// took as comptime fn-pointer params (`offsetFn_`, `writeFunction_`,
/// `pwriteFunction_`). In Zig those were passed explicitly; in Rust the
/// trait bound IS that binding.
// TODO(port): `NewWriterWrap`'s explicit fn-pointer params collapse into this
// trait. If a caller needs to wrap a context with *different* fns than its
// inherent impl (none do today), add a newtype that impls this trait.
pub trait WriterContext: Copy {
    fn offset(self) -> usize;
    fn write(self, bytes: &[u8]) -> Result<(), AnyPostgresError>;
    fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyPostgresError>;
}

/// Zig: `fn NewWriterWrap(comptime Context, offsetFn, writeFn, pwriteFn) type { return struct { wrapped: Context, ... } }`
#[derive(Copy, Clone)]
pub struct NewWriter<C: WriterContext> {
    pub wrapped: C,
}

#[derive(Copy, Clone)]
pub struct LengthWriter<C: WriterContext> {
    pub index: usize,
    pub context: NewWriter<C>,
}

impl<C: WriterContext> LengthWriter<C> {
    pub fn write(self) -> Result<(), AnyPostgresError> {
        self.context
            .pwrite(&int32(self.context.offset() - self.index), self.index)
    }

    pub fn write_excluding_self(self) -> Result<(), AnyPostgresError> {
        self.context.pwrite(
            &int32(self.context.offset().saturating_sub(self.index + 4)),
            self.index,
        )
    }
}

impl<C: WriterContext> NewWriter<C> {
    // Zig: `pub const Ctx = Context;` — in Rust the generic param `C` is the name.
    // Zig: `pub const WrappedWriter = @This();` — `Self`.

    #[inline]
    pub fn write(self, data: &[u8]) -> Result<(), AnyPostgresError> {
        C::write(self.wrapped, data)
    }

    #[inline]
    pub fn length(self) -> Result<LengthWriter<C>, AnyPostgresError> {
        let i = self.offset();
        self.int4(0)?;
        Ok(LengthWriter {
            index: i,
            context: self,
        })
    }

    #[inline]
    pub fn offset(self) -> usize {
        C::offset(self.wrapped)
    }

    #[inline]
    pub fn pwrite(self, data: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        C::pwrite(self.wrapped, data, i)
    }

    pub fn int4(self, value: PostgresInt32) -> Result<(), AnyPostgresError> {
        // Zig: std.mem.asBytes(&@byteSwap(value)) — i.e. big-endian bytes
        self.write(&value.to_be_bytes())
    }

    pub fn int8(self, value: PostgresInt64) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    pub fn sint4(self, value: i32) -> Result<(), AnyPostgresError> {
        self.write(&value.to_be_bytes())
    }

    pub fn f64(self, value: f64) -> Result<(), AnyPostgresError> {
        // Zig: @byteSwap(@as(u64, @bitCast(value)))
        self.write(&value.to_bits().to_be_bytes())
    }

    pub fn f32(self, value: f32) -> Result<(), AnyPostgresError> {
        self.write(&value.to_bits().to_be_bytes())
    }

    pub fn short<T>(self, value: T) -> Result<(), AnyPostgresError>
    where
        T: TryInto<u16>,
    {
        // Zig: anytype → @typeInfo int check → std.math.cast(u16, ..) orelse error.TooManyParameters
        let v: u16 = value
            .try_into()
            .map_err(|_| AnyPostgresError::TooManyParameters)?;
        self.write(&v.to_be_bytes())
    }

    pub fn string(self, value: &[u8]) -> Result<(), AnyPostgresError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }

    pub fn bytes(self, value: &[u8]) -> Result<(), AnyPostgresError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }

    pub fn r#bool(self, value: bool) -> Result<(), AnyPostgresError> {
        self.write(if value { b"t" } else { b"f" })
    }

    pub fn null(self) -> Result<(), AnyPostgresError> {
        self.int4(PostgresInt32::MAX)
    }

    // TODO(port): Zig name is `String` (capital S); snake_cased it collides with
    // `string(&[u8])` above. Renamed to `bun_string`. Update callers in Phase B.
    pub fn bun_string(self, value: &bun_core::String) -> Result<(), AnyPostgresError> {
        if value.is_empty() {
            self.write(&[0u8])?;
            return Ok(());
        }

        let sliced = value.to_utf8();
        let slice = sliced.slice();

        self.write(slice)?;
        if slice.is_empty() || slice[slice.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }
}

// Zig: `pub fn NewWriter(comptime Context: type) type { return NewWriterWrap(Context, Context.offset, Context.write, Context.pwrite); }`
// In Rust this is just `NewWriter<C>` where `C: WriterContext` — the trait
// already binds `offset`/`write`/`pwrite` to the context's inherent methods.
// Kept as a constructor helper for callsite parity.
#[inline]
pub fn new_writer<C: WriterContext>(ctx: C) -> NewWriter<C> {
    NewWriter { wrapped: ctx }
}

// ported from: src/sql/postgres/protocol/NewWriter.zig
