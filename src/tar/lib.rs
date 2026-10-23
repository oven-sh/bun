//! The tar format, read and written without any I/O.
//!
//! [`Reader`] is a push parser: the caller hands it whatever bytes it has and gets events back, so
//! a source that runs dry is an ordinary state. [`Dialect`] picks between the two ways Bun reads
//! an archive.
//!
//! What is accepted, what is written and how errors are worded follow libarchive, which Bun used
//! before, and parts of this crate are derived from its tar reader and pax writer (BSD-2-Clause,
//! see LICENSE.md).
#![forbid(unsafe_code)]
#![warn(unused_must_use)]

pub mod compose;
pub mod decoder;
pub mod error;
pub mod gzip;
mod header;
mod num;
pub mod reader;
pub mod writer;

pub use decoder::{Decoder, MemoryDecoder};
pub use error::{Error, Result};
pub use reader::{Charset, Dialect, Entry, Event, Options, Reader};
