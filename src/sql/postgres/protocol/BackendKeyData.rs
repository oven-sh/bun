use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct BackendKeyData {}

impl BackendKeyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        if !reader.expect_int::<u32>(12)? {
            return Err(AnyPostgresError::InvalidBackendKeyData);
        }

        // process_id, secret_key
        reader.int4()?;
        reader.int4()?;
        Ok(Self {})
    }
}
