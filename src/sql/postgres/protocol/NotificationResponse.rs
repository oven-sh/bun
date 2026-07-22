use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::postgres::postgres_types::Int4;

#[derive(Default)]
pub struct NotificationResponse {
    pub pid: Int4,
    pub channel: Vec<u8>,
    pub payload: Vec<u8>,
}

// `Vec<u8>` owns its allocation and frees on Drop, so no explicit `impl Drop`
// is needed here.

impl NotificationResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let mut remaining = (reader.length()? - 4) as usize;
        if remaining < 4 {
            return Err(AnyPostgresError::InvalidMessage);
        }
        let pid = reader.int4()?;
        remaining -= 4;
        let (channel, consumed) = reader.string_within(remaining)?;
        remaining -= consumed;
        let (payload, _) = reader.string_within(remaining)?;

        Ok(Self {
            pid,
            channel: channel
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
            payload: payload
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
        })
    }
}
