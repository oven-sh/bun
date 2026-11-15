use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use crate::postgres::AnyPostgresError;

pub struct Describe<'a> {
    pub p: PortalOrPreparedStatement<'a>,
}

impl<'a> Describe<'a> {
    pub fn write_internal(&self, writer: &mut NewWriter<'_>) -> Result<(), AnyPostgresError> {
        let message = self.p.slice();
        writer.write(b"D")?;
        let length = writer.length()?;
        writer.write(&[self.p.tag()])?;
        writer.string(message)?;
        length.write(writer)?;
        Ok(())
    }
}
