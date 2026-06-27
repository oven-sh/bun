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
        reader.length()?;

        Ok(Self {
            pid: reader.int4()?,
            channel: reader
                .read_z()?
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
            payload: reader
                .read_z()?
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
        })
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}
