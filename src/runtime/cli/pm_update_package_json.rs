//! `--analyze` runs the bundler, which `bun_install` cannot depend on, so that branch lives here.

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

fn update_package_json_and_install(ctx: Context, subcommand: Subcommand) -> Result<(), Error> {
    let mut cli = CommandLineArguments::parse(subcommand)?;

    if cli.analyze {
        return analyze_dependencies_and_install(ctx, &mut cli, b"add", &mut |ctx, cli| {
            update_package_json_and_install_and_cli(ctx, subcommand, cli).map_err(Into::into)
        });
    }

    update_package_json_and_install_and_cli(ctx, subcommand, &cli).map_err(Into::into)
}

/// For `--analyze`. Bundles the source files, then installs what they import as if it had been
/// typed on the command line.
pub(crate) fn analyze_dependencies_and_install(
    ctx: &mut ContextData,
    cli: &mut CommandLineArguments,
    verb: &'static [u8],
    install: &mut dyn FnMut(&mut ContextData, &CommandLineArguments) -> Result<(), Error>,
) -> Result<(), Error> {
    // Raw pointers, because `BuildCommand::exec` holds the same `ContextData` across the callback.
    struct Analyzer<'a> {
        ctx: *mut ContextData,
        cli: *mut CommandLineArguments,
        verb: &'static [u8],
        install: &'a mut dyn FnMut(&mut ContextData, &CommandLineArguments) -> Result<(), Error>,
    }
    impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer<'_> {
        fn on_analyze(
            &mut self,
            result: &mut DependenciesScannerResult<'_, '_>,
        ) -> Result<(), bun_bundler::Error> {
            // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
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
                core::iter::once(self.verb)
                    .chain(owned.iter().map(|k| &**k))
                    .collect()
            });

            // SAFETY: both come from the caller's `&mut` borrows, which outlive `BuildCommand::exec`; the
            // bundler is done with them when it calls this, and this never returns `Ok`.
            let (cli, ctx) = unsafe { (&mut *self.cli, &mut *self.ctx) };
            cli.positionals = positionals.as_slice();

            (self.install)(ctx, cli).map_err(bun_bundler::Error::from)?;

            Global::exit(0);
        }
    }

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

    // SAFETY: `ctx_ptr` comes from the `ctx` parameter, which is not used again.
    BuildCommand::exec(unsafe { &mut *ctx_ptr }, Some(&fetcher))
}
