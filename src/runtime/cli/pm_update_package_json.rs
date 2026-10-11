//! MOVE_UP from `bun_install::package_manager::update_package_json_and_install`.
//!
//! `update_package_json_and_install`'s `cli.analyze` branch constructs a
//! `DependenciesScanner` and calls
//! `BuildCommand::exec` — both of which are higher-tier than
//! `bun_install` in the crate graph (`bun_runtime` → `bun_install`;
//! `bun_runtime` → `bun_bundler`; `bun_install` ↛ `bun_bundler`). The analyze
//! branch and the catch wrapper are therefore hosted here, and the crate-local
//! body re-enters `bun_install` via the public
//! `update_package_json_and_install_and_cli`.

use crate::Error;
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::Global;
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{Subcommand, update_package_json_and_install_and_cli};

use crate::build_command::BuildCommand;
use crate::cli::install_command::InstallCommand;
use crate::command::{Context, ContextData};

pub(crate) fn update_package_json_and_install_catch_error(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    update_package_json_and_install(ctx, subcommand).or_else(InstallCommand::handle_error)
}

pub(crate) fn update_package_json_and_install(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    // Calling with runtime `subcommand` here; if
    // `parse` requires `<const CMD: Subcommand>`, expand to a `match`.
    let mut cli = CommandLineArguments::parse(subcommand)?;

    if cli.analyze {
        return analyze_dependencies_and_install(ctx, &mut cli, b"add", &mut |ctx, cli| {
            update_package_json_and_install_and_cli(ctx, subcommand, cli).map_err(Into::into)
        });
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli).map_err(Into::into)
}

/// `--analyze` of `bun install` / `bun add`:
/// 1. Run the bundler on source files
/// 2. Rewrite positional arguments to act identically to the developer
///    typing in the dependency names
/// 3. Run the install command
pub(crate) fn analyze_dependencies_and_install(
    ctx: &mut ContextData,
    cli: &mut CommandLineArguments,
    verb: &'static [u8],
    install: &mut dyn FnMut(&mut ContextData, CommandLineArguments) -> Result<(), Error>,
) -> Result<(), Error> {
    // `ctx`/`cli` are stored as raw `*mut` because `BuildCommand::exec` holds
    // the same `ContextData` across the `on_fetch` callback, and
    // `DependenciesScanner.entry_points` owns a copy of `cli.positionals[1..]`
    // for the duration of the scan; storing `&mut` here would assert
    // exclusivity we don't have.
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
        ) -> Result<(), bun_bundler::Error> {
            let this = self;
            // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
            //
            // Process-lifetime storage for the rewritten positionals —
            // `Global::exit(0)` follows immediately. `OnceLock` (not
            // leaked).
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

            // SAFETY: `this.cli` / `this.ctx` were set from the caller's live
            // `&mut` borrows, whose scope encloses the entire
            // `BuildCommand::exec` call (and hence this callback). The bundler
            // has finished reading `entry_points` and does not touch the
            // `ContextData` before invoking `on_fetch`, and this callback never
            // returns `Ok` (`Global::exit` below), so forming fresh `&mut` here
            // is exclusive for the duration of `install`.
            let cli = unsafe { &mut *this.cli };
            cli.positionals = positionals.as_slice();
            // SAFETY: see above — same invariant covers `this.ctx`.
            let ctx = unsafe { &mut *this.ctx };

            (this.install)(ctx, cli.clone()).map_err(bun_bundler::Error::from)?;

            Global::exit(0);
        }
    }

    // `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`. Clone the
    // argv slices into an owned buffer (small one-shot list — no perf
    // concern), before `cli` is aliased by the raw pointer below.
    let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
        .iter()
        .map(|s| Box::<[u8]>::from(*s))
        .collect();

    let ctx_ptr: *mut ContextData = ctx;
    let mut analyzer = Analyzer {
        ctx: ctx_ptr,
        cli,
        verb,
        install,
    };

    let fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

    // This runs the bundler.
    // SAFETY: `ctx_ptr` was just derived from the live `ctx: &mut ContextData`
    // parameter; `ctx` is not accessed again in this function.
    BuildCommand::exec(unsafe { &mut *ctx_ptr }, Some(&fetcher))
}
