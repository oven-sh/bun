use core::fmt;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_fs::FileSystem;
use bun_glob as glob;
use bun_install::dependency::Behavior;
use bun_install::{DependencyID, PackageID, PackageManager, WorkspaceFilter, INVALID_PACKAGE_ID};
use bun_js_parser::ast::{Expr, E};
use bun_js_printer as js_printer;
use bun_logger as logger;
use bun_paths::{self as path, PathBuffer};
use bun_semver::{self as semver, SlicedString};
use bun_str::strings;

use crate::Command;

pub struct TerminalHyperlink<'a> {
    link: &'a [u8],
    text: &'a [u8],
    enabled: bool,
}

impl<'a> TerminalHyperlink<'a> {
    pub fn new(link: &'a [u8], text: &'a [u8], enabled: bool) -> TerminalHyperlink<'a> {
        TerminalHyperlink { link, text, enabled }
    }
}

impl fmt::Display for TerminalHyperlink<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.enabled {
            const ESC: &str = "\x1b";
            // OSC8 = ESC ]8;; ; ST = ESC \
            write!(
                f,
                "{esc}]8;;{link}{esc}\\{text}{esc}]8;;{esc}\\",
                esc = ESC,
                link = BStr::new(self.link),
                text = BStr::new(self.text),
            )
        } else {
            write!(f, "{}", BStr::new(self.text))
        }
    }
}

pub struct UpdateInteractiveCommand;

struct OutdatedPackage<'a> {
    name: Box<[u8]>,
    current_version: Box<[u8]>,
    latest_version: Box<[u8]>,
    update_version: Box<[u8]>,
    package_id: PackageID,
    dep_id: DependencyID,
    workspace_pkg_id: PackageID,
    dependency_type: &'static [u8],
    workspace_name: Box<[u8]>,
    behavior: Behavior,
    use_latest: bool,
    manager: &'a PackageManager,
    is_catalog: bool,
    catalog_name: Option<Box<[u8]>>,
}

struct CatalogUpdate {
    version: Box<[u8]>,
    workspace_path: Box<[u8]>,
}

struct PackageUpdate {
    name: Box<[u8]>,
    target_version: Box<[u8]>,
    dep_type: Box<[u8]>, // "dependencies", "devDependencies", etc.
    workspace_path: Box<[u8]>,
    original_version: Box<[u8]>,
    package_id: PackageID,
}

pub struct CatalogUpdateRequest {
    // TODO(port): lifetime — these borrow from caller in Zig; using owned for Phase A
    package_name: Box<[u8]>,
    new_version: Box<[u8]>,
    catalog_name: Option<Box<[u8]>>,
}

struct ColumnWidths {
    name: usize,
    current: usize,
    target: usize,
    latest: usize,
    workspace: usize,
    show_workspace: bool,
}

struct MultiSelectState<'a> {
    packages: &'a mut [OutdatedPackage<'a>],
    selected: &'a mut [bool],
    cursor: usize,
    viewport_start: usize,
    viewport_height: usize, // Default viewport height
    toggle_all: bool,
    max_name_len: usize,
    max_current_len: usize,
    max_update_len: usize,
    max_latest_len: usize,
    max_workspace_len: usize,
    show_workspace: bool,
}

#[derive(Clone, Copy)]
struct TerminalSize {
    height: usize,
    width: usize,
}

impl UpdateInteractiveCommand {
    // Common utility functions to reduce duplication

    fn build_package_json_path<'b>(
        root_dir: &[u8],
        workspace_path: &[u8],
        path_buf: &'b mut PathBuffer,
    ) -> &'b [u8] {
        if !workspace_path.is_empty() {
            path::join_abs_string_buf(
                root_dir,
                path_buf,
                &[workspace_path, b"package.json"],
                path::Style::Auto,
            )
        } else {
            path::join_abs_string_buf(
                root_dir,
                path_buf,
                &[b"package.json"],
                path::Style::Auto,
            )
        }
    }

    // Helper to update a catalog entry at a specific path in the package.json AST
    fn save_package_json(
        manager: &mut PackageManager,
        // TODO(port): `anytype` — MapEntry from WorkspacePackageJSONCache
        package_json: &mut bun_install::WorkspacePackageJsonCacheEntry,
        package_json_path: &[u8],
    ) -> Result<(), bun_core::Error> {
        let preserve_trailing_newline = !package_json.source.contents.is_empty()
            && package_json.source.contents[package_json.source.contents.len() - 1] == b'\n';

        let mut buffer_writer = js_printer::BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve((package_json.source.contents.len() + 1).saturating_sub(buffer_writer.buffer.list.len()));
        buffer_writer.append_newline = preserve_trailing_newline;
        let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

        if let Err(err) = js_printer::print_json(
            &mut package_json_writer,
            package_json.root,
            &package_json.source,
            js_printer::PrintJsonOptions {
                indent: package_json.indentation,
                mangled_props: None,
            },
        ) {
            Output::err_generic(format_args!(
                "Failed to serialize package.json: {}",
                err.name()
            ));
            return Err(err);
        }

        let new_package_json_source: Box<[u8]> =
            Box::from(package_json_writer.ctx.written_without_trailing_zero());

        // Write the updated package.json
        // TODO(port): replace std.fs.cwd().createFile with bun_sys::File API
        let write_file = match bun_sys::File::create(bun_sys::Fd::cwd(), package_json_path) {
            Ok(f) => f,
            Err(err) => {
                Output::err_generic(format_args!(
                    "Failed to write package.json at {}: {}",
                    BStr::new(package_json_path),
                    err.name()
                ));
                return Err(err.into());
            }
        };
        // `write_file` closes on Drop.

        if let Err(err) = write_file.write_all(&new_package_json_source) {
            Output::err_generic(format_args!(
                "Failed to write package.json at {}: {}",
                BStr::new(package_json_path),
                err.name()
            ));
            return Err(err.into());
        }

        // Update the cache so installWithManager sees the new package.json
        // This is critical - without this, installWithManager will use the cached old version
        package_json.source.contents = new_package_json_source;
        Ok(())
    }

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::prettyln(format_args!(
            "<r><b>bun update --interactive <r><d>v{}<r>",
            Global::PACKAGE_JSON_VERSION_WITH_SHA
        ));
        Output::flush();

        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Update)?;

        let (manager, original_cwd) = match PackageManager::init(ctx, cli, PackageManager::Subcommand::Update) {
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
        // `original_cwd` is owned; drops at end of scope.

        Self::update_interactive(ctx, &original_cwd, manager)
    }

    fn update_package_json_files_from_updates(
        manager: &mut PackageManager,
        updates: &[PackageUpdate],
    ) -> Result<(), bun_core::Error> {
        // Group updates by workspace
        let mut workspace_groups: StringHashMap<Vec<&PackageUpdate>> = StringHashMap::default();

        // Group updates by workspace path
        for update in updates {
            let result = workspace_groups.get_or_put(&update.workspace_path);
            if !result.found_existing {
                *result.value_ptr = Vec::new();
            }
            result.value_ptr.push(update);
        }

        // Process each workspace
        let mut it = workspace_groups.iter();
        while let Some(entry) = it.next() {
            let workspace_path = entry.key();
            let workspace_updates = entry.value().as_slice();

            // Build the package.json path for this workspace
            let root_dir = FileSystem::instance().top_level_dir;
            let mut path_buf = PathBuffer::uninit();
            let package_json_path =
                Self::build_package_json_path(root_dir, workspace_path, &mut path_buf);

            // Load and parse the package.json
            let mut package_json = match manager.workspace_package_json_cache.get_with_path(
                manager.log,
                package_json_path,
                bun_install::GetJsonOptions { guess_indentation: true },
            ) {
                bun_install::GetJsonResult::ParseErr(err) => {
                    Output::err_generic(format_args!(
                        "Failed to parse package.json at {}: {}",
                        BStr::new(package_json_path),
                        err.name()
                    ));
                    continue;
                }
                bun_install::GetJsonResult::ReadErr(err) => {
                    Output::err_generic(format_args!(
                        "Failed to read package.json at {}: {}",
                        BStr::new(package_json_path),
                        err.name()
                    ));
                    continue;
                }
                bun_install::GetJsonResult::Entry(package_entry) => package_entry,
            };

            let mut modified = false;

            // Update each package in this workspace's package.json
            for update in workspace_updates {
                // Find the package in the correct dependency section
                if let bun_js_parser::ast::ExprData::EObject(_) = &package_json.root.data {
                    if let Some(section_query) = package_json.root.as_property(&update.dep_type) {
                        if let bun_js_parser::ast::ExprData::EObject(dep_obj) =
                            &mut section_query.expr.data
                        {
                            if let Some(version_query) = section_query.expr.as_property(&update.name) {
                                if let bun_js_parser::ast::ExprData::EString(e_string) =
                                    &version_query.expr.data
                                {
                                    // Get the original version to preserve prefix
                                    let original_version = &e_string.data;

                                    // Preserve the version prefix from the original
                                    let version_with_prefix = preserve_version_prefix(
                                        original_version,
                                        &update.target_version,
                                    )?;

                                    // Update the version using hash map put
                                    let new_expr = Expr::init(
                                        E::String { data: version_with_prefix },
                                        version_query.expr.loc,
                                    )
                                    .clone_expr()?;
                                    dep_obj.put(&update.name, new_expr)?;
                                    modified = true;
                                }
                            }
                        }
                    }
                }
            }

            // Write the updated package.json if modified
            if modified {
                Self::save_package_json(manager, &mut package_json, package_json_path)?;
            }
        }
        Ok(())
    }

    fn update_catalog_definitions(
        manager: &mut PackageManager,
        catalog_updates: &StringHashMap<CatalogUpdate>,
    ) -> Result<(), bun_core::Error> {
        // Group catalog updates by workspace path
        let mut workspace_catalog_updates: StringHashMap<Vec<CatalogUpdateRequest>> =
            StringHashMap::default();

        // Group updates by workspace
        let mut catalog_it = catalog_updates.iter();
        while let Some(entry) = catalog_it.next() {
            let catalog_key = entry.key();
            let update = entry.value();

            let result = workspace_catalog_updates.get_or_put(&update.workspace_path);
            if !result.found_existing {
                *result.value_ptr = Vec::new();
            }

            // Parse catalog_key (format: "package_name" or "package_name:catalog_name")
            let colon_index = bun_str::strings::index_of(catalog_key, b":");
            let package_name = if let Some(idx) = colon_index {
                &catalog_key[..idx]
            } else {
                catalog_key
            };
            let catalog_name = colon_index.map(|idx| Box::<[u8]>::from(&catalog_key[idx + 1..]));

            result.value_ptr.push(CatalogUpdateRequest {
                package_name: Box::from(package_name),
                new_version: update.version.clone(),
                catalog_name,
            });
        }

        // Update catalog definitions for each workspace
        let mut workspace_it = workspace_catalog_updates.iter_mut();
        while let Some(workspace_entry) = workspace_it.next() {
            let workspace_path = workspace_entry.key();
            let updates_for_workspace = workspace_entry.value_mut();

            // Build the package.json path for this workspace
            let root_dir = FileSystem::instance().top_level_dir;
            let mut path_buf = PathBuffer::uninit();
            let package_json_path =
                Self::build_package_json_path(root_dir, workspace_path, &mut path_buf);

            // Load and parse the package.json properly
            let mut package_json = match manager.workspace_package_json_cache.get_with_path(
                manager.log,
                package_json_path,
                bun_install::GetJsonOptions { guess_indentation: true },
            ) {
                bun_install::GetJsonResult::ParseErr(err) => {
                    Output::err_generic(format_args!(
                        "Failed to parse package.json at {}: {}",
                        BStr::new(package_json_path),
                        err.name()
                    ));
                    continue;
                }
                bun_install::GetJsonResult::ReadErr(err) => {
                    Output::err_generic(format_args!(
                        "Failed to read package.json at {}: {}",
                        BStr::new(package_json_path),
                        err.name()
                    ));
                    continue;
                }
                bun_install::GetJsonResult::Entry(entry) => entry,
            };

            // Use the PackageJSONEditor to update catalogs
            edit_catalog_definitions(manager, updates_for_workspace.as_mut_slice(), &mut package_json.root)?;

            // Save the updated package.json
            Self::save_package_json(manager, &mut package_json, package_json_path)?;
        }
        Ok(())
    }

    fn update_interactive(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        // make the package manager things think we are actually in root dir
        // _ = bun.sys.chdir(manager.root_dir.dir, manager.root_dir.dir);

        let load_lockfile_result = manager.lockfile.load_from_cwd(manager, manager.log, true);

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

        let workspace_pkg_ids: Box<[PackageID]> = if !manager.options.filter_patterns.is_empty() {
            let filters = &manager.options.filter_patterns;
            Self::find_matching_workspaces(original_cwd, manager, filters)
        } else if manager.options.do_.recursive {
            Self::get_all_workspaces(manager)
        } else {
            let root_pkg_id = manager
                .root_package_id
                .get(manager.lockfile, manager.workspace_name_hash);
            if root_pkg_id == INVALID_PACKAGE_ID {
                return Ok(());
            }

            let ids = vec![root_pkg_id].into_boxed_slice();
            ids
        };

        manager.populate_manifest_cache(bun_install::ManifestCacheOptions::Ids(&workspace_pkg_ids))?;

        // Get outdated packages
        let mut outdated_packages = Self::get_outdated_packages(manager, &workspace_pkg_ids)?;

        if outdated_packages.is_empty() {
            // No packages need updating - just exit silently
            Output::prettyln(format_args!("<r><green>✓<r> All packages are up to date!"));
            return Ok(());
        }

        // Prompt user to select packages
        let selected = Self::prompt_for_updates(&mut outdated_packages)?;

        // Create package specifier array from selected packages
        // Group selected packages by workspace
        let mut workspace_updates: StringHashMap<Vec<Box<[u8]>>> = StringHashMap::default();
        let _ = &mut workspace_updates;

        // Track catalog updates separately (catalog_key -> {version, workspace_path})
        let mut catalog_updates: StringHashMap<CatalogUpdate> = StringHashMap::default();

        // Collect all package updates with full information
        let mut package_updates: Vec<PackageUpdate> = Vec::new();

        // Process selected packages
        debug_assert_eq!(outdated_packages.len(), selected.len());
        for (pkg, &is_selected) in outdated_packages.iter().zip(selected.iter()) {
            if !is_selected {
                continue;
            }

            // Use latest version if requested
            let target_version: &[u8] = if pkg.use_latest {
                &pkg.latest_version
            } else {
                &pkg.update_version
            };

            if strings::eql(&pkg.current_version, target_version) {
                continue;
            }

            // For catalog dependencies, we need to collect them separately
            // to update the catalog definitions in the root or workspace package.json
            if pkg.is_catalog {
                // Store catalog updates for later processing
                let catalog_key: Box<[u8]> = if let Some(catalog_name) = &pkg.catalog_name {
                    let mut v = Vec::new();
                    write!(
                        &mut v,
                        "{}:{}",
                        BStr::new(&pkg.name),
                        BStr::new(catalog_name)
                    )
                    .unwrap();
                    v.into_boxed_slice()
                } else {
                    pkg.name.clone()
                };

                // For catalog dependencies, we always update the root package.json
                // (or the workspace root where the catalog is defined)
                let catalog_workspace_path: Box<[u8]> = Box::from(&b""[..]); // Always root for now

                catalog_updates.put(
                    catalog_key,
                    CatalogUpdate {
                        version: Box::from(target_version),
                        workspace_path: catalog_workspace_path,
                    },
                );
                continue;
            }

            // Get the workspace path for this package
            let workspace_resolution =
                &manager.lockfile.packages.items_resolution()[pkg.workspace_pkg_id as usize];
            let workspace_path: &[u8] = if workspace_resolution.tag == bun_install::ResolutionTag::Workspace {
                workspace_resolution
                    .value
                    .workspace
                    .slice(manager.lockfile.buffers.string_bytes.as_slice())
            } else {
                b"" // Root workspace
            };

            // Add package update with full information
            package_updates.push(PackageUpdate {
                name: pkg.name.clone(),
                target_version: Box::from(target_version),
                dep_type: Box::from(pkg.dependency_type),
                workspace_path: Box::from(workspace_path),
                original_version: pkg.current_version.clone(),
                package_id: pkg.package_id,
            });
        }

        // Check if we have any updates
        let has_package_updates = !package_updates.is_empty();
        let has_catalog_updates = catalog_updates.count() > 0;

        if !has_package_updates && !has_catalog_updates {
            Output::prettyln(format_args!(
                "<r><yellow>!</r> No packages selected for update"
            ));
            return Ok(());
        }

        // Actually update the selected packages
        if has_package_updates || has_catalog_updates {
            if manager.options.dry_run {
                Output::prettyln(format_args!(
                    "\n<r><yellow>Dry run mode: showing what would be updated<r>"
                ));

                // In dry-run mode, just show what would be updated without modifying files
                for update in &package_updates {
                    let workspace_display: &[u8] = if !update.workspace_path.is_empty() {
                        &update.workspace_path
                    } else {
                        b"root"
                    };
                    Output::prettyln(format_args!(
                        "→ Would update {} to {} in {} ({})",
                        BStr::new(&update.name),
                        BStr::new(&update.target_version),
                        BStr::new(workspace_display),
                        BStr::new(&update.dep_type)
                    ));
                }

                if has_catalog_updates {
                    let mut it = catalog_updates.iter();
                    while let Some(entry) = it.next() {
                        let catalog_key = entry.key();
                        let catalog_update = entry.value();
                        Output::prettyln(format_args!(
                            "→ Would update catalog {} to {}",
                            BStr::new(catalog_key),
                            BStr::new(&catalog_update.version)
                        ));
                    }
                }

                Output::prettyln(format_args!(
                    "\n<r><yellow>Dry run complete - no changes made<r>"
                ));
            } else {
                Output::prettyln(format_args!("\n<r><cyan>Installing updates...<r>"));
                Output::flush();

                // Update catalog definitions first if needed
                if has_catalog_updates {
                    Self::update_catalog_definitions(manager, &catalog_updates)?;
                }

                // Update all package.json files directly (fast!)
                if has_package_updates {
                    Self::update_package_json_files_from_updates(manager, &package_updates)?;
                }

                manager.to_update = true;

                // Reset the timer to show actual install time instead of total command time
                let mut install_ctx = ctx;
                // TODO(port): std.time.nanoTimestamp() equivalent
                install_ctx.start_time = bun_core::time::nano_timestamp();

                PackageManager::install_with_manager(
                    manager,
                    install_ctx,
                    PackageManager::ROOT_PACKAGE_JSON_PATH,
                    manager.root_dir.dir,
                )?;
            }
        }
        Ok(())
    }

    fn get_all_workspaces(manager: &PackageManager) -> Box<[PackageID]> {
        let lockfile = &manager.lockfile;
        let packages = lockfile.packages.slice();
        let pkg_resolutions = packages.items_resolution();

        let mut workspace_pkg_ids: Vec<PackageID> = Vec::new();
        for (pkg_id, resolution) in pkg_resolutions.iter().enumerate() {
            if resolution.tag != bun_install::ResolutionTag::Workspace
                && resolution.tag != bun_install::ResolutionTag::Root
            {
                continue;
            }
            workspace_pkg_ids.push(u32::try_from(pkg_id).unwrap());
        }

        workspace_pkg_ids.into_boxed_slice()
    }

    fn find_matching_workspaces(
        original_cwd: &[u8],
        manager: &PackageManager,
        filters: &[Box<[u8]>],
    ) -> Box<[PackageID]> {
        let lockfile = &manager.lockfile;
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
            workspace_pkg_ids.push(u32::try_from(pkg_id).unwrap());
        }

        let mut path_buf = PathBuffer::uninit();

        let converted_filters: Vec<WorkspaceFilter> = {
            let mut buf = Vec::with_capacity(filters.len());
            for filter in filters {
                buf.push(WorkspaceFilter::init(filter, original_cwd, &mut path_buf));
            }
            buf
        };
        // converted_filters drop on scope exit.

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
                                path::Style::Posix,
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

        workspace_pkg_ids.into_boxed_slice()
    }

    fn group_catalog_dependencies<'a>(
        packages: Vec<OutdatedPackage<'a>>,
    ) -> Result<Vec<OutdatedPackage<'a>>, bun_core::Error> {
        // Create a map to track catalog dependencies by name
        let mut catalog_map: StringHashMap<Vec<OutdatedPackage<'a>>> = StringHashMap::default();

        let mut result: Vec<OutdatedPackage<'a>> = Vec::new();

        // Group catalog dependencies
        for pkg in packages {
            if pkg.is_catalog {
                let entry = catalog_map.get_or_put(&pkg.name);
                if !entry.found_existing {
                    *entry.value_ptr = Vec::new();
                }
                entry.value_ptr.push(pkg);
            } else {
                result.push(pkg);
            }
        }

        // Add grouped catalog dependencies
        let mut iter = catalog_map.into_iter();
        while let Some((_k, catalog_packages)) = iter.next() {
            if !catalog_packages.is_empty() {
                let mut catalog_packages = catalog_packages.into_iter();
                // Use the first package as the base, but combine workspace names
                let mut first = catalog_packages.next().unwrap();

                // Build combined workspace name
                let mut workspace_names: Vec<u8> = Vec::new();

                // PORT NOTE: Zig checks `if (catalog_packages.len > 0)` again here which is always
                // true; preserve behavior of the true branch.
                if let Some(catalog_name) = &first.catalog_name {
                    workspace_names.extend_from_slice(b"catalog:");
                    workspace_names.extend_from_slice(catalog_name);
                } else {
                    workspace_names.extend_from_slice(b"catalog");
                }
                workspace_names.extend_from_slice(b" (");

                workspace_names.extend_from_slice(&first.workspace_name);
                let rest: Vec<OutdatedPackage<'a>> = catalog_packages.collect();
                for cat_pkg in &rest {
                    workspace_names.extend_from_slice(b", ");
                    workspace_names.extend_from_slice(&cat_pkg.workspace_name);
                }
                workspace_names.push(b')');

                // Replace workspace_name with combined (old one drops automatically).
                first.workspace_name = workspace_names.into_boxed_slice();

                result.push(first);

                // The other catalog packages drop here, freeing their owned fields.
                drop(rest);
            }
        }

        Ok(result)
    }

    fn get_outdated_packages<'a>(
        manager: &'a PackageManager,
        workspace_pkg_ids: &[PackageID],
    ) -> Result<Vec<OutdatedPackage<'a>>, bun_core::Error> {
        let lockfile = &manager.lockfile;
        let string_buf = lockfile.buffers.string_bytes.as_slice();
        let packages = lockfile.packages.slice();
        let pkg_names = packages.items_name();
        let pkg_resolutions = packages.items_resolution();
        let pkg_dependencies = packages.items_dependencies();

        let mut outdated_packages: Vec<OutdatedPackage<'a>> = Vec::new();

        let mut version_buf: Vec<u8> = Vec::new();

        for &workspace_pkg_id in workspace_pkg_ids {
            let pkg_deps = &pkg_dependencies[workspace_pkg_id as usize];
            for dep_id in pkg_deps.begin()..pkg_deps.end() {
                let package_id = lockfile.buffers.resolutions.as_slice()[dep_id];
                if package_id == INVALID_PACKAGE_ID {
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

                let name_slice = dep.name.slice(string_buf);
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

                let Some(latest) = manifest
                    .find_by_dist_tag_with_filter(
                        b"latest",
                        manager.options.minimum_release_age_ms,
                        &manager.options.minimum_release_age_excludes,
                    )
                    .unwrap_opt()
                else {
                    continue;
                };

                // In interactive mode, show the constrained update version as "Target"
                // but always include packages (don't filter out breaking changes)
                let update_version = if resolved_version.tag == bun_install::DependencyVersionTag::Npm {
                    manifest
                        .find_best_version_with_filter(
                            &resolved_version.value.npm.version,
                            string_buf,
                            manager.options.minimum_release_age_ms,
                            &manager.options.minimum_release_age_excludes,
                        )
                        .unwrap_opt()
                        .unwrap_or(latest)
                } else {
                    manifest
                        .find_by_dist_tag_with_filter(
                            resolved_version.value.dist_tag.tag.slice(string_buf),
                            manager.options.minimum_release_age_ms,
                            &manager.options.minimum_release_age_excludes,
                        )
                        .unwrap_opt()
                        .unwrap_or(latest)
                };

                // Skip only if both the constrained update AND the latest version are the same as current
                // This ensures we show packages where latest is newer even if constrained update isn't
                let current_ver = &resolution.value.npm.version;
                let update_ver = &update_version.version;
                let latest_ver = &latest.version;

                let update_is_same = current_ver.major == update_ver.major
                    && current_ver.minor == update_ver.minor
                    && current_ver.patch == update_ver.patch
                    && current_ver.tag.eql(&update_ver.tag);

                let latest_is_same = current_ver.major == latest_ver.major
                    && current_ver.minor == latest_ver.minor
                    && current_ver.patch == latest_ver.patch
                    && current_ver.tag.eql(&latest_ver.tag);

                if update_is_same && latest_is_same {
                    continue;
                }

                version_buf.clear();
                write!(&mut version_buf, "{}", resolution.value.npm.version.fmt(string_buf)).unwrap();
                let current_version_buf: Box<[u8]> = Box::from(version_buf.as_slice());

                version_buf.clear();
                write!(&mut version_buf, "{}", update_version.version.fmt(manifest.string_buf)).unwrap();
                let update_version_buf: Box<[u8]> = Box::from(version_buf.as_slice());

                version_buf.clear();
                write!(&mut version_buf, "{}", latest.version.fmt(manifest.string_buf)).unwrap();
                let latest_version_buf: Box<[u8]> = Box::from(version_buf.as_slice());

                // Already filtered by version.order check above

                version_buf.clear();
                let dep_type: &'static [u8] = if dep.behavior.dev {
                    b"devDependencies"
                } else if dep.behavior.optional {
                    b"optionalDependencies"
                } else if dep.behavior.peer {
                    b"peerDependencies"
                } else {
                    b"dependencies"
                };

                // Get workspace name but only show if it's actually a workspace
                let workspace_resolution = &pkg_resolutions[workspace_pkg_id as usize];
                let workspace_name: &[u8] =
                    if workspace_resolution.tag == bun_install::ResolutionTag::Workspace {
                        pkg_names[workspace_pkg_id as usize].slice(string_buf)
                    } else {
                        b""
                    };

                let catalog_name_str: &[u8] =
                    if dep.version.tag == bun_install::DependencyVersionTag::Catalog {
                        dep.version.value.catalog.slice(string_buf)
                    } else {
                        b""
                    };

                let catalog_name: Option<Box<[u8]>> = if !catalog_name_str.is_empty() {
                    Some(Box::from(catalog_name_str))
                } else {
                    None
                };

                outdated_packages.push(OutdatedPackage {
                    name: Box::from(name_slice),
                    current_version: current_version_buf,
                    latest_version: latest_version_buf,
                    update_version: update_version_buf,
                    package_id,
                    dep_id: u32::try_from(dep_id).unwrap(),
                    workspace_pkg_id,
                    dependency_type: dep_type,
                    workspace_name: Box::from(workspace_name),
                    behavior: dep.behavior,
                    manager,
                    is_catalog: dep.version.tag == bun_install::DependencyVersionTag::Catalog,
                    catalog_name,
                    use_latest: manager.options.do_.update_to_latest, // default to --latest flag value
                });
            }
        }

        let result = outdated_packages;

        // Group catalog dependencies
        let mut grouped_result = Self::group_catalog_dependencies(result)?;

        // Sort packages: dependencies first, then devDependencies, etc.
        fn dep_type_priority(dep_type: &[u8]) -> u8 {
            if dep_type == b"dependencies" {
                return 0;
            }
            if dep_type == b"devDependencies" {
                return 1;
            }
            if dep_type == b"peerDependencies" {
                return 2;
            }
            if dep_type == b"optionalDependencies" {
                return 3;
            }
            4
        }
        grouped_result.sort_by(|a, b| {
            // First sort by dependency type
            let a_priority = dep_type_priority(a.dependency_type);
            let b_priority = dep_type_priority(b.dependency_type);
            if a_priority != b_priority {
                return a_priority.cmp(&b_priority);
            }
            // Then by name
            strings::order(&a.name, &b.name)
        });

        Ok(grouped_result)
    }

    fn calculate_column_widths(packages: &[OutdatedPackage<'_>]) -> ColumnWidths {
        // Calculate natural widths based on content
        let mut max_name_len: usize = b"Package".len();
        let mut max_current_len: usize = b"Current".len();
        let mut max_target_len: usize = b"Target".len();
        let mut max_latest_len: usize = b"Latest".len();
        let mut max_workspace_len: usize = b"Workspace".len();
        let mut has_workspaces = false;

        for pkg in packages {
            // Include dev tag length in max calculation
            let mut dev_tag_len: usize = 0;
            if pkg.behavior.dev {
                dev_tag_len = 4; // " dev"
            } else if pkg.behavior.peer {
                dev_tag_len = 5; // " peer"
            } else if pkg.behavior.optional {
                dev_tag_len = 9; // " optional"
            }

            max_name_len = max_name_len.max(pkg.name.len() + dev_tag_len);
            max_current_len = max_current_len.max(pkg.current_version.len());
            max_target_len = max_target_len.max(pkg.update_version.len());
            max_latest_len = max_latest_len.max(pkg.latest_version.len());
            max_workspace_len = max_workspace_len.max(pkg.workspace_name.len());

            // Check if we have any non-empty workspace names
            if !pkg.workspace_name.is_empty() {
                has_workspaces = true;
            }
        }

        // Get terminal width to apply smart limits if needed
        let term_size = Self::get_terminal_size();

        // Apply smart column width limits based on terminal width
        if term_size.width < 60 {
            // Very narrow terminal - aggressive truncation, hide workspace
            max_name_len = max_name_len.min(12);
            max_current_len = max_current_len.min(7);
            max_target_len = max_target_len.min(7);
            max_latest_len = max_latest_len.min(7);
            has_workspaces = false;
        } else if term_size.width < 80 {
            // Narrow terminal - moderate truncation, hide workspace
            max_name_len = max_name_len.min(20);
            max_current_len = max_current_len.min(10);
            max_target_len = max_target_len.min(10);
            max_latest_len = max_latest_len.min(10);
            has_workspaces = false;
        } else if term_size.width < 120 {
            // Medium terminal - light truncation
            max_name_len = max_name_len.min(35);
            max_current_len = max_current_len.min(15);
            max_target_len = max_target_len.min(15);
            max_latest_len = max_latest_len.min(15);
            max_workspace_len = max_workspace_len.min(15);
            // Show workspace only if terminal is wide enough for all columns
            if term_size.width < 100 {
                has_workspaces = false;
            }
        } else if term_size.width < 160 {
            // Wide terminal - minimal truncation for very long names
            max_name_len = max_name_len.min(45);
            max_current_len = max_current_len.min(20);
            max_target_len = max_target_len.min(20);
            max_latest_len = max_latest_len.min(20);
            max_workspace_len = max_workspace_len.min(20);
        }
        // else: wide terminal - use natural widths

        ColumnWidths {
            name: max_name_len,
            current: max_current_len,
            target: max_target_len,
            latest: max_latest_len,
            workspace: max_workspace_len,
            show_workspace: has_workspaces,
        }
    }

    fn get_terminal_size() -> TerminalSize {
        // Try to get terminal size
        #[cfg(unix)]
        {
            // TODO(port): replace std.posix.system.ioctl with bun_sys
            // SAFETY: all-zero is a valid Winsize (#[repr(C)] POD, no NonNull/NonZero fields).
            let mut size: bun_sys::posix::Winsize = unsafe { core::mem::zeroed() };
            // SAFETY: ioctl with TIOCGWINSZ on stdout fd; size is a valid out-ptr.
            if unsafe {
                bun_sys::posix::ioctl(
                    bun_sys::posix::STDOUT_FILENO,
                    bun_sys::posix::TIOCGWINSZ,
                    &mut size as *mut _ as usize,
                )
            } == 0
            {
                // Reserve space for prompt (1 line) + scroll indicators (2 lines) + some buffer
                let usable_height = if size.row > 6 { size.row - 4 } else { 20 };
                return TerminalSize {
                    height: usable_height as usize,
                    width: size.col as usize,
                };
            }
        }
        #[cfg(windows)]
        {
            use bun_sys::windows;
            let handle = match windows::GetStdHandle(windows::STD_OUTPUT_HANDLE) {
                Ok(h) => h,
                Err(_) => return TerminalSize { height: 20, width: 80 },
            };

            // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
            let mut csbi: windows::CONSOLE_SCREEN_BUFFER_INFO = unsafe { core::mem::zeroed() };
            // SAFETY: handle is valid; csbi is a valid out-ptr.
            if unsafe { windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi) }
                != windows::FALSE
            {
                let width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                let height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
                // Reserve space for prompt + scroll indicators + buffer
                let usable_height = if height > 6 { height - 4 } else { 20 };
                return TerminalSize {
                    height: usize::try_from(usable_height).unwrap(),
                    width: usize::try_from(width).unwrap(),
                };
            }
        }
        TerminalSize { height: 20, width: 80 } // Default fallback
    }

    fn truncate_with_ellipsis(text: &[u8], max_width: usize, only_end: bool) -> Box<[u8]> {
        if text.len() <= max_width {
            return Box::from(text);
        }

        if max_width <= 3 {
            return Box::from("…".as_bytes());
        }

        // Put ellipsis in the middle to show both start and end of package name
        let ellipsis = "…".as_bytes();
        let available_chars = max_width - 1; // Reserve 1 char for ellipsis
        let start_chars = if only_end { available_chars } else { available_chars / 2 };
        let end_chars = available_chars - start_chars;

        let mut result = vec![0u8; start_chars + ellipsis.len() + end_chars];
        result[0..start_chars].copy_from_slice(&text[0..start_chars]);
        result[start_chars..start_chars + ellipsis.len()].copy_from_slice(ellipsis);
        result[start_chars + ellipsis.len()..].copy_from_slice(&text[text.len() - end_chars..]);

        result.into_boxed_slice()
    }

    fn prompt_for_updates<'a>(
        packages: &'a mut [OutdatedPackage<'a>],
    ) -> Result<Box<[bool]>, bun_core::Error> {
        if packages.is_empty() {
            Output::prettyln(format_args!("<r><green>✓<r> All packages are up to date!"));
            return Ok(Box::default());
        }

        let mut selected = vec![false; packages.len()].into_boxed_slice();
        // Default to all unselected (already false from vec!)

        // Calculate optimal column widths based on terminal width and content
        let columns = Self::calculate_column_widths(packages);

        // Get terminal size for viewport and width optimization
        let terminal_size = Self::get_terminal_size();

        let mut state = MultiSelectState {
            packages,
            selected: &mut selected,
            cursor: 0,
            viewport_start: 0,
            viewport_height: terminal_size.height,
            toggle_all: false,
            max_name_len: columns.name,
            max_current_len: columns.current,
            max_update_len: columns.target,
            max_latest_len: columns.latest,
            max_workspace_len: columns.workspace,
            show_workspace: columns.show_workspace, // Show workspace if packages have workspaces
        };

        // Set raw mode
        #[cfg(windows)]
        let original_mode: Option<bun_sys::windows::DWORD> = bun_sys::windows::update_stdio_mode_flags(
            bun_sys::windows::StdioHandle::StdIn,
            bun_sys::windows::ModeFlags {
                set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                    | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
            },
        )
        .ok();

        #[cfg(unix)]
        let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Raw);

        let _restore = scopeguard::guard((), |_| {
            #[cfg(windows)]
            {
                if let Some(mode) = original_mode {
                    // SAFETY: stdin handle is valid for the process lifetime.
                    let _ = unsafe {
                        bun_sys::c::SetConsoleMode(bun_sys::Fd::stdin().native(), mode)
                    };
                }
            }
            #[cfg(unix)]
            {
                let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Normal);
            }
        });

        let result = match Self::process_multi_select(&mut state, terminal_size) {
            Ok(r) => r,
            Err(err) => {
                if err == bun_core::err!("EndOfStream") {
                    Output::flush();
                    Output::prettyln(format_args!("\n<r><red>x<r> Cancelled"));
                    Global::exit(0);
                }
                return Err(err);
            }
        };

        Output::flush();
        // PORT NOTE: reshaped for borrowck — Zig returns the same `selected` slice via state;
        // we clone the borrowed slice into an owned Box here.
        Ok(Box::from(result))
    }

    fn ensure_cursor_in_viewport(state: &mut MultiSelectState<'_>) {
        // If cursor is not in viewport, position it sensibly
        if state.cursor < state.viewport_start {
            // Cursor is above viewport - put it at the start of viewport
            state.cursor = state.viewport_start;
        } else if state.cursor >= state.viewport_start + state.viewport_height {
            // Cursor is below viewport - put it at the end of viewport
            if !state.packages.is_empty() {
                let max_cursor = if state.packages.len() > 1 {
                    state.packages.len() - 1
                } else {
                    0
                };
                let viewport_end = state.viewport_start + state.viewport_height;
                state.cursor = (viewport_end - 1).min(max_cursor);
            }
        }
    }

    fn update_viewport(state: &mut MultiSelectState<'_>) {
        // Ensure cursor is visible with context (2 packages below, 2 above if possible)
        let context_below: usize = 2;
        let context_above: usize = 1;

        // If cursor is below viewport
        if state.cursor >= state.viewport_start + state.viewport_height {
            // Scroll down to show cursor with context
            let desired_start = if state.cursor + context_below + 1 > state.packages.len() {
                // Can't show full context, align bottom
                if state.packages.len() > state.viewport_height {
                    state.packages.len() - state.viewport_height
                } else {
                    0
                }
            } else {
                // Show cursor with context below
                if state.viewport_height > context_below
                    && state.cursor > state.viewport_height - context_below
                {
                    state.cursor - (state.viewport_height - context_below)
                } else {
                    0
                }
            };

            state.viewport_start = desired_start;
        }
        // If cursor is above viewport
        else if state.cursor < state.viewport_start {
            // Scroll up to show cursor with context above
            if state.cursor >= context_above {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
        // If cursor is near bottom of viewport, adjust to maintain context
        else if state.viewport_height > context_below
            && state.cursor > state.viewport_start + state.viewport_height - context_below
        {
            let max_start = if state.packages.len() > state.viewport_height {
                state.packages.len() - state.viewport_height
            } else {
                0
            };
            let desired_start = if state.viewport_height > context_below {
                state.cursor - (state.viewport_height - context_below)
            } else {
                state.cursor
            };
            state.viewport_start = desired_start.min(max_start);
        }
        // If cursor is near top of viewport, adjust to maintain context
        else if state.cursor < state.viewport_start + context_above && state.viewport_start > 0 {
            if state.cursor >= context_above {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
    }

    fn process_multi_select<'a, 'b>(
        state: &'b mut MultiSelectState<'a>,
        initial_terminal_size: TerminalSize,
    ) -> Result<&'b [bool], bun_core::Error> {
        let colors = Output::enable_ansi_colors_stdout();

        // Clear any previous progress output
        Output::print(format_args!("\r\x1B[2K")); // Clear entire line
        Output::print(format_args!("\x1B[1A\x1B[2K")); // Move up one line and clear it too
        Output::flush();

        // Enable mouse tracking for scrolling (if terminal supports it)
        if colors {
            Output::print(format_args!("\x1b[?25l")); // hide cursor
            Output::print(format_args!("\x1b[?1000h")); // Enable basic mouse tracking
            Output::print(format_args!("\x1b[?1006h")); // Enable SGR extended mouse mode
        }
        let _restore_mouse = scopeguard::guard((), move |_| {
            if colors {
                Output::print(format_args!("\x1b[?25h")); // show cursor
                Output::print(format_args!("\x1b[?1000l")); // Disable mouse tracking
                Output::print(format_args!("\x1b[?1006l")); // Disable SGR extended mouse mode
            }
        });

        let mut initial_draw = true;
        let mut reprint_menu = true;
        let mut total_lines: usize = 0;
        let mut last_terminal_width = initial_terminal_size.width;
        // TODO(port): errdefer reprint_menu = false; — handled inline below by setting before early return on error.
        // TODO(port): defer block that uses state.selected — moved to explicit calls before each return.

        macro_rules! cleanup_and_reprint {
            ($reprint:expr) => {{
                if !initial_draw {
                    Output::up(total_lines);
                }
                Output::clear_to_end();
                if $reprint {
                    let mut count: usize = 0;
                    for &sel in state.selected.iter() {
                        if sel {
                            count += 1;
                        }
                    }
                    Output::prettyln(format_args!(
                        "<r><green>✓<r> Selected {} package{} to update",
                        count,
                        if count == 1 { "" } else { "s" }
                    ));
                }
            }};
        }

        loop {
            // Check for terminal resize
            let current_size = Self::get_terminal_size();
            if current_size.width != last_terminal_width {
                // Terminal was resized, update viewport and redraw
                state.viewport_height = current_size.height;
                let columns = Self::calculate_column_widths(state.packages);
                state.show_workspace = columns.show_workspace && current_size.width > 100;
                state.max_name_len = columns.name;
                state.max_current_len = columns.current;
                state.max_update_len = columns.target;
                state.max_latest_len = columns.latest;
                state.max_workspace_len = columns.workspace;
                last_terminal_width = current_size.width;
                Self::update_viewport(state);
                // Force full redraw
                initial_draw = true;
            }

            // The render body
            {
                let synchronized = Output::synchronized();
                let _sync_end = scopeguard::guard(synchronized, |s| s.end());

                if !initial_draw {
                    Output::up(total_lines);
                    Output::print(format_args!("\x1B[1G"));
                    Output::clear_to_end();
                }
                initial_draw = false;

                let help_text: &[u8] = b"Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest";
                let elipsised_help_text = Self::truncate_with_ellipsis(
                    help_text,
                    current_size.width - b"? Select packages to update - ".len(),
                    true,
                );
                Output::prettyln(format_args!(
                    "<r><cyan>?<r> Select packages to update<d> - {}<r>",
                    BStr::new(&elipsised_help_text)
                ));

                // Calculate how many lines the prompt will actually take due to terminal wrapping
                total_lines = 1;

                // Calculate available space for packages (reserve space for scroll indicators if needed)
                let needs_scrolling = state.packages.len() > state.viewport_height;
                let show_top_indicator = needs_scrolling && state.viewport_start > 0;

                // First calculate preliminary viewport end to determine if we need bottom indicator
                let preliminary_viewport_end =
                    (state.viewport_start + state.viewport_height).min(state.packages.len());
                let show_bottom_indicator =
                    needs_scrolling && preliminary_viewport_end < state.packages.len();

                // const is_bottom_scroll = needs_scrolling and state.viewport_start + state.viewport_height <= state.packages.len;

                // Show top scroll indicator if needed
                if show_top_indicator {
                    Output::pretty(format_args!(
                        "  <d>↑ {} more package{} above<r>",
                        state.viewport_start,
                        if state.viewport_start == 1 { "" } else { "s" }
                    ));
                }

                // Calculate how many packages we can actually display
                // The simple approach: just try to show viewport_height packages
                // The display loop will stop when it runs out of room
                let viewport_end =
                    (state.viewport_start + state.viewport_height).min(state.packages.len());

                // Group by dependency type
                let mut current_dep_type: Option<&'static [u8]> = None;

                // Track how many lines we've actually displayed (headers take 2 lines)
                let mut lines_displayed: usize = 0;
                let mut packages_displayed: usize = 0;

                // Only display packages within viewport
                for i in state.viewport_start..viewport_end {
                    let pkg = &state.packages[i];
                    let selected = state.selected[i];

                    // Check if we need a header and if we have room for it
                    let needs_header = current_dep_type.is_none()
                        || !strings::eql(current_dep_type.unwrap(), pkg.dependency_type);

                    // Print dependency type header with column headers if changed
                    if needs_header {
                        // Count selected packages in this dependency type
                        let mut selected_count: usize = 0;
                        debug_assert_eq!(state.packages.len(), state.selected.len());
                        for (p, &sel) in state.packages.iter().zip(state.selected.iter()) {
                            if strings::eql(p.dependency_type, pkg.dependency_type) && sel {
                                selected_count += 1;
                            }
                        }

                        // Print dependency type - bold if any selected
                        Output::print(format_args!("\n  "));
                        if selected_count > 0 {
                            Output::pretty(format_args!(
                                "<r><b>{} {}<r>",
                                BStr::new(pkg.dependency_type),
                                selected_count
                            ));
                        } else {
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(pkg.dependency_type)));
                        }

                        // Calculate padding to align column headers with values
                        let mut j: usize = 0;
                        // Calculate actual displayed text length including count if present
                        let dep_type_text_len: usize = if selected_count > 0 {
                            // TODO(port): std.fmt.count("{d}") — count decimal digits
                            pkg.dependency_type.len() + 1 + bun_core::fmt::count_digits(selected_count) // +1 for space
                        } else {
                            pkg.dependency_type.len()
                        };

                        // The padding should align with the first character of package names
                        // Package names start at: "    " (4 spaces) + "□ " (2 chars) = 6 chars from left
                        // Headers start at: "  " (2 spaces) + dep_type_text
                        // We need the headers to align where the current version column starts
                        // That's at: 6 (start of names) + max_name_len + 2 (spacing after names) - 2 (header indent) - dep_type_text_len
                        let total_offset = 6 + state.max_name_len + 2;
                        let header_start = 2 + dep_type_text_len;
                        let padding_to_current = if header_start >= total_offset {
                            1
                        } else {
                            total_offset - header_start
                        };
                        while j < padding_to_current {
                            Output::print(format_args!(" "));
                            j += 1;
                        }

                        // Column headers aligned with their columns
                        Output::print(format_args!("Current"));
                        j = 0;
                        while j < state.max_current_len - b"Current".len() + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        Output::print(format_args!("Target"));
                        j = 0;
                        while j < state.max_update_len - b"Target".len() + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        Output::print(format_args!("Latest"));
                        if state.show_workspace {
                            j = 0;
                            while j < state.max_latest_len - b"Latest".len() + 2 {
                                Output::print(format_args!(" "));
                                j += 1;
                            }
                            Output::print(format_args!("Workspace"));
                        }
                        Output::print(format_args!("\x1B[0K\n"));

                        lines_displayed += 2;
                        current_dep_type = Some(pkg.dependency_type);
                    }

                    let is_cursor = i == state.cursor;
                    let checkbox: &str = if selected { "■" } else { "□" };

                    // Calculate padding - account for dev/peer/optional tags
                    let mut dev_tag_len: usize = 0;
                    if pkg.behavior.dev {
                        dev_tag_len = 4; // " dev"
                    } else if pkg.behavior.peer {
                        dev_tag_len = 5; // " peer"
                    } else if pkg.behavior.optional {
                        dev_tag_len = 9; // " optional"
                    }
                    let total_name_len = pkg.name.len() + dev_tag_len;
                    let name_padding = if total_name_len >= state.max_name_len {
                        0
                    } else {
                        state.max_name_len - total_name_len
                    };

                    // Determine version change severity for checkbox color
                    let current_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.current_version,
                        &pkg.current_version,
                    ));
                    let update_ver_parsed = if pkg.use_latest {
                        semver::Version::parse(SlicedString::init(
                            &pkg.latest_version,
                            &pkg.latest_version,
                        ))
                    } else {
                        semver::Version::parse(SlicedString::init(
                            &pkg.update_version,
                            &pkg.update_version,
                        ))
                    };

                    let mut checkbox_color: &str = "green"; // default
                    if current_ver_parsed.valid && update_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let update_full = semver::Version {
                            major: update_ver_parsed.version.major.unwrap_or(0),
                            minor: update_ver_parsed.version.minor.unwrap_or(0),
                            patch: update_ver_parsed.version.patch.unwrap_or(0),
                            tag: update_ver_parsed.version.tag,
                        };

                        let target_ver_str: &[u8] = if pkg.use_latest {
                            &pkg.latest_version
                        } else {
                            &pkg.update_version
                        };
                        let diff = update_full.which_version_is_different(
                            &current_full,
                            target_ver_str,
                            &pkg.current_version,
                        );
                        if let Some(d) = diff {
                            match d {
                                semver::VersionDiff::Major => checkbox_color = "red",
                                semver::VersionDiff::Minor => {
                                    if current_full.major == 0 {
                                        checkbox_color = "red"; // 0.x.y minor changes are breaking
                                    } else {
                                        checkbox_color = "yellow";
                                    }
                                }
                                semver::VersionDiff::Patch => {
                                    if current_full.major == 0 && current_full.minor == 0 {
                                        checkbox_color = "red"; // 0.0.x patch changes are breaking
                                    } else {
                                        checkbox_color = "green";
                                    }
                                }
                                _ => checkbox_color = "green",
                            }
                        }
                    }

                    // Cursor and checkbox
                    if is_cursor {
                        Output::pretty(format_args!("  <r><cyan>❯<r> "));
                    } else {
                        Output::print(format_args!("    "));
                    }

                    // Checkbox with appropriate color
                    if selected {
                        if checkbox_color == "red" {
                            Output::pretty(format_args!("<r><red>{}<r> ", checkbox));
                        } else if checkbox_color == "yellow" {
                            Output::pretty(format_args!("<r><yellow>{}<r> ", checkbox));
                        } else {
                            Output::pretty(format_args!("<r><green>{}<r> ", checkbox));
                        }
                    } else {
                        Output::print(format_args!("{} ", checkbox));
                    }

                    // Package name - truncate if needed and make it a hyperlink if colors are enabled and using default registry
                    // Calculate available space for name (accounting for dev/peer/optional tags)
                    let available_name_width = if state.max_name_len > dev_tag_len {
                        state.max_name_len - dev_tag_len
                    } else {
                        state.max_name_len
                    };
                    let display_name =
                        Self::truncate_with_ellipsis(&pkg.name, available_name_width, false);

                    let uses_default_registry = pkg.manager.options.scope.url_hash
                        == bun_install::npm::Registry::DEFAULT_URL_HASH
                        && pkg.manager.scope_for_package_name(&pkg.name).url_hash
                            == bun_install::npm::Registry::DEFAULT_URL_HASH;
                    let package_url: Box<[u8]> = if Output::enable_ansi_colors_stdout()
                        && uses_default_registry
                    {
                        let ver: &[u8] = 'brk: {
                            if selected {
                                if pkg.use_latest {
                                    break 'brk &pkg.latest_version;
                                } else {
                                    break 'brk &pkg.update_version;
                                }
                            } else {
                                break 'brk &pkg.current_version;
                            }
                        };
                        let mut v = Vec::new();
                        write!(
                            &mut v,
                            "https://npmjs.org/package/{}/v/{}",
                            BStr::new(&pkg.name),
                            BStr::new(ver)
                        )
                        .unwrap();
                        v.into_boxed_slice()
                    } else {
                        Box::default()
                    };

                    let hyperlink =
                        TerminalHyperlink::new(&package_url, &display_name, !package_url.is_empty());

                    if selected {
                        if checkbox_color == "red" {
                            Output::pretty(format_args!("<r><red>{}<r>", hyperlink));
                        } else if checkbox_color == "yellow" {
                            Output::pretty(format_args!("<r><yellow>{}<r>", hyperlink));
                        } else {
                            Output::pretty(format_args!("<r><green>{}<r>", hyperlink));
                        }
                    } else {
                        Output::pretty(format_args!("<r>{}<r>", hyperlink));
                    }

                    // Print dev/peer/optional tag if applicable
                    if pkg.behavior.dev {
                        Output::pretty(format_args!("<r><d> dev<r>"));
                    } else if pkg.behavior.peer {
                        Output::pretty(format_args!("<r><d> peer<r>"));
                    } else if pkg.behavior.optional {
                        Output::pretty(format_args!("<r><d> optional<r>"));
                    }

                    // Print padding after name (2 spaces)
                    let mut j: usize = 0;
                    while j < name_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Current version - truncate if needed
                    let truncated_current = Self::truncate_with_ellipsis(
                        &pkg.current_version,
                        state.max_current_len,
                        false,
                    );
                    Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_current)));

                    // Print padding after current version (2 spaces)
                    let current_padding = if truncated_current.len() >= state.max_current_len {
                        0
                    } else {
                        state.max_current_len - truncated_current.len()
                    };
                    j = 0;
                    while j < current_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Target version with diffFmt coloring - bold if not using latest
                    let target_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.update_version,
                        &pkg.update_version,
                    ));

                    // Truncate target version if needed
                    let truncated_target = Self::truncate_with_ellipsis(
                        &pkg.update_version,
                        state.max_update_len,
                        false,
                    );

                    // For width calculation, use the truncated version string length
                    let target_width: usize = truncated_target.len();

                    if current_ver_parsed.valid && target_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let target_full = semver::Version {
                            major: target_ver_parsed.version.major.unwrap_or(0),
                            minor: target_ver_parsed.version.minor.unwrap_or(0),
                            patch: target_ver_parsed.version.patch.unwrap_or(0),
                            tag: target_ver_parsed.version.tag,
                        };

                        // Print target version (use truncated version for narrow terminals)
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        if truncated_target.len() < pkg.update_version.len() {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_target)));
                        } else {
                            // Use diffFmt for full versions
                            Output::pretty(format_args!(
                                "{}",
                                target_full.diff_fmt(
                                    &current_full,
                                    &pkg.update_version,
                                    &pkg.current_version,
                                )
                            ));
                        }
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                    } else {
                        // Fallback if version parsing fails
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_target)));
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                    }

                    let target_padding = if target_width >= state.max_update_len {
                        0
                    } else {
                        state.max_update_len - target_width
                    };
                    j = 0;
                    while j < target_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Latest version with diffFmt coloring - bold if using latest
                    let latest_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.latest_version,
                        &pkg.latest_version,
                    ));

                    // Truncate latest version if needed
                    let truncated_latest = Self::truncate_with_ellipsis(
                        &pkg.latest_version,
                        state.max_latest_len,
                        false,
                    );
                    if current_ver_parsed.valid && latest_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let latest_full = semver::Version {
                            major: latest_ver_parsed.version.major.unwrap_or(0),
                            minor: latest_ver_parsed.version.minor.unwrap_or(0),
                            patch: latest_ver_parsed.version.patch.unwrap_or(0),
                            tag: latest_ver_parsed.version.tag,
                        };

                        // Dim if latest matches target version
                        let is_same_as_target =
                            strings::eql(&pkg.latest_version, &pkg.update_version);
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[2m")); // Dim
                        }
                        // Print latest version
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        if truncated_latest.len() < pkg.latest_version.len() {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_latest)));
                        } else {
                            // Use diffFmt for full versions
                            Output::pretty(format_args!(
                                "{}",
                                latest_full.diff_fmt(
                                    &current_full,
                                    &pkg.latest_version,
                                    &pkg.current_version,
                                )
                            ));
                        }
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[22m")); // Reset dim
                        }
                    } else {
                        // Fallback if version parsing fails
                        let is_same_as_target =
                            strings::eql(&pkg.latest_version, &pkg.update_version);
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[2m")); // Dim
                        }
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_latest)));
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[22m")); // Reset dim
                        }
                    }

                    // Workspace column
                    if state.show_workspace {
                        let latest_width: usize = truncated_latest.len();
                        let latest_padding = if latest_width >= state.max_latest_len {
                            0
                        } else {
                            state.max_latest_len - latest_width
                        };
                        j = 0;
                        while j < latest_padding + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        // Truncate workspace name if needed
                        let truncated_workspace = Self::truncate_with_ellipsis(
                            &pkg.workspace_name,
                            state.max_workspace_len,
                            true,
                        );
                        Output::pretty(format_args!(
                            "<r><d>{}<r>",
                            BStr::new(&truncated_workspace)
                        ));
                    }

                    Output::print(format_args!("\x1B[0K\n"));
                    lines_displayed += 1;
                    packages_displayed += 1;
                }

                let _ = packages_displayed;

                // Show bottom scroll indicator if needed
                if show_bottom_indicator {
                    Output::pretty(format_args!(
                        "  <d>↓ {} more package{} below<r>",
                        state.packages.len() - viewport_end,
                        if state.packages.len() - viewport_end == 1 { "" } else { "s" }
                    ));
                    lines_displayed += 1;
                }

                total_lines = lines_displayed + 1;
                Output::clear_to_end();
            }
            Output::flush();

            // Read input
            // TODO(port): std.fs.File.stdin().readerStreaming — use bun_sys stdin byte reader
            let mut reader = bun_sys::stdin_reader();
            let byte = match reader.take_byte() {
                Ok(b) => b,
                Err(_) => {
                    cleanup_and_reprint!(reprint_menu);
                    return Ok(state.selected);
                }
            };

            match byte {
                b'\n' | b'\r' => {
                    cleanup_and_reprint!(reprint_menu);
                    return Ok(state.selected);
                }
                3 | 4 => {
                    // ctrl+c, ctrl+d
                    reprint_menu = false;
                    cleanup_and_reprint!(reprint_menu);
                    return Err(bun_core::err!("EndOfStream"));
                }
                b' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    // if the package only has a latest version, then we should toggle the latest version instead of update
                    if strings::eql(
                        &state.packages[state.cursor].current_version,
                        &state.packages[state.cursor].update_version,
                    ) {
                        state.packages[state.cursor].use_latest = true;
                    }
                    state.toggle_all = false;
                    // Don't move cursor on space - let user manually navigate
                }
                b'a' | b'A' => {
                    state.selected.fill(true);
                    // For packages where current == update version, auto-set use_latest
                    // so they get updated to the latest version (matching spacebar behavior)
                    for pkg in state.packages.iter_mut() {
                        if strings::eql(&pkg.current_version, &pkg.update_version) {
                            pkg.use_latest = true;
                        }
                    }
                    state.toggle_all = true; // Mark that 'a' was used
                }
                b'n' | b'N' => {
                    state.selected.fill(false);
                    state.toggle_all = false; // Reset toggle_all mode
                }
                b'i' | b'I' => {
                    // Invert selection
                    for sel in state.selected.iter_mut() {
                        *sel = !*sel;
                    }
                    state.toggle_all = false; // Reset toggle_all mode
                }
                b'l' | b'L' => {
                    // Only affect all packages if 'a' (select all) was used
                    // Otherwise, just toggle the current cursor package
                    if state.toggle_all {
                        // All packages were selected with 'a', so toggle latest for all selected packages
                        let new_latest_state = !state.packages[state.cursor].use_latest;
                        debug_assert_eq!(state.selected.len(), state.packages.len());
                        for (sel, pkg) in state.selected.iter().zip(state.packages.iter_mut()) {
                            if *sel {
                                pkg.use_latest = new_latest_state;
                            }
                        }
                    } else {
                        // Individual selection mode, just toggle current cursor package and select it
                        state.packages[state.cursor].use_latest =
                            !state.packages[state.cursor].use_latest;
                        state.selected[state.cursor] = true;
                    }
                }
                b'j' => {
                    if state.cursor < state.packages.len() - 1 {
                        state.cursor += 1;
                    } else {
                        state.cursor = 0;
                    }
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                b'k' => {
                    if state.cursor > 0 {
                        state.cursor -= 1;
                    } else {
                        state.cursor = state.packages.len() - 1;
                    }
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                27 => {
                    // escape sequence
                    let Ok(seq) = reader.take_byte() else { continue };
                    if seq == b'[' {
                        let Ok(arrow) = reader.take_byte() else { continue };
                        match arrow {
                            b'A' => {
                                // up arrow
                                if state.cursor > 0 {
                                    state.cursor -= 1;
                                } else {
                                    state.cursor = state.packages.len() - 1;
                                }
                                Self::update_viewport(state);
                            }
                            b'B' => {
                                // down arrow
                                if state.cursor < state.packages.len() - 1 {
                                    state.cursor += 1;
                                } else {
                                    state.cursor = 0;
                                }
                                Self::update_viewport(state);
                            }
                            b'C' => {
                                // right arrow - switch to Latest version and select
                                state.packages[state.cursor].use_latest = true;
                                state.selected[state.cursor] = true;
                            }
                            b'D' => {
                                // left arrow - switch to Target version and select
                                state.packages[state.cursor].use_latest = false;
                                state.selected[state.cursor] = true;
                            }
                            b'5' => {
                                // Page Up
                                let Ok(tilde) = reader.take_byte() else { continue };
                                if tilde == b'~' {
                                    // Move up by viewport height
                                    if state.cursor >= state.viewport_height {
                                        state.cursor -= state.viewport_height;
                                    } else {
                                        state.cursor = 0;
                                    }
                                    Self::update_viewport(state);
                                }
                            }
                            b'6' => {
                                // Page Down
                                let Ok(tilde) = reader.take_byte() else { continue };
                                if tilde == b'~' {
                                    // Move down by viewport height
                                    if state.cursor + state.viewport_height < state.packages.len() {
                                        state.cursor += state.viewport_height;
                                    } else {
                                        state.cursor = state.packages.len() - 1;
                                    }
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
                                        let mut parts = buffer[0..buf_idx]
                                            .split(|b| *b == b';')
                                            .filter(|s| !s.is_empty());
                                        if let Some(button_str) = parts.next() {
                                            // TODO(port): replace inline fold with shared bun_str parse_int helper
                                            // std.fmt.parseInt(u32, _, 10) on raw bytes — terminal
                                            // input is bytes, do not round-trip through from_utf8.
                                            let button: u32 = button_str
                                                .iter()
                                                .try_fold(0u32, |acc, &b| match b {
                                                    b'0'..=b'9' => acc
                                                        .checked_mul(10)
                                                        .and_then(|a| a.checked_add((b - b'0') as u32)),
                                                    _ => None,
                                                })
                                                .unwrap_or(0);
                                            // Mouse wheel events
                                            if button == 64 {
                                                // Scroll up
                                                if state.viewport_start > 0 {
                                                    // Scroll up by 3 lines
                                                    let scroll_amount =
                                                        1usize.min(state.viewport_start);
                                                    state.viewport_start -= scroll_amount;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
                                            } else if button == 65 {
                                                // Scroll down
                                                if state.viewport_start + state.viewport_height
                                                    < state.packages.len()
                                                {
                                                    // Scroll down by 3 lines
                                                    let max_scroll = state.packages.len()
                                                        - (state.viewport_start
                                                            + state.viewport_height);
                                                    let scroll_amount = 1usize.min(max_scroll);
                                                    state.viewport_start += scroll_amount;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
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

/// Edit catalog definitions in package.json
pub fn edit_catalog_definitions(
    manager: &mut PackageManager,
    updates: &mut [CatalogUpdateRequest],
    current_package_json: &mut Expr,
) -> Result<(), bun_core::Error> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr::Disabler::disable();
    let _reenable = scopeguard::guard((), |_| Expr::Disabler::enable());

    let _ = manager; // allocator removed in Rust port

    for update in updates.iter() {
        if let Some(catalog_name) = &update.catalog_name {
            update_named_catalog(
                current_package_json,
                catalog_name,
                &update.package_name,
                &update.new_version,
            )?;
        } else {
            update_default_catalog(
                current_package_json,
                &update.package_name,
                &update.new_version,
            )?;
        }
    }
    Ok(())
}

fn update_default_catalog(
    package_json: &mut Expr,
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalog object
    // First check if catalog is under workspaces.catalog
    let mut catalog_obj = 'brk: {
        if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
            if let bun_js_parser::ast::ExprData::EObject(_) = &workspaces_query.expr.data {
                if let Some(catalog_query) = workspaces_query.expr.as_property(b"catalog") {
                    if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.expr.data {
                        break 'brk obj.clone();
                    }
                }
            }
        }
        // Fallback to root-level catalog
        if let Some(catalog_query) = package_json.as_property(b"catalog") {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.expr.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get original version to preserve prefix if it exists
    let mut version_with_prefix: Box<[u8]> = Box::from(new_version);
    if let Some(existing_prop) = catalog_obj.get(package_name) {
        if let bun_js_parser::ast::ExprData::EString(e_string) = &existing_prop.data {
            let original_version = &e_string.data;
            version_with_prefix = preserve_version_prefix(original_version, new_version)?;
        }
    }

    // Update or add the package version
    let new_expr = Expr::allocate(E::String { data: version_with_prefix }, logger::Loc::EMPTY);
    catalog_obj.put(package_name, new_expr)?;

    // Check if we need to update under workspaces.catalog or root-level catalog
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let bun_js_parser::ast::ExprData::EObject(ws_obj) = &mut workspaces_query.expr.data {
            if workspaces_query.expr.as_property(b"catalog").is_some() {
                // Update under workspaces.catalog
                ws_obj.put(
                    b"catalog",
                    Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
                )?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if let bun_js_parser::ast::ExprData::EObject(root_obj) = &mut package_json.data {
        root_obj.put(
            b"catalog",
            Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
        )?;
    }
    Ok(())
}

fn update_named_catalog(
    package_json: &mut Expr,
    catalog_name: &[u8],
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalogs object
    // First check if catalogs is under workspaces.catalogs (newer structure)
    let mut catalogs_obj = 'brk: {
        if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
            if let bun_js_parser::ast::ExprData::EObject(_) = &workspaces_query.expr.data {
                if let Some(catalogs_query) = workspaces_query.expr.as_property(b"catalogs") {
                    if let bun_js_parser::ast::ExprData::EObject(obj) = &catalogs_query.expr.data {
                        break 'brk obj.clone();
                    }
                }
            }
        }
        // Fallback to root-level catalogs
        if let Some(catalogs_query) = package_json.as_property(b"catalogs") {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalogs_query.expr.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get or create the specific catalog
    let mut catalog_obj = 'brk: {
        if let Some(catalog_query) = catalogs_obj.get(catalog_name) {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get original version to preserve prefix if it exists
    let mut version_with_prefix: Box<[u8]> = Box::from(new_version);
    if let Some(existing_prop) = catalog_obj.get(package_name) {
        if let bun_js_parser::ast::ExprData::EString(e_string) = &existing_prop.data {
            let original_version = &e_string.data;
            version_with_prefix = preserve_version_prefix(original_version, new_version)?;
        }
    }

    // Update or add the package version
    let new_expr = Expr::allocate(E::String { data: version_with_prefix }, logger::Loc::EMPTY);
    catalog_obj.put(package_name, new_expr)?;

    // Update the catalog in catalogs object
    catalogs_obj.put(
        catalog_name,
        Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
    )?;

    // Check if we need to update under workspaces.catalogs or root-level catalogs
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let bun_js_parser::ast::ExprData::EObject(ws_obj) = &mut workspaces_query.expr.data {
            if workspaces_query.expr.as_property(b"catalogs").is_some() {
                // Update under workspaces.catalogs
                ws_obj.put(
                    b"catalogs",
                    Expr::allocate(E::Object::from(catalogs_obj), logger::Loc::EMPTY),
                )?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if let bun_js_parser::ast::ExprData::EObject(root_obj) = &mut package_json.data {
        root_obj.put(
            b"catalogs",
            Expr::allocate(E::Object::from(catalogs_obj), logger::Loc::EMPTY),
        )?;
    }
    Ok(())
}

fn preserve_version_prefix(
    original_version: &[u8],
    new_version: &[u8],
) -> Result<Box<[u8]>, bun_core::Error> {
    if original_version.len() > 1 {
        let mut orig_version: &[u8] = original_version;
        let mut alias: Option<&[u8]> = None;

        // Preserve npm: prefix
        if let Some(after_npm) = strings::without_prefix_if_possible(original_version, b"npm:") {
            if let Some(i) = strings::last_index_of_char(after_npm, b'@') {
                alias = Some(&after_npm[0..i]);
                if i + 2 < after_npm.len() {
                    orig_version = &after_npm[i + 1..];
                }
            } else {
                alias = Some(after_npm);
            }
        }

        // Preserve other version prefixes
        let first_char = orig_version[0];
        if first_char == b'^'
            || first_char == b'~'
            || first_char == b'>'
            || first_char == b'<'
            || first_char == b'='
        {
            let second_char = orig_version[1];
            if (first_char == b'>' || first_char == b'<') && second_char == b'=' {
                if let Some(a) = alias {
                    let mut v = Vec::new();
                    write!(
                        &mut v,
                        "npm:{}@{}={}",
                        BStr::new(a),
                        first_char as char,
                        BStr::new(new_version)
                    )
                    .unwrap();
                    return Ok(v.into_boxed_slice());
                }
                let mut v = Vec::new();
                write!(&mut v, "{}={}", first_char as char, BStr::new(new_version)).unwrap();
                return Ok(v.into_boxed_slice());
            }
            if let Some(a) = alias {
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "npm:{}@{}{}",
                    BStr::new(a),
                    first_char as char,
                    BStr::new(new_version)
                )
                .unwrap();
                return Ok(v.into_boxed_slice());
            }
            let mut v = Vec::new();
            write!(&mut v, "{}{}", first_char as char, BStr::new(new_version)).unwrap();
            return Ok(v.into_boxed_slice());
        }
        if let Some(a) = alias {
            let mut v = Vec::new();
            write!(&mut v, "npm:{}@{}", BStr::new(a), BStr::new(new_version)).unwrap();
            return Ok(v.into_boxed_slice());
        }
    }
    Ok(Box::from(new_version))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/update_interactive_command.zig (2062 lines)
//   confidence: medium
//   todos:      8
//   notes:      Heavy bun_install/AST cross-crate types guessed; defer/errdefer in process_multi_select reshaped to inline macro; stdin reader + ioctl/winapi need bun_sys wrappers.
// ──────────────────────────────────────────────────────────────────────────
