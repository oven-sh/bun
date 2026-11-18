//! What the tests in test/js/node/zlib cannot bring about or see: memory that is refused at a given point, buffers of
//! a few bytes or none, the status of each call, and calls that `node:zlib` does not make.
#![feature(core_io_borrowed_buf)]

mod checksums;
mod deflate;
mod inflate;
#[expect(clippy::duplicate_mod, reason = "`run()` goes by the name")]
#[path = "inflate.rs"]
mod inflate_through_window;
#[expect(clippy::duplicate_mod, reason = "`step()` goes by the name")]
#[path = "inflate.rs"]
mod inflate_to_vec;
mod kernels;
mod plain;
mod refusals;
mod samples;
mod writer;
