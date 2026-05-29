use super::new_reader::{NewReader, ReaderContext};
use crate::postgres::any_postgres_error::AnyPostgresError;

pub trait DecoderWrap: Sized {
    /// The Zig `decodeFn(this, comptime Context, NewReader(Context){ .wrapped = context })`.
    /// Paired `(comptime Context: type, reader: NewReader(Context))` collapses to a
    /// single generic `reader: NewReader<C>` per PORTING.md.
    fn decode_fn<C: ReaderContext>(&mut self, reader: NewReader<C>)
    -> Result<(), AnyPostgresError>;

    fn decode<C: ReaderContext>(&mut self, context: C) -> Result<(), AnyPostgresError> {
        self.decode_fn(NewReader::<C> { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/DecoderWrap.zig
