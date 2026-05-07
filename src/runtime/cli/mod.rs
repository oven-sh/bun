//! Port of src/runtime/cli/cli.zig — CLI entry point + command dispatch.
//!
//! B-2 round 2: un-gate the help path. `Command::which()` + `HelpCommand`
//! + `print_version_and_exit` are real and compile against lower-tier crates.
//! `Command::start()` (full dispatch) and per-command exec bodies stay gated
//! behind `` — they need `bun_jsc`, `bun_bun_js`, transpiler,
//! and the not-yet-un-gated sibling `*_command.rs` modules.
//!
//! The full Phase-A draft is preserved verbatim in `cli_body.rs` (still
//! ``-gated as a reference for the next un-gate round).

use core::cell::Cell;

use bun_core::{self as bun, Global, Output};
use bun_core::{pretty, pretty_error, pretty_errorln};
use bun_logger as logger;
use bun_str::strings;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────

#[path = "cli_body.rs"]
mod cli_body;

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "ci_info.rs"]
pub mod ci_info;
/// Stub for the build.zig-registered `@import("ci_info")` module (output of
/// `src/codegen/ci_info.ts`). Real codegen wiring lands in Phase B; until then
/// the generated probes are no-ops so `ci_info::is_ci`/`detect_ci_name` compile.
// TODO(port): wire to actual codegen output (src/codegen/ci_info.ts).
pub(crate) mod ci_info_generated {
    #[inline]
    pub fn is_ci_uncached_generated() -> bool { false }
    #[inline]
    pub fn detect_uncached_generated() -> Option<&'static [u8]> { None }
}

#[path = "which_npm_client.rs"]
pub mod which_npm_client;
#[path = "add_completions.rs"]
pub mod add_completions;
#[path = "colon_list_type.rs"]
pub mod colon_list_type;
#[path = "shell_completions.rs"]
pub mod shell_completions;
// TODO(b2-blocked): list-of-yarn-commands.rs has duplicate phf_set! keys.
 #[path = "list-of-yarn-commands.rs"]
pub mod list_of_yarn_commands;
#[path = "discord_command.rs"]
pub mod discord_command;

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
// `crate::create_command::initialize_store`; `install_completions_command.rs`
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
// need `CommandLineReporter`. `cli_body`'s private `mod test_command;` is
// ``-gated, so this is the sole live mount of the file.
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
        #[path = "runner.rs"]
        pub mod runner;
        #[path = "Coordinator.rs"]
        pub mod coordinator;
        #[path = "Worker.rs"]
        pub mod worker;
        #[path = "Channel.rs"]
        pub mod channel;
        #[path = "Frame.rs"]
        pub mod frame;
        #[path = "FileRange.rs"]
        pub mod file_range;
        #[path = "aggregate.rs"]
        pub mod aggregate;
    }
}
#[path = "Arguments.rs"]
pub mod arguments;
pub use arguments as Arguments;
// MOVE_DOWN(b0): bunfig parser moved to `bun_bunfig` so `bun_install` can load
// bunfig.toml without a tier-6 dependency. Re-export under the original path so
// existing `crate::cli::bunfig` / `crate::cli::Bunfig` callers are unaffected.
pub use bun_bunfig::bunfig;
pub use bun_bunfig::Bunfig;
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
#[path = "repl_command.rs"]
pub mod repl_command;
#[path = "upgrade_command.rs"]
pub mod upgrade_command;
#[path = "fuzzilli_command.rs"]
pub mod fuzzilli_command;
#[path = "install_command.rs"]
pub mod install_command;
// MOVE_UP: `--analyze` branch + `Cli.log_` access of
// `bun_install::update_package_json_and_install{,_catch_error}` — see file header.
pub mod pm_update_package_json;
#[path = "add_command.rs"]
pub mod add_command;
#[path = "remove_command.rs"]
pub mod remove_command;
#[path = "update_command.rs"]
pub mod update_command;
#[path = "update_interactive_command.rs"]
pub mod update_interactive_command;
#[path = "link_command.rs"]
pub mod link_command;
#[path = "unlink_command.rs"]
pub mod unlink_command;
#[path = "patch_command.rs"]
pub mod patch_command;
#[path = "patch_commit_command.rs"]
pub mod patch_commit_command;
#[path = "outdated_command.rs"]
pub mod outdated_command;
#[path = "publish_command.rs"]
pub mod publish_command;
#[path = "audit_command.rs"]
pub mod audit_command;
#[path = "why_command.rs"]
pub mod why_command;
#[path = "pm_view_command.rs"]
pub mod pm_view_command;
#[path = "pm_pkg_command.rs"]
pub mod pm_pkg_command;
#[path = "pm_trusted_command.rs"]
pub mod pm_trusted_command;
#[path = "pm_version_command.rs"]
pub mod pm_version_command;
#[path = "pm_why_command.rs"]
pub mod pm_why_command;
#[path = "pack_command.rs"]
pub mod pack_command;
#[path = "scan_command.rs"]
pub mod scan_command;
#[path = "filter_arg.rs"]
pub mod filter_arg;
#[path = "filter_run.rs"]
pub mod filter_run;
pub use filter_run as FilterRun;
#[path = "multi_run.rs"]
pub mod multi_run;
pub use multi_run as MultiRun;

// ─── crate-local helper for param-table concatenation ────────────────────────
// `bun_clap::parse_param!` is now a real proc-macro (const `Param<Help>`
// literal), so leaf param tables in `Arguments.rs` are `&'static [ParamType]`.
// Zig concatenated them at comptime with `++`; Rust has no const slice concat,
// so the *combined* tables (`AUTO_PARAMS`, `RUN_PARAMS`, …) stay
// `LazyLock<Vec<_>>` built via this runtime concat. `Param<Help>` is `Copy`,
// so this is a cheap memcpy on first access.
#[macro_export]
#[doc(hidden)]
macro_rules! __cli_concat_params {
    ($($part:expr),* $(,)?) => {{
        let mut __v: ::std::vec::Vec<::bun_clap::Param<::bun_clap::Help>> =
            ::std::vec::Vec::new();
        $( __v.extend_from_slice(&$part[..]); )*
        __v
    }};
}
pub use crate::__cli_concat_params as concat_params;

// ─── process-lifetime globals ────────────────────────────────────────────────
// Zig `var start_time: i128 = undefined;` — written once in `Cli::start`
// during single-threaded startup. `i128` has no atomic; `RacyCell` is the
// alias-safe static cell (read freely after init).
pub static START_TIME: bun_core::RacyCell<i128> = bun_core::RacyCell::new(0);

#[allow(non_upper_case_globals)]
// PORT NOTE: Zig `?string` (borrowed slice) → owned `Box<[u8]>` so
// `process.title = "..."` (set_title) drops the previous value instead of
// leaking. Guarded by `node::process::TITLE_MUTEX`.
pub static Bun__Node__ProcessTitle: bun_core::RacyCell<Option<Box<[u8]>>> =
    bun_core::RacyCell::new(None);

thread_local! {
    pub static IS_MAIN_THREAD: Cell<bool> = const { Cell::new(false) };
}

/// `Cli.cmd` — set in `create_context_data` so crash reports / debug logging
/// can ask "which subcommand are we in". Set once during single-threaded
/// startup; read freely thereafter.
pub static CMD: bun_core::RacyCell<Option<command::Tag>> = bun_core::RacyCell::new(None);

/// This is set `true` during `Command.which()` if argv0 is "node", in which the CLI is going
/// to pretend to be node.js by always choosing RunCommand with a relative filepath.
pub static PRETEND_TO_BE_NODE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// This is set `true` during `Command.which()` if argv0 is "bunx"
pub static IS_BUNX_EXE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

bun_core::declare_scope!(CLI, hidden);

pub type LoaderColonList = colon_list_type::ColonListType<bun_options_types::schema::api::Loader>;
pub type DefineColonList = colon_list_type::ColonListType<&'static [u8]>;

impl colon_list_type::ColonListValue for bun_options_types::schema::api::Loader {
    const IS_LOADER: bool = true;
    fn resolve_value(_input: &[u8]) -> Result<Self, bun_core::Error> {
        // TODO(b2-blocked): bun_bundler::options::Loader::from_string → to_api
        Err(bun_core::err!("InvalidLoader"))
    }
}
impl colon_list_type::ColonListValue for &'static [u8] {
    fn resolve_value(input: &[u8]) -> Result<Self, bun_core::Error> {
        // SAFETY: argv slices are process-lifetime; see ColonListType::keys note.
        Ok(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(input) })
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

    pub use bun_options_types::CompileTarget::CompileTarget;

    // Zig `var log_: logger.Log = undefined;` — process-global, init in start().
    pub static LOG_: bun_core::RacyCell<core::mem::MaybeUninit<logger::Log>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

    pub fn start() {
        IS_MAIN_THREAD.with(|c| c.set(true));
        // SAFETY: single-threaded process startup; no other reader yet
        unsafe { START_TIME.write(bun_core::time::nano_timestamp()) };
        bun_core::set_start_time(unsafe { START_TIME.read() });
        // SAFETY: single-threaded process startup
        unsafe { (*LOG_.get()).write(logger::Log::init()) };

        // TODO(b2-blocked): MainPanicHandler wiring. Full body in cli_body.rs.
        // SAFETY: just initialized above; single-threaded for the lifetime of `log`.
        let log = unsafe { (*LOG_.get()).assume_init_mut() };
        if let Err(err) = Command::start(log) {
            // TODO(b2): `Log::print` wants `&mut impl fmt::Write`;
            // `Output::error_writer()` is `*mut io::Writer`. Route through a
            // shim once io::Writer implements fmt::Write.
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
    pub static RESOLVE_BREAKPOINTS: bun_core::RacyCell<Vec<&'static [u8]>> =
        bun_core::RacyCell::new(Vec::new());
    pub static PRINT_BREAKPOINTS: bun_core::RacyCell<Vec<&'static [u8]>> =
        bun_core::RacyCell::new(Vec::new());
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
        "moment", "underscore", "jquery", "backbone", "redux", "browserify",
        "webpack", "left-pad", "is-array", "babel-core", "@parcel/core",
    ];
    pub const PACKAGES_TO_ADD_FILLER: &[&str] = &[
        "elysia", "@shumai/shumai", "hono", "react", "lyra",
        "@remix-run/dev", "@evan/duckdb", "@zarfjs/zarf", "zod", "tailwindcss",
    ];
    pub const PACKAGES_TO_X_FILLER: &[&str] = &[
        "bun-repl", "next", "vite", "prisma", "nuxi", "prettier", "eslint",
    ];
    pub const PACKAGES_TO_CREATE_FILLER: &[&str] = &[
        "next-app", "vite", "astro", "svelte", "elysia",
    ];

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
                    bun_clap::simple_help_bun_top_level(arguments::AUTO_PARAMS.as_slice());
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
            if i == 0 { continue; }
            if arg.len() > 1 && arg[0] == b'-' { continue; }
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

    pub use bun_options_types::CommandTag::Tag;
    pub use bun_options_types::CommandTag::{
        ALWAYS_LOADS_CONFIG, LOADS_CONFIG, USES_GLOBAL_OPTIONS,
    };
    pub use bun_options_types::Context::{
        Context, ContextData, DebugOptions, HotReload, RuntimeOptions, TestOptions,
    };

    // Zig: `var global_cli_ctx: Context = undefined;` + `var context_data: ContextData = undefined;`
    // Process-lifetime singletons; written exactly once in `create_context_data`
    // during single-threaded startup, read everywhere thereafter.
    static GLOBAL_CLI_CTX: core::sync::atomic::AtomicPtr<ContextData> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());
    static CONTEXT_DATA: bun_core::RacyCell<core::mem::MaybeUninit<ContextData>> =
        bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());

    /// Process-global CLI context. Only valid after `create_context_data` has run.
    ///
    /// # Safety
    /// Caller must guarantee `create_context_data` has been called and no other
    /// `&mut ContextData` is live (single-threaded CLI dispatch).
    #[inline]
    pub unsafe fn global_ctx() -> *mut ContextData {
        GLOBAL_CLI_CTX.load(core::sync::atomic::Ordering::Relaxed)
    }

    /// Zig: `pub fn get() Context` — process-global CLI context handle.
    #[inline]
    pub fn get() -> Context<'static> {
        // SAFETY: only called after `create_context_data` initialized GLOBAL_CLI_CTX
        // during single-threaded startup; callers treat the result as read-mostly.
        unsafe { &mut *GLOBAL_CLI_CTX.load(core::sync::atomic::Ordering::Relaxed) }
    }

    pub fn is_bun_x(argv0: &[u8]) -> bool {
        #[cfg(windows)]
        { return strings::ends_with(argv0, b"bunx.exe") || strings::ends_with(argv0, b"bunx"); }
        #[cfg(not(windows))]
        { strings::ends_with(argv0, b"bunx") }
    }

    pub fn is_node(argv0: &[u8]) -> bool {
        #[cfg(windows)]
        { return strings::ends_with(argv0, b"node.exe") || strings::ends_with(argv0, b"node"); }
        #[cfg(not(windows))]
        { strings::ends_with(argv0, b"node") }
    }

    pub fn which() -> Tag {
        let argv = bun::argv();
        let mut iter = argv.iter();
        let Some(argv0) = iter.next() else { return Tag::HelpCommand };

        if is_bun_x(argv0) {
            if let Some(next) = argv.get(1) {
                let next_bytes = next.as_bytes();
                if next_bytes == b"add"
                    && bun_core::env_var::feature_flag::BUN_INTERNAL_BUNX_INSTALL.get() == Some(true)
                {
                    return Tag::AddCommand;
                }
                if next_bytes == b"exec"
                    && bun_core::env_var::feature_flag::BUN_INTERNAL_BUNX_INSTALL.get() == Some(true)
                {
                    return Tag::ExecCommand;
                }
            }
            // SAFETY: single-threaded startup
            IS_BUNX_EXE.store(true, core::sync::atomic::Ordering::Relaxed);
            return Tag::BunxCommand;
        }

        if is_node(argv0) {
            // SAFETY: single-threaded startup
            PRETEND_TO_BE_NODE.store(true, core::sync::atomic::Ordering::Relaxed);
            return Tag::RunAsNodeCommand;
        }

        let Some(mut first_arg_name) = iter.next() else { return Tag::AutoCommand };
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
        if x == RootCommandMatcher::case(b"init") { return Tag::InitCommand; }
        if x == RootCommandMatcher::case(b"build") || x == RootCommandMatcher::case(b"bun") {
            return Tag::BuildCommand;
        }
        if x == RootCommandMatcher::case(b"discord") { return Tag::DiscordCommand; }
        if x == RootCommandMatcher::case(b"upgrade") { return Tag::UpgradeCommand; }
        if x == RootCommandMatcher::case(b"completions") { return Tag::InstallCompletionsCommand; }
        if x == RootCommandMatcher::case(b"getcompletes") { return Tag::GetCompletionsCommand; }
        if x == RootCommandMatcher::case(b"link") { return Tag::LinkCommand; }
        if x == RootCommandMatcher::case(b"unlink") { return Tag::UnlinkCommand; }
        if x == RootCommandMatcher::case(b"x") { return Tag::BunxCommand; }
        if x == RootCommandMatcher::case(b"repl") { return Tag::ReplCommand; }
        if x == RootCommandMatcher::case(b"i") || x == RootCommandMatcher::case(b"install") {
            for arg in argv.iter() {
                if arg == b"-g" || arg == b"--global" {
                    return Tag::AddCommand;
                }
            }
            return Tag::InstallCommand;
        }
        if x == RootCommandMatcher::case(b"ci") { return Tag::InstallCommand; }
        if x == RootCommandMatcher::case(b"c") || x == RootCommandMatcher::case(b"create") {
            return Tag::CreateCommand;
        }
        if x == RootCommandMatcher::case(b"test") { return Tag::TestCommand; }
        if x == RootCommandMatcher::case(b"pm") { return Tag::PackageManagerCommand; }
        if x == RootCommandMatcher::case(b"add") || x == RootCommandMatcher::case(b"a") {
            return Tag::AddCommand;
        }
        if x == RootCommandMatcher::case(b"update") { return Tag::UpdateCommand; }
        if x == RootCommandMatcher::case(b"patch") { return Tag::PatchCommand; }
        if x == RootCommandMatcher::case(b"patch-commit") { return Tag::PatchCommitCommand; }
        if x == RootCommandMatcher::case(b"r")
            || x == RootCommandMatcher::case(b"remove")
            || x == RootCommandMatcher::case(b"rm")
            || x == RootCommandMatcher::case(b"uninstall")
        {
            return Tag::RemoveCommand;
        }
        if x == RootCommandMatcher::case(b"run") { return Tag::RunCommand; }
        if x == RootCommandMatcher::case(b"help") { return Tag::HelpCommand; }
        if x == RootCommandMatcher::case(b"exec") { return Tag::ExecCommand; }
        if x == RootCommandMatcher::case(b"outdated") { return Tag::OutdatedCommand; }
        if x == RootCommandMatcher::case(b"publish") { return Tag::PublishCommand; }
        if x == RootCommandMatcher::case(b"audit") { return Tag::AuditCommand; }
        if x == RootCommandMatcher::case(b"info") { return Tag::InfoCommand; }
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
        if x == RootCommandMatcher::case(b"why") { return Tag::WhyCommand; }
        if x == RootCommandMatcher::case(b"fuzzilli") {
            if bun_core::Environment::ENABLE_FUZZILLI { return Tag::FuzzilliCommand; }
            return Tag::AutoCommand;
        }
        if x == RootCommandMatcher::case(b"-e") { return Tag::AutoCommand; }
        Tag::AutoCommand
    }

    /// `ContextData.create` — populates the global ctx and runs `Arguments::parse`.
    ///
    /// PORT NOTE: Zig had `comptime command: Tag` → const generic. `Tag` lacks
    /// `ConstParamTy` (lower-tier crate), so demoted to a runtime arg; the only
    /// comptime-dependent bit was `Tag.uses_global_options.get(command)`, which
    /// the runtime `USES_GLOBAL_OPTIONS` set covers.
    pub fn create_context_data(
        cmd: Tag,
        log: &mut logger::Log,
    ) -> Result<*mut ContextData, bun_core::Error> {
        // SAFETY: single-threaded CLI startup; `CMD` is read by crash-reporter
        // and debug logging only.
        unsafe { CMD.write(Some(cmd)) };

        // SAFETY: single-threaded CLI startup; first and only write to
        // `CONTEXT_DATA` for the process lifetime. `log` is the `&'static mut`
        // borrow of `Cli::LOG_` taken in `Cli::start()`, so storing its raw
        // address is sound for the process lifetime.
        let ctx_ptr: *mut ContextData = unsafe {
            (*CONTEXT_DATA.get()).write(ContextData {
                args: bun_options_types::schema::api::TransformOptions::default(),
                log: log as *mut logger::Log,
                start_time: START_TIME.read(),
                ..Default::default()
            });
            (*CONTEXT_DATA.get()).assume_init_mut()
        };
        GLOBAL_CLI_CTX.store(ctx_ptr, core::sync::atomic::Ordering::Release);

        if USES_GLOBAL_OPTIONS[cmd] {
            // SAFETY: just initialized above; single-threaded.
            let ctx = unsafe { &mut *ctx_ptr };
            ctx.args = arguments::parse(cmd, ctx)?;
        }

        #[cfg(windows)]
        {
            // SAFETY: just initialized above; single-threaded.
            let ctx = unsafe { &mut *ctx_ptr };
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

        Ok(ctx_ptr)
    }
    pub use create_context_data as init;

    /// Full subcommand dispatch. Body gated: every arm calls into a sibling
    /// `*_command.rs` that is itself still gated, plus `bun_bun_js::Run`,
    /// `StandaloneModuleGraph`, etc.
    pub fn start(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        let _ = log;
        let tag = which();

        // Phase-C: `Arguments::parse` (which normally handles `--help`/`-v`
        // for AutoCommand via clap) is still gated. Short-circuit the common
        // global flags here so `bun --help` / `bun -v` work end-to-end.
        // TODO(b2-blocked): remove once Arguments::parse is un-gated.
        if matches!(tag, Tag::AutoCommand) {
            for a in bun::argv().iter().skip(1) {
                match a {
                    b"--help" | b"-h" => {
                        tag_print_help(Tag::AutoCommand, true);
                        Global::exit(0);
                    }
                    b"-v" | b"--version" => super::print_version_and_exit(),
                    b"--revision" => super::print_revision_and_exit(),
                    _ => {}
                }
            }
        }

        match tag {
            Tag::HelpCommand => return HelpCommand::exec(),
            Tag::ReservedCommand => return ReservedCommand::exec(),
            Tag::DiscordCommand => return super::discord_command::DiscordCommand::exec(),
            Tag::InitCommand => {
                // InitCommand parses its own argv (no Context); Zig:
                //   .InitCommand => return try InitCommand.exec(allocator, bun.argv[@min(2, bun.argv.len)..])
                let argv = argv_zslice();
                return super::init_command::InitCommand::exec(
                    &argv[2.min(argv.len())..],
                );
            }
            Tag::InstallCompletionsCommand => {
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
                // `Output::writer()` already returns `&'static mut io::Writer`;
                // no raw deref needed (was `*mut` in an earlier port pass).
                let writer = Output::writer();
                let _ = writer.write_all(shell.completions());
                Output::flush();
                // TODO(b2-blocked): tty path → write into shell completions dir
                // (InstallCompletionsCommand::exec).
                Global::exit(0);
            }
            Tag::PackageManagerCommand => {
                // SAFETY: see RunAsNodeCommand arm — single-threaded startup.
                let ctx = unsafe { &mut *init(Tag::PackageManagerCommand, log)? };
                return super::package_manager_command::PackageManagerCommand::exec(ctx);
            }
            Tag::RunAsNodeCommand => {
                // SAFETY: `init` writes the process-global `CONTEXT_DATA` once
                // during single-threaded startup and returns its raw address;
                // we are that startup thread and this is the sole live `&mut`
                // to it (Zig: `Context = *ContextData`, freely aliased — here
                // the borrow is threaded down via the `ctx` parameter instead
                // of re-derived). All other `init(...)` arms below share this
                // invariant.
                let ctx = unsafe { &mut *init(tag, log)? };
                return run_command::RunCommand::exec_as_if_node(ctx);
            }
            Tag::AutoCommand | Tag::RunCommand => {
                // SAFETY: see RunAsNodeCommand arm above.
                // PORT NOTE: Zig's AutoCommand arm swallows
                // `error.MissingEntryPoint` from `Command.init` and prints
                // help. `bun_core::Error` has no variant table yet (B-1 stub
                // — `err!()` collapses to `Error::TODO`), so a name-match
                // would alias every error. Propagate for now; the empty-
                // positionals fallthrough below covers the common "no args"
                // help path anyway.
                // TODO(b2): restore `MissingEntryPoint → HelpCommand::exec()`
                // once `bun_core::Error` interns names.
                let ctx = unsafe { &mut *init(tag, log)? };
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

                // TODO(b2-blocked): `.lockb` extension → `bun ./bun.lockb`
                // (Lockfile::Printer); see cli_body.rs.

                if !ctx.positionals.is_empty() {
                    let cfg = run_command::ExecCfg {
                        bin_dirs_only: tag == Tag::AutoCommand,
                        log_errors: tag != Tag::AutoCommand
                            || !ctx.runtime_options.if_present,
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
                return Ok(());
            }
            Tag::InfoCommand => {
                return bun_info(log);
            }
            Tag::BuildCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::BuildCommand, log)? };
                super::build_command::BuildCommand::exec(ctx, None)?;
            }
            Tag::InstallCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::InstallCommand, log)? };
                return super::install_command::InstallCommand::exec(ctx);
            }
            Tag::AddCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::AddCommand, log)? };
                return super::add_command::AddCommand::exec(ctx);
            }
            Tag::UpdateCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::UpdateCommand, log)? };
                return super::update_command::UpdateCommand::exec(ctx);
            }
            Tag::PatchCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::PatchCommand, log)? };
                return super::patch_command::PatchCommand::exec(ctx);
            }
            Tag::PatchCommitCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::PatchCommitCommand, log)? };
                return super::patch_commit_command::PatchCommitCommand::exec(ctx);
            }
            Tag::OutdatedCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::OutdatedCommand, log)? };
                return super::outdated_command::OutdatedCommand::exec(ctx);
            }
            Tag::UpdateInteractiveCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::UpdateInteractiveCommand, log)? };
                return super::update_interactive_command::UpdateInteractiveCommand::exec(ctx);
            }
            Tag::PublishCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::PublishCommand, log)? };
                return super::publish_command::PublishCommand::exec(ctx);
            }
            Tag::AuditCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::AuditCommand, log)? };
                super::audit_command::AuditCommand::exec(ctx)?;
            }
            Tag::WhyCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::WhyCommand, log)? };
                return super::why_command::WhyCommand::exec(ctx);
            }
            Tag::BunxCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::BunxCommand, log)? };
                let start_idx = if IS_BUNX_EXE.load(core::sync::atomic::Ordering::Relaxed) { 0 } else { 1 };
                let argv = argv_zslice();
                return super::bunx_command::BunxCommand::exec(ctx, &argv[start_idx..]);
            }
            Tag::ReplCommand => {
                // PORT NOTE: Zig inits with .RunCommand here (repl reuses run params).
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::RunCommand, log)? };
                return super::repl_command::ReplCommand::exec(ctx);
            }
            Tag::RemoveCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::RemoveCommand, log)? };
                return super::remove_command::RemoveCommand::exec(ctx);
            }
            Tag::LinkCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::LinkCommand, log)? };
                return super::link_command::LinkCommand::exec(ctx);
            }
            Tag::UnlinkCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::UnlinkCommand, log)? };
                return super::unlink_command::UnlinkCommand::exec(ctx);
            }
            Tag::TestCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::TestCommand, log)? };
                return super::test_command::TestCommand::exec(ctx);
            }
            Tag::GetCompletionsCommand => {
                return bun_getcompletes(log);
            }
            Tag::CreateCommand => {
                return bun_create(log);
            }
            Tag::UpgradeCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::UpgradeCommand, log)? };
                return super::upgrade_command::UpgradeCommand::exec(ctx);
            }
            Tag::ExecCommand => {
                // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                let ctx = unsafe { &mut *init(Tag::ExecCommand, log)? };
                if ctx.positionals.len() > 1 {
                    super::exec_command::ExecCommand::exec(ctx)?;
                } else {
                    tag_print_help(Tag::ExecCommand, true);
                }
            }
            Tag::FuzzilliCommand => {
                if bun_core::Environment::ENABLE_FUZZILLI {
                    // SAFETY: single-threaded startup (see RunAsNodeCommand arm).
                    let ctx = unsafe { &mut *init(Tag::FuzzilliCommand, log)? };
                    return super::fuzzilli_command::FuzzilliCommand::exec(ctx);
                }
                return Err(bun_core::err!("UnrecognizedCommand"));
            }
        }
        Ok(())
    }

    // ─── helper fns hoisted from `Command.start` (kept out of `start` to keep
    //     its stack frame small; the original Zig had them as nested closures /
    //     inline blocks) ─────────────────────────────────────────────────────

    const DEFAULT_COMPLETIONS_LIST: &[&[u8]] = &[
        b"build", b"install", b"add", b"run", b"update", b"link", b"unlink",
        b"remove", b"create", b"bun", b"upgrade", b"discord", b"test", b"pm",
        b"x", b"repl", b"info",
    ];

    // PORT NOTE: Zig concatenated DEFAULT_COMPLETIONS_LIST ++ extras at
    // comptime; hand-rolled join (small, fixed).
    const REJECT_LIST: &[&[u8]] = &[
        b"build", b"install", b"add", b"run", b"update", b"link", b"unlink",
        b"remove", b"create", b"bun", b"upgrade", b"discord", b"test", b"pm",
        b"x", b"repl", b"info",
        // extras:
        b"build", b"completions", b"help",
    ];

    fn bun_getcompletes(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        use super::add_completions;
        use super::run_command::{Filter, RunCommand};
        use super::shell_completions::ShellCompletions;

        // SAFETY: single-threaded startup.
        let ctx = unsafe { &mut *init(Tag::GetCompletionsCommand, log)? };
        // PORT NOTE: `ctx.positionals` is `Vec<Box<[u8]>>`; clone into a local
        // owned vec so `filter` doesn't borrow `ctx` (passed `&mut` below).
        let positionals: Vec<Box<[u8]>> = ctx.positionals.clone();
        let positionals_refs: Vec<&[u8]> =
            positionals.iter().map(|b| &**b).collect();
        let mut filter: &[&[u8]] = &positionals_refs;

        for (i, item) in filter.iter().enumerate() {
            if *item == b"getcompletes" {
                filter = if i + 1 < filter.len() { &filter[i + 1..] } else { &[] };
                break;
            }
        }
        let mut prefilled_completions: [&'static [u8]; add_completions::BIGGEST_LIST] =
            [b""; add_completions::BIGGEST_LIST];
        let mut completions = ShellCompletions::default();

        if filter.is_empty() {
            completions = RunCommand::completions::<{ Filter::All }>(
                ctx, Some(DEFAULT_COMPLETIONS_LIST), REJECT_LIST,
            )?;
        } else if filter[0] == b"s" {
            completions = RunCommand::completions::<{ Filter::Script }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"i" {
            completions = RunCommand::completions::<{ Filter::ScriptExclude }>(
                ctx, Some(DEFAULT_COMPLETIONS_LIST), REJECT_LIST,
            )?;
        } else if filter[0] == b"b" {
            completions = RunCommand::completions::<{ Filter::Bin }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"r" {
            completions = RunCommand::completions::<{ Filter::All }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"g" {
            completions = RunCommand::completions::<{ Filter::AllPlusBunJs }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"j" {
            completions = RunCommand::completions::<{ Filter::BunJs }>(ctx, None, REJECT_LIST)?;
        } else if filter[0] == b"z" {
            completions = RunCommand::completions::<{ Filter::ScriptAndDescriptions }>(
                ctx, None, REJECT_LIST,
            )?;
        } else if filter[0] == b"a" {
            use add_completions::FirstLetter;
            'outer: {
                if filter.len() > 1 && !filter[1].is_empty() {
                    let first_letter: FirstLetter = match filter[1][0] {
                        b'a' => FirstLetter::A, b'b' => FirstLetter::B,
                        b'c' => FirstLetter::C, b'd' => FirstLetter::D,
                        b'e' => FirstLetter::E, b'f' => FirstLetter::F,
                        b'g' => FirstLetter::G, b'h' => FirstLetter::H,
                        b'i' => FirstLetter::I, b'j' => FirstLetter::J,
                        b'k' => FirstLetter::K, b'l' => FirstLetter::L,
                        b'm' => FirstLetter::M, b'n' => FirstLetter::N,
                        b'o' => FirstLetter::O, b'p' => FirstLetter::P,
                        b'q' => FirstLetter::Q, b'r' => FirstLetter::R,
                        b's' => FirstLetter::S, b't' => FirstLetter::T,
                        b'u' => FirstLetter::U, b'v' => FirstLetter::V,
                        b'w' => FirstLetter::W, b'x' => FirstLetter::X,
                        b'y' => FirstLetter::Y, b'z' => FirstLetter::Z,
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
                    completions.commands = std::borrow::Cow::Owned(
                        prefilled_completions[0..prefilled_i].to_vec(),
                    );
                }
            }
        }
        completions.print();
        Ok(())
    }

    fn bun_create(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        use super::bunx_command::BunxCommand;
        use super::create_command::{CreateCommand, ExampleTag};
        use bun_str::ZStr;

        // These are templates from the legacy `bun create`
        // most of them aren't useful but these few are kinda nice.
        static HARDCODED_NON_BUN_X_LIST: phf::Set<&'static [u8]> = phf::phf_set! {
            b"elysia", b"elysia-buchta", b"stric",
        };

        // Create command wraps bunx
        // SAFETY: single-threaded startup.
        let ctx = unsafe { &mut *init(Tag::CreateCommand, log)? };
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
            let mut bunx_args: Vec<&ZStr> = Vec::with_capacity(
                2 + args.len() - template_name_start + (dash_dash_bun as usize),
            );
            bunx_args.push(bun_core::zstr!("bunx"));
            if dash_dash_bun {
                bunx_args.push(bun_core::zstr!("--bun"));
            }
            // `add_create_prefix` returns an owned NUL-terminated buffer.
            // `bun create` is a one-shot CLI subcommand (ends in exec/exit), so
            // the prefixed package name is a process singleton — park the owning
            // `ZBox` in a `OnceLock` so the `&'static ZStr` borrow is sound
            // without `Box::leak` (PORTING.md §Forbidden patterns).
            static CREATE_PREFIX: std::sync::OnceLock<bun_core::ZBox> =
                std::sync::OnceLock::new();
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

    fn bun_info(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        use bun_install::package_manager_real::{CommandLineArguments, Subcommand as PmSubcommand};
        use bun_install::{PackageManager, Subcommand};

        // Parse arguments manually since the standard flow doesn't work for standalone commands
        let cli = CommandLineArguments::parse(PmSubcommand::Info)?;
        let json_output = cli.json_output;
        // SAFETY: single-threaded startup.
        let ctx = unsafe { &mut *init(Tag::InfoCommand, log)? };
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

        // SAFETY: `PackageManager::init` returns a heap singleton (`*mut`) that
        // outlives this command; reborrow as `&mut` to match the rest of the
        // CLI command surface (see `publish_command`, `unlink_command`, etc.).
        super::pm_view_command::view(unsafe { &mut *pm }, package_name, property_path, json_output)
    }

    /// Per-tag clap param table. Runtime dispatch (was const-generic in Zig;
    /// `Tag` lacks `ConstParamTy` here so demoted to a value param).
    pub fn tag_params(cmd: Tag) -> &'static [arguments::ParamType] {
        match cmd {
            Tag::AutoCommand => arguments::AUTO_PARAMS.as_slice(),
            Tag::RunCommand | Tag::RunAsNodeCommand => arguments::RUN_PARAMS.as_slice(),
            Tag::BuildCommand => arguments::BUILD_PARAMS.as_slice(),
            Tag::TestCommand => arguments::TEST_PARAMS.as_slice(),
            Tag::BunxCommand => arguments::RUN_PARAMS.as_slice(),
            _ => arguments::BASE_PARAMS_.as_slice(),
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
        // `{}` (as the Phase-A draft in cli_body.rs did) prints the raw markup.
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
                bun_clap::simple_help(arguments::BUILD_ONLY_PARAMS.as_slice());
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
                        ("canary", "Switch from the canary version back to the latest stable release", "stable")
                    } else {
                        ("stable", "Install the most recent canary version of Bun", "canary")
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

#[cold]
pub fn print_version_and_exit() -> ! {
    Output::pretty(format_args!("{}\n", Global::package_json_version));
    Output::flush();
    Global::exit(0);
}

#[cold]
pub fn print_revision_and_exit() -> ! {
    Output::pretty(format_args!("{}\n", Global::package_json_version_with_revision));
    Output::flush();
    Global::exit(0);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/cli/cli.zig
//   confidence: medium (B-2 help-path un-gate)
//   notes:      which()/HelpCommand/print_*_and_exit real; start()/init() gated on bun_jsc + sibling *_command modules; const-generic Tag demoted to runtime (ConstParamTy missing on options_types::CommandTag::Tag)
// ──────────────────────────────────────────────────────────────────────────
