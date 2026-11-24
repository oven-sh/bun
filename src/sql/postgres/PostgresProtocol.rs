use crate::postgres::types::int_types::int4;

// The big-endian (network-order) byte representation of `n`.
#[inline(always)]
const fn to_bytes(n: int4) -> [u8; 4] {
    n.to_be_bytes()
}

#[inline(always)]
const fn tag_len(tag: u8, n: int4) -> [u8; 5] {
    let b = to_bytes(n);
    [tag, b[0], b[1], b[2], b[3]]
}

pub const CLOSE_COMPLETE: [u8; 5] = tag_len(b'3', 4);
pub const EMPTY_QUERY_RESPONSE: [u8; 5] = tag_len(b'I', 4);

pub const BIND_COMPLETE: [u8; 5] = tag_len(b'2', 4);

pub const PARSE_COMPLETE: [u8; 5] = tag_len(b'1', 4);

pub const NO_DATA: [u8; 5] = tag_len(b'n', 4);

pub use crate::postgres::protocol::backend_key_data::BackendKeyData;
pub use crate::postgres::protocol::command_complete::CommandComplete;
pub use crate::postgres::protocol::data_row as DataRow;
pub use crate::postgres::protocol::error_response::ErrorResponse;
pub use crate::postgres::protocol::field_description::FieldDescription;
pub use crate::postgres::protocol::new_reader::NewReader;
pub use crate::postgres::protocol::notice_response::NoticeResponse;
pub use crate::postgres::protocol::notification_response::NotificationResponse;
pub use crate::postgres::protocol::parameter_description::ParameterDescription;
pub use crate::postgres::protocol::parameter_status::ParameterStatus;
pub use crate::postgres::protocol::ready_for_query::ReadyForQuery;
pub use crate::postgres::protocol::row_description::RowDescription;
