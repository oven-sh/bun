#![allow(unused_imports, dead_code)]
use core::ffi::c_void;
use std::sync::LazyLock;

use bun_clap as clap;
use bun_core::{self as bun, err, Error, Global, Output};
use bun_install::package_manager::{PackageManager, Subcommand};
use crate::cli::concat_params;
// PORT NOTE: `bun_install::package_manager` is a stub that only re-exports `PackageManager` +
// `Subcommand`; the real `CommandLineArguments` lives under the file-backed
// `package_manager_real::command_line_arguments` module, which is currently gated out
// (`#![cfg(any())]` reconciler-6: 1200+ errors). The bodies of `install`/`install_with_cli`
// below are stubbed with `todo!` until that module is un-gated.
// use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_bundler::bundle_v2::__phase_a_draft::{DependenciesScanner, DependenciesScannerResult};

use crate::build_command::BuildCommand;
use crate::command::ContextData;
use crate::{Cli, Command};

pub struct InstallCommand;

impl InstallCommand {
    pub fn exec(ctx: &mut ContextData) -> Result<(), Error> {
        // TODO(port): narrow error set
        match install(ctx) {
            Ok(()) => Ok(()),
            Err(e) if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") => {
                // SAFETY: `Cli::LOG_` is initialised once during single-threaded
                // startup in `Cli::start()` before any command (including this
                // one) is dispatched; no other `&mut` to it is live here.
                let log = unsafe { (*(&raw mut Cli::LOG_)).assume_init_mut() };
                let _ = log.print(Output::error_writer() as *mut _);
                Global::exit(1);
            }
            Err(e) => Err(e),
        }
    }
}

fn install(ctx: &mut ContextData) -> Result<(), Error> {
    // TODO(port): narrow error set
    let _ = ctx;

    // PORT NOTE: `CommandLineArguments::parse` (which would normally handle `--help`
    // before any install work) lives behind the reconciler-6 gate. Until that un-gates,
    // handle `--help` / `-h` here directly so `bun install --help` prints real help text
    // instead of panicking. The remaining install path stays blocked on the gate.
    for a in bun::argv().iter().skip(2) {
        if a == b"--help" || a == b"-h" {
            print_help();
            Global::exit(0);
        }
        if a == b"--" {
            break;
        }
    }

    // Real install path is still blocked on `CommandLineArguments` / `PackageManager::init`.
    // Degrade gracefully (clean error + exit) instead of `todo!()` panic so unrelated CLI
    // probes (e.g. help scanners) don't abort the process with a backtrace.
    Output::pretty(format_args!(
        "<r><red>error<r>: <b>bun install<r> is not yet available in this build (package manager port pending)\n"
    ));
    Output::flush();
    Global::exit(1);
    // ── real body, blocked on `CommandLineArguments` un-gate ──────────────
    // let mut cli = CommandLineArguments::parse(Subcommand::Install)?;
    //
    // // The way this works:
    // // 1. Run the bundler on source files
    // // 2. Rewrite positional arguments to act identically to the developer
    // //    typing in the dependency names
    // // 3. Run the install command
    // if cli.analyze {
    //     struct Analyzer<'a> {
    //         ctx: &'a mut ContextData,
    //         cli: &'a mut CommandLineArguments,
    //     }
    //     impl<'a> Analyzer<'a> {
    //         pub fn on_analyze(
    //             &mut self,
    //             result: &mut DependenciesScannerResult,
    //         ) -> Result<(), Error> {
    //             // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
    //             let keys = result.dependencies.keys();
    //             // TODO(port): lifetime — positionals stores borrowed &[u8] from result.dependencies; verify ownership in Phase B
    //             let mut positionals: Vec<&[u8]> = vec![b"" as &[u8]; keys.len() + 1];
    //             positionals[0] = b"install";
    //             positionals[1..].copy_from_slice(keys);
    //             self.cli.positionals = positionals.into_boxed_slice();
    //
    //             install_with_cli(self.ctx, self.cli.clone())?;
    //
    //             Global::exit(0);
    //         }
    //     }
    //     let mut analyzer = Analyzer {
    //         ctx,
    //         cli: &mut cli,
    //     };
    //
    //     // PORT NOTE: reshaped for borrowck — capture entry_points slice before borrowing cli mutably via analyzer
    //     let entry_points = analyzer.cli.positionals[1..].to_vec().into_boxed_slice();
    //
    //     let mut fetcher = DependenciesScanner {
    //         ctx: &mut analyzer as *mut Analyzer<'_> as *mut c_void,
    //         entry_points,
    //         // TODO(port): @ptrCast of method fn pointer — DependenciesScanner.onFetch likely expects
    //         // `unsafe extern "C" fn(*mut c_void, *mut DependenciesScannerResult) -> Result<(), Error>`;
    //         // wire a trampoline in Phase B.
    //         // SAFETY: @ptrCast — Analyzer::on_analyze has layout-compatible signature with
    //         // DependenciesScanner.on_fetch; ctx is &mut Analyzer passed as *mut c_void above.
    //         // TODO(port): replace with explicit C-ABI trampoline in Phase B.
    //         on_fetch: unsafe {
    //             core::mem::transmute::<
    //                 fn(&mut Analyzer<'_>, &mut DependenciesScannerResult) -> Result<(), Error>,
    //                 _,
    //             >(Analyzer::on_analyze)
    //         },
    //     };
    //
    //     // SAFETY: `Command::global_ctx()` is valid after `create_context_data`
    //     // has run during single-threaded CLI startup.
    //     BuildCommand::exec(unsafe { &mut *Command::global_ctx() }, Some(&mut fetcher))?;
    //     return Ok(());
    // }
    //
    // install_with_cli(ctx, cli)
}

fn install_with_cli(ctx: &mut ContextData /* , cli: CommandLineArguments */) -> Result<(), Error> {
    // TODO(port): narrow error set
    let _ = ctx;
    todo!(
        "blocked_on: bun_install::package_manager_real::CommandLineArguments / PackageManager::init \
         (reconciler-6 gate)"
    )
    // ── real body, blocked on `package_manager_real` un-gate ──────────────
    // let subcommand: Subcommand = if cli.positionals.len() > 1 {
    //     Subcommand::Add
    // } else {
    //     Subcommand::Install
    // };
    //
    // // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // // and cleanup install/add subcommand usage
    // let (manager, original_cwd) = PackageManager::init(ctx, cli, Subcommand::Install)?;
    //
    // // switch to `bun add <package>`
    // if subcommand == Subcommand::Add {
    //     manager.subcommand = Subcommand::Add;
    //     if manager.options.should_print_command_name() {
    //         Output::prettyln(const_format::concatcp!(
    //             "<r><b>bun add <r><d>v",
    //             Global::package_json_version_with_sha,
    //             "<r>\n"
    //         ));
    //         Output::flush();
    //     }
    //     return manager.update_package_json_and_install_with_manager(ctx, original_cwd);
    // }
    //
    // if manager.options.should_print_command_name() {
    //     Output::prettyln(const_format::concatcp!(
    //         "<r><b>bun install <r><d>v",
    //         Global::package_json_version_with_sha,
    //         "<r>\n"
    //     ));
    //     Output::flush();
    // }
    //
    // manager.install_with_manager(ctx, PackageManager::ROOT_PACKAGE_JSON_PATH, original_cwd)?;
    //
    // if manager.any_failed_to_install {
    //     Global::exit(1);
    // }
    //
    // Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// `bun install --help` — lifted from `CommandLineArguments::print_help`
// (src/install/PackageManager/CommandLineArguments.zig, `.install` arm) so the
// help path works while `package_manager_real` remains `#![cfg(any())]`-gated.
// When that module un-gates this block should be deleted in favour of
// `CommandLineArguments::parse` handling `--help` itself.
// ──────────────────────────────────────────────────────────────────────────

type ParamType = clap::Param<clap::Help>;

static SHARED_PARAMS: &[ParamType] = &[
    clap::param!("-c, --config <STR>?                   Specify path to config file (bunfig.toml)"),
    clap::param!("-y, --yarn                            Write a yarn.lock file (yarn v1)"),
    clap::param!("-p, --production                      Don't install devDependencies"),
    clap::param!("-P, --prod"),
    clap::param!("--no-save                             Don't update package.json or save a lockfile"),
    clap::param!("--save                                Save to package.json (true by default)"),
    clap::param!("--ca <STR>...                         Provide a Certificate Authority signing certificate"),
    clap::param!("--cafile <STR>                        The same as `--ca`, but is a file path to the certificate"),
    clap::param!("--dry-run                             Perform a dry run without making changes"),
    clap::param!("--frozen-lockfile                     Disallow changes to lockfile"),
    clap::param!("-f, --force                           Always request the latest versions from the registry & reinstall all dependencies"),
    clap::param!("--cache-dir <PATH>                    Store & load cached data from a specific directory path"),
    clap::param!("--no-cache                            Ignore manifest cache entirely"),
    clap::param!("--silent                              Don't log anything"),
    clap::param!("--quiet                               Only show tarball name when packing"),
    clap::param!("--verbose                             Excessively verbose logging"),
    clap::param!("--no-progress                         Disable the progress bar"),
    clap::param!("--no-summary                          Don't print a summary"),
    clap::param!("--no-verify                           Skip verifying integrity of newly downloaded packages"),
    clap::param!("--ignore-scripts                      Skip lifecycle scripts in the project's package.json (dependency scripts are never run)"),
    clap::param!("--trust                               Add to trustedDependencies in the project's package.json and install the package(s)"),
    clap::param!("-g, --global                          Install globally"),
    clap::param!("--cwd <STR>                           Set a specific cwd"),
    // PORT NOTE: Zig builds the `--backend` help string at comptime with the
    // platform-specific suffix; `clap::param!` only accepts a literal token, so
    // duplicate per-platform here.
    #[cfg(target_os = "macos")]
    clap::param!("--backend <STR>                       Platform-specific optimizations for installing dependencies. Possible values: \"clonefile\" (default), \"hardlink\", \"symlink\", \"copyfile\""),
    #[cfg(not(target_os = "macos"))]
    clap::param!("--backend <STR>                       Platform-specific optimizations for installing dependencies. Possible values: \"hardlink\" (default), \"symlink\", \"copyfile\""),
    clap::param!("--registry <STR>                      Use a specific registry by default, overriding .npmrc, bunfig.toml and environment variables"),
    clap::param!("--concurrent-scripts <NUM>            Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores)"),
    clap::param!("--network-concurrency <NUM>           Maximum number of concurrent network requests (default 48)"),
    clap::param!("--save-text-lockfile                  Save a text-based lockfile"),
    clap::param!("--omit <dev|optional|peer>...         Exclude 'dev', 'optional', or 'peer' dependencies from install"),
    clap::param!("--lockfile-only                       Generate a lockfile without installing dependencies"),
    clap::param!("--linker <STR>                        Linker strategy (one of \"isolated\" or \"hoisted\")"),
    clap::param!("--minimum-release-age <NUM>           Only install packages published at least N seconds ago (security feature)"),
    clap::param!("--cpu <STR>...                        Override CPU architecture for optional dependencies (e.g., x64, arm64, * for all)"),
    clap::param!("--os <STR>...                         Override operating system for optional dependencies (e.g., linux, darwin, * for all)"),
    clap::param!("-h, --help                            Print this help menu"),
];

static INSTALL_PARAMS: LazyLock<Vec<ParamType>> = LazyLock::new(|| {
    concat_params!(SHARED_PARAMS, [
        clap::param!("-d, --dev                 Add dependency to \"devDependencies\""),
        clap::param!("-D, --development"),
        clap::param!("--optional                        Add dependency to \"optionalDependencies\""),
        clap::param!("--peer                        Add dependency to \"peerDependencies\""),
        clap::param!("-E, --exact                  Add the exact version instead of the ^range"),
        clap::param!("--filter <STR>...                 Install packages for the matching workspaces"),
        clap::param!("-a, --analyze                   Analyze & install all dependencies of files passed as arguments recursively (using Bun's bundler)"),
        clap::param!("--only-missing                  Only add dependencies to package.json if they are not already present"),
        clap::param!("<POS> ...                         "),
    ])
});

fn print_help() {
    // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
    const INTRO_TEXT: &str = "\n\
<b>Usage<r>: <b><green>bun install<r> <cyan>[flags]<r> <blue>\\<name\\><r><d>@\\<version\\><r>\n\
<b>Alias<r>: <b><green>bun i<r>\n\n\
\x20 Install the dependencies listed in package.json.\n\n\
<b>Flags:<r>";
    const OUTRO_TEXT: &str = "\n\n\
<b>Examples:<r>\n\
\x20 <d>Install the dependencies for the current project<r>\n\
\x20 <b><green>bun install<r>\n\n\
\x20 <d>Skip devDependencies<r>\n\
\x20 <b><green>bun install<r> <cyan>--production<r>\n\n\
Full documentation is available at <magenta>https://bun.com/docs/cli/install<r>.\n";

    Output::pretty(format_args!("{}", INTRO_TEXT));
    clap::simple_help(&INSTALL_PARAMS);
    Output::pretty(format_args!("{}", OUTRO_TEXT));
    Output::flush();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/install_command.zig (97 lines)
//   confidence: low
//   todos:      7
//   notes:      Bodies stubbed with todo!() — blocked on bun_install::package_manager_real
//               un-gate (reconciler-6). Real ported bodies preserved as comments above.
//               Analyzer.on_analyze fn-ptr cast (@ptrCast) needs a C-ABI trampoline;
//               positionals lifetime/ownership needs verification; borrowck reshape
//               around entry_points.
// ──────────────────────────────────────────────────────────────────────────
