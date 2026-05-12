use super::new_reader::{NewReader, ReaderContext};

#[derive(Default)]
pub struct ResultSetHeader {
    pub field_count: u64,
}

impl ResultSetHeader {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Field count (length encoded integer)
        self.field_count = reader.encoded_len_int()?;
        Ok(())
    }

    // TODO(port): `decoderWrap(ResultSetHeader, decodeInternal).decode` is a Zig comptime
    // type-function that wraps `decode_internal` over an anyopaque-backed reader. Phase B
    // should replace this with the trait/impl that `new_reader::decoder_wrap` exposes.
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/ResultSetHeader.zig
