//! `libbun_rust.a` — the Rust-port staticlib.
//!
//! Built by `cargo build -p bun_bin` (emitted from `scripts/build/rust.ts`)
//! and linked into the final `bun-debug` executable by ninja's link step,
//! occupying the slot `bun-zig.o` used to. The clang++ driver supplies the
//! C runtime startup (`_start` → `main`); `main` below is the process entry.
//!
//! Init order mirrors `src/main.zig`:
//!   1. crash handler / signal masks
//!   2. allocator wiring (mimalloc as `#[global_allocator]`)
//!   3. argv / start-time capture
//!   4. `Output.Source.Stdio.init()` — stdout/stderr writers
//!   5. `StackCheck.configureThread()`
//!   6. `cli::Cli::start()` → `Global::exit(0)`
//!
//! ## Layout
//!
//! `main()`'s callee chain — the C-ABI leaves (`bun_initialize_process`,
//! `bun_warn_avx_missing`, the `__wrap_*` shims, …) plus `cli::Cli::start`
//! and everything `bun run` reaches under it — sits on the cold-start
//! critical path: each call can fault a fresh page run. A
//! `--symbol-ordering-file` 2-pass relink that clustered these onto shared
//! pages was tried and dropped (the second link wasn't worth it over the
//! monolithic `.text` lld emits by default — see the `-z
//! keep-text-section-prefix` note in `scripts/build/flags.ts`).
//!
//! What still matters at the source level: keep cold-only code off these
//! pages. Subcommand bodies never reached by `bun run` (`bun install`,
//! `bun create`, the bundler/test-runner entry points) and the panic /
//! crash-report path are tagged `#[cold]` so LLVM sinks them to the tail of
//! their translation unit's `.text` instead of interleaving with the
//! startup chain.

#![warn(unused_must_use)]

use core::ffi::{c_char, c_int};

mod phase_c_exports;

// Force-link `bun_platform` so its `#[no_mangle]` C exports
// (`sys_epoll_pwait2`, `ioctl_ficlone`, …) reach the linker.
use bun_platform as _;

use bun_core::Global;
use bun_core::StackCheck;
use bun_core::output;

/// mimalloc as the process allocator — matches Zig's `bun.default_allocator`
/// and the `uv_replace_allocator(mi_*)` call in `main.zig` on Windows.
#[cfg(not(bun_asan))]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

/// Under ASAN, use the system allocator so the interceptor sees every allocation.
#[cfg(bun_asan)]
#[global_allocator]
static ALLOC: std::alloc::System = std::alloc::System;

#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
pub extern "C" fn __asan_default_options() -> *const core::ffi::c_char {
    c"detect_stack_use_after_return=0:detect_leaks=0".as_ptr()
}

#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
pub extern "C" fn __lsan_default_suppressions() -> *const core::ffi::c_char {
    concat!(
        // Rust std false positive — a detached thread's `Arc<thread::Inner>`
        // is held by the OS thread's TLS, which LSan does not scan as a root.
        "leak:std::thread::thread::Thread>::new\n",
        "leak:bun_runtime::node::fs_events::init_core_foundation\n",
        "leak:bun_runtime::node::fs_events::init_core_services\n",
        "leak:bun_runtime::node::fs_events::FSEventsLoop\n",
        "leak:bun_jsc::debugger::Debugger>::start_js_debugger_thread\n",
        "\0",
    )
    .as_ptr()
    .cast()
}

/// Process entry point. `extern "C"` so the linker resolves crt1.o's
/// undefined `main` against this symbol — same role as Zig's `pub fn main`.
///
/// `argc`/`argv` are forwarded to `bun_core::init_argv` immediately: on
/// glibc/macOS/Windows libstd also captures them via a `.init_array` hook /
/// `_NSGetArgv` / `GetCommandLineW`, but on **musl** static builds that hook
/// receives no arguments (musl's `__libc_start_main` does not pass
/// `(argc,argv,envp)` to constructors), so `std::env::args_os()` returns
/// empty and the binary would see argc=0. Capturing the C-runtime-provided
/// pair here is the only portable source — same contract as Zig's
/// `bun.initArgv` wrapping `std.os.argv`.
///
/// # Safety
/// `argv` must point to `argc` valid NUL-terminated C strings that live for
/// the entire process — guaranteed by the C runtime that calls this symbol.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn main(argc: c_int, argv: *const *const c_char) -> c_int {
    // 0. Capture argv FIRST — before the crash handler, whose panic path
    //    dumps the command line via `bun_core::argv()`.
    //    SAFETY: `argc`/`argv` come from the C runtime; the argv block lives
    //    for the entire process.
    unsafe { bun_core::init_argv(argc, argv) };

    // 1. Crash handler first so anything below gets a usable trace.
    bun_crash_handler::init();

    // SIGPIPE/SIGXFSZ → SIG_IGN, like main.zig's posix block.
    // SAFETY: `SIGPIPE`/`SIGXFSZ` are valid signal numbers and `SIG_IGN` is a
    // valid disposition; called once on the main thread before any other
    // thread is spawned, so there is no concurrent sigaction.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
    }

    #[cfg(windows)]
    {
        // SAFETY: mimalloc fns match the libuv allocator signatures; called
        // exactly once before any uv handle is created.
        unsafe {
            let _ = bun_sys::windows::libuv::uv_replace_allocator(
                Some(bun_alloc::mimalloc::mi_malloc),
                Some(bun_alloc::mimalloc::mi_realloc),
                Some(bun_alloc::mimalloc::mi_calloc),
                Some(bun_alloc::mimalloc::mi_free),
            );
        }
        // `bun.handleOom(convertEnvToWTF8())` — converts the OS UTF-16 env
        // block to WTF-8 and publishes it via `bun_core::os::set_environ()`.
        // Without this, `Bun.env`/`process.env` see only `.env`-file vars.
        bun_core::handle_oom(bun_sys::windows::env::convert_env_to_wtf8());
    }

    // 2/3. Allocator is static above; argv was captured at step 0; start_time
    //      is lazy in `bun_core::start_time()`.

    // 4. Stdio + Output sink. `bun_core::OutputSink[Sys]` is link-time provided
    //    by `bun_sys`; `stdio::init()` calls C's `bun_initialize_process()` and
    //    wires stdout/stderr `Source`s.
    output::stdio::init();
    let _flush = output::flush_guard();

    // main.zig: `bun_warn_avx_missing(...)` — x86_64 + SIMD + posix only.
    #[cfg(all(target_arch = "x86_64", unix))]
    if bun_core::Environment::ENABLE_SIMD {
        unsafe extern "C" {
            fn bun_warn_avx_missing(url: *const core::ffi::c_char);
        }
        // SAFETY: BUN__GITHUB_BASELINE_URL is a NUL-terminated static; the C
        // side only reads it to print the suggested download URL.
        unsafe {
            bun_warn_avx_missing(
                bun_runtime::cli::upgrade_command::UpgradeCommand::BUN__GITHUB_BASELINE_URL
                    .as_ptr(),
            );
        }
    }

    // 5. Per-thread stack-limit cache for the JS recursion guard.
    StackCheck::configure_thread();
    bun_io::ParentDeathWatchdog::install();

    bun_runtime::allocators::register_safety_vtables();

    // 7. CLI dispatch.
    bun_runtime::cli::Cli::start();
    // `Global::exit` is `-> !`; it coerces to the `c_int` return type.
    Global::exit(0)
}
