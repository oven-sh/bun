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

/// LSAN built-in suppressions, merged with whatever `LSAN_OPTIONS=suppressions=`
/// the CI runner passes (`test/leaksan.supp`). That file's entries were written
/// against Zig's symbol mangling (`runtime.node.zlib.NativeZlib.Context.init`,
/// `jsc.web_worker.create`, …); LSAN matches by *substring on a symbolized
/// frame*, so after the Rust port renamed every frame to `bun_<crate>::<mod>`
/// none of the Zig-named rules fire and CI reports the same intentionally-
/// leaked-at-exit allocations the suppressions were authored for. Baking the
/// Rust spellings into the binary keeps `leaksan.supp` as the C/C++/JSC list
/// and lets the Rust list ride with the code that produces the symbols.
///
/// Also covers one Rust-only false positive that has no Zig analogue:
/// `std::thread::Builder::spawn` allocates an `Arc<thread::Inner>` that the
/// detached thread holds in TLS for its lifetime; LSAN does not scan other
/// threads' TLS roots at exit, so every long-lived detached thread (HTTP
/// client, debugger, FSEvents) reports a 48-byte "leak".
///
/// Weak-defined by the ASAN runtime, so this strong definition wins. Harmless
/// dead symbol when ASAN isn't linked (same linkage story as
/// `__asan_default_options` above).
#[unsafe(no_mangle)]
pub extern "C" fn __lsan_default_suppressions() -> *const core::ffi::c_char {
    // One rule per line. Substring match on any frame in the allocation stack.
    // Keep this list 1:1 with the Zig-named entries in `test/leaksan.supp`;
    // C/C++ symbol entries stay in that file (their names did not change).
    concat!(
        // Rust std false positive — detached threads' Arc<thread::Inner>.
        "leak:std::thread::thread::Thread>::new\n",
        // ── ported Zig-named entries ────────────────────────────────────────
        "leak:bun_runtime::api::server::ServerAllConnectionsClosedTask\n",
        "leak:bun_cli::bunfig::Bunfig>::parse\n",
        "leak:bun_resolver::resolver::Resolver>::parse_package_json\n",
        "leak:bun_resolver::package_json::PackageJSON>::parse\n",
        "leak:bun_resolver::resolver::Resolver>::parse_tsconfig\n",
        "leak:bun_jsc::JSGlobalObject::JSGlobalObject>::create\n",
        "leak:bun_js_printer::js_printer::print_ast\n",
        "leak:bun_jsc::ipc::on_data2\n",
        "leak:bun_runtime::node::fs_events::init_library\n",
        "leak:bun_runtime::node::fs_events::FSEventsLoop\n",
        "leak:bun_bake::framework_router::JSFrameworkRouter\n",
        "leak:bun_js_parser_jsc::Macro\n",
        "leak:bun_runtime::webcore::Blob>::find_or_create_file_from_path\n",
        "leak:bun_runtime::node::node_fs_binding\n",
        "leak:bun_jsc::module_loader::fetch_builtin_module\n",
        "leak:bun_boringssl::boringssl::check_x509_server_identity\n",
        "leak:bun_runtime::cli::pack_command\n",
        "leak:bun_runtime::dns_jsc::dns::GetAddrInfoRequest\n",
        "leak:bun_tcc_sys::tcc::State>::init\n",
        "leak:bun_runtime::api::bun::dynamic_library\n",
        "leak:bun_runtime::webcore::body::Value>::from_js\n",
        "leak:bun_sys_jsc::error_jsc::error_to_system_error\n",
        "leak:bun_runtime::webcore::Blob>::get_name_string\n",
        "leak:bun_patch::patch::PatchFile>::apply\n",
        "leak:bun_jsc::module_loader::RuntimeTranspilerStore\n",
        "leak:bun_runtime::webcore::blob::Store>::init_s3\n",
        "leak:bun_runtime::webcore::s3::list_objects\n",
        "leak:bun_runtime::webcore::S3Client\n",
        "leak:bun_runtime::node::node_fs::NodeFS>::realpath_inner\n",
        "leak:bun_sys_jsc::error_jsc::error_to_shell_system_error\n",
        "leak:bun_runtime::api::filesystem_router::FileSystemRouter\n",
        "leak:bun_runtime::dns_jsc::dns::Resolver\n",
        "leak:bun_runtime::node::node_os::version\n",
        "leak:bun_runtime::node::node_os::release\n",
        "leak:bun_runtime::node::util::parse_args\n",
        "leak:bun_runtime::node::node_fs_watcher::FSWatcher\n",
        "leak:bun_jsc::web_worker::WebWorker>::create\n",
        "leak:bun_runtime::node::native_zlib_impl::Context>::init\n",
        "leak:bun_sql_jsc::postgres\n",
        "leak:bun_sql::postgres::protocol::FieldMessage\n",
        "leak:bun_runtime::webcore::fetch::FetchTasklet>::to_response\n",
        "leak:bun_lolhtml_sys::lol_html::HTMLString\n",
        "leak:bun_jsc::Debugger\n",
        "leak:bun_runtime::socket::udp_socket::UDPSocket\n",
        "\0",
    )
    .as_ptr()
    .cast()
}

/// Process entry point. `extern "C"` so the linker resolves crt1.o's
/// undefined `main` against this symbol — same role as Zig's `pub fn main`.
///
/// `argc`/`argv` are accepted for signature compatibility but unused:
/// `std::env::args_os()` (which `bun_core::argv()` wraps) captures them
/// independently via the `.init_array` hook on Linux / `_NSGetArgv` on
/// macOS / `GetCommandLineW` on Windows, so a Rust `lang_start` is not
/// required.
#[unsafe(no_mangle)]
pub extern "C" fn main(_argc: c_int, _argv: *const *const c_char) -> c_int {
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
