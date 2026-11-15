#![allow(non_snake_case)]
#![warn(unused_must_use)]
#![feature(core_io_borrowed_buf)]

pub mod error;
pub use error::{Error, Result};

pub mod fetch_enums_jsc;
pub(crate) mod generated_bindgen;
pub mod method_jsc;

pub mod headers_jsc;

pub mod websocket_client;
