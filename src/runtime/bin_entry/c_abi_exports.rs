//! C-ABI entry points that belong to the final binary rather than any
//! library crate: the process-level panic hook and the OOM crash handler.
//!
//! Everything else that used to live here has a real home in `bun_jsc` /
//! `bun_runtime` and is exported via `generate-host-exports.ts`.

/// Panic entry point for C/C++ callers (`bindings.cpp`, `bun-usockets`).
/// Routes through `bun_core::output::panic` so the crash report matches
/// Rust-originated panics.
#[unsafe(no_mangle)]
extern "C" fn Bun__panic(msg: *const u8, len: usize) -> ! {
    let bytes = if msg.is_null() {
        &b""[..]
    } else {
        // SAFETY: `msg` is non-null (checked above) and the C++ caller
        // guarantees it is valid for reading `len` bytes for this call.
        unsafe { core::slice::from_raw_parts(msg, len) }
    };
    bun_core::output::panic(format_args!("{}", bstr::BStr::new(bytes)));
}

/// Out-of-memory entry point for C callers (bun-usockets) that cannot
/// propagate an allocation failure. Same crash report as `handle_oom`.
#[unsafe(no_mangle)]
extern "C" fn Bun__outOfMemory() -> ! {
    bun_core::out_of_memory()
}

/// Called by `uWS::Loop::create` when it can't create a thread's event loop.
/// Running out of file descriptors isn't a bug in Bun, so print an error instead of a crash report.
#[cfg(unix)]
#[unsafe(no_mangle)]
extern "C" fn Bun__loopInitFailed(err: core::ffi::c_int) -> ! {
    match err {
        libc::EMFILE => bun_crash_handler::handle_root_error("ProcessFdQuotaExceeded"),
        libc::ENFILE => bun_crash_handler::handle_root_error("SystemFdQuotaExceeded"),
        _ => bun_core::output::panic(format_args!("failed to create the event loop: errno {err}")),
    }
}

/// Replaces the one of libc for the C and C++ in this executable.
///
/// # Safety
/// Each pointer is valid for reading its length, and nothing writes there meanwhile.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
#[unsafe(no_mangle)]
// An import by ThinLTO brings rustc's `RtLibUseGOT` flag (x64 Linux) into the caller's module, whose functions then stop folding with their twins.
#[inline(never)]
unsafe extern "C" fn memmem(
    haystack: *const u8,
    haystack_len: usize,
    needle: *const u8,
    needle_len: usize,
) -> *const u8 {
    use bun_core::ffi::slice;
    // SAFETY: the caller's.
    let (text, needle) = unsafe { (slice(haystack, haystack_len), slice(needle, needle_len)) };
    let found = bun_core::strings::memmem(text, needle);
    found.map_or(core::ptr::null(), |at| haystack.wrapping_add(at))
}
