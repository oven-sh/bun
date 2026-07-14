use super::new_reader::NewReader;
use super::transaction_status_indicator::TransactionStatusIndicator;
use crate::postgres::AnyPostgresError;

pub struct ReadyForQuery {
    pub status: TransactionStatusIndicator,
}

impl Default for ReadyForQuery {
    fn default() -> Self {
        Self {
            status: TransactionStatusIndicator::I,
        }
    }
}

impl ReadyForQuery {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        reader.length()?;

        let status = reader.int::<u8>()?;
        // TransactionStatusIndicator is a `#[repr(transparent)] struct(u8)` newtype —
        // wrap directly, no discriminant validation needed.
        Ok(Self {
            status: TransactionStatusIndicator(status),
        })
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}
