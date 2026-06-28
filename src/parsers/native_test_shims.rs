//! Native symbols normally provided by Bun's C++ side, shimmed for the
//! `cargo test` / `cargo bench` binaries of this crate (which link only the
//! small support archive built by `scripts/bench-json-rust.sh`: mimalloc,
//! simdutf, highway). These three are either trivial or never hot here, so
//! they are defined in Rust rather than dragging in WTF/JSC.
//!
//! Only ever compiled into test/bench binaries (`#[cfg(test)]` in `lib.rs`
//! and `#[path]`-included by the benches) — never into the real build, where
//! the real definitions exist.

/// `StackCheck` upper bound. The real implementation returns the thread's
/// actual stack end (via WTF); here we conservatively claim it ends 512 KiB
/// below the caller's frame — Rust test threads only get a 2 MiB stack.
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

/// Scalar stand-in for the highway kernel the old lexer used (only reached
/// for strings >= 4 KiB). Same result contract as the real one.
#[unsafe(no_mangle)]
extern "C" fn highway_index_of_interesting_character_in_string_literal(
    text: *const u8,
    text_len: usize,
    quote: u8,
) -> usize {
    // SAFETY: callers pass a valid (ptr, len) readable range.
    let s = unsafe { core::slice::from_raw_parts(text, text_len) };
    s.iter()
        .position(|&c| c == quote || c == b'\\' || c < 0x20 || c > 0x7e)
        .unwrap_or(text_len)
}
