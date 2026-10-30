//! From-scratch rewrite of the `node:http2` native engine (replacing `h2_frame_parser.rs`).
//!
//! Clean-room, spec-organized modules. Build order: wire -> settings -> flow_control -> stream -> connection, then the
//! JSC binding is pointed at this engine and `h2_frame_parser.rs` is removed.

pub(crate) mod connection;
pub(crate) mod flow_control;
pub(crate) mod settings;
pub(crate) mod stream;
pub(crate) mod wire;
