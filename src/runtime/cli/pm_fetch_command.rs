use bstr::BStr;

use bun_core::{Global, Output};
use bun_install::package_manager_real::{
    PackageManager, get_cache_directory_and_abs_path, populate_package_cache,
};

use crate::cli::Command;

pub(crate) fn exec(
    ctx: Command::Context,
    pm: &mut PackageManager,
    original_cwd: &[u8],
) -> crate::Result<()> {
    // False with `--silent` and `--no-summary`. Read it now, because `fetch` clears the flag.
    let print_summary = pm.options.should_print_command_name();
    // Read before calling `fetch`, which sets `dry_run` for its own use.
    let dry_run = pm.options.dry_run;

    if print_summary {
        bun_core::prettyln!(
            "<r><b>bun pm fetch <r><d>v{}<r>\n\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    let start_time = ctx.start_time;
    let summary = populate_package_cache::fetch(pm, ctx, original_cwd)?;

    let _ = pm
        .log_mut()
        .print(std::ptr::from_mut(Output::error_writer()));
    if pm.log_mut().has_errors() || pm.any_failed_to_install {
        Global::exit(1);
    }

    // Nothing is linked or run here, so the scan is left to the command that links.
    if pm.options.security_scanner.is_some() && pm.options.log_level.is_verbose() {
        bun_core::note!(
            "packages are not scanned until <b>bun install<r> runs the security scanner"
        );
    }

    if !print_summary {
        return Ok(());
    }

    if summary.fetched > 0 {
        bun_core::pretty!(
            "<green>{} {} package{}<r> into cache ",
            if dry_run { "Would fetch" } else { "Fetched" },
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
    Output::print_start_end_stdout(start_time, bun_core::time::nano_timestamp());
    bun_core::pretty!("<r>\n");

    let (_, cache_dir) = get_cache_directory_and_abs_path(pm);
    bun_core::prettyln!("<d>Cache: {}<r>", BStr::new(cache_dir.slice()));
    Output::flush();

    Ok(())
}
