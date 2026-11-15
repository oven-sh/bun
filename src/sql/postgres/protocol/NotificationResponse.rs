use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct NotificationResponse<'a> {
    pub channel: &'a [u8],
    pub payload: &'a [u8],
}

impl<'a> NotificationResponse<'a> {
    pub fn decode_internal(reader: &NewReader<'a>) -> Result<Self, AnyPostgresError> {
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
