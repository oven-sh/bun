use crate::Command;
use crate::cli::package_manager_command::PackageManagerCommand;
use bun_core::{Global, Output};
use bun_install::package_manager::security_scanner;
use bun_install::{Lockfile, PackageManager};

pub(crate) struct ScanCommand;

impl ScanCommand {
    pub(crate) fn exec_with_manager(
        ctx: Command::Context,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> crate::Result<()> {
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

        // Reshaped for borrowck — `manager.lockfile.load_from_cwd(&mut self,
        // Some(manager), log)` would alias `&mut *manager.lockfile` with `&mut *manager`.
        // Project disjoint raw pointers from the singleton first; `load_from_cwd` only
        // reads `manager.options`/migration helpers and never re-borrows `manager.lockfile`.
        {
            let log_level = manager.options.log_level;
            let pm_ptr: *mut PackageManager = manager;
            // SAFETY: `manager.log` is set non-null by `PackageManager::init`.
            let log: &mut bun_ast::Log = unsafe { &mut *(*pm_ptr).log };
            // SAFETY: `lockfile` is the owned `Box<Lockfile>` field on the singleton;
            // no other live `&mut Lockfile` exists at this point.
            let lockfile: &mut Lockfile = unsafe { &mut *(*pm_ptr).lockfile };
            let load_result = lockfile.load_from_cwd(
                // SAFETY: see comment above — `load_from_cwd` accesses `manager`
                // fields disjoint from `lockfile`.
                Some(unsafe { &mut *pm_ptr }),
                log,
                true,
            );
            PackageManagerCommand::handle_load_lockfile_errors_for(&load_result, log_level, "scan");
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
