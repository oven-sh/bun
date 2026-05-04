use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use super::write_wrap::WriteWrap;

pub struct Describe {
    pub p: PortalOrPreparedStatement,
}

impl Describe {
    pub fn write_internal<Context>(
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

    // Zig: `pub const write = WriteWrap(@This(), writeInternal).write;`
    // TODO(port): WriteWrap is a comptime type-factory `fn(comptime T: type, comptime fn) type`
    // that produces a `.write` decl wrapping `write_internal`. Model in Phase B as a trait
    // (e.g. `impl WriteWrap for Describe { fn write_internal(...) }` providing default `write`),
    // or as a macro. Placeholder delegates through WriteWrap for now.
    pub fn write<Context>(&self, writer: NewWriter<Context>) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, writer, Self::write_internal)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/Describe.zig (26 lines)
//   confidence: medium
//   todos:      2
//   notes:      WriteWrap comptime-fn pattern needs trait/macro modeling; NewWriter<Context> generic bound TBD
// ──────────────────────────────────────────────────────────────────────────
