//! Native symbols normally provided by Bun's C++ side, shimmed for this crate's
//! `cargo test` binary. Never compiled into the real build.

/// `bun_core::fmt::parse_f64` calls WebKit's parser; the tests here never
/// parse a double, so a whole-buffer `str::parse` stands in for it.
#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    // SAFETY: the caller passes a live `&[u8]` split into pointer and length.
    let buf = unsafe { core::slice::from_raw_parts(bytes, length) };
    let parsed = core::str::from_utf8(buf)
        .ok()
        .and_then(|s| s.parse::<f64>().ok());
    // SAFETY: `counted` points at the caller's `usize` out-parameter.
    unsafe { *counted = if parsed.is_some() { length } else { 0 } };
    parsed.unwrap_or(f64::NAN)
}
