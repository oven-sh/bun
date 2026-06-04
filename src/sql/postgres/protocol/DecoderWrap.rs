use super::new_reader::{NewReader, ReaderContext};
use crate::postgres::any_postgres_error::AnyPostgresError;

// Extension trait with a blanket-provided `decode`: implementors write
// `impl DecoderWrap for Self { fn decode_fn<C>(...) { decode_internal(...) } }`.
// TODO(refactor): revisit once `NewReader<C>`'s trait bounds are settled.
pub trait DecoderWrap: Sized {
    fn decode_fn<C: ReaderContext>(&mut self, reader: NewReader<C>)
    -> Result<(), AnyPostgresError>;

    fn decode<C: ReaderContext>(&mut self, context: C) -> Result<(), AnyPostgresError> {
        self.decode_fn(NewReader::<C> { wrapped: context })
    }
}
