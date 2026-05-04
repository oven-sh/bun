use std::io::Write as _;

use bun_collections::HashMap;
use bun_core::fmt::Table;
use bun_core::{Global, Output};
use bun_fs::FileSystem;
use bun_glob as glob;
use bun_install::dependency::Behavior;
use bun_install::package_manager::WorkspaceFilter;
use bun_install::{invalid_package_id, DependencyID, PackageID, PackageManager};
use bun_paths::{self as path, PathBuffer};
use bun_str::strings;
use bun_wyhash::hash;

use crate::Command;

pub struct OutdatedCommand;

#[derive(Clone, Copy)]
struct OutdatedInfo {
    package_id: PackageID,
    dep_id: DependencyID,
    workspace_pkg_id: PackageID,
    is_catalog: bool,
}

impl OutdatedCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::prettyln(format_args!(
            concat!(
                "<r><b>bun outdated <r><d>v",
                // TODO(port): Global.package_json_version_with_sha is a comptime string concat
                env!("BUN_PACKAGE_JSON_VERSION_WITH_SHA"),
                "<r>"
            )
        ));
        Output::flush();

        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Outdated)?;

        // PORT NOTE: reshaped for borrowck (cli used after move into init on err path)
        let (manager, original_cwd) = match PackageManager::init(ctx, cli.clone(), PackageManager::Subcommand::Outdated) {
            Ok(v) => v,
            Err(err) => {
                if !cli.silent {
                    if err == bun_core::err!("MissingPackageJSON") {
                        Output::err_generic(format_args!("missing package.json, nothing outdated"));
                    }
                    Output::err_generic(format_args!(
                        "failed to initialize bun install: {}",
                        err.name()
                    ));
                }

                Global::crash();
            }
        };
        // `defer ctx.allocator.free(original_cwd)` — original_cwd is now Box<[u8]>; Drop frees it.

        Self::outdated(ctx, &original_cwd, manager)
    }

    fn outdated(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        let load_lockfile_result = manager.lockfile.load_from_cwd(
            manager,
            manager.log,
            true,
        );

        manager.lockfile = match load_lockfile_result {
            bun_install::LoadResult::NotFound => {
                if manager.options.log_level != bun_install::LogLevel::Silent {
                    Output::err_generic(format_args!("missing lockfile, nothing outdated"));
                }
                Global::crash();
            }
            bun_install::LoadResult::Err(cause) => {
                if manager.options.log_level != bun_install::LogLevel::Silent {
                    match cause.step {
                        bun_install::LoadStep::OpenFile => Output::err_generic(format_args!(
                            "failed to open lockfile: {}",
                            cause.value.name()
                        )),
                        bun_install::LoadStep::ParseFile => Output::err_generic(format_args!(
                            "failed to parse lockfile: {}",
                            cause.value.name()
                        )),
                        bun_install::LoadStep::ReadFile => Output::err_generic(format_args!(
                            "failed to read lockfile: {}",
                            cause.value.name()
                        )),
                        bun_install::LoadStep::Migrating => Output::err_generic(format_args!(
                            "failed to migrate lockfile: {}",
                            cause.value.name()
                        )),
                    }

                    if ctx.log.has_errors() {
                        manager.log.print(Output::error_writer())?;
                    }
                }

                Global::crash();
            }
            bun_install::LoadResult::Ok(ok) => ok.lockfile,
        };

        // switch (Output.enable_ansi_colors_stdout) { inline else => |enable_ansi_colors| ... }
        // runtime bool → comptime dispatch (kept const generic: gates hot-loop printer branches)
        if Output::enable_ansi_colors_stdout() {
            Self::outdated_inner::<true>(original_cwd, manager)
        } else {
            Self::outdated_inner::<false>(original_cwd, manager)
        }
    }

    fn outdated_inner<const ENABLE_ANSI_COLORS: bool>(
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        if !manager.options.filter_patterns.is_empty() {
            let filters = &manager.options.filter_patterns;
            let workspace_pkg_ids =
                Self::find_matching_workspaces(original_cwd, manager, filters)?;
            // defer bun.default_allocator.free(workspace_pkg_ids) — Drop frees Box<[PackageID]>

            manager.populate_manifest_cache(bun_install::ManifestCacheRequest::Ids(&workspace_pkg_ids))?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &workspace_pkg_ids, true)?;
        } else if manager.options.do_.recursive {
            let all_workspaces = Self::get_all_workspaces(manager)?;
            // defer bun.default_allocator.free(all_workspaces) — Drop frees Box<[PackageID]>

            manager.populate_manifest_cache(bun_install::ManifestCacheRequest::Ids(&all_workspaces))?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &all_workspaces, true)?;
        } else {
            let root_pkg_id = manager
                .root_package_id
                .get(manager.lockfile, manager.workspace_name_hash);
            if root_pkg_id == invalid_package_id {
                return Ok(());
            }

            manager.populate_manifest_cache(bun_install::ManifestCacheRequest::Ids(&[root_pkg_id]))?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &[root_pkg_id], false)?;
        }
        Ok(())
    }

    fn get_all_workspaces(
        manager: &PackageManager,
    ) -> Result<Box<[PackageID]>, bun_alloc::AllocError> {
        let lockfile = manager.lockfile;
        let packages = lockfile.packages.slice();
        let pkg_resolutions = packages.items_resolution();

        let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
        for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
            if resolution.tag != bun_install::ResolutionTag::Workspace
                && resolution.tag != bun_install::ResolutionTag::Root
            {
                continue;
            }
            workspace_pkg_ids.push(PackageID::try_from(pkg_id).unwrap());
        }

        Ok(workspace_pkg_ids.into_boxed_slice())
    }

    fn find_matching_workspaces(
        original_cwd: &[u8],
        manager: &PackageManager,
        filters: &[&[u8]],
    ) -> Result<Box<[PackageID]>, bun_alloc::AllocError> {
        let lockfile = manager.lockfile;
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_resolutions = packages.items_resolution();
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
        for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
            if resolution.tag != bun_install::ResolutionTag::Workspace
                && resolution.tag != bun_install::ResolutionTag::Root
            {
                continue;
            }
            workspace_pkg_ids.push(PackageID::try_from(pkg_id).unwrap());
        }

        let mut path_buf = PathBuffer::uninit();

        let converted_filters: Vec<WorkspaceFilter> = 'converted_filters: {
            let mut buf = Vec::with_capacity(filters.len());
            for filter in filters {
                buf.push(WorkspaceFilter::init(filter, original_cwd, &mut path_buf)?);
            }
            break 'converted_filters buf;
        };
        // defer { for filter: filter.deinit(); allocator.free(converted_filters) } — Drop handles both

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

                            let res_path = match res.tag {
                                bun_install::ResolutionTag::Workspace => {
                                    res.value.workspace.slice(string_buf)
                                }
                                bun_install::ResolutionTag::Root => {
                                    FileSystem::instance().top_level_dir
                                }
                                _ => unreachable!(),
                            };

                            let abs_res_path = path::join_abs_string_buf(
                                FileSystem::instance().top_level_dir,
                                &mut path_buf,
                                &[res_path],
                                path::Platform::Posix,
                            );

                            if !glob::match_(pattern, strings::without_trailing_slash(abs_res_path))
                                .matches()
                            {
                                break 'matched false;
                            }
                        }
                        WorkspaceFilter::Name(pattern) => {
                            let name = pkg_names[workspace_pkg_id as usize].slice(string_buf);

                            if !glob::match_(pattern, name).matches() {
                                break 'matched false;
                            }
                        }
                        WorkspaceFilter::All => {}
                    }
                }

                break 'matched true;
            };

            if matched {
                i += 1;
            } else {
                workspace_pkg_ids.swap_remove(i);
            }
        }

        // Zig returns `.items` (leaks capacity); Rust returns the boxed slice.
        Ok(workspace_pkg_ids.into_boxed_slice())
    }

    fn group_catalog_dependencies(
        manager: &PackageManager,
        outdated_items: &[OutdatedInfo],
        _: &[PackageID],
    ) -> Result<Vec<GroupedOutdatedInfo>, bun_core::Error> {
        let lockfile = manager.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let dependencies = lockfile.buffers.dependencies.as_slice();

        let mut result: Vec<GroupedOutdatedInfo> = Vec::new();

        #[derive(Clone, Copy, PartialEq, Eq, Hash)]
        struct CatalogKey {
            name_hash: u64,
            catalog_name_hash: u64,
            behavior: Behavior,
        }
        let mut catalog_map: HashMap<CatalogKey, Vec<PackageID>> = HashMap::default();
        // defer catalog_map.deinit() + per-entry deinit — Drop handles both

        for item in outdated_items {
            if item.is_catalog {
                let dep = &dependencies[item.dep_id as usize];
                let name_hash = hash(dep.name.slice(string_buf));
                let catalog_name = dep.version.value.catalog.slice(string_buf);
                let catalog_name_hash = hash(catalog_name);
                let key = CatalogKey {
                    name_hash,
                    catalog_name_hash,
                    behavior: dep.behavior,
                };

                let entry = catalog_map.entry(key).or_insert_with(Vec::new);
                entry.push(item.workspace_pkg_id);
            } else {
                result.push(GroupedOutdatedInfo {
                    package_id: item.package_id,
                    dep_id: item.dep_id,
                    workspace_pkg_id: item.workspace_pkg_id,
                    is_catalog: false,
                    grouped_workspace_names: None,
                });
            }
        }

        // Second pass: add grouped catalog dependencies
        for item in outdated_items {
            if !item.is_catalog {
                continue;
            }

            let dep = &dependencies[item.dep_id as usize];
            let name_hash = hash(dep.name.slice(string_buf));
            let catalog_name = dep.version.value.catalog.slice(string_buf);
            let catalog_name_hash = hash(catalog_name);
            let key = CatalogKey {
                name_hash,
                catalog_name_hash,
                behavior: dep.behavior,
            };

            let Some(workspace_list) = catalog_map.get(&key) else {
                continue;
            };

            if workspace_list[0] != item.workspace_pkg_id {
                continue;
            }
            let mut workspace_names: Vec<u8> = Vec::new();

            let cat_name = dep.version.value.catalog.slice(string_buf);
            if !cat_name.is_empty() {
                workspace_names.extend_from_slice(b"catalog:");
                workspace_names.extend_from_slice(cat_name);
                workspace_names.extend_from_slice(b" (");
            } else {
                workspace_names.extend_from_slice(b"catalog (");
            }
            for (i, &workspace_id) in workspace_list.iter().enumerate() {
                if i > 0 {
                    workspace_names.extend_from_slice(b", ");
                }
                let workspace_name = pkg_names[workspace_id as usize].slice(string_buf);
                workspace_names.extend_from_slice(workspace_name);
            }
            workspace_names.push(b')');

            result.push(GroupedOutdatedInfo {
                package_id: item.package_id,
                dep_id: item.dep_id,
                workspace_pkg_id: item.workspace_pkg_id,
                is_catalog: true,
                grouped_workspace_names: Some(workspace_names.into_boxed_slice()),
            });
        }

        Ok(result)
    }

    fn print_outdated_info_table<const ENABLE_ANSI_COLORS: bool>(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        was_filtered: bool,
    ) -> Result<(), bun_core::Error> {
        let package_patterns: Option<Vec<FilterType>> = 'package_patterns: {
            let args = &manager.options.positionals[1..];
            if args.is_empty() {
                break 'package_patterns None;
            }

            let mut at_least_one_greater_than_zero = false;

            let mut patterns_buf: Vec<FilterType> = Vec::with_capacity(args.len());
            for arg in args {
                if arg.is_empty() {
                    patterns_buf.push(FilterType::init(b"", false));
                    continue;
                }

                if (arg.len() == 1 && arg[0] == b'*') || arg == b"**" {
                    patterns_buf.push(FilterType::All);
                    at_least_one_greater_than_zero = true;
                    continue;
                }

                patterns_buf.push(FilterType::init(arg, false));
                at_least_one_greater_than_zero = at_least_one_greater_than_zero || !arg.is_empty();
            }

            // nothing will match
            if !at_least_one_greater_than_zero {
                return Ok(());
            }

            break 'package_patterns Some(patterns_buf);
        };
        // defer { for pattern: pattern.deinit(); free(patterns) } — Drop handles both (deinit was no-op)

        let mut max_name: usize = 0;
        let mut max_current: usize = 0;
        let mut max_update: usize = 0;
        let mut max_latest: usize = 0;
        let mut max_workspace: usize = 0;
        let mut has_filtered_versions: bool = false;

        let lockfile = manager.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_resolutions = packages.items_resolution();
        let pkg_dependencies = packages.items_dependencies();

        let mut version_buf: Vec<u8> = Vec::new();

        let mut outdated_ids: Vec<OutdatedInfo> = Vec::new();

        for &workspace_pkg_id in workspace_pkg_ids {
            let pkg_deps = pkg_dependencies[workspace_pkg_id as usize];
            for dep_id in pkg_deps.begin()..pkg_deps.end() {
                let package_id = lockfile.buffers.resolutions.as_slice()[dep_id];
                if package_id == invalid_package_id {
                    continue;
                }
                let dep = &lockfile.buffers.dependencies.as_slice()[dep_id];
                let Some(resolved_version) = manager.lockfile.resolve_catalog_dependency(dep) else {
                    continue;
                };
                if resolved_version.tag != bun_install::DependencyVersionTag::Npm
                    && resolved_version.tag != bun_install::DependencyVersionTag::DistTag
                {
                    continue;
                }
                let resolution = &pkg_resolutions[package_id as usize];
                if resolution.tag != bun_install::ResolutionTag::Npm {
                    continue;
                }

                // package patterns match against dependency name (name in package.json)
                if let Some(patterns) = &package_patterns {
                    let match_ = 'match_: {
                        for pattern in patterns {
                            match pattern {
                                FilterType::Path(_) => unreachable!(),
                                FilterType::Name(name_pattern) => {
                                    if name_pattern.is_empty() {
                                        continue;
                                    }
                                    if !glob::match_(name_pattern, dep.name.slice(string_buf))
                                        .matches()
                                    {
                                        break 'match_ false;
                                    }
                                }
                                FilterType::All => {}
                            }
                        }

                        break 'match_ true;
                    };
                    if !match_ {
                        continue;
                    }
                }

                let package_name = pkg_names[package_id as usize].slice(string_buf);
                let mut expired = false;
                let Some(manifest) = manager.manifests.by_name_allow_expired(
                    manager,
                    manager.scope_for_package_name(package_name),
                    package_name,
                    &mut expired,
                    bun_install::ManifestLoad::LoadFromMemoryFallbackToDisk,
                    manager.options.minimum_release_age_ms.is_some(),
                ) else {
                    continue;
                };

                let Some(actual_latest) = manifest.find_by_dist_tag(b"latest") else {
                    continue;
                };

                let latest = manifest.find_by_dist_tag_with_filter(
                    b"latest",
                    manager.options.minimum_release_age_ms,
                    &manager.options.minimum_release_age_excludes,
                );

                let update_version = if resolved_version.tag == bun_install::DependencyVersionTag::Npm {
                    manifest.find_best_version_with_filter(
                        &resolved_version.value.npm.version,
                        string_buf,
                        manager.options.minimum_release_age_ms,
                        &manager.options.minimum_release_age_excludes,
                    )
                } else {
                    manifest.find_by_dist_tag_with_filter(
                        resolved_version.value.dist_tag.tag.slice(string_buf),
                        manager.options.minimum_release_age_ms,
                        &manager.options.minimum_release_age_excludes,
                    )
                };

                if resolution.value.npm.version.order(
                    &actual_latest.version,
                    string_buf,
                    manifest.string_buf,
                ) != core::cmp::Ordering::Less
                {
                    continue;
                }

                let has_filtered_update = update_version.latest_is_filtered();
                let has_filtered_latest = latest.latest_is_filtered();
                if has_filtered_update || has_filtered_latest {
                    has_filtered_versions = true;
                }

                let package_name_len = package_name.len()
                    + if dep.behavior.dev {
                        " (dev)".len()
                    } else if dep.behavior.peer {
                        " (peer)".len()
                    } else if dep.behavior.optional {
                        " (optional)".len()
                    } else {
                        0
                    };

                if package_name_len > max_name {
                    max_name = package_name_len;
                }

                write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(string_buf)).unwrap();
                if version_buf.len() > max_current {
                    max_current = version_buf.len();
                }
                version_buf.clear();

                if let Some(update_version_) = update_version.unwrap_() {
                    write!(&mut version_buf, "{}", update_version_.version.fmt(manifest.string_buf)).unwrap();
                } else {
                    write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(manifest.string_buf)).unwrap();
                }
                let update_version_len =
                    version_buf.len() + if has_filtered_update { " *".len() } else { 0 };
                if update_version_len > max_update {
                    max_update = update_version_len;
                }
                version_buf.clear();

                if let Some(latest_version) = latest.unwrap_() {
                    write!(&mut version_buf, "{}", latest_version.version.fmt(manifest.string_buf)).unwrap();
                } else {
                    write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(manifest.string_buf)).unwrap();
                }
                let latest_version_len =
                    version_buf.len() + if has_filtered_latest { " *".len() } else { 0 };
                if latest_version_len > max_latest {
                    max_latest = latest_version_len;
                }
                version_buf.clear();

                let workspace_name = pkg_names[workspace_pkg_id as usize].slice(string_buf);
                if workspace_name.len() > max_workspace {
                    max_workspace = workspace_name.len();
                }

                outdated_ids.push(OutdatedInfo {
                    package_id,
                    dep_id: DependencyID::try_from(dep_id).unwrap(),
                    workspace_pkg_id,
                    is_catalog: dep.version.tag == bun_install::DependencyVersionTag::Catalog,
                });
            }
        }

        if outdated_ids.is_empty() {
            return Ok(());
        }

        // Group catalog dependencies
        let grouped_ids = Self::group_catalog_dependencies(manager, &outdated_ids, workspace_pkg_ids)?;

        // Recalculate max workspace length after grouping
        let mut new_max_workspace: usize = max_workspace;
        let mut has_catalog_deps = false;
        for item in &grouped_ids {
            if let Some(names) = &item.grouped_workspace_names {
                if names.len() > new_max_workspace {
                    new_max_workspace = names.len();
                }
                has_catalog_deps = true;
            }
        }

        // Show workspace column if filtered OR if there are catalog dependencies
        let show_workspace_column = was_filtered || has_catalog_deps;

        let package_column_inside_length = "Packages".len().max(max_name);
        let current_column_inside_length = "Current".len().max(max_current);
        let update_column_inside_length = "Update".len().max(max_update);
        let latest_column_inside_length = "Latest".len().max(max_latest);
        let workspace_column_inside_length = "Workspace".len().max(new_max_workspace);

        const COLUMN_LEFT_PAD: usize = 1;
        const COLUMN_RIGHT_PAD: usize = 1;

        // TODO(port): Table is `fn(comptime color, comptime left_pad, comptime right_pad, comptime enable_ansi) type`.
        // &'static str const generics are unstable; Phase B may need a different parameterization.
        let table = Table::<{ COLUMN_LEFT_PAD }, { COLUMN_RIGHT_PAD }, ENABLE_ANSI_COLORS>::init(
            "blue",
            if show_workspace_column {
                &[b"Package" as &[u8], b"Current", b"Update", b"Latest", b"Workspace"][..]
            } else {
                &[b"Package" as &[u8], b"Current", b"Update", b"Latest"][..]
            },
            if show_workspace_column {
                &[
                    package_column_inside_length,
                    current_column_inside_length,
                    update_column_inside_length,
                    latest_column_inside_length,
                    workspace_column_inside_length,
                ][..]
            } else {
                &[
                    package_column_inside_length,
                    current_column_inside_length,
                    update_column_inside_length,
                    latest_column_inside_length,
                ][..]
            },
        );

        table.print_top_line_separator();
        table.print_column_names();

        // Print grouped items sorted by behavior type
        // PERF(port): was `inline for` (compile-time unrolled) — profile in Phase B
        for group_behavior in [
            Behavior { prod: true, ..Behavior::default() },
            Behavior { dev: true, ..Behavior::default() },
            Behavior { peer: true, ..Behavior::default() },
            Behavior { optional: true, ..Behavior::default() },
        ] {
            for item in &grouped_ids {
                let package_id = item.package_id;
                let dep_id = item.dep_id;

                let dep = &dependencies[dep_id as usize];
                if !dep.behavior.includes(group_behavior) {
                    continue;
                }

                let package_name = pkg_names[package_id as usize].slice(string_buf);
                let resolution = &pkg_resolutions[package_id as usize];

                let mut expired = false;
                let Some(manifest) = manager.manifests.by_name_allow_expired(
                    manager,
                    manager.scope_for_package_name(package_name),
                    package_name,
                    &mut expired,
                    bun_install::ManifestLoad::LoadFromMemoryFallbackToDisk,
                    manager.options.minimum_release_age_ms.is_some(),
                ) else {
                    continue;
                };

                let latest = manifest.find_by_dist_tag_with_filter(
                    b"latest",
                    manager.options.minimum_release_age_ms,
                    &manager.options.minimum_release_age_excludes,
                );
                let Some(resolved_version) = manager.lockfile.resolve_catalog_dependency(dep) else {
                    continue;
                };
                let update = if resolved_version.tag == bun_install::DependencyVersionTag::Npm {
                    manifest.find_best_version_with_filter(
                        &resolved_version.value.npm.version,
                        string_buf,
                        manager.options.minimum_release_age_ms,
                        &manager.options.minimum_release_age_excludes,
                    )
                } else {
                    manifest.find_by_dist_tag_with_filter(
                        resolved_version.value.dist_tag.tag.slice(string_buf),
                        manager.options.minimum_release_age_ms,
                        &manager.options.minimum_release_age_excludes,
                    )
                };

                table.print_line_separator();

                {
                    // package name
                    let behavior_str: &[u8] = if dep.behavior.dev {
                        b" (dev)"
                    } else if dep.behavior.peer {
                        b" (peer)"
                    } else if dep.behavior.optional {
                        b" (optional)"
                    } else {
                        b""
                    };

                    Output::pretty(format_args!("{}", table.symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }

                    Output::pretty(format_args!(
                        "{}<d>{}<r>",
                        bstr::BStr::new(package_name),
                        bstr::BStr::new(behavior_str)
                    ));
                    for _ in package_name.len() + behavior_str.len()
                        ..package_column_inside_length + COLUMN_RIGHT_PAD
                    {
                        Output::pretty(format_args!(" "));
                    }
                }

                {
                    // current version
                    Output::pretty(format_args!("{}", table.symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }

                    write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(string_buf)).unwrap();
                    Output::pretty(format_args!("{}", bstr::BStr::new(&version_buf)));
                    for _ in version_buf.len()..current_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                }

                {
                    // update version
                    Output::pretty(format_args!("{}", table.symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    if let Some(update_version) = update.unwrap_() {
                        write!(&mut version_buf, "{}", update_version.version.fmt(manifest.string_buf)).unwrap();
                        Output::pretty(format_args!(
                            "{}",
                            update_version.version.diff_fmt(
                                &resolution.value.npm.version,
                                manifest.string_buf,
                                string_buf
                            )
                        ));
                    } else {
                        write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(string_buf)).unwrap();
                        Output::pretty(format_args!("<d>{}<r>", bstr::BStr::new(&version_buf)));
                    }
                    let mut update_version_len: usize = version_buf.len();
                    if update.latest_is_filtered() {
                        Output::pretty(format_args!(" <blue>*<r>"));
                        update_version_len += " *".len();
                    }
                    for _ in update_version_len..update_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                }

                {
                    // latest version
                    Output::pretty(format_args!("{}", table.symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    if let Some(latest_version) = latest.unwrap_() {
                        write!(&mut version_buf, "{}", latest_version.version.fmt(manifest.string_buf)).unwrap();
                        Output::pretty(format_args!(
                            "{}",
                            latest_version.version.diff_fmt(
                                &resolution.value.npm.version,
                                manifest.string_buf,
                                string_buf
                            )
                        ));
                    } else {
                        write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(string_buf)).unwrap();
                        Output::pretty(format_args!("<d>{}<r>", bstr::BStr::new(&version_buf)));
                    }
                    let mut latest_version_len: usize = version_buf.len();
                    if latest.latest_is_filtered() {
                        Output::pretty(format_args!(" <blue>*<r>"));
                        latest_version_len += " *".len();
                    }
                    for _ in latest_version_len..latest_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                }

                if show_workspace_column {
                    Output::pretty(format_args!("{}", table.symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }

                    let workspace_name: &[u8] = if let Some(names) = &item.grouped_workspace_names {
                        names
                    } else {
                        pkg_names[item.workspace_pkg_id as usize].slice(string_buf)
                    };
                    Output::pretty(format_args!("{}", bstr::BStr::new(workspace_name)));

                    for _ in workspace_name.len()..workspace_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                }

                Output::pretty(format_args!("{}\n", table.symbols.vertical_edge()));
            }
        }

        table.print_bottom_line_separator();

        if has_filtered_versions {
            Output::prettyln(format_args!(
                "<d><b>Note:<r> <d>The <r><blue>*<r><d> indicates that version isn't true latest due to minimum release age<r>"
            ));
        }

        Ok(())
    }
}

// TODO: use in `bun pack, publish, run, ...`
// TODO(port): lifetime — Name/Path borrow from manager.options.positionals (never freed in Zig deinit)
enum FilterType<'a> {
    All,
    Name(&'a [u8]),
    Path(&'a [u8]),
}

impl<'a> FilterType<'a> {
    pub fn init(pattern: &'a [u8], is_path: bool) -> Self {
        if is_path {
            FilterType::Path(pattern)
        } else {
            FilterType::Name(pattern)
        }
    }

    // *NOTE*: Currently this does nothing since name and path are not allocated.
    // (Zig `deinit` was a no-op → no Drop impl needed.)
}

struct GroupedOutdatedInfo {
    package_id: PackageID,
    dep_id: DependencyID,
    #[allow(dead_code)]
    workspace_pkg_id: PackageID,
    #[allow(dead_code)]
    is_catalog: bool,
    grouped_workspace_names: Option<Box<[u8]>>,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/outdated_command.zig (714 lines)
//   confidence: medium
//   todos:      3
//   notes:      Table comptime-str generic + bun_install cross-crate type names (LoadResult, ResolutionTag, DependencyVersionTag, ManifestLoad) are guesses; Output::pretty assumed to take format_args; borrowck reshaping likely needed around manager.lockfile self-borrows
// ──────────────────────────────────────────────────────────────────────────
