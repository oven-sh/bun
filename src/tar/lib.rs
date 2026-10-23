//! The tar format, read and written without any I/O.
//!
//! [`Reader`] is a push parser: the caller hands it whatever bytes it has and gets events back, so
//! a source that runs dry is an ordinary state. [`Dialect`] picks between the two ways Bun reads
//! an archive.
#![forbid(unsafe_code)]
#![warn(unused_must_use)]

pub mod error;
mod header;
mod num;
pub mod reader;

pub use error::{Error, Result};
pub use reader::{Charset, Dialect, Entry, Event, Options, Reader};

pub const BLOCK_SIZE: usize = 512;
