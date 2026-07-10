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

use crate::Error;
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Global, Output};
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{Subcommand, update_package_json_and_install_and_cli};

use crate::build_command::BuildCommand;
use crate::cli::Cli;
use crate::command::{self, Context, ContextData};

pub fn update_package_json_and_install_catch_error(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    match update_package_json_and_install(ctx, subcommand) {
        Ok(()) => Ok(()),
        Err(
            crate::Error::InstallFailed
            | crate::Error::InvalidPackageJSON
            | crate::Error::Install(
                bun_install::Error::InstallFailed | bun_install::Error::InvalidPackageJSON,
            ),
        ) => {
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

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        // `ctx`/`cli` are stored as raw `*mut` because
        // `BuildCommand::exec` holds `command::get()` (the same `ContextData`) across
        // the `on_fetch` callback, and `DependenciesScanner.entry_points` owns a copy
        // of `cli.positionals[1..]` for the duration of the scan; storing `&mut` here
        // would assert exclusivity we don't have.
        struct Analyzer {
            ctx: *mut ContextData,
            cli: *mut CommandLineArguments,
            subcommand: Subcommand,
        }
        impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer {
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
                    v.push(b"add");
                    for k in owned {
                        v.push(&**k);
                    }
                    v
                });

                // SAFETY: `this.cli` / `this.ctx` were set from live stack locals in
                // `update_package_json_and_install` whose scope encloses the entire
                // `BuildCommand::exec` call (and hence this callback). The bundler has
                // finished reading `entry_points` before invoking `on_fetch`, and this
                // callback never returns (`Global::exit` below), so forming fresh `&mut`
                // here is exclusive for the remainder of the process.
                let cli = unsafe { &mut *this.cli };
                cli.positionals = positionals.as_slice();
                // SAFETY: `this.ctx` points to the `ctx` stack local in
                // `update_package_json_and_install`, whose frame outlives this
                // callback; `Global::exit` below makes this `&mut` exclusive for
                // the remainder of the process.
                let ctx = unsafe { &mut *this.ctx };

                update_package_json_and_install_and_cli(ctx, this.subcommand, cli.clone())
                    .map_err(crate::Error::from)?;

                Global::exit(0);
            }
        }

        // Note: `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`.
        // Clone the argv slices into an owned
        // buffer (small one-shot list — no perf concern) so `cli` is not borrowed across
        // the `&mut analyzer` setup.
        let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
            .iter()
            .map(|s| Box::<[u8]>::from(*s))
            .collect();

        let mut analyzer = Analyzer {
            ctx: std::ptr::from_mut::<ContextData>(ctx),
            cli: &raw mut cli,
            subcommand,
        };

        let fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

        // This runs the bundler.
        BuildCommand::exec(command::get(), Some(&fetcher))?;
        return Ok(());
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli).map_err(Into::into)
}
