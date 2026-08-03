//! Native symbols normally provided by Bun's C++ side, shimmed for this crate's
//! `cargo test` / `cargo bench` binaries. Never compiled into the real build.

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    (approx_sp.saturating_sub(512 * 1024)) as *mut core::ffi::c_void
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    let h = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    h.iter().position(|&c| c == needle).unwrap_or(haystack_len)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_any_char(
    text: *const u8,
    text_len: usize,
    chars: *const u8,
    chars_len: usize,
) -> usize {
    let (t, cs) = unsafe {
        (
            core::slice::from_raw_parts(text, text_len),
            core::slice::from_raw_parts(chars, chars_len),
        )
    };
    t.iter().position(|c| cs.contains(c)).unwrap_or(text_len)
}
