use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::shared::Data;

pub struct CopyData {
    pub data: Data,
}

impl CopyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let remaining = reader.body_length()?;

        Ok(Self {
            data: reader.read(remaining)?,
        })
    }
}
