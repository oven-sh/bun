/// NoticeResponse has the same wire format as ErrorResponse — a length-prefixed
/// list of field messages — so it reuses the same type and decode logic.
/// (Deviation from the Zig reference: a message length below 4 now fails with
/// `InvalidMessageLength` here too, instead of silently decoding as empty.)
pub type NoticeResponse = crate::postgres::protocol::error_response::ErrorResponse;
