use super::new_reader::{NewReader, ReaderContext};
use crate::postgres::any_postgres_error::AnyPostgresError;

// PORT NOTE: Rust cannot take a fn value as a type-level parameter on stable, so
// the per-message decoder becomes a required trait method `decode_fn` on the
// container type and the wrapper becomes a blanket-impl'd extension trait. Call
// sites are `impl DecoderWrap for Self { fn decode_fn<C>(...) { decodeInternal(...) } }`.
// TODO(port): revisit in Phase B once NewReader<C>'s trait bounds are settled.
pub trait DecoderWrap: Sized {
    /// Decodes from a `NewReader<C>` constructed by wrapping the caller's context.
    fn decode_fn<C: ReaderContext>(&mut self, reader: NewReader<C>)
    -> Result<(), AnyPostgresError>;

    fn decode<C: ReaderContext>(&mut self, context: C) -> Result<(), AnyPostgresError> {
        self.decode_fn(NewReader::<C> { wrapped: context })
    }
}
