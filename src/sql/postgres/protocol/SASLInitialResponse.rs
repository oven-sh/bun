use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::new_writer::NewWriter;
use crate::postgres::types::int_types::int32;

pub struct SASLInitialResponse<'a> {
    pub mechanism: &'a [u8],
    pub data: &'a [u8],
}

impl SASLInitialResponse<'_> {
    pub fn write_internal(&self, writer: &mut NewWriter<'_>) -> Result<(), AnyPostgresError> {
        let mechanism = self.mechanism;
        let data = self.data;
        let count: usize = core::mem::size_of::<u32>()
            + mechanism.len()
            + 1
            + data.len()
            + core::mem::size_of::<u32>();
        let header: [u8; 5] = {
            let mut h = [0u8; 5];
            h[0] = b'p';
            h[1..].copy_from_slice(&int32(count)?);
            h
        };
        writer.write(&header)?;
        writer.string(mechanism)?;
        writer.int4(data.len() as u32)?;
        writer.write(data)?;
        Ok(())
    }
}
