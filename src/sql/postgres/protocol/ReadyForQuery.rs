use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct ReadyForQuery {
    /// `I`: idle. `T`: in a transaction block. `E`: in a failed transaction block.
    pub transaction_status: u8,
}

impl ReadyForQuery {
    pub fn decode_internal(reader: &NewReader<'_>) -> Result<Self, AnyPostgresError> {
        if reader.body_length()? == 0 {
            return Err(AnyPostgresError::InvalidMessage);
        }

        Ok(Self {
            transaction_status: reader.int::<u8>()?,
        })
    }
}
