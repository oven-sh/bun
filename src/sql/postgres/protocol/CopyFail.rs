use crate::postgres::types::int_types::int32;
use crate::shared::Data;

use super::new_reader::NewReader;
use super::new_writer::NewWriter;

pub struct CopyFail {
    pub message: Data,
}

impl Default for CopyFail {
    fn default() -> Self {
        Self {
            message: Data::Empty,
        }
    }
}

impl CopyFail {
    // PORT NOTE: Zig signature is `fn decodeInternal(this: *@This(), ...) !void` with
    // `this.* = .{...}` body — the out-param-constructor pattern. Reshaped to return
    // `Result<Self, _>` per PORTING.md (Rust has NRVO for error unions).
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let _ = reader.int4()?;

        let message = reader.read_z()?;
        Ok(Self { message })
    }

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs

    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let message = self.message.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + message.len() + 1).expect("int cast");
        // Zig: `[_]u8{'f'} ++ toBytes(Int32(count))` — runtime array concat into [5]u8.
        // `std.mem.toBytes` reinterprets the Int32 (big-endian i32 newtype) as raw bytes.
        let mut header = [0u8; 5];
        header[0] = b'f';
        // `int32(count)` returns big-endian `[u8; 4]` (mirrors std.mem.toBytes(Int32(count))).
        header[1..5].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.string(message)?;
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
}

// ported from: src/sql/postgres/protocol/CopyFail.zig
