#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

pub mod fetch_enums_jsc;
pub mod method_jsc;

pub mod headers_jsc;

pub mod websocket_client;
