use bun_core::fmt::{Table, TableSymbols, count, escape_control_chars};
use bun_core::strings;
use bun_core::{Global, Output};
use bun_glob as glob;
use bun_install::dependency::{self, Behavior};
use bun_install::lockfile::package::PackageColumns as _;
use bun_install::package_manager::workspace_manifests::{
    BrokenMember, DeclaredDependencies, DeclaredDependency, is_outdated,
};
use bun_install::package_manager::{Subcommand, WorkspaceFilter, populate_manifest_cache};
use bun_install::{CommandLineArguments, PackageID, PackageManager};
use bun_wyhash::hash;

use crate::Command;

pub(crate) struct OutdatedCommand;

struct GroupedOutdatedInfo {
    dep: DeclaredDependency,
    grouped_workspace_names: Option<Box<[u8]>>,
}

/// Printed between the two names of an aliased dependency: `"my-alias": "npm:dep@1.0.0"` is listed
/// as `my-alias@npm:dep`.
const ALIAS_SEPARATOR: &str = "@npm:";

/// A name as a cell prints it. Widths are taken from this text, not from the raw name.
pub(crate) fn printed(name: &[u8]) -> String {
    escape_control_chars(name).to_string()
}

pub(crate) fn printed_width(printed: &str) -> usize {
    strings::visible::width::exclude_ansi_colors::utf8(printed.as_bytes())
}

fn behavior_label(behavior: Behavior) -> &'static str {
    if behavior.is_dev() {
        " (dev)"
    } else if behavior.is_peer() {
        " (peer)"
    } else if behavior.is_optional() {
        " (optional)"
    } else {
        ""
    }
}

static COLUMN_NAMES: [&[u8]; 5] = [b"Package", b"Current", b"Update", b"Latest", b"Workspace"];

/// The rows of the `bun outdated` table and the column widths that fit them.
struct OutdatedTable {
    declared: DeclaredDependencies,
    rows: Vec<GroupedOutdatedInfo>,
    /// One per `COLUMN_NAMES`.
    column_inside_lengths: [usize; 5],
    show_workspace_column: bool,
    has_filtered_versions: bool,
}

enum FilterType<'a> {
    All,
    Name(&'a [u8]),
}

/// Combines the patterns like `--filter` values (`workspace_selection::select`).
fn package_patterns_select(
    patterns: &[FilterType<'_>],
    package_name: &[u8],
    alias: Option<&[u8]>,
) -> bool {
    let mut has_positive = false;
    let mut selected = false;
    for pattern in patterns {
        match pattern {
            FilterType::All => {
                has_positive = true;
                selected = true;
            }
            FilterType::Name(name_pattern) => {
                for name in [Some(package_name), alias].into_iter().flatten() {
                    let result = glob::r#match(name_pattern, name);
                    if result.is_negated() {
                        if !result.matches() {
                            return false;
                        }
                    } else {
                        has_positive = true;
                        selected |= result.matches();
                    }
                }
            }
        }
    }
    selected || !has_positive
}

impl OutdatedCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        bun_core::prettyln!(
            "<r><b>bun outdated <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        );
        Output::flush();

        let cli = CommandLineArguments::parse(Subcommand::Outdated)?;

        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, &cli, Subcommand::Outdated) {
                Ok(v) => v,
                Err(err) => {
                    if !cli.log_level.is_silent() {
                        if err == bun_install::Error::MissingPackageJSON {
                            Output::err_generic("missing package.json, nothing outdated", ());
                        }
                        Output::err_generic("failed to initialize bun install: {s}", (err.name(),));
                    }
                    Global::crash();
                }
            };

        manager.load_lockfile_from_cwd_or_exit::<true>("nothing outdated");
        Self::outdated_dispatch(&original_cwd, manager)
    }

    fn outdated_dispatch(original_cwd: &[u8], manager: &mut PackageManager) -> crate::Result<()> {
        let (workspace_pkg_ids, was_filtered) =
            if !manager.options.filter_patterns.is_empty() || manager.options.do_.recursive() {
                let ids = WorkspaceFilter::select_workspaces(
                    &manager.lockfile,
                    manager.options.filter_patterns,
                    original_cwd,
                );
                (ids, true)
            } else {
                let root_pkg_id = manager
                    .root_package_id
                    .get(&manager.lockfile, manager.workspace_name_hash);
                if root_pkg_id == bun_install::INVALID_PACKAGE_ID {
                    return Ok(());
                }
                (vec![root_pkg_id], false)
            };
        populate_manifest_cache::populate_manifest_cache(
            manager,
            populate_manifest_cache::Packages::Ids(&workspace_pkg_ids),
        )?;
        // The table covers what could be checked; what could not follows it.
        if let Some(table) = Self::collect_outdated(manager, &workspace_pkg_ids, was_filtered) {
            if Output::enable_ansi_colors_stdout() {
                Self::print_outdated_info_table::<true>(manager, &table);
            } else {
                Self::print_outdated_info_table::<false>(manager, &table);
            }
        }
        if populate_manifest_cache::print_fetch_failures(manager)? {
            Global::crash();
        }
        Ok(())
    }

    fn group_catalog_dependencies(
        manager: &PackageManager,
        declared: &DeclaredDependencies,
        outdated_items: &[DeclaredDependency],
    ) -> Vec<GroupedOutdatedInfo> {
        let pkg_names = manager.lockfile.packages.items_name();
        let pkg_names_buf = manager.lockfile.buffers.string_bytes.as_slice();
        let string_buf = declared.string_bytes();
        // (name hash, catalog name hash, behavior)
        let catalog_key = |item: &DeclaredDependency| {
            let dep = declared.dependency(item);
            (
                hash(dep.name.slice(string_buf)),
                hash(dep.version.catalog().slice(string_buf)),
                dep.behavior,
            )
        };

        let mut result: Vec<GroupedOutdatedInfo> = Vec::new();
        let mut catalog_map: bun_collections::HashMap<(u64, u64, Behavior), Vec<PackageID>> =
            bun_collections::HashMap::new();

        for item in outdated_items {
            if declared.dependency(item).version.tag == dependency::Tag::Catalog {
                catalog_map
                    .entry(catalog_key(item))
                    .or_default()
                    .push(item.workspace_pkg_id);
            } else {
                result.push(GroupedOutdatedInfo {
                    dep: *item,
                    grouped_workspace_names: None,
                });
            }
        }

        // One row per catalog entry, at the first workspace that uses it.
        for item in outdated_items {
            let version = &declared.dependency(item).version;
            if version.tag != dependency::Tag::Catalog {
                continue;
            }
            let Some(workspace_list) = catalog_map.get(&catalog_key(item)) else {
                continue;
            };
            if workspace_list[0] != item.workspace_pkg_id {
                continue;
            }
            let mut workspace_names: Vec<u8> = Vec::new();

            let cat_name = version.catalog().slice(string_buf);
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
                let workspace_name = pkg_names[workspace_id as usize].slice(pkg_names_buf);
                workspace_names.extend_from_slice(workspace_name);
            }
            workspace_names.push(b')');

            result.push(GroupedOutdatedInfo {
                dep: *item,
                grouped_workspace_names: Some(workspace_names.into_boxed_slice()),
            });
        }

        result
    }

    /// Finds the outdated dependencies of `workspace_pkg_ids` and sizes the
    /// table that lists them. `None` when there is nothing to list.
    fn collect_outdated(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        was_filtered: bool,
    ) -> Option<OutdatedTable> {
        let args = manager.options.positionals.get(1..).unwrap_or(&[]);
        let mut package_patterns: Vec<FilterType<'_>> = Vec::with_capacity(args.len());
        for &arg in args {
            match arg {
                b"" => {}
                b"*" | b"**" => package_patterns.push(FilterType::All),
                // As a glob, `*` would stop at the `/` of a scoped name.
                b"!*" | b"!**" => return None,
                _ => package_patterns.push(FilterType::Name(arg)),
            }
        }
        if package_patterns.is_empty() && !args.is_empty() {
            return None;
        }

        let mut column_inside_lengths = [
            "Packages".len(),
            "Current".len(),
            "Update".len(),
            "Latest".len(),
            "Workspace".len(),
        ];
        let mut has_filtered_versions: bool = false;

        // By value, so that the loop body holds only disjoint borrows of `manager`.
        let cache_ctx = manager.manifest_disk_cache_ctx();
        let min_age_ms = manager.options.minimum_release_age_ms;
        let needs_extended = min_age_ms.is_some();
        let excludes = manager.options.minimum_release_age_excludes;

        let declared =
            DeclaredDependencies::load(manager, workspace_pkg_ids, BrokenMember::LeftOut);
        let mut outdated_ids: Vec<DeclaredDependency> = Vec::new();

        for row in declared.rows() {
            let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
            let dep = declared.dependency(row);
            let resolution = manager.lockfile.packages.items_resolution()[row.package_id as usize];

            let package_name =
                manager.lockfile.packages.items_name()[row.package_id as usize].slice(string_buf);
            let dep_name = dep.name.slice(declared.string_bytes());
            let alias = (dep_name != package_name).then_some(dep_name);

            if !package_patterns_select(&package_patterns, package_name, alias) {
                continue;
            }

            let scope = manager.options.scope_for_package_name(package_name).clone();
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

            let Some(actual_latest) = manifest.find_latest(None, None).unwrap() else {
                continue;
            };

            let latest = manifest.find_latest(min_age_ms, excludes);
            let update_version = declared.find_update(row, manifest, min_age_ms, excludes);

            // `DeclaredDependencies` only has rows installed from npm.
            let current_version = resolution.npm().version;
            if !is_outdated(
                current_version,
                string_buf,
                update_version.unwrap(),
                actual_latest,
                manifest,
            ) {
                continue;
            }

            let mut fit = |column: usize, length: usize| {
                column_inside_lengths[column] = column_inside_lengths[column].max(length);
            };

            let alias_len = alias.map_or(0, |alias| {
                printed_width(&printed(alias)) + ALIAS_SEPARATOR.len()
            });
            fit(
                0,
                printed_width(&printed(package_name))
                    + alias_len
                    + behavior_label(dep.behavior).len(),
            );

            let current_len = count(format_args!("{}", current_version.fmt(string_buf)));
            fit(1, current_len);

            for (column, found) in [(2, update_version), (3, latest)] {
                let filtered = found.latest_is_filtered();
                has_filtered_versions |= filtered;
                let version_len = found.unwrap().map_or(current_len, |found| {
                    count(format_args!("{}", found.version.fmt(&manifest.string_buf)))
                });
                fit(column, version_len + if filtered { " *".len() } else { 0 });
            }

            let workspace_name = manager.lockfile.packages.items_name()
                [row.workspace_pkg_id as usize]
                .slice(string_buf);
            fit(4, printed_width(&printed(workspace_name)));

            outdated_ids.push(*row);
        }

        if outdated_ids.is_empty() {
            return None;
        }

        let rows = Self::group_catalog_dependencies(manager, &declared, &outdated_ids);

        let mut has_catalog_deps = false;
        for item in &rows {
            if let Some(names) = &item.grouped_workspace_names {
                column_inside_lengths[4] =
                    column_inside_lengths[4].max(printed_width(&printed(names)));
                has_catalog_deps = true;
            }
        }

        Some(OutdatedTable {
            declared,
            rows,
            column_inside_lengths,
            show_workspace_column: was_filtered || has_catalog_deps,
            has_filtered_versions,
        })
    }

    fn print_outdated_info_table<const ENABLE_ANSI_COLORS: bool>(
        manager: &mut PackageManager,
        outdated: &OutdatedTable,
    ) {
        let declared = &outdated.declared;
        let cache_ctx = manager.manifest_disk_cache_ctx();
        let min_age_ms = manager.options.minimum_release_age_ms;
        let needs_extended = min_age_ms.is_some();
        let excludes = manager.options.minimum_release_age_excludes;

        const COLUMN_LEFT_PAD: usize = 1;
        const COLUMN_RIGHT_PAD: usize = 1;

        let columns = if outdated.show_workspace_column { 5 } else { 4 };
        let table = Table::<COLUMN_LEFT_PAD, COLUMN_RIGHT_PAD, ENABLE_ANSI_COLORS>::init(
            &COLUMN_NAMES[..columns],
            &outdated.column_inside_lengths[..columns],
            "blue",
        );
        let symbols = TableSymbols {
            enable_ansi_colors: ENABLE_ANSI_COLORS,
        };
        let start_cell = || {
            bun_core::pretty!("{}", symbols.vertical_edge());
            for _ in 0..COLUMN_LEFT_PAD {
                bun_core::pretty!(" ");
            }
        };
        let end_cell = |column: usize, printed_length: usize| {
            for _ in printed_length..outdated.column_inside_lengths[column] + COLUMN_RIGHT_PAD {
                bun_core::pretty!(" ");
            }
        };

        table.print_top_line_separator();
        table.print_column_names();

        let groups = [
            Behavior::PROD,
            Behavior::DEV,
            Behavior::PEER,
            Behavior::OPTIONAL,
        ];
        for group_behavior in groups {
            for item in &outdated.rows {
                let package_id = item.dep.package_id;

                let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
                let dep = declared.dependency(&item.dep);
                // An optional peer has both the `PEER` and `OPTIONAL` bits. Print it only once.
                let first_group = groups.into_iter().find(|&g| dep.behavior.includes(g));
                if first_group != Some(group_behavior) {
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
                    needs_extended,
                ) else {
                    continue;
                };

                let latest = manifest.find_latest(min_age_ms, excludes);
                let update = declared.find_update(&item.dep, manifest, min_age_ms, excludes);

                // `DeclaredDependencies` only has rows installed from npm.
                let current_version = resolution.npm().version;

                table.print_line_separator();

                start_cell();
                let behavior_str = behavior_label(dep.behavior);
                let name = printed(package_name);
                let mut name_len = printed_width(&name) + behavior_str.len();
                let dep_name = dep.name.slice(declared.string_bytes());
                if dep_name != package_name {
                    let alias = printed(dep_name);
                    bun_core::pretty!("{}<d>{}<r>", alias, ALIAS_SEPARATOR);
                    name_len += printed_width(&alias) + ALIAS_SEPARATOR.len();
                }
                bun_core::pretty!("{}<d>{}<r>", name, behavior_str);
                end_cell(0, name_len);

                start_cell();
                let current = current_version.fmt(string_buf).to_string();
                bun_core::pretty!("{}", current);
                end_cell(1, current.len());

                for (column, found) in [(2, update), (3, latest)] {
                    start_cell();
                    let filtered = found.latest_is_filtered();
                    let mut version_len = if let Some(found) = found.unwrap() {
                        let (version, buf) = (found.version, &*manifest.string_buf);
                        // A `latest` that is older than the installed version is not an update.
                        if column == 3 && version.order(current_version, buf, string_buf).is_lt() {
                            bun_core::pretty!("<d>{}<r>", version.fmt(buf));
                        } else {
                            bun_core::pretty!(
                                "{}",
                                version.diff_fmt(current_version, buf, string_buf)
                            );
                        }
                        count(format_args!("{}", version.fmt(buf)))
                    } else {
                        bun_core::pretty!("<d>{}<r>", current);
                        current.len()
                    };
                    if filtered {
                        bun_core::pretty!(" <blue>*<r>");
                        version_len += " *".len();
                    }
                    end_cell(column, version_len);
                }

                if outdated.show_workspace_column {
                    start_cell();
                    let workspace_name: &[u8] = if let Some(names) = &item.grouped_workspace_names {
                        names
                    } else {
                        manager.lockfile.packages.items_name()[item.dep.workspace_pkg_id as usize]
                            .slice(string_buf)
                    };
                    let workspace_name = printed(workspace_name);
                    bun_core::pretty!("{}", workspace_name);
                    end_cell(4, printed_width(&workspace_name));
                }

                bun_core::pretty!("{}\n", symbols.vertical_edge());
            }
        }

        table.print_bottom_line_separator();

        if outdated.has_filtered_versions {
            bun_core::prettyln!(
                "<d><b>Note:<r> <d>The <r><blue>*<r><d> indicates that version isn't true latest due to minimum release age<r>"
            );
        }
    }
}
