use core::mem::size_of;

use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;
use super::z_helpers::z_count;
use crate::postgres::postgres_types::{Int32, Int4};

// PORT NOTE: Zig `deinit` is a no-op (`_ = this;`), so all three slice fields are
// borrowed for the lifetime of the write. PORTING.md says "never put a lifetime
// param on a struct in Phase A", but none of Box / &'static / raw fit a transient
// borrow-only message builder, so this struct carries an explicit `'a`.
// TODO(port): lifetime — revisit if Phase B prefers raw `*const [u8]` here.
#[derive(Default)]
pub struct Parse<'a> {
    pub name: &'a [u8],
    pub query: &'a [u8],
    pub params: &'a [Int4],
}

// Zig `pub fn deinit(this: *Parse) void { _ = this; }` — no-op, so no `Drop` impl.

impl<'a> Parse<'a> {
    pub fn write_internal<Context>(
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
            + (parameters.len() * size_of::<u32>())
            + z_count(self.name).max(1)
            + z_count(self.query).max(1);

        // Zig: `[_]u8{'P'} ++ toBytes(Int32(count))` — 1 tag byte + 4 length bytes.
        // `std.mem.toBytes` is native-endian raw bytes of the value; `Int32(count)`
        // is the PostgresTypes big-endian wrapper, so the on-wire layout matches.
        let mut header = [0u8; 1 + size_of::<u32>()];
        header[0] = b'P';
        header[1..].copy_from_slice(&Int32::new(count).to_bytes());
        // TODO(port): confirm `Int32::new` + `.to_bytes()` match Zig `Int32()` + `std.mem.toBytes`
        writer.write(&header)?;
        writer.string(self.name)?;
        writer.string(self.query)?;
        writer.short(parameters.len())?;
        for parameter in parameters {
            writer.int4(*parameter)?;
        }
        Ok(())
    }

    // Zig: `pub const write = WriteWrap(@This(), writeInternal).write;`
    // `WriteWrap` is a `fn(comptime T: type, comptime f) type` generic that adapts
    // `write_internal` to the public `write` entry point.
    // TODO(port): express `WriteWrap(@This(), writeInternal).write` once WriteWrap.rs lands
    pub fn write<Context>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, writer, Self::write_internal)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/Parse.zig (45 lines)
//   confidence: medium
//   todos:      3
//   notes:      slice fields borrowed (deinit no-op) so struct carries <'a>; WriteWrap/Int32 shapes assumed
// ──────────────────────────────────────────────────────────────────────────
