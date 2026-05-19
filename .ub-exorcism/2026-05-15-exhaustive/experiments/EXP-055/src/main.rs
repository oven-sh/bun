//! Source-faithful enum/discriminant witness for EXP-055.
//!
//! `build.rs` compiles Bun's vendored `src/jsc/bindings/libuv/uv.h` and checks
//! the C-side `uv_handle_type` values. This file mirrors the current Rust
//! `src/libuv_sys/libuv.rs::HandleType` enum and asserts the same discriminants.
//! Passing means EXP-055 has no current enum-mapping drift evidence.

use core::ffi::c_int;
use core::mem;

#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HandleType {
    Unknown = 0,
    Async = 1,
    Check = 2,
    FsEvent = 3,
    FsPoll = 4,
    Handle = 5,
    Idle = 6,
    NamedPipe = 7,
    Poll = 8,
    Prepare = 9,
    Process = 10,
    Stream = 11,
    Tcp = 12,
    Timer = 13,
    Tty = 14,
    Udp = 15,
    Signal = 16,
    File = 17,
}

type ReturnCode = c_int;
type WriteCb = fn(*mut (), ReturnCode);

const _: () = {
    assert!(HandleType::Unknown as c_int == 0);
    assert!(HandleType::Async as c_int == 1);
    assert!(HandleType::Check as c_int == 2);
    assert!(HandleType::FsEvent as c_int == 3);
    assert!(HandleType::FsPoll as c_int == 4);
    assert!(HandleType::Handle as c_int == 5);
    assert!(HandleType::Idle as c_int == 6);
    assert!(HandleType::NamedPipe as c_int == 7);
    assert!(HandleType::Poll as c_int == 8);
    assert!(HandleType::Prepare as c_int == 9);
    assert!(HandleType::Process as c_int == 10);
    assert!(HandleType::Stream as c_int == 11);
    assert!(HandleType::Tcp as c_int == 12);
    assert!(HandleType::Timer as c_int == 13);
    assert!(HandleType::Tty as c_int == 14);
    assert!(HandleType::Udp as c_int == 15);
    assert!(HandleType::Signal as c_int == 16);
    assert!(HandleType::File as c_int == 17);
    assert!(mem::size_of::<HandleType>() == mem::size_of::<c_int>());

    // Companion hardening for `uv_write_t::write`: Bun stores a Rust function
    // pointer in libuv's `reserved[0]` via `usize` and transmutes it back. This
    // assert proves target-width parity only; it does not make the pattern a
    // recommended long-term ABI design.
    assert!(mem::size_of::<usize>() == mem::size_of::<WriteCb>());
};

fn main() {
    println!("EXP-055 Rust HandleType mirror matched Bun's libuv C header constants");
}
