//! Lockfile helpers shared by `bun outdated` and `bun update --interactive`.

use bun_core::{Global, Output};
use bun_install::lockfile::{LoadResult, LoadStep};
use bun_install::package_manager::LogLevel;
use bun_install::{PackageManager, migration};

use crate::Command;

/// Load the lockfile from the current directory, reporting errors and exiting
/// the process on failure. `missing_lockfile_message` is the error printed
/// when there is no lockfile at all, e.g. `missing lockfile, nothing outdated`.
pub(crate) fn load_lockfile_or_crash(
    ctx: &Command::ContextData,
    manager: &mut PackageManager,
    missing_lockfile_message: &str,
) {
    let not_silent = manager.options.log_level != LogLevel::Silent;
    match manager.load_lockfile_from_cwd::<true>() {
        LoadResult::NotFound => {
            if not_silent {
                Output::err_generic(missing_lockfile_message, ());
                bun_core::note!("run 'bun install' first");
            }
            Global::crash();
        }
        LoadResult::Err(cause) => {
            if not_silent && !migration::reported_unsupported_lockfile_version(&cause) {
                match cause.step {
                    LoadStep::OpenFile => {
                        Output::err_generic("failed to open lockfile: {s}", (cause.value.name(),));
                    }
                    LoadStep::ParseFile => {
                        Output::err_generic("failed to parse lockfile: {s}", (cause.value.name(),));
                    }
                    LoadStep::ReadFile => {
                        Output::err_generic("failed to read lockfile: {s}", (cause.value.name(),));
                    }
                    LoadStep::Migrating => {
                        Output::err_generic(
                            "failed to migrate lockfile: {s}",
                            (cause.value.name(),),
                        );
                    }
                }
                if ctx.log_ref().has_errors() {
                    let _ = manager
                        .log_mut()
                        .print(std::ptr::from_mut(Output::error_writer()));
                }
            }
            Global::crash();
        }
        LoadResult::Ok(_) => {
            // `load_lockfile_from_cwd` populates `manager.lockfile` in place,
            // so no reassignment is needed.
        }
    }
}
