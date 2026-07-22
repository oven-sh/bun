use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct BackendKeyData {
}

impl BackendKeyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        if !reader.expect_int::<u32>(12)? {
            return Err(AnyPostgresError::InvalidBackendKeyData);
        }

        Ok(Self {
            // i32 -> u32: same-width signed→unsigned `as` cast preserves bits.
        })
    }
}
