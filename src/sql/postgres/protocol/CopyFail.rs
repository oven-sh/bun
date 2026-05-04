use crate::postgres::types::int_types::Int32;
use crate::shared::Data;

use super::new_reader::NewReader;
use super::new_writer::NewWriter;

pub struct CopyFail {
    pub message: Data,
}

impl Default for CopyFail {
    fn default() -> Self {
        Self {
            message: Data::Empty,
        }
    }
}

impl CopyFail {
    // PORT NOTE: Zig signature is `fn decodeInternal(this: *@This(), ...) !void` with
    // `this.* = .{...}` body — the out-param-constructor pattern. Reshaped to return
    // `Result<Self, _>` per PORTING.md (Rust has NRVO for error unions).
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let _ = reader.int4()?;

        let message = reader.read_z()?;
        Ok(Self { message })
    }

    // Zig: `pub const decode = DecoderWrap(CopyFail, decodeInternal).decode;`
    // TODO(port): DecoderWrap is a comptime type-generator that adapts `decode_internal`
    // into a public `decode` fn. In Rust this should become a trait impl
    // (e.g. `impl super::decoder_wrap::Decode for CopyFail`) where `decode` is the
    // trait's provided method. Phase B wires this once DecoderWrap.rs lands.

    pub fn write_internal<Context>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let message = self.message.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + message.len() + 1).unwrap();
        // Zig: `[_]u8{'f'} ++ toBytes(Int32(count))` — runtime array concat into [5]u8.
        // `std.mem.toBytes` reinterprets the Int32 (big-endian i32 newtype) as raw bytes.
        let mut header = [0u8; 5];
        header[0] = b'f';
        // TODO(port): assumes `Int32::from(u32) -> Int32` and `Int32::to_bytes(self) -> [u8; 4]`
        // exist on the ported int_types; std.mem.toBytes is a bytewise reinterpret.
        header[1..5].copy_from_slice(&Int32::from(count).to_bytes());
        writer.write(&header)?;
        writer.string(message)?;
        Ok(())
    }

    // Zig: `pub const write = WriteWrap(@This(), writeInternal).write;`
    // TODO(port): WriteWrap is a comptime type-generator that adapts `write_internal`
    // into a public `write` fn. In Rust this should become a trait impl
    // (e.g. `impl super::write_wrap::Write for CopyFail`) where `write` is the
    // trait's provided method. Phase B wires this once WriteWrap.rs lands.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyFail.zig (41 lines)
//   confidence: medium
//   todos:      4
//   notes:      decode_internal reshaped from out-param to -> Result<Self>; DecoderWrap/WriteWrap comptime wrappers deferred to trait impls; Int32::to_bytes assumed
// ──────────────────────────────────────────────────────────────────────────
