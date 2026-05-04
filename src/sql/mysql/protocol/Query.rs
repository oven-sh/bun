use crate::mysql::mysql_param::Param;
use crate::mysql::protocol::command_type::CommandType;
use crate::mysql::protocol::new_writer::{write_wrap, NewWriter};
use crate::shared::data::Data;

bun_output::declare_scope!(MySQLQuery, visible);

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
    pub fn write_internal<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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
                bun_output::scoped_log!(
                    MySQLQuery,
                    "New params bind flag {} unsigned? {}",
                    <&'static str>::from(param_type.r#type),
                    // TODO(port): packed-struct flag access (Zig: param_type.flags.UNSIGNED)
                    param_type.flags.unsigned,
                );
                writer.int1(param_type.r#type as u8)?;
                writer.int1(if param_type.flags.unsigned { 0x80 } else { 0 })?;
                let param_name = {
                    use std::io::Write;
                    let mut cursor = std::io::Cursor::new(&mut param_name_buf[..]);
                    write!(&mut cursor, ":p{}", i)
                        .map_err(|_| bun_core::err!("TooManyParameters"))?;
                    let len = usize::try_from(cursor.position()).unwrap();
                    &param_name_buf[..len]
                };
                writer.write_length_encoded_string(param_name)?;
            }

            // Write parameter values
            debug_assert_eq!(self.params.len(), self.param_types.len());
            for (param, param_type) in self.params.iter().zip(self.param_types.iter()) {
                // TODO(port): verify enum/variant names for Data::Empty and MYSQL_TYPE_NULL
                if matches!(param, Data::Empty) || param_type.r#type.is_mysql_type_null() {
                    continue;
                }

                let value = param.slice();
                bun_output::scoped_log!(
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
    // TODO(port): `writeWrap` is a comptime type-returning fn in NewWriter.zig that
    // wraps `write_internal` into a `write` entry point. Phase B should express this
    // as a trait impl or a thin wrapper once `new_writer::write_wrap` is ported.
    pub fn write<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        write_wrap(self, Self::write_internal, writer)
    }
}

// TODO(port): bound `W` by the NewWriter protocol trait (start/int1/write) —
// Zig `writer: anytype`; body calls .start/.int1/.write. Phase B: replace with
// `&mut impl NewWriterProtocol` once that trait exists.
pub fn execute<W>(query: &[u8], writer: &mut W) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUERY as u8)?;
    writer.write(query)?;
    packet.end()?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/Query.zig (70 lines)
//   confidence: medium
//   todos:      9
//   notes:      Execute<'a> borrows all fields (Phase-B lifetime decision pending); writeWrap metaprogramming stubbed; flag/enum names need cross-file verification
// ──────────────────────────────────────────────────────────────────────────
