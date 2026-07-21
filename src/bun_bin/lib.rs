//! `libbun_rust.a` — the Rust-port staticlib.
//!
//! Built by `cargo build -p bun_bin` (emitted from `scripts/build/rust.ts`)
//! and linked into the final `bun-debug` executable by ninja's link step.
//! The clang++ driver supplies the
//! C runtime startup (`_start` → `main`); `main` below is the process entry.
//!
//! Init order:
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

mod c_abi_exports;

// Force-link `bun_platform` so its `#[no_mangle]` C exports
// (`sys_epoll_pwait2`, …) reach the linker.
use bun_platform as _;

use bun_core::Global;
use bun_core::StackCheck;
use bun_core::output;

/// mimalloc as the process allocator.
#[cfg(not(bun_asan))]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

/// Under ASAN, use the system allocator so the interceptor sees every allocation.
#[cfg(bun_asan)]
#[global_allocator]
static ALLOC: std::alloc::System = std::alloc::System;

/// ASAN runtime options override. Lives in the binary crate so it is a direct
/// link input — the ASAN runtime weak-defines this symbol, and an rlib/archive
/// member that only provides it would never be extracted, so the override in
/// `bun_safety::asan` silently didn't apply (manifesting as a
/// `Thread::currentSingleton().stack().contains(this)` assert in
/// `JSGlobalObject::GlobalPropertyInfo` because `detect_stack_use_after_return`
/// puts C++ stack locals on a heap-backed fake stack JSC's conservative GC
/// can't see). Unconditional: harmless dead symbol when ASAN isn't linked.
///
/// `#[cold]`: read once by the ASAN runtime during its own init (never linked
/// in release / on the `bun run` path) — keep it off the startup `.text` pages.
#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
pub extern "C" fn __asan_default_options() -> *const core::ffi::c_char {
    // detect_stack_use_after_return=0: keep stack locals on the real stack so
    //   JSC's conservative GC scan and `StackBounds::contains` see them.
    // detect_leaks=0: off by default (Linux defaults it on); CI opts in via
    //   ASAN_OPTIONS with a suppressions file.
    //
    // Do NOT add `symbolize=0`
    // here — LSAN's function-name suppression matching (`test/leaksan.supp`)
    // requires symbolized stacks; with symbolization disabled every entry like
    // `leak:uws_create_app` silently stops matching and CI reports the
    // suppressed allocations as leaks. If local debug crashes feel slow to
    // print, set `ASAN_OPTIONS=symbolize=0` in your shell instead.
    c"detect_stack_use_after_return=0:detect_leaks=0".as_ptr()
}

/// LSAN built-in suppressions, merged with whatever `LSAN_OPTIONS=suppressions=`
/// the CI runner passes (`test/leaksan.supp`). LSAN matches by *substring on a
/// symbolized frame*; baking the Rust symbol spellings into the binary keeps
/// `leaksan.supp` as the C/C++/JSC list and lets the Rust list ride with the
/// code that produces the symbols.
///
/// Also covers one Rust-only false positive:
/// `std::thread::Builder::spawn` allocates an `Arc<thread::Inner>` that the
/// detached thread holds in TLS for its lifetime; LSAN does not scan other
/// threads' TLS roots at exit, so every long-lived detached thread (HTTP
/// client, debugger, FSEvents) reports a 48-byte "leak".
///
/// Weak-defined by the ASAN runtime, so this strong definition wins. Harmless
/// dead symbol when ASAN isn't linked (same linkage story as
/// `__asan_default_options` above).
///
/// `#[cold]`: read once by the LSAN runtime during its own init (never linked
/// in release / on the `bun run` path) — keep it off the startup `.text` pages.
#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
pub extern "C" fn __lsan_default_suppressions() -> *const core::ffi::c_char {
    // One rule per line. Substring match on any frame in the allocation stack.
    //
    // Every entry below is a structural / process-lifetime allocation that has
    // been investigated and is intentionally suppressed — not a leak. New
    // entries here require a comment naming the owner and why it cannot be
    // freed before exit. Do NOT add a suppression to silence a CI flake; fix
    // the lifecycle instead.
    concat!(
        // Rust std false positive — a detached thread's `Arc<thread::Inner>`
        // is held by the OS thread's TLS, which LSan does not scan as a root.
        "leak:std::thread::thread::Thread>::new\n",
        // macOS-only `dlopen("CoreFoundation")` / `dlopen("CoreServices")`
        // and the per-process `FSEventStream` / `CFRunLoop` they require.
        // These are platform singletons by design (CF objects are not safely
        // disposable while the dylib remains loaded).
        "leak:bun_runtime::node::fs_events::init_core_foundation\n",
        "leak:bun_runtime::node::fs_events::init_core_services\n",
        "leak:bun_runtime::node::fs_events::FSEventsLoop\n",
        // Process-lifetime inspector thread. The debugger handles SIGINT and
        // serves the WebSocket protocol up to (and during) `process.exit()`;
        // joining it from `global_exit` would deadlock when the user is
        // mid-breakpoint. The thread's stack/Arc are reclaimed by the OS.
        "leak:bun_jsc::debugger::Debugger>::start_js_debugger_thread\n",
        "\0",
    )
    .as_ptr()
    .cast()
}

/// Process entry point. `extern "C"` so the linker resolves crt1.o's
/// undefined `main` against this symbol.
///
/// `argc`/`argv` are forwarded to `bun_core::init_argv` immediately: on
/// glibc/macOS/Windows libstd also captures them via a `.init_array` hook /
/// `_NSGetArgv` / `GetCommandLineW`, but on **musl** static builds that hook
/// receives no arguments (musl's `__libc_start_main` does not pass
/// `(argc,argv,envp)` to constructors), so `std::env::args_os()` returns
/// empty and the binary would see argc=0. Capturing the C-runtime-provided
/// pair here is the only portable source.
///
/// # Safety
/// `argv` must point to `argc` valid NUL-terminated C strings that live for
/// the entire process — guaranteed by the C runtime that calls this symbol.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn main(argc: c_int, argv: *const *const c_char) -> c_int {
    // Both Bun and WebKit trust simdutf unconditionally for UTF-8/UTF-16
    // length computation, validation, and base64. If the runtime CPU lacks
    // every instruction set simdutf was compiled for, it silently dispatches
    // to a stub that returns 0/false for everything, and the process spends
    // ~16 seconds churning through ~4 GB of bad allocations before crashing
    // with an opaque SIGSEGV. Detect that up front and explain why.
    //
    // One exception: under Rosetta 2 the stub means the translated
    // CPUID/XGETBV under-reported the feature set, not that the host cannot
    // execute the compiled kernels (it is already executing this
    // `-march=haswell` binary), so dispatch is recovered and Bun keeps
    // running. Before that recovery, `bun install` hung forever under
    // Rosetta on macOS 15: the stub claims a non-ASCII byte at index 0 for
    // every input, so `first_non_ascii`-driven scan loops never advanced.
    //
    // This must run before convert_env_to_wtf8/init_argv on Windows — both
    // convert UTF-16 via simdutf and would panic on a null unwrap before
    // any diagnostic could be printed. It therefore cannot depend on
    // Output being initialized and writes to raw stderr instead.
    if !bun_simdutf_sys::simdutf::has_any_implementation()
        && !bun_simdutf_sys::simdutf::recover_implementation_under_rosetta()
    {
        abort_for_unsupported_simdutf();
    }

    // 0. Capture argv FIRST — before the crash handler, whose panic path
    //    dumps the command line via `bun_core::argv()`.
    //    SAFETY: `argc`/`argv` come from the C runtime; the argv block lives
    //    for the entire process.
    unsafe { bun_core::init_argv(argc, argv) };

    // 1. Crash handler first so anything below gets a usable trace.
    bun_crash_handler::init();

    // SIGPIPE/SIGXFSZ → SIG_IGN.
    // SAFETY: `SIGPIPE`/`SIGXFSZ` are valid signal numbers and `SIG_IGN` is a
    // valid disposition; called once on the main thread before any other
    // thread is spawned, so there is no concurrent sigaction.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
    }

    // Windows-only startup. Must run BEFORE the first libuv
    // call (uv allocator) and before anything reads `Bun.env`/`process.env`
    // (env conversion).
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

    // `bun_warn_avx_missing(...)` — x86_64 + SIMD + posix only.
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

    // 6. Push high-tier allocator vtable addresses into the
    //    `bun_safety::alloc::has_ptr` registry so debug-only allocator-mismatch
    //    checks can identify `LinuxMemFdAllocator`/`MimallocArena` instances.
    //    Runs once; reads are lock-free Relaxed.
    bun_runtime::allocators::register_safety_vtables();

    // 7. CLI dispatch.
    bun_runtime::cli::Cli::start();
    // `Global::exit` is `-> !`; it coerces to the `c_int` return type.
    Global::exit(0)
}

unsafe extern "C" {
    fn bun_abort_missing_simd(
        requirement: *const core::ffi::c_char,
        hint: *const core::ffi::c_char,
    ) -> !;
}

/// Prints a CPU-requirement diagnostic and exits. Called from `main()` before
/// `Output` is initialized and before Windows has converted its environment
/// block to UTF-8, so the actual write goes through the C runtime
/// (fprintf(stderr)/getenv) in `bun_abort_missing_simd` rather than
/// `bun_core::Output` / `bun_core::getenv_z`.
#[cold]
fn abort_for_unsupported_simdutf() -> ! {
    use bun_core::Environment;

    const IS_X64: bool = cfg!(target_arch = "x86_64");
    const IS_AARCH64: bool = cfg!(target_arch = "aarch64");

    // simdutf's minimum compiled-in kernel is westmere (SSE4.2) for the
    // baseline build and haswell (AVX2) for the default build — the lower
    // tiers are elided once __SSE4_2__ / __AVX2__ are defined.
    let requirement: &core::ffi::CStr = if IS_X64 {
        if Environment::BASELINE {
            c"SSE4.2"
        } else {
            c"AVX2"
        }
    } else if IS_AARCH64 {
        c"NEON"
    } else {
        c"SIMD"
    };

    let hint: &core::ffi::CStr = if IS_X64 && Environment::BASELINE {
        c"  Bun's baseline build targets Nehalem-class (2008+) x86_64 CPUs.\n  If this is a VM, enable host CPU passthrough (e.g. -cpu host for QEMU/KVM).\n"
    } else if IS_X64 {
        bun_runtime::cli::upgrade_command::SIMDUTF_BASELINE_HINT
    } else {
        c""
    };

    // SAFETY: both arguments are NUL-terminated static C strings; the C
    // side only reads them to print the diagnostic, then calls exit(134).
    unsafe { bun_abort_missing_simd(requirement.as_ptr(), hint.as_ptr()) }
}
