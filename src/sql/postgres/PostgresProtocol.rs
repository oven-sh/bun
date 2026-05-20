use crate::postgres::types::int_types::int4;

// `std.mem.toBytes(Int32(n))` — Zig's `Int32` casts `n` to `int4` (u32) and
// `@byteSwap`s it to network order; `toBytes` then bit-casts to `[4]u8`. The net
// result is just the big-endian byte representation of `n`.
#[inline(always)]
const fn to_bytes(n: int4) -> [u8; 4] {
    n.to_be_bytes()
}

// `[_]u8{tag} ++ toBytes(Int32(n))` — Zig comptime array concat.
#[inline(always)]
const fn tag_len(tag: u8, n: int4) -> [u8; 5] {
    let b = to_bytes(n);
    [tag, b[0], b[1], b[2], b[3]]
}

pub const CLOSE_COMPLETE: [u8; 5] = tag_len(b'3', 4);
pub const EMPTY_QUERY_RESPONSE: [u8; 5] = tag_len(b'I', 4);
pub const TERMINATE: [u8; 5] = tag_len(b'X', 4);

pub const BIND_COMPLETE: [u8; 5] = tag_len(b'2', 4);

pub const PARSE_COMPLETE: [u8; 5] = tag_len(b'1', 4);

pub const COPY_DONE: [u8; 5] = tag_len(b'c', 4);
pub const SYNC: [u8; 5] = tag_len(b'S', 4);
pub const FLUSH: [u8; 5] = tag_len(b'H', 4);
pub const SSL_REQUEST: [u8; 8] = {
    let a = to_bytes(8);
    let b = to_bytes(80877103);
    [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]]
};
pub const NO_DATA: [u8; 5] = tag_len(b'n', 4);

pub fn write_query<Context: WriterContext>(
    query: &[u8],
    writer: &mut NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let count: u32 =
        core::mem::size_of::<u32>() as u32 + u32::try_from(query.len()).expect("int cast") + 1;
    let header: [u8; 5] = {
        let b = to_bytes(count);
        [b'Q', b[0], b[1], b[2], b[3]]
    };
    writer.write(&header)?;
    writer.string(query)?;
    Ok(())
}

pub use crate::postgres::protocol::array_list::ArrayList;
pub use crate::postgres::protocol::authentication::Authentication;
pub use crate::postgres::protocol::backend_key_data::BackendKeyData;
pub use crate::postgres::protocol::close::Close;
pub use crate::postgres::protocol::command_complete::CommandComplete;
pub use crate::postgres::protocol::copy_data::CopyData;
pub use crate::postgres::protocol::copy_fail::CopyFail;
pub use crate::postgres::protocol::data_row as DataRow;
pub use crate::postgres::protocol::decoder_wrap::DecoderWrap;
pub use crate::postgres::protocol::describe::Describe;
pub use crate::postgres::protocol::error_response::ErrorResponse;
pub use crate::postgres::protocol::execute::Execute;
pub use crate::postgres::protocol::field_description::FieldDescription;
pub use crate::postgres::protocol::field_message::FieldMessage;
pub use crate::postgres::protocol::field_type::FieldType;
pub use crate::postgres::protocol::negotiate_protocol_version::NegotiateProtocolVersion;
pub use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
pub use crate::postgres::protocol::new_writer::{NewWriter, WriterContext};
pub use crate::postgres::protocol::notice_response::NoticeResponse;
pub use crate::postgres::protocol::notification_response::NotificationResponse;
pub use crate::postgres::protocol::parameter_description::ParameterDescription;
pub use crate::postgres::protocol::parameter_status::ParameterStatus;
pub use crate::postgres::protocol::parse::Parse;
pub use crate::postgres::protocol::password_message::PasswordMessage;
pub use crate::postgres::protocol::portal_or_prepared_statement::PortalOrPreparedStatement;
pub use crate::postgres::protocol::ready_for_query::ReadyForQuery;
pub use crate::postgres::protocol::row_description::RowDescription;
pub use crate::postgres::protocol::sasl_initial_response::SASLInitialResponse;
pub use crate::postgres::protocol::sasl_response::SASLResponse;
pub use crate::postgres::protocol::stack_reader::StackReader;
pub use crate::postgres::protocol::startup_message::StartupMessage;
pub use crate::postgres::protocol::write_wrap::WriteWrap;
pub use crate::shared::column_identifier::ColumnIdentifier;

// ported from: src/sql/postgres/PostgresProtocol.zig
