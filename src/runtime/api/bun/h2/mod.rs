//! The protocol engine of `node:http2`. `h2_frame_parser.rs` binds it to JS and to the socket.

pub(crate) mod connection;
mod field_checks;
pub(crate) mod outbound_fields;
pub(crate) mod stream;
