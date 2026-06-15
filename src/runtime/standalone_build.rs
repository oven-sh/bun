//! `bun-standalone` build support.
//!
//! The `bun-standalone` binary is the reduced-footprint runtime that
//! `bun build --compile` attaches a module graph to. It carries the full JS
//! runtime (event loop, module loader, `Bun.serve`, `fetch`, node compat,
//! crypto, FFI, …) but compiles out the toolkit subcommands and the JS APIs
//! that back them — `bun install`/`add`/`remove`/`pm`, `bun build`,
//! `bun test`, `bun create`/`init`/`x`/`upgrade`, `Bun.build()`, the bake
//! DevServer, and the CSS parser surface.
//!
//! Gating is on `cfg(bun_standalone)` (a global RUSTFLAG set by
//! `scripts/build/rust.ts`), not `cfg(feature = "standalone")`, so any crate
//! can branch on it without threading a cargo feature through the workspace.
//! The C/C++ object set is identical between `bun` and `bun-standalone`;
//! `--gc-sections` + `.llvm_addrsig` drop the C++ functions whose only
//! Rust-side callers were compiled out.
//!
//! Every stub here surfaces a user-facing error; nothing is a silent no-op.

/// True for the `bun-standalone` binary. Same as
/// `bun_core::build_options::STANDALONE_BUILD`.
pub const IS_STANDALONE: bool = cfg!(bun_standalone);

/// Print the "not available in this binary" error for a CLI subcommand and
/// exit non-zero. Used by the `cfg(bun_standalone)` dispatch arm in
/// `cli::Command::start()`.
#[cold]
#[allow(dead_code)]
pub fn unavailable_command(name: &[u8]) -> ! {
    bun_core::pretty_errorln!(
        "<r><red>error<r><d>:<r> <b>bun {}<r> is not available in this executable",
        bstr::BStr::new(name),
    );
    bun_core::pretty_errorln!("");
    bun_core::pretty_errorln!(
        "This is a standalone executable built with <b>bun build --compile<r>. It contains the",
    );
    bun_core::pretty_errorln!("Bun runtime but not the bundler, package manager, or test runner.",);
    bun_core::pretty_errorln!("");
    bun_core::pretty_errorln!(
        "To use <b>bun {}<r>, install Bun: <cyan>https://bun.com/get<r>",
        bstr::BStr::new(name),
    );
    bun_core::output::flush();
    bun_core::Global::exit(1);
}

// ─── extern "Rust" / extern "C" link stubs ───────────────────────────────────
// `bun_dispatch::link_interface!` in lower-tier crates (bun_io, bun_bundler)
// emits `extern "Rust"` declarations for every variant in its list. Under
// `bun_standalone` the `link_impl_*!` registrations for the toolkit-only
// variants are cfg'd out with their owning modules, so the symbols are
// undefined. These bodies are unreachable at runtime (no `BufferedReader` is
// ever constructed with a toolkit-only parent kind in a standalone binary);
// they exist so the link resolves.
#[cfg(bun_standalone)]
mod link_stubs {
    macro_rules! buffered_reader_parent_stubs {
        ($($variant:ident: $($sym:ident),* ;)*) => {$($(
            #[unsafe(no_mangle)]
            fn $sym() -> ! {
                unreachable!(concat!(
                    "BufferedReaderParentLink::",
                    stringify!($variant),
                    " is not available in standalone executables",
                ))
            }
        )*)*};
    }
    buffered_reader_parent_stubs! {
        FilterRunHandle:
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__has_on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__on_reader_done,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__on_reader_error,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__loop_ptr,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__event_loop,
            __bun_dispatch__BufferedReaderParentLink__FilterRunHandle__on_max_buffer_overflow;
        MultiRunPipeReader:
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__has_on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__on_reader_done,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__on_reader_error,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__loop_ptr,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__event_loop,
            __bun_dispatch__BufferedReaderParentLink__MultiRunPipeReader__on_max_buffer_overflow;
        TestParallelWorkerPipe:
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__has_on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__on_read_chunk,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__on_reader_done,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__on_reader_error,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__loop_ptr,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__event_loop,
            __bun_dispatch__BufferedReaderParentLink__TestParallelWorkerPipe__on_max_buffer_overflow;
    }

    // `bun_spawn::link_interface!(ProcessExit[...])` — same story for the
    // `bun test --parallel` / `bun run --filter` / `bun --parallel` workers'
    // process-exit hooks.
    macro_rules! process_exit_stubs {
        ($($sym:ident),* $(,)?) => {$(
            #[unsafe(no_mangle)]
            fn $sym() -> ! {
                unreachable!("workspace runners are not available in standalone executables")
            }
        )*};
    }
    process_exit_stubs!(
        __bun_dispatch__ProcessExit__TestParallelWorker__on_process_exit,
        __bun_dispatch__ProcessExit__FilterRunHandle__on_process_exit,
        __bun_dispatch__ProcessExit__MultiRunHandle__on_process_exit,
    );

    // C++ calls this from InternalModuleRegistry.cpp / ZigSourceProvider.cpp;
    // the real impl lives in `cli/test_command.rs` (cfg'd out under standalone).
    #[unsafe(no_mangle)]
    extern "C" fn BunTest__shouldGenerateCodeCoverage(_source_url: bun_core::String) -> bool {
        false
    }
}
