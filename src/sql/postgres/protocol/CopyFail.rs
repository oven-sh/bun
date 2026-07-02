use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

use super::new_reader::NewReader;
use super::new_writer::NewWriter;

pub struct CopyFail {
    pub message: Data,
}

impl Default for CopyFail {
    fn default() -> Self {
        Self {
            message: Data::Empty,
        }
    }
}

impl CopyFail {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let _ = reader.int4()?;

        let message = reader.read_z()?;
        Ok(Self { message })
    }

    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let message = self.message.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + message.len() + 1).expect("int cast");
        let mut header = [0u8; 5];
        header[0] = b'f';
        // `int32(count)` returns big-endian `[u8; 4]`.
        header[1..5].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.string(message)?;
        Ok(())
    }
}
