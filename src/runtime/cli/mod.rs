use core::cell::Cell;
use core::ffi::c_int;

use bun_core::{self as bun, Global, Output};
use bun_logger as logger;
use bun_str::{strings, ZStr};
use bun_clap as clap;
use bun_schema::api;
use bun_sys::File;

bun_output::declare_scope!(CLI, hidden);

// TODO(port): Zig `var start_time: i128 = undefined;` — mutable static, single-threaded init in Cli::start
pub static mut START_TIME: i128 = 0;

#[allow(non_upper_case_globals)]
// TODO(port): mutable static Option<&[u8]>; written from C++ side (process.title)
pub static mut Bun__Node__ProcessTitle: Option<&'static [u8]> = None;

pub mod cli {
    use super::*;

    pub use bun_options_types::compile_target::CompileTarget;

    // TODO(port): Zig `var log_: logger.Log = undefined;` — process-global, init in start()
    pub static mut LOG_: core::mem::MaybeUninit<logger::Log> = core::mem::MaybeUninit::uninit();

    pub fn start_transform(
        _: api::TransformOptions,
        _: &mut logger::Log,
    ) -> Result<(), bun_core::Error> {
        Ok(())
    }

    pub fn start() {
        IS_MAIN_THREAD.with(|c| c.set(true));
        // SAFETY: single-threaded process startup; no other reader yet
        unsafe { START_TIME = bun_core::time::nano_timestamp() };
        // SAFETY: single-threaded process startup
        unsafe { LOG_.write(logger::Log::init()) };

        // SAFETY: just initialized above
        let log = unsafe { LOG_.assume_init_mut() };

        // var panicker = MainPanicHandler.init(log);
        // MainPanicHandler.Singleton = &panicker;
        if let Err(err) = Command::start(log) {
            let _ = log.print(Output::error_writer());
            bun_crash_handler::handle_root_error(err, /* @errorReturnTrace() */ None);
        }
    }

    // TODO(port): mutable static Option<Tag>
    pub static mut CMD: Option<super::command::Tag> = None;

    thread_local! {
        pub static IS_MAIN_THREAD: Cell<bool> = const { Cell::new(false) };
    }
}
pub use cli as Cli;

#[cfg(feature = "show_crash_trace")]
pub mod debug_flags {
    use super::*;

    pub static mut RESOLVE_BREAKPOINTS: &[&[u8]] = &[];
    pub static mut PRINT_BREAKPOINTS: &[&[u8]] = &[];

    pub fn has_resolve_breakpoint(str: &[u8]) -> bool {
        // SAFETY: written once during arg parse before any concurrent reads
        for bp in unsafe { RESOLVE_BREAKPOINTS } {
            if strings::contains(str, bp) {
                return true;
            }
        }
        false
    }

    pub fn has_print_breakpoint(path: &bun_resolver::fs::Path) -> bool {
        // SAFETY: written once during arg parse before any concurrent reads
        for bp in unsafe { PRINT_BREAKPOINTS } {
            if strings::contains(&path.pretty, bp) {
                return true;
            }
            if strings::contains(&path.text, bp) {
                return true;
            }
        }
        false
    }
}
// Zig: `else @compileError("Do not access this namespace in a release build")`
// In Rust the module simply does not exist when the cfg is off; any reference is a compile error.

pub type LoaderColonList = colon_list_type::ColonListType<api::Loader, { arguments::LOADER_RESOLVER }>;
pub type DefineColonList = colon_list_type::ColonListType<&'static [u8], { arguments::NOOP_RESOLVER }>;
// TODO(port): ColonListType takes a fn pointer as second generic in Zig; Rust const-generic fn ptrs are unstable. Phase B may switch to a trait param.

#[cold]
pub fn invalid_target(diag: &mut clap::Diagnostic, target: &[u8]) -> ! {
    diag.name.long = b"target";
    diag.arg = target;
    let _ = diag.report(Output::error_writer(), bun_core::err!("InvalidTarget"));
    bun_core::process::exit(1);
}

pub use crate::build_command::BuildCommand;
pub use crate::add_command::AddCommand;
pub use crate::create_command::CreateCommand;
pub use crate::create_command::Example as CreateCommandExample;
pub use crate::create_command::CreateListExamplesCommand;
pub use crate::discord_command::DiscordCommand;
pub use crate::install_command::InstallCommand;
pub use crate::link_command::LinkCommand;
pub use crate::unlink_command::UnlinkCommand;
pub use crate::install_completions_command::InstallCompletionsCommand;
pub use crate::package_manager_command::PackageManagerCommand;
pub use crate::remove_command::RemoveCommand;
pub use crate::run_command::RunCommand;
pub use crate::shell_completions as ShellCompletions;
pub use crate::update_command::UpdateCommand;
pub use crate::upgrade_command::UpgradeCommand;
pub use crate::bunx_command::BunxCommand;
pub use crate::exec_command::ExecCommand;
pub use crate::patch_command::PatchCommand;
pub use crate::patch_commit_command::PatchCommitCommand;
pub use crate::outdated_command::OutdatedCommand;
pub use crate::update_interactive_command::UpdateInteractiveCommand;
pub use crate::publish_command::PublishCommand;
pub use crate::pack_command::PackCommand;
pub use crate::audit_command::AuditCommand;
pub use crate::init_command::InitCommand;
pub use crate::why_command::WhyCommand;
pub use crate::fuzzilli_command::FuzzilliCommand;
pub use crate::repl_command::ReplCommand;

pub use crate::arguments as Arguments;
pub mod arguments;

mod auto_command {
    use super::*;
    pub fn exec() -> Result<(), bun_core::Error> {
        HelpCommand::exec_with_reason::<{ HelpCommand::Reason::InvalidCommand }>()
    }
}
use auto_command as AutoCommand;

pub mod help_command {
    use super::*;

    #[cold]
    pub fn exec() -> Result<(), bun_core::Error> {
        exec_with_reason::<{ Reason::Explicit }>();
        Ok(())
    }

    #[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
    pub enum Reason {
        Explicit,
        InvalidCommand,
    }

    // someone will get mad at me for this
    pub const PACKAGES_TO_REMOVE_FILLER: &[&[u8]] = &[
        b"moment",
        b"underscore",
        b"jquery",
        b"backbone",
        b"redux",
        b"browserify",
        b"webpack",
        b"left-pad",
        b"is-array",
        b"babel-core",
        b"@parcel/core",
    ];

    pub const PACKAGES_TO_ADD_FILLER: &[&[u8]] = &[
        b"elysia",
        b"@shumai/shumai",
        b"hono",
        b"react",
        b"lyra",
        b"@remix-run/dev",
        b"@evan/duckdb",
        b"@zarfjs/zarf",
        b"zod",
        b"tailwindcss",
    ];

    pub const PACKAGES_TO_X_FILLER: &[&[u8]] = &[
        b"bun-repl",
        b"next",
        b"vite",
        b"prisma",
        b"nuxi",
        b"prettier",
        b"eslint",
    ];

    pub const PACKAGES_TO_CREATE_FILLER: &[&[u8]] = &[
        b"next-app",
        b"vite",
        b"astro",
        b"svelte",
        b"elysia",
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

    pub fn print_with_reason<const REASON: Reason>(show_all_flags: bool) {
        // TODO(port): std.Random.DefaultPrng — use a small PRNG seeded from millis; bun_core may expose one
        let mut rand_state = bun_core::rand::DefaultPrng::init(
            u64::try_from(bun_core::time::milli_timestamp().max(0)).unwrap(),
        );
        let rand = rand_state.random();

        let package_x_i = rand.uint_at_most(PACKAGES_TO_X_FILLER.len() - 1);
        let package_add_i = rand.uint_at_most(PACKAGES_TO_ADD_FILLER.len() - 1);
        let package_remove_i = rand.uint_at_most(PACKAGES_TO_REMOVE_FILLER.len() - 1);
        let package_create_i = rand.uint_at_most(PACKAGES_TO_CREATE_FILLER.len() - 1);

        let args = (
            bstr::BStr::new(PACKAGES_TO_X_FILLER[package_x_i]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[package_add_i]),
            bstr::BStr::new(PACKAGES_TO_REMOVE_FILLER[package_remove_i]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 1) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 2) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_ADD_FILLER[(package_add_i + 3) % PACKAGES_TO_ADD_FILLER.len()]),
            bstr::BStr::new(PACKAGES_TO_CREATE_FILLER[package_create_i]),
        );

        match REASON {
            Reason::Explicit => {
                #[cfg(debug_assertions)]
                {
                    if bun::argv().len() == 1 {
                        if Output::is_ai_agent() {
                            if let Some(event) = bun_core::env_var::npm_lifecycle_event::get() {
                                if strings::has_prefix(event, b"bd") {
                                    // claude gets very confused by the help menu
                                    // let's give claude some self confidence.
                                    Output::println("BUN COMPILED SUCCESSFULLY! 🎉", format_args!(""));
                                    Global::exit(0);
                                }
                            }
                        }
                    }
                }

                Output::pretty(
                    const_format::concatcp!(
                        "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>(",
                        Global::PACKAGE_JSON_VERSION_WITH_REVISION,
                        ")<r>\n\n",
                        CLI_HELPTEXT_FMT,
                    ),
                    format_args!(
                        "{}{}{}{}{}{}{}",
                        // TODO(port): Output::pretty is a printf-style fn; Phase B wires the
                        // 7-arg substitution into CLI_HELPTEXT_FMT properly.
                        args.0, args.1, args.2, args.3, args.4, args.5, args.6
                    ),
                );
                if show_all_flags {
                    Output::pretty("\n<b>Flags:<r>", format_args!(""));

                    // TODO(port): comptime concat of param arrays — Phase B may expose a const slice from Arguments
                    let flags = arguments::runtime_params_()
                        .iter()
                        .chain(arguments::auto_only_params().iter())
                        .chain(arguments::base_params_().iter());
                    clap::simple_help_bun_top_level(flags);
                    Output::pretty(
                        "\n\n(more flags in <b>bun install --help<r>, <b>bun test --help<r>, and <b>bun build --help<r>)\n",
                        format_args!(""),
                    );
                }
                Output::pretty(CLI_HELPTEXT_FOOTER, format_args!(""));
            }
            Reason::InvalidCommand => Output::pretty_error(
                const_format::concatcp!(
                    "<r><red>Uh-oh<r> not sure what to do with that command.\n\n",
                    CLI_HELPTEXT_FMT,
                ),
                format_args!(
                    "{}{}{}{}{}{}{}",
                    args.0, args.1, args.2, args.3, args.4, args.5, args.6
                ),
            ),
        }

        Output::flush();
    }

    #[cold]
    pub fn exec_with_reason<const REASON: Reason>() -> ! {
        print_with_reason::<REASON>(false);

        if REASON == Reason::InvalidCommand {
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
        let argv = bun::argv();
        let command_name = 'found: {
            for arg in &argv[1..] {
                if arg.len() > 1 && arg[0] == b'-' {
                    continue;
                }
                break 'found arg.as_bytes();
            }
            argv[1].as_bytes()
        };
        Output::pretty_error(
            "<r><red>Uh-oh<r>. <b><yellow>bun {}<r> is a subcommand reserved for future use by Bun.\n\
             \n\
             If you were trying to run a package.json script called {}, use <b><magenta>bun run {}<r>.\n",
            format_args!(
                "{0}{0}{0}",
                bstr::BStr::new(command_name)
            ),
        );
        // TODO(port): Output::pretty_error positional substitution (3× same arg)
        Output::flush();
        bun_core::process::exit(1);
    }
}
pub use reserved_command as ReservedCommand;

/// This is set `true` during `Command.which()` if argv0 is "node", in which the CLI is going
/// to pretend to be node.js by always choosing RunCommand with a relative filepath.
///
/// Examples of how this differs from bun alone:
/// - `node build`               -> `bun run ./build`
/// - `node scripts/postinstall` -> `bun run ./scripts/postinstall`
pub static mut PRETEND_TO_BE_NODE: bool = false;

/// This is set `true` during `Command.which()` if argv0 is "bunx"
pub static mut IS_BUNX_EXE: bool = false;

pub mod command {
    use super::*;

    pub fn get() -> Context {
        // SAFETY: only called after `start()` initialized GLOBAL_CLI_CTX
        unsafe { GLOBAL_CLI_CTX }
    }

    pub use bun_options_types::context::{
        Context, ContextData, DebugOptions, Debugger, HotReload, MacroOptions, RuntimeOptions,
        TestOptions,
    };

    // TODO(port): mutable statics holding `*ContextData` and `ContextData`; single-threaded init
    static mut GLOBAL_CLI_CTX: Context = core::ptr::null_mut();
    static mut CONTEXT_DATA: core::mem::MaybeUninit<ContextData> = core::mem::MaybeUninit::uninit();

    pub use create_context_data as init;

    /// `ContextData.create` body — kept here because it calls `Arguments.parse`
    /// and reaches into Windows watcher hooks. Aliased onto `ContextData` in
    /// `options_types/Context.zig`.
    pub fn create_context_data<const COMMAND: Tag>(
        log: &mut logger::Log,
    ) -> Result<Context, bun_core::Error> {
        // SAFETY: single-threaded CLI startup
        unsafe { cli::CMD = Some(COMMAND) };
        // SAFETY: single-threaded CLI startup
        unsafe {
            CONTEXT_DATA.write(ContextData {
                // SAFETY: all-zero is a valid api::TransformOptions (#[repr(C)] POD,
                // no NonNull/NonZero/enum fields)
                args: core::mem::zeroed::<api::TransformOptions>(),
                log,
                start_time: START_TIME,
                // allocator dropped — global mimalloc
                ..Default::default()
            });
            GLOBAL_CLI_CTX = CONTEXT_DATA.assume_init_mut();
        }

        if Tag::USES_GLOBAL_OPTIONS.get(COMMAND) {
            // SAFETY: just initialized
            unsafe { (*GLOBAL_CLI_CTX).args = arguments::parse::<COMMAND>(GLOBAL_CLI_CTX)? };
        }

        #[cfg(windows)]
        {
            // SAFETY: just initialized
            let ctx = unsafe { &mut *GLOBAL_CLI_CTX };
            if ctx.debug.hot_reload == HotReload::Watch {
                if !bun_sys::windows::is_watcher_child() {
                    // this is noreturn
                    bun_sys::windows::become_watcher_manager();
                } else {
                    // SAFETY: single-threaded startup
                    unsafe { bun_core::AUTO_RELOAD_ON_CRASH = true };
                }
            }
        }

        // SAFETY: just initialized
        Ok(unsafe { GLOBAL_CLI_CTX })
    }

    // std.process.args allocates!
    struct ArgsIterator<'a> {
        buf: &'a [&'a ZStr],
        i: u32,
    }

    impl<'a> ArgsIterator<'a> {
        fn new(buf: &'a [&'a ZStr]) -> Self {
            Self { buf, i: 0 }
        }

        pub fn next(&mut self) -> Option<&'a [u8]> {
            if self.buf.len() <= self.i as usize {
                return None;
            }
            let i = self.i;
            self.i += 1;
            Some(self.buf[i as usize].as_bytes())
        }

        pub fn skip(&mut self) -> bool {
            self.next().is_some()
        }
    }

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

    pub fn which() -> Tag {
        let mut args_iter = ArgsIterator::new(bun::argv());

        let Some(argv0) = args_iter.next() else {
            return Tag::HelpCommand;
        };

        if is_bun_x(argv0) {
            // if we are bunx, but NOT a symlink to bun. when we run `<self> install`, we dont
            // want to recursively run bunx. so this check lets us peek back into bun install.
            if let Some(next) = args_iter.next() {
                if next == b"add" && bun_core::feature_flag::BUN_INTERNAL_BUNX_INSTALL::get() {
                    return Tag::AddCommand;
                } else if next == b"exec" && bun_core::feature_flag::BUN_INTERNAL_BUNX_INSTALL::get() {
                    return Tag::ExecCommand;
                }
            }

            // SAFETY: single-threaded startup
            unsafe { IS_BUNX_EXE = true };
            return Tag::BunxCommand;
        }

        if is_node(argv0) {
            bun_clap::streaming::set_warn_on_unrecognized_flag(false);
            // SAFETY: single-threaded startup
            unsafe { PRETEND_TO_BE_NODE = true };
            return Tag::RunAsNodeCommand;
        }

        let Some(mut next_arg) = args_iter.next() else {
            return Tag::AutoCommand;
        };
        while !next_arg.is_empty()
            && next_arg[0] == b'-'
            && !(next_arg.len() > 1 && next_arg[1] == b'e')
        {
            next_arg = match args_iter.next() {
                Some(a) => a,
                None => return Tag::AutoCommand,
            };
        }

        let first_arg_name = next_arg;
        type RootCommandMatcher = strings::ExactSizeMatcher<12>;

        match RootCommandMatcher::match_(first_arg_name) {
            x if x == RootCommandMatcher::case(b"init") => Tag::InitCommand,
            x if x == RootCommandMatcher::case(b"build") || x == RootCommandMatcher::case(b"bun") => {
                Tag::BuildCommand
            }
            x if x == RootCommandMatcher::case(b"discord") => Tag::DiscordCommand,
            x if x == RootCommandMatcher::case(b"upgrade") => Tag::UpgradeCommand,
            x if x == RootCommandMatcher::case(b"completions") => Tag::InstallCompletionsCommand,
            x if x == RootCommandMatcher::case(b"getcompletes") => Tag::GetCompletionsCommand,
            x if x == RootCommandMatcher::case(b"link") => Tag::LinkCommand,
            x if x == RootCommandMatcher::case(b"unlink") => Tag::UnlinkCommand,
            x if x == RootCommandMatcher::case(b"x") => Tag::BunxCommand,
            x if x == RootCommandMatcher::case(b"repl") => Tag::ReplCommand,

            x if x == RootCommandMatcher::case(b"i") || x == RootCommandMatcher::case(b"install") => 'brk: {
                for arg in args_iter.buf {
                    if !arg.as_bytes().is_empty()
                        && (arg.as_bytes() == b"-g" || arg.as_bytes() == b"--global")
                    {
                        break 'brk Tag::AddCommand;
                    }
                }
                break 'brk Tag::InstallCommand;
            }
            x if x == RootCommandMatcher::case(b"ci") => Tag::InstallCommand,
            x if x == RootCommandMatcher::case(b"c") || x == RootCommandMatcher::case(b"create") => {
                Tag::CreateCommand
            }

            x if x == RootCommandMatcher::case(b"test") => Tag::TestCommand,

            x if x == RootCommandMatcher::case(b"pm") => Tag::PackageManagerCommand,

            x if x == RootCommandMatcher::case(b"add") || x == RootCommandMatcher::case(b"a") => {
                Tag::AddCommand
            }

            x if x == RootCommandMatcher::case(b"update") => Tag::UpdateCommand,
            x if x == RootCommandMatcher::case(b"patch") => Tag::PatchCommand,
            x if x == RootCommandMatcher::case(b"patch-commit") => Tag::PatchCommitCommand,

            x if x == RootCommandMatcher::case(b"r")
                || x == RootCommandMatcher::case(b"remove")
                || x == RootCommandMatcher::case(b"rm")
                || x == RootCommandMatcher::case(b"uninstall") =>
            {
                Tag::RemoveCommand
            }

            x if x == RootCommandMatcher::case(b"run") => Tag::RunCommand,
            x if x == RootCommandMatcher::case(b"help") => Tag::HelpCommand,

            x if x == RootCommandMatcher::case(b"exec") => Tag::ExecCommand,

            x if x == RootCommandMatcher::case(b"outdated") => Tag::OutdatedCommand,
            x if x == RootCommandMatcher::case(b"publish") => Tag::PublishCommand,
            x if x == RootCommandMatcher::case(b"audit") => Tag::AuditCommand,
            x if x == RootCommandMatcher::case(b"info") => Tag::InfoCommand,

            // These are reserved for future use by Bun, so that someone
            // doing `bun deploy` to run a script doesn't accidentally break
            // when we add our actual command
            x if x == RootCommandMatcher::case(b"deploy") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"cloud") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"config") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"use") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"auth") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"login") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"logout") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"whoami") => Tag::PackageManagerCommand,
            x if x == RootCommandMatcher::case(b"prune") => Tag::ReservedCommand,
            x if x == RootCommandMatcher::case(b"list") => Tag::PackageManagerCommand,
            x if x == RootCommandMatcher::case(b"why") => Tag::WhyCommand,
            x if x == RootCommandMatcher::case(b"fuzzilli") => {
                if bun_core::Environment::ENABLE_FUZZILLI {
                    Tag::FuzzilliCommand
                } else {
                    Tag::AutoCommand
                }
            }

            x if x == RootCommandMatcher::case(b"-e") => Tag::AutoCommand,

            _ => Tag::AutoCommand,
        }
        // PERF(port): Zig's `switch` over RootCommandMatcher cases compiles to a jump table on the
        // packed u96; Rust `match x if x == const` is a chain of compares — profile in Phase B.
    }

    const DEFAULT_COMPLETIONS_LIST: &[&[u8]] = &[
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
    ];

    // TODO(port): Zig concatenated DEFAULT_COMPLETIONS_LIST ++ extras at comptime; Phase B uses a
    // const fn or just hand-rolls the joined slice (small).
    const REJECT_LIST: &[&[u8]] = &[
        b"build", b"install", b"add", b"run", b"update", b"link", b"unlink", b"remove", b"create",
        b"bun", b"upgrade", b"discord", b"test", b"pm", b"x", b"repl", b"info",
        // extras:
        b"build", b"completions", b"help",
    ];

    /// Keep the stack space usage of this function small. This function is
    /// kept alive for the entire duration of the process
    ///
    /// So do not add any path buffers or anything that is large in this
    /// function or that stack space is used up forever.
    pub fn start(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        if cfg!(debug_assertions) {
            if !bun_core::env_var::MI_VERBOSE::get() {
                bun_alloc::mimalloc::mi_option_set_enabled(bun_alloc::mimalloc::Option::Verbose, false);
            }
        }

        // WebView host subprocess entry. Must be before StandaloneModuleGraph,
        // before JSC init, before anything that touches a JS engine. The child
        // runs CFRunLoopRun() as its real main loop — no Bun runtime past this.
        #[cfg(target_os = "macos")]
        {
            if let Some(fd_str) = bun_core::env_var::BUN_INTERNAL_WEBVIEW_HOST::get() {
                // Zig: `std.fmt.parseInt(u31, fd_str, 10)` — parse base-10 directly
                // from bytes; env var values are `&[u8]`, not assumed UTF-8.
                let fd: u32 = match (|| {
                    if fd_str.is_empty() {
                        return None;
                    }
                    let mut acc: u32 = 0;
                    for &b in fd_str {
                        let d = u32::from(b.wrapping_sub(b'0'));
                        if d > 9 {
                            return None;
                        }
                        acc = acc.checked_mul(10)?.checked_add(d)?;
                    }
                    Some(acc)
                })() {
                    Some(v) if v <= i32::MAX as u32 => v,
                    _ => Output::panic(
                        "Invalid BUN_INTERNAL_WEBVIEW_HOST fd: {}",
                        format_args!("{}", bstr::BStr::new(fd_str)),
                    ),
                };
                // TODO(port): move to cli_sys
                unsafe extern "C" {
                    #[link_name = "Bun__WebView__hostMain"]
                    fn host_main(fd: i32) -> !;
                }
                // SAFETY: Bun__WebView__hostMain is a noreturn extern that takes
                // ownership of the IPC fd; `fd` validated above to fit i32.
                unsafe { host_main(i32::try_from(fd).unwrap()) };
            }
        }

        // bun build --compile entry point
        if !bun_core::feature_flag::BUN_BE_BUN::get() {
            if let Some(graph) = bun_core::StandaloneModuleGraph::from_executable()? {
                let mut offset_for_passthrough: usize = 0;

                let ctx: &mut ContextData = 'brk: {
                    if !graph.compile_exec_argv.is_empty() || bun::bun_options_argc() > 0 {
                        let original_argv_len = bun::argv().len();
                        // TODO(port): bun.argv is a mutable global slice of [:0]const u8
                        let mut argv_list: Vec<&'static ZStr> = bun::argv().to_vec();
                        if !graph.compile_exec_argv.is_empty() {
                            bun::append_options_env(&graph.compile_exec_argv, &mut argv_list)?;
                        }

                        // Store the full argv including user arguments
                        let full_argv = argv_list.leak();
                        let num_exec_argv_options = full_argv.len().saturating_sub(original_argv_len);

                        // Calculate offset: skip executable name + all exec argv options + BUN_OPTIONS args
                        let num_parsed_options = num_exec_argv_options + bun::bun_options_argc();
                        offset_for_passthrough = if full_argv.len() > 1 {
                            1 + num_parsed_options
                        } else {
                            0
                        };

                        // Temporarily set bun.argv to only include executable name + exec_argv options + BUN_OPTIONS args.
                        // This prevents user arguments like --version/--help from being intercepted
                        // by Bun's argument parser (they should be passed through to user code).
                        bun::set_argv(&full_argv[0..(1 + num_parsed_options).min(full_argv.len())]);

                        // Handle actual options to parse.
                        let result = init::<{ Tag::AutoCommand }>(log)?;

                        // Restore full argv so passthrough calculation works correctly
                        bun::set_argv(full_argv);

                        break 'brk result;
                    }

                    // SAFETY: single-threaded startup
                    unsafe {
                        CONTEXT_DATA.write(ContextData {
                            // SAFETY: all-zero is a valid api::TransformOptions
                            // (#[repr(C)] POD, no NonNull/NonZero/enum fields)
                            args: core::mem::zeroed::<api::TransformOptions>(),
                            log,
                            start_time: START_TIME,
                            ..Default::default()
                        });
                        GLOBAL_CLI_CTX = CONTEXT_DATA.assume_init_mut();
                    }

                    // If no compile_exec_argv, skip executable name if present
                    offset_for_passthrough = 1.min(bun::argv().len());

                    // SAFETY: just initialized
                    break 'brk unsafe { &mut *GLOBAL_CLI_CTX };
                };

                ctx.args.target = api::Target::Bun;
                if ctx.debug.global_cache == DebugOptions::GlobalCache::Auto {
                    ctx.debug.global_cache = DebugOptions::GlobalCache::Disable;
                }
                // TODO(port): GlobalCache enum lives on options_types::Context; verify path

                ctx.passthrough = &bun::argv()[offset_for_passthrough..];

                bun_bun_js::Run::boot_standalone(ctx, graph.entry_point().name, graph)?;
                return Ok(());
            }
        }

        bun_output::scoped_log!(
            CLI,
            "argv: [{}]",
            bun_core::fmt::fmt_slice(bun::argv(), ", ")
        );

        let tag = which();

        match tag {
            Tag::DiscordCommand => return DiscordCommand::exec(),
            Tag::HelpCommand => return HelpCommand::exec(),
            Tag::ReservedCommand => return ReservedCommand::exec(),
            Tag::InitCommand => {
                return InitCommand::exec(&bun::argv()[2.min(bun::argv().len())..])
            }
            Tag::InfoCommand => {
                bun_info(log)?;
                return Ok(());
            }
            Tag::BuildCommand => {
                let ctx = init::<{ Tag::BuildCommand }>(log)?;
                BuildCommand::exec(ctx, None)?;
            }
            Tag::InstallCompletionsCommand => {
                InstallCompletionsCommand::exec()?;
                return Ok(());
            }
            Tag::InstallCommand => {
                let ctx = init::<{ Tag::InstallCommand }>(log)?;
                InstallCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::AddCommand => {
                let ctx = init::<{ Tag::AddCommand }>(log)?;
                AddCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::UpdateCommand => {
                let ctx = init::<{ Tag::UpdateCommand }>(log)?;
                UpdateCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::PatchCommand => {
                let ctx = init::<{ Tag::PatchCommand }>(log)?;
                PatchCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::PatchCommitCommand => {
                let ctx = init::<{ Tag::PatchCommitCommand }>(log)?;
                PatchCommitCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::OutdatedCommand => {
                let ctx = init::<{ Tag::OutdatedCommand }>(log)?;
                OutdatedCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::UpdateInteractiveCommand => {
                let ctx = init::<{ Tag::UpdateInteractiveCommand }>(log)?;
                UpdateInteractiveCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::PublishCommand => {
                let ctx = init::<{ Tag::PublishCommand }>(log)?;
                PublishCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::AuditCommand => {
                let ctx = init::<{ Tag::AuditCommand }>(log)?;
                AuditCommand::exec(ctx)?;
            }
            Tag::WhyCommand => {
                let ctx = init::<{ Tag::WhyCommand }>(log)?;
                WhyCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::BunxCommand => {
                let ctx = init::<{ Tag::BunxCommand }>(log)?;
                // SAFETY: IS_BUNX_EXE set during which() before any threads
                let start_idx = if unsafe { IS_BUNX_EXE } { 0 } else { 1 };
                BunxCommand::exec(ctx, &bun::argv()[start_idx..])?;
                return Ok(());
            }
            Tag::ReplCommand => {
                let ctx = init::<{ Tag::RunCommand }>(log)?;
                ReplCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::RemoveCommand => {
                let ctx = init::<{ Tag::RemoveCommand }>(log)?;
                RemoveCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::LinkCommand => {
                let ctx = init::<{ Tag::LinkCommand }>(log)?;
                LinkCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::UnlinkCommand => {
                let ctx = init::<{ Tag::UnlinkCommand }>(log)?;
                UnlinkCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::PackageManagerCommand => {
                let ctx = init::<{ Tag::PackageManagerCommand }>(log)?;
                PackageManagerCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::TestCommand => {
                let ctx = init::<{ Tag::TestCommand }>(log)?;
                test_command::TestCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::GetCompletionsCommand => {
                bun_getcompletes(log)?;
                return Ok(());
            }
            Tag::CreateCommand => {
                bun_create(log)?;
                return Ok(());
            }
            Tag::RunCommand => {
                let ctx = init::<{ Tag::RunCommand }>(log)?;
                ctx.args.target = api::Target::Bun;

                if ctx.parallel || ctx.sequential {
                    if let Err(err) = multi_run::run(ctx) {
                        Output::pretty_errorln("<r><red>error<r>: {}", format_args!("{}", err.name()));
                        Global::exit(1);
                    }
                }

                if !ctx.filters.is_empty() || ctx.workspaces {
                    if let Err(err) = filter_run::run_scripts_with_filter(ctx) {
                        Output::pretty_errorln("<r><red>error<r>: {}", format_args!("{}", err.name()));
                        Global::exit(1);
                    }
                }

                if !ctx.positionals.is_empty() {
                    if RunCommand::exec(
                        ctx,
                        RunCommand::ExecOptions {
                            bin_dirs_only: false,
                            log_errors: true,
                            allow_fast_run_for_extensions: false,
                        },
                    )? {
                        return Ok(());
                    }

                    Global::exit(1);
                }
            }
            Tag::RunAsNodeCommand => {
                let ctx = init::<{ Tag::RunAsNodeCommand }>(log)?;
                // SAFETY: set during which() before any threads
                debug_assert!(unsafe { PRETEND_TO_BE_NODE });
                RunCommand::exec_as_if_node(ctx)?;
            }
            Tag::UpgradeCommand => {
                let ctx = init::<{ Tag::UpgradeCommand }>(log)?;
                UpgradeCommand::exec(ctx)?;
                return Ok(());
            }
            Tag::AutoCommand => {
                let ctx = match init::<{ Tag::AutoCommand }>(log) {
                    Ok(c) => c,
                    Err(e) if e == bun_core::err!("MissingEntryPoint") => {
                        HelpCommand::exec_with_reason::<{ HelpCommand::Reason::Explicit }>();
                    }
                    Err(e) => return Err(e),
                };
                ctx.args.target = api::Target::Bun;

                if ctx.parallel || ctx.sequential {
                    if let Err(err) = multi_run::run(ctx) {
                        Output::pretty_errorln("<r><red>error<r>: {}", format_args!("{}", err.name()));
                        Global::exit(1);
                    }
                }

                if !ctx.filters.is_empty() || ctx.workspaces {
                    if let Err(err) = filter_run::run_scripts_with_filter(ctx) {
                        Output::pretty_errorln("<r><red>error<r>: {}", format_args!("{}", err.name()));
                        Global::exit(1);
                    }
                }

                if !ctx.runtime_options.eval.script.is_empty() {
                    return bun_eval_print(ctx);
                }

                let extension: &[u8] = if !ctx.args.entry_points.is_empty() {
                    bun_paths::extension(&ctx.args.entry_points[0])
                } else {
                    b""
                };
                // KEYWORDS: open file argv argv0
                if ctx.args.entry_points.len() == 1 {
                    if extension == b".lockb" {
                        return bun_lockb(ctx);
                    }
                }

                if !ctx.positionals.is_empty() {
                    if !ctx.filters.is_empty() {
                        Output::prettyln(
                            "<r><yellow>warn<r>: Filters are ignored for auto command",
                            format_args!(""),
                        );
                    }
                    if RunCommand::exec(
                        ctx,
                        RunCommand::ExecOptions {
                            bin_dirs_only: true,
                            log_errors: !ctx.runtime_options.if_present,
                            allow_fast_run_for_extensions: true,
                        },
                    )? {
                        return Ok(());
                    }
                    return Ok(());
                }

                Output::flush();
                HelpCommand::exec()?;
            }
            Tag::ExecCommand => {
                let ctx = init::<{ Tag::ExecCommand }>(log)?;

                if ctx.positionals.len() > 1 {
                    ExecCommand::exec(ctx)?;
                } else {
                    tag_print_help::<{ Tag::ExecCommand }>(true);
                }
            }
            Tag::FuzzilliCommand => {
                if bun_core::Environment::ENABLE_FUZZILLI {
                    let ctx = init::<{ Tag::FuzzilliCommand }>(log)?;
                    FuzzilliCommand::exec(ctx)?;
                    return Ok(());
                } else {
                    return Err(bun_core::err!("UnrecognizedCommand"));
                }
            }
        }
        Ok(())
    }

    pub use bun_options_types::command_tag::Tag;

    pub fn tag_params<const CMD: Tag>() -> &'static [arguments::ParamType] {
        match CMD {
            Tag::AutoCommand => arguments::AUTO_PARAMS,
            Tag::RunCommand | Tag::RunAsNodeCommand => arguments::RUN_PARAMS,
            Tag::BuildCommand => arguments::BUILD_PARAMS,
            Tag::TestCommand => arguments::TEST_PARAMS,
            Tag::BunxCommand => arguments::RUN_PARAMS,
            // TODO(port): comptime concat of base_params_ ++ runtime_params_ ++ transpiler_params_
            _ => arguments::BASE_RUNTIME_TRANSPILER_PARAMS,
        }
    }

    pub fn tag_print_help<const CMD: Tag>(show_all_flags: bool) {
        match CMD {
            // the output of --help uses the following syntax highlighting
            // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
            // use [foo] for multiple arguments or flags for foo.
            // use <bar> to emphasize 'bar'

            // these commands do not use Context
            // .DiscordCommand => return try DiscordCommand.exec(allocator),
            // .HelpCommand => return try HelpCommand.exec(allocator),
            // .ReservedCommand => return try ReservedCommand.exec(allocator),

            // these commands are implemented in install.zig
            // Command.Tag.InstallCommand => {},
            // Command.Tag.AddCommand => {},
            // Command.Tag.RemoveCommand => {},
            // Command.Tag.UpdateCommand => {},
            // Command.Tag.PackageManagerCommand => {},
            // Command.Tag.LinkCommand => {},
            // Command.Tag.UnlinkCommand => {},

            // fall back to HelpCommand.printWithReason
            Tag::AutoCommand => {
                HelpCommand::print_with_reason::<{ HelpCommand::Reason::Explicit }>(show_all_flags);
            }
            Tag::RunCommand | Tag::RunAsNodeCommand => {
                run_command::RunCommand::print_help(None);
            }

            Tag::InitCommand => {
                const INTRO_TEXT: &str = "\
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
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::flush();
            }

            Tag::BunxCommand => {
                Output::pretty_errorln(
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
",
                    format_args!(""),
                );
            }
            Tag::BuildCommand => {
                const INTRO_TEXT: &str = "\
<b>Usage<r>:
  Transpile and bundle one or more files.
  <b><green>bun build<r> <cyan>[flags]<r> <blue>\\<entrypoint\\><r>";

                const OUTRO_TEXT: &str = "\
<b>Examples:<r>
  <d>Frontend web apps:<r>
  <b><green>bun build<r> <cyan>--outfile=bundle.js<r> <blue>./src/index.ts<r>
  <b><green>bun build<r> <cyan>--minify --splitting --outdir=out<r> <blue>./index.jsx ./lib/worker.ts<r>

  <d>Bundle code to be run in Bun (reduces server startup time)<r>
  <b><green>bun build<r> <cyan>--target=bun --outfile=server.js<r> <blue>./server.ts<r>

  <d>Creating a standalone executable (see https://bun.com/docs/bundler/executables)<r>
  <b><green>bun build<r> <cyan>--compile --outfile=my-app<r> <blue>./cli.ts<r>

A full list of flags is available at <magenta>https://bun.com/docs/bundler<r>
";

                Output::pretty(const_format::concatcp!(INTRO_TEXT, "\n\n"), format_args!(""));
                Output::flush();
                Output::pretty("<b>Flags:<r>", format_args!(""));
                Output::flush();
                clap::simple_help(arguments::BUILD_ONLY_PARAMS);
                Output::pretty(const_format::concatcp!("\n\n", OUTRO_TEXT), format_args!(""));
                Output::flush();
            }
            Tag::TestCommand => {
                const INTRO_TEXT: &str = "\
<b>Usage<r>: <b><green>bun test<r> <cyan>[flags]<r> <blue>[\\<patterns\\>]<r>
  Run all matching test files and print the results to stdout";
                const OUTRO_TEXT: &str = "\
<b>Examples:<r>
  <d>Run all test files<r>
  <b><green>bun test<r>

  <d>Run all test files with \"foo\" or \"bar\" in the file name<r>
  <b><green>bun test<r> <blue>foo bar<r>

  <d>Run all test files, only including tests whose names includes \"baz\"<r>
  <b><green>bun test<r> <cyan>--test-name-pattern<r> <blue>baz<r>

Full documentation is available at <magenta>https://bun.com/docs/cli/test<r>
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::flush();
                Output::pretty("\n\n<b>Flags:<r>", format_args!(""));
                Output::flush();
                clap::simple_help(arguments::TEST_ONLY_PARAMS);
                Output::pretty("\n\n", format_args!(""));
                Output::pretty(OUTRO_TEXT, format_args!(""));
                Output::flush();
            }
            Tag::CreateCommand => {
                const INTRO_TEXT: &str = "\
<b>Usage<r><d>:<r>
  <b><green>bun create<r> <magenta>\\<MyReactComponent.(jsx|tsx)\\><r>
  <b><green>bun create<r> <magenta>\\<template\\><r> <cyan>[...flags]<r> <blue>dest<r>
  <b><green>bun create<r> <magenta>\\<github-org/repo\\><r> <cyan>[...flags]<r> <blue>dest<r>

<b>Environment variables<r><d>:<r>
  <cyan>GITHUB_TOKEN<r>         <d>Supply a token to download code from GitHub with a higher rate limit<r>
  <cyan>GITHUB_API_DOMAIN<r>    <d>Configure custom/enterprise GitHub domain. Default \"api.github.com\"<r>
  <cyan>NPM_CLIENT<r>           <d>Absolute path to the npm client executable<r>
  <cyan>BUN_CREATE_DIR<r>       <d>Custom path for global templates (default: $HOME/.bun-create)<r>";

                const OUTRO_TEXT: &str = "\
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
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::pretty("\n\n", format_args!(""));
                Output::pretty(OUTRO_TEXT, format_args!(""));
                Output::flush();
            }
            Tag::HelpCommand => {
                // TODO(port): Zig calls printWithReason(.explicit) with one arg here but the
                // function signature takes two. Likely default param in Zig — pass false.
                HelpCommand::print_with_reason::<{ HelpCommand::Reason::Explicit }>(false);
            }
            Tag::UpgradeCommand => {
                const INTRO_TEXT: &str = "\
<b>Usage<r>: <b><green>bun upgrade<r> <cyan>[flags]<r>
  Upgrade Bun";
                const OUTRO_TEXT: &str = "\
<b>Examples:<r>
  <d>Install the latest {} version<r>
  <b><green>bun upgrade<r>

  <d>{}<r>
  <b><green>bun upgrade<r> <cyan>--{}<r>

Full documentation is available at <magenta>https://bun.com/docs/installation#upgrading<r>
";

                let args: (&str, &str, &str) = if bun_core::Environment::IS_CANARY {
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

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::pretty("\n\n", format_args!(""));
                Output::flush();
                Output::pretty(OUTRO_TEXT, format_args!("{}{}{}", args.0, args.1, args.2));
                // TODO(port): Output::pretty positional substitution
                Output::flush();
            }
            Tag::ReplCommand => {
                const INTRO_TEXT: &str = "\
<b>Usage<r>: <b><green>bun repl<r> <cyan>[flags]<r>
  Open a Bun REPL
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::flush();
            }

            Tag::GetCompletionsCommand => {
                Output::pretty("<b>Usage<r>: <b><green>bun getcompletes<r>", format_args!(""));
                Output::flush();
            }
            Tag::InstallCompletionsCommand => {
                Output::pretty("<b>Usage<r>: <b><green>bun completions<r>", format_args!(""));
                Output::flush();
            }
            Tag::PatchCommand => {
                bun_install::PackageManager::CommandLineArguments::print_help(
                    bun_install::PackageManager::Subcommand::Patch,
                );
            }
            Tag::PatchCommitCommand => {
                bun_install::PackageManager::CommandLineArguments::print_help(
                    bun_install::PackageManager::Subcommand::PatchCommit,
                );
            }
            Tag::ExecCommand => {
                Output::pretty(
                    "\
<b>Usage: bun exec <r><cyan>\\<script\\><r>

Execute a shell script directly from Bun.

<b><red>Note<r>: If executing this from a shell, make sure to escape the string!

<b>Examples<d>:<r>
  <b>bun exec \"echo hi\"<r>
  <b>bun exec \"echo \\\"hey friends\\\"!\"<r>
",
                    format_args!(""),
                );
                Output::flush();
            }
            Tag::OutdatedCommand
            | Tag::UpdateInteractiveCommand
            | Tag::PublishCommand
            | Tag::AuditCommand => {
                bun_install::PackageManager::CommandLineArguments::print_help(match CMD {
                    Tag::OutdatedCommand => bun_install::PackageManager::Subcommand::Outdated,
                    Tag::UpdateInteractiveCommand => bun_install::PackageManager::Subcommand::Update,
                    Tag::PublishCommand => bun_install::PackageManager::Subcommand::Publish,
                    Tag::AuditCommand => bun_install::PackageManager::Subcommand::Audit,
                    _ => unreachable!(),
                });
            }
            Tag::InfoCommand => {
                const INTRO_TEXT: &str = "\
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
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::flush();
            }
            Tag::WhyCommand => {
                const INTRO_TEXT: &str = "\
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
";

                Output::pretty(INTRO_TEXT, format_args!(""));
                Output::flush();
            }
            _ => {
                HelpCommand::print_with_reason::<{ HelpCommand::Reason::Explicit }>(false);
            }
        }
    }

    fn bun_eval_print(ctx: Context) -> Result<(), bun_core::Error> {
        let trigger = bun_paths::path_literal(b"/[eval]");
        let mut entry_point_buf = [0u8; bun_paths::MAX_PATH_BYTES + 8 /* trigger.len() */];
        // TODO(port): const-fold trigger.len() into array length once path_literal is const fn
        let cwd = bun_sys::getcwd(&mut entry_point_buf)
            .unwrap()
            .map_err(bun_core::Error::from)?;
        // TODO(port): Zig used std.posix.getcwd; use bun_sys::getcwd
        let cwd_len = cwd.len();
        entry_point_buf[cwd_len..cwd_len + trigger.len()].copy_from_slice(trigger);
        // TODO(port): std.mem.concat — Vec concat
        let mut concatenated: Vec<&[u8]> = Vec::with_capacity(ctx.positionals.len() + ctx.passthrough.len());
        concatenated.extend_from_slice(ctx.positionals);
        concatenated.extend_from_slice(ctx.passthrough);
        ctx.passthrough = concatenated.leak();
        bun_bun_js::Run::boot(ctx, &entry_point_buf[0..cwd_len + trigger.len()], None)?;
        Ok(())
    }

    fn bun_lockb(ctx: Context) -> Result<(), bun_core::Error> {
        for arg in bun::argv() {
            if arg.as_bytes() == b"--hash" {
                let mut path_buf = bun_paths::PathBuffer::uninit();
                let entry = &ctx.args.entry_points[0];
                path_buf[0..entry.len()].copy_from_slice(entry);
                path_buf[entry.len()] = 0;
                // SAFETY: NUL written at path_buf[entry.len()] above
                let lockfile_path = unsafe { ZStr::from_raw(path_buf.as_ptr(), entry.len()) };
                let file = match File::open(lockfile_path, bun_sys::O::RDONLY, 0).unwrap() {
                    Ok(f) => f,
                    Err(err) => {
                        Output::err(err, "failed to open lockfile", format_args!(""));
                        Global::crash();
                    }
                };
                PackageManagerCommand::print_hash(ctx, file)?;
                return Ok(());
            }
        }

        bun_install::Lockfile::Printer::print(
            ctx.log,
            &ctx.args.entry_points[0],
            bun_install::Lockfile::Printer::Format::Yarn,
        )?;
        Ok(())
    }

    fn bun_getcompletes(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        let ctx = init::<{ Tag::GetCompletionsCommand }>(log)?;
        let mut filter = ctx.positionals;

        for (i, item) in filter.iter().enumerate() {
            if *item == b"getcompletes" {
                if i + 1 < filter.len() {
                    filter = &filter[i + 1..];
                } else {
                    filter = &[];
                }
                break;
            }
        }
        let mut prefilled_completions: [&[u8]; add_completions::BIGGEST_LIST] =
            [b""; add_completions::BIGGEST_LIST];
        let mut completions = ShellCompletions::ShellCompletions::default();

        if filter.is_empty() {
            completions = RunCommand::completions(
                ctx,
                Some(DEFAULT_COMPLETIONS_LIST),
                REJECT_LIST,
                RunCommand::CompletionKind::All,
            )?;
        } else if filter[0] == b"s" {
            completions =
                RunCommand::completions(ctx, None, REJECT_LIST, RunCommand::CompletionKind::Script)?;
        } else if filter[0] == b"i" {
            completions = RunCommand::completions(
                ctx,
                Some(DEFAULT_COMPLETIONS_LIST),
                REJECT_LIST,
                RunCommand::CompletionKind::ScriptExclude,
            )?;
        } else if filter[0] == b"b" {
            completions =
                RunCommand::completions(ctx, None, REJECT_LIST, RunCommand::CompletionKind::Bin)?;
        } else if filter[0] == b"r" {
            completions =
                RunCommand::completions(ctx, None, REJECT_LIST, RunCommand::CompletionKind::All)?;
        } else if filter[0] == b"g" {
            completions = RunCommand::completions(
                ctx,
                None,
                REJECT_LIST,
                RunCommand::CompletionKind::AllPlusBunJs,
            )?;
        } else if filter[0] == b"j" {
            completions =
                RunCommand::completions(ctx, None, REJECT_LIST, RunCommand::CompletionKind::BunJs)?;
        } else if filter[0] == b"z" {
            completions = RunCommand::completions(
                ctx,
                None,
                REJECT_LIST,
                RunCommand::CompletionKind::ScriptAndDescriptions,
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
                    completions.commands = &prefilled_completions[0..prefilled_i];
                    // TODO(port): lifetime — `commands` borrows stack array; Zig stack-slice was
                    // OK because print() runs before return. Same here.
                }
            }
        }
        completions.print();
        Ok(())
    }

    fn bun_create(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        // These are templates from the legacy `bun create`
        // most of them aren't useful but these few are kinda nice.
        static HARDCODED_NON_BUN_X_LIST: phf::Set<&'static [u8]> = phf::phf_set! {
            b"elysia",
            b"elysia-buchta",
            b"stric",
        };

        // Create command wraps bunx
        let ctx = init::<{ Tag::CreateCommand }>(log)?;

        // TODO(port): std.process.argsAlloc — bun::argv() already has the process args
        let args = bun::argv();

        if args.len() <= 2 {
            tag_print_help::<{ Tag::CreateCommand }>(false);
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
            // "bun create --"
            // "bun create -abc --"
            || positional_i == 0
            || positionals[1].is_empty()
        {
            tag_print_help::<{ Tag::CreateCommand }>(true);
            Global::exit(0);
        }

        let template_name = positionals[1];

        // if template_name is "react"
        // print message telling user to use "bun create vite" instead
        if template_name == b"react" {
            Output::pretty_errorln(
                "\
The \"react\" template has been deprecated.
It is recommended to use \"react-app\" or \"vite\" instead.

To create a project using Create React App, run

  <d>bun create react-app<r>

To create a React project using Vite, run

  <d>bun create vite<r>

Then select \"React\" from the list of frameworks.
",
                format_args!(""),
            );
            Global::exit(1);
        }

        // if template_name is "next"
        // print message telling user to use "bun create next-app" instead
        if template_name == b"next" {
            Output::pretty_errorln(
                "\
<yellow>warn: No template <b>create-next<r> found.
To create a project with the official Next.js scaffolding tool, run
  <b>bun create next-app <cyan>[destination]<r>",
                format_args!(""),
            );
            Global::exit(1);
        }

        let create_command_info = CreateCommand::extract_info(ctx)?;
        let template = create_command_info.template;
        let example_tag = create_command_info.example_tag;

        let use_bunx = !HARDCODED_NON_BUN_X_LIST.contains(template_name)
            && (!strings::contains(template_name, b"/")
                || strings::starts_with_char(template_name, b'@'))
            && example_tag != CreateCommandExample::Tag::LocalFolder;

        if use_bunx {
            let mut bunx_args: Vec<&ZStr> = Vec::with_capacity(
                2 + args.len() - template_name_start + (dash_dash_bun as usize),
            );
            // TODO(port): Zig allocs `[:0]const u8` slice and indexes; use Vec push for clarity
            bunx_args.push(ZStr::from_static(b"bunx\0"));
            if dash_dash_bun {
                bunx_args.push(ZStr::from_static(b"--bun\0"));
            }
            bunx_args.push(BunxCommand::add_create_prefix(template_name)?);
            debug_assert_eq!(
                bunx_args.capacity() - bunx_args.len(),
                args[template_name_start..].len()
            );
            for src in &args[template_name_start..] {
                bunx_args.push(src);
            }

            BunxCommand::exec(ctx, &bunx_args)?;
            return Ok(());
        }

        CreateCommand::exec(ctx, example_tag, template)?;
        Ok(())
    }

    fn bun_info(log: &mut logger::Log) -> Result<(), bun_core::Error> {
        // Parse arguments manually since the standard flow doesn't work for standalone commands
        let cli = bun_install::PackageManager::CommandLineArguments::parse(
            bun_install::PackageManager::Subcommand::Info,
        )?;
        let ctx = init::<{ Tag::InfoCommand }>(log)?;
        let (pm, _) = bun_install::PackageManager::init(
            ctx,
            cli,
            bun_install::PackageManager::Subcommand::Info,
        )?;

        // Handle arguments correctly for standalone info command
        let mut package_name: &[u8] = b"";
        let mut property_path: Option<&[u8]> = None;

        // Find non-flag arguments starting from argv[2] (after "bun info")
        let mut arg_idx: usize = 2;
        let mut found_package = false;

        let argv = bun::argv();
        while arg_idx < argv.len() {
            let arg = argv[arg_idx].as_bytes();

            // Skip flags
            if !arg.is_empty() && arg[0] == b'-' {
                arg_idx += 1;
                continue;
            }

            if !found_package {
                package_name = arg;
                found_package = true;
            } else {
                property_path = Some(arg);
                break;
            }
            arg_idx += 1;
        }

        pm_view_command::view(pm, package_name, property_path, cli.json_output)?;
        Ok(())
    }
}
pub use command as Command;

#[cold]
pub fn print_version_and_exit() -> ! {
    let _ = Output::writer().write_all(
        const_format::concatcp!(Global::PACKAGE_JSON_VERSION, "\n").as_bytes(),
    );
    Global::exit(0);
}

#[cold]
pub fn print_revision_and_exit() -> ! {
    let _ = Output::writer().write_all(
        const_format::concatcp!(Global::PACKAGE_JSON_VERSION_WITH_REVISION, "\n").as_bytes(),
    );
    Global::exit(0);
}

// ───────────────── module declarations / cross-file refs ────────────────────
mod add_completions;
mod filter_run;
mod multi_run;
mod pm_view_command;
mod colon_list_type;
mod run_command;
mod test_command;
mod build_command;
mod add_command;
mod create_command;
mod discord_command;
mod install_command;
mod link_command;
mod unlink_command;
mod install_completions_command;
mod package_manager_command;
mod remove_command;
mod shell_completions;
mod update_command;
mod upgrade_command;
mod bunx_command;
mod exec_command;
mod patch_command;
mod patch_commit_command;
mod outdated_command;
mod update_interactive_command;
mod publish_command;
mod pack_command;
mod audit_command;
mod init_command;
mod why_command;
mod fuzzilli_command;
mod repl_command;

use bun_bun_js;
use bun_install;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/cli.zig (1493 lines)
//   confidence: medium
//   todos:      18
//   notes:      Heavy use of mutable statics (argv/ctx) and Output::pretty printf-style — Phase B must settle bun_core::argv()/set_argv() API and Output fmt-args wiring; ExactSizeMatcher match → guard chain (PERF flagged); Tag const-generic requires ConstParamTy on options_types::CommandTag.
// ──────────────────────────────────────────────────────────────────────────
