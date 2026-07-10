//! Safe-core uSockets: idiomatic Rust types behind the `extern "C"` shims in `ffi/`.
#![allow(dead_code)]

pub mod connecting;
pub mod dispatch;
pub mod group;
pub mod handler;
pub mod list;
pub mod listen;
pub mod loop_;
pub mod poll;
pub mod socket;
pub mod sys;
pub mod udp;
