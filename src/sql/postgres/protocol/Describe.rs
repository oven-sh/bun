use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use super::write_wrap::WriteWrap;

pub struct Describe<'a> {
    pub p: PortalOrPreparedStatement<'a>,
}

impl<'a> Describe<'a> {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let message = self.p.slice();
        writer.write(&[b'D'])?;
        let length = writer.length()?;
        writer.write(&[self.p.tag()])?;
        writer.string(message)?;
        length.write()?;
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/Describe.zig
