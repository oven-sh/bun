use bstr::BStr;

use bun_core::{Global, Output};
use bun_install::package_manager_real::{
    PackageManager, ROOT_PACKAGE_JSON_PATH, get_cache_directory_and_abs_path, install_with_manager,
    package_manager_options::Do, populate_package_cache,
};

use crate::cli::Command;

pub(crate) struct PmFetchCommand;

impl PmFetchCommand {
    pub(crate) fn exec(
        ctx: Command::Context,
        pm: &mut PackageManager,
        original_cwd: &[u8],
    ) -> crate::Result<()> {
        // Off under `--silent` and `--no-summary`; read before the flags are cleared below.
        let print_summary = pm.options.should_print_command_name();

        if print_summary {
            bun_core::prettyln!(
                "<r><b>bun pm fetch <r><d>v{}<r>\n\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }

        // Pass 1: resolve, which also downloads whatever the lockfile did not pin yet.
        pm.options.do_.remove(
            Do::INSTALL_PACKAGES
                | Do::RUN_SCRIPTS
                | Do::WRITE_PACKAGE_JSON
                | Do::SAVE_LOCKFILE
                | Do::SAVE_YARN_LOCK
                | Do::SUMMARY,
        );
        // The format migration and `--lockfile-only` write the lockfile without consulting `do_`.
        pm.options.dry_run = true;
        pm.options.lockfile_only = false;
        // SAFETY: `ROOT_PACKAGE_JSON_PATH` is written exactly once inside `PackageManager::init`
        // (already called by `bun pm` dispatch) on this thread; only read thereafter.
        let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
        install_with_manager(pm, &mut *ctx, root_package_json_path, original_cwd)?;
        if pm.any_failed_to_install {
            Global::exit(1);
        }

        // Pass 2: download the packages the lockfile already pinned.
        let summary = populate_package_cache::populate_package_cache(pm)?;

        let _ = pm
            .log_mut()
            .print(std::ptr::from_mut(Output::error_writer()));
        if pm.log_mut().has_errors() || pm.any_failed_to_install {
            Global::exit(1);
        }

        if !print_summary {
            return Ok(());
        }

        if summary.fetched > 0 {
            bun_core::pretty!(
                "<green>Fetched {} package{}<r> into cache ",
                summary.fetched,
                if summary.fetched == 1 { "" } else { "s" },
            );
        } else if summary.already_cached > 0 {
            bun_core::pretty!(
                "<green>Done<r>! {} package{} already in cache ",
                summary.already_cached,
                if summary.already_cached == 1 { "" } else { "s" },
            );
        } else {
            bun_core::pretty!("<green>Done<r>! No packages to fetch ");
        }
        Output::print_start_end_stdout(ctx.start_time, bun_core::time::nano_timestamp());
        bun_core::pretty!("<r>\n");

        if summary.skipped_git > 0 {
            bun_core::prettyln!(
                "<yellow>note<r>: skipped {} git dependenc{} (run <b>bun install<r> to populate)",
                summary.skipped_git,
                if summary.skipped_git == 1 { "y" } else { "ies" },
            );
        }

        let (_, cache_dir) = get_cache_directory_and_abs_path(pm);
        bun_core::prettyln!("<d>Cache: {}<r>", BStr::new(cache_dir.slice()));
        Output::flush();

        Ok(())
    }
}
