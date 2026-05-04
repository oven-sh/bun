use core::ffi::c_void;

use bun_core::{err, Error, Global, Output};
use bun_install::package_manager::{CommandLineArguments, PackageManager, Subcommand};
// TODO(port): verify exact module path for DependenciesScanner / Result under bun_bundler
use bun_bundler::bundle_v2::dependencies_scanner::{DependenciesScanner, DependenciesScannerResult};

use crate::build_command::BuildCommand;
use crate::command::{self, Command, ContextData};
use crate::Cli;

pub struct InstallCommand;

impl InstallCommand {
    pub fn exec(ctx: &mut ContextData) -> Result<(), Error> {
        // TODO(port): narrow error set
        match install(ctx) {
            Ok(()) => Ok(()),
            Err(e) if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") => {
                let log = Cli::log_();
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
        struct Analyzer<'a> {
            ctx: &'a mut ContextData,
            cli: &'a mut CommandLineArguments,
        }
        impl<'a> Analyzer<'a> {
            pub fn on_analyze(
                &mut self,
                result: &mut DependenciesScannerResult,
            ) -> Result<(), Error> {
                // TODO: add separate argument that makes it so positionals[1..] is not done     and instead the positionals are passed
                let keys = result.dependencies.keys();
                // TODO(port): lifetime — positionals stores borrowed &[u8] from result.dependencies; verify ownership in Phase B
                let mut positionals: Vec<&[u8]> = vec![b"" as &[u8]; keys.len() + 1];
                positionals[0] = b"install";
                positionals[1..].copy_from_slice(keys);
                self.cli.positionals = positionals.into_boxed_slice();

                install_with_cli(self.ctx, self.cli.clone())?;

                Global::exit(0);
            }
        }
        let mut analyzer = Analyzer {
            ctx,
            cli: &mut cli,
        };

        // PORT NOTE: reshaped for borrowck — capture entry_points slice before borrowing cli mutably via analyzer
        let entry_points = analyzer.cli.positionals[1..].to_vec().into_boxed_slice();

        let mut fetcher = DependenciesScanner {
            ctx: &mut analyzer as *mut Analyzer<'_> as *mut c_void,
            entry_points,
            // TODO(port): @ptrCast of method fn pointer — DependenciesScanner.onFetch likely expects
            // `unsafe extern "C" fn(*mut c_void, *mut DependenciesScannerResult) -> Result<(), Error>`;
            // wire a trampoline in Phase B.
            on_fetch: unsafe {
                core::mem::transmute::<
                    fn(&mut Analyzer<'_>, &mut DependenciesScannerResult) -> Result<(), Error>,
                    _,
                >(Analyzer::on_analyze)
            },
        };

        BuildCommand::exec(Command::get(), &mut fetcher)?;
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
    let (manager, original_cwd) = PackageManager::init(ctx, cli, Subcommand::Install)?;

    // switch to `bun add <package>`
    if subcommand == Subcommand::Add {
        manager.subcommand = Subcommand::Add;
        if manager.options.should_print_command_name() {
            Output::prettyln(const_format::concatcp!(
                "<r><b>bun add <r><d>v",
                Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>\n"
            ));
            Output::flush();
        }
        return manager.update_package_json_and_install_with_manager(ctx, original_cwd);
    }

    if manager.options.should_print_command_name() {
        Output::prettyln(const_format::concatcp!(
            "<r><b>bun install <r><d>v",
            Global::PACKAGE_JSON_VERSION_WITH_SHA,
            "<r>\n"
        ));
        Output::flush();
    }

    manager.install_with_manager(ctx, PackageManager::ROOT_PACKAGE_JSON_PATH, original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/install_command.zig (97 lines)
//   confidence: medium
//   todos:      5
//   notes:      Analyzer.on_analyze fn-ptr cast (@ptrCast) needs a C-ABI trampoline; positionals lifetime/ownership needs verification; borrowck reshape around entry_points.
// ──────────────────────────────────────────────────────────────────────────
