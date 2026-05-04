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
    pub fn decode_internal<Container>(reader: NewReader<Container>) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let length = reader.length()?;
        debug_assert!(length >= 4);

        let status = reader.int::<u8>()?;
        Ok(Self {
            // SAFETY: server sends a valid TransactionStatusIndicator byte; enum is #[repr(u8)].
            status: unsafe { core::mem::transmute::<u8, TransactionStatusIndicator>(status) },
        })
    }

    // TODO(port): `DecoderWrap(ReadyForQuery, decodeInternal).decode` — Zig comptime type-generator
    // wrapping decode_internal. Phase B: express via the Rust DecoderWrap trait/generic.
    pub const decode: DecoderWrap<ReadyForQuery> = DecoderWrap::new(Self::decode_internal);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/ReadyForQuery.zig (19 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap const-fn binding needs Phase B trait shape; out-param ctor reshaped to -> Result<Self>.
// ──────────────────────────────────────────────────────────────────────────
