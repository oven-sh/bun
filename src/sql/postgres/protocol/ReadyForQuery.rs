use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct ReadyForQuery {
}

impl Default for ReadyForQuery {
    fn default() -> Self {
        Self {
        }
    }
}

impl ReadyForQuery {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        reader.length()?;

        reader.int::<u8>()?;
        // TransactionStatusIndicator is a `#[repr(transparent)] struct(u8)` newtype —
        // wrap directly, no discriminant validation needed.
        Ok(Self {
        })
    }
}
