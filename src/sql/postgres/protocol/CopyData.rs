use crate::postgres::types::int_types::Int32;
use crate::shared::Data;
use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;

#[derive(Default)]
pub struct CopyData {
    pub data: Data, // default = Data::Empty
}

impl CopyData {
    // PORT NOTE: out-param constructor (`this.* = .{...}`) reshaped to return Self.
    // TODO(port): narrow error set
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let length = reader.length()?;

        let data = reader.read(usize::try_from(length.saturating_sub(5)).unwrap())?;
        Ok(Self { data })
    }

    // Zig: pub const decode = DecoderWrap(CopyData, decodeInternal).decode;
    // TODO(port): DecoderWrap is a comptime type-generator that wraps decode_internal;
    // Phase B decides macro vs trait-default-method. Placeholder delegates directly.
    // TODO(port): in-place init — DecoderWrap trait currently takes `&mut self`;
    // reconcile with the `-> Result<Self, _>` constructor reshape in Phase B.
    pub fn decode<Container>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        *self = DecoderWrap::decode(Self::decode_internal, reader)?;
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn write_internal<Context>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        let data = self.data.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + data.len() + 1).unwrap();
        // Zig: [_]u8{'d'} ++ toBytes(Int32(count))
        let count_bytes = to_bytes(Int32::from(count));
        let header: [u8; 5] = [b'd', count_bytes[0], count_bytes[1], count_bytes[2], count_bytes[3]];
        writer.write(&header)?;
        writer.string(data)?;
        Ok(())
    }

    // Zig: pub const write = WriteWrap(@This(), writeInternal).write;
    // TODO(port): WriteWrap is a comptime type-generator that wraps write_internal;
    // Phase B decides macro vs trait-default-method. Placeholder delegates directly.
    pub fn write<Context>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, Self::write_internal, writer)
    }
}

/// `std.mem.toBytes` — reinterpret a value as its raw byte array.
#[inline]
fn to_bytes<T: Copy, const N: usize>(value: T) -> [u8; N] {
    // SAFETY: T is Copy/POD and N == size_of::<T>() at every call site (Int32 → 4 bytes).
    debug_assert_eq!(core::mem::size_of::<T>(), N);
    unsafe { core::mem::transmute_copy(&value) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyData.zig (39 lines)
//   confidence: medium
//   todos:      5
//   notes:      DecoderWrap/WriteWrap comptime fn-wrappers stubbed as delegating calls; Phase B picks macro/trait shape.
//              decode_internal reshaped to out-param-constructor → Result<Self, _>; DecoderWrap &mut self reconciliation deferred.
// ──────────────────────────────────────────────────────────────────────────
