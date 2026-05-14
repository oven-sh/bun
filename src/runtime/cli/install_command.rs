use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Error, Global, Output, err};
use bun_install::package_manager_real::{
    CommandLineArguments, PackageManager, ROOT_PACKAGE_JSON_PATH, Subcommand, install_with_manager,
    update_package_json_and_install_with_manager,
};

use crate::Cli;
use crate::build_command::BuildCommand;
use crate::command::ContextData;

pub struct InstallCommand;

impl InstallCommand {
    pub fn exec(ctx: &mut ContextData) -> Result<(), Error> {
        match install(ctx) {
            Ok(()) => Ok(()),
            Err(e) => Self::handle_error(e),
        }
    }

    /// Cold, out-of-line error path so the hot `bun install` dispatch in `exec`
    /// stays small and contiguous in `.text` (the "no changes" fast path never
    /// touches this code, and demand-paging it in pollutes the startup window).
    #[cold]
    #[inline(never)]
    fn handle_error(e: Error) -> Result<(), Error> {
        // TODO(port): narrow error set
        if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") {
            // SAFETY: `Cli::LOG_` is initialised once during single-threaded
            // startup in `Cli::start()` before any command (including this
            // one) is dispatched; no other `&mut` to it is live here.
            let log = unsafe { (*Cli::LOG_.get()).assume_init_mut() };
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e)
    }
}

// Kept out-of-line (not inlined into the `exec` dispatcher) so it survives as a
// distinct symbol the release link's symbol-ordering file can cluster next to the
// rest of the `bun install` startup path (PackageManager::init, lockfile diff,
// resolver/transpiler setup) — otherwise these live on unrelated 4 KB pages of
// the ~84 MB binary and get faulted in one page at a time.
#[inline(never)]
fn install(ctx: &mut ContextData) -> Result<(), Error> {
    // TODO(port): narrow error set
    let mut cli = CommandLineArguments::parse(Subcommand::Install)?;

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        // PORT NOTE: hoisted from Zig fn-local `const Analyzer = struct {...}`.
        // `ctx` is stored as a raw `*mut ContextData` (Zig `Command.Context` is
        // `*ContextData` — a freely-aliasing pointer); the `on_fetch` callback
        // re-enters the install path while `BuildCommand::exec` still holds the
        // global `Context`, so a Rust `&mut` here would be aliased UB.
        struct Analyzer {
            ctx: *mut ContextData,
            cli: *mut CommandLineArguments,
        }
        impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer {
            fn on_analyze(
                &mut self,
                result: &mut DependenciesScannerResult<'_, '_>,
            ) -> Result<(), Error> {
                let this = self;
                // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                //
                // Process-lifetime storage for the rewritten positionals.
                // Zig: `bun.default_allocator.alloc(string, keys.len + 1)` with
                // no matching free — `Global::exit(0)` follows immediately.
                // `OnceLock` (not leaking) per PORTING.md §Forbidden.
                static OWNED_KEYS: std::sync::OnceLock<Vec<Box<[u8]>>> = std::sync::OnceLock::new();
                static POSITIONALS: std::sync::OnceLock<Vec<&'static [u8]>> =
                    std::sync::OnceLock::new();

                let owned = OWNED_KEYS.get_or_init(|| {
                    result
                        .dependencies
                        .keys()
                        .iter()
                        .map(|k| Box::<[u8]>::from(&**k))
                        .collect()
                });
                let positionals = POSITIONALS.get_or_init(|| {
                    let mut v: Vec<&'static [u8]> = Vec::with_capacity(owned.len() + 1);
                    v.push(b"install");
                    for k in owned {
                        v.push(&**k);
                    }
                    v
                });

                // SAFETY: `this.cli` / `this.ctx` were set from live stack
                // locals in `install()` whose scope encloses the entire
                // `BuildCommand::exec` call (and hence this callback). The
                // bundler does not touch the global `ContextData` between
                // dependency-scan completion and `on_fetch` invocation, so
                // forming a fresh `&mut` here is exclusive for the duration of
                // `install_with_cli`.
                let cli = unsafe { &mut *this.cli };
                cli.positionals = positionals.as_slice();
                let ctx = unsafe { &mut *this.ctx };

                install_with_cli(ctx, cli.clone())?;

                Global::exit(0);
            }
        }

        // PORT NOTE: `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`; Zig
        // borrowed `cli.positionals[1..]` directly. Clone the argv slices into an
        // owned buffer (small one-shot list — no perf concern). Captured *before*
        // raw-ptr aliasing of `cli` below so the access goes through the live
        // `&mut cli` borrow.
        let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
            .iter()
            .map(|s| Box::<[u8]>::from(*s))
            .collect();

        // Derive raw pointers from the existing `&mut` borrows; all subsequent
        // access to `ctx` / `cli` in this branch goes through these (Zig
        // `Command.Context` is a freely-aliasing `*ContextData`).
        let ctx_ptr: *mut ContextData = ctx;
        let mut analyzer = Analyzer {
            ctx: ctx_ptr,
            cli: &raw mut cli,
        };

        let mut fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

        // Zig: `bun.cli.BuildCommand.exec(bun.cli.Command.get(), &fetcher)`.
        // `Command.get()` resolves to the same `*ContextData` already held in
        // `ctx`; reborrow through `ctx_ptr` rather than minting a fresh
        // `&'static mut` from the global static (which would alias the
        // still-live `ctx` parameter under stacked borrows).
        // SAFETY: `ctx_ptr` was just derived from the live `ctx: &mut
        // ContextData` parameter; `ctx` is not accessed again in this branch.
        BuildCommand::exec(unsafe { &mut *ctx_ptr }, Some(&mut fetcher))?;
        return Ok(());
    }

    install_with_cli(ctx, cli)
}

#[inline(never)]
fn install_with_cli(ctx: &mut ContextData, cli: CommandLineArguments) -> Result<(), Error> {
    // TODO(port): narrow error set
    let subcommand: Subcommand = if cli.positionals.len() > 1 {
        Subcommand::Add
    } else {
        Subcommand::Install
    };

    // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // and cleanup install/add subcommand usage
    let (manager, original_cwd) = PackageManager::init(&mut *ctx, cli, Subcommand::Install)?;

    // switch to `bun add <package>`
    if subcommand == Subcommand::Add {
        manager.subcommand = Subcommand::Add;
        if manager.options.should_print_command_name() {
            Output::prettyln(format_args!(
                "<r><b>bun add <r><d>v{}<r>\n",
                Global::package_json_version_with_sha,
            ));
            Output::flush();
        }
        return update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd);
    }

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            "<r><b>bun install <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    // SAFETY: `ROOT_PACKAGE_JSON_PATH` is written exactly once inside
    // `PackageManager::init` (above) on this thread; only read thereafter.
    let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
    install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}

// ported from: src/cli/install_command.zig
