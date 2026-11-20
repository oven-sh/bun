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
