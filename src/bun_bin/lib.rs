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

#![allow(unused_imports)]
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

/// Under ASAN, route the global allocator through the system allocator (libc
/// malloc) so the ASAN interceptor sees every allocation directly — redzones,
/// free quarantine, heap-origin tracking. Mirrors the Zig build's
/// `use_mimalloc = false` + `fallback.zig` (`std.heap.c_allocator`) path.
/// `MimallocArena` (the parser/AST bump arena) stays on mimalloc.
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
///
/// `#[cold]`: read once by the LSAN runtime during its own init (never linked
/// in release / on the `bun run` path) — keep it off the startup `.text` pages.
#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
pub extern "C" fn __lsan_default_suppressions() -> *const core::ffi::c_char {
    // One rule per line. Substring match on any frame in the allocation stack.
    // Most "ported Zig-named" entries below mirror `test/leaksan.supp` 1:1
    // (their Zig spellings live there; C/C++ entries stay there unchanged). A
    // few — e.g. `TimeoutObject>::init_with` — are conceptually pre-existing
    // Zig leaks that mimalloc hid from LSAN, so they never needed a
    // `leaksan.supp` entry until the Rust port switched the global allocator
    // to `std::alloc::System` under ASAN. Per-entry comments call those out.
    concat!(
        // Rust std false positive — detached threads' Arc<thread::Inner>.
        "leak:std::thread::thread::Thread>::new\n",
        // ── ported Zig-named entries ────────────────────────────────────────
        "leak:bun_runtime::api::server::ServerAllConnectionsClosedTask\n",
        "leak:bun_cli::bunfig::Bunfig>::parse\n",
        // `Resolver` is `arena.alloc()`'d in `build_command::exec` ("PORT NOTE:
        // process-lifetime") — its `dir_cache` (parsed package.json/tsconfig,
        // `RealFS::dir_cache` `DirEntry`s) is bulk-reclaimed by the OS at exit.
        // No module path: the resolver currently demangles as
        // `bun_resolver::__phase_a_body::Resolver` (porting-artifact module name
        // that will move) — pin only the stable `Resolver>::<fn>` tail.
        "leak:Resolver>::parse_package_json\n",
        "leak:bun_resolver::package_json::PackageJSON>::parse\n",
        "leak:Resolver>::parse_tsconfig\n",
        // `dir_info_cached_maybe_log` is the single entry point that populates
        // `Resolver::dir_cache` (every package.json/tsconfig/node_modules walk).
        "leak:Resolver>::dir_info_cached_maybe_log\n",
        "leak:bun_resolver::fs::RealFS>::read_directory\n",
        "leak:bun_jsc::JSGlobalObject::JSGlobalObject>::create\n",
        // `print_ast` lives at the crate root (`bun_js_printer::print_ast`),
        // not in a `js_printer` submodule — keep the path matching the
        // demangled frame so the runtime sourcemap-cache blobs are suppressed.
        "leak:bun_js_printer::print_ast\n",
        "leak:bun_jsc::ipc::on_data2\n",
        "leak:bun_runtime::node::fs_events::init_core_foundation\n",
        "leak:bun_runtime::node::fs_events::init_core_services\n",
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
        // Zig `jsc.ModuleLoader.RuntimeTranspilerStore.TranspilerJob` — Rust
        // module is `bun_jsc::runtime_transpiler_store::TranspilerJob`; the
        // store and its sourcemap blobs are owned by the process-lifetime VM.
        "leak:bun_jsc::runtime_transpiler_store::TranspilerJob\n",
        "leak:bun_jsc::saved_source_map::SavedSourceMap\n",
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
        // Zig `jsc.Debugger.startJSDebuggerThread` — the Rust module is
        // lowercase (`#[path = "Debugger.rs"] pub mod debugger;`), so the
        // demangled frame is `<bun_jsc::debugger::Debugger>::…`; the previous
        // `bun_jsc::Debugger` substring missed it (capital-D after `::`).
        "leak:bun_jsc::debugger::Debugger>::start_js_debugger_thread\n",
        "leak:bun_runtime::socket::udp_socket::UDPSocket\n",
        // Armed `.unref()`'d timer at process exit: wrapper is pinned by
        // `internals.this_value` (Strong) and the reschedule ref only drops on
        // fire/cancel — neither path runs at exit. Reachable from per-VM
        // `RuntimeState::timer` (process lifetime). Zig has the same leak but
        // mimalloc hid it from LSAN, so `test/leaksan.supp` has no counterpart.
        "leak:bun_runtime::timer::timeout_object::TimeoutObject>::init_with\n",
        // ── Rust-only process-lifetime allocations ──────────────────────────
        // No Zig analogue; first observed once the global allocator switched to
        // `std::alloc::System` under ASAN (mimalloc previously hid these from
        // LSAN). All are reachable from process-lifetime structures that are
        // intentionally never dropped — the OS reclaims them at exit.
        //
        // `cli::test::scanner::Scanner` walks the test directory tree on
        // startup; `RealFS::dir_cache` `Box<DirEntry>` entries (~60 KB for a
        // medium repo) live for the test run.
        "leak:bun_runtime::cli::test::scanner::Scanner\n",
        // `Transpiler` / its `Resolver` config is `arena.alloc()`'d in
        // `build_command::exec` (process-lifetime); arenas don't run `Drop`.
        "leak:bun_bundler::transpiler::resolver_bundle_options_subset\n",
        "leak:Transpiler>::sync_resolver_opts\n",
        "leak:bun_bundler::options_impl::ESMConditions\n",
        "leak:bun_bundler::options_impl::defines_from_transform_options\n",
        // `ThreadPool::get_worker` `Box<Worker>` is freed via a deferred idle
        // task pushed by `Worker::deinit_soon`; that task races process exit
        // (deliberately — joining would block on the runtime VM's parse pool).
        "leak:bun_bundler::thread_pool::ThreadPool>::get_worker\n",
        // `StringVoidMapPool` is a thread-local `ObjectPool` (preheated, 32
        // slots). LSAN does not scan other threads' TLS roots at exit (same
        // category as the `std::thread::Thread>::new` false positive above).
        "leak:bun_js_parser::parser::StringVoidMap\n",
        // `BSSMapInner` singletons live in anonymous-mmap pages from
        // `bss_lazy_bytes`, which LSan does not scan as roots — the global-heap
        // hashbrown table backing `BSSMapInner::index` is therefore reported as
        // unreachable even though the singleton is process-lifetime.
        "leak:BSSMapInner>::get_or_put\n",
        // `intern_location_file` `Box::leak`s a `CString` per `src!()` callsite
        // into a thread-local cache (debug/ASAN-only — release uses static
        // `c"…"` literals). Bounded leak by design; the per-thread `HashMap`
        // is also a TLS root LSAN doesn't scan.
        "leak:bun_jsc::top_exception_scope::intern_location_file\n",
        // `AnyEventLoop` for `Bun.build()` is `bump.alloc()`'d in the bundler
        // thread (`js_bundle_completion_task::generate_in_new_thread`); the
        // arena is bulk-freed without running `Drop`, so the `MiniEventLoop`
        // task queue's `Box<[…]>` slab strands. Bounded (one slab per build).
        "leak:bun_event_loop::MiniEventLoop\n",
        // CLI `Transpiler` is `arena.alloc()`'d (process-lifetime; see
        // `build_command.rs` PORT NOTE) — its `BundleOptions::bundler_feature_flags`
        // `Box<StringSet>` strands when the arena bulk-frees.
        "leak:bun_js_parser::parser::Runtime::Features::init_bundler_feature_flags\n",
        // TODO(leak): `UpdateRequest.name: &'static [u8]` is a CLI positional
        // leaked separately from the `PackageManager` singleton. Bounded.
        "leak:bun_install::package_manager_real::update_request::UpdateRequest\n",
        // ── CSS AST arena: heap-backed members in arena-allocated nodes ─────
        // The CSS parser bump-allocates AST nodes in `bun_alloc::Arena`; the
        // arena bulk-frees without `Drop`. Members that own a global-heap
        // allocation (`SmallList` heap spill, `Vec` from `deep_clone`) strand.
        // Pre-existing in Zig (same arena model). Phase B re-threads `'i` to
        // make these bump-backed.
        //
        // `SmallList` heap-spilling entry points are `#[inline(never)]` under
        // `bun_asan` so these v0-demangled patterns match (when fully inlined
        // the DWARF inline frame is the bare method name and never matches).
        // LSan matching is substring-based, so `>::append` also covers
        // `append_assume_capacity` / `append_slice*`.
        "leak:SmallList<*>::append\n",
        "leak:SmallList<*>::clone\n",
        "leak:SmallList<*>::extend\n",
        "leak:SmallList<*>::from_iter\n",
        "leak:SmallList<*>::init_capacity\n",
        // ── LSan-fires-before-final-GC-sweep ────────────────────────────────
        // These wrap a Rust allocation in a JSC GC cell (or leak it to JSC as
        // an external string). Ownership is correct — the cell finalizer /
        // external-string finalizer frees the allocation — but LSan checks at
        // process exit *before* the final GC sweep, so any not-yet-collected
        // wrapper reports its inner allocation. See the matching `LSan` notes
        // on `bun_ast::Location::clone`, `bun_ast::Data::clone`, and
        // `bun_core::strings::to_utf16_alloc_maybe_buffered`.
        "leak:BuildMessage>::create\n",
        "leak:ResolveMessage>::create\n",
        "leak:TextDecoder>::decode_slice\n",
        // Same category, but the GC sweep is *skipped entirely*: when JS calls
        // `process.exit()`, `Zig__GlobalObject__destructOnExit` early-returns
        // on `vm.entryScope != nullptr`, so JS-rooted Rust allocations are
        // never finalized. Pre-existing in Zig; visible since the ASAN
        // system-allocator change. Reachable from live JS objects at exit.
        //
        // `Bun.build()` output `BuildArtifact` (and its `Blob` `Store`) boxed
        // in `OutputFileJsc::to_js`; freed by `JsFinalize::finalize`.
        "leak:OutputFileJsc>::to_js\n",
        // `Bun.Transpiler` default `BundleOptions` (e.g. `output_dir` `Box`)
        // owned by `JSTranspiler`; freed by `JsCell::Drop`.
        "leak:bun_bundler::options_impl::BundleOptions>::from_api\n",
        // `Transpiler::init_in_place` clones `output_dir` into `result.outbase`
        // (default `b"out"`, ~3 b). Freed by `Transpiler::deinit()` via the
        // `JSTranspiler` finalizer — never reached when `process.exit()` skips
        // the final sweep. Distinct frame from the `from_api` allocation above.
        "leak:Transpiler>::init_in_place\n",
        // Process-lifetime: `RuntimeState.entry_point.contents` lives behind a
        // TLS `Cell<*mut>` LSan doesn't scan as a root (`Run::start` is `-> !`).
        "leak:VirtualMachine>::reload_entry_point\n",
        // `start()`'s +1 still strands on write-error / EOF / GC-skipped exit;
        // releasing there needs a deref after FilePoll dispatch unwinds.
        "leak:StaticPipeWriter<*>::create\n",
        // `final_buffer()` (install lifecycle scripts / cron): `_buffer` strands
        // because the embedding parent is itself leaked with the `PackageManager`.
        "leak:PosixBufferedReader>::final_buffer\n",
        // `Bun.serve` / bake dev-server `Request` Box: owned by the JS GC
        // wrapper; LSan fires before the final sweep / deferred-pool drain.
        "leak:AnyServer>::prepare_and_save_js_request_context\n",
        "leak:NewServer<*>::prepare_js_request_context\n",
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

    // main.zig:40-50 — Windows-only startup. Must run BEFORE the first libuv
    // call (uv allocator) and before anything reads `Bun.env`/`process.env`
    // (env conversion). The Zig spec orders these between sigaction and
    // `start_time`/`initArgv`.
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
