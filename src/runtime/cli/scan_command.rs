use crate::Command;
use bun_core::{err, Global, Output};
use bun_install::lockfile::LoadResult;
use bun_install::package_manager::{self, security_scanner};
use bun_install::{CommandLineArguments, Lockfile, PackageManager, Subcommand};

pub struct ScanCommand;

impl ScanCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Scan)?;

        let (pm_ptr, original_cwd) = match package_manager::init(&mut *ctx, cli, Subcommand::Scan) {
            Ok(v) => v,
            Err(e) => {
                if e == err!("MissingPackageJSON") {
                    Output::err_generic(
                        "No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies.",
                        (),
                    );
                    Output::note("Run \"bun install\" first to generate a lockfile");
                    Global::exit(1);
                }
                return Err(e);
            }
        };
        // `defer ctx.allocator.free(cwd)` — `original_cwd: Box<[u8]>` drops at scope exit.

        // SAFETY: `init()` returns the process-singleton `*mut PackageManager`,
        // non-null and exclusively owned by this thread for the command's
        // duration (mirrors Zig's `*PackageManager`).
        let manager: &mut PackageManager = unsafe { &mut *pm_ptr };

        Self::exec_with_manager(ctx, manager, &original_cwd)
    }

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

        // Zig: `Output.prettyError(comptime Output.prettyFmt(..., true), .{})` — the
        // comptime ANSI expansion is folded into `pretty_error`'s runtime tag rewrite.
        Output::pretty_error(format_args!(
            "<r><b>bun pm scan <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        ));
        Output::flush();

        // PORT NOTE: reshaped for borrowck — `manager.lockfile.load_from_cwd(&mut self,
        // Some(manager), log)` would alias `&mut *manager.lockfile` with `&mut *manager`.
        // Project disjoint raw pointers from the singleton first; `load_from_cwd` only
        // reads `manager.options`/migration helpers and never re-borrows `manager.lockfile`.
        {
            let pm_ptr: *mut PackageManager = manager;
            // SAFETY: `manager.log` is set non-null by `PackageManager::init`.
            let log: &mut bun_logger::Log = unsafe { &mut *(*pm_ptr).log };
            // SAFETY: `lockfile` is the owned `Box<Lockfile>` field on the singleton;
            // no other live `&mut Lockfile` exists at this point.
            let lockfile: &mut Lockfile = unsafe { &mut *(*pm_ptr).lockfile };
            match lockfile.load_from_cwd::<true>(
                // SAFETY: see PORT NOTE above — `load_from_cwd` accesses `manager`
                // fields disjoint from `lockfile` (Zig invariant).
                Some(unsafe { &mut *pm_ptr }),
                log,
            ) {
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
        }

        let security_scan_results =
            match security_scanner::perform_security_scan_for_all(manager, &mut *ctx, original_cwd) {
                Ok(v) => v,
                Err(e) => {
                    Output::err_generic(
                        "Could not perform security scan (<d>{s}<r>)",
                        (e.name(),),
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
//   notes:      `load_from_cwd` borrow split via raw-ptr projections from the
//               PackageManager singleton (Zig holds `lockfile: *Lockfile`, so
//               the aliasing is a Rust-shape artifact; `load_from_cwd` never
//               touches `manager.lockfile` through the `manager` arg).
// ──────────────────────────────────────────────────────────────────────────
