use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::shared::Data;

#[derive(Default)]
pub struct ParameterStatus {
    pub name: Data,
    pub value: Data,
}

// The fields drop automatically, so no explicit `impl Drop` is needed.

impl ParameterStatus {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let mut remaining = reader.body_length()?;

        let (name, consumed) = reader.string_within(remaining)?;
        remaining -= consumed;
        let (value, _) = reader.string_within(remaining)?;
        Ok(Self { name, value })
    }
}
