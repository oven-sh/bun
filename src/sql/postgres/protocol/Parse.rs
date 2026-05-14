use core::mem::size_of;

use super::new_writer::NewWriter;
use super::write_wrap::WriteWrap;
use super::z_helpers::z_count;
use crate::postgres::types::int_types::{Int4, int32};

// PORT NOTE: there is no cleanup to do, so all three slice fields are
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

// No cleanup is required, so no `Drop` impl.

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
            + (parameters.len() * size_of::<u32>())
            + z_count(self.name).max(1)
            + z_count(self.query).max(1);

        // 1 tag byte + 4 length bytes. `int32(count)` returns the big-endian
        // `[u8; 4]` PostgresTypes wrapper, so the on-wire layout is correct.
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

    // Thin wrapper mirroring `WriteWrap` — see src/sql/postgres/protocol/WriteWrap.rs
    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), bun_core::Error> {
        self.write_internal(writer)
    }
}
