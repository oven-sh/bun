use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

/// Protocol §55.2.3: the request code a CancelRequest carries in place of the
/// protocol version, `(1234 << 16) | 5678`.
const CANCEL_REQUEST_CODE: u32 = 80877102;

#[derive(Default)]
pub struct BackendKeyData {
    pub process_id: u32,
    pub secret_key: u32,
}

impl BackendKeyData {
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }

    /// Protocol §55.2.3 CancelRequest: `Int32(16) Int32(80877102) Int32(pid) Int32(secret)`.
    /// It has no message-type byte because it is only ever sent as the first
    /// message of a *separate* connection, which the backend then closes.
    pub fn cancel_request(&self) -> [u8; 16] {
        let mut packet = [0u8; 16];
        packet[0..4].copy_from_slice(&16u32.to_be_bytes());
        packet[4..8].copy_from_slice(&CANCEL_REQUEST_CODE.to_be_bytes());
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
            // i32 -> u32: same-width signed→unsigned `as` cast preserves bits.
            process_id: reader.int4()?,
            secret_key: reader.int4()?,
        })
    }
}
