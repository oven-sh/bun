//! `bun-rs` — the Rust-port executable.
//!
//! Init order mirrors `src/main.zig`:
//!   1. crash handler / signal masks
//!   2. allocator wiring (mimalloc as `#[global_allocator]`)
//!   3. argv / start-time capture
//!   4. `Output.Source.Stdio.init()` — stdout/stderr writers
//!   5. `StackCheck.configureThread()`
//!   6. `cli::Cli::start()` → `Global::exit(0)`
//!
//! `bun_runtime` (which owns `cli::Cli::start`) is gated out until its
//! upstream crates compile; until then we report and exit cleanly so the
//! link step itself can be exercised.

#![allow(unused_imports)]

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
    // symbolize=0 + fast_unwind_on_fatal=1: the debug binary is ~735MB and
    //   ASAN's in-process symbolizer takes 10s+ per frame, which makes crashes
    //   look like hangs during development. Re-enable via ASAN_OPTIONS env when
    //   you actually want symbolized output.
    c"detect_stack_use_after_return=0:detect_leaks=0:symbolize=0:fast_unwind_on_fatal=1".as_ptr()
}

fn main() {
    // 1. Crash handler first so anything below gets a usable trace.
    bun_crash_handler::init();

    // SIGPIPE/SIGXFSZ → SIG_IGN, like main.zig's posix block.
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
    }

    // 2/3. Allocator is static above; argv/start_time are lazy in bun_core.
    //      (Zig's `initArgv`/`start_time` are folded into `bun_core::argv()`
    //      and `bun_core::start_time()` — no eager call needed.)

    // 4. Stdio + Output sink. The `OutputSinkVTable` is link-time provided by
    //    `bun_sys` (`__BUN_OUTPUT_SINK_VTABLE`); `stdio::init()` calls C's
    //    `bun_initialize_process()` and wires stdout/stderr `Source`s.
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
    // TODO(phase-c): `ParentDeathWatchdog::install()` lives in `bun_spawn`;
    // wire once that crate is in the dep graph.

    // 6. §Dispatch — high-tier hot-path (Task/FilePoll/Timer) and cold-path
    //    (RuntimeHooks/LoaderHooks) bodies are link-time `extern "Rust"`
    //    `#[no_mangle]` symbols in `bun_runtime::{dispatch,jsc_hooks}`; no
    //    runtime registration needed.

    // 7. CLI dispatch.
    bun_runtime::cli::Cli::start();
    Global::exit(0);
}
