use core::mem::size_of;

use super::new_writer::NewWriter;
use super::z_helpers::z_count;
use crate::postgres::AnyPostgresError;
use crate::postgres::types::int_types::{Int4, int32};

// All three slice fields are borrowed for the lifetime of the write. Most
// protocol message structs avoid lifetime params, but none of Box / &'static /
// raw fit a transient borrow-only message builder, so this struct carries an
// explicit `'a`.
#[derive(Default)]
pub struct Parse<'a> {
    pub name: &'a [u8],
    pub query: &'a [u8],
    pub params: &'a [Int4],
}

impl<'a> Parse<'a> {
    pub fn write_internal<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        let parameters = self.params;
        if parameters.len() > u16::MAX as usize {
            return Err(AnyPostgresError::TooManyParameters);
        }
        let count: usize = size_of::<u32>()
            + size_of::<u16>()
            + std::mem::size_of_val(parameters)
            + z_count(self.name).max(1)
            + z_count(self.query).max(1);

        // 1 tag byte + 4 length bytes; `int32(count)` produces the big-endian
        // on-wire encoding.
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

    pub fn write<Context: super::new_writer::WriterContext>(
        &self,
        writer: &mut NewWriter<Context>,
    ) -> Result<(), AnyPostgresError> {
        self.write_internal(writer)
    }
}
