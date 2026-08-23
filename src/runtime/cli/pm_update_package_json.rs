//! MOVE_UP from `bun_install::package_manager::update_package_json_and_install`.
//!
//! `update_package_json_and_install`'s `cli.analyze` branch constructs a
//! `DependenciesScanner` and calls
//! `BuildCommand::exec` — both of which are higher-tier than
//! `bun_install` in the crate graph (`bun_runtime` → `bun_install`;
//! `bun_runtime` → `bun_bundler`; `bun_install` ↛ `bun_bundler`). The analyze
//! branch and the CLI-log access in the catch wrapper are therefore hosted
//! here, and the crate-local body re-enters `bun_install` via the public
//! `update_package_json_and_install_and_cli`.

use crate::Error;
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Global, Output};
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{Subcommand, update_package_json_and_install_and_cli};

use crate::build_command::BuildCommand;
use crate::command::{self, Context};

pub(crate) fn update_package_json_and_install_catch_error(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    match update_package_json_and_install(ctx, subcommand) {
        Ok(()) => Ok(()),
        Err(crate::Error::Install(
            bun_install::Error::InstallFailed | bun_install::Error::InvalidPackageJSON,
        )) => {
            let _ = command::get()
                .log_ref()
                .print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e) => Err(e),
    }
}

pub(crate) fn update_package_json_and_install(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    // Calling with runtime `subcommand` here; if
    // `parse` requires `<const CMD: Subcommand>`, expand to a `match`.
    let mut cli = CommandLineArguments::parse(subcommand)?;

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        // The scan callback records the discovered package names; the install
        // runs once `BuildCommand::exec` has returned.
        struct Analyzer {
            /// `["add", dep...]`, interned in the process-lifetime CLI arena.
            positionals: Option<&'static [&'static [u8]]>,
        }
        impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer {
            fn on_analyze(
                &mut self,
                result: &mut DependenciesScannerResult<'_, '_>,
            ) -> Result<(), bun_bundler::Error> {
                // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
                let keys = result.dependencies.keys();
                let mut positionals: Vec<&'static [u8]> = Vec::with_capacity(keys.len() + 1);
                positionals.push(b"add");
                for k in keys {
                    positionals.push(crate::cli::cli_dupe(k));
                }
                self.positionals = Some(crate::cli::cli_arena().alloc_slice_copy(&positionals));
                Ok(())
            }
        }

        // Note: `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`.
        // Clone the argv slices into an owned
        // buffer (small one-shot list — no perf concern).
        let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
            .iter()
            .map(|s| Box::<[u8]>::from(*s))
            .collect();

        let mut analyzer = Analyzer { positionals: None };
        let fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

        // This runs the bundler.
        BuildCommand::exec(ctx, Some(&fetcher))?;
        drop(fetcher);
        let Some(positionals) = analyzer.positionals else {
            return Ok(());
        };
        cli.positionals = positionals;
        update_package_json_and_install_and_cli(ctx, subcommand, cli)?;
        Global::exit(0);
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli).map_err(Into::into)
}
