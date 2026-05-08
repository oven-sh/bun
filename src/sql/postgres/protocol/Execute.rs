use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use super::write_wrap::WriteWrap;
use crate::postgres::types::int_types::Int4;

pub struct Execute<'a> {
    pub max_rows: Int4,
    pub p: PortalOrPreparedStatement<'a>,
}

impl<'a> Default for Execute<'a> {
    fn default() -> Self {
        Self {
            max_rows: 0,
            // TODO(port): PortalOrPreparedStatement has no Zig default; callers must set `p`.
            p: PortalOrPreparedStatement::Portal(b""),
        }
    }
}

impl<'a> Execute<'a> {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
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

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/Execute.zig
