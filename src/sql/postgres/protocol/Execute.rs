use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use super::write_wrap::WriteWrap;
use bun_sql::postgres::types::int_types::Int4;

pub struct Execute {
    pub max_rows: Int4,
    pub p: PortalOrPreparedStatement,
}

impl Default for Execute {
    fn default() -> Self {
        Self {
            max_rows: 0,
            // TODO(port): PortalOrPreparedStatement has no Zig default; callers must set `p`.
            p: PortalOrPreparedStatement::default(),
        }
    }
}

impl Execute {
    pub fn write_internal<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write(b"E")?;
        let length = writer.length()?;
        if let PortalOrPreparedStatement::Portal(portal) = &self.p {
            writer.string(portal)?;
        } else {
            writer.write(&[0u8])?;
        }
        writer.int4(self.max_rows)?;
        length.write()?;
        Ok(())
    }

    // Zig: `pub const write = WriteWrap(@This(), writeInternal).write;`
    // TODO(port): WriteWrap is a comptime type-generator wrapping write_internal; in Rust this
    // should be a trait (e.g. `impl WriteWrap for Execute`) whose default `write` calls
    // `write_internal`. Stubbed as a direct delegate until WriteWrap.rs lands.
    pub fn write<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, writer, Self::write_internal)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/Execute.zig (26 lines)
//   confidence: medium
//   todos:      3
//   notes:      WriteWrap comptime-generator mapped to trait/helper call; NewWriter<Context> signature may need &mut vs by-value adjustment in Phase B.
// ──────────────────────────────────────────────────────────────────────────
