use crate::postgres::protocol::new_writer::NewWriter;
use crate::postgres::protocol::write_wrap::WriteWrap;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

pub struct PasswordMessage {
    pub password: Data,
}

impl Default for PasswordMessage {
    fn default() -> Self {
        Self {
            password: Data::Empty,
        }
    }
}

// Zig `deinit` only calls `this.password.deinit()`; `Data` owns its buffer and
// implements `Drop`, so no explicit `Drop` impl is needed here.

impl PasswordMessage {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let password = self.password.slice();
        let count: usize = core::mem::size_of::<u32>() + password.len() + 1;
        // Zig: `[_]u8{'p'} ++ toBytes(Int32(count))` — comptime array concat.
        let mut header = [0u8; 5];
        header[0] = b'p';
        // `int32(count)` already returns the big-endian `[u8; 4]` (mirrors std.mem.toBytes(Int32(count))).
        header[1..5].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.string(password)?;
        Ok(())
    }

    // Zig: `pub const write = WriteWrap(@This(), writeInternal).write;`
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/PasswordMessage.zig
