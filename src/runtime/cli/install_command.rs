use crate::Error;
use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Global, Output};
use bun_install::package_manager_real::{
    CommandLineArguments, PackageManager, Subcommand, install_with_manager, root_package_json_path,
    update_package_json_and_install_with_manager,
};

use crate::build_command::BuildCommand;
use crate::command::ContextData;

pub(crate) struct InstallCommand;

impl InstallCommand {
    pub(crate) fn exec(ctx: &mut ContextData) -> Result<(), Error> {
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
    pub(crate) fn handle_error(e: Error) -> Result<(), Error> {
        if matches!(
            e,
            crate::Error::Install(
                bun_install::Error::InstallFailed | bun_install::Error::InvalidPackageJSON
            )
        ) {
            let _ = crate::cli::Command::get()
                .log_ref()
                .print(std::ptr::from_mut(Output::error_writer()));
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
    let mut cli = CommandLineArguments::parse(Subcommand::Install)?;

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        // The scan callback records the discovered package names; the install
        // runs once `BuildCommand::exec` has returned.
        struct Analyzer {
            /// `["install", dep...]`, interned in the process-lifetime CLI arena.
            positionals: Option<&'static [&'static [u8]]>,
        }
        impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer {
            fn on_analyze(
                &mut self,
                result: &mut DependenciesScannerResult<'_, '_>,
            ) -> Result<(), bun_bundler::Error> {
                // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                let keys = result.dependencies.keys();
                let mut positionals: Vec<&'static [u8]> = Vec::with_capacity(keys.len() + 1);
                positionals.push(b"install");
                for k in keys {
                    positionals.push(crate::cli::cli_dupe(k));
                }
                self.positionals = Some(crate::cli::cli_arena().alloc_slice_copy(&positionals));
                Ok(())
            }
        }

        // `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`. Clone the
        // argv slices into an owned buffer (small one-shot list — no perf
        // concern).
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
        install_with_cli(ctx, cli)?;
        Global::exit(0);
    }

    install_with_cli(ctx, cli)
}

#[inline(never)]
fn install_with_cli(ctx: &mut ContextData, cli: CommandLineArguments) -> Result<(), Error> {
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
            bun_core::prettyln!(
                "<r><b>bun add <r><d>v{}<r>\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }
        return update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd)
            .map_err(Into::into);
    }

    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun install <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    let root_package_json_path = root_package_json_path();
    install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}
