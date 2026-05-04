use crate::postgres::types::int_types::Int32;

// std.mem.toBytes — reinterpret value as its raw byte array.
// TODO(port): narrow error set
#[inline(always)]
const fn to_bytes(v: Int32) -> [u8; 4] {
    // SAFETY: Int32 is #[repr(C)]/#[repr(transparent)] over 4 bytes; this mirrors
    // Zig's `std.mem.toBytes` which is a plain `@bitCast` to `[@sizeOf(T)]u8`.
    // PERF(port): comptime in Zig — const-eval in Rust.
    unsafe { core::mem::transmute::<Int32, [u8; 4]>(v) }
}

// `[_]u8{tag} ++ toBytes(Int32(n))` — Zig comptime array concat.
#[inline(always)]
const fn tag_len(tag: u8, n: i32) -> [u8; 5] {
    let b = to_bytes(Int32(n));
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
    let a = to_bytes(Int32(8));
    let b = to_bytes(Int32(80877103));
    [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]]
};
pub const NO_DATA: [u8; 5] = tag_len(b'n', 4);

pub fn write_query<Context>(
    query: &[u8],
    writer: &mut NewWriter<Context>,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let count: u32 =
        core::mem::size_of::<u32>() as u32 + u32::try_from(query.len()).unwrap() + 1;
    let header: [u8; 5] = {
        // Zig: `Int32(count)` — int_types.Int32 casts to int4=u32, so a u32 arg
        // passes through with no narrowing. Do NOT `as i32` here.
        let b = to_bytes(Int32(count));
        [b'Q', b[0], b[1], b[2], b[3]]
    };
    writer.write(&header)?;
    writer.string(query)?;
    Ok(())
}

pub use crate::postgres::protocol::array_list::ArrayList;
pub use crate::postgres::protocol::backend_key_data::BackendKeyData;
pub use crate::postgres::protocol::command_complete::CommandComplete;
pub use crate::postgres::protocol::copy_data::CopyData;
pub use crate::postgres::protocol::copy_fail::CopyFail;
pub use crate::postgres::protocol::data_row::DataRow;
pub use crate::postgres::protocol::describe::Describe;
pub use crate::postgres::protocol::error_response::ErrorResponse;
pub use crate::postgres::protocol::execute::Execute;
pub use crate::postgres::protocol::field_description::FieldDescription;
pub use crate::postgres::protocol::negotiate_protocol_version::NegotiateProtocolVersion;
pub use crate::postgres::protocol::notice_response::NoticeResponse;
pub use crate::postgres::protocol::notification_response::NotificationResponse;
pub use crate::postgres::protocol::parameter_description::ParameterDescription;
pub use crate::postgres::protocol::parameter_status::ParameterStatus;
pub use crate::postgres::protocol::parse::Parse;
pub use crate::postgres::protocol::password_message::PasswordMessage;
pub use crate::postgres::protocol::ready_for_query::ReadyForQuery;
pub use crate::postgres::protocol::row_description::RowDescription;
pub use crate::postgres::protocol::sasl_initial_response::SASLInitialResponse;
pub use crate::postgres::protocol::sasl_response::SASLResponse;
pub use crate::postgres::protocol::stack_reader::StackReader;
pub use crate::postgres::protocol::startup_message::StartupMessage;
pub use crate::postgres::protocol::authentication::Authentication;
pub use crate::shared::column_identifier::ColumnIdentifier;
pub use crate::postgres::protocol::decoder_wrap::DecoderWrap;
pub use crate::postgres::protocol::field_message::FieldMessage;
pub use crate::postgres::protocol::field_type::FieldType;
pub use crate::postgres::protocol::new_reader::NewReader;
pub use crate::postgres::protocol::new_writer::NewWriter;
pub use crate::postgres::protocol::portal_or_prepared_statement::PortalOrPreparedStatement;
pub use crate::postgres::protocol::write_wrap::WriteWrap;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/PostgresProtocol.zig (62 lines)
//   confidence: medium
//   todos:      1
//   notes:      Int32 is fn(anytype)->[4]u8 over int4=u32 (not an i32 newtype) — to_bytes is identity on its result; const names SCREAMING_SNAKE; whole-file @imports re-exported as ::Name (Phase B may need module aliases)
// ──────────────────────────────────────────────────────────────────────────
