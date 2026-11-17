use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct CopyData<'a> {
    pub data: &'a [u8],
}

impl<'a> CopyData<'a> {
    pub fn decode_internal(reader: &NewReader<'a>) -> Result<Self, AnyPostgresError> {
        let remaining = reader.body_length()?;

        Ok(Self {
            data: reader.read(remaining)?,
        })
    }
}
