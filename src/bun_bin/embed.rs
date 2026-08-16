//! The C API for hosting Bun inside another program —
//! `packages/bun-embed/bun_embed.h`. Exported by `libbun`, the shared
//! library `scripts/build/shared-lib.ts` links from the executable's objects
//! (`bun run build --target=libbun`).
//!
//! `bun_embed_run` is [`main`](crate::main) on the caller's thread: the same
//! init sequence, the same CLI. What differs is the end of the run. The
//! process is the host's, so `Global::exit` must not end it; instead the
//! main VM's `Run::start` returns to the host once the script is done
//! (`VirtualMachine::global_exit_embedded`), and a `process.exit()` under it
//! becomes a termination request the loop observes
//! (`VirtualMachine::request_embedded_exit`). Whatever still reaches
//! `Global::exit` — a subcommand with no event loop, an early CLI error —
//! reports its code through the host's `on_exit` callback and parks the
//! thread (`Global::embedded_park`), because those stacks have no way back.
//!
//! One run per process: argv, the CLI arena and log, the main-thread VM
//! slot and JSC's own process state are all written once, on the assumption
//! that the process ends with the run.

use core::ffi::{CStr, c_char, c_int, c_void};
use core::sync::atomic::{AtomicU8, Ordering};
use std::ffi::CString;

use bun_core::Global;

const IDLE: u8 = 0;
const STARTED: u8 = 1;
static STATE: AtomicU8 = AtomicU8::new(IDLE);

/// # Safety
/// `argv` points to `argc` NUL-terminated strings and `envp`, when non-null,
/// to a NUL-terminated array of them; all only need to live for the call.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn bun_embed_run(
    argc: c_int,
    argv: *const *const c_char,
    envp: *const *const c_char,
    on_exit: Option<Global::EmbedExitFn>,
    user: *mut c_void,
) -> c_int {
    if STATE
        .compare_exchange(IDLE, STARTED, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return -1;
    }

    // Bun keeps borrowing argv for the rest of the process (`bun_core::argv`,
    // `process.argv`); the caller's array is only good for the call.
    let argc = usize::try_from(argc).unwrap_or(0);
    let owned: Vec<CString> = (0..argc)
        // SAFETY: fn contract.
        .map(|i| unsafe { CStr::from_ptr(*argv.add(i)) }.to_owned())
        .collect();
    let mut ptrs: Vec<*const c_char> = owned.iter().map(|s| s.as_ptr()).collect();
    ptrs.push(core::ptr::null());
    let ptrs = Box::leak(ptrs.into_boxed_slice());
    Box::leak(owned.into_boxed_slice());

    if !envp.is_null() {
        let mut p = envp;
        // SAFETY: fn contract — NUL-terminated array of C strings.
        while let Some(entry) = unsafe { (*p).as_ref() } {
            // SAFETY: as above.
            let bytes = unsafe { CStr::from_ptr(entry) }.to_bytes();
            if let Some(eq) = bytes.iter().position(|&b| b == b'=') {
                set_env(&bytes[..eq], &bytes[eq + 1..]);
            }
            // SAFETY: as above.
            p = unsafe { p.add(1) };
        }
    }

    Global::enter_embedded_mode(on_exit, user);
    // SAFETY: `ptrs` is a leaked NUL-terminated argv of process lifetime.
    unsafe { crate::start(argc as c_int, ptrs.as_ptr()) };
    // The command returned on its own (a run that ended through
    // `Global::exit` reported itself and never gets here).
    Global::finish_embedded_run(0);
    Global::embedded_exit_code()
}

fn set_env(key: &[u8], value: &[u8]) {
    #[cfg(unix)]
    let (key, value) = {
        use std::os::unix::ffi::OsStrExt;
        (
            std::ffi::OsStr::from_bytes(key),
            std::ffi::OsStr::from_bytes(value),
        )
    };
    #[cfg(not(unix))]
    let (key, value) = (String::from_utf8_lossy(key), String::from_utf8_lossy(value));
    if key.is_empty() {
        return;
    }
    // SAFETY: before Bun starts, on the only thread that has entered it.
    unsafe { std::env::set_var(key, value) };
}

/// Thread-safe; see `bun_runtime::node::process::request_exit_from_host`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn bun_embed_request_exit(code: c_int) {
    bun_runtime::node::process::request_exit_from_host(code);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn bun_embed_version() -> *const c_char {
    Global::package_json_version_z.as_ptr()
}
