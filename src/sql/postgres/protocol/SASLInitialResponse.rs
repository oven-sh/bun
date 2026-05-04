use bun_sql::shared::Data;
use bun_sql::postgres::types::int_types::int32;
use bun_sql::postgres::protocol::new_writer::NewWriter;
use bun_sql::postgres::protocol::write_wrap::WriteWrap;

pub struct SASLInitialResponse {
    pub mechanism: Data,
    pub data: Data,
}

impl Default for SASLInitialResponse {
    fn default() -> Self {
        Self {
            mechanism: Data::empty(),
            data: Data::empty(),
        }
    }
}

// `deinit` only called `.deinit()` on owned `Data` fields; `Data: Drop` handles this.
// (No explicit `impl Drop` needed — see PORTING.md §Idiom map: deinit.)

impl SASLInitialResponse {
    pub fn write_internal<Context>(
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

    // TODO(port): `pub const write = WriteWrap(@This(), writeInternal).write;`
    // WriteWrap is a comptime type-generator that wraps write_internal — Phase B
    // should wire this via the WriteWrap trait/macro once its Rust shape lands.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/SASLInitialResponse.zig (35 lines)
//   confidence: medium
//   todos:      2
//   notes:      WriteWrap re-export pattern deferred
// ──────────────────────────────────────────────────────────────────────────
