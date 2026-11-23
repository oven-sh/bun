//! Symbols that the rest of Bun provides, for this crate's `cargo test` binary.

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_dump_stack_trace(
    _first_address: Option<usize>,
    _limits: bun_core::DumpStackTraceOptions,
) {
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize {
    // SAFETY: `bun_highway` passes a slice.
    let haystack = unsafe { core::slice::from_raw_parts(haystack, len) };
    haystack.iter().position(|&it| it == needle).unwrap_or(len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_char(
    haystack: *const u8,
    len: usize,
    needle: u8,
) -> usize {
    // SAFETY: `bun_highway` passes a slice.
    let haystack = unsafe { core::slice::from_raw_parts(haystack, len) };
    haystack.iter().rposition(|&it| it == needle).unwrap_or(len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_memrmem16(
    haystack: *const u16,
    len: usize,
    needle: *const u16,
    needle_len: usize,
) -> usize {
    // SAFETY: `bun_highway` passes two slices.
    let (haystack, needle) = unsafe {
        (
            core::slice::from_raw_parts(haystack, len),
            core::slice::from_raw_parts(needle, needle_len),
        )
    };
    (0..len)
        .rfind(|&start| haystack[start..].starts_with(needle))
        .unwrap_or(usize::MAX)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_last_index_of_slash(path: *const u8, len: usize) -> usize {
    // SAFETY: `bun_highway` passes a slice.
    unsafe { highway_last_index_of_char(path, len, b'/') }
}
