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

#![allow(unused_imports)]
#![warn(unused_must_use)]

use core::ffi::{c_char, c_int};

mod phase_c_exports;

// Force-link `bun_platform` so its `#[no_mangle]` C exports
// (`sys_epoll_pwait2`, `ioctl_ficlone`, …) reach the linker.
use bun_platform as _;

use bun_core::output;
use bun_core::Global;
use bun_core::StackCheck;

/// mimalloc as the process allocator — matches Zig's `bun.default_allocator`
/// and the `uv_replace_allocator(mi_*)` call in `main.zig` on Windows.
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

/// ASAN runtime options override. Lives in the binary crate so it is a direct
/// link input — the ASAN runtime weak-defines this symbol, and an rlib/archive
/// member that only provides it would never be extracted, so the override in
/// `bun_safety::asan` silently didn't apply (manifesting as a
/// `Thread::currentSingleton().stack().contains(this)` assert in
/// `JSGlobalObject::GlobalPropertyInfo` because `detect_stack_use_after_return`
/// puts C++ stack locals on a heap-backed fake stack JSC's conservative GC
/// can't see). Unconditional: harmless dead symbol when ASAN isn't linked.
#[unsafe(no_mangle)]
pub extern "C" fn __asan_default_options() -> *const core::ffi::c_char {
    // detect_stack_use_after_return=0: keep stack locals on the real stack so
    //   JSC's conservative GC scan and `StackBounds::contains` see them.
    // detect_leaks=0: off by default (Linux defaults it on); CI opts in via
    //   ASAN_OPTIONS with a suppressions file.
    //
    // PORT NOTE: matches `src/safety/asan.zig` exactly. Do NOT add `symbolize=0`
    // here — LSAN's function-name suppression matching (`test/leaksan.supp`)
    // requires symbolized stacks; with symbolization disabled every entry like
    // `leak:uws_create_app` silently stops matching and CI reports the
    // suppressed allocations as leaks. If local debug crashes feel slow to
    // print, set `ASAN_OPTIONS=symbolize=0` in your shell instead.
    c"detect_stack_use_after_return=0:detect_leaks=0".as_ptr()
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
#[unsafe(no_mangle)]
pub extern "C" fn main(argc: c_int, argv: *const *const c_char) -> c_int {
    // 0. Capture argv FIRST — before the crash handler, whose panic path
    //    dumps the command line via `bun_core::argv()`.
    //    SAFETY: `argc`/`argv` come from the C runtime; the argv block lives
    //    for the entire process.
    unsafe { bun_core::init_argv(argc, argv) };

    // 1. Crash handler first so anything below gets a usable trace.
    bun_crash_handler::init();

    // SIGPIPE/SIGXFSZ → SIG_IGN, like main.zig's posix block.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
    }

    // 2/3. Allocator is static above; argv was captured at step 0; start_time
    //      is lazy in `bun_core::start_time()`.

    // 4. Stdio + Output sink. `bun_core::OutputSink[Sys]` is link-time provided
    //    by `bun_sys`; `stdio::init()` calls C's `bun_initialize_process()` and
    //    wires stdout/stderr `Source`s.
    output::stdio::init();
    struct FlushOnDrop;
    impl Drop for FlushOnDrop {
        fn drop(&mut self) {
            output::flush();
        }
    }
    let _flush = FlushOnDrop;

    // main.zig: `bun_warn_avx_missing(...)` — x86_64 + SIMD + posix only.
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    unsafe {
        unsafe extern "C" {
            fn bun_warn_avx_missing(url: *const core::ffi::c_char);
        }
        // TODO(phase-c): plumb `UpgradeCommand::Bun__githubBaselineURL` once
        // `bun_runtime::cli` is linkable. Empty string is harmless — the C
        // side only prints it.
        bun_warn_avx_missing(c"".as_ptr());
    }

    // 5. Per-thread stack-limit cache for the JS recursion guard.
    StackCheck::configure_thread();
    bun_io::ParentDeathWatchdog::install();

    // 6. Push high-tier allocator vtable addresses into the
    //    `bun_safety::alloc::has_ptr` registry so debug-only allocator-mismatch
    //    checks can identify `LinuxMemFdAllocator`/`MimallocArena` instances
    //    (Zig: inline `isInstance` chain in `safety/alloc.zig:hasPtr`).
    //    Runs once; reads are lock-free Relaxed.
    bun_runtime::allocators::register_safety_vtables();

    // 7. CLI dispatch.
    bun_runtime::cli::Cli::start();
    // `Global::exit` is `-> !`; it coerces to the `c_int` return type.
    Global::exit(0)
}
