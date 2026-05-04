use super::new_reader::NewReader;
use crate::postgres::any_postgres_error::AnyPostgresError;

// PORT NOTE: reshaped for Rust — Zig's `DecoderWrap(comptime Container: type,
// comptime decodeFn: anytype) type` curries a comptime fn value into a generated
// struct. Rust cannot take a fn value as a type-level parameter on stable, so
// `decodeFn` becomes a required trait method `decode_fn` on `Container` and the
// generated struct becomes a blanket-impl'd extension trait. Call sites change
// from `pub const decode = DecoderWrap(Self, decodeInternal).decode;` to
// `impl DecoderWrap for Self { fn decode_fn<C>(...) { decodeInternal(...) } }`.
// TODO(port): revisit in Phase B once NewReader<C>'s trait bounds are settled.
pub trait DecoderWrap: Sized {
    /// The Zig `decodeFn(this, comptime Context, NewReader(Context){ .wrapped = context })`.
    /// Paired `(comptime Context: type, reader: NewReader(Context))` collapses to a
    /// single generic `reader: NewReader<C>` per PORTING.md.
    fn decode_fn<C>(&mut self, reader: NewReader<C>) -> Result<(), AnyPostgresError>;

    fn decode<C>(&mut self, context: C) -> Result<(), AnyPostgresError> {
        self.decode_fn(NewReader::<C> { wrapped: context })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/DecoderWrap.zig (12 lines)
//   confidence: medium
//   todos:      1
//   notes:      comptime-fn-value type generator reshaped to extension trait; verify call sites
// ──────────────────────────────────────────────────────────────────────────
