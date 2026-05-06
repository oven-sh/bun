#![allow(unused_imports, dead_code)]

use bun_core::{self as bun, err, Error, Global, Output};
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_install::package_manager_real::{
    self as package_manager, install_with_manager, update_package_json_and_install_with_manager,
    CommandLineArguments, PackageManager, Subcommand, ROOT_PACKAGE_JSON_PATH,
};

use crate::build_command::BuildCommand;
use crate::command::{self, ContextData};
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
                let _ = log.print(Output::error_writer());
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
        // Zig stores `*ContextData` / `*CommandLineArguments` (freely-aliasing
        // pointers) in the local Analyzer struct while `BuildCommand::exec`
        // simultaneously holds the same `ctx`. Mirror that with raw pointers
        // and only materialise `&mut` inside the callback once the bundler has
        // finished its own use of `ctx` (the callback never returns —
        // `Global::exit(0)` below — so there is no later re-entry).
        let ctx_ptr: *mut ContextData = ctx;
        let cli_ptr: *mut CommandLineArguments = &raw mut cli;
        let mut analyzer = Analyzer {
            ctx: ctx_ptr,
            cli: cli_ptr,
        };

        // PORT NOTE: `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`
        // in the Rust port (the bundler owns its inputs); Zig passed a borrowed
        // slice into argv. Clone the argv-backed positionals into owned boxes.
        let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
            .iter()
            .map(|s| Box::<[u8]>::from(*s))
            .collect();

        let mut fetcher = DependenciesScanner {
            ctx: core::ptr::addr_of_mut!(analyzer).cast::<()>(),
            entry_points,
            on_fetch: on_analyze_erased,
        };

        // SAFETY: `ctx_ptr` is the unique `&mut ContextData` passed into
        // `exec`; we deliberately drop the named `ctx` borrow above and only
        // re-derive it here for the duration of `BuildCommand::exec`. The
        // analyzer's stored raw `ctx_ptr` is not dereferenced until inside
        // `on_analyze_erased`, which is invoked after the bundler has finished
        // using its own `ctx` borrow (it is the last thing
        // `BundleV2::generate_from_cli` does before returning).
        BuildCommand::exec(unsafe { &mut *ctx_ptr }, Some(&mut fetcher))?;
        return Ok(());
    }

    install_with_cli(ctx, cli)
}

struct Analyzer {
    /// Raw `*ContextData` (Zig: `Command.Context = *ContextData`). See note in
    /// `install()` re: aliasing with `BuildCommand::exec`'s own `ctx` borrow.
    ctx: *mut ContextData,
    /// Raw ptr (not `&mut`) — `DependenciesScanner.entry_points` was derived
    /// from `cli.positionals` while this is held; storing `&mut` would alias.
    cli: *mut CommandLineArguments,
}

/// Type-erased thunk matching `DependenciesScanner.on_fetch`'s
/// `fn(*mut (), &mut DependenciesScannerResult) -> Result<(), Error>` shape.
fn on_analyze_erased(
    ctx: *mut (),
    result: &mut DependenciesScannerResult<'_, '_>,
) -> Result<(), Error> {
    // SAFETY: `ctx` was set to `&mut analyzer as *mut ()` in `install()`
    // above; the `analyzer` local outlives the `BuildCommand::exec` call that
    // invokes this thunk.
    let this = unsafe { &mut *ctx.cast::<Analyzer>() };

    // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
    let keys = result.dependencies.keys();
    // Zig: `bun.handleOom(bun.default_allocator.alloc(string, keys.len + 1))` —
    // process-lifetime allocation that is never freed (this callback
    // `Global::exit(0)`s below). `cli.positionals` is typed
    // `&'static [&'static [u8]]`, so the heap allocation must be promoted to
    // process lifetime to match Zig's `default_allocator` semantics. This is
    // not a borrow-checker workaround — Zig genuinely never frees this slice.
    let mut positionals: Vec<&'static [u8]> = Vec::with_capacity(keys.len() + 1);
    positionals.push(b"install");
    for k in keys {
        // SAFETY: `result.dependencies` outlives this callback (which never
        // returns — `Global::exit(0)` below); extending each key borrow to
        // `'static` is sound for the remaining process lifetime.
        positionals.push(unsafe { &*(k.as_ref() as *const [u8]) });
    }
    let positionals: &'static [&'static [u8]] =
        Box::leak(positionals.into_boxed_slice());

    // SAFETY: `this.cli` points at the stack `cli` local in `install()`, which
    // outlives this callback. The bundler has finished reading `entry_points`
    // (the only other borrow derived from `*this.cli`) before invoking
    // `on_fetch`, and this callback never returns, so this is the sole live
    // access to `*this.cli` from here on.
    let cli = unsafe { &mut *this.cli };
    cli.positionals = positionals;
    // `CommandLineArguments` is `Default` (not `Clone`); move it out by value
    // for the by-value `install_with_cli` call (Zig passes `this.cli.*`).
    let cli_owned = core::mem::take(cli);

    // SAFETY: see `Analyzer.ctx` doc — `BuildCommand::exec`'s own `ctx`
    // reborrow is on a parent stack frame that is suspended waiting on this
    // callback; the bundler does not touch `ctx` again after `on_fetch`
    // returns (and we never return — `Global::exit(0)` below), so this is the
    // sole live access for the remaining process lifetime.
    let ctx = unsafe { &mut *this.ctx };

    install_with_cli(ctx, cli_owned)?;

    Global::exit(0);
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
    let (manager_ptr, original_cwd) = package_manager::init(ctx, cli, Subcommand::Install)?;
    // `defer ctx.allocator.free(original_cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.
    // SAFETY: `init()` returns the freshly populated process-global
    // `*mut PackageManager` (`holder::RAW_PTR`). No worker thread derefs it
    // yet at this point — the HTTP/thread pools only start touching it once
    // `install_with_manager` / `update_package_json_and_install_with_manager`
    // begin scheduling tasks below — so a scoped `&mut` here is exclusive.
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
        return update_package_json_and_install_with_manager(manager, ctx, &original_cwd);
    }

    if manager.options.should_print_command_name() {
        Output::prettyln(format_args!(
            "<r><b>bun install <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();
    }

    // SAFETY: `ROOT_PACKAGE_JSON_PATH` is a process-global `&ZStr` written
    // exactly once inside `package_manager::init()` (just called above) on the
    // single CLI thread; read-only thereafter.
    let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH };
    install_with_manager(manager, ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/install_command.zig (97 lines)
//   confidence: medium
//   notes:      `--help` is now handled by `CommandLineArguments::parse`
//               itself (it prints help and exits before returning), so the
//               local `print_help` / `INSTALL_PARAMS` duplication that the
//               Phase-A stub carried has been dropped — the canonical help
//               text lives in `bun_install::package_manager_real::
//               command_line_arguments` (see `print_help` there).
//               The `--analyze` callback intentionally promotes its
//               positionals allocation to process lifetime to match Zig's
//               `bun.default_allocator.alloc` (never freed; process exits).
// ──────────────────────────────────────────────────────────────────────────
