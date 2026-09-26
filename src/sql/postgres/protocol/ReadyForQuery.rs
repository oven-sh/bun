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
        Ok(Self {
            status: TransactionStatusIndicator(status),
        })
    }
}
