use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::shared::Data;

#[derive(Default)]
pub struct CopyData {
    pub data: Data, // default = Data::Empty
}

impl CopyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let remaining = reader.body_length()?;

        let data = reader.read(remaining)?;
        Ok(Self { data })
    }
}
