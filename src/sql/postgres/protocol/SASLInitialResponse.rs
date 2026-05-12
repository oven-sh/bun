use crate::postgres::protocol::new_writer::NewWriter;
use crate::postgres::protocol::write_wrap::WriteWrap;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

pub struct SASLInitialResponse {
    pub mechanism: Data,
    pub data: Data,
}

impl Default for SASLInitialResponse {
    fn default() -> Self {
        Self {
            mechanism: Data::Empty,
            data: Data::Empty,
        }
    }
}

// `deinit` only called `.deinit()` on owned `Data` fields; `Data: Drop` handles this.
// (No explicit `impl Drop` needed — see PORTING.md §Idiom map: deinit.)

impl SASLInitialResponse {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mechanism = self.mechanism.slice();
        let data = self.data.slice();
        let count: usize = core::mem::size_of::<u32>()
            + mechanism.len()
            + 1
            + data.len()
            + core::mem::size_of::<u32>();
        let header: [u8; 5] = {
            let mut h = [0u8; 5];
            h[0] = b'p';
            h[1..].copy_from_slice(&int32(count));
            h
        };
        writer.write(&header)?;
        writer.string(mechanism)?;
        writer.int4(data.len() as u32)?;
        writer.write(data)?;
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
}

// ported from: src/sql/postgres/protocol/SASLInitialResponse.zig
