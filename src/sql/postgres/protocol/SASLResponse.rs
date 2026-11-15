use super::new_writer::NewWriter;
use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::int32;

#[derive(Default)]
pub struct SASLResponse<'a> {
    pub data: &'a [u8],
}

impl SASLResponse<'_> {
    pub fn write_internal(&self, writer: &mut NewWriter<'_>) -> Result<(), AnyPostgresError> {
        let data = self.data;
        let count: usize = core::mem::size_of::<u32>() + data.len();
        let mut header = [0u8; 5];
        header[0] = b'p';
        // `int32(count)` already returns the big-endian `[u8; 4]`.
        header[1..5].copy_from_slice(&int32(count)?);
        writer.write(&header)?;
        writer.write(data)?;
        Ok(())
    }
}
