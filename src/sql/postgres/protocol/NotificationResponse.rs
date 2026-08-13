use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct NotificationResponse {}

impl NotificationResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let mut remaining = reader.body_length()?;
        if remaining < 4 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        // pid
        reader.int4()?;
        remaining -= 4;
        // channel
        let (_, consumed) = reader.string_within(remaining)?;
        remaining -= consumed;
        // payload
        reader.string_within(remaining)?;

        Ok(Self {})
    }
}
