//! MOVE_UP from `bun_install::package_manager::update_package_json_and_install`.
//!
//! Zig's `updatePackageJSONAndInstall` (.zig L680-730) lives entirely in
//! `bun_install`, but its `cli.analyze` branch constructs a
//! `bun.bundle_v2.BundleV2.DependenciesScanner` and calls
//! `bun.cli.BuildCommand.exec` — both of which are higher-tier than
//! `bun_install` in the Rust crate graph (`bun_runtime` → `bun_install`;
//! `bun_runtime` → `bun_bundler`; `bun_install` ↛ `bun_bundler`). The analyze
//! branch and the `Cli.log_` access in the catch wrapper are therefore hosted
//! here, and the crate-local body re-enters `bun_install` via the public
//! `update_package_json_and_install_and_cli`.

use bun_bundler::bundle_v2::{DependenciesScanner, DependenciesScannerResult};
use bun_core::{Error, Global, Output, err};
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{Subcommand, update_package_json_and_install_and_cli};

use crate::build_command::BuildCommand;
use crate::cli::Cli;
use crate::command::{self, Context, ContextData};

pub fn update_package_json_and_install_catch_error(
    ctx: Context,
    subcommand: Subcommand,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    match update_package_json_and_install(ctx, subcommand) {
        Ok(()) => Ok(()),
        Err(e) if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") => {
            // SAFETY: `Cli::LOG_` is initialised once during single-threaded startup in
            // `Cli::start()` before any command (including this one) is dispatched; we
            // are on the single CLI thread in the install error path and no other
            // `&mut Log` to it is live for the duration of this `print` call.
            let log = unsafe { (*Cli::LOG_.get()).assume_init_mut() };
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e) => Err(e),
    }
}

pub fn update_package_json_and_install(ctx: Context, subcommand: Subcommand) -> Result<(), Error> {
    // TODO(port): narrow error set
    // PERF(port): Zig used `switch (subcommand) { inline else => |cmd| ... }` to monomorphize
    // `CommandLineArguments.parse` per subcommand. Calling with runtime `subcommand` here; if
    // `parse` requires `<const CMD: Subcommand>`, expand to a `match` in Phase B.
    let mut cli = CommandLineArguments::parse(subcommand)?;

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if cli.analyze {
        // PORT NOTE: hoisted from Zig fn-local `const Analyzer = struct {...}`.
        // `ctx`/`cli` are stored as raw `*mut` (Zig: freely-aliasing `*T`) because
        // `BuildCommand::exec` holds `command::get()` (the same `ContextData`) across
        // the `on_fetch` callback, and `DependenciesScanner.entry_points` owns a copy
        // of `cli.positionals[1..]` for the duration of the scan; storing `&mut` here
        // would assert exclusivity we don't have.
        struct Analyzer {
            ctx: *mut ContextData,
            cli: *mut CommandLineArguments,
            subcommand: Subcommand,
        }
        impl bun_bundler::bundle_v2::OnDependenciesAnalyze for Analyzer {
            fn on_analyze(
                &mut self,
                result: &mut DependenciesScannerResult<'_, '_>,
            ) -> Result<(), Error> {
                let this = self;
                // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
                //
                // Process-lifetime storage for the rewritten positionals. Zig:
                // `bun.default_allocator.alloc(string, keys.len + 1)` with no matching
                // free — `Global::exit(0)` follows immediately. `OnceLock` (not
                // leaked) per PORTING.md §Forbidden.
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
                    let mut v: Vec<&'static [u8]> = Vec::with_capacity(owned.len() + 1);
                    v.push(b"add");
                    for k in owned {
                        v.push(&**k);
                    }
                    v
                });

                // SAFETY: `this.cli` / `this.ctx` were set from live stack locals in
                // `update_package_json_and_install` whose scope encloses the entire
                // `BuildCommand::exec` call (and hence this callback). The bundler has
                // finished reading `entry_points` before invoking `on_fetch`, and this
                // callback never returns (`Global::exit` below), so forming fresh `&mut`
                // here is exclusive for the remainder of the process.
                let cli = unsafe { &mut *this.cli };
                cli.positionals = positionals.as_slice();
                let ctx = unsafe { &mut *this.ctx };

                update_package_json_and_install_and_cli(ctx, this.subcommand, cli.clone())?;

                Global::exit(0);
            }
        }

        // PORT NOTE: `DependenciesScanner.entry_points` is `Box<[Box<[u8]>]>`; Zig
        // borrowed `cli.positionals[1..]` directly. Clone the argv slices into an owned
        // buffer (small one-shot list — no perf concern) so `cli` is not borrowed across
        // the `&mut analyzer` setup.
        let entry_points: Box<[Box<[u8]>]> = cli.positionals[1..]
            .iter()
            .map(|s| Box::<[u8]>::from(*s))
            .collect();

        let mut analyzer = Analyzer {
            ctx: std::ptr::from_mut::<ContextData>(ctx),
            cli: &raw mut cli,
            subcommand,
        };

        let mut fetcher = DependenciesScanner::new(&mut analyzer, entry_points);

        // This runs the bundler.
        BuildCommand::exec(command::get(), Some(&mut fetcher))?;
        return Ok(());
    }

    update_package_json_and_install_and_cli(ctx, subcommand, cli)
}

// ported from: src/install/PackageManager/updatePackageJSONAndInstall.zig
