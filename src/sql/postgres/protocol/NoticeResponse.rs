/// NoticeResponse has the same wire format as ErrorResponse — a length-prefixed
/// list of field messages — so it reuses the same type and decoder.
pub type NoticeResponse = crate::postgres::protocol::error_response::ErrorResponse;
