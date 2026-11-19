pub(crate) mod crypto;
pub(crate) mod keys;
pub(crate) mod messages;
pub(crate) mod network;
pub(crate) mod paths;
pub(crate) mod peer;
pub(crate) mod raw;
pub(crate) mod setup;
pub(crate) mod tls;
pub(crate) mod wire;

use std::net::SocketAddr;

use bun_quic::http3::Priority;
use bun_quic::{Config, FieldLimits, Http3Config, Side};

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_byte_set.cpp, which test/js/bun/util/highway-strings.test.ts covers.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    [rows, columns]: &[[u8; 16]; 2],
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter()
        .take_while(|&&byte| rows[usize::from(byte >> 4)] & columns[usize::from(byte & 15)] != 0)
        .count()
}

/// Stands in for highway_strings.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, byte: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&other| other != byte).count()
}

pub(crate) fn address(side: Side) -> SocketAddr {
    ["192.0.2.1:1000", "198.51.100.1:443"][side as usize]
        .parse()
        .unwrap()
}

pub(crate) fn http3(config: &mut Config) {
    let limits = |size, count| FieldLimits { size, count };
    config.http3 = Some(Http3Config {
        kept_fields: limits(1000, 10),
        tolerated_fields: limits(2000, 20),
        field_overhead: 32,
        ..Default::default()
    });
}

pub(crate) fn priority(urgency: u8, is_incremental: bool) -> Priority {
    Priority {
        urgency,
        is_incremental,
    }
}
