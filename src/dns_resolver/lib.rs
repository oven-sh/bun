// Portions of this crate are derived from c-ares, under the MIT License:
//
// Copyright (c) 1998 Massachusetts Institute of Technology
// Copyright (c) 2007 - 2023 Daniel Stenberg with many contributors, see AUTHORS
// file.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice (including the next
// paragraph) shall be included in all copies or substantial portions of the
// Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

//! A stub DNS resolver without I/O of its own. Behaves as c-ares 1.34.9 with
//! `ARES_FLAG_NOCHECKRESP` and otherwise default options.
#![forbid(unsafe_code)]
// Answers come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

pub mod addr_info;
mod channel;
mod error;
mod hosts;
pub mod io;
mod lookup;
mod message;
mod reader;
pub mod reply;
pub mod simulation;
mod system_config;
mod text;

pub use channel::{Answer, Channel, Completion, Options, ServerConfig, Token};
pub use error::{Error, Result};
pub use lookup::{Host, NameInfo};
