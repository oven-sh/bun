use core::mem::size_of;

use super::new_writer::NewWriter;
use super::z_helpers::z_field_count;
use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::{int4, int32};
use crate::shared::Data;

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
            options: Data::Empty,
        }
    }
}

impl StartupMessage {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let user = self.user.slice();
        let database = self.database.slice();
        let options = self.options.slice();
        let count: usize = size_of::<int4>()
            + size_of::<int4>()
            + z_field_count(b"user", user)
            + z_field_count(b"database", database)
            + z_field_count(b"client_encoding", b"UTF8")
            + z_field_count(b"DateStyle", b"ISO, MDY")
            + options.len()
            + 1;

        let header = int32(count as u32);
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
        // Pin the session DateStyle so date/timestamp text is always ISO
        // regardless of postgresql.conf / ALTER DATABASE / ALTER ROLE defaults.
        // A startup-packet parameter outranks every server-side default (GUC
        // source PGC_S_CLIENT), so this is the same guarantee node-postgres and
        // postgres.js rely on. Without it a `SQL, DMY` default makes the server
        // emit `03/04/2026`, which JS Date.parse reads as 4 March.
        writer.string(b"DateStyle")?;
        writer.string(b"ISO, MDY")?;
        if !options.is_empty() {
            writer.write(options)?;
        }
        writer.write(&[0u8])?;
        Ok(())
    }
}
