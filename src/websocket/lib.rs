//! The WebSocket protocol (RFC 6455, RFC 7692), apart from sockets.

#![forbid(unsafe_code)]

pub mod deflate;
pub mod frame;
pub mod handshake;
pub mod reader;
pub mod topics;
