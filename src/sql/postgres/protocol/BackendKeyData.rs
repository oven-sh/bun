use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Copy, Clone)]
pub struct BackendKeyData {
    process_id: u32,
    secret_key: u32,
}

impl BackendKeyData {
    /// No type byte, and `(1234 << 16) | 5678` where a StartupMessage has the protocol version.
    pub fn cancel_request(self) -> [u8; 16] {
        let mut packet = [0u8; 16];
        packet[0..4].copy_from_slice(&16u32.to_be_bytes());
        packet[4..8].copy_from_slice(&80877102u32.to_be_bytes());
        packet[8..12].copy_from_slice(&self.process_id.to_be_bytes());
        packet[12..16].copy_from_slice(&self.secret_key.to_be_bytes());
        packet
    }

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
