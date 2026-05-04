use bun_collections::ByteList;

use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use crate::postgres::postgres_types::Int4;

#[derive(Default)]
pub struct NotificationResponse {
    pub pid: Int4,
    pub channel: ByteList,
    pub payload: ByteList,
}

// PORT NOTE: Zig `deinit` only freed `channel`/`payload` via `clearAndFree(bun.default_allocator)`.
// `ByteList` (= `BabyList<u8>`) owns its allocation and frees on Drop, so no explicit `impl Drop`
// is needed here.

impl NotificationResponse {
    // PORT NOTE: reshaped from out-param `fn(this: *@This(), ...) !void` with `this.* = .{...}`
    // to a value-returning constructor (PORTING.md §Ground rules, out-param exception).
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let length = reader.length()?;
        debug_assert!(length >= 4);

        Ok(Self {
            pid: reader.int4()?,
            channel: reader.read_z()?.to_owned(),
            payload: reader.read_z()?.to_owned(),
        })
    }

    // Zig: `pub const decode = DecoderWrap(NotificationResponse, decodeInternal).decode;`
    // TODO(port): `DecoderWrap` is a comptime type-returning fn parameterized by (Type, fn).
    // In Rust this becomes a trait impl or macro; Phase B wires the actual `decode` entry point.
    pub const DECODE: DecoderWrap<NotificationResponse> = DecoderWrap::new();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/NotificationResponse.zig (30 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap comptime-fn pattern needs trait/macro in Phase B; ByteList must impl Drop.
// ──────────────────────────────────────────────────────────────────────────
