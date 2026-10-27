#![allow(non_camel_case_types)]

use crate::postgres::AnyPostgresError;

pub type int4 = u32;
pub type Int4 = int4;
pub(crate) type PostgresInt32 = int4;
pub type int8 = i64;
pub(crate) type PostgresInt64 = int8;
pub type short = u16;
pub(crate) type PostgresShort = u16;

/// The length of a message or of a parameter, as the Int32 that goes on the wire.
pub(crate) fn int32(length: usize) -> Result<[u8; 4], AnyPostgresError> {
    if length > i32::MAX as usize {
        bun_core::hint::cold();
        return Err(AnyPostgresError::InvalidMessageLength);
    }
    Ok((length as int4).to_be_bytes())
}
