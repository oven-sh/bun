use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::encode_length_int;
use super::packet_header::PacketHeader;
use bun_sql::mysql::mysql_types::{MySQLInt32, MySQLInt64};
use bun_str::String as BunString;

bun_output::declare_scope!(NewWriter, hidden);

/// Zig's `NewWriterWrap` passes `offsetFn`/`writeFn`/`pwriteFn` as comptime
/// fn-pointer params. In Rust those become required methods on a trait that
/// `Context` implements; `NewWriter(Context)` then just calls them through the
/// trait bound.
pub trait WriterContext: Copy {
    fn offset(self) -> usize;
    fn write(self, bytes: &[u8]) -> Result<(), AnyMySQLError>;
    fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyMySQLError>;
}

#[derive(Clone, Copy)]
pub struct NewWriterWrap<C: WriterContext> {
    pub wrapped: C,
}

pub struct Packet<C: WriterContext> {
    pub header: PacketHeader,
    pub offset: usize,
    pub ctx: NewWriterWrap<C>,
}

impl<C: WriterContext> Packet<C> {
    pub fn end(&mut self) -> Result<(), AnyMySQLError> {
        let new_offset = self.ctx.wrapped.offset();
        // fix position for packet header
        let length = new_offset - self.offset - PacketHeader::SIZE;
        self.header.length = u32::try_from(length).unwrap();
        bun_output::scoped_log!(NewWriter, "writing packet header: {}", self.header.length);
        self.ctx.pwrite(&self.header.encode(), self.offset)
    }
}

impl<C: WriterContext> NewWriterWrap<C> {
    pub const IS_WRAPPED: bool = true;

    #[inline]
    pub fn write_length_encoded_int(self, data: u64) -> Result<(), AnyMySQLError> {
        self.wrapped.write(encode_length_int(data).slice())
    }

    #[inline]
    pub fn write_length_encoded_string(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.write_length_encoded_int(data.len() as u64)?;
        self.wrapped.write(data)
    }

    pub fn write(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.wrapped.write(data)
    }

    pub fn start(self, sequence_id: u8) -> Result<Packet<C>, AnyMySQLError> {
        let o = self.wrapped.offset();
        bun_output::scoped_log!(NewWriter, "starting packet: {}", o);
        self.write(&[0u8; PacketHeader::SIZE])?;
        Ok(Packet {
            header: PacketHeader { sequence_id, length: 0 },
            offset: o,
            ctx: self,
        })
    }

    pub fn offset(self) -> usize {
        self.wrapped.offset()
    }

    pub fn pwrite(self, data: &[u8], i: usize) -> Result<(), AnyMySQLError> {
        self.wrapped.pwrite(data, i)
    }

    pub fn int4(self, value: MySQLInt32) -> Result<(), AnyMySQLError> {
        self.write(&value.to_ne_bytes())
    }

    pub fn int8(self, value: MySQLInt64) -> Result<(), AnyMySQLError> {
        self.write(&value.to_ne_bytes())
    }

    pub fn int1(self, value: u8) -> Result<(), AnyMySQLError> {
        self.write(&[value])
    }

    pub fn write_z(self, value: &[u8]) -> Result<(), AnyMySQLError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }

    pub fn string(self, value: &BunString) -> Result<(), AnyMySQLError> {
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

/// In Zig, `NewWriter(Context)` returns `Context` unchanged when it already has
/// `is_wrapped`, otherwise wraps it via `NewWriterWrap`. Rust cannot branch on a
/// type-level decl, so callers that already hold a `NewWriterWrap<C>` should use
/// it directly; this alias covers the wrapping case.
// TODO(port): @hasDecl(Context, "is_wrapped") short-circuit — Phase B: ensure no
// caller double-wraps; if needed, model via a `MySQLWriter` trait with a blanket
// impl for `NewWriterWrap<C>`.
pub type NewWriter<C> = NewWriterWrap<C>;

/// Zig's `writeWrap(Container, writeFn)` returns a struct with a `write` method
/// that auto-wraps a raw context into `NewWriterWrap` before forwarding to
/// `writeFn`. In Rust this is a free helper that the per-packet `write` impls
/// call directly.
// TODO(port): Zig used @hasDecl to detect already-wrapped contexts at the call
// site. Rust callers should pass `impl WriterContext` and let this helper wrap
// unconditionally; already-wrapped values go straight to `write_fn`.
#[inline]
pub fn write_wrap<Container, C, F>(
    this: &mut Container,
    context: C,
    write_fn: F,
) -> Result<(), AnyMySQLError>
where
    C: WriterContext,
    F: FnOnce(&mut Container, NewWriterWrap<C>) -> Result<(), AnyMySQLError>,
{
    write_fn(this, NewWriterWrap { wrapped: context })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/NewWriter.zig (132 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime fn-ptr params → WriterContext trait; NewWriter/writeWrap @hasDecl reflection flattened — verify call sites in Phase B
// ──────────────────────────────────────────────────────────────────────────
