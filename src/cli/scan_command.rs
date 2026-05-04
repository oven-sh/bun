use crate::Command;
use bun_core::{Global, Output};
use bun_install::package_manager::security_scanner;
use bun_install::PackageManager;

pub struct ScanCommand;

impl ScanCommand {
    // TODO(port): narrow error set
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let cli = PackageManager::CommandLineArguments::parse(Subcommand::Scan)?;

        let (manager, cwd) = match PackageManager::init(ctx, cli, Subcommand::Scan) {
            Ok(v) => v,
            Err(e) if e == bun_core::err!("MissingPackageJSON") => {
                Output::err_generic(format_args!(
                    "No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies."
                ));
                Output::note(format_args!(
                    "Run \"bun install\" first to generate a lockfile"
                ));
                Global::exit(1);
            }
            Err(e) => return Err(e),
        };
        // `defer ctx.allocator.free(cwd)` — deleted; `cwd` is owned and drops at scope exit.

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

        // TODO(port): `Output.prettyFmt(str, true)` is a comptime ANSI-color expander; needs a Rust
        // const equivalent (or call the runtime `pretty_fmt` and pass `true`).
        Output::pretty_error(format_args!(
            "{}",
            const_format::concatcp!(
                "<r><b>bun pm scan <r><d>v",
                Global::PACKAGE_JSON_VERSION_WITH_SHA,
                "<r>\n"
            )
        ));
        Output::flush();

        let load_lockfile = manager.lockfile.load_from_cwd(manager, ctx.log, true);
        if matches!(load_lockfile, LoadResult::NotFound) {
            Output::err_generic(format_args!(
                "Lockfile not found. Run 'bun install' first to generate a lockfile."
            ));
            Global::exit(1);
        }
        if let LoadResult::Err(err) = &load_lockfile {
            Output::err_generic(format_args!("Error loading lockfile: {}", err.value.name()));
            Global::exit(1);
        }

        let security_scan_results =
            match security_scanner::perform_security_scan_for_all(manager, ctx, original_cwd) {
                Ok(v) => v,
                Err(err) => {
                    Output::err_generic(format_args!(
                        "Could not perform security scan (<d>{}<r>)",
                        err.name()
                    ));
                    Global::exit(1);
                }
            };

        if let Some(results) = security_scan_results {
            // `defer { var results_mut = results; results_mut.deinit(); }` — deleted; Drop handles it.

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

// TODO(port): `Subcommand` and `LoadResult` are placeholder names for the enum types behind
// `.scan` / `.not_found` / `.err` in the Zig — resolve to the real types in `bun_install` during Phase B.
use bun_install::lockfile::LoadResult;
use bun_install::Subcommand;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/scan_command.zig (76 lines)
//   confidence: medium
//   todos:      3
//   notes:      Output::* fns modeled as taking fmt::Arguments; Subcommand/LoadResult enum paths guessed; comptime prettyFmt needs const equivalent.
// ──────────────────────────────────────────────────────────────────────────
