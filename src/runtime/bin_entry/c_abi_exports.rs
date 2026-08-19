//! C-ABI entry points that belong to the final binary rather than any
//! library crate: the process-level panic hook and the fatal-exit hooks.
//!
//! Everything else that used to live here has a real home in `bun_jsc` /
//! `bun_runtime` and is exported via `generate-host-exports.ts`.

#![allow(non_snake_case, clippy::missing_safety_doc)]

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

/// Exit for bun-usockets when `us_create_loop` cannot get a descriptor.
/// `syscall_name` must be NUL-terminated.
#[cfg(unix)]
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__loopInitFailed(
    syscall_name: *const core::ffi::c_char,
    err: core::ffi::c_int,
) -> ! {
    use bun_sys::{E, SystemErrno};

    let errno = SystemErrno::init(i64::from(err));
    if let Some(errno @ (E::EMFILE | E::ENFILE)) = errno {
        bun_crash_handler::handle_root_error(errno, None);
    }
    // SAFETY: the caller passes a NUL-terminated string literal.
    let syscall_name =
        bstr::BStr::new(unsafe { core::ffi::CStr::from_ptr(syscall_name) }.to_bytes());
    match errno {
        Some(errno) => bun_core::output::panic(format_args!(
            "{syscall_name}() failed while creating the event loop: {errno}"
        )),
        None => bun_core::output::panic(format_args!(
            "{syscall_name}() failed while creating the event loop: errno {err}"
        )),
    }
}
