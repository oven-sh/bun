use core::fmt;

use bstr::BStr;

use bun_ast::Loc;
use bun_ast::{E, Expr};
use bun_collections::{StringHashMap, index_sort};
use bun_core::fmt::TerminalHyperlink;
use bun_core::strings;
use bun_core::{Global, Output};
use bun_install::dependency::{self, Behavior};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::package_manager::options::Do;
use bun_install::package_manager::workspace_manifests::{
    BrokenMember, DeclaredDependencies, is_outdated,
};
use bun_install::package_manager::{
    LogLevel, Subcommand, WorkspaceFilter, populate_manifest_cache,
    update_package_json_and_install_with_manager,
};
use bun_install::package_manager_real::command_line_arguments::UpdateGroups;
use bun_install::package_manager_real::package_json_editor::{
    catalog_object_of, updated_version_literal,
};
use bun_install::update_scope::selects;
use bun_install::{
    CommandLineArguments, GetJsonOptions, GetJsonResult, INVALID_PACKAGE_ID, PackageID,
    PackageManager, WorkspacePackageJsonCacheEntry, resolution,
};
use bun_install_types::DependencyGroup;
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::FileSystem;
use bun_semver::{self as semver, SlicedString};

use crate::Command;
use crate::cli::cli_dupe;
use crate::cli::outdated_command::{printed, printed_width};

pub(crate) struct UpdateInteractiveCommand;

struct OutdatedPackage {
    name: Box<[u8]>,
    current_version: Box<[u8]>,
    latest_version: Box<[u8]>,
    update_version: Box<[u8]>,
    /// True if `update_version` is in the range that package.json declares. If no version is in
    /// that range, this is false and `update_version` is the latest version.
    update_in_range: bool,
    workspace_pkg_id: PackageID,
    dependency_type: &'static [u8],
    workspace_name: Box<[u8]>,
    behavior: Behavior,
    use_latest: bool,
    /// A `latest` that is older than the installed version is shown, but no key or flag can select
    /// it, because `bun update` does not downgrade.
    latest_is_newer: bool,
    /// Both the default scope and the scope of `name` are the npm registry, so the name links to npmjs.org.
    uses_default_registry: bool,
    is_catalog: bool,
    catalog_name: Option<Box<[u8]>>,
}

impl OutdatedPackage {
    fn picks_latest(&self) -> bool {
        self.use_latest && self.latest_is_newer
    }

    fn target_version(&self) -> &[u8] {
        if self.picks_latest() {
            &self.latest_version
        } else {
            &self.update_version
        }
    }

    /// True if an install would pick the chosen version from the range package.json declares now.
    fn target_in_range(&self) -> bool {
        self.update_in_range && strings::eql(self.target_version(), &self.update_version)
    }

    fn checkbox_color(&self) -> CheckboxColor {
        use semver::version::ChangedVersion;
        let target = self.target_version();
        let (Some(current), Some(update)) =
            (min_of_valid(&self.current_version), min_of_valid(target))
        else {
            return CheckboxColor::Green;
        };
        match semver::Version::which_version_is_different(
            update,
            current,
            target,
            &self.current_version,
        ) {
            Some(ChangedVersion::Major) => CheckboxColor::Red,
            // 0.x.y minor changes and 0.0.x patch changes are breaking
            Some(ChangedVersion::Minor) if current.major == 0 => CheckboxColor::Red,
            Some(ChangedVersion::Minor) => CheckboxColor::Yellow,
            Some(ChangedVersion::Patch) if current.major == 0 && current.minor == 0 => {
                CheckboxColor::Red
            }
            _ => CheckboxColor::Green,
        }
    }

    /// `name` or `name:catalog`.
    fn catalog_key(&self) -> Vec<u8> {
        match &self.catalog_name {
            Some(catalog_name) => [&self.name[..], b":", &catalog_name[..]].concat(),
            None => self.name.to_vec(),
        }
    }

    /// " dev", " peer", " optional" or nothing, after the name.
    fn tag(&self) -> &'static str {
        if self.behavior.is_dev() {
            " dev"
        } else if self.behavior.is_peer() {
            " peer"
        } else if self.behavior.is_optional() {
            " optional"
        } else {
            ""
        }
    }
}

struct PackageUpdate {
    name: Box<[u8]>,
    target_version: Box<[u8]>,
    in_range: bool,
    dep_type: Box<[u8]>, // "dependencies", "devDependencies", etc.
    workspace_path: Box<[u8]>,
}

/// How risky an update looks from its semver distance.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CheckboxColor {
    Green,
    Yellow,
    Red,
}

struct ColumnWidths {
    name: usize,
    current: usize,
    target: usize,
    latest: usize,
    workspace: usize,
    show_workspace: bool,
}

struct MultiSelectState<'s> {
    packages: &'s mut [OutdatedPackage],
    selected: &'s mut [bool],
    cursor: usize,
    viewport_start: usize,
    viewport_height: usize,
    toggle_all: bool,
    columns: ColumnWidths,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct TerminalSize {
    height: usize,
    width: usize,
}

/// Hides the cursor and reports the mouse wheel until dropped.
struct MouseTracking;

impl MouseTracking {
    fn enable() -> MouseTracking {
        Output::print(format_args!("\x1b[?25l")); // hide cursor
        Output::print(format_args!("\x1b[?1000h")); // Enable basic mouse tracking
        Output::print(format_args!("\x1b[?1006h")); // Enable SGR extended mouse mode
        MouseTracking
    }
}

impl Drop for MouseTracking {
    fn drop(&mut self) {
        Output::print(format_args!("\x1b[?25h")); // show cursor
        Output::print(format_args!("\x1b[?1000l")); // Disable mouse tracking
        Output::print(format_args!("\x1b[?1006l")); // Disable SGR extended mouse mode
    }
}

impl UpdateInteractiveCommand {
    fn build_package_json_path<'b>(
        root_dir: &'b [u8],
        workspace_path: &[u8],
        path_buf: &'b mut PathBuffer,
    ) -> &'b [u8] {
        if !workspace_path.is_empty() {
            path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
                root_dir,
                path_buf,
                &[workspace_path, b"package.json"],
            )
        } else {
            path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
                root_dir,
                path_buf,
                &[b"package.json"],
            )
        }
    }

    fn save_package_json(
        package_json: &mut WorkspacePackageJsonCacheEntry,
        package_json_path: &[u8],
        log: &mut bun_ast::Log,
    ) -> crate::Result<()> {
        // The install reads this cache entry, not the file.
        if let Err(err) = package_json.save(package_json.root, log) {
            Output::err_generic("Failed to serialize package.json: {s}", (err.name(),));
            return Err(err.into());
        }

        let mut path_zbuf = bun_paths::path_buffer_pool::get();
        let path_z = path::resolve_path::z(package_json_path, &mut path_zbuf);
        if let Err(err) =
            bun_sys::File::write_file(bun_sys::Fd::cwd(), path_z, &package_json.source.contents)
        {
            Output::err_generic(
                "Failed to write package.json at {s}: {s}",
                (BStr::new(package_json_path), BStr::new(err.name())),
            );
            return Err(err.into());
        }
        Ok(())
    }

    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        bun_core::prettyln!(
            "<r><b>bun update --interactive <r><d>v{}<r>",
            Global::package_json_version_with_sha
        );
        Output::flush();

        // On a pipe the multi-select would block forever or select nothing at EOF. Tests that pipe keystrokes set the flag.
        if !Output::is_stdin_tty()
            && !bun_core::env_var::feature_flag::BUN_INTERNAL_INTERACTIVE_ASSUME_TTY
                .get()
                .unwrap_or(false)
        {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: <b>bun update --interactive<r> requires an interactive terminal."
            );
            bun_core::note!(
                "Use <cyan>bun update<r> to update non-interactively, or <cyan>bun outdated<r> to list available updates."
            );
            Output::flush();
            Global::exit(1);
        }

        let cli = CommandLineArguments::parse(Subcommand::Update)?;

        let (manager, original_cwd) = match PackageManager::init(ctx, &cli, Subcommand::Update) {
            Ok(v) => v,
            Err(err) => {
                if !cli.log_level.is_silent() {
                    if err == bun_install::Error::MissingPackageJSON {
                        Output::err_generic("missing package.json, nothing to update", ());
                    }
                    Output::err_generic("failed to initialize bun install: {s}", (err.name(),));
                }
                Global::crash();
            }
        };

        Self::update_interactive(ctx, &original_cwd, manager, cli.update_groups)
    }

    /// Returns `None` if the file can't be read or parsed. The error was already reported.
    fn load_package_json<'a>(
        manager: &'a mut PackageManager,
        package_json_path: &[u8],
        log: &mut bun_ast::Log,
    ) -> Option<&'a mut WorkspacePackageJsonCacheEntry> {
        match manager.workspace_package_json_cache.get_with_path(
            log,
            package_json_path,
            GetJsonOptions {
                guess_indentation: true,
                ..Default::default()
            },
        ) {
            GetJsonResult::ParseErr(err) => {
                Output::err_generic(
                    "Failed to parse package.json at {s}: {s}",
                    (BStr::new(package_json_path), err.name()),
                );
                None
            }
            GetJsonResult::ReadErr(err) => {
                Output::err_generic(
                    "Failed to read package.json at {s}: {s}",
                    (BStr::new(package_json_path), err.name()),
                );
                None
            }
            GetJsonResult::Entry(entry) => Some(entry),
        }
    }

    fn update_package_json_files_from_updates(
        manager: &mut PackageManager,
        updates: &[PackageUpdate],
    ) -> crate::Result<()> {
        // Workspace path -> indices into `updates`.
        let mut workspace_groups: StringHashMap<Vec<usize>> = StringHashMap::default();
        for (i, update) in updates.iter().enumerate() {
            workspace_groups
                .get_or_put(&update.workspace_path)?
                .value_ptr
                .push(i);
        }

        let bump = crate::cli::cli_arena();

        for (workspace_path, workspace_update_idxs) in workspace_groups.iter() {
            let root_dir = FileSystem::get().top_level_dir();
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let package_json_path =
                Self::build_package_json_path(root_dir, workspace_path, &mut path_buf);

            let log = manager.log_mut();
            let Some(package_json) = Self::load_package_json(manager, package_json_path, log)
            else {
                continue;
            };

            let mut modified = false;

            for &idx in workspace_update_idxs {
                let update = &updates[idx];
                if !package_json.root.is_object() {
                    continue;
                }
                let Some(section_query) = package_json.root.as_property(&update.dep_type) else {
                    continue;
                };
                let Some(mut dep_obj) = section_query.expr.data.e_object() else {
                    continue;
                };
                let Some(version_query) = section_query.expr.as_property(&update.name) else {
                    continue;
                };
                let Some(e_str) = version_query.expr.data.e_string() else {
                    continue;
                };
                let Some(version_with_prefix) = chosen_version_literal(
                    e_str.data.slice(),
                    &update.target_version,
                    update.in_range,
                ) else {
                    continue;
                };

                // Not `Expr::init`: a cached tree must not depend on the Store.
                let new_expr = Expr::allocate(
                    bump,
                    E::EString::init(cli_dupe(&version_with_prefix)),
                    version_query.expr.loc,
                );
                dep_obj.put(bump, &update.name, new_expr)?;
                modified = true;
            }

            if modified {
                Self::save_package_json(package_json, package_json_path, log)?;
            }
        }
        Ok(())
    }

    /// `catalog_updates` maps `name` or `name:catalog` to the new version and `target_in_range`.
    /// Catalogs are defined in the root package.json.
    fn update_catalog_definitions(
        manager: &mut PackageManager,
        catalog_updates: &StringHashMap<(Box<[u8]>, bool)>,
    ) -> crate::Result<()> {
        let root_dir = FileSystem::get().top_level_dir();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let package_json_path = Self::build_package_json_path(root_dir, b"", &mut path_buf);

        let log = manager.log_mut();
        let Some(package_json) = Self::load_package_json(manager, package_json_path, log) else {
            return Ok(());
        };

        for (catalog_key, (new_version, in_range)) in catalog_updates.iter() {
            let (package_name, catalog_name) = match bun_core::index_of(catalog_key, b":") {
                Some(colon) => (&catalog_key[..colon], &catalog_key[colon + 1..]),
                None => (&catalog_key[..], &b""[..]),
            };
            update_catalog(
                &package_json.root,
                catalog_name,
                package_name,
                new_version,
                *in_range,
            )?;
        }

        Self::save_package_json(package_json, package_json_path, log)
    }

    fn update_interactive(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
        groups: UpdateGroups,
    ) -> crate::Result<()> {
        let not_silent = manager.options.log_level != LogLevel::Silent;
        manager.load_lockfile_from_cwd_or_exit("nothing to update");

        let workspace_pkg_ids: Vec<PackageID> =
            if !manager.options.filter_patterns.is_empty() || manager.options.do_.recursive() {
                WorkspaceFilter::select_workspaces(
                    &manager.lockfile,
                    manager.options.filter_patterns,
                    original_cwd,
                )
            } else {
                let root_pkg_id = manager
                    .root_package_id
                    .get(&manager.lockfile, manager.workspace_name_hash);
                if root_pkg_id == INVALID_PACKAGE_ID {
                    return Ok(());
                }
                vec![root_pkg_id]
            };

        populate_manifest_cache::populate_manifest_cache(
            manager,
            populate_manifest_cache::Packages::Ids(&workspace_pkg_ids),
        )?;
        if populate_manifest_cache::print_fetch_failures(manager)? {
            Global::crash();
        }

        let (mut outdated_packages, checked) =
            Self::get_outdated_packages(manager, &workspace_pkg_ids, groups)?;

        if outdated_packages.is_empty() {
            if not_silent {
                bun_core::pretty!(
                    "\nChecked <green>{}<r> dependenc{}, ",
                    checked,
                    if checked == 1 { "y" } else { "ies" }
                );
                if groups.is_default() {
                    bun_core::pretty!("nothing to update ");
                } else {
                    bun_core::pretty!(
                        "none selected by {} <d>(no changes)<r> ",
                        GroupFlags(groups)
                    );
                }
                Output::print_start_end_stdout(ctx.start_time, bun_core::time::nano_timestamp());
                bun_core::pretty!("\n");
                Output::flush();
            }
            return Ok(());
        }

        let selected = Self::prompt_for_updates(&mut outdated_packages);

        // Maps `OutdatedPackage::catalog_key` to the new version and its `target_in_range`.
        let mut catalog_updates: StringHashMap<(Box<[u8]>, bool)> = StringHashMap::default();
        let mut package_updates: Vec<PackageUpdate> = Vec::new();

        // Becomes `options.positionals` so the install runs as `bun update <selected...>`.
        let mut positionals: Vec<&'static [u8]> = vec![&b"update"[..]];

        let mut dry_run_rows: Vec<DryRunRow> = Vec::new();

        debug_assert_eq!(outdated_packages.len(), selected.len());
        for (pkg, &is_selected) in outdated_packages.iter().zip(selected.iter()) {
            if !is_selected {
                continue;
            }

            let target_version = pkg.target_version();
            if strings::eql(&pkg.current_version, target_version) {
                continue;
            }

            if !positionals[1..]
                .iter()
                .any(|name| strings::eql(name, &pkg.name))
            {
                positionals.push(cli_dupe(&pkg.name));
            }

            if manager.options.dry_run {
                dry_run_rows.push((
                    pkg.name.clone(),
                    pkg.current_version.clone(),
                    Box::from(target_version),
                ));
            }

            if pkg.is_catalog {
                catalog_updates.put_assume_capacity(
                    &pkg.catalog_key(),
                    (Box::from(target_version), pkg.target_in_range()),
                );
                continue;
            }

            let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
            let workspace_resolution =
                manager.lockfile.packages.items_resolution()[pkg.workspace_pkg_id as usize];
            let workspace_path: &[u8] = if workspace_resolution.tag == resolution::Tag::Workspace {
                workspace_resolution.workspace().slice(string_buf)
            } else {
                b"" // Root workspace
            };

            package_updates.push(PackageUpdate {
                name: pkg.name.clone(),
                target_version: Box::from(target_version),
                in_range: pkg.target_in_range(),
                dep_type: Box::from(pkg.dependency_type),
                workspace_path: Box::from(workspace_path),
            });
        }

        if package_updates.is_empty() && catalog_updates.is_empty() {
            bun_core::prettyln!("<r><yellow>!</r> No packages selected for update");
            return Ok(());
        }

        if manager.options.dry_run {
            if not_silent {
                print_dry_run_rows(&mut dry_run_rows, ctx.start_time);
            }
            return Ok(());
        }

        bun_core::prettyln!("\n<r><cyan>Installing updates...<r>");
        Output::flush();

        if !catalog_updates.is_empty() {
            Self::update_catalog_definitions(manager, &catalog_updates)?;
        }
        if !package_updates.is_empty() {
            Self::update_package_json_files_from_updates(manager, &package_updates)?;
        }

        // Show the install time instead of the total command time
        ctx.start_time = bun_core::time::nano_timestamp();

        // package.json already resolves to the chosen versions. With `--latest` still set, the
        // install would re-pin every selection to `latest` and ignore the per-package `l` toggles.
        manager.options.do_.remove(Do::UPDATE_TO_LATEST);
        manager.options.positionals = crate::cli::cli_arena().alloc_slice_copy(&positionals);
        update_package_json_and_install_with_manager(manager, &mut *ctx, original_cwd)?;
        Ok(())
    }

    /// One row per catalog entry, with the workspaces that use it in `workspace_name`.
    fn group_catalog_dependencies(
        packages: Vec<OutdatedPackage>,
    ) -> crate::Result<Vec<OutdatedPackage>> {
        let mut catalog_map: StringHashMap<Vec<OutdatedPackage>> = StringHashMap::default();
        let mut result: Vec<OutdatedPackage> = Vec::new();

        for pkg in packages {
            if pkg.is_catalog {
                catalog_map
                    .get_or_put(&pkg.catalog_key())?
                    .value_ptr
                    .push(pkg);
            } else {
                result.push(pkg);
            }
        }

        for (_, catalog_packages) in catalog_map.drain() {
            let mut catalog_packages = catalog_packages.into_iter();
            let Some(mut first) = catalog_packages.next() else {
                continue;
            };

            let mut workspace_names: Vec<u8> = b"catalog".to_vec();
            if let Some(catalog_name) = &first.catalog_name {
                workspace_names.push(b':');
                workspace_names.extend_from_slice(catalog_name);
            }
            workspace_names.extend_from_slice(b" (");
            workspace_names.extend_from_slice(&first.workspace_name);
            for cat_pkg in catalog_packages {
                workspace_names.extend_from_slice(b", ");
                workspace_names.extend_from_slice(&cat_pkg.workspace_name);
            }
            workspace_names.push(b')');

            first.workspace_name = workspace_names.into_boxed_slice();
            result.push(first);
        }

        Ok(result)
    }

    fn get_outdated_packages(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        groups: UpdateGroups,
    ) -> crate::Result<(Vec<OutdatedPackage>, usize)> {
        // By value, so that the loop body holds only disjoint borrows of `manager`.
        let cache_ctx = manager.manifest_disk_cache_ctx();
        let min_age_ms = manager.options.minimum_release_age_ms;
        let needs_extended = min_age_ms.is_some();
        let excludes = manager.options.minimum_release_age_excludes;
        let update_to_latest = manager.options.do_.update_to_latest();
        let default_url_hash = *bun_install::npm::Registry::DEFAULT_URL_HASH;
        let global_uses_default_registry = manager.options.scope.url_hash == default_url_hash;

        let mut outdated_packages: Vec<OutdatedPackage> = Vec::new();

        let declared = DeclaredDependencies::load(manager, workspace_pkg_ids, BrokenMember::Fatal);
        let checked = declared.rows().len();

        for row in declared.rows() {
            let workspace_pkg_id = row.workspace_pkg_id;
            let package_id = row.package_id;
            let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
            let json_buf = declared.string_bytes();
            let dep = declared.dependency(row);
            if !selects(groups, dep.behavior) {
                continue;
            }
            let resolution = manager.lockfile.packages.items_resolution()[package_id as usize];

            let name_slice = dep.name.slice(json_buf);
            let package_name =
                manager.lockfile.packages.items_name()[package_id as usize].slice(string_buf);

            let scope = manager.options.scope_for_package_name(package_name).clone();
            let uses_default_registry = global_uses_default_registry
                && manager.options.scope_for_package_name(name_slice).url_hash == default_url_hash;
            let mut expired = false;
            let Some(manifest) = manager.manifests.by_name_allow_expired(
                cache_ctx,
                &scope,
                package_name,
                Some(&mut expired),
                needs_extended,
            ) else {
                continue;
            };

            let Some(latest) = manifest.find_latest(min_age_ms, excludes).unwrap() else {
                continue;
            };

            // "Target" is the newest version in range.
            let in_range = declared
                .find_update(row, manifest, min_age_ms, excludes)
                .unwrap();
            let update_version = in_range.unwrap_or(latest);

            // A package whose range is exhausted is still listed when `latest` is newer.
            let current_ver = resolution.npm().version;
            if !is_outdated(current_ver, string_buf, in_range, latest, manifest) {
                continue;
            }

            let boxed = |version: semver::Version, buf: &[u8]| -> Box<[u8]> {
                version.fmt(buf).to_string().into_bytes().into_boxed_slice()
            };

            // The root is not shown as a workspace.
            let workspace_resolution =
                manager.lockfile.packages.items_resolution()[workspace_pkg_id as usize];
            let workspace_name: &[u8] = if workspace_resolution.tag == resolution::Tag::Workspace {
                manager.lockfile.packages.items_name()[workspace_pkg_id as usize].slice(string_buf)
            } else {
                b""
            };

            let is_catalog = dep.version.tag == dependency::Tag::Catalog;
            let catalog_name: Option<Box<[u8]>> = is_catalog
                .then(|| dep.version.catalog().slice(json_buf))
                .filter(|name| !name.is_empty())
                .map(Box::from);

            outdated_packages.push(OutdatedPackage {
                name: Box::from(name_slice),
                current_version: boxed(current_ver, string_buf),
                latest_version: boxed(latest.version, &manifest.string_buf),
                update_version: boxed(update_version.version, &manifest.string_buf),
                update_in_range: in_range.is_some(),
                workspace_pkg_id,
                dependency_type: DependencyGroup::prop_for_behavior(dep.behavior),
                workspace_name: Box::from(workspace_name),
                behavior: dep.behavior,
                uses_default_registry,
                is_catalog,
                catalog_name,
                use_latest: update_to_latest, // default to --latest flag value
                latest_is_newer: latest.is_newer_than(manifest, current_ver, string_buf),
            });
        }

        let mut grouped_result = Self::group_catalog_dependencies(outdated_packages)?;

        index_sort::sort_slice_by(&mut grouped_result, |a, b| {
            dep_type_priority(a.dependency_type)
                .cmp(&dep_type_priority(b.dependency_type))
                .then_with(|| strings::order(&a.name, &b.name))
                .then_with(|| {
                    strings::order(
                        a.catalog_name.as_deref().unwrap_or(b""),
                        b.catalog_name.as_deref().unwrap_or(b""),
                    )
                })
        });

        Ok((grouped_result, checked))
    }

    fn calculate_column_widths(packages: &[OutdatedPackage]) -> ColumnWidths {
        let mut widths = ColumnWidths {
            name: b"Package".len(),
            current: b"Current".len(),
            target: b"Target".len(),
            latest: b"Latest".len(),
            workspace: b"Workspace".len(),
            show_workspace: false,
        };

        for pkg in packages {
            widths.name = widths
                .name
                .max(printed_width(&printed(&pkg.name)) + pkg.tag().len());
            widths.current = widths.current.max(pkg.current_version.len());
            widths.target = widths.target.max(pkg.update_version.len());
            widths.latest = widths.latest.max(pkg.latest_version.len());
            widths.workspace = widths
                .workspace
                .max(printed_width(&printed(&pkg.workspace_name)));
            widths.show_workspace |= !pkg.workspace_name.is_empty();
        }

        let terminal_width = Self::get_terminal_size().width;
        let (max_name, max_version, max_workspace) = match terminal_width {
            ..60 => (12, 7, usize::MAX),
            60..80 => (20, 10, usize::MAX),
            80..120 => (35, 15, 15),
            120..160 => (45, 20, 20),
            _ => (usize::MAX, usize::MAX, usize::MAX),
        };
        widths.name = widths.name.min(max_name);
        widths.current = widths.current.min(max_version);
        widths.target = widths.target.min(max_version);
        widths.latest = widths.latest.min(max_version);
        widths.workspace = widths.workspace.min(max_workspace);
        widths.show_workspace &= terminal_width >= 100;
        widths
    }

    /// Returns the size of the whole terminal. `viewport_height` says how many package rows fit in
    /// it.
    fn get_terminal_size() -> TerminalSize {
        #[cfg(unix)]
        {
            if let Some(size) = bun_core::output::File::from(bun_core::Fd::stdout()).winsize()
                && size.row > 0
                && size.col > 0
            {
                return TerminalSize {
                    height: size.row as usize,
                    width: size.col as usize,
                };
            }
        }
        #[cfg(windows)]
        {
            use bun_sys::windows;
            if let Some(handle) = windows::GetStdHandle(windows::STD_OUTPUT_HANDLE) {
                // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
                let mut csbi: windows::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
                // SAFETY: handle is valid; csbi is a valid out-ptr.
                if unsafe { windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi) }
                    != windows::FALSE
                {
                    let width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                    let height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
                    if width > 0 && height > 0 {
                        return TerminalSize {
                            height: usize::try_from(height).expect("int cast"),
                            width: usize::try_from(width).expect("int cast"),
                        };
                    }
                }
            }
        }
        TerminalSize {
            height: 24,
            width: 80,
        } // Default fallback
    }

    /// A frame that's taller than the screen can't be redrawn in place, because cursor-up stops at
    /// the top.
    fn viewport_height(terminal_rows: usize, packages: &[OutdatedPackage]) -> usize {
        let groups = packages
            .chunk_by(|a, b| a.dependency_type == b.dependency_type)
            .count();
        terminal_rows.saturating_sub(2 * groups + 3).max(1)
    }

    /// `text` as a cell of at most `max_width` terminal columns prints it.
    fn truncate_with_ellipsis(text: &[u8], max_width: usize, only_end: bool) -> String {
        use strings::visible::width::exclude_ansi_colors::utf8_index_at_width;

        let text = printed(text);
        if printed_width(&text) <= max_width {
            return text;
        }

        if max_width <= 3 {
            return "…".to_owned();
        }

        // Put ellipsis in the middle to show both start and end of package name
        let available_width = max_width - 1; // Reserve 1 column for ellipsis
        let start_width = if only_end {
            available_width
        } else {
            available_width / 2
        };
        let end_width = available_width - start_width;

        let (start, rest) = text.split_at(utf8_index_at_width(text.as_bytes(), start_width));
        let excess = printed_width(rest).saturating_sub(end_width);
        let mut cut = utf8_index_at_width(rest.as_bytes(), excess);
        if printed_width(&rest[..cut]) < excess {
            // A 2-column character straddles the cut.
            cut = utf8_index_at_width(rest.as_bytes(), excess + 1);
        }

        [start, "…", &rest[cut..]].concat()
    }

    /// Prints `version`, coloured by its distance from `current` unless it is truncated. Returns the width printed.
    fn print_version(version: &[u8], current: &[u8], max_width: usize, underline: bool) -> usize {
        let truncated = Self::truncate_with_ellipsis(version, max_width, false);
        if underline {
            Output::print(format_args!("\x1B[4m"));
        }
        match (min_of_valid(version), min_of_valid(current)) {
            (Some(full), Some(current_full)) if truncated.as_bytes() == version => {
                bun_core::pretty!("{}", full.diff_fmt(current_full, version, current));
            }
            _ => bun_core::pretty!("<r>{}<r>", truncated),
        }
        if underline {
            Output::print(format_args!("\x1B[24m"));
        }
        printed_width(&truncated)
    }

    /// `packages` is not empty.
    fn prompt_for_updates(packages: &mut [OutdatedPackage]) -> Box<[bool]> {
        let mut selected = vec![false; packages.len()].into_boxed_slice();
        let columns = Self::calculate_column_widths(packages);
        let terminal_size = Self::get_terminal_size();
        let viewport_height = Self::viewport_height(terminal_size.height, packages);
        let mut state = MultiSelectState {
            packages,
            selected: &mut selected,
            cursor: 0,
            viewport_start: 0,
            viewport_height,
            toggle_all: false,
            columns,
        };

        // Raw mode until dropped.
        #[cfg(windows)]
        let _restore =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                    | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
            });

        #[cfg(unix)]
        let _restore = bun_core::tty::RawModeGuard::new(0);

        if !Self::process_multi_select(&mut state, terminal_size) {
            Output::flush();
            bun_core::prettyln!("\n<r><red>x<r> Cancelled");
            Global::exit(0);
        }

        Output::flush();
        selected
    }

    /// After the wheel moved the viewport.
    fn ensure_cursor_in_viewport(state: &mut MultiSelectState<'_>) {
        let viewport_end = state.viewport_start + state.viewport_height;
        if state.cursor < state.viewport_start {
            state.cursor = state.viewport_start;
        } else if state.cursor >= viewport_end {
            state.cursor = (viewport_end - 1).min(state.packages.len() - 1);
        }
    }

    /// Call after the cursor moves. Keeps it visible, with 2 rows below it and 1 above it where
    /// they fit.
    fn update_viewport(state: &mut MultiSelectState<'_>) {
        let context_below: usize = 2;
        // A 1-row viewport has no room above the cursor.
        let context_above: usize = 1usize.min(state.viewport_height - 1);
        let max_start = state.packages.len().saturating_sub(state.viewport_height);

        if state.cursor >= state.viewport_start + state.viewport_height {
            let desired_start = if state.cursor + context_below + 1 > state.packages.len() {
                max_start
            } else if state.viewport_height > context_below
                && state.cursor > state.viewport_height - context_below
            {
                state.cursor - (state.viewport_height - context_below)
            } else {
                // The viewport is shorter than the context, so put the cursor on the last visible
                // row.
                state.cursor.saturating_sub(state.viewport_height - 1)
            };

            // Aligning the bottom of a 1-row viewport would scroll past the cursor.
            state.viewport_start = desired_start.min(state.cursor);
        } else if state.cursor < state.viewport_start + context_above && state.viewport_start > 0 {
            state.viewport_start = state.cursor.saturating_sub(context_above);
        } else if state.viewport_height > context_below
            && state.cursor > state.viewport_start + state.viewport_height - context_below
        {
            let desired_start = state.cursor - (state.viewport_height - context_below);
            state.viewport_start = desired_start.min(max_start);
        }
    }

    /// Returns false if the user cancelled.
    fn process_multi_select(
        state: &mut MultiSelectState<'_>,
        initial_terminal_size: TerminalSize,
    ) -> bool {
        let colors = Output::enable_ansi_colors_stdout();

        // Clear any previous progress output
        Output::print(format_args!("\r\x1B[2K")); // Clear entire line
        Output::print(format_args!("\x1B[1A\x1B[2K")); // Move up one line and clear it too
        Output::flush();

        let _mouse_tracking = colors.then(MouseTracking::enable);

        let mut initial_draw = true;
        let mut total_lines: usize = 0;
        let mut last_terminal_size = initial_terminal_size;
        let mut needs_redraw = true;

        loop {
            let current_size = Self::get_terminal_size();
            if current_size != last_terminal_size {
                state.viewport_height = Self::viewport_height(current_size.height, state.packages);
                state.columns = Self::calculate_column_widths(state.packages);
                state.columns.show_workspace &= current_size.width > 100;
                last_terminal_size = current_size;
                Self::update_viewport(state);
                // Redraw in place, because a new frame below the old one would duplicate it.
                needs_redraw = true;
            }

            if needs_redraw {
                let synchronized = Output::synchronized();

                if !initial_draw {
                    Output::up(total_lines);
                    Output::print(format_args!("\x1B[1G"));
                    Output::clear_to_end();
                }
                initial_draw = false;

                let help_text: &[u8] = b"Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest";
                let elipsised_help_text = Self::truncate_with_ellipsis(
                    help_text,
                    current_size
                        .width
                        .saturating_sub(b"? Select packages to update - ".len()),
                    true,
                );
                bun_core::prettyln!(
                    "<r><cyan>?<r> Select packages to update<d> - {}<r>",
                    elipsised_help_text
                );

                let columns = &state.columns;
                let needs_scrolling = state.packages.len() > state.viewport_height;
                let viewport_end =
                    (state.viewport_start + state.viewport_height).min(state.packages.len());

                if needs_scrolling && state.viewport_start > 0 {
                    bun_core::pretty!(
                        "  <d>↑ {} more package{} above<r>",
                        state.viewport_start,
                        if state.viewport_start == 1 { "" } else { "s" }
                    );
                }

                let mut current_dep_type: Option<&'static [u8]> = None;

                // Headers take 2 lines
                let mut lines_displayed: usize = 0;

                for i in state.viewport_start..viewport_end {
                    let pkg = &state.packages[i];
                    let selected = state.selected[i];

                    if current_dep_type != Some(pkg.dependency_type) {
                        debug_assert_eq!(state.packages.len(), state.selected.len());
                        let selected_count = (state.packages.iter().zip(state.selected.iter()))
                            .filter(|(p, sel)| p.dependency_type == pkg.dependency_type && **sel)
                            .count();

                        Output::print(format_args!("\n  "));
                        if selected_count > 0 {
                            bun_core::pretty!(
                                "<r><b>{} {}<r>",
                                BStr::new(pkg.dependency_type),
                                selected_count
                            );
                        } else {
                            bun_core::pretty!("<r>{}<r>", BStr::new(pkg.dependency_type));
                        }

                        let dep_type_text_len: usize = if selected_count > 0 {
                            pkg.dependency_type.len()
                                + 1
                                + bun_core::fmt::digit_count(selected_count) // +1 for space
                        } else {
                            pkg.dependency_type.len()
                        };

                        // Names start after "    " and "□ " and are followed by 2 spaces. The
                        // header starts after "  ".
                        let total_offset = 6 + columns.name + 2;
                        let header_start = 2 + dep_type_text_len;
                        print_spaces(total_offset.saturating_sub(header_start).max(1));

                        Output::print(format_args!("Current"));
                        print_spaces(columns.current - b"Current".len() + 2);
                        Output::print(format_args!("Target"));
                        print_spaces(columns.target - b"Target".len() + 2);
                        Output::print(format_args!("Latest"));
                        if columns.show_workspace {
                            print_spaces(columns.latest - b"Latest".len() + 2);
                            Output::print(format_args!("Workspace"));
                        }
                        Output::print(format_args!("\x1B[0K\n"));

                        lines_displayed += 2;
                        current_dep_type = Some(pkg.dependency_type);
                    }

                    let checkbox: &str = if selected { "■" } else { "□" };
                    let tag = pkg.tag();
                    let color = selected.then(|| pkg.checkbox_color());

                    if i == state.cursor {
                        bun_core::pretty!("  <r><cyan>❯<r> ");
                    } else {
                        Output::print(format_args!("    "));
                    }

                    match color {
                        Some(CheckboxColor::Red) => bun_core::pretty!("<r><red>{}<r> ", checkbox),
                        Some(CheckboxColor::Yellow) => {
                            bun_core::pretty!("<r><yellow>{}<r> ", checkbox)
                        }
                        Some(CheckboxColor::Green) => {
                            bun_core::pretty!("<r><green>{}<r> ", checkbox)
                        }
                        None => Output::print(format_args!("{} ", checkbox)),
                    }

                    let available_name_width = if columns.name > tag.len() {
                        columns.name - tag.len()
                    } else {
                        columns.name
                    };
                    let display_name =
                        Self::truncate_with_ellipsis(&pkg.name, available_name_width, false);
                    let name_padding = columns
                        .name
                        .saturating_sub(printed_width(&display_name) + tag.len());

                    let package_url =
                        if Output::enable_ansi_colors_stdout() && pkg.uses_default_registry {
                            let ver: &[u8] = if selected {
                                pkg.target_version()
                            } else {
                                &pkg.current_version
                            };
                            format!(
                                "https://npmjs.org/package/{}/v/{}",
                                BStr::new(&pkg.name),
                                BStr::new(ver)
                            )
                        } else {
                            String::new()
                        };
                    let hyperlink = TerminalHyperlink::new(
                        package_url.as_bytes(),
                        display_name.as_bytes(),
                        !package_url.is_empty(),
                    );

                    match color {
                        Some(CheckboxColor::Red) => bun_core::pretty!("<r><red>{}<r>", hyperlink),
                        Some(CheckboxColor::Yellow) => {
                            bun_core::pretty!("<r><yellow>{}<r>", hyperlink)
                        }
                        Some(CheckboxColor::Green) => {
                            bun_core::pretty!("<r><green>{}<r>", hyperlink)
                        }
                        None => bun_core::pretty!("<r>{}<r>", hyperlink),
                    }

                    if !tag.is_empty() {
                        bun_core::pretty!("<r><d>{}<r>", tag);
                    }
                    print_spaces(name_padding + 2);

                    let truncated_current =
                        Self::truncate_with_ellipsis(&pkg.current_version, columns.current, false);
                    bun_core::pretty!("<r>{}<r>", truncated_current);
                    print_spaces(
                        columns
                            .current
                            .saturating_sub(printed_width(&truncated_current))
                            + 2,
                    );

                    // The chosen version is underlined.
                    let target_width = Self::print_version(
                        &pkg.update_version,
                        &pkg.current_version,
                        columns.target,
                        selected && !pkg.picks_latest(),
                    );
                    print_spaces(columns.target.saturating_sub(target_width) + 2);

                    let is_same_as_target = pkg.latest_version == pkg.update_version;
                    if is_same_as_target {
                        Output::print(format_args!("\x1B[2m")); // Dim
                    }
                    let latest_width = Self::print_version(
                        &pkg.latest_version,
                        &pkg.current_version,
                        columns.latest,
                        selected && pkg.picks_latest(),
                    );
                    if is_same_as_target {
                        Output::print(format_args!("\x1B[22m")); // Reset dim
                    }

                    if columns.show_workspace {
                        print_spaces(columns.latest.saturating_sub(latest_width) + 2);
                        let truncated_workspace = Self::truncate_with_ellipsis(
                            &pkg.workspace_name,
                            columns.workspace,
                            true,
                        );
                        bun_core::pretty!("<r><d>{}<r>", truncated_workspace);
                    }

                    Output::print(format_args!("\x1B[0K\n"));
                    lines_displayed += 1;
                }

                if needs_scrolling && viewport_end < state.packages.len() {
                    bun_core::pretty!(
                        "  <d>↓ {} more package{} below<r>\x1B[0K\n",
                        state.packages.len() - viewport_end,
                        if state.packages.len() - viewport_end == 1 {
                            ""
                        } else {
                            "s"
                        }
                    );
                    lines_displayed += 1;
                }

                total_lines = lines_displayed + 1;
                Output::clear_to_end();
                synchronized.end();
            }
            Output::flush();

            let mut reader = bun_core::output::stdin_reader();
            // The end of the input confirms, like Enter.
            let byte = reader.take_byte().unwrap_or(b'\n');
            needs_redraw = true;
            let last = state.packages.len() - 1;

            match byte {
                // Enter confirms. Ctrl+C and Ctrl+D cancel.
                b'\n' | b'\r' | 3 | 4 => {
                    Output::up(total_lines);
                    Output::print(format_args!("\x1B[1G"));
                    Output::clear_to_end();
                    let confirmed = byte != 3 && byte != 4;
                    if confirmed {
                        let count = state.selected.iter().filter(|sel| **sel).count();
                        bun_core::prettyln!(
                            "<r><green>✓<r> Selected {} package{} to update",
                            count,
                            if count == 1 { "" } else { "s" }
                        );
                    }
                    return confirmed;
                }
                b' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    // Nothing newer is in range, so selecting it means `latest`.
                    let pkg = &mut state.packages[state.cursor];
                    if pkg.current_version == pkg.update_version {
                        pkg.use_latest = true;
                    }
                    state.toggle_all = false;
                }
                b'a' | b'A' => {
                    state.selected.fill(true);
                    // Same as for the space bar.
                    for pkg in state.packages.iter_mut() {
                        if pkg.current_version == pkg.update_version {
                            pkg.use_latest = true;
                        }
                    }
                    state.toggle_all = true;
                }
                b'n' | b'N' => {
                    state.selected.fill(false);
                    state.toggle_all = false;
                }
                b'i' | b'I' => {
                    for sel in state.selected.iter_mut() {
                        *sel = !*sel;
                    }
                    state.toggle_all = false;
                }
                b'l' | b'L' => {
                    let new_latest_state = !state.packages[state.cursor].use_latest;
                    // Right after 'a': every selected package. Otherwise the one under the cursor, which it selects.
                    if state.toggle_all {
                        debug_assert_eq!(state.selected.len(), state.packages.len());
                        for (sel, pkg) in state.selected.iter().zip(state.packages.iter_mut()) {
                            if *sel {
                                pkg.use_latest = new_latest_state;
                            }
                        }
                    } else {
                        state.packages[state.cursor].use_latest = new_latest_state;
                        state.selected[state.cursor] = true;
                    }
                }
                b'j' => {
                    state.cursor = (state.cursor + 1) % state.packages.len();
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                b'k' => {
                    state.cursor = state.cursor.checked_sub(1).unwrap_or(last);
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                27 => {
                    // escape sequence
                    let Ok(seq) = reader.take_byte() else {
                        continue;
                    };
                    if seq == b'[' {
                        let Ok(arrow) = reader.take_byte() else {
                            continue;
                        };
                        match arrow {
                            // up arrow
                            b'A' => {
                                state.cursor = state.cursor.checked_sub(1).unwrap_or(last);
                                Self::update_viewport(state);
                            }
                            // down arrow
                            b'B' => {
                                state.cursor = (state.cursor + 1) % state.packages.len();
                                Self::update_viewport(state);
                            }
                            // The right arrow selects Latest, and the left arrow selects Target.
                            b'C' | b'D' => {
                                state.packages[state.cursor].use_latest = arrow == b'C';
                                state.selected[state.cursor] = true;
                            }
                            // Page Up, Page Down
                            b'5' | b'6' => {
                                let Ok(tilde) = reader.take_byte() else {
                                    continue;
                                };
                                if tilde == b'~' {
                                    state.cursor = if arrow == b'5' {
                                        state.cursor.saturating_sub(state.viewport_height)
                                    } else {
                                        (state.cursor + state.viewport_height).min(last)
                                    };
                                    Self::update_viewport(state);
                                }
                            }
                            b'<' => {
                                // SGR extended mouse mode
                                // Read until 'M' or 'm' for button press/release
                                let mut buffer = [0u8; 32];
                                let mut buf_idx: usize = 0;
                                while buf_idx < buffer.len() {
                                    let Ok(c) = reader.take_byte() else { break };
                                    if c == b'M' || c == b'm' {
                                        // Parse SGR mouse event: ESC[<button;col;row(M or m)
                                        // button: 64 = scroll up, 65 = scroll down
                                        let mut parts =
                                            strings::tokenize(&buffer[0..buf_idx], b";");
                                        if let Some(button_str) = parts.next() {
                                            let button: u32 =
                                                strings::parse_int(button_str, 10).unwrap_or(0);
                                            if button == 64 {
                                                if state.viewport_start > 0 {
                                                    state.viewport_start -= 1;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
                                            } else if button == 65 {
                                                if state.viewport_start + state.viewport_height
                                                    < state.packages.len()
                                                {
                                                    state.viewport_start += 1;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
                                            } else {
                                                // A click changes nothing.
                                                needs_redraw = false;
                                            }
                                        }
                                        break;
                                    }
                                    buffer[buf_idx] = c;
                                    buf_idx += 1;
                                }
                            }
                            _ => {}
                        }
                    }
                    state.toggle_all = false;
                }
                _ => {
                    state.toggle_all = false;
                }
            }
        }
    }
}

/// (name, from, to)
type DryRunRow = (Box<[u8]>, Box<[u8]>, Box<[u8]>);

fn print_dry_run_rows(rows: &mut Vec<DryRunRow>, start_time: i128) {
    index_sort::sort_vec_unstable_by(rows, |a, b| a.cmp(b));
    rows.dedup();
    let (glyph, arrow) = if Output::enable_ansi_colors_stdout() {
        ("↑", "→")
    } else {
        ("^", "->")
    };
    bun_core::pretty!("\n");
    for (name, from, to) in rows.iter() {
        bun_core::prettyln!(
            "<cyan>{}<r> <b>{}<r> <d>{} {}<r> <b><cyan>{}<r>",
            glyph,
            BStr::new(name),
            BStr::new(from),
            arrow,
            BStr::new(to)
        );
    }
    let n = rows.len();
    bun_core::pretty!(
        "\n<green>{}<r> package{} would be updated ",
        n,
        if n == 1 { "" } else { "s" }
    );
    Output::print_start_end_stdout(start_time, bun_core::time::nano_timestamp());
    bun_core::pretty!("\n");
    Output::flush();
}

struct GroupFlags(UpdateGroups);

impl fmt::Display for GroupFlags {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut first = true;
        for (set, flag) in [
            (self.0.dev, "--dev"),
            (self.0.prod, "--prod"),
            (self.0.no_optional, "--no-optional"),
        ] {
            if !set {
                continue;
            }
            if !first {
                f.write_str(" ")?;
            }
            first = false;
            f.write_str(flag)?;
        }
        Ok(())
    }
}

fn print_spaces(count: usize) {
    Output::print(format_args!("{:count$}", ""));
}

fn min_of_valid(version: &[u8]) -> Option<semver::Version> {
    let parsed = semver::Version::parse(SlicedString::init(version, version));
    parsed.valid.then(|| parsed.version.min())
}

fn dep_type_priority(dep_type: &[u8]) -> u8 {
    match DependencyGroup::from_prop(dep_type) {
        Some(g) if g.behavior == Behavior::PROD => 0,
        Some(g) if g.behavior == Behavior::DEV => 1,
        Some(g) if g.behavior == Behavior::PEER => 2,
        Some(g) if g.behavior == Behavior::OPTIONAL => 3,
        _ => 4,
    }
}

/// Rewrites the catalog entry that the row was read from. The new node is allocated in the CLI
/// arena, because a cached tree must not depend on the Store.
fn update_catalog(
    package_json: &Expr,
    catalog_name: &[u8],
    package_name: &[u8],
    new_version: &[u8],
    in_range: bool,
) -> crate::Result<()> {
    let Some(mut catalog) = catalog_object_of(package_json, catalog_name, package_name) else {
        return Ok(());
    };
    let Some(literal) = (*catalog)
        .get(package_name)
        .and_then(|declared| declared.data.e_string())
        .and_then(|declared| chosen_version_literal(declared.data.slice(), new_version, in_range))
    else {
        return Ok(());
    };
    let bump = crate::cli::cli_arena();
    let literal = Expr::allocate(bump, E::EString::init(cli_dupe(&literal)), Loc::EMPTY);
    catalog.put(bump, package_name, literal)?;
    Ok(())
}

/// Returns what `bun update` would write in place of `declared`, or what `bun update --latest`
/// would write if `chosen` is not `in_range`. `None` means `declared` is kept as written.
fn chosen_version_literal(declared: &[u8], chosen: &[u8], in_range: bool) -> Option<Vec<u8>> {
    updated_version_literal(declared, min_of_valid(chosen)?, chosen, false, !in_range)
}
