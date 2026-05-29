use core::mem::size_of;

use super::new_writer::NewWriter;
use super::z_helpers::z_count;
use crate::postgres::types::int_types::{Int4, int32};

#[derive(Default)]
pub struct Parse<'a> {
    pub name: &'a [u8],
    pub query: &'a [u8],
    pub params: &'a [Int4],
}

// Zig `pub fn deinit(this: *Parse) void { _ = this; }` — no-op, so no `Drop` impl.

impl<'a> Parse<'a> {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let parameters = self.params;
        if parameters.len() > u16::MAX as usize {
            return Err(bun_core::err!("TooManyParameters"));
        }
        let count: usize = size_of::<u32>()
            + size_of::<u16>()
            + std::mem::size_of_val(parameters)
            + z_count(self.name).max(1)
            + z_count(self.query).max(1);

        // Zig: `[_]u8{'P'} ++ toBytes(Int32(count))` — 1 tag byte + 4 length bytes.
        // `std.mem.toBytes` is native-endian raw bytes of the value; `Int32(count)`
        // is the PostgresTypes big-endian wrapper, so the on-wire layout matches.
        let mut header = [0u8; 1 + size_of::<u32>()];
        header[0] = b'P';
        header[1..].copy_from_slice(&int32(count));
        writer.write(&header)?;
        writer.string(self.name)?;
        writer.string(self.query)?;
        writer.short(parameters.len())?;
        for parameter in parameters {
            writer.int4(*parameter)?;
        }
        Ok(())
    }

    // Zig `WriteWrap(@This(), ...)` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}

// ported from: src/sql/postgres/protocol/Parse.zig
