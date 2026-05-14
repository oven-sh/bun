//! Port of src/runtime/cli/cli.zig — CLI entry point + command dispatch.
//!
//! B-2 round 2: un-gate the help path. `Command::which()` + `HelpCommand`
//! + `print_version_and_exit` are real and compile against lower-tier crates.
//! `Command::start()` (full dispatch) and per-command exec bodies stay gated
//! behind `` — they need `bun_jsc`, `bun_bun_js`, transpiler,
//! and the not-yet-un-gated sibling `*_command.rs` modules.
//!
//! (Phase-A draft `cli_body.rs` has been folded in and deleted.)

use core::cell::Cell;

use bun_core::strings;
use bun_core::{self as bun, Global, Output};
use bun_core::{pretty, pretty_error, pretty_errorln};

// (Phase-A draft `cli_body.rs` removed — mod.rs is canonical.)

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "ci_info.rs"]
pub mod ci_info;
/// Port of the build.zig-registered `@import("ci_info")` module (output of
/// `src/codegen/ci_info.ts`). The Zig build emits `build/*/codegen/ci_info.zig`
/// from a static vendor table copied from watson/ci-info@4.0.0; since the Rust
/// build has no codegen hook for this yet, the table is hand-ported here from
/// that generated file. Keep in sync with `src/codegen/ci_info.ts`.
pub(crate) mod ci_info_generated {
    use bun_core::{getenv_z, zstr};

    macro_rules! env_set {
        ($k:literal) => {
            getenv_z(zstr!($k)).is_some()
        };
    }
    macro_rules! env_eq {
        ($k:literal, $v:literal) => {
            getenv_z(zstr!($k)).map_or(false, |v| v == $v.as_bytes())
        };
    }
    macro_rules! env_contains {
        ($k:literal, $needle:literal) => {
            getenv_z(zstr!($k)).map_or(false, |v| {
                bun_core::immutable::index_of(v, $needle.as_bytes()).is_some()
            })
        };
    }

    pub fn is_ci_uncached_generated() -> bool {
        env_set!("BUILD_ID")
            || env_set!("BUILD_NUMBER")
            || env_set!("CI")
            || env_set!("CI_APP_ID")
            || env_set!("CI_BUILD_ID")
            || env_set!("CI_BUILD_NUMBER")
            || env_set!("CI_NAME")
            || env_set!("CONTINUOUS_INTEGRATION")
            || env_set!("RUN_ID")
    }

    pub fn detect_uncached_generated() -> Option<&'static [u8]> {
        if env_set!("AGOLA_GIT_REF") {
            return Some(b"agola-ci");
        }
        if env_set!("AC_APPCIRCLE") {
            return Some(b"appcircle");
        }
        if env_set!("APPVEYOR") {
            return Some(b"appveyor");
        }
        if env_set!("CODEBUILD_BUILD_ARN") {
            return Some(b"aws-codebuild");
        }
        if env_set!("TF_BUILD") {
            return Some(b"azure-pipelines");
        }
        if env_set!("bamboo_planKey") {
            return Some(b"bamboo");
        }
        if env_set!("BITBUCKET_COMMIT") {
            return Some(b"bitbucket-pipelines");
        }
        if env_set!("BITRISE_IO") {
            return Some(b"bitrise");
        }
        if env_set!("BUDDY_WORKSPACE_ID") {
            return Some(b"buddy");
        }
        if env_set!("BUILDKITE") {
            return Some(b"buildkite");
        }
        if env_set!("CIRCLECI") {
            return Some(b"circleci");
        }
        if env_set!("CIRRUS_CI") {
            return Some(b"cirrus-ci");
        }
        if env_set!("CF_PAGES") {
            return Some(b"cloudflare-pages");
        }
        if env_set!("WORKERS_CI") {
            return Some(b"cloudflare-workers");
        }
        if env_set!("CF_BUILD_ID") {
            return Some(b"codefresh");
        }
        if env_set!("CM_BUILD_ID") {
            return Some(b"codemagic");
        }
        if env_eq!("CI_NAME", "codeship") {
            return Some(b"codeship");
        }
        if env_set!("DRONE") {
            return Some(b"drone");
        }
        if env_set!("DSARI") {
            return Some(b"dsari");
        }
        if env_set!("EARTHLY_CI") {
            return Some(b"earthly");
        }
        if env_set!("EAS_BUILD") {
            return Some(b"expo-application-services");
        }
        if env_set!("GERRIT_PROJECT") {
            return Some(b"gerrit");
        }
        if env_set!("GITEA_ACTIONS") {
            return Some(b"gitea-actions");
        }
        if env_set!("GITHUB_ACTIONS") {
            return Some(b"github-actions");
        }
        if env_set!("GITLAB_CI") {
            return Some(b"gitlab-ci");
        }
        if env_set!("GO_PIPELINE_LABEL") {
            return Some(b"gocd");
        }
        if env_set!("BUILDER_OUTPUT") {
            return Some(b"google-cloud-build");
        }
        if env_set!("HARNESS_BUILD_ID") {
            return Some(b"harness-ci");
        }
        if env_contains!("NODE", "/app/.heroku/node/bin/node") {
            return Some(b"heroku");
        }
        if env_set!("HUDSON_URL") {
            return Some(b"hudson");
        }
        if env_set!("JENKINS_URL") && env_set!("BUILD_ID") {
            return Some(b"jenkins");
        }
        if env_set!("LAYERCI") {
            return Some(b"layerci");
        }
        if env_set!("MAGNUM") {
            return Some(b"magnum-ci");
        }
        if env_set!("NETLIFY") {
            return Some(b"netlify-ci");
        }
        if env_set!("NEVERCODE") {
            return Some(b"nevercode");
        }
        if env_set!("PROW_JOB_ID") {
            return Some(b"prow");
        }
        if env_set!("RELEASE_BUILD_ID") {
            return Some(b"releasehub");
        }
        if env_set!("RENDER") {
            return Some(b"render");
        }
        if env_set!("SAILCI") {
            return Some(b"sail-ci");
        }
        if env_set!("SCREWDRIVER") {
            return Some(b"screwdriver");
        }
        if env_set!("SEMAPHORE") {
            return Some(b"semaphore");
        }
        if env_eq!("CI_NAME", "sourcehut") {
            return Some(b"sourcehut");
        }
        if env_set!("STRIDER") {
            return Some(b"strider-cd");
        }
        if env_set!("TASK_ID") && env_set!("RUN_ID") {
            return Some(b"taskcluster");
        }
        if env_set!("TEAMCITY_VERSION") {
            return Some(b"teamcity");
        }
        if env_set!("TRAVIS") {
            return Some(b"travis-ci");
        }
        if env_set!("VELA") {
            return Some(b"vela");
        }
        if env_set!("NOW_BUILDER") || env_set!("VERCEL") {
            return Some(b"vercel");
        }
        if env_set!("APPCENTER_BUILD_ID") {
            return Some(b"visual-studio-app-center");
        }
        if env_eq!("CI", "woodpecker") {
            return Some(b"woodpecker");
        }
        if env_set!("CI_XCODE_PROJECT") {
            return Some(b"xcode-cloud");
        }
        if env_set!("XCS") {
            return Some(b"xcode-server");
        }
        None
    }
}

#[path = "add_completions.rs"]
pub mod add_completions;
#[path = "colon_list_type.rs"]
pub mod colon_list_type;
#[path = "shell_completions.rs"]
pub mod shell_completions;
#[path = "which_npm_client.rs"]
pub mod which_npm_client;
// TODO(b2-blocked): list-of-yarn-commands.rs has duplicate phf_set! keys.
#[path = "discord_command.rs"]
pub mod discord_command;
#[path = "list-of-yarn-commands.rs"]
pub mod list_of_yarn_commands;

// ─── open (minimal open_url; full Editor/EditorContext stays gated) ──────────
// TODO(b2-blocked): full `open.rs` (Editor detection/spawn) needs
// `crate::process::spawn_sync`, `bun_threading::spawn_detached`,
// `bun_resolver::fs::FileSystem` — none of which are wired on this path yet.
// `bun discord` only needs `open_url`, so provide a thin print-fallback impl
// here until the heavy half compiles.
#[path = "open.rs"]
mod open_full;
pub mod open {
    pub use super::open_full::{Editor, EditorContext};
    use bun_core::Output;

    #[cfg(target_os = "macos")]
    pub const OPENER: &[u8] = b"/usr/bin/open";
    #[cfg(windows)]
    pub const OPENER: &[u8] = b"start";
    #[cfg(not(any(target_os = "macos", windows)))]
    pub const OPENER: &[u8] = b"xdg-open";

    fn fallback(url: &[u8]) {
        Output::prettyln(format_args!("-> {}", bstr::BStr::new(url)));
        Output::flush();
    }

    /// Minimal port of `open.openURL`. The Zig version spawns `OPENER url` and
    /// only falls back to printing on spawn failure; that path needs
    /// `bun.spawnSync` (gated). Until then, always take the fallback so
    /// `bun discord` is usable in headless/CI environments.
    pub fn open_url(url: &[u8]) {
        // TODO(port): wire `bun.spawnSync({ argv: [OPENER, url] })` once the
        // non-JSC spawn path is un-gated, then only fallback() on error.
        let _ = OPENER;
        fallback(url);
    }
}

// ─── non-JSC subcommand bodies (heavy; re-gated inside or here) ──────────────
// `init_command.rs` pulls bun_json/bun_js_parser/bun_js_printer/bun_bundler +
// `bun_ast::initialize_store`; `install_completions_command.rs`
// and `package_manager_command.rs` need bun_install::PackageManager + a real
// `Command::Context` (blocked on `create_context_data`). Help/print-only paths
// are handled inline in `Command::start()` below; full bodies stay gated.
#[path = "init_command.rs"]
pub mod init_command;
#[path = "install_completions_command.rs"]
pub mod install_completions_command;
#[path = "package_manager_command.rs"]
pub mod package_manager_command;

// ─── B-2 round 2: newly un-gated (thin surface, heavy bodies re-gated inside) ─
// phase-d: surfaced for `crate::test_runner::{bun_test,jest,Execution}` which
// need `CommandLineReporter`. This is the sole live mount of the file.
#[path = "test_command.rs"]
pub mod test_command;
/// `bun test` support modules (Scanner / ChangedFilesFilter / ParallelRunner).
/// Mounted here so `test_command.rs` can `use crate::cli::test::scanner` etc.
pub mod test {
    #[path = "Scanner.rs"]
    pub mod scanner;
    pub use scanner::Scanner;

    /// `bun test --changed`: git-diff → bundler module graph → reverse-import
    /// walk to filter test files. See `test/ChangedFilesFilter.zig`.
    #[path = "ChangedFilesFilter.rs"]
    pub mod changed_files_filter;
    pub use changed_files_filter as ChangedFilesFilter;

    /// `bun test --parallel`: process-pool coordinator/worker entry points.
    /// Thin façade re-exporting from `parallel::runner`.
    #[path = "ParallelRunner.rs"]
    pub mod parallel_runner;
    pub use parallel_runner as ParallelRunner;

    /// `test/parallel/` submodule directory (no `mod.rs` on disk; declared
    /// inline so paths stay 1:1 with the Zig directory). `ParallelRunner.rs`
    /// re-exports the public entry points from `runner`; the rest are
    /// implementation detail of the coordinator/worker split.
    pub mod parallel {
        #[path = "aggregate.rs"]
        pub mod aggregate;
        #[path = "Channel.rs"]
        pub mod channel;
        #[path = "Coordinator.rs"]
        pub mod coordinator;
        #[path = "FileRange.rs"]
        pub mod file_range;
        #[path = "Frame.rs"]
        pub mod frame;
        #[path = "runner.rs"]
        pub mod runner;
        #[path = "Worker.rs"]
        pub mod worker;
    }
}
#[path = "Arguments.rs"]
pub mod arguments;
pub use arguments as Arguments;
// bunfig.toml without a tier-6 dependency. Re-export under the original path so
// existing `crate::cli::bunfig` / `crate::cli::Bunfig` callers are unaffected.
pub use bun_bunfig::Bunfig;
pub use bun_bunfig::bunfig;
#[path = "run_command.rs"]
pub mod run_command;

// ─── per-subcommand bodies (un-gated for `Command::start` dispatch) ──────────
// Each maps 1:1 to a `*_command.zig`. Heavy bodies inside re-gate on whatever
// lower-tier crate surface they still need; the dispatch arm just calls
// `<Mod>Command::exec(ctx)`.
#[path = "build_command.rs"]
pub mod build_command;
#[path = "bunx_command.rs"]
pub mod bunx_command;
#[path = "create_command.rs"]
pub mod create_command;
#[path = "exec_command.rs"]
pub mod exec_command;
#[path = "fuzzilli_command.rs"]
pub mod fuzzilli_command;
#[path = "install_command.rs"]
pub mod install_command;
#[path = "repl_command.rs"]
pub mod repl_command;
#[path = "upgrade_command.rs"]
pub mod upgrade_command;
// MOVE_UP: `--analyze` branch + `Cli.log_` access of
// `bun_install::update_package_json_and_install{,_catch_error}` — see file header.
#[path = "add_command.rs"]
pub mod add_command;
#[path = "audit_command.rs"]
pub mod audit_command;
#[path = "filter_arg.rs"]
pub mod filter_arg;
#[path = "filter_run.rs"]
pub mod filter_run;
#[path = "link_command.rs"]
pub mod link_command;
#[path = "outdated_command.rs"]
pub mod outdated_command;
#[path = "pack_command.rs"]
pub mod pack_command;
#[path = "patch_command.rs"]
pub mod patch_command;
#[path = "patch_commit_command.rs"]
pub mod patch_commit_command;
#[path = "pm_pkg_command.rs"]
pub mod pm_pkg_command;
#[path = "pm_trusted_command.rs"]
pub mod pm_trusted_command;
pub mod pm_update_package_json;
#[path = "pm_version_command.rs"]
pub mod pm_version_command;
#[path = "pm_view_command.rs"]
pub mod pm_view_command;
#[path = "pm_why_command.rs"]
pub mod pm_why_command;
#[path = "publish_command.rs"]
pub mod publish_command;
#[path = "remove_command.rs"]
pub mod remove_command;
#[path = "scan_command.rs"]
pub mod scan_command;
#[path = "unlink_command.rs"]
pub mod unlink_command;
#[path = "update_command.rs"]
pub mod update_command;
#[path = "update_interactive_command.rs"]
pub mod update_interactive_command;
#[path = "why_command.rs"]
pub mod why_command;
pub use filter_run as FilterRun;
#[path = "multi_run.rs"]
pub mod multi_run;
pub use multi_run as MultiRun;

// ─── crate-local helper for param-table concatenation ────────────────────────
// `bun_clap::parse_param!` is a real proc-macro (const `Param<Help>` literal),
// and `bun_clap::concat_params!` is a const-fn slice concat (Zig comptime `++`),
// so combined tables (`AUTO_PARAMS`, `RUN_PARAMS`, …) are baked into rodata —
// no `LazyLock`, no init closure in `.text`, no startup heap allocation.
pub use ::bun_clap::concat_params;

// ─── process-lifetime globals ────────────────────────────────────────────────
/// Zig `var start_time: i128 = undefined;` — written once in `Cli::start`
/// during single-threaded startup, read freely after init. The backing
/// `OnceLock` lives in `bun_core` (single source of truth); this accessor
/// remains so existing `crate::cli::start_time()` callers don't churn.
#[inline]
pub fn start_time() -> i128 {
    bun_core::start_time()
}

#[allow(non_upper_case_globals)]
// PORT NOTE: Zig `?string` (borrowed slice) → owned `Box<[u8]>` so
// `process.title = "..."` (set_title) drops the previous value instead of
// leaking. The mutex provides exclusion between `get_title`/`set_title`
// (Zig: `var title_mutex = bun.Mutex{}`).
pub static Bun__Node__ProcessTitle: bun_threading::Guarded<Option<Box<[u8]>>> =
    bun_threading::Guarded::new(None);

/// Backing storage for [`cli_arena`]. Written exactly once in [`Cli::start`]
/// during single-threaded process startup (before `Command::start`, hence
/// before any `cli_arena()` / `cli_dupe` caller), then read freely — same
/// "init once in `start()`" shape as `cli::LOG_` and [`CMD`].
///
/// `RacyCell<MaybeUninit<…>>`, **not** `std::sync::LazyLock`: `LazyLock`'s init
/// thunk and the `std::sync::Once` poison/slow path it forces are `#[cold]`, and
/// fat-LTO parks them tens of MB away from the startup symbol cluster (the same
/// pathology documented for `OnceLock::set` on [`CMD`]). `cli_arena()` is on the
/// hot `bun <file>` / `bun run <script>` path (via `cli_dupe` / `cli_dupe_z` /
/// `runner_arena`), so a `LazyLock` there faults a fresh cold page on every
/// `bun` invocation. Zig's analogue was just a `default_allocator` handle / a
/// never-`deinit`'d `ArenaAllocator` — a plain cell is the correct shape.
pub(crate) static CLI_ARENA: bun_core::RacyCell<core::mem::MaybeUninit<bun_alloc::Arena>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

/// Process-lifetime arena for one-shot CLI commands. Zig passed
/// `bun.default_allocator` (or a per-command `ArenaAllocator` never `deinit`'d)
/// and let allocations live until exit.
///
/// **Main-thread only.** `MimallocArena`'s `Sync` impl is *contract-only*:
/// `mi_heap_*` allocation calls are thread-local, and
/// `MimallocArena::assert_owning_thread()` debug-panics on cross-thread alloc.
/// The heap is pinned to the thread that ran [`Cli::start`] (the CLI dispatch /
/// main thread, which is where the arena is constructed). Do not call from
/// worker/watcher threads.
#[inline]
pub fn cli_arena() -> &'static bun_alloc::Arena {
    // SAFETY: `CLI_ARENA` is written exactly once in `Cli::start` during
    // single-threaded startup, before `Command::start` runs and therefore
    // before any caller of `cli_arena()` / `cli_dupe` / `cli_dupe_z` exists.
    // Read-only for the rest of the process lifetime.
    unsafe { (*CLI_ARENA.get()).assume_init_ref() }
}

/// Dupe `s` into the process-lifetime CLI arena. Replaces ad-hoc
/// `s.to_vec().into_boxed_slice()` leaks at CLI sites where Zig used
/// `allocator.dupe(u8, s)` with the default allocator. Main-thread only
/// (see [`cli_arena`]).
#[inline]
pub fn cli_dupe(s: &[u8]) -> &'static [u8] {
    cli_arena().alloc_slice_copy(s)
}

/// Adopt an already-owned `Box<[u8]>` into a process-lifetime side-table and
/// return a `&'static [u8]` borrow — zero-copy (the `Box`'s heap allocation has
/// a stable address; only the `Box` value moves into the table). Use when the
/// caller already owns a large buffer (e.g. tarball, request body) so
/// [`cli_dupe`]'s memcpy + transient double-peak is avoided. Thread-safe.
pub fn cli_adopt(b: Box<[u8]>) -> &'static [u8] {
    static ADOPTED: std::sync::Mutex<Vec<Box<[u8]>>> = std::sync::Mutex::new(Vec::new());
    // SAFETY: `ADOPTED` is never cleared/drained for the process lifetime; the
    // `Box<[u8]>` pointee address is stable across `Vec` reallocs (only the
    // `Box` pointer-value moves), so the returned slice stays valid `'static`.
    let (ptr, len) = (b.as_ptr(), b.len());
    ADOPTED.lock().unwrap().push(b);
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

/// Dupe `s` into the process-lifetime CLI arena with a trailing NUL and
/// return the C-string pointer (for argv/envp construction).
#[inline]
pub fn cli_dupe_z(s: &[u8]) -> *const core::ffi::c_char {
    let buf: &'static mut [u8] = cli_arena().alloc_slice_fill_default(s.len() + 1);
    buf[..s.len()].copy_from_slice(s);
    // buf[s.len()] is already 0 (Default for u8).
    buf.as_ptr().cast::<core::ffi::c_char>()
}

thread_local! {
    pub static IS_MAIN_THREAD: Cell<bool> = const { Cell::new(false) };
}

/// `Cli.cmd` — set in `create_context_data` so crash reports / debug logging
/// can ask "which subcommand are we in". Set once during single-threaded
/// startup; read freely thereafter.
///
/// `RacyCell`, not `OnceLock`: `OnceLock::set` routes through stdlib's
/// `#[cold] fn initialize`, which fat-LTO places ~36 MB away from the
/// startup.order cluster and faults a fresh page on every `bun` invocation.
/// Zig used a plain `var cmd: ?Tag` here; the write happens before any
/// thread is spawned, so a bare cell is the correct shape.
pub static CMD: bun_core::RacyCell<Option<command::Tag>> = bun_core::RacyCell::new(None);

/// This is set `true` during `Command.which()` if argv0 is "node", in which the CLI is going
/// to pretend to be node.js by always choosing RunCommand with a relative filepath.
///
/// Canonical static lives in `bun_install` so both crates read/write the SAME
/// flag (`RunCommand::create_fake_temporary_node_executable` lives there).
pub use bun_install::PRETEND_TO_BE_NODE;

/// This is set `true` during `Command.which()` if argv0 is "bunx"
pub static IS_BUNX_EXE: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

bun_core::declare_scope!(CLI, hidden);

pub type LoaderColonList = colon_list_type::ColonListType<bun_options_types::schema::api::Loader>;
pub type DefineColonList = colon_list_type::ColonListType<&'static [u8]>;

impl colon_list_type::ColonListValue for bun_options_types::schema::api::Loader {
    const IS_LOADER: bool = true;
    fn resolve_value(input: &[u8]) -> Result<Self, bun_core::Error> {
        arguments::loader_resolver(input)
    }
}
impl colon_list_type::ColonListValue for &'static [u8] {
    fn resolve_value(input: &[u8]) -> Result<Self, bun_core::Error> {
        // SAFETY: argv slices are process-lifetime; see ColonListType::keys note.
        Ok(unsafe { bun_ptr::detach_lifetime(input) })
    }
}

#[cold]
pub fn invalid_target(diag: &mut bun_clap::Diagnostic, _target: &[u8]) -> ! {
    let _ = diag.report(Output::error_writer(), bun_core::err!("InvalidTarget"));
    Global::exit(1);
}

// ─── Cli (entry point) ───────────────────────────────────────────────────────
pub mod cli {
    use super::*;

    pub use bun_options_types::compile_target::CompileTarget;

    // Zig `var log_: logger.Log = undefined;` — process-global, init in start().
    pub static LOG_: bun_core::RacyCell<core::mem::MaybeUninit<bun_ast::Log>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

    /// `#[inline(never)]`: this is the first Rust call after `main()` (see
    /// `src/bun_bin/lib.rs`) and the head of the `bun <file>` / `bun run`
    /// startup chain. It must stay a concrete symbol so lld's
    /// `--symbol-ordering-file` (`src/startup.order`) can cluster it — and the
    /// callees it walks (`Command::start` → `which` → `create_context_data` →
    /// `Arguments::parse` → …) — into one contiguous front-loaded `.text` run.
    /// Without that, fat-LTO + `codegen-units=1` lay these out in
    /// crate-alphabetical order, scattering the cold-start path across pages
    /// shared with bundler/install/css/panic-format bodies.
    #[inline(never)]
    pub fn start() {
        IS_MAIN_THREAD.with(|c| c.set(true));
        // Mirror the threadlocal into the crash-handler crate's global so
        // `bun_crash_handler::cli_state::is_main_thread()` (used to print the
        // `panic(main thread): …` header) returns true on this thread. The
        // crash handler lives in a lower tier and can't read `IS_MAIN_THREAD`
        // directly, so it compares against a stored OS tid instead.
        bun_crash_handler::cli_state::set_main_thread_id(bun_threading::current_thread_id());
        bun_core::set_start_time(bun_core::time::nano_timestamp());
        // SAFETY: single-threaded process startup
        unsafe { (*LOG_.get()).write(bun_ast::Log::init()) };
        // Init the process-lifetime CLI arena here (not via `LazyLock` on first
        // use) — see `super::CLI_ARENA`. The write happens before any worker
        // thread is spawned and before `Command::start` (the first
        // `cli_arena()` caller), so a plain `RacyCell` is sound.
        // SAFETY: single-threaded process startup; `mimalloc` is already init.
        unsafe { (*super::CLI_ARENA.get()).write(bun_alloc::Arena::new()) };

        // TODO(b2-blocked): MainPanicHandler wiring.
        // SAFETY: just initialized above; single-threaded for the lifetime of `log`.
        let log = unsafe { (*LOG_.get()).assume_init_mut() };
        if let Err(err) = Command::start(log) {
            // Spec cli.zig:21 — print accumulated diagnostics BEFORE the
            // generic `handle_root_error` "An internal error occurred (..)"
            // message. The bake production path returns `error.BuildFailed`
            // with the actual parse/link errors sitting in `ctx.log` (== this
            // `log`); without this print, users see only the opaque error name.
            let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                bun_core::Output::error_writer(),
            ));
            bun_crash_handler::handle_root_error(err, None);
        }
    }
}
pub use cli as Cli;

// ─── debug_flags (resolve/print breakpoints) ─────────────────────────────────
pub mod debug_flags {
    // SHOW_CRASH_TRACE-only in Zig; harmless to always declare here.
    // PORT NOTE: `Vec<&'static [u8]>` (not `&'static [&[u8]]`) so `parse()` can
    // hand off ownership of the argv-borrowed list without leaking the backing
    // storage. Each `&'static [u8]` element is a process-lifetime argv slice.
    pub static RESOLVE_BREAKPOINTS: std::sync::OnceLock<Vec<&'static [u8]>> =
        std::sync::OnceLock::new();
    pub static PRINT_BREAKPOINTS: std::sync::OnceLock<Vec<&'static [u8]>> =
        std::sync::OnceLock::new();
}

// ─── HelpCommand ─────────────────────────────────────────────────────────────
pub mod help_command {
    use super::*;

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum Reason {
        Explicit,
        InvalidCommand,
    }

    #[cold]
    pub fn exec() -> Result<(), bun_core::Error> {
        exec_with_reason(Reason::Explicit)
    }

    // someone will get mad at me for this
    pub const PACKAGES_TO_REMOVE_FILLER: &[&str] = &[
        "moment",
        "underscore",
        "jquery",
        "backbone",
        "redux",
        "browserify",
        "webpack",
        "left-pad",
        "is-array",
        "babel-core",
        "@parcel/core",
    ];
    pub const PACKAGES_TO_ADD_FILLER: &[&str] = &[
        "elysia",
        "@shumai/shumai",
        "hono",
        "react",
        "lyra",
        "@remix-run/dev",
        "@evan/duckdb",
        "@zarfjs/zarf",
        "zod",
        "tailwindcss",
    ];
    pub const PACKAGES_TO_X_FILLER: &[&str] = &[
        "bun-repl", "next", "vite", "prisma", "nuxi", "prettier", "eslint",
    ];
    pub const PACKAGES_TO_CREATE_FILLER: &[&str] =
        &["next-app", "vite", "astro", "svelte", "elysia"];

    /// `cli_helptext_fmt` from cli.zig.
    ///
    /// PORT NOTE: emits the `pretty!`/`pretty_error!` call directly instead of
    /// expanding to a bare literal — `pretty!` captures its template as
    /// `$fmt:expr`, which is opaque to the `pretty_fmt!` proc-macro, so a
    /// nested `cli_helptext_fmt!()` inside `concat!()` would never be flattened.
    /// Taking the printer macro (and per-reason prefix line) as parameters keeps
    /// a single source of truth for the 35-line help body across both
    /// `Reason::Explicit` (stdout) and `Reason::InvalidCommand` (stderr).
    /// The spacing between commands is intentional.
    macro_rules! print_cli_helptext {
        ($printer:ident, $prefix:literal, $args:expr $(, $extra:expr)*) => {
            $printer!(
                concat!($prefix, "\
<b>Usage:<r> <b>bun \\<command\\> <cyan>[...flags]<r> <b>[...args]<r>

<b>Commands:<r>
  <b><magenta>run<r>       <d>./my-script.ts<r>       Execute a file with Bun
            <d>lint<r>                 Run a package.json script
  <b><magenta>test<r>                           Run unit tests with Bun
  <b><magenta>x<r>         <d>{:<16}<r>     Execute a package binary (CLI), installing if needed <d>(bunx)<r>
  <b><magenta>repl<r>                           Start a REPL session with Bun
  <b><magenta>exec<r>                           Run a shell script directly with Bun

  <b><blue>install<r>                        Install dependencies for a package.json <d>(bun i)<r>
  <b><blue>add<r>       <d>{:<16}<r>     Add a dependency to package.json <d>(bun a)<r>
  <b><blue>remove<r>    <d>{:<16}<r>     Remove a dependency from package.json <d>(bun rm)<r>
  <b><blue>update<r>    <d>{:<16}<r>     Update outdated dependencies
  <b><blue>audit<r>                          Check installed packages for vulnerabilities
  <b><blue>outdated<r>                       Display latest versions of outdated dependencies
  <b><blue>link<r>      <d>[\\<package\\>]<r>          Register or link a local npm package
  <b><blue>unlink<r>                         Unregister a local npm package
  <b><blue>publish<r>                        Publish a package to the npm registry
  <b><blue>patch <d>\\<pkg\\><r>                    Prepare a package for patching
  <b><blue>pm <d>\\<subcommand\\><r>                Additional package management utilities
  <b><blue>info<r>      <d>{:<16}<r>     Display package metadata from the registry
  <b><blue>why<r>       <d>{:<16}<r>     Explain why a package is installed

  <b><yellow>build<r>     <d>./a.ts ./b.jsx<r>       Bundle TypeScript & JavaScript into a single file

  <b><cyan>init<r>                           Start an empty Bun project from a built-in template
  <b><cyan>create<r>    <d>{:<16}<r>     Create a new project from a template <d>(bun c)<r>
  <b><cyan>upgrade<r>                        Upgrade to latest version of Bun.
  <b><cyan>feedback<r>  <d>./file1 ./file2<r>      Provide feedback to the Bun team.

  <d>\\<command\\><r> <b><cyan>--help<r>               Print help text for command.
"),
                $($extra,)*
                $args.0, $args.1, $args.2, $args.3, $args.4, $args.5, $args.6,
            )
        };
    }

    // PORT NOTE: Zig had `comptime reason: Reason` → const generic. Tag/Reason
    // lack `ConstParamTy` in lower-tier crates, so demoted to a runtime arg.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    pub fn print_with_reason(reason: Reason, show_all_flags: bool) {
        let mut rand = bun_core::rand::DefaultPrng::init(
            u64::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast"),
        );
        // Zig: rand.uintAtMost(len-1). xoshiro256++ next_u64() % len is close
        // enough for filler-word selection (no rejection sampling needed here).
        let mut pick = |n: usize| (rand.next_u64() as usize) % n;

        let package_x_i = pick(PACKAGES_TO_X_FILLER.len());
        let package_add_i = pick(PACKAGES_TO_ADD_FILLER.len());
        let package_remove_i = pick(PACKAGES_TO_REMOVE_FILLER.len());
        let package_create_i = pick(PACKAGES_TO_CREATE_FILLER.len());

        // PORT NOTE: filler tables are `&str` (not `&[u8]`) so the `{:<16}`
        // width spec actually pads — `Display for BStr` writes raw bytes and
        // ignores formatter width/alignment.
        let args = (
            PACKAGES_TO_X_FILLER[package_x_i],
            PACKAGES_TO_ADD_FILLER[package_add_i],
            PACKAGES_TO_REMOVE_FILLER[package_remove_i],
            PACKAGES_TO_ADD_FILLER[(package_add_i + 1) % PACKAGES_TO_ADD_FILLER.len()],
            PACKAGES_TO_ADD_FILLER[(package_add_i + 2) % PACKAGES_TO_ADD_FILLER.len()],
            PACKAGES_TO_ADD_FILLER[(package_add_i + 3) % PACKAGES_TO_ADD_FILLER.len()],
            PACKAGES_TO_CREATE_FILLER[package_create_i],
        );

        match reason {
            Reason::Explicit => {
                print_cli_helptext!(
                    pretty,
                    "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>({})<r>\n\n",
                    args,
                    Global::package_json_version_with_revision
                );
                if show_all_flags {
                    pretty!("\n<b>Flags:<r>");
                    bun_clap::simple_help_bun_top_level(arguments::AUTO_PARAMS);
                    pretty!(
                        "\n\n(more flags in <b>bun install --help<r>, <b>bun test --help<r>, and <b>bun build --help<r>)\n",
                    );
                }
                pretty!(
                    "\nLearn more about Bun:            <magenta>https://bun.com/docs<r>\n\
Join our Discord community:      <blue>https://bun.com/discord<r>\n"
                );
            }
            Reason::InvalidCommand => {
                print_cli_helptext!(
                    pretty_error,
                    "<r><red>Uh-oh<r> not sure what to do with that command.\n\n",
                    args
                );
            }
        }

        Output::flush();
    }

    #[cold]
    pub fn exec_with_reason(reason: Reason) -> ! {
        print_with_reason(reason, false);
        if reason == Reason::InvalidCommand {
            Global::exit(1);
        }
        Global::exit(0);
    }
}
pub use help_command as HelpCommand;

pub mod reserved_command {
    use super::*;

    #[cold]
    pub fn exec() -> Result<(), bun_core::Error> {
        let mut command_name: &[u8] = b"";
        for (i, arg) in bun::argv().iter().enumerate() {
            if i == 0 {
                continue;
            }
            if arg.len() > 1 && arg[0] == b'-' {
                continue;
            }
            command_name = arg;
            break;
        }
        if command_name.is_empty() {
            command_name = bun::argv().get(1).map(|z| z.as_bytes()).unwrap_or(b"");
        }
        pretty_error!(
            "<r><red>Uh-oh<r>. <b><yellow>bun {0}<r> is a subcommand reserved for future use by Bun.\n\nIf you were trying to run a package.json script called {0}, use <b><magenta>bun run {0}<r>.\n",
            bstr::BStr::new(command_name)
        );
        Output::flush();
        Global::exit(1);
    }
}
pub use reserved_command as ReservedCommand;

// ─── Command (Tag + which() + dispatch skeleton) ─────────────────────────────
pub mod command {
    use super::*;
    // Self-referential alias so `crate::command::Command` resolves (Zig: `pub const Command = struct {…}`).
    pub use super::Command;

    /// Collect `bun::argv()` into an indexable slice of `&'static ZStr`.
    /// `Argv` only exposes `.get(i)` / `.iter() -> &[u8]`; several Zig call
    /// sites (`bun.argv[n..]`) need a sliceable `&[&ZStr]`.
    #[inline]
    pub(super) fn argv_zslice() -> Vec<&'static bun_core::ZStr> {
        let a = bun::argv();
        (0..a.len()).map(|i| a.get(i).unwrap()).collect()
    }

    pub use bun_options_types::command_tag::Tag;
    pub use bun_options_types::command_tag::{
        ALWAYS_LOADS_CONFIG, LOADS_CONFIG, USES_GLOBAL_OPTIONS,
    };
    pub use bun_options_types::context::{
        Context, ContextData, DebugOptions, HotReload, RuntimeOptions, TestOptions,
    };

    // Zig: `var context_data: ContextData = undefined;` — process-lifetime
    // storage, written exactly once in `create_context_data` during
    // single-threaded startup. The pointer to it is published via
    // `bun_options_types::context::set_global` (single source of truth).
    static CONTEXT_DATA: bun_core::RacyCell<core::mem::MaybeUninit<ContextData>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

    /// Process-global CLI context. Only valid after `create_context_data` has run.
    ///
    /// # Safety
    /// Caller must guarantee `create_context_data` has been called and no other
    /// `&mut ContextData` is live (single-threaded CLI dispatch).
    #[inline]
    pub unsafe fn global_ctx() -> *mut ContextData {
        bun_options_types::context::global_ptr()
    }

    /// Zig: `pub fn get() Context` — process-global CLI context handle.
    #[inline]
    pub fn get() -> Context<'static> {
        // SAFETY: only called after `create_context_data` published the ctx
        // during single-threaded startup; callers treat the result as read-mostly.
        unsafe { &mut *bun_options_types::context::global_ptr() }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Canonical home: src/runtime/cli/mod.rs, inside `pub mod command { ... }`
    // (crate path `bun_runtime::cli::command::{is_bun_x, is_node, which}`).
    //
    // These ARE the live impls already invoked from `command::start()` at
    // mod.rs:1139 and read via `IS_BUNX_EXE` at mod.rs:1421. The Phase-A draft
    // copies in cli_body.rs are dead (private `mod cli_body;`, zero external
    // refs) and are removed wholesale by this dedup.
    //
    // One semantic back-port from the dead copy / Zig spec (cli.zig:411):
    // the `is_node` branch of `which()` must clear
    // `bun_clap::streaming::WARN_ON_UNRECOGNIZED_FLAG` so node-mode argv parsing
    // stays silent on unknown flags. The live mod.rs copy had dropped this line.
    // ──────────────────
    pub fn is_bun_x(argv0: &[u8]) -> bool {
        #[cfg(windows)]
        {
            return strings::ends_with(argv0, b"bunx.exe") || strings::ends_with(argv0, b"bunx");
        }
        #[cfg(not(windows))]
        {
            strings::ends_with(argv0, b"bunx")
        }
    }

    pub fn is_node(argv0: &[u8]) -> bool {
        #[cfg(windows)]
        {
            return strings::ends_with(argv0, b"node.exe") || strings::ends_with(argv0, b"node");
        }
        #[cfg(not(windows))]
        {
            strings::ends_with(argv0, b"node")
        }
    }

    /// Cheap argv prescan for the dominant `bun <path>` / `bun .` shape.
    ///
    /// `which()` classifies any first positional that isn't one of the ~40
    /// subcommand keywords as [`Tag::AutoCommand`] — but it pays for the
    /// `RootCommandMatcher` packed-u96 keyword table (and its rodata) to find
    /// that out, and `start()` then walks the full per-tag dispatch `match`.
    /// For a first positional that *looks* like a path — `.`/`..`, a `./`,
    /// `../`, `/` (or, on Windows, `\`, `.\`, `..\`, `X:\`) prefix, or
    /// anything whose basename carries a `.` (a file extension) — none of
    /// which can ever spell a subcommand keyword, so it is unambiguously
    /// `AutoCommand` and we can jump straight to the run path. Anything
    /// ambiguous (bare name like `run`/`x`, a leading `-flag`, a `node`/`bunx`
    /// shim, no args at all) falls through to `which()` unchanged.
    #[inline]
    pub(super) fn looks_like_run_entrypoint(arg: &[u8]) -> bool {
        // Empty or option-like: let `which()`'s leading-flag skip loop handle it.
        let Some(&first) = arg.first() else {
            return false;
        };
        if first == b'-' {
            return false;
        }
        if arg == b"." || arg == b".." {
            return true;
        }
        // Unix relative/absolute path prefixes.
        if first == b'/' || arg.starts_with(b"./") || arg.starts_with(b"../") {
            return true;
        }
        #[cfg(windows)]
        {
            if first == b'\\' || arg.starts_with(b".\\") || arg.starts_with(b"..\\") {
                return true;
            }
            // Drive-letter root: `C:\…` / `C:/…`.
            if arg.len() >= 3
                && first.is_ascii_alphabetic()
                && arg[1] == b':'
                && (arg[2] == b'\\' || arg[2] == b'/')
            {
                return true;
            }
        }
        // Has a `.` in the basename — `foo.js`, `dir/foo.ts`, `.dotfile`, …
        // (no subcommand keyword contains a `.`).
        let basename = match arg.iter().rposition(|&b| b == b'/' || b == b'\\') {
            Some(i) => &arg[i + 1..],
            None => arg,
        };
        basename.contains(&b'.')
    }

    /// `#[inline(never)]`: argv→`Tag` classification, called once from
    /// `Cli::start` on every `bun` invocation. Kept a concrete symbol so
    /// `src/startup.order` can place it next to `Cli::start` /
    /// `create_context_data` (and the `RootCommandMatcher` helpers it pulls
    /// in) in the front-loaded startup window, rather than letting fat-LTO
    /// inline-and-scatter it through cold code.
    #[inline(never)]
    pub fn which() -> Tag {
        let argv = bun::argv();
        let mut iter = argv.iter();
        let Some(argv0) = iter.next() else {
            return Tag::HelpCommand;
        };

        if is_bun_x(argv0) {
            if let Some(next) = argv.get(1) {
                let next_bytes = next.as_bytes();
                if next_bytes == b"add"
                    && bun_core::env_var::feature_flag::BUN_INTERNAL_BUNX_INSTALL.get()
                        == Some(true)
                {
                    return Tag::AddCommand;
                }
                if next_bytes == b"exec"
                    && bun_core::env_var::feature_flag::BUN_INTERNAL_BUNX_INSTALL.get()
                        == Some(true)
                {
                    return Tag::ExecCommand;
                }
            }
            // SAFETY: single-threaded startup
            IS_BUNX_EXE.store(true, core::sync::atomic::Ordering::Relaxed);
            return Tag::BunxCommand;
        }

        if is_node(argv0) {
            // Zig cli.zig:411 — node-mode must not warn on flags Bun doesn't know.
            bun_clap::streaming::WARN_ON_UNRECOGNIZED_FLAG
                .store(false, core::sync::atomic::Ordering::Relaxed);
            // SAFETY: single-threaded startup
            PRETEND_TO_BE_NODE.store(true, core::sync::atomic::Ordering::Relaxed);
            return Tag::RunAsNodeCommand;
        }

        let Some(mut first_arg_name) = iter.next() else {
            return Tag::AutoCommand;
        };
        while !first_arg_name.is_empty()
            && first_arg_name[0] == b'-'
            && !(first_arg_name.len() > 1 && first_arg_name[1] == b'e')
        {
            match iter.next() {
                Some(n) => first_arg_name = n,
                None => return Tag::AutoCommand,
            }
        }

        type RootCommandMatcher = strings::ExactSizeMatcher<12>;
        let x = RootCommandMatcher::r#match(first_arg_name);
        // PERF(port): Zig's `switch` over RootCommandMatcher cases compiles to a
        // jump table on the packed u96; Rust `if x == const` is a chain of
        // compares — profile in Phase B.
        if x == RootCommandMatcher::case(b"init") {
            return Tag::InitCommand;
        }
        if x == RootCommandMatcher::case(b"build") || x == RootCommandMatcher::case(b"bun") {
            return Tag::BuildCommand;
        }
        if x == RootCommandMatcher::case(b"discord") {
            return Tag::DiscordCommand;
        }
        if x == RootCommandMatcher::case(b"upgrade") {
            return Tag::UpgradeCommand;
        }
        if x == RootCommandMatcher::case(b"completions") {
            return Tag::InstallCompletionsCommand;
        }
        if x == RootCommandMatcher::case(b"getcompletes") {
            return Tag::GetCompletionsCommand;
        }
        if x == RootCommandMatcher::case(b"link") {
            return Tag::LinkCommand;
        }
        if x == RootCommandMatcher::case(b"unlink") {
            return Tag::UnlinkCommand;
        }
        if x == RootCommandMatcher::case(b"x") {
            return Tag::BunxCommand;
        }
        if x == RootCommandMatcher::case(b"repl") {
            return Tag::ReplCommand;
        }
        if x == RootCommandMatcher::case(b"i") || x == RootCommandMatcher::case(b"install") {
            for arg in argv.iter() {
                if arg == b"-g" || arg == b"--global" {
                    return Tag::AddCommand;
                }
            }
            return Tag::InstallCommand;
        }
        if x == RootCommandMatcher::case(b"ci") {
            return Tag::InstallCommand;
        }
        if x == RootCommandMatcher::case(b"c") || x == RootCommandMatcher::case(b"create") {
            return Tag::CreateCommand;
        }
        if x == RootCommandMatcher::case(b"test") {
            return Tag::TestCommand;
        }
        if x == RootCommandMatcher::case(b"pm") {
            return Tag::PackageManagerCommand;
        }
        if x == RootCommandMatcher::case(b"add") || x == RootCommandMatcher::case(b"a") {
            return Tag::AddCommand;
        }
        if x == RootCommandMatcher::case(b"update") {
            return Tag::UpdateCommand;
        }
        if x == RootCommandMatcher::case(b"patch") {
            return Tag::PatchCommand;
        }
        if x == RootCommandMatcher::case(b"patch-commit") {
            return Tag::PatchCommitCommand;
        }
        if x == RootCommandMatcher::case(b"r")
            || x == RootCommandMatcher::case(b"remove")
            || x == RootCommandMatcher::case(b"rm")
            || x == RootCommandMatcher::case(b"uninstall")
        {
            return Tag::RemoveCommand;
        }
        if x == RootCommandMatcher::case(b"run") {
            return Tag::RunCommand;
        }
        if x == RootCommandMatcher::case(b"help") {
            return Tag::HelpCommand;
        }
        if x == RootCommandMatcher::case(b"exec") {
            return Tag::ExecCommand;
        }
        if x == RootCommandMatcher::case(b"outdated") {
            return Tag::OutdatedCommand;
        }
        if x == RootCommandMatcher::case(b"publish") {
            return Tag::PublishCommand;
        }
        if x == RootCommandMatcher::case(b"audit") {
            return Tag::AuditCommand;
        }
        if x == RootCommandMatcher::case(b"info") {
            return Tag::InfoCommand;
        }
        // reserved
        if x == RootCommandMatcher::case(b"deploy")
            || x == RootCommandMatcher::case(b"cloud")
            || x == RootCommandMatcher::case(b"config")
            || x == RootCommandMatcher::case(b"use")
            || x == RootCommandMatcher::case(b"auth")
            || x == RootCommandMatcher::case(b"login")
            || x == RootCommandMatcher::case(b"logout")
            || x == RootCommandMatcher::case(b"prune")
        {
            return Tag::ReservedCommand;
        }
        if x == RootCommandMatcher::case(b"whoami") || x == RootCommandMatcher::case(b"list") {
            return Tag::PackageManagerCommand;
        }
        if x == RootCommandMatcher::case(b"why") {
            return Tag::WhyCommand;
        }
        if x == RootCommandMatcher::case(b"fuzzilli") {
            if bun_core::Environment::ENABLE_FUZZILLI {
                return Tag::FuzzilliCommand;
            }
            return Tag::AutoCommand;
        }
        if x == RootCommandMatcher::case(b"-e") {
            return Tag::AutoCommand;
        }
        Tag::AutoCommand
    }

    /// Initialize the process-global `CONTEXT_DATA` and publish it via
    /// `Context::set_global`. Shared by `create_context_data` and the
    /// standalone-graph fast path in `start()` (Zig: the bare
    /// `context_data = .{...}; global_cli_ctx = &context_data;` sequence).
    fn write_context_no_parse(log: &mut bun_ast::Log) -> &'static mut ContextData {
        // SAFETY: single-threaded CLI startup; first and only write to
        // `CONTEXT_DATA` for the process lifetime. `log` is the `&'static mut`
        // borrow of `Cli::LOG_` taken in `Cli::start()`, so storing its raw
        // address is sound for the process lifetime.
        //
        // One `ContextData::default()` is constructed and written in place,
        // then the two non-default fields are patched on the live storage —
        // avoids the second `Default` temporary (and its drop) that the
        // `..Default::default()` struct-update form would build on the stack.
        unsafe {
            let ctx = (*CONTEXT_DATA.get()).write(ContextData::default());
            ctx.log = std::ptr::from_mut::<bun_ast::Log>(log);
            ctx.start_time = bun_core::start_time();
            bun_options_types::context::set_global(ctx);
            ctx
        }
    }

    /// `ContextData.create` — populates the global ctx and runs `Arguments::parse`.
    ///
    /// PORT NOTE: Zig had `comptime command: Tag` → const generic. `Tag` lacks
    /// `ConstParamTy` (lower-tier crate), so demoted to a runtime arg; the only
    /// comptime-dependent bit was `Tag.uses_global_options.get(command)`, which
    /// the runtime `USES_GLOBAL_OPTIONS` set covers.
    /// Returns `&'static mut` to the process-global `CONTEXT_DATA`. Sound
    /// because CLI dispatch is single-threaded and this is the sole live
    /// borrow at the time of return; callers thread it down via the `ctx`
    /// parameter rather than re-deriving (Zig: `Context = *ContextData`).
    ///
    /// `#[inline(never)]`: this is the `init` step of the `bun run <script>`
    /// dispatch chain (`exec_auto_or_run → init → RunCommand::exec_with_cfg`)
    /// and must stay a concrete symbol so `src/startup.order` can place it —
    /// and the argv→Context parsing it pulls in — contiguously. `#[track_caller]`
    /// would otherwise make it an inlining candidate, scattering those callees.
    #[track_caller]
    #[inline(never)]
    pub fn create_context_data(
        cmd: Tag,
        log: &mut bun_ast::Log,
    ) -> Result<&'static mut ContextData, bun_core::Error> {
        // SAFETY: single-threaded CLI startup — no other thread exists yet.
        // `CMD` is read by crash-reporter / debug logging only.
        unsafe { CMD.write(Some(cmd)) };

        let ctx = write_context_no_parse(log);

        if USES_GLOBAL_OPTIONS[cmd] {
            ctx.args = arguments::parse(cmd, ctx)?;
        }

        #[cfg(windows)]
        {
            if ctx.debug.hot_reload == HotReload::Watch {
                // TODO(b2-blocked): bun_sys::windows::is_watcher_child /
                // become_watcher_manager — Windows watcher hand-off path.

                {
                    if !bun_sys::windows::is_watcher_child() {
                        bun_sys::windows::become_watcher_manager();
                    } else {
                        bun_core::set_auto_reload_on_crash(true);
                    }
                }
            }
        }

        Ok(ctx)
    }
    pub use create_context_data as init;

    /// Full subcommand dispatch.
    ///
    /// Kept deliberately tiny: every arm is a single call into a
    /// `#[cold] #[inline(never)]` helper so this compiles to a <1-page jump
    /// table. Previously this was a single 20 KB function and the
    /// `AutoCommand` arm body (the `bun --version` / `bun foo.js` hot path)
    /// sat at byte offset +0x142d behind ~5 KB of inlined standalone-graph
    /// setup and per-tag bodies — see perf sample 0x3d628fd. With the bodies
    /// out-lined, `start` is just `which()` + a `match` of tail calls.
    ///
    /// `#[inline(never)]`: the dispatch root must stay a concrete symbol so
    /// `src/startup.order`'s `--symbol-ordering-file` can anchor the `bun
    /// <file>` startup cluster on it (and keep `which` / `create_context_data`
    /// / `exec_auto_or_run` adjacent), instead of fat-LTO inlining it into
    /// `Cli::start` and re-scattering the per-tag tail calls.
    #[inline(never)]
    pub fn start(log: &mut bun_ast::Log) -> Result<(), bun_core::Error> {
        // WebView host subprocess entry. Must be before StandaloneModuleGraph,
        // before JSC init, before anything that touches a JS engine. The child
        // runs CFRunLoopRun() as its real main loop — no Bun runtime past this.
        // Spec: cli.zig:543.
        #[cfg(target_os = "macos")]
        {
            if let Some(fd_str) = bun_core::env_var::BUN_INTERNAL_WEBVIEW_HOST::get() {
                // Zig: `std.fmt.parseInt(u31, fd_str, 10)` — parse base-10 directly
                // from bytes; env var values are `&[u8]`, not assumed UTF-8.
                let fd: u32 = match bun_core::parse_int::<u32>(fd_str, 10).ok() {
                    Some(v) if v <= i32::MAX as u32 => v,
                    _ => Output::panic(format_args!(
                        "Invalid BUN_INTERNAL_WEBVIEW_HOST fd: {}",
                        bstr::BStr::new(fd_str),
                    )),
                };
                unsafe extern "C" {
                    // By-value `i32` only; noreturn entry point — no preconditions.
                    #[link_name = "Bun__WebView__hostMain"]
                    safe fn host_main(fd: i32) -> !;
                }
                host_main(fd as i32);
            }
        }

        // bun build --compile entry point
        if !bun_core::env_var::feature_flag::BUN_BE_BUN::get().unwrap_or(false) {
            if let Some(graph) = bun_standalone_graph::Graph::from_executable()? {
                // Never taken for a plain `bun` binary; ~2 KB of argv-splice
                // and ctx-setup code lives behind this cold call.
                return boot_standalone(graph, log);
            }
        }

        // Fast path: `bun -v` / `bun --version` / `bun --revision`, the
        // empty-eval forms `bun -e ''` / `bun -p ''` (and the `--eval=` /
        // `--print=` spellings), and the dominant `bun <path>` / `bun .` run
        // shape. Hoisted ABOVE `which()` and the per-tag `match` so these
        // common invocations never decode the subcommand-name classifier
        // (`which()` + its `RootCommandMatcher` name table / rodata) or walk
        // the per-tag dispatch `match`. `bun --version` also skips
        // `create_context_data` entirely (`arguments::parse` builds-and-drops
        // a full `api::TransformOptions` and forces two `LazyLock`s for what
        // is a no-op). Keeps `command::which`'s code/rodata and `arguments`'s
        // clap tables out of the `--version` / `bun <file>` working set.
        //
        // Correctness guards:
        //  * argv0 must be a plain `bun` invocation — a `node` / `bunx` shim
        //    must still fall through to `which()` so `node --version` reports
        //    Node's version, `bunx --version` is parsed by bunx, etc. Only
        //    the *predicates* are read here; `which()` performs the matching
        //    `PRETEND_TO_BE_NODE` / `IS_BUNX_EXE` side effects.
        //  * the standalone-graph probe above already ran, so a compiled
        //    executable's `--version` / `-e ''` is still passed through to
        //    user code (it returned via `boot_standalone`).
        //  * the version check is exact-argv-shape (`len == 2`) so it cannot
        //    intercept `bun <bin> --version`, where the flag belongs to
        //    `<bin>` (the bug the old Phase-C argv-scan shim had — see the
        //    NOTE below). The empty-eval check is likewise exact-shape, so it
        //    matches Zig's post-parse `eval.script.len == 0 &&
        //    positionals.len == 0` fall-through to `HelpCommand.exec`.
        {
            let argv = bun::argv();
            let argv0 = argv.get(0).map(bun_core::ZStr::as_bytes).unwrap_or(b"");
            if !is_node(argv0) && !is_bun_x(argv0) {
                if argv.len() == 2 {
                    match argv.get(1).map(bun_core::ZStr::as_bytes) {
                        Some(b"-v" | b"--version") => print_version_and_exit(),
                        Some(b"--revision") => print_revision_and_exit(),
                        _ => {}
                    }
                }

                let empty_eval = match argv.len() {
                    2 => matches!(
                        argv.get(1).map(bun_core::ZStr::as_bytes),
                        Some(b"-e=" | b"-p=" | b"--eval=" | b"--print=")
                    ),
                    3 => {
                        argv.get(2).is_some_and(|a| a.as_bytes().is_empty())
                            && matches!(
                                argv.get(1).map(bun_core::ZStr::as_bytes),
                                Some(b"-e" | b"-p" | b"--eval" | b"--print")
                            )
                    }
                    _ => false,
                };
                if empty_eval {
                    Output::flush();
                    return HelpCommand::exec();
                }

                // `bun <path>` / `bun .` — the dominant run shape. argv[1] is
                // path-shaped (`looks_like_run_entrypoint`), which no
                // subcommand keyword can be, so `which()` would unambiguously
                // return `Tag::AutoCommand`; short-circuit straight to that
                // arm so a plain `bun <file>` never decodes the subcommand
                // classifier (`which()` + its `RootCommandMatcher` keyword
                // table / rodata) or walks the per-tag dispatch `match` below.
                // Dispatches to exactly the arm `which()` would have selected,
                // so config loading / arg parsing / passthrough are unchanged.
                if argv
                    .get(1)
                    .map(bun_core::ZStr::as_bytes)
                    .is_some_and(looks_like_run_entrypoint)
                {
                    return exec_auto_or_run(Tag::AutoCommand, log);
                }
            }
        }

        let tag = which();

        // NOTE: a Phase-C shim used to scan all of `argv` here for
        // `--version`/`--help`/`--revision` and short-circuit, because
        // `Arguments::parse` was gated. That shim is removed now that
        // `arguments::parse` (called via `init` → `create_context_data`) is
        // live and honours `stop_after_positional_at = 1` — the shim broke
        // `bun <bin> --version` by intercepting the flag meant for `<bin>`.

        match tag {
            Tag::AutoCommand | Tag::RunCommand => exec_auto_or_run(tag, log),
            Tag::HelpCommand => HelpCommand::exec(),
            Tag::ReservedCommand => ReservedCommand::exec(),
            Tag::DiscordCommand => super::discord_command::DiscordCommand::exec(),
            Tag::InitCommand => exec_init(),
            Tag::InstallCompletionsCommand => exec_install_completions(),
            Tag::PackageManagerCommand => exec_pm(log),
            Tag::RunAsNodeCommand => exec_run_as_node(log),
            Tag::InfoCommand => bun_info(log),
            Tag::BuildCommand => exec_build(log),
            Tag::InstallCommand => exec_install(log),
            Tag::AddCommand => exec_add(log),
            Tag::UpdateCommand => exec_update(log),
            Tag::PatchCommand => exec_patch(log),
            Tag::PatchCommitCommand => exec_patch_commit(log),
            Tag::OutdatedCommand => exec_outdated(log),
            Tag::UpdateInteractiveCommand => exec_update_interactive(log),
            Tag::PublishCommand => exec_publish(log),
            Tag::AuditCommand => exec_audit(log),
            Tag::WhyCommand => exec_why(log),
            Tag::BunxCommand => exec_bunx(log),
            Tag::ReplCommand => exec_repl(log),
            Tag::RemoveCommand => exec_remove(log),
            Tag::LinkCommand => exec_link(log),
            Tag::UnlinkCommand => exec_unlink(log),
            Tag::TestCommand => exec_test(log),
            Tag::GetCompletionsCommand => bun_getcompletes(log),
            Tag::CreateCommand => bun_create(log),
            Tag::UpgradeCommand => exec_upgrade(log),
            Tag::ExecCommand => exec_exec(log),
            Tag::FuzzilliCommand => exec_fuzzilli(log),
        }
    }

    // ─── out-lined `start` arm bodies ───────────────────────────────────────
    // Every per-tag body lives in its own `#[cold] #[inline(never)]` fn so
    // `start` itself stays a jump table. The `Auto/Run` arm is the hot path
    // (`bun foo.js`, `bun --version`), so it gets `#[inline(never)]` only —
    // no `#[cold]` — to avoid pessimising branch weights / section placement.

    type CmdResult = Result<(), bun_core::Error>;

    /// `bun build --compile` standalone-executable boot. Never taken for a
    /// plain `bun` binary; out-lined so the ~2 KB of argv-splice / ctx-setup
    /// code is not decoded on the `bun --version` path.
    #[cold]
    #[inline(never)]
    fn boot_standalone(
        graph: *mut bun_standalone_graph::Graph,
        log: &mut bun_ast::Log,
    ) -> CmdResult {
        // SAFETY: `from_executable` returns a non-null `*mut Graph` whose
        // backing storage is process-static (owned by the executable image).
        let graph: &mut bun_standalone_graph::Graph = unsafe { &mut *graph };
        let mut offset_for_passthrough: usize = 0;

        let ctx: &mut ContextData = 'brk: {
            // PORT NOTE: Zig calls `bun.initArgv()` eagerly in `main.zig`
            // before `Cli.start`, which populates `bun_options_argc` from
            // `BUN_OPTIONS`. The Rust entry (`bun_bin::main`) defers argv
            // init to `bun_core::argv()`'s lazy `Once`, so force that init
            // now — otherwise `bun_options_argc()` reads 0 here and the
            // standalone executable silently drops `BUN_OPTIONS` flags.
            let original_argv_len = bun::argv().len();
            let bun_options_argc = bun::bun_options_argc();
            if !graph.compile_exec_argv.is_empty() || bun_options_argc > 0 {
                let mut argv_list: Vec<&'static bun_core::ZStr> = bun::argv().to_vec();
                if !graph.compile_exec_argv.is_empty() {
                    bun::append_options_env(graph.compile_exec_argv, &mut argv_list);
                }

                // Store the full argv including user arguments
                let full_argv: &'static [&'static bun_core::ZStr] = bun::intern_argv(argv_list);
                let num_exec_argv_options = full_argv.len().saturating_sub(original_argv_len);

                // Calculate offset: skip executable name + all exec argv options + BUN_OPTIONS args
                let num_parsed_options = num_exec_argv_options + bun_options_argc;
                offset_for_passthrough = if full_argv.len() > 1 {
                    1 + num_parsed_options
                } else {
                    0
                };

                // Temporarily set bun.argv to only include executable name + exec_argv options + BUN_OPTIONS args.
                // This prevents user arguments like --version/--help from being intercepted
                // by Bun's argument parser (they should be passed through to user code).
                // SAFETY: single-threaded startup; `full_argv` is process-static.
                unsafe {
                    bun::set_argv(&full_argv[..(1 + num_parsed_options).min(full_argv.len())]);
                }

                // Handle actual options to parse.
                let result = init(Tag::AutoCommand, log)?;

                // Restore full argv so passthrough calculation works correctly
                // SAFETY: single-threaded startup.
                unsafe { bun::set_argv(full_argv) };

                break 'brk result;
            }

            // If no compile_exec_argv, skip executable name if present
            offset_for_passthrough = 1.min(bun::argv().len());

            break 'brk write_context_no_parse(log);
        };

        ctx.args.target = Some(bun_options_types::schema::api::Target::Bun);
        use bun_options_types::global_cache::GlobalCache;
        if ctx.debug.global_cache == GlobalCache::auto {
            ctx.debug.global_cache = GlobalCache::disable;
        }

        ctx.passthrough = bun::argv()
            .iter()
            .skip(offset_for_passthrough)
            .map(|a| a.to_vec().into_boxed_slice())
            .collect();

        let entry_name = graph.entry_point().name.to_vec().into_boxed_slice();
        super::run_command::RunCommand::boot_standalone(ctx, entry_name, graph)?;
        Ok(())
    }

    /// `bun [run] <script>` / `bun --version` / bare `bun`. The dominant tag
    /// pair — kept out-of-line so `start` is a jump table, but *not* `#[cold]`.
    #[inline(never)]
    fn exec_auto_or_run(tag: Tag, log: &mut bun_ast::Log) -> CmdResult {
        // PORT NOTE: Zig's AutoCommand arm swallows
        // `error.MissingEntryPoint` from `Command.init` and prints
        // help. `bun_core::Error` has no variant table yet (B-1 stub
        // — `err!()` collapses to `Error::TODO`), so a name-match
        // would alias every error. Propagate for now; the empty-
        // positionals fallthrough below covers the common "no args"
        // help path anyway.
        // TODO(b2): restore `MissingEntryPoint → HelpCommand::exec()`
        // once `bun_core::Error` interns names.
        let ctx = init(tag, log)?;
        ctx.args.target = Some(bun_options_types::schema::api::Target::Bun);

        if ctx.parallel || ctx.sequential {
            // Result<Infallible, _>: if this returns at all, it's Err.
            let Err(err) = super::multi_run::run(ctx);
            pretty_errorln!("<r><red>error<r>: {}", err.name());
            Global::exit(1);
        }

        if !ctx.filters.is_empty() || ctx.workspaces {
            // Result<Infallible, _>: if this returns at all, it's Err.
            let Err(err) = super::filter_run::run_scripts_with_filter(ctx);
            pretty_errorln!("<r><red>error<r>: {}", err.name());
            Global::exit(1);
        }

        if tag == Tag::AutoCommand && !ctx.runtime_options.eval.script.is_empty() {
            return run_command::RunCommand::exec_eval(ctx);
        }

        if tag == Tag::AutoCommand && ctx.args.entry_points.len() == 1 {
            let extension = bun_paths::extension(&ctx.args.entry_points[0]);
            if extension == b".lockb" {
                return bun_lockb(ctx);
            }
        }

        if !ctx.positionals.is_empty() {
            let cfg = run_command::ExecCfg {
                bin_dirs_only: tag == Tag::AutoCommand,
                log_errors: tag != Tag::AutoCommand || !ctx.runtime_options.if_present,
                allow_fast_run_for_extensions: tag == Tag::AutoCommand,
            };
            if run_command::RunCommand::exec_with_cfg(ctx, cfg)? {
                return Ok(());
            }
            if tag == Tag::RunCommand {
                Global::exit(1);
            }
            return Ok(());
        }

        if tag == Tag::AutoCommand {
            Output::flush();
            return HelpCommand::exec();
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn exec_init() -> CmdResult {
        // InitCommand parses its own argv (no Context); Zig:
        //   .InitCommand => return try InitCommand.exec(allocator, bun.argv[@min(2, bun.argv.len)..])
        let argv = argv_zslice();
        super::init_command::InitCommand::exec(&argv[2.min(argv.len())..])
    }

    #[cold]
    #[inline(never)]
    fn exec_install_completions() -> CmdResult {
        // Minimal port of the non-interactive path: detect $SHELL and
        // dump the embedded completion script to stdout. Full install
        // (bunx symlink, fpath/XDG dir search, profile patching) needs
        // `install_completions_command.rs` un-gated.
        for a in bun::argv().iter().skip(2) {
            if matches!(a, b"--help" | b"-h") {
                tag_print_help(Tag::InstallCompletionsCommand, true);
                Global::exit(0);
            }
        }
        use super::shell_completions::ShellCompletionsExt as _;
        let shell = bun_core::env_var::SHELL::platform_get()
            .map(super::shell_completions::Shell::from_env)
            .unwrap_or_default();
        if matches!(shell, super::shell_completions::Shell::Unknown) {
            pretty_errorln!(
                "<r><red>error<r>: Unknown or unsupported shell. Please set $SHELL to one of zsh, fish, or bash."
            );
            Output::note("To manually output completions, run 'bun getcompletes'");
            Output::flush();
            Global::exit(1);
        }
        // `Output::writer()` returns the process-global writer; no raw
        // deref needed (was `*mut` in an earlier port pass).
        let writer = Output::writer();
        let _ = writer.write_all(shell.completions());
        Output::flush();
        // TODO(b2-blocked): tty path → write into shell completions dir
        // (InstallCompletionsCommand::exec).
        Global::exit(0);
    }

    #[cold]
    #[inline(never)]
    fn exec_run_as_node(log: &mut bun_ast::Log) -> CmdResult {
        let ctx = init(Tag::RunAsNodeCommand, log)?;
        run_command::RunCommand::exec_as_if_node(ctx)
    }

    #[cold]
    #[inline(never)]
    fn exec_bunx(log: &mut bun_ast::Log) -> CmdResult {
        let ctx = init(Tag::BunxCommand, log)?;
        let start_idx = if IS_BUNX_EXE.load(core::sync::atomic::Ordering::Relaxed) {
            0
        } else {
            1
        };
        let argv = argv_zslice();
        super::bunx_command::BunxCommand::exec(ctx, &argv[start_idx..])
    }

    #[cold]
    #[inline(never)]
    fn exec_repl(log: &mut bun_ast::Log) -> CmdResult {
        // PORT NOTE: Zig inits with .RunCommand here (repl reuses run params).
        let ctx = init(Tag::RunCommand, log)?;
        super::repl_command::ReplCommand::exec(ctx)
    }

    #[cold]
    #[inline(never)]
    fn exec_build(log: &mut bun_ast::Log) -> CmdResult {
        let ctx = init(Tag::BuildCommand, log)?;
        super::build_command::BuildCommand::exec(ctx, None)?;
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn exec_audit(log: &mut bun_ast::Log) -> CmdResult {
        let ctx = init(Tag::AuditCommand, log)?;
        super::audit_command::AuditCommand::exec(ctx)?;
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn exec_exec(log: &mut bun_ast::Log) -> CmdResult {
        let ctx = init(Tag::ExecCommand, log)?;
        if ctx.positionals.len() > 1 {
            super::exec_command::ExecCommand::exec(ctx)?;
        } else {
            tag_print_help(Tag::ExecCommand, true);
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn exec_fuzzilli(log: &mut bun_ast::Log) -> CmdResult {
        if bun_core::Environment::ENABLE_FUZZILLI {
            let ctx = init(Tag::FuzzilliCommand, log)?;
            return super::fuzzilli_command::FuzzilliCommand::exec(ctx);
        }
        Err(bun_core::err!("UnrecognizedCommand"))
    }

    /// Stamps out `#[cold] #[inline(never)] fn $name(log) { init($tag)?; $exec(ctx) }`
    /// for the trivial `init + exec` arms.
    macro_rules! cold_exec {
        ($( $name:ident => ($tag:ident, $($path:tt)+) ),* $(,)?) => {
            $(
                #[cold]
                #[inline(never)]
                fn $name(log: &mut bun_ast::Log) -> CmdResult {
                    let ctx = init(Tag::$tag, log)?;
                    $($path)+(ctx)
                }
            )*
        };
    }
    cold_exec! {
        exec_pm                 => (PackageManagerCommand, super::package_manager_command::PackageManagerCommand::exec),
        exec_install            => (InstallCommand,        super::install_command::InstallCommand::exec),
        exec_add                => (AddCommand,            super::add_command::AddCommand::exec),
        exec_update             => (UpdateCommand,         super::update_command::UpdateCommand::exec),
        exec_patch              => (PatchCommand,          super::patch_command::PatchCommand::exec),
        exec_patch_commit       => (PatchCommitCommand,    super::patch_commit_command::PatchCommitCommand::exec),
        exec_outdated           => (OutdatedCommand,       super::outdated_command::OutdatedCommand::exec),
        exec_update_interactive => (UpdateInteractiveCommand, super::update_interactive_command::UpdateInteractiveCommand::exec),
        exec_publish            => (PublishCommand,        super::publish_command::PublishCommand::exec),
        exec_why                => (WhyCommand,            super::why_command::WhyCommand::exec),
        exec_remove             => (RemoveCommand,         super::remove_command::RemoveCommand::exec),
        exec_link               => (LinkCommand,           super::link_command::LinkCommand::exec),
        exec_unlink             => (UnlinkCommand,         super::unlink_command::UnlinkCommand::exec),
        exec_test               => (TestCommand,           super::test_command::TestCommand::exec),
        exec_upgrade            => (UpgradeCommand,        super::upgrade_command::UpgradeCommand::exec),
    }

    // ─── helper fns hoisted from `Command.start` (kept out of `start` to keep
    //     its stack frame small; the original Zig had them as nested closures /
    //     inline blocks) ─────────────────────────────────────────────────────

    const DEFAULT_COMPLETIONS_LIST: &[&[u8]] = &[
        b"build", b"install", b"add", b"run", b"update", b"link", b"unlink", b"remove", b"create",
        b"bun", b"upgrade", b"discord", b"test", b"pm", b"x", b"repl", b"info",
    ];

    // PORT NOTE: Zig concatenated DEFAULT_COMPLETIONS_LIST ++ extras at
    // comptime; hand-rolled join (small, fixed).
    const REJECT_LIST: &[&[u8]] = &[
        b"build",
        b"install",
        b"add",
        b"run",
        b"update",
        b"link",
        b"unlink",
        b"remove",
        b"create",
        b"bun",
        b"upgrade",
        b"discord",
        b"test",
        b"pm",
        b"x",
        b"repl",
        b"info",
        // extras:
        b"build",
        b"completions",
        b"help",
    ];

    #[cold]
    #[inline(never)]
    fn bun_getcompletes(log: &mut bun_ast::Log) -> Result<(), bun_core::Error> {
        use super::add_completions;
        use super::run_command::{Filter, RunCommand};
        use super::shell_completions::ShellCompletions;

        let ctx = init(Tag::GetCompletionsCommand, log)?;
        // PORT NOTE: `ctx.positionals` is `Vec<Box<[u8]>>`; clone into a local
        // owned vec so `filter` doesn't borrow `ctx` (passed `&mut` below).
        let positionals: Vec<Box<[u8]>> = ctx.positionals.clone();
        let positionals_refs: Vec<&[u8]> = positionals.iter().map(|b| &**b).collect();
        let mut filter: &[&[u8]] = &positionals_refs;

        for (i, item) in filter.iter().enumerate() {
            if *item == b"getcompletes" {
                filter = if i + 1 < filter.len() {
                    &filter[i + 1..]
                } else {
                    &[]
                };
                break;
            }
        }
        let mut prefilled_completions: [&'static [u8]; add_completions::BIGGEST_LIST] =
            [b""; add_completions::BIGGEST_LIST];
        let mut completions = ShellCompletions::default();

        if filter.is_empty() {
            completions = RunCommand::completions::<{ Filter::All }>(
                ctx,
                Some(DEFAULT_COMPLETIONS_LIST),
                REJECT_LIST,
            )?;
        } else if filter[0] == b"s" {
            completions = RunCommand::completions::<{ Filter::Script }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"i" {
            completions = RunCommand::completions::<{ Filter::ScriptExclude }>(
                ctx,
                Some(DEFAULT_COMPLETIONS_LIST),
                REJECT_LIST,
            )?;
        } else if filter[0] == b"b" {
            completions = RunCommand::completions::<{ Filter::Bin }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"r" {
            completions = RunCommand::completions::<{ Filter::All }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"g" {
            completions =
                RunCommand::completions::<{ Filter::AllPlusBunJs }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"j" {
            completions = RunCommand::completions::<{ Filter::BunJs }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"z" {
            completions = RunCommand::completions::<{ Filter::ScriptAndDescriptions }>(
                ctx,
                None,
                REJECT_LIST,
            )?;
        } else if filter[0] == b"a" {
            use add_completions::FirstLetter;
            'outer: {
                if filter.len() > 1 && !filter[1].is_empty() {
                    let first_letter: FirstLetter = match filter[1][0] {
                        b'a' => FirstLetter::A,
                        b'b' => FirstLetter::B,
                        b'c' => FirstLetter::C,
                        b'd' => FirstLetter::D,
                        b'e' => FirstLetter::E,
                        b'f' => FirstLetter::F,
                        b'g' => FirstLetter::G,
                        b'h' => FirstLetter::H,
                        b'i' => FirstLetter::I,
                        b'j' => FirstLetter::J,
                        b'k' => FirstLetter::K,
                        b'l' => FirstLetter::L,
                        b'm' => FirstLetter::M,
                        b'n' => FirstLetter::N,
                        b'o' => FirstLetter::O,
                        b'p' => FirstLetter::P,
                        b'q' => FirstLetter::Q,
                        b'r' => FirstLetter::R,
                        b's' => FirstLetter::S,
                        b't' => FirstLetter::T,
                        b'u' => FirstLetter::U,
                        b'v' => FirstLetter::V,
                        b'w' => FirstLetter::W,
                        b'x' => FirstLetter::X,
                        b'y' => FirstLetter::Y,
                        b'z' => FirstLetter::Z,
                        _ => break 'outer,
                    };
                    add_completions::init();
                    let results = add_completions::get_packages(first_letter);

                    let mut prefilled_i: usize = 0;
                    for cur in results {
                        if cur.is_empty() || !strings::has_prefix(cur, filter[1]) {
                            continue;
                        }
                        prefilled_completions[prefilled_i] = cur;
                        prefilled_i += 1;
                        if prefilled_i >= prefilled_completions.len() {
                            break;
                        }
                    }
                    completions.commands =
                        std::borrow::Cow::Owned(prefilled_completions[0..prefilled_i].to_vec());
                }
            }
        }
        completions.print();
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn bun_create(log: &mut bun_ast::Log) -> Result<(), bun_core::Error> {
        use super::bunx_command::BunxCommand;
        use super::create_command::{CreateCommand, ExampleTag};
        use bun_core::ZStr;

        // These are templates from the legacy `bun create`
        // most of them aren't useful but these few are kinda nice.
        static HARDCODED_NON_BUN_X_LIST: phf::Set<&'static [u8]> = phf::phf_set! {
            b"elysia", b"elysia-buchta", b"stric",
        };

        // Create command wraps bunx
        let ctx = init(Tag::CreateCommand, log)?;
        let args = argv_zslice();

        if args.len() <= 2 {
            tag_print_help(Tag::CreateCommand, false);
            Global::exit(1);
        }

        let mut template_name_start: usize = 0;
        let mut positionals: [&[u8]; 2] = [b"", b""];
        let mut positional_i: usize = 0;
        let mut dash_dash_bun = false;
        let mut print_help = false;

        if args.len() > 2 {
            let remainder = &args[1..];
            let mut remainder_i: usize = 0;
            while remainder_i < remainder.len() && positional_i < positionals.len() {
                let slice = strings::trim(remainder[remainder_i].as_bytes(), b" \t\n");
                if !slice.is_empty() {
                    if !strings::has_prefix(slice, b"--") {
                        if positional_i == 1 {
                            template_name_start = remainder_i + 2;
                        }
                        positionals[positional_i] = slice;
                        positional_i += 1;
                    }
                    if slice[0] == b'-' {
                        if slice == b"--bun" {
                            dash_dash_bun = true;
                        } else if slice == b"--help" || slice == b"-h" {
                            print_help = true;
                        }
                    }
                }
                remainder_i += 1;
            }
        }

        if print_help
            // "bun create --" / "bun create -abc --"
            || positional_i == 0
            || positionals[1].is_empty()
        {
            tag_print_help(Tag::CreateCommand, true);
            Global::exit(0);
        }

        let template_name = positionals[1];

        // if template_name is "react" — deprecated; redirect to react-app/vite.
        if template_name == b"react" {
            pretty_errorln!(
                "The \"react\" template has been deprecated.\n\
It is recommended to use \"react-app\" or \"vite\" instead.\n\n\
To create a project using Create React App, run\n\n\
  <d>bun create react-app<r>\n\n\
To create a React project using Vite, run\n\n\
  <d>bun create vite<r>\n\n\
Then select \"React\" from the list of frameworks.\n"
            );
            Global::exit(1);
        }

        // if template_name is "next" — redirect to next-app.
        if template_name == b"next" {
            pretty_errorln!(
                "<yellow>warn: No template <b>create-next<r> found.\n\
To create a project with the official Next.js scaffolding tool, run\n\
  <b>bun create next-app <cyan>[destination]<r>"
            );
            Global::exit(1);
        }

        let create_command_info = CreateCommand::extract_info(&ctx)?;
        let template = create_command_info.template;
        let example_tag = create_command_info.example_tag;

        let use_bunx = !HARDCODED_NON_BUN_X_LIST.contains(template_name)
            && (!strings::contains(template_name, b"/")
                || strings::starts_with_char(template_name, b'@'))
            && example_tag != ExampleTag::LocalFolder;

        if use_bunx {
            let mut bunx_args: Vec<&ZStr> =
                Vec::with_capacity(2 + args.len() - template_name_start + (dash_dash_bun as usize));
            bunx_args.push(bun_core::zstr!("bunx"));
            if dash_dash_bun {
                bunx_args.push(bun_core::zstr!("--bun"));
            }
            // `add_create_prefix` returns an owned NUL-terminated buffer.
            // `bun create` is a one-shot CLI subcommand (ends in exec/exit), so
            // the prefixed package name is a process singleton — park the owning
            // `ZBox` in a `OnceLock` so the `&'static ZStr` borrow is sound
            // without leaking (PORTING.md §Forbidden patterns).
            static CREATE_PREFIX: std::sync::OnceLock<bun_core::ZBox> = std::sync::OnceLock::new();
            let prefixed = BunxCommand::add_create_prefix(template_name)?;
            bunx_args.push(
                CREATE_PREFIX
                    .get_or_init(|| bun_core::ZBox::from_vec_with_nul(prefixed))
                    .as_zstr(),
            );
            for src in &args[template_name_start..] {
                bunx_args.push(*src);
            }
            return BunxCommand::exec(ctx, &bunx_args);
        }

        CreateCommand::exec(&ctx, example_tag, template)
    }

    /// `bun ./bun.lockb` — print lockfile as yarn.lock (or its hash with `--hash`).
    #[cold]
    #[inline(never)]
    fn bun_lockb(ctx: &mut ContextData) -> Result<(), bun_core::Error> {
        use bun_install::lockfile::{Printer, PrinterFormat};

        for arg in bun::argv() {
            if arg == b"--hash" {
                let mut path_buf = bun_paths::PathBuffer::uninit();
                let entry = &ctx.args.entry_points[0];
                path_buf[..entry.len()].copy_from_slice(entry);
                path_buf[entry.len()] = 0;
                // SAFETY: NUL terminator written at `path_buf[entry.len()]` above.
                let lockfile_path = bun_core::ZStr::from_buf(&path_buf[..], entry.len());
                let file = match bun_sys::File::open(lockfile_path, bun_sys::O::RDONLY, 0) {
                    Ok(f) => f,
                    Err(err) => {
                        Output::err(err, "failed to open lockfile", ());
                        Global::crash();
                    }
                };
                return super::package_manager_command::PackageManagerCommand::print_hash(
                    ctx, file,
                );
            }
        }

        let entry = ctx.args.entry_points[0].clone();
        Printer::print(unsafe { ctx.log_mut() }, &entry, PrinterFormat::Yarn)
    }

    #[cold]
    #[inline(never)]
    fn bun_info(log: &mut bun_ast::Log) -> Result<(), bun_core::Error> {
        use bun_install::package_manager_real::{CommandLineArguments, Subcommand as PmSubcommand};
        use bun_install::{PackageManager, Subcommand};

        // Parse arguments manually since the standard flow doesn't work for standalone commands
        let cli = CommandLineArguments::parse(PmSubcommand::Info)?;
        let json_output = cli.json_output;
        let ctx = init(Tag::InfoCommand, log)?;
        let (pm, _) = PackageManager::init(ctx, cli, Subcommand::Info)?;

        // Handle arguments correctly for standalone info command
        let mut package_name: &[u8] = b"";
        let mut property_path: Option<&[u8]> = None;

        // Find non-flag arguments starting from argv[2] (after "bun info").
        let mut found_package = false;
        let argv = bun::argv();
        for arg in argv.iter().skip(2) {
            // Skip flags
            if !arg.is_empty() && arg[0] == b'-' {
                continue;
            }
            if !found_package {
                package_name = arg;
                found_package = true;
            } else {
                property_path = Some(arg);
                break;
            }
        }

        super::pm_view_command::view(pm, package_name, property_path, json_output)
    }

    /// Per-tag clap param table. Runtime dispatch (was const-generic in Zig;
    /// `Tag` lacks `ConstParamTy` here so demoted to a value param).
    pub fn tag_params(cmd: Tag) -> &'static [arguments::ParamType] {
        match cmd {
            Tag::AutoCommand => arguments::AUTO_PARAMS,
            Tag::RunCommand | Tag::RunAsNodeCommand => arguments::RUN_PARAMS,
            Tag::BuildCommand => arguments::BUILD_PARAMS,
            Tag::TestCommand => arguments::TEST_PARAMS,
            Tag::BunxCommand => arguments::RUN_PARAMS,
            _ => arguments::BASE_RUNTIME_TRANSPILER_PARAMS,
        }
    }

    pub fn tag_print_help(cmd: Tag, show_all_flags: bool) {
        // the output of --help uses the following syntax highlighting
        // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
        // use [foo] for multiple arguments or flags for foo.
        // use <bar> to emphasize 'bar'
        //
        // PORT NOTE: every help block here must pass its template as a *string
        // literal* to `pretty!()` so the `pretty_fmt!` proc-macro can rewrite
        // the `<tag>` markers at compile time. Passing a `const &str` through
        // `{}` (as the original Phase-A draft did) prints the raw markup.
        match cmd {
            Tag::AutoCommand | Tag::HelpCommand => {
                HelpCommand::print_with_reason(HelpCommand::Reason::Explicit, show_all_flags);
            }
            Tag::RunCommand | Tag::RunAsNodeCommand => {
                run_command::RunCommand::print_help(None);
            }
            Tag::BunxCommand => {
                pretty_errorln!(
                    "\
<b>Usage<r>: <b><green>bunx<r> <cyan>[flags]<r> <blue>\\<package\\><r><d>\\<@version\\><r> [flags and arguments for the package]<r>
Execute an npm package executable (CLI), automatically installing into a global shared cache if not installed in node_modules.

Flags:
  <cyan>--bun<r>                  Force the command to run with Bun instead of Node.js
  <cyan>-p, --package <blue>\\<package\\><r>    Specify package to install when binary name differs from package name
  <cyan>--no-install<r>           Skip installation if package is not already installed
  <cyan>--verbose<r>              Enable verbose output during installation
  <cyan>--silent<r>               Suppress output during installation

Examples<d>:<r>
  <b><green>bunx<r> <blue>prisma<r> migrate<r>
  <b><green>bunx<r> <blue>prettier<r> foo.js<r>
  <b><green>bunx<r> <cyan>-p @angular/cli<r> <blue>ng<r> new my-app
  <b><green>bunx<r> <cyan>--bun<r> <blue>vite<r> dev foo.js<r>
"
                );
                Output::flush();
            }
            Tag::BuildCommand => {
                pretty!(
                    "\
<b>Usage<r>:
  Transpile and bundle one or more files.
  <b><green>bun build<r> <cyan>[flags]<r> <blue>\\<entrypoint\\><r>

"
                );
                Output::flush();
                pretty!("<b>Flags:<r>");
                Output::flush();
                bun_clap::simple_help(arguments::BUILD_ONLY_PARAMS);
                pretty!(
                    "\n\n\
<b>Examples:<r>
  <d>Frontend web apps:<r>
  <b><green>bun build<r> <cyan>--outfile=bundle.js<r> <blue>./src/index.ts<r>
  <b><green>bun build<r> <cyan>--minify --splitting --outdir=out<r> <blue>./index.jsx ./lib/worker.ts<r>

  <d>Bundle code to be run in Bun (reduces server startup time)<r>
  <b><green>bun build<r> <cyan>--target=bun --outfile=server.js<r> <blue>./server.ts<r>

  <d>Creating a standalone executable (see https://bun.com/docs/bundler/executables)<r>
  <b><green>bun build<r> <cyan>--compile --outfile=my-app<r> <blue>./cli.ts<r>

A full list of flags is available at <magenta>https://bun.com/docs/bundler<r>
"
                );
                Output::flush();
            }
            Tag::TestCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun test<r> <cyan>[flags]<r> <blue>[\\<patterns\\>]<r>
  Run all matching test files and print the results to stdout"
                );
                Output::flush();
                pretty!("\n\n<b>Flags:<r>");
                Output::flush();
                bun_clap::simple_help(arguments::TEST_ONLY_PARAMS);
                pretty!(
                    "\n\n\
<b>Examples:<r>
  <d>Run all test files<r>
  <b><green>bun test<r>

  <d>Run all test files with \"foo\" or \"bar\" in the file name<r>
  <b><green>bun test<r> <blue>foo bar<r>

  <d>Run all test files, only including tests whose names includes \"baz\"<r>
  <b><green>bun test<r> <cyan>--test-name-pattern<r> <blue>baz<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/test<r>
"
                );
                Output::flush();
            }
            Tag::CreateCommand => {
                pretty!(
                    "\
<b>Usage<r><d>:<r>
  <b><green>bun create<r> <magenta>\\<MyReactComponent.(jsx|tsx)\\><r>
  <b><green>bun create<r> <magenta>\\<template\\><r> <cyan>[...flags]<r> <blue>dest<r>
  <b><green>bun create<r> <magenta>\\<github-org/repo\\><r> <cyan>[...flags]<r> <blue>dest<r>

<b>Environment variables<r><d>:<r>
  <cyan>GITHUB_TOKEN<r>         <d>Supply a token to download code from GitHub with a higher rate limit<r>
  <cyan>GITHUB_API_DOMAIN<r>    <d>Configure custom/enterprise GitHub domain. Default \"api.github.com\"<r>
  <cyan>NPM_CLIENT<r>           <d>Absolute path to the npm client executable<r>
  <cyan>BUN_CREATE_DIR<r>       <d>Custom path for global templates (default: $HOME/.bun-create)<r>

<b>React Component Projects<r><d>:<r>
  • Turn an existing React component into a complete frontend dev environment
  • Automatically starts a hot-reloading dev server
  • Auto-detects & configures TailwindCSS and shadcn/ui

  <b><magenta>bun create \\<MyReactComponent.(jsx|tsx)\\><r>

<b>Templates<r><d>:<r>
  • NPM: Runs <b><magenta>bunx create-\\<template\\><r> with given arguments
  • GitHub: Downloads repository contents as template
  • Local: Uses templates from $HOME/.bun-create/\\<name\\> or ./.bun-create/\\<name\\>

Learn more: <magenta>https://bun.com/docs/cli/bun-create<r>
"
                );
                Output::flush();
            }
            Tag::UpgradeCommand => {
                let (latest, switch_desc, switch_flag): (&str, &str, &str) =
                    if bun_core::Environment::IS_CANARY {
                        (
                            "canary",
                            "Switch from the canary version back to the latest stable release",
                            "stable",
                        )
                    } else {
                        (
                            "stable",
                            "Install the most recent canary version of Bun",
                            "canary",
                        )
                    };

                pretty!(
                    "\
<b>Usage<r>: <b><green>bun upgrade<r> <cyan>[flags]<r>
  Upgrade Bun

<b>Examples:<r>
  <d>Install the latest {} version<r>
  <b><green>bun upgrade<r>

  <d>{}<r>
  <b><green>bun upgrade<r> <cyan>--{}<r>

Full documentation is available at <magenta>https://bun.com/docs/installation#upgrading<r>
",
                    latest,
                    switch_desc,
                    switch_flag,
                );
                Output::flush();
            }
            Tag::ReplCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun repl<r> <cyan>[flags]<r>
  Open a Bun REPL
"
                );
                Output::flush();
            }
            Tag::ExecCommand => {
                pretty!(
                    "\
<b>Usage: bun exec <r><cyan>\\<script\\><r>

Execute a shell script directly from Bun.

<b><red>Note<r>: If executing this from a shell, make sure to escape the string!

<b>Examples<d>:<r>
  <b>bun exec \"echo hi\"<r>
  <b>bun exec \"echo \\\"hey friends\\\"!\"<r>
"
                );
                Output::flush();
            }
            Tag::GetCompletionsCommand => {
                pretty!("<b>Usage<r>: <b><green>bun getcompletes<r>");
                Output::flush();
            }
            Tag::PatchCommand => {
                pm_print_help(PmSubcommand::Patch);
            }
            Tag::PatchCommitCommand => {
                pm_print_help(PmSubcommand::PatchCommit);
            }
            Tag::OutdatedCommand => {
                pm_print_help(PmSubcommand::Outdated);
            }
            Tag::UpdateInteractiveCommand => {
                pm_print_help(PmSubcommand::Update);
            }
            Tag::PublishCommand => {
                pm_print_help(PmSubcommand::Publish);
            }
            Tag::AuditCommand => {
                pm_print_help(PmSubcommand::Audit);
            }
            Tag::InfoCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun info<r> <cyan>[flags]<r> <blue>\\<package\\><r><d>\\<@version\\><r> <blue>[property path]<r>
  Display package metadata from the registry.

<b>Examples:<r>
  <d>View basic information about a package<r>
  <b><green>bun info<r> <blue>react<r>

  <d>View specific version<r>
  <b><green>bun info<r> <blue>react@18.0.0<r>

  <d>View specific property<r>
  <b><green>bun info<r> <blue>react<r> version
  <b><green>bun info<r> <blue>react<r> dependencies
  <b><green>bun info<r> <blue>react<r> versions

Full documentation is available at <magenta>https://bun.com/docs/cli/info<r>
"
                );
                Output::flush();
            }
            Tag::WhyCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun why<r> <cyan>[flags]<r> <blue>\\<package\\><r><d>\\<@version\\><r> <blue>[property path]<r>
Explain why a package is installed

<b>Arguments:<r>
  <blue>\\<package\\><r>     <d>The package name to explain (supports glob patterns like '@org/*')<r>

<b>Options:<r>
  <cyan>--top<r>         <d>Show only the top dependency tree instead of nested ones<r>
  <cyan>--depth<r> <blue>\\<NUM\\><r> <d>Maximum depth of the dependency tree to display<r>

<b>Examples:<r>
  <d>$<r> <b><green>bun why<r> <blue>react<r>
  <d>$<r> <b><green>bun why<r> <blue>\"@types/*\"<r> <cyan>--depth<r> <blue>2<r>
  <d>$<r> <b><green>bun why<r> <blue>\"*-lodash\"<r> <cyan>--top<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/why<r>
"
                );
                Output::flush();
            }
            Tag::InitCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun init<r> <cyan>[flags]<r> <blue>[\\<folder\\>]<r>
  Initialize a Bun project in the current directory.
  Creates a package.json, tsconfig.json, and bunfig.toml if they don't exist.

<b>Flags<r>:
      <cyan>--help<r>             Print this menu
  <cyan>-y, --yes<r>              Accept all default options
  <cyan>-m, --minimal<r>          Only initialize type definitions
  <cyan>-r, --react<r>            Initialize a React project
      <cyan>--react=tailwind<r>   Initialize a React project with TailwindCSS
      <cyan>--react=shadcn<r>     Initialize a React project with @shadcn/ui and TailwindCSS

<b>Examples:<r>
  <b><green>bun init<r>
  <b><green>bun init<r> <cyan>--yes<r>
  <b><green>bun init<r> <cyan>--react<r>
  <b><green>bun init<r> <cyan>--react=tailwind<r> <blue>my-app<r>
"
                );
                Output::flush();
            }
            Tag::DiscordCommand => {
                pretty!("<b>Usage<r>: <b><green>bun discord<r>\n  Open Bun's Discord server.\n");
                Output::flush();
            }
            Tag::InstallCompletionsCommand => {
                pretty!("<b>Usage<r>: <b><green>bun completions<r>\n");
                Output::flush();
            }
            Tag::PackageManagerCommand => {
                pretty!(
                    "\
<b>Usage<r>: <b><green>bun pm<r> <cyan>[flags]<r> <blue>[\\<command\\>]<r>
  Run package manager utilities.

<b>Commands:<r>
  <b><green>bun pm<r> <blue>bin<r>              print the path to bin folder
  <b><green>bun pm<r> <blue>ls<r>               list the dependency tree according to the current lockfile
  <b><green>bun pm<r> <blue>whoami<r>           print the current npm username
  <b><green>bun pm<r> <blue>hash<r>             generate & print the hash of the current lockfile
  <b><green>bun pm<r> <blue>cache<r>            print the path to the cache folder
  <b><green>bun pm<r> <blue>cache rm<r>         clear the cache

Learn more about these at <magenta>https://bun.com/docs/cli/pm<r>
"
                );
                Output::flush();
            }
            _ => HelpCommand::print_with_reason(HelpCommand::Reason::Explicit, false),
        }
    }

    use bun_install::package_manager_real::Subcommand as PmSubcommand;

    /// Forward to `bun_install::PackageManager::CommandLineArguments::print_help`.
    #[inline]
    fn pm_print_help(subcommand: PmSubcommand) {
        bun_install::package_manager_real::CommandLineArguments::print_help(subcommand);
    }
}
pub use command as Command;

// NOT `#[cold]` — `bun --version` is the most-benchmarked startup path, and
// `#[cold]` relocates the body to `.text.unlikely` ~40 MB past the
// startup.order cluster. The symbol is listed in src/startup.order instead.
pub fn print_version_and_exit() -> ! {
    // The version string is plain ASCII (no `<tag>` markup), so bypass
    // `Output::pretty(format_args!(..))` — that path renders the `Arguments`
    // into a heap `String`, then runs the runtime `<tag>` rewriter into a
    // second `Vec<u8>`, all to print a ~10-byte constant. Write the bytes
    // straight to the buffered stdout writer instead. One `write_all` (the
    // `\n` is baked into the constant) → one syscall, matching Zig's
    // `writeAll(version ++ "\n")`.
    let w = Output::writer();
    let _ = w.write_all(Global::package_json_version_nl.as_bytes());
    Output::flush();
    Global::exit(0);
}

#[cold]
pub fn print_revision_and_exit() -> ! {
    // See `print_version_and_exit` — plain bytes, no `<tag>` rewrite needed.
    let w = Output::writer();
    let _ = w.write_all(Global::package_json_version_with_revision.as_bytes());
    let _ = w.write_all(b"\n");
    Output::flush();
    Global::exit(0);
}

// ported from: src/runtime/cli/cli.zig
