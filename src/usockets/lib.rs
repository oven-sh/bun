#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref,
    clippy::too_many_arguments
)]
//! Rust port of uSockets. ABI-compatible with packages/bun-usockets/src/libusockets.h.
//! Every public us_*/bsd_*/sni_* function is #[no_mangle] extern "C" so uWebSockets (C++) keeps linking.

pub mod types;
pub use types::*;

pub mod eventing;
pub use eventing::{us_loop_t, us_poll_t};

pub mod bsd;
pub mod context;
pub mod core;
pub mod fault_inject;
pub mod loop_core;
pub mod quic;
pub mod socket;
pub mod ssl;
pub mod udp;
