use crate::Command;
use bun_core::{Global, Output};
use bun_install::package_manager::security_scanner;
use bun_install::PackageManager;

pub struct ScanCommand;

impl ScanCommand {
    // TODO(port): narrow error set
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // Zig:
        //   const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .scan);
        //   const manager, const cwd = PackageManager.init(ctx, cli, .scan) catch |err| { ... };
        //   try execWithManager(ctx, manager, cwd);
        //
        // `CommandLineArguments::parse`, `PackageManager::init`, and `Subcommand::Scan` all live
        // in the gated `package_manager_real` module (src/install/lib.rs reconciler-6). The
        // exported stub `Subcommand` enum has no `Scan` variant and the stub `PackageManager`
        // struct has no `init` associated fn, so this body cannot type-check until that crate
        // un-gates. Keep the error-handling shape commented for reference.
        let _ = ctx;
        // if err == error.MissingPackageJSON:
        //     Output::err_generic(
        //         "No package.json found. 'bun pm scan' requires a lockfile to analyze dependencies.",
        //         format_args!(""),
        //     );
        //     Output::note("Run \"bun install\" first to generate a lockfile", format_args!(""));
        //     Global::exit(1);
        todo!("blocked_on: bun_install::Subcommand::Scan / bun_install::PackageManager::init / bun_install::package_manager::command_line_arguments::parse (package_manager_real un-gate, reconciler-6)")
    }

    // TODO(port): narrow error set
    pub fn exec_with_manager(
        ctx: &Command::Context,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> Result<(), bun_core::Error> {
        // Zig: `if (manager.options.security_scanner == null) { ... }`
        // The stub `PackageManagerOptionsStub` (src/install/lib.rs) has no `security_scanner`
        // field; gated behind `package_manager_real`.
        if security_scanner_configured(manager).is_none() {
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
                Global::package_json_version_with_sha,
                "<r>\n"
            )
        ));
        Output::flush();

        // Zig:
        //   const load_lockfile = manager.lockfile.loadFromCwd(manager, ctx.allocator, ctx.log, true);
        //   if (load_lockfile == .not_found) { ... } / if (load_lockfile == .err) { ... }
        // The stub `PackageManager` has no `lockfile` field and stub `LoadResult` is a unit struct
        // (no `NotFound`/`Err` variants); both gated behind `package_manager_real`.
        load_lockfile_or_exit(manager, ctx);

        let security_scan_results =
            match security_scanner::perform_security_scan_for_all(manager, ctx, original_cwd) {
                Ok(v) => v,
                Err(err) => {
                    Output::err_generic(
                        "Could not perform security scan (<d>{s}<r>)",
                        format_args!("{}", err.name()),
                    );
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

/// Local shim for `manager.options.security_scanner` — field absent on the upstream
/// `PackageManagerOptionsStub`. Returns the configured scanner package name when the
/// real `PackageManagerOptions` is un-gated.
#[inline]
fn security_scanner_configured(_manager: &PackageManager) -> Option<&[u8]> {
    todo!("blocked_on: bun_install::PackageManagerOptionsStub::security_scanner (package_manager_real un-gate, reconciler-6)")
}

/// Local shim for `manager.lockfile.load_from_cwd(...)` + `LoadResult::{NotFound,Err}` matching.
/// The upstream stub `PackageManager` has no `lockfile` field and `LoadResult` is a unit struct.
#[inline]
fn load_lockfile_or_exit(_manager: &mut PackageManager, _ctx: &Command::Context) {
    // Real body once un-gated:
    //   let load_lockfile = manager.lockfile.load_from_cwd(manager, ctx.log, true);
    //   if matches!(load_lockfile, LoadResult::NotFound) {
    //       Output::err_generic(
    //           "Lockfile not found. Run 'bun install' first to generate a lockfile.",
    //           format_args!(""),
    //       );
    //       Global::exit(1);
    //   }
    //   if let LoadResult::Err(err) = &load_lockfile {
    //       Output::err_generic("Error loading lockfile: {s}", format_args!("{}", err.value.name()));
    //       Global::exit(1);
    //   }
    todo!("blocked_on: bun_install::PackageManager::lockfile / bun_install::lockfile::LoadResult variants (package_manager_real un-gate, reconciler-6)")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/scan_command.zig (76 lines)
//   confidence: low
//   todos:      3
//   notes:      Output::* fns modeled as taking fmt::Arguments; exec/exec_with_manager bodies
//               blocked on gated bun_install::package_manager_real stubs (Subcommand::Scan,
//               PackageManager::init/lockfile, PackageManagerOptions::security_scanner,
//               LoadResult variants).
// ──────────────────────────────────────────────────────────────────────────
