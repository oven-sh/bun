//! From-scratch rewrite of the `node:http2` native engine (replacing `h2_frame_parser.rs`).
//!
//! Clean-room, spec-organized modules. HPACK is the only piece reused (lshpack via `bun_http`).
//! Build order: wire -> settings -> flow_control -> hpack -> stream -> connection, then the
//! JSC binding is pointed at this engine and `h2_frame_parser.rs` is removed.

pub mod connection;
pub mod flow_control;
pub mod hpack;
pub mod settings;
pub mod stream;
pub mod wire;
