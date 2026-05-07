use bun_core::{err, Error, Global, Output};
use bun_install::package_manager_real::{
    install_with_manager, update_package_json_and_install_with_manager, CommandLineArguments,
    PackageManager, Subcommand, ROOT_PACKAGE_JSON_PATH,
};
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};

use crate::build_command::BuildCommand;
use crate::command::ContextData;
use crate::Cli;

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
                let _ = log.print(std::ptr::from_mut(Output::error_writer()));
                Global::exit(1);
            }
            Err(e) => Err(e),
        }
    }
}

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
        impl Analyzer {
            fn on_analyze(
                this: &mut Self,
                result: &mut DependenciesScannerResult,
            ) -> Result<(), Error> {
                // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                //
                // Process-lifetime storage for the rewritten positionals.
                // Zig: `bun.default_allocator.alloc(string, keys.len + 1)` with
                // no matching free — `Global::exit(0)` follows immediately.
                // `OnceLock` (not `Box::leak`) per PORTING.md §Forbidden.
                static OWNED_KEYS: std::sync::OnceLock<Vec<Box<[u8]>>> =
                    std::sync::OnceLock::new();
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

        // Type-erased trampoline matching `DependenciesScanner.on_fetch` (Zig used
        // `@ptrCast` on the method fn pointer; Rust routes through a thin shim).
        fn on_fetch_trampoline(
            ctx: *mut (),
            result: &mut DependenciesScannerResult,
        ) -> Result<(), Error> {
            // SAFETY: `ctx` was set to `&mut analyzer as *mut _ as *mut ()` below
            // and outlives the `BuildCommand::exec` call.
            let analyzer = unsafe { &mut *ctx.cast::<Analyzer>() };
            Analyzer::on_analyze(analyzer, result)
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

        let mut fetcher = DependenciesScanner {
            ctx: (&raw mut analyzer).cast::<()>(),
            entry_points,
            on_fetch: on_fetch_trampoline,
        };

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

fn install_with_cli(ctx: &mut ContextData, cli: CommandLineArguments) -> Result<(), Error> {
    // TODO(port): narrow error set
    let subcommand: Subcommand = if cli.positionals.len() > 1 {
        Subcommand::Add
    } else {
        Subcommand::Install
    };

    // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // and cleanup install/add subcommand usage
    let (manager_ptr, original_cwd) = PackageManager::init(&mut *ctx, cli, Subcommand::Install)?;

    // SAFETY: `PackageManager::init` returns the freshly populated process-global
    // singleton (`holder::RAW_PTR`). No worker thread derefs it until
    // `install_with_manager` schedules tasks below; until then this `&mut` is
    // exclusive on the single CLI dispatch thread.
    let manager: &mut PackageManager = unsafe { &mut *manager_ptr };

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
    let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH };
    install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/install_command.zig (97 lines)
//   confidence: medium
//   notes:      `Analyzer.on_analyze` re-enters the install path from inside
//               `BuildCommand::exec`'s `on_fetch` callback while the global
//               `ContextData` is conceptually still borrowed; raw `*mut`
//               storage mirrors Zig's freely-aliasing `Command.Context`
//               (`*ContextData`) and matches the precedent set by
//               `create_command.rs`. Rewritten `positionals` are parked in
//               `OnceLock` statics (process-lifetime — `Global::exit(0)`
//               follows) instead of `Box::leak`.
// ──────────────────────────────────────────────────────────────────────────
