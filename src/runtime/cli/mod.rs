//! Port of src/runtime/cli/cli.zig — CLI entry point + command dispatch.
//!
//! B-2 round 2: un-gate the help path. `Command::which()` + `HelpCommand`
//! + `print_version_and_exit` are real and compile against lower-tier crates.
//! `Command::start()` (full dispatch) and per-command exec bodies stay gated
//! behind `#[cfg(any())]` — they need `bun_jsc`, `bun_bun_js`, transpiler,
//! and the not-yet-un-gated sibling `*_command.rs` modules.
//!
//! The full Phase-A draft is preserved verbatim in `cli_body.rs` (still
//! `#[cfg(any())]`-gated as a reference for the next un-gate round).

use core::cell::Cell;

use bun_core::{self as bun, Global, Output};
use bun_core::{pretty, pretty_error, pretty_errorln};
use bun_logger as logger;
use bun_str::strings;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
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
// TODO(b2-blocked): shell_completions.rs needs `include_bytes!` paths fixed
// (completions-{bash,zsh,fish} live elsewhere) and `Output::writer()` deref;
// list-of-yarn-commands.rs has duplicate phf_set! keys; discord_command.rs
// needs `crate::open` (open.rs not yet un-gated). All three are leaf modules
// with no callers on the help path — next round.
#[cfg(any())] #[path = "shell_completions.rs"]
pub mod shell_completions;
#[cfg(any())] #[path = "list-of-yarn-commands.rs"]
pub mod list_of_yarn_commands;
#[cfg(any())] #[path = "discord_command.rs"]
pub mod discord_command;

// ─── B-2 round 2: newly un-gated (thin surface, heavy bodies re-gated inside) ─
#[path = "Arguments.rs"]
pub mod arguments;
pub use arguments as Arguments;
#[path = "bunfig.rs"]
pub mod bunfig;
pub use bunfig::Bunfig;
#[path = "run_command.rs"]
pub mod run_command;

// ─── crate-local shims for bun_clap macros that don't exist yet ──────────────
// `bun_clap::parse_param` exists as a *runtime* fn but the Phase-A drafts call
// it as a `macro!` in `static` position. Until `bun_clap` grows a const/proc-
// macro form, these shims let the param-table declarations compile by deferring
// to runtime construction inside `LazyLock`.
//
// TODO(b2-blocked): bun_clap::parse_param! / concat_params! proc-macros.
#[macro_export]
#[doc(hidden)]
macro_rules! __cli_parse_param {
    ($lit:expr) => {
        ::bun_clap::parse_param($lit.as_bytes()).expect("clap param parse")
    };
}
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
pub use crate::__cli_parse_param as parse_param;
pub use crate::__cli_concat_params as concat_params;

// ─── process-lifetime globals ────────────────────────────────────────────────
// TODO(port): Zig `var start_time: i128 = undefined;` — mutable static, single-threaded init in Cli::start
pub static mut START_TIME: i128 = 0;

#[allow(non_upper_case_globals)]
// TODO(port): mutable static Option<&[u8]>; written from C++ side (process.title)
pub static mut Bun__Node__ProcessTitle: Option<&'static [u8]> = None;

thread_local! {
    pub static IS_MAIN_THREAD: Cell<bool> = const { Cell::new(false) };
}

/// `Cli.cmd` — set in `create_context_data` so crash reports / debug logging
/// can ask "which subcommand are we in".
// TODO(port): mutable static Option<Tag>; AtomicU8 once Tag has a stable repr.
pub static mut CMD: Option<command::Tag> = None;

/// This is set `true` during `Command.which()` if argv0 is "node", in which the CLI is going
/// to pretend to be node.js by always choosing RunCommand with a relative filepath.
pub static mut PRETEND_TO_BE_NODE: bool = false;

/// This is set `true` during `Command.which()` if argv0 is "bunx"
pub static mut IS_BUNX_EXE: bool = false;

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
    pub static mut LOG_: core::mem::MaybeUninit<logger::Log> = core::mem::MaybeUninit::uninit();

    pub fn start() {
        IS_MAIN_THREAD.with(|c| c.set(true));
        // SAFETY: single-threaded process startup; no other reader yet
        unsafe { START_TIME = bun_core::time::nano_timestamp() };
        // SAFETY: single-threaded process startup
        unsafe { (*(&raw mut LOG_)).write(logger::Log::init()) };

        // TODO(b2-blocked): MainPanicHandler wiring. Full body in cli_body.rs.
        // SAFETY: just initialized above; single-threaded for the lifetime of `log`.
        let log = unsafe { (*(&raw mut LOG_)).assume_init_mut() };
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
    pub static mut RESOLVE_BREAKPOINTS: &[&[u8]] = &[];
    pub static mut PRINT_BREAKPOINTS: &[&[u8]] = &[];
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
    pub const PACKAGES_TO_REMOVE_FILLER: &[&[u8]] = &[
        b"moment", b"underscore", b"jquery", b"backbone", b"redux", b"browserify",
        b"webpack", b"left-pad", b"is-array", b"babel-core", b"@parcel/core",
    ];
    pub const PACKAGES_TO_ADD_FILLER: &[&[u8]] = &[
        b"elysia", b"@shumai/shumai", b"hono", b"react", b"lyra",
        b"@remix-run/dev", b"@evan/duckdb", b"@zarfjs/zarf", b"zod", b"tailwindcss",
    ];
    pub const PACKAGES_TO_X_FILLER: &[&[u8]] = &[
        b"bun-repl", b"next", b"vite", b"prisma", b"nuxi", b"prettier", b"eslint",
    ];
    pub const PACKAGES_TO_CREATE_FILLER: &[&[u8]] = &[
        b"next-app", b"vite", b"astro", b"svelte", b"elysia",
    ];

    // the spacing between commands here is intentional
    pub const CLI_HELPTEXT_FMT: &str = "\
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
";

    const CLI_HELPTEXT_FOOTER: &str = "
Learn more about Bun:            <magenta>https://bun.com/docs<r>
Join our Discord community:      <blue>https://bun.com/discord<r>
";

    // PORT NOTE: Zig had `comptime reason: Reason` → const generic. Tag/Reason
    // lack `ConstParamTy` in lower-tier crates, so demoted to a runtime arg.
    // PERF(port): was comptime monomorphization — profile in Phase B.
    pub fn print_with_reason(reason: Reason, show_all_flags: bool) {
        let mut rand = bun_core::rand::DefaultPrng::init(
            u64::try_from(bun_core::time::milli_timestamp().max(0)).unwrap(),
        );
        // Zig: rand.uintAtMost(len-1). xoshiro256++ next_u64() % len is close
        // enough for filler-word selection (no rejection sampling needed here).
        let mut pick = |n: usize| (rand.next_u64() as usize) % n;

        let package_x_i = pick(PACKAGES_TO_X_FILLER.len());
        let package_add_i = pick(PACKAGES_TO_ADD_FILLER.len());
        let package_remove_i = pick(PACKAGES_TO_REMOVE_FILLER.len());
        let package_create_i = pick(PACKAGES_TO_CREATE_FILLER.len());

        let args = (
            bstr::BStr::new(PACKAGES_TO_X_FILLER[package_x_i]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[package_add_i]),
            bstr::BStr::new(PACKAGES_TO_REMOVE_FILLER[package_remove_i]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 1) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 2) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 3) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_CREATE_FILLER[package_create_i]),
        );

        match reason {
            Reason::Explicit => {
                // TODO(port): Output::pretty proc-macro (`<tag>` rewrite + 7-arg
                // positional substitution into CLI_HELPTEXT_FMT). For now we
                // print the runtime-rewritten ANSI template followed by the
                // footer; the {:<16} fillers render as literal placeholders.
                pretty!(
                    "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>({})<r>\n\n",
                    Global::package_json_version_with_revision,
                );
                Output::pretty(format_args!(
                    "{}",
                    bstr::BStr::new(&Output::pretty_fmt(CLI_HELPTEXT_FMT, true)),
                ));
                let _ = (args, show_all_flags);
                if show_all_flags {
                    pretty!("\n<b>Flags:<r>");
                    bun_clap::simple_help_bun_top_level(arguments::AUTO_PARAMS.as_slice());
                    pretty!(
                        "\n\n(more flags in <b>bun install --help<r>, <b>bun test --help<r>, and <b>bun build --help<r>)\n",
                    );
                }
                Output::pretty(format_args!(
                    "{}",
                    bstr::BStr::new(&Output::pretty_fmt(CLI_HELPTEXT_FOOTER, true)),
                ));
            }
            Reason::InvalidCommand => {
                pretty_error!("<r><red>Uh-oh<r> not sure what to do with that command.\n\n");
                Output::pretty(format_args!(
                    "{}",
                    bstr::BStr::new(&Output::pretty_fmt(CLI_HELPTEXT_FMT, true)),
                ));
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

    pub use bun_options_types::CommandTag::Tag;
    pub use bun_options_types::CommandTag::{
        ALWAYS_LOADS_CONFIG, LOADS_CONFIG, USES_GLOBAL_OPTIONS,
    };
    pub use bun_options_types::Context::{
        Context, ContextData, DebugOptions, RuntimeOptions, TestOptions,
    };

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
            // SAFETY: single-threaded startup
            unsafe { IS_BUNX_EXE = true };
            if let Some(next) = argv.get(1) {
                let next_bytes = next.as_bytes();
                if next_bytes == b"add" || next_bytes == b"a" {
                    return Tag::AddCommand;
                }
                if next_bytes == b"exec" {
                    return Tag::ExecCommand;
                }
            }
            return Tag::BunxCommand;
        }

        if is_node(argv0) {
            // SAFETY: single-threaded startup
            unsafe { PRETEND_TO_BE_NODE = true };
            return Tag::RunAsNodeCommand;
        }

        let Some(mut first_arg_name) = iter.next() else { return Tag::AutoCommand };
        while first_arg_name.is_empty() {
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
            // bun install <package>? -> auto-detect AddCommand
            if let Some(next) = iter.next() {
                if !next.is_empty() && next[0] != b'-' {
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
    pub fn create_context_data(
        cmd: Tag,
        _log: &mut logger::Log,
    ) -> Result<*mut ContextData<'static>, bun_core::Error> {
        // SAFETY: single-threaded CLI startup
        unsafe { CMD = Some(cmd) };
        // TODO(b2-blocked): ContextData has no Default and api::TransformOptions
        // shape is incomplete (options_types::schema). Full body in cli_body.rs.
        todo!("Command::create_context_data — blocked on options_types::Context::Default + Arguments::parse")
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
            // TODO(b2-blocked): remaining arms — see cli_body.rs::command::start
            _ => todo!("Command::start dispatch for {:?}", tag),
        }
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
        match cmd {
            Tag::AutoCommand | Tag::HelpCommand => {
                HelpCommand::print_with_reason(HelpCommand::Reason::Explicit, show_all_flags);
            }
            Tag::RunCommand | Tag::RunAsNodeCommand => {
                run_command::RunCommand::print_help(None);
            }
            // TODO(b2-blocked): per-subcommand help blocks — full text lives in
            // cli_body.rs::command::tag_print_help (1.2k lines of help strings).
            _ => HelpCommand::print_with_reason(HelpCommand::Reason::Explicit, false),
        }
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
