use crate::shared::Data;
use crate::postgres::types::int_types::int32;
use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;

#[derive(Default)]
pub struct SASLResponse {
    pub data: Data,
}

// deinit: body only calls `this.data.deinit()` — Data's own Drop handles it.
// (PORTING.md: delete deinit bodies that only free/deinit owned fields.)

impl SASLResponse {
    pub fn write_internal<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let data = self.data.slice();
        let count: usize = core::mem::size_of::<u32>() + data.len();
        let mut header = [0u8; 5];
        header[0] = b'p';
        // std.mem.toBytes(Int32(count)) — Int32 byte-swaps to network order, then take native bytes
        header[1..5].copy_from_slice(&int32(count).to_ne_bytes());
        writer.write(&header)?;
        writer.write(data)?;
        Ok(())
    }

    // pub const write = WriteWrap(@This(), writeInternal).write;
    // TODO(port): WriteWrap is a type-generating fn that wraps write_internal; Phase B
    // wires this once WriteWrap's Rust shape (trait or macro) is settled.
    pub fn write<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, writer, Self::write_internal)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/SASLResponse.zig (30 lines)
//   confidence: medium
//   todos:      2
//   notes:      WriteWrap/NewWriter generic shapes guessed; header build reshaped from Zig `++` array concat
// ──────────────────────────────────────────────────────────────────────────
