use crate::Command;
use bun_core::{Global, Output, err};
use bun_install::lockfile::LoadResult;
use bun_install::package_manager::{self, security_scanner};
use bun_install::{CommandLineArguments, PackageManager, Subcommand};

pub struct ScanCommand;

impl ScanCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Scan)?;

        let (manager, original_cwd) = match package_manager::init(&mut *ctx, cli, Subcommand::Scan)
        {
            Ok(v) => v,
            Err(e) => {
                if e == err!("MissingPackageJSON") {
                    Output::err_generic(
                        "No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies.",
                        (),
                    );
                    bun_core::note!("Run \"bun install\" first to generate a lockfile");
                    Global::exit(1);
                }
                return Err(e);
            }
        };
        // `defer ctx.allocator.free(cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.

        Self::exec_with_manager(ctx, manager, &original_cwd)
    }

    pub fn exec_with_manager(
        ctx: Command::Context,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        if manager.options.security_scanner.is_none() {
            bun_core::pretty_errorln!("<r><red>error<r>: no security scanner configured");
            bun_core::pretty!(
                "\n\
                 To use 'bun pm scan', configure a security scanner in bunfig.toml:\n  \
                 [install.security]\n  \
                 scanner = \"<cyan>package_name<r>\"\n\
                 \n\
                 Security scanners can be npm packages that export a scanner object.\n"
            );
            Global::exit(1);
        }

        bun_core::pretty_error!(
            "<r><b>bun pm scan <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        match manager.load_lockfile_from_cwd::<true>() {
            LoadResult::NotFound => {
                Output::err_generic(
                    "Lockfile not found. Run 'bun install' first to generate a lockfile.",
                    (),
                );
                Global::exit(1);
            }
            LoadResult::Err(e) => {
                Output::err_generic("Error loading lockfile: {s}", (e.value.name(),));
                Global::exit(1);
            }
            LoadResult::Ok(_) => {}
        }

        let security_scan_results =
            match security_scanner::perform_security_scan_for_all(manager, &mut *ctx, original_cwd)
            {
                Ok(v) => v,
                Err(e) => {
                    Output::err_generic("Could not perform security scan (<d>{s}<r>)", (e.name(),));
                    Global::exit(1);
                }
            };

        if let Some(results) = security_scan_results {
            // `defer { var results_mut = results; results_mut.deinit(); }` — Drop handles it.

            security_scanner::print_security_advisories(manager, &results);

            if results.has_advisories() {
                Global::exit(1);
            } else {
                bun_core::pretty!("<green>No advisories found<r>\n");
            }
        }

        Global::exit(0);
    }
}
