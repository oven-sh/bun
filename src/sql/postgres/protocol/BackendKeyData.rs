use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::Int4;

pub struct BackendKeyData {
    pub process_id: Int4,
    pub secret_key: Int4,
}

impl BackendKeyData {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        if !reader.expect_int::<u32>(12)? {
            return Err(AnyPostgresError::InvalidBackendKeyData);
        }

        Ok(Self {
            process_id: reader.int4()?,
            secret_key: reader.int4()?,
        })
    }
}
