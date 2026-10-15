use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::shared::Data;

pub struct NotificationResponse {
    pub channel: Data,
    pub payload: Data,
}

impl NotificationResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let mut remaining = reader.body_length()?;
        if remaining < 4 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        reader.int4()?;
        remaining -= 4;
        let (channel, consumed) = reader.string_within(remaining)?;
        remaining -= consumed;
        let (payload, _) = reader.string_within(remaining)?;

        Ok(Self { channel, payload })
    }
}
