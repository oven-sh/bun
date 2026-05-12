use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

#[derive(Default)]
pub struct SASLResponse {
    pub data: Data,
}

// deinit: body only calls `this.data.deinit()` — Data's own Drop handles it.
// (PORTING.md: delete deinit bodies that only free/deinit owned fields.)

impl SASLResponse {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let data = self.data.slice();
        let count: usize = core::mem::size_of::<u32>() + data.len();
        let mut header = [0u8; 5];
        header[0] = b'p';
        // std.mem.toBytes(Int32(count)) — Int32 byte-swaps to network order, then take native bytes
        // `int32(count)` already returns the big-endian `[u8; 4]`.
        header[1..5].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.write(data)?;
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/SASLResponse.zig
