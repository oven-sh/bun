use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;
use crate::postgres::types::int_types::int32;
use crate::shared::Data;

#[derive(Default)]
pub struct CopyData {
    pub data: Data, // default = Data::Empty
}

impl CopyData {
    // PORT NOTE: out-param constructor (`this.* = .{...}`) reshaped to return Self.
    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let length = reader.length()?;

        let data = reader.read(usize::try_from(length.saturating_sub(5)).expect("int cast"))?;
        Ok(Self { data })
    }

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        mut reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        *self = Self::decode_internal(reader)?;
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        let data = self.data.slice();
        let count: u32 =
            u32::try_from(core::mem::size_of::<u32>() + data.len() + 1).expect("int cast");
        // Zig: [_]u8{'d'} ++ toBytes(Int32(count)) — `int32` returns big-endian [u8;4].
        let count_bytes = int32(count);
        let header: [u8; 5] = [
            b'd',
            count_bytes[0],
            count_bytes[1],
            count_bytes[2],
            count_bytes[3],
        ];
        writer.write(&header)?;
        writer.string(data)?;
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/CopyData.zig
