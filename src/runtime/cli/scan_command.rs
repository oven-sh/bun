use crate::Command;
use bun_core::{Global, Output};
use bun_install::lockfile::LoadResult;
use bun_install::package_manager::command_line_arguments::CommandLineArguments;
use bun_install::package_manager::security_scanner;
use bun_install::{PackageManager, Subcommand};

pub struct ScanCommand;

impl ScanCommand {
    // TODO(port): narrow error set
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Scan)?;

        let (manager, cwd) = match PackageManager::init(&mut *ctx, &cli, Subcommand::Scan) {
            Ok(v) => v,
            Err(err) => {
                if err == bun_core::err!(MissingPackageJSON) {
                    Output::err_generic(
                        "No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies.",
                        (),
                    );
                    Output::note("Run \"bun install\" first to generate a lockfile");
                    Global::exit(1);
                }
                return Err(err);
            }
        };
        // `defer ctx.allocator.free(cwd)` — `cwd: Box<[u8]>` drops at scope exit.

        Self::exec_with_manager(ctx, manager, &cwd)
    }

    // TODO(port): narrow error set
    pub fn exec_with_manager(
        ctx: Command::Context,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        if manager.options.security_scanner.is_none() {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r>: no security scanner configured"
            ));
            Output::pretty(format_args!(
                "\n\
                 To use 'bun pm scan', configure a security scanner in bunfig.toml:\n  \
                 [install.security]\n  \
                 scanner = \"<cyan>package_name<r>\"\n\
                 \n\
                 Security scanners can be npm packages that export a scanner object.\n"
            ));
            Global::exit(1);
        }

        // Zig: `Output.prettyError(comptime Output.prettyFmt("<r><b>bun pm scan <r><d>v" ++ …, true), .{})`.
        // `prettyFmt(.., true)` is a comptime ANSI-colour expander; `pretty_error` performs the
        // same `<tag>` rewrite at runtime against stderr's colour state.
        // PERF(port): comptime ANSI expansion — profile in Phase B.
        Output::pretty_error(format_args!(
            "<r><b>bun pm scan <r><d>v{}<r>\n",
            Global::package_json_version_with_sha
        ));
        Output::flush();

        // PORT NOTE: reshaped for borrowck — `load_from_cwd` takes `*mut PackageManager`
        // and `*mut Log` alongside `&mut self` on the lockfile; capture raw pointers
        // first so the `&mut manager.lockfile` reborrow doesn't alias.
        let load_lockfile = {
            let log = ctx.log;
            let mgr: *mut PackageManager = manager;
            // SAFETY: `mgr`/`log` are non-aliasing raw pointers passed only for
            // back-reference inside `load_from_cwd`; the lockfile borrow is the
            // only live `&mut` projection of `*mgr`.
            unsafe { (*mgr).lockfile.load_from_cwd(mgr, log, true) }
        };
        match load_lockfile {
            LoadResult::NotFound => {
                Output::err_generic(
                    "Lockfile not found. Run 'bun install' first to generate a lockfile.",
                    (),
                );
                Global::exit(1);
            }
            LoadResult::Err(err) => {
                Output::err_generic("Error loading lockfile: {s}", (err.value.name(),));
                Global::exit(1);
            }
            LoadResult::Ok(_) => {}
        }

        let security_scan_results =
            match security_scanner::perform_security_scan_for_all(manager, ctx, original_cwd) {
                Ok(v) => v,
                Err(err) => {
                    Output::err_generic(
                        "Could not perform security scan (<d>{s}<r>)",
                        (err.name(),),
                    );
                    Global::exit(1);
                }
            };

        if let Some(results) = security_scan_results {
            // `defer { var results_mut = results; results_mut.deinit(); }` — Drop handles it.

            security_scanner::print_security_advisories(manager, &results);

            if results.has_advisories() {
                Global::exit(1);
            } else {
                Output::pretty(format_args!("<green>No advisories found<r>\n"));
            }
        }

        Global::exit(0);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/scan_command.zig (76 lines)
//   confidence: high
//   todos:      0
//   notes:      Output::* fns take fmt::Arguments / FmtTuple; CommandLineArguments::parse and
//               PackageManager::init resolve to upstream stubs in bun_install::package_manager
//               which forward to package_manager_real once the stub/real PackageManager
//               structs unify (reconciler-6).
// ──────────────────────────────────────────────────────────────────────────
