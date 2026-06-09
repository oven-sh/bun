use super::new_writer::NewWriter;
use super::portal_or_prepared_statement::PortalOrPreparedStatement;
use crate::postgres::AnyPostgresError;

/// Close (F)
/// Byte1('C')
/// - Identifies the message as a Close command.
/// Int32
/// - Length of message contents in bytes, including self.
/// Byte1
/// - 'S' to close a prepared statement; or 'P' to close a portal.
/// String
/// - The name of the prepared statement or portal to close (an empty string selects the unnamed prepared statement or portal).
pub struct Close<'a> {
    pub p: PortalOrPreparedStatement<'a>,
}

impl<'a> Close<'a> {
    fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let p = &self.p;
        let count: u32 = core::mem::size_of::<u32>() as u32
            + 1
            + u32::try_from(p.slice().len()).expect("int cast")
            + 1;
        // 'C' · big-endian u32 count · tag byte, in a fixed 6-byte buffer.
        let mut header = [0u8; 6];
        header[0] = b'C';
        header[1..5].copy_from_slice(&count.to_be_bytes());
        header[5] = p.tag();
        writer.write(&header)?;
        writer.write(p.slice())?;
        writer.write(&[0u8])?;
        Ok(())
    }

    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        self.write_internal(writer)
    }
}
