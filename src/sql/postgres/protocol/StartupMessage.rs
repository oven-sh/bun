use core::mem::size_of;

use crate::shared::Data;
use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;
use super::z_helpers::z_field_count;
use crate::postgres::types::int_types::{Int32, int4};

pub struct StartupMessage {
    pub user: Data,
    pub database: Data,
    pub options: Data,
}

impl Default for StartupMessage {
    fn default() -> Self {
        Self {
            user: Data::default(),
            database: Data::default(),
            options: Data::empty(),
        }
    }
}

impl StartupMessage {
    // TODO(port): narrow error set
    pub fn write_internal<Context>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        let user = self.user.slice();
        let database = self.database.slice();
        let options = self.options.slice();
        let count: usize = size_of::<int4>()
            + size_of::<int4>()
            + z_field_count(b"user", user)
            + z_field_count(b"database", database)
            + z_field_count(b"client_encoding", b"UTF8")
            + options.len()
            + 1;

        let header = Int32::new(count as u32).to_bytes();
        writer.write(&header)?;
        writer.int4(196608)?;

        writer.string(b"user")?;
        if !user.is_empty() {
            writer.string(user)?;
        }

        writer.string(b"database")?;

        if database.is_empty() {
            // The database to connect to. Defaults to the user name.
            writer.string(user)?;
        } else {
            writer.string(database)?;
        }
        writer.string(b"client_encoding")?;
        writer.string(b"UTF8")?;
        if !options.is_empty() {
            writer.write(options)?;
        }
        writer.write(&[0u8])?;
        Ok(())
    }

    // TODO(port): `pub const write = WriteWrap(@This(), writeInternal).write;` —
    // WriteWrap is a comptime type-generator that wraps write_internal. Phase B
    // should express this as a trait impl or macro on WriteWrap.
    pub fn write<Context>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        WriteWrap::write(self, writer, Self::write_internal)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/StartupMessage.zig (50 lines)
//   confidence: medium
//   todos:      2
//   notes:      WriteWrap comptime wrapper needs trait/macro; Int32::to_bytes() assumed (was std.mem.toBytes)
// ──────────────────────────────────────────────────────────────────────────
