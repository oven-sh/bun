use crate::mysql::mysql_param::Param;
use crate::mysql::mysql_types::FieldType;
use crate::mysql::protocol::column_definition41::ColumnFlags;
use crate::mysql::protocol::command_type::CommandType;
use crate::mysql::protocol::new_writer::{NewWriter, WriterContext};
use crate::shared::data::Data;

bun_core::declare_scope!(MySQLQuery, visible);

// TODO(port): lifetime param on struct (Phase B) — Execute is a transient
// builder that borrows query/params/param_types from the caller for the
// duration of a single write() call (no LIFETIMES.tsv entry; BORROW_PARAM
// candidate). Phase A rule forbids struct lifetimes; revisit and either
// confirm BORROW_PARAM in LIFETIMES.tsv or restructure as fn params.
pub struct Execute<'a> {
    pub query: &'a [u8],
    /// Parameter values to bind to the prepared statement
    pub params: &'a mut [Data],
    /// Types of each parameter in the prepared statement
    pub param_types: &'a [Param],
}

// PORT NOTE: Zig `deinit` iterated `params` and called `param.deinit()` on each.
// In Rust, `Data` owns its resources via `Drop`, and `Execute` only borrows the
// slice, so the slice owner is responsible for cleanup. No `Drop` impl here.
// TODO(port): verify caller of Execute handles Data cleanup after write.

impl<'a> Execute<'a> {
    // TODO(port): narrow error set
    pub fn write_internal<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), bun_core::Error> {
        let mut packet = writer.start(0)?;
        writer.int1(CommandType::COM_QUERY as u8)?;
        writer.write(self.query)?;

        if !self.params.is_empty() {
            writer.write_null_bitmap(self.params)?;

            // Always 1. Malformed packet error if not 1
            writer.int1(1)?;
            // if 22 chars = u64 + 2 for :p and this should be more than enough
            let mut param_name_buf = [0u8; 22];
            // Write parameter types
            for (param_type, i) in self.param_types.iter().zip(1usize..) {
                let unsigned = param_type.flags.contains(ColumnFlags::UNSIGNED);
                bun_core::scoped_log!(
                    MySQLQuery,
                    "New params bind flag {} unsigned? {}",
                    <&'static str>::from(param_type.r#type),
                    unsigned,
                );
                writer.int1(param_type.r#type as u8)?;
                writer.int1(if unsigned { 0x80 } else { 0 })?;
                let param_name = {
                    use std::io::Write;
                    let mut cursor = std::io::Cursor::new(&mut param_name_buf[..]);
                    write!(&mut cursor, ":p{}", i)
                        .map_err(|_| bun_core::err!("TooManyParameters"))?;
                    let len = usize::try_from(cursor.position()).expect("int cast");
                    &param_name_buf[..len]
                };
                writer.write_length_encoded_string(param_name)?;
            }

            // Write parameter values
            debug_assert_eq!(self.params.len(), self.param_types.len());
            for (param, param_type) in self.params.iter().zip(self.param_types.iter()) {
                if matches!(param, Data::Empty) || param_type.r#type == FieldType::MYSQL_TYPE_NULL {
                    continue;
                }

                let value = param.slice();
                bun_core::scoped_log!(
                    MySQLQuery,
                    "Write param type {} len {} hex {:02x?}",
                    <&'static str>::from(param_type.r#type),
                    value.len(),
                    // TODO(port): Zig `{x}` hex-dumps the slice; verify formatting matches
                    value,
                );
                if param_type.r#type.is_binary_format_supported() {
                    writer.write(value)?;
                } else {
                    writer.write_length_encoded_string(value)?;
                }
            }
        }
        packet.end()?;
        Ok(())
    }

    // Zig: `pub const write = writeWrap(Execute, writeInternal).write;`
    // PORT NOTE: Zig's `writeWrap` constructs a `NewWriter` around a raw context
    // and calls `write_internal`. Here `writer` is already wrapped, so forward
    // directly — `write_wrap`'s only job (the wrapping) is done by the caller.
    pub fn write<C: WriterContext>(&self, writer: NewWriter<C>) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// Zig: `writer: anytype` — body calls .start/.int1/.write. Bound on the
// concrete `NewWriter<C>` shape (the only `anytype` instantiation in-tree).
pub fn execute<C: WriterContext>(
    query: &[u8],
    writer: NewWriter<C>,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUERY as u8)?;
    writer.write(query)?;
    packet.end()?;
    Ok(())
}

// ported from: src/sql/mysql/protocol/Query.zig
