use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::new_writer::NewWriter;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

pub struct PasswordMessage {
    pub password: Data,
}

impl PasswordMessage {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let password = self.password.slice();
        let count: usize = core::mem::size_of::<u32>() + password.len() + 1;
        let mut header = [0u8; 5];
        header[0] = b'p';
        // `int32(count)` returns the big-endian `[u8; 4]`.
        header[1..5].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.string(password)?;
        Ok(())
    }
}
