//! Native symbols normally provided by Bun's C++ side, shimmed for this crate's
//! `cargo test` binary. Never compiled into the real build.
#![allow(clippy::missing_safety_doc)]

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: caller passes a valid slice.
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().position(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: caller passes a valid slice.
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().rposition(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> *const u8 {
    // SAFETY: caller passes valid slices.
    let (h, n) = unsafe {
        (
            core::slice::from_raw_parts(haystack, haystack_len),
            core::slice::from_raw_parts(needle, needle_len),
        )
    };
    if n.is_empty() {
        return haystack;
    }
    if h.len() < n.len() {
        return core::ptr::null();
    }
    match (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()] == *n) {
        // SAFETY: i is in bounds.
        Some(i) => unsafe { haystack.add(i) },
        None => core::ptr::null(),
    }
}

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
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}
