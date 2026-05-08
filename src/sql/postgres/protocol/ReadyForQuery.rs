use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use super::transaction_status_indicator::TransactionStatusIndicator;

pub struct ReadyForQuery {
    pub status: TransactionStatusIndicator,
}

impl Default for ReadyForQuery {
    fn default() -> Self {
        Self { status: TransactionStatusIndicator::I }
    }
}

impl ReadyForQuery {
    // PORT NOTE: reshaped out-param constructor (`this.* = .{...}`) to return Self.
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(mut reader: NewReader<Container>) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let length = reader.length()?;
        debug_assert!(length >= 4);

        let status = reader.int::<u8>()?;
        Ok(Self {
            // SAFETY: server sends a valid TransactionStatusIndicator byte; enum is #[repr(u8)].
            status: unsafe { core::mem::transmute::<u8, TransactionStatusIndicator>(status) },
        })
    }

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(context: Container) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/ReadyForQuery.zig
