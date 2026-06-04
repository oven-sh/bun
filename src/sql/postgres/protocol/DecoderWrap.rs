use super::new_reader::{NewReader, ReaderContext};
use crate::postgres::any_postgres_error::AnyPostgresError;

// The Zig original (`DecoderWrap(comptime Container: type, comptime decodeFn:
// anytype) type`) curried a comptime fn value into a generated struct. Rust
// cannot take a fn value as a type-level parameter on stable, so `decodeFn` is
// a required trait method `decode_fn` and the generated struct is a
// blanket-impl'd extension trait: implementors write
// `impl DecoderWrap for Self { fn decode_fn<C>(...) { decode_internal(...) } }`.
// TODO(refactor): revisit once `NewReader<C>`'s trait bounds are settled.
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
