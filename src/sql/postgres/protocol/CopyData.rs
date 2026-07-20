use super::new_reader::NewReader;
use super::new_writer::NewWriter;
use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

#[derive(Default)]
pub struct CopyData {
    pub data: Data, // default = Data::Empty
}

impl CopyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let length = reader.length()?;

        let data = reader.read(usize::try_from(length - 4).expect("int cast"))?;
        Ok(Self { data })
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), AnyPostgresError> {
        *self = Self::decode_internal(reader)?;
        Ok(())
    }

    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let data = self.data.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + data.len() + 1).expect("int cast");
        // `int32` returns big-endian [u8; 4].
        let count_bytes = int32(count);
        let header: [u8; 5] = [
            b'd',
            count_bytes[0],
            count_bytes[1],
            count_bytes[2],
            count_bytes[3],
        ];
        writer.write(&header)?;
        writer.string(data)?;
        Ok(())
    }

    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        self.write_internal(writer)
    }
}
