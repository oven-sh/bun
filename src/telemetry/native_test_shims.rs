//! Native symbols normally provided by Bun's C++ side, shimmed for this crate's
//! `cargo test` binary. Never compiled into the real build.
#![allow(clippy::missing_safety_doc)]

#[path = "../parsers/native_test_shims.rs"]
mod shared;

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_decode_hex8(
    input: *const u8,
    output: *mut u8,
    out_len: usize,
) -> usize {
    let hx = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    for i in 0..out_len {
        // SAFETY: caller guarantees 2*out_len input bytes and out_len output bytes.
        let (a, b) = unsafe { (*input.add(2 * i), *input.add(2 * i + 1)) };
        match (hx(a), hx(b)) {
            // SAFETY: as above.
            (Some(a), Some(b)) => unsafe { *output.add(i) = a << 4 | b },
            _ => return i,
        }
    }
    out_len
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(
    input: *const u8,
    length: usize,
    output: *mut u8,
    _is_urlsafe: core::ffi::c_int,
) -> usize {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    // SAFETY: caller passes a valid input slice and an output of encode_len bytes.
    let src = unsafe { core::slice::from_raw_parts(input, length) };
    let mut o = 0;
    let mut put = |c: u8| {
        // SAFETY: as above.
        unsafe { *output.add(o) = c };
        o += 1;
    };
    for chunk in src.chunks(3) {
        let v = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        put(T[(v >> 18) as usize]);
        put(T[(v >> 12 & 63) as usize]);
        put(if chunk.len() > 1 {
            T[(v >> 6 & 63) as usize]
        } else {
            b'='
        });
        put(if chunk.len() > 2 {
            T[(v & 63) as usize]
        } else {
            b'='
        });
    }
    o
}

#[unsafe(no_mangle)]
extern "C" fn simdutf__base64_length_from_binary(
    length: usize,
    _options: core::ffi::c_int,
) -> usize {
    length.div_ceil(3) * 4
}
