use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;
use crate::postgres::postgres_types::Int4;

#[derive(Default)]
pub struct NotificationResponse {
    pub pid: Int4,
    pub channel: Vec<u8>,
    pub payload: Vec<u8>,
}

// Zig `deinit` only freed `channel`/`payload` via `clearAndFree(bun.default_allocator)`.
// `Vec<u8>` owns its allocation and frees on Drop, so no explicit `impl Drop`
// is needed here.

impl NotificationResponse {
    // Reshaped from the Zig out-param `fn(this: *@This(), ...) !void` with `this.* = .{...}`
    // to a value-returning constructor (PORTING.md §Ground rules, out-param exception).
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        Ok(Self {
            pid: reader.int4()?,
            channel: reader
                .read_z()?
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
            payload: reader
                .read_z()?
                .to_owned()
                .map_err(|_| AnyPostgresError::OutOfMemory)?,
        })
    }

    // Zig: `pub const decode = DecoderWrap(NotificationResponse, decodeInternal).decode;`
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/NotificationResponse.zig
