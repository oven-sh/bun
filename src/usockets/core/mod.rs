//! Safe-core uSockets: idiomatic Rust types behind the `extern "C"` shims in `ffi/`.
#![allow(dead_code)]

pub mod list;
pub mod sys;
pub mod poll;
pub mod socket;
pub mod group;
pub mod connecting;
pub mod listen;
pub mod udp;
pub mod loop_;
pub mod dispatch;
pub mod handler;
