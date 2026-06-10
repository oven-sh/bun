//! Workspace/lockfile helpers shared by `bun outdated` and
//! `bun update --interactive`.

use bun_core::strings;
use bun_core::{Global, Output};
use bun_glob as glob;
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::lockfile::{LoadResult, LoadStep};
use bun_install::package_manager::{LogLevel, WorkspaceFilter};
use bun_install::{PackageID, PackageManager, resolution};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;

use crate::Command;

/// Load the lockfile from the current directory, reporting errors and exiting
/// the process on failure.
pub(crate) fn load_lockfile_or_crash(ctx: &Command::ContextData, manager: &mut PackageManager) {
    let not_silent = manager.options.log_level != LogLevel::Silent;
    match manager.load_lockfile_from_cwd::<true>() {
        LoadResult::NotFound => {
            if not_silent {
                Output::err_generic("missing lockfile, nothing outdated", ());
            }
            Global::crash();
        }
        LoadResult::Err(cause) => {
            if not_silent {
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
            // `load_from_cwd(&mut self, ..)` populates the lockfile in place,
            // so no reassignment is needed.
        }
    }
}

/// Collect the package IDs of the root package and every workspace package.
pub(crate) fn get_all_workspaces(manager: &PackageManager) -> Vec<PackageID> {
    let lockfile = &manager.lockfile;
    let packages = lockfile.packages.slice();
    let pkg_resolutions = packages.items_resolution();

    let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
    for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
        if resolution.tag != resolution::Tag::Workspace && resolution.tag != resolution::Tag::Root {
            continue;
        }
        workspace_pkg_ids.push(pkg_id as PackageID);
    }
    workspace_pkg_ids
}

/// Collect the workspace package IDs matching the `--filter` patterns.
pub(crate) fn find_matching_workspaces(
    original_cwd: &[u8],
    manager: &PackageManager,
    filters: &[&[u8]],
) -> Vec<PackageID> {
    let lockfile = &manager.lockfile;
    let packages = lockfile.packages.slice();
    let pkg_names = packages.items_name();
    let pkg_resolutions = packages.items_resolution();
    let string_buf = lockfile.buffers.string_bytes.as_slice();

    let mut workspace_pkg_ids = get_all_workspaces(manager);

    let mut path_buf = PathBuffer::uninit();

    let converted_filters: Vec<WorkspaceFilter> = filters
        .iter()
        .map(|filter| {
            bun_core::handle_oom(WorkspaceFilter::init(filter, original_cwd, &mut path_buf.0))
        })
        .collect();
    // `defer { filter.deinit(allocator); allocator.free(...) }` — implicit via Drop.

    // SAFETY: `FileSystem::init` runs during `PackageManager::init` so the
    // process-singleton is populated.
    let top_level_dir = FileSystem::get().top_level_dir;

    // move all matched workspaces to front of array
    let mut i: usize = 0;
    while i < workspace_pkg_ids.len() {
        let workspace_pkg_id = workspace_pkg_ids[i];

        let matched = 'matched: {
            for filter in &converted_filters {
                match filter {
                    WorkspaceFilter::Path(pattern) => {
                        if pattern.is_empty() {
                            continue;
                        }
                        let res = &pkg_resolutions[workspace_pkg_id as usize];
                        let res_path: &[u8] = match res.tag {
                            resolution::Tag::Workspace => {
                                // Borrow the field in-place so the returned slice (which may
                                // point into the inline small-string storage) stays valid.
                                res.workspace().slice(string_buf)
                            }
                            resolution::Tag::Root => top_level_dir,
                            _ => unreachable!(),
                        };

                        let abs_res_path = path::resolve_path::join_abs_string_buf::<
                            path::platform::Posix,
                        >(
                            top_level_dir, &mut path_buf.0, &[res_path]
                        );

                        if !glob::r#match(pattern, strings::without_trailing_slash(abs_res_path))
                            .matches()
                        {
                            break 'matched false;
                        }
                    }
                    WorkspaceFilter::Name(pattern) => {
                        let name = pkg_names[workspace_pkg_id as usize].slice(string_buf);
                        if !glob::r#match(pattern, name).matches() {
                            break 'matched false;
                        }
                    }
                    WorkspaceFilter::All => {}
                }
            }
            true
        };

        if matched {
            i += 1;
        } else {
            workspace_pkg_ids.swap_remove(i);
        }
    }

    workspace_pkg_ids
}
