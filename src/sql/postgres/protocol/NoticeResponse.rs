/// NoticeResponse has the same wire format as ErrorResponse — a length-prefixed
/// list of field messages — so it reuses the same type. Notices decode via
/// `decode_notice_internal`, which tolerates a declared length below 4
/// (decoding as empty) where `ErrorResponse` fails.
pub type NoticeResponse = crate::postgres::protocol::error_response::ErrorResponse;
