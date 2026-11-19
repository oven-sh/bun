use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct ParameterStatus<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
}

impl<'a> ParameterStatus<'a> {
    pub fn decode_internal(reader: &NewReader<'a>) -> Result<Self, AnyPostgresError> {
        let mut remaining = reader.body_length()?;

        let (name, consumed) = reader.string_within(remaining)?;
        remaining -= consumed;
        let (value, _) = reader.string_within(remaining)?;
        Ok(Self { name, value })
    }
}
