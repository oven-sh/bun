use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct NotificationResponse {}

// `Vec<u8>` owns its allocation and frees on Drop, so no explicit `impl Drop`
// is needed here.

impl NotificationResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        reader.length()?;

        Ok(Self {})
    }
}
