use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct ReadyForQuery {
    /// `I`: idle. `T`: in a transaction block. `E`: in a failed transaction block.
    pub transaction_status: u8,
}

impl ReadyForQuery {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        reader.length()?;

        Ok(Self {
            transaction_status: reader.int::<u8>()?,
        })
    }
}
