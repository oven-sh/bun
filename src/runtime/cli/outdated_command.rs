use core::fmt::Write as _;

use bstr::BStr;

use bun_core::fmt::{Table, TableSymbols};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_glob as glob;
use bun_install::dependency::{self, Behavior};
use bun_install::lockfile::package::{PackageColumns as _};
use bun_install::lockfile::{LoadResult, LoadStep};
use bun_install::package_manager::{
    self, LogLevel, ManifestLoad, Subcommand, WorkspaceFilter, populate_manifest_cache,
};
use bun_install::{CommandLineArguments, DependencyID, PackageID, PackageManager, resolution};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;
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

struct GroupedOutdatedInfo {
    package_id: PackageID,
    dep_id: DependencyID,
    workspace_pkg_id: PackageID,
    #[allow(dead_code)]
    is_catalog: bool,
    grouped_workspace_names: Option<Box<[u8]>>,
}

// TODO: use in `bun pack, publish, run, ...`
enum FilterType<'a> {
    All,
    Name(&'a [u8]),
    #[allow(dead_code)]
    Path(&'a [u8]),
}

impl<'a> FilterType<'a> {
    fn init(pattern: &'a [u8], is_path: bool) -> Self {
        if is_path {
            FilterType::Path(pattern)
        } else {
            FilterType::Name(pattern)
        }
    }
    // *NOTE*: Currently `deinit` does nothing since name and path are not
    // allocated (Zig `deinit` was a no-op → no Drop impl needed).
}

impl OutdatedCommand {
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::prettyln(format_args!(
            "<r><b>bun outdated <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        ));
        Output::flush();

        let cli = CommandLineArguments::parse(Subcommand::Outdated)?;
        let silent = cli.silent;

        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, cli, Subcommand::Outdated) {
                Ok(v) => v,
                Err(err) => {
                    if !silent {
                        if err == bun_core::err!("MissingPackageJSON") {
                            Output::err_generic("missing package.json, nothing outdated", ());
                        }
                        Output::err_generic("failed to initialize bun install: {s}", (err.name(),));
                    }
                    Global::crash();
                }
            };
        // `original_cwd: Box<[u8]>` — `defer ctx.allocator.free(original_cwd)` is
        // implicit via Drop at scope exit.

        Self::outdated(ctx, &original_cwd, manager)
    }

    fn outdated(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — Zig calls
        // `manager.lockfile.loadFromCwd(manager, alloc, manager.log, true)` which
        // aliases `*PackageManager` with its `*Lockfile` field. Project disjoint
        // raw pointers from the singleton first; `load_from_cwd` only reads
        // `manager.options` / migration helpers and never re-borrows
        // `manager.lockfile` through the `pm` argument.
        let pm_ptr: *mut PackageManager = manager;
        let not_silent = manager.options.log_level != LogLevel::Silent;
        let log_ptr: *mut bun_ast::Log = manager.log;

        // SAFETY: `lockfile` is the owned `Box<Lockfile>` field on the singleton;
        // no other live `&mut Lockfile` exists at this point.
        let lockfile: &mut bun_install::lockfile::Lockfile = unsafe { &mut *(*pm_ptr).lockfile };
        // SAFETY: `manager.log` is set non-null by `PackageManager::init`.
        let log = unsafe { &mut *log_ptr };
        match lockfile.load_from_cwd::<true>(
            // SAFETY: see PORT NOTE above — `load_from_cwd` accesses `manager`
            // fields disjoint from `lockfile` (Zig invariant).
            Some(unsafe { &mut *pm_ptr }),
            log,
        ) {
            LoadResult::NotFound => {
                if not_silent {
                    Output::err_generic("missing lockfile, nothing outdated", ());
                }
                Global::crash();
            }
            LoadResult::Err(cause) => {
                if not_silent {
                    match cause.step {
                        LoadStep::OpenFile => Output::err_generic(
                            "failed to open lockfile: {s}",
                            (cause.value.name(),),
                        ),
                        LoadStep::ParseFile => Output::err_generic(
                            "failed to parse lockfile: {s}",
                            (cause.value.name(),),
                        ),
                        LoadStep::ReadFile => Output::err_generic(
                            "failed to read lockfile: {s}",
                            (cause.value.name(),),
                        ),
                        LoadStep::Migrating => Output::err_generic(
                            "failed to migrate lockfile: {s}",
                            (cause.value.name(),),
                        ),
                    }
                    if ctx.log_ref().has_errors() {
                        // SAFETY: `log_ptr` aliases `manager.log` which is the
                        // `*logger.Log` borrowed from `Command::Context`; no
                        // other `&mut Log` is live here.
                        let _ =
                            unsafe { (*log_ptr).print(std::ptr::from_mut(Output::error_writer())) };
                    }
                }
                Global::crash();
            }
            LoadResult::Ok(_) => {
                // PORT NOTE: Zig reassigns `manager.lockfile = ok.lockfile`
                // (pointer field). `load_from_cwd(&mut self, ..)` populates the
                // lockfile in place, so the `ok.lockfile: &mut Lockfile` reborrow
                // is the same storage and no reassignment is needed.
            }
        }

        if Output::enable_ansi_colors_stdout() {
            Self::outdated_dispatch::<true>(original_cwd, manager)
        } else {
            Self::outdated_dispatch::<false>(original_cwd, manager)
        }
    }

    fn outdated_dispatch<const ENABLE_ANSI_COLORS: bool>(
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        if !manager.options.filter_patterns.is_empty() {
            let filters = manager.options.filter_patterns;
            let workspace_pkg_ids = Self::find_matching_workspaces(original_cwd, manager, filters);
            populate_manifest_cache::populate_manifest_cache(
                manager,
                populate_manifest_cache::Packages::Ids(&workspace_pkg_ids),
            )?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &workspace_pkg_ids, true)
        } else if manager.options.do_.recursive() {
            let all_workspaces = Self::get_all_workspaces(manager);
            populate_manifest_cache::populate_manifest_cache(
                manager,
                populate_manifest_cache::Packages::Ids(&all_workspaces),
            )?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &all_workspaces, true)
        } else {
            let root_pkg_id = manager
                .root_package_id
                .get(&manager.lockfile, manager.workspace_name_hash);
            if root_pkg_id == bun_install::INVALID_PACKAGE_ID {
                return Ok(());
            }
            let ids = [root_pkg_id];
            populate_manifest_cache::populate_manifest_cache(
                manager,
                populate_manifest_cache::Packages::Ids(&ids),
            )?;
            Self::print_outdated_info_table::<ENABLE_ANSI_COLORS>(manager, &ids, false)
        }
    }

    fn get_all_workspaces(manager: &PackageManager) -> Vec<PackageID> {
        let lockfile = &manager.lockfile;
        let packages = lockfile.packages.slice();
        let pkg_resolutions = packages.items_resolution();

        let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
        for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
            if resolution.tag != resolution::Tag::Workspace
                && resolution.tag != resolution::Tag::Root
            {
                continue;
            }
            workspace_pkg_ids.push(pkg_id as PackageID);
        }
        workspace_pkg_ids
    }

    fn find_matching_workspaces(
        original_cwd: &[u8],
        manager: &PackageManager,
        filters: &[&[u8]],
    ) -> Vec<PackageID> {
        let lockfile = &manager.lockfile;
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_resolutions = packages.items_resolution();
        let string_buf = lockfile.buffers.string_bytes.as_slice();

        let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
        for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
            if resolution.tag != resolution::Tag::Workspace
                && resolution.tag != resolution::Tag::Root
            {
                continue;
            }
            workspace_pkg_ids.push(pkg_id as PackageID);
        }

        let mut path_buf = PathBuffer::uninit();

        let converted_filters: Vec<WorkspaceFilter> = filters
            .iter()
            .map(|filter| {
                bun_core::handle_oom(WorkspaceFilter::init(filter, original_cwd, &mut path_buf.0))
            })
            .collect();
        // `defer { filter.deinit(allocator); allocator.free(...) }` — implicit via Drop.

        // SAFETY: `FileSystem::init` runs during `PackageManager::init` so the
        // process-singleton is populated; mirrors Zig `FileSystem.instance.top_level_dir`.
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

                            if !glob::r#match(
                                pattern,
                                strings::without_trailing_slash(abs_res_path),
                            )
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

    fn group_catalog_dependencies(
        manager: &PackageManager,
        outdated_items: &[OutdatedInfo],
        _: &[PackageID],
    ) -> Vec<GroupedOutdatedInfo> {
        let lockfile = &manager.lockfile;
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
        let mut catalog_map: std::collections::HashMap<CatalogKey, Vec<PackageID>> =
            std::collections::HashMap::new();

        for item in outdated_items {
            if item.is_catalog {
                let dep = &dependencies[item.dep_id as usize];
                let name_hash = hash(dep.name.slice(string_buf));
                let catalog = *dep.version.catalog();
                let catalog_name = catalog.slice(string_buf);
                let catalog_name_hash = hash(catalog_name);
                let key = CatalogKey {
                    name_hash,
                    catalog_name_hash,
                    behavior: dep.behavior,
                };
                catalog_map
                    .entry(key)
                    .or_default()
                    .push(item.workspace_pkg_id);
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
            let catalog = *dep.version.catalog();
            let catalog_name = catalog.slice(string_buf);
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

            let cat_name = catalog_name;
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

        result
    }

    fn print_outdated_info_table<const ENABLE_ANSI_COLORS: bool>(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        was_filtered: bool,
    ) -> Result<(), bun_core::Error> {
        let package_patterns: Option<Vec<FilterType<'_>>> = 'package_patterns: {
            let args = manager.options.positionals.get(1..).unwrap_or(&[]);
            if args.is_empty() {
                break 'package_patterns None;
            }

            let mut at_least_one_greater_than_zero = false;
            let mut patterns_buf: Vec<FilterType<'_>> = Vec::with_capacity(args.len());
            for arg in args {
                if arg.is_empty() {
                    patterns_buf.push(FilterType::init(b"", false));
                    continue;
                }
                if (arg.len() == 1 && arg[0] == b'*') || strings::eql_comptime(arg, b"**") {
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

            Some(patterns_buf)
        };
        // `defer { pattern.deinit(); allocator.free(patterns) }` — Drop on Vec.

        let mut max_name: usize = 0;
        let mut max_current: usize = 0;
        let mut max_update: usize = 0;
        let mut max_latest: usize = 0;
        let mut max_workspace: usize = 0;
        let mut has_filtered_versions: bool = false;

        // PORT NOTE: reshaped for borrowck — Zig threads `*PackageManager`
        // into `manifests.byNameAllowExpired`, freely aliasing the receiver.
        // Hoist the four scalars that path reads into a by-value
        // `DiskCacheCtx` so the loop body holds only disjoint field borrows
        // (`&mut manager.manifests` against `&manager.lockfile` /
        // `&manager.options`).
        let cache_ctx = manager.manifest_disk_cache_ctx();
        let min_age_ms = manager.options.minimum_release_age_ms;
        let needs_extended = min_age_ms.is_some();
        let excludes = manager.options.minimum_release_age_excludes;

        let mut version_buf: String = String::new();

        let mut outdated_ids: Vec<OutdatedInfo> = Vec::new();

        for &workspace_pkg_id in workspace_pkg_ids {
            let pkg_deps =
                manager.lockfile.packages.items_dependencies()[workspace_pkg_id as usize];
            for dep_id in pkg_deps.begin()..pkg_deps.end() {
                let package_id = manager.lockfile.buffers.resolutions[dep_id as usize];
                if package_id == bun_install::INVALID_PACKAGE_ID {
                    continue;
                }
                let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
                let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                let Some(resolved_version) = manager.lockfile.resolve_catalog_dependency(dep)
                else {
                    continue;
                };
                if resolved_version.tag != dependency::Tag::Npm
                    && resolved_version.tag != dependency::Tag::DistTag
                {
                    continue;
                }
                let resolution = manager.lockfile.packages.items_resolution()[package_id as usize];
                if resolution.tag != resolution::Tag::Npm {
                    continue;
                }

                // package patterns match against dependency name (name in package.json)
                if let Some(patterns) = &package_patterns {
                    let matched = 'match_: {
                        for pattern in patterns {
                            match pattern {
                                FilterType::Path(_) => unreachable!(),
                                FilterType::Name(name_pattern) => {
                                    if name_pattern.is_empty() {
                                        continue;
                                    }
                                    if !glob::r#match(name_pattern, dep.name.slice(string_buf))
                                        .matches()
                                    {
                                        break 'match_ false;
                                    }
                                }
                                FilterType::All => {}
                            }
                        }
                        true
                    };
                    if !matched {
                        continue;
                    }
                }

                let package_name =
                    manager.lockfile.packages.items_name()[package_id as usize].slice(string_buf);
                let scope = manager.options.scope_for_package_name(package_name).clone();
                let mut expired = false;
                let Some(manifest) = manager.manifests.by_name_allow_expired(
                    cache_ctx,
                    &scope,
                    package_name,
                    Some(&mut expired),
                    ManifestLoad::LoadFromMemoryFallbackToDisk,
                    needs_extended,
                ) else {
                    continue;
                };

                let Some(actual_latest) = manifest.find_by_dist_tag(b"latest") else {
                    continue;
                };

                let latest = manifest.find_by_dist_tag_with_filter(b"latest", min_age_ms, excludes);

                let update_version = if resolved_version.tag == dependency::Tag::Npm {
                    manifest.find_best_version_with_filter(
                        &resolved_version.npm().version,
                        string_buf,
                        min_age_ms,
                        excludes,
                    )
                } else {
                    manifest.find_by_dist_tag_with_filter(
                        resolved_version.dist_tag().tag.slice(string_buf),
                        min_age_ms,
                        excludes,
                    )
                };

                let current_version = resolution.npm().version;
                if current_version.order(actual_latest.version, string_buf, &manifest.string_buf)
                    != core::cmp::Ordering::Less
                {
                    continue;
                }

                let has_filtered_update = update_version.latest_is_filtered();
                let has_filtered_latest = latest.latest_is_filtered();
                if has_filtered_update || has_filtered_latest {
                    has_filtered_versions = true;
                }

                let package_name_len = package_name.len()
                    + if dep.behavior.is_dev() {
                        " (dev)".len()
                    } else if dep.behavior.is_peer() {
                        " (peer)".len()
                    } else if dep.behavior.is_optional() {
                        " (optional)".len()
                    } else {
                        0
                    };
                if package_name_len > max_name {
                    max_name = package_name_len;
                }

                version_buf.clear();
                write!(version_buf, "{}", current_version.fmt(string_buf))
                    .expect("OOM writing version");
                if version_buf.len() > max_current {
                    max_current = version_buf.len();
                }

                version_buf.clear();
                if let Some(uv) = update_version.unwrap() {
                    write!(version_buf, "{}", uv.version.fmt(&manifest.string_buf))
                        .expect("OOM writing version");
                } else {
                    write!(version_buf, "{}", current_version.fmt(&manifest.string_buf))
                        .expect("OOM writing version");
                }
                let update_version_len =
                    version_buf.len() + if has_filtered_update { " *".len() } else { 0 };
                if update_version_len > max_update {
                    max_update = update_version_len;
                }

                version_buf.clear();
                if let Some(lv) = latest.unwrap() {
                    write!(version_buf, "{}", lv.version.fmt(&manifest.string_buf))
                        .expect("OOM writing version");
                } else {
                    write!(version_buf, "{}", current_version.fmt(&manifest.string_buf))
                        .expect("OOM writing version");
                }
                let latest_version_len =
                    version_buf.len() + if has_filtered_latest { " *".len() } else { 0 };
                if latest_version_len > max_latest {
                    max_latest = latest_version_len;
                }
                version_buf.clear();

                let workspace_name = manager.lockfile.packages.items_name()
                    [workspace_pkg_id as usize]
                    .slice(string_buf);
                if workspace_name.len() > max_workspace {
                    max_workspace = workspace_name.len();
                }

                outdated_ids.push(OutdatedInfo {
                    package_id,
                    dep_id,
                    workspace_pkg_id,
                    is_catalog: dep.version.tag == dependency::Tag::Catalog,
                });
            }
        }

        if outdated_ids.is_empty() {
            return Ok(());
        }

        // Group catalog dependencies
        let grouped_ids =
            Self::group_catalog_dependencies(manager, &outdated_ids, workspace_pkg_ids);

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

        let names_5: [&[u8]; 5] = [b"Package", b"Current", b"Update", b"Latest", b"Workspace"];
        let names_4: [&[u8]; 4] = [b"Package", b"Current", b"Update", b"Latest"];
        let lengths_5 = [
            package_column_inside_length,
            current_column_inside_length,
            update_column_inside_length,
            latest_column_inside_length,
            workspace_column_inside_length,
        ];
        let lengths_4 = [
            package_column_inside_length,
            current_column_inside_length,
            update_column_inside_length,
            latest_column_inside_length,
        ];
        let (column_names, column_lengths): (&[&[u8]], &[usize]) = if show_workspace_column {
            (&names_5, &lengths_5)
        } else {
            (&names_4, &lengths_4)
        };

        let table = Table::<COLUMN_LEFT_PAD, COLUMN_RIGHT_PAD, ENABLE_ANSI_COLORS>::init(
            column_names,
            column_lengths,
            "blue",
        );
        let symbols = TableSymbols {
            enable_ansi_colors: ENABLE_ANSI_COLORS,
        };

        table.print_top_line_separator();
        table.print_column_names();

        // Print grouped items sorted by behavior type
        // PERF(port): was `inline for` over a comptime tuple — profile in Phase B.
        for group_behavior in [
            Behavior::PROD,
            Behavior::DEV,
            Behavior::PEER,
            Behavior::OPTIONAL,
        ] {
            for item in &grouped_ids {
                let package_id = item.package_id;
                let dep_id = item.dep_id;

                let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
                let dep = &manager.lockfile.buffers.dependencies[dep_id as usize];
                if !dep.behavior.includes(group_behavior) {
                    continue;
                }

                let package_name =
                    manager.lockfile.packages.items_name()[package_id as usize].slice(string_buf);
                let resolution = manager.lockfile.packages.items_resolution()[package_id as usize];

                let scope = manager.options.scope_for_package_name(package_name).clone();
                let mut expired = false;
                let Some(manifest) = manager.manifests.by_name_allow_expired(
                    cache_ctx,
                    &scope,
                    package_name,
                    Some(&mut expired),
                    ManifestLoad::LoadFromMemoryFallbackToDisk,
                    needs_extended,
                ) else {
                    continue;
                };

                let latest = manifest.find_by_dist_tag_with_filter(b"latest", min_age_ms, excludes);
                let Some(resolved_version) = manager.lockfile.resolve_catalog_dependency(dep)
                else {
                    continue;
                };
                let update = if resolved_version.tag == dependency::Tag::Npm {
                    manifest.find_best_version_with_filter(
                        &resolved_version.npm().version,
                        string_buf,
                        min_age_ms,
                        excludes,
                    )
                } else {
                    manifest.find_by_dist_tag_with_filter(
                        resolved_version.dist_tag().tag.slice(string_buf),
                        min_age_ms,
                        excludes,
                    )
                };

                // resolution.tag == Npm (verified in first pass).
                let current_version = resolution.npm().version;

                table.print_line_separator();

                {
                    // package name
                    let behavior_str: &str = if dep.behavior.is_dev() {
                        " (dev)"
                    } else if dep.behavior.is_peer() {
                        " (peer)"
                    } else if dep.behavior.is_optional() {
                        " (optional)"
                    } else {
                        ""
                    };

                    Output::pretty(format_args!("{}", symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    Output::pretty(format_args!(
                        "{}<d>{}<r>",
                        BStr::new(package_name),
                        behavior_str
                    ));
                    for _ in package_name.len() + behavior_str.len()
                        ..package_column_inside_length + COLUMN_RIGHT_PAD
                    {
                        Output::pretty(format_args!(" "));
                    }
                }

                {
                    // current version
                    Output::pretty(format_args!("{}", symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                    write!(version_buf, "{}", current_version.fmt(string_buf))
                        .expect("OOM writing version");
                    Output::pretty(format_args!("{}", version_buf));
                    for _ in version_buf.len()..current_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                }

                {
                    // update version
                    Output::pretty(format_args!("{}", symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    let update_filtered = update.latest_is_filtered();
                    if let Some(uv) = update.unwrap() {
                        write!(version_buf, "{}", uv.version.fmt(&manifest.string_buf))
                            .expect("OOM writing version");
                        Output::pretty(format_args!(
                            "{}",
                            uv.version
                                .diff_fmt(current_version, &manifest.string_buf, string_buf)
                        ));
                    } else {
                        write!(version_buf, "{}", current_version.fmt(string_buf))
                            .expect("OOM writing version");
                        Output::pretty(format_args!("<d>{}<r>", version_buf));
                    }
                    let mut update_version_len = version_buf.len();
                    if update_filtered {
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
                    Output::pretty(format_args!("{}", symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    let latest_filtered = latest.latest_is_filtered();
                    if let Some(lv) = latest.unwrap() {
                        write!(version_buf, "{}", lv.version.fmt(&manifest.string_buf))
                            .expect("OOM writing version");
                        Output::pretty(format_args!(
                            "{}",
                            lv.version
                                .diff_fmt(current_version, &manifest.string_buf, string_buf)
                        ));
                    } else {
                        write!(version_buf, "{}", current_version.fmt(string_buf))
                            .expect("OOM writing version");
                        Output::pretty(format_args!("<d>{}<r>", version_buf));
                    }
                    let mut latest_version_len = version_buf.len();
                    if latest_filtered {
                        Output::pretty(format_args!(" <blue>*<r>"));
                        latest_version_len += " *".len();
                    }
                    for _ in latest_version_len..latest_column_inside_length + COLUMN_RIGHT_PAD {
                        Output::pretty(format_args!(" "));
                    }
                    version_buf.clear();
                }

                if show_workspace_column {
                    Output::pretty(format_args!("{}", symbols.vertical_edge()));
                    for _ in 0..COLUMN_LEFT_PAD {
                        Output::pretty(format_args!(" "));
                    }

                    let workspace_name: &[u8] = if let Some(names) = &item.grouped_workspace_names {
                        names
                    } else {
                        manager.lockfile.packages.items_name()[item.workspace_pkg_id as usize]
                            .slice(string_buf)
                    };
                    Output::pretty(format_args!("{}", BStr::new(workspace_name)));

                    for _ in workspace_name.len()..workspace_column_inside_length + COLUMN_RIGHT_PAD
                    {
                        Output::pretty(format_args!(" "));
                    }
                }

                Output::pretty(format_args!("{}\n", symbols.vertical_edge()));
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

#[allow(dead_code)]
type _AssertImports = (
    package_manager::WorkspaceFilter,
    package_manager::ManifestCacheOptions<'static>,
    bun_install::package_manifest_map::CacheBehavior,
);

// ported from: src/cli/outdated_command.zig
