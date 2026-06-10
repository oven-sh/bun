//! MOVE_UP from `bun_install::package_manager::update_package_json_and_install`.
//!
//! `update_package_json_and_install`'s `cli.analyze` branch constructs a
//! `DependenciesScanner` and calls
//! `BuildCommand::exec` — both of which are higher-tier than
//! `bun_install` in the crate graph (`bun_runtime` → `bun_install`;
//! `bun_runtime` → `bun_bundler`; `bun_install` ↛ `bun_bundler`). The analyze
//! branch and the `Cli.log_` access in the catch wrapper are therefore hosted
//! here, and the crate-local body re-enters `bun_install` via the public
//! `update_package_json_and_install_and_cli`.

use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Error, Global, Output, err};
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{Subcommand, update_package_json_and_install_and_cli};

use crate::build_command::BuildCommand;
use crate::cli::Cli;
use crate::command::{Context, ContextData};

pub fn update_package_json_and_install_catch_error(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    match update_package_json_and_install(ctx, subcommand) {
        Ok(()) => Ok(()),
        Err(e) if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") => {
            // SAFETY: `Cli::LOG_` is initialised once during single-threaded startup in
            // `Cli::start()` before any command (including this one) is dispatched; we
            // are on the single CLI thread in the install error path and no other
            // `&mut Log` to it is live for the duration of this `print` call.
            let log = unsafe { (*Cli::LOG_.get()).assume_init_mut() };
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e) => Err(e),
    }
}

pub fn update_package_json_and_install(ctx: Context, subcommand: Subcommand) -> Result<(), Error> {
    // Calling with runtime `subcommand` here; if
    // `parse` requires `<const CMD: Subcommand>`, expand to a `match`.
    let mut cli = CommandLineArguments::parse(subcommand)?;

    if cli.analyze {
        return analyze_dependencies_and_install(ctx, &mut cli, b"add", &mut |ctx, cli| {
            update_package_json_and_install_and_cli(ctx, subcommand, cli)
        });
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli)
}

/// Shared body of the `cli.analyze` branch of `bun install` / `bun add`:
/// 1. Run the bundler's dependency scanner over the positional entry points
/// 2. Rewrite the positionals to `[verb, ...discovered dependency names]`,
///    acting identically to the developer typing in the dependency names
/// 3. Re-enter the install path via `install` and exit the process
pub(crate) fn analyze_dependencies_and_install(
    ctx: &mut ContextData,
    cli: &mut CommandLineArguments,
    verb: &'static [u8],
    install: &mut dyn FnMut(&mut ContextData, CommandLineArguments) -> Result<(), Error>,
) -> Result<(), Error> {
    // `ctx`/`cli` are stored as raw `*mut` because `BuildCommand::exec` holds
    // the global `Context` (the same `ContextData`) across the `on_analyze`
    // callback, and `DependenciesScanner.entry_points` owns a copy of
    // `cli.positionals[1..]` for the duration of the scan; storing `&mut`
    // here would assert exclusivity we don't have.
    struct Analyzer<'a> {
        ctx: *mut ContextData,
        cli: *mut CommandLineArguments,
        verb: &'static [u8],
        install: &'a mut dyn FnMut(&mut ContextData, CommandLineArguments) -> Result<(), Error>,
    }
    impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer<'_> {
        fn on_analyze(
            &mut self,
            result: &mut DependenciesScannerResult<'_, '_>,
        ) -> Result<(), Error> {
            let this = self;
            // Process-lifetime storage for the rewritten positionals —
            // `Global::exit(0)` follows immediately.
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
                v.push(this.verb);
                for k in owned {
                    v.push(&**k);
                }
                v
            });

            // SAFETY: `this.cli` / `this.ctx` were set from live locals in
            // `analyze_dependencies_and_install`'s caller, whose scope
            // encloses the entire `BuildCommand::exec` call (and hence this
            // callback). The bundler does not touch the global `ContextData`
            // between dependency-scan completion and `on_analyze` invocation,
            // so forming a fresh `&mut` here is exclusive for the duration of
            // the `install` continuation.
            let cli = unsafe { &mut *this.cli };
            cli.positionals = positionals.as_slice();
            // SAFETY: see above — same invariant covers `this.ctx`.
            let ctx = unsafe { &mut *this.ctx };

            (this.install)(ctx, cli.clone())?;

            Global::exit(0);
        }
    }

    // `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`. Clone the
    // argv slices into an owned buffer (small one-shot list — no perf
    // concern). Captured *before* raw-ptr aliasing of `cli` below so the
    // access goes through the live `&mut cli` borrow.
    let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
        .iter()
        .map(|s| Box::<[u8]>::from(*s))
        .collect();

    // Derive raw pointers from the existing `&mut` borrows; all subsequent
    // access to `ctx` / `cli` in this function goes through these.
    let ctx_ptr: *mut ContextData = ctx;
    let mut analyzer = Analyzer {
        ctx: ctx_ptr,
        cli,
        verb,
        install,
    };

    let fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

    // `Command.get()` resolves to the same `*ContextData` already held in
    // `ctx`; reborrow through `ctx_ptr` rather than minting a fresh
    // `&'static mut` from the global static (which would alias the
    // still-live `ctx` parameter under stacked borrows).
    // SAFETY: `ctx_ptr` was just derived from the live `ctx: &mut
    // ContextData` parameter; `ctx` is not accessed again in this function.
    BuildCommand::exec(unsafe { &mut *ctx_ptr }, Some(&fetcher))
}
