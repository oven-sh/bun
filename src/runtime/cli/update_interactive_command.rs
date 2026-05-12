#![allow(dead_code, unused_imports, unused_variables)]

use core::fmt;
use core::fmt::Write as _;
use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::Arena as Bump;
use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_glob as glob;
use bun_install::dependency::{self, Behavior};
use bun_install::lockfile::package::{PackageColumns as _};
use bun_install::lockfile::{LoadResult, LoadStep};
use bun_install::package_manager::{
    self, LogLevel, ManifestCacheOptions, ManifestLoad, ROOT_PACKAGE_JSON_PATH, Subcommand,
    WorkspaceFilter, install_with_manager, populate_manifest_cache,
};
use bun_install::{
    CommandLineArguments, DependencyID, GetJsonOptions, GetJsonResult, INVALID_PACKAGE_ID,
    PackageID, PackageManager, WorkspacePackageJsonCacheEntry, resolution,
};
use bun_install_types::DependencyGroup;
use bun_js_printer::{self as js_printer, BufferPrinter, BufferWriter, PrintJsonOptions};
use bun_resolver::fs::FileSystem;
// PORT NOTE (layering): `Expr`/`E` here are the *lower-tier* `bun_ast::js_ast`
// types, NOT `bun_js_parser`. `WorkspacePackageJsonCacheEntry.root` is the
// logger-tier `Expr` (see WorkspacePackageJSONCache.rs), so the catalog-edit
// helpers below must operate on that type. The earlier draft imported
// `bun_ast::Expr`, which is a distinct struct and would not unify
// with `MapEntry.root`.
use bun_ast::Loc;
use bun_ast::{self, self as js_ast, E, Expr, expr as js_expr};
use bun_core::strings;
use bun_paths::{self as path, PathBuffer};
use bun_semver::{self as semver, SlicedString};

use crate::Command;

pub struct TerminalHyperlink<'a> {
    link: &'a [u8],
    text: &'a [u8],
    enabled: bool,
}

impl<'a> TerminalHyperlink<'a> {
    pub fn new(link: &'a [u8], text: &'a [u8], enabled: bool) -> TerminalHyperlink<'a> {
        TerminalHyperlink {
            link,
            text,
            enabled,
        }
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

struct OutdatedPackage {
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
    /// Snapshot of `manager.options.scope.url_hash == DEFAULT_URL_HASH &&
    /// manager.scope_for_package_name(name).url_hash == DEFAULT_URL_HASH`.
    ///
    /// PORT NOTE: Zig stores `*PackageManager` here and reads
    /// `pkg.manager.options.scope` / `scopeForPackageName(pkg.name)` at render
    /// time. In Rust the caller's exclusive `&mut PackageManager` in
    /// `update_interactive` is live across the prompt loop, so any
    /// `&PackageManager` derived from a stored back-pointer would alias an
    /// outstanding `&mut` (Stacked-Borrows UB). Both reads are pure
    /// `Options`-derived `u64` comparisons that cannot change between
    /// construction and render, so snapshot the boolean at construction and
    /// drop the back-pointer entirely.
    uses_default_registry: bool,
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

struct MultiSelectState<'s> {
    packages: &'s mut [OutdatedPackage],
    selected: &'s mut [bool],
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

    // Helper to update a catalog entry at a specific path in the package.json AST
    // PORT NOTE: Zig threads `*PackageManager` only for `manager.allocator`;
    // the Rust port has no per-manager allocator, so the parameter is dropped.
    // This also avoids overlapping `&mut PackageManager` with the live
    // `&mut MapEntry` borrow of `manager.workspace_package_json_cache` at the
    // call sites (which the previous draft laundered via raw pointers — UB
    // under Stacked Borrows).
    fn save_package_json(
        package_json: &mut WorkspacePackageJsonCacheEntry,
        package_json_path: &[u8],
    ) -> Result<(), bun_core::Error> {
        let preserve_trailing_newline = !package_json.source.contents.is_empty()
            && *package_json.source.contents.last().unwrap() == b'\n';

        let mut buffer_writer = BufferWriter::init();
        buffer_writer
            .buffer
            .list
            .reserve(package_json.source.contents.len() + 1);
        buffer_writer.append_newline = preserve_trailing_newline;
        let mut package_json_writer = BufferPrinter::init(buffer_writer);

        // PORT NOTE (layering): `MapEntry.root` is the T2 `bun_ast::Expr`;
        // `js_printer::print_json` consumes the T4 `bun_ast::Expr`. Lift via
        // the existing `From<T2> for T4` deep-rebuild (same as
        // `updatePackageJSONAndInstall` / pnpm migration). The T2 entry is not
        // re-read — only `source.contents` is written back below.
        if let Err(err) = js_printer::print_json(
            &mut package_json_writer,
            package_json.root.into(),
            &package_json.source,
            PrintJsonOptions {
                indent: package_json.indentation,
                mangled_props: None,
                ..Default::default()
            },
        ) {
            Output::err_generic("Failed to serialize package.json: {s}", (err.name(),));
            return Err(err);
        }

        let new_package_json_source: Box<[u8]> =
            Box::from(package_json_writer.ctx.written_without_trailing_zero());

        // Write the updated package.json
        // PORT NOTE: Zig used `std.fs.cwd().createFile(path).writeAll(..)`; the
        // Rust port routes through `bun_sys::File::write_file` (cwd-relative
        // open + write + close) per src/CLAUDE.md.
        let mut path_zbuf = PathBuffer::uninit();
        let path_z = path::resolve_path::z(package_json_path, &mut path_zbuf);
        if let Err(err) =
            bun_sys::File::write_file(bun_sys::Fd::cwd(), path_z, &new_package_json_source)
        {
            Output::err_generic(
                "Failed to write package.json at {s}: {s}",
                (BStr::new(package_json_path), BStr::new(err.name())),
            );
            return Err(err.into());
        }

        // Update the cache so installWithManager sees the new package.json
        // This is critical - without this, installWithManager will use the cached old version
        //
        // PORT NOTE: `Source.contents` is `Cow<'static, [u8]>`. The cached
        // `root` AST's `EString.data` slices (every JSON key/value string)
        // borrow the *old* contents buffer — `deep_clone` copies the slice,
        // not the bytes. Zig overwrote `source.contents` as a raw slice and
        // leaked the old buffer; assigning a new `Cow::Owned` here would drop
        // it and leave every cached string dangling, which
        // `process_workspace_name` then dereferences via `root.get("name")`
        // during `installWithManager`. Leak the old buffer to match Zig.
        // PERF(port): `WorkspacePackageJSONCache` is process-lifetime; both
        // buffers live for the process anyway.
        let old = core::mem::replace(
            &mut package_json.source.contents,
            Cow::Owned(new_package_json_source.into_vec()),
        );
        core::mem::forget(old);
        Ok(())
    }

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::prettyln(format_args!(
            "<r><b>bun update --interactive <r><d>v{}<r>",
            Global::package_json_version_with_sha
        ));
        Output::flush();

        let cli = CommandLineArguments::parse(Subcommand::Update)?;
        let silent = cli.silent;

        let (manager, original_cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Update)
        {
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
        // `original_cwd: Box<[u8]>` — `defer ctx.allocator.free(original_cwd)`
        // is implicit via Drop at scope exit.

        Self::update_interactive(ctx, &original_cwd, manager)
    }

    fn update_package_json_files_from_updates(
        manager: &mut PackageManager,
        updates: &[PackageUpdate],
    ) -> Result<(), bun_core::Error> {
        // Group updates by workspace
        let mut workspace_groups: StringHashMap<Vec<usize>> = StringHashMap::default();

        // Group updates by workspace path (store indices to avoid cloning)
        for (i, update) in updates.iter().enumerate() {
            let result = workspace_groups
                .get_or_put(&update.workspace_path)
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
            if !result.found_existing {
                *result.value_ptr = Vec::new();
            }
            result.value_ptr.push(i);
        }

        let bump = Bump::new();

        // Process each workspace
        let mut it = workspace_groups.iter();
        while let Some((workspace_path, workspace_update_idxs)) = it.next() {
            // Build the package.json path for this workspace
            // SAFETY: `FileSystem::init` ran during `PackageManager::init`.
            let root_dir = FileSystem::get().top_level_dir;
            let mut path_buf = PathBuffer::uninit();
            let package_json_path =
                Self::build_package_json_path(root_dir, workspace_path, &mut path_buf);

            // Load and parse the package.json
            // PORT NOTE: reshaped for borrowck — `log_mut()` returns a borrow
            // decoupled from `&self`, so it can overlap the disjoint
            // `workspace_package_json_cache` field borrow below.
            let log = manager.log_mut();
            let package_json: &mut WorkspacePackageJsonCacheEntry =
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
                        continue;
                    }
                    GetJsonResult::ReadErr(err) => {
                        Output::err_generic(
                            "Failed to read package.json at {s}: {s}",
                            (BStr::new(package_json_path), err.name()),
                        );
                        continue;
                    }
                    GetJsonResult::Entry(entry) => entry,
                };

            let mut modified = false;

            // Update each package in this workspace's package.json
            for &idx in workspace_update_idxs {
                let update = &updates[idx];
                // Find the package in the correct dependency section
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
                // Get the original version to preserve prefix
                let original_version = e_str.data.slice();

                // Preserve the version prefix from the original
                let version_with_prefix =
                    preserve_version_prefix(original_version, &update.target_version)?;

                // Update the version using hash map put
                // PORT NOTE: Zig `Expr.init(E.String, …).clone(allocator)` —
                // the `.clone(manager.allocator)` re-allocates the `E.String`
                // *node* outside the resettable Store. `Expr::init` would put
                // it in the Store, which `install_with_manager` resets via
                // `initialize_store()` before re-reading this cached `root`.
                // Allocate into the entry's own `json_arena` instead so the
                // node lives as long as the cached AST. The string *bytes* go
                // through the CLI arena (matches PackageJSONEditor `leak_str`).
                let interned: &'static [u8] = crate::cli::cli_dupe(&version_with_prefix);
                let new_expr = Expr::allocate(
                    &package_json.json_arena,
                    E::EString::init(interned),
                    version_query.expr.loc,
                );
                dep_obj
                    .put(&bump, &update.name, new_expr)
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                modified = true;
            }

            // Write the updated package.json if modified
            if modified {
                Self::save_package_json(package_json, package_json_path)?;
            }
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn update_catalog_definitions(
        manager: &mut PackageManager,
        catalog_updates: &StringHashMap<CatalogUpdate>,
    ) -> Result<(), bun_core::Error> {
        // Group catalog updates by workspace path
        let mut workspace_catalog_updates: StringHashMap<Vec<CatalogUpdateRequest>> =
            StringHashMap::default();

        // Group updates by workspace
        let mut catalog_it = catalog_updates.iter();
        while let Some((catalog_key, update)) = catalog_it.next() {
            let result = workspace_catalog_updates
                .get_or_put(&update.workspace_path)
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
            if !result.found_existing {
                *result.value_ptr = Vec::new();
            }

            // Parse catalog_key (format: "package_name" or "package_name:catalog_name")
            let colon_index = bun_core::index_of(catalog_key, b":");
            let package_name = if let Some(idx) = colon_index {
                &catalog_key[..idx]
            } else {
                &catalog_key[..]
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
        while let Some((workspace_path, updates_for_workspace)) = workspace_it.next() {
            // Build the package.json path for this workspace
            // SAFETY: `FileSystem::init` ran during `PackageManager::init`.
            let root_dir = FileSystem::get().top_level_dir;
            let mut path_buf = PathBuffer::uninit();
            let package_json_path =
                Self::build_package_json_path(root_dir, workspace_path, &mut path_buf);

            // Load and parse the package.json properly
            let log = manager.log_mut();
            let package_json: &mut WorkspacePackageJsonCacheEntry =
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
                        continue;
                    }
                    GetJsonResult::ReadErr(err) => {
                        Output::err_generic(
                            "Failed to read package.json at {s}: {s}",
                            (BStr::new(package_json_path), err.name()),
                        );
                        continue;
                    }
                    GetJsonResult::Entry(entry) => entry,
                };

            // Use the PackageJSONEditor to update catalogs
            edit_catalog_definitions(&mut updates_for_workspace[..], &mut package_json.root)?;

            // Save the updated package.json
            Self::save_package_json(package_json, package_json_path)?;
        }
        Ok(())
    }

    fn update_interactive(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — capture `log_level` / `ctx.log`
        // before borrowing `&mut manager.lockfile`.
        let not_silent = manager.options.log_level != LogLevel::Silent;
        let ctx_log_ptr: *mut bun_ast::Log = ctx.log;

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
                    // SAFETY: `ctx.log` is set by `Command::create_context_data`
                    // for every subcommand and is non-null for the command's
                    // lifetime.
                    if unsafe { (*ctx_log_ptr).has_errors() } {
                        manager
                            .log_mut()
                            .print(std::ptr::from_mut(Output::error_writer()))?;
                    }
                }
                Global::crash();
            }
            LoadResult::Ok(_) => {
                // PORT NOTE: Zig reassigns `manager.lockfile = ok.lockfile`
                // (pointer field). `load_lockfile_from_cwd` populates
                // `manager.lockfile` (Box) in place, so no reassignment.
            }
        }

        let workspace_pkg_ids: Vec<PackageID> = if !manager.options.filter_patterns.is_empty() {
            let filters = manager.options.filter_patterns;
            Self::find_matching_workspaces(original_cwd, manager, filters)
        } else if manager.options.do_.recursive() {
            Self::get_all_workspaces(manager)
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

        // Get outdated packages
        let mut outdated_packages = Self::get_outdated_packages(manager, &workspace_pkg_ids)?;
        // PORT NOTE: `defer { allocator.free(...) }` is implicit via Drop on
        // `Vec<OutdatedPackage>` (Box<[u8]> fields).

        if outdated_packages.is_empty() {
            // No packages need updating - just exit silently
            Output::prettyln(format_args!("<r><green>✓<r> All packages are up to date!"));
            return Ok(());
        }

        // Prompt user to select packages
        let selected = Self::prompt_for_updates(&mut outdated_packages)?;

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
                    .expect("OOM");
                    v.into_boxed_slice()
                } else {
                    pkg.name.clone()
                };

                // For catalog dependencies, we always update the root package.json
                // (or the workspace root where the catalog is defined)
                let catalog_workspace_path: Box<[u8]> = Box::default(); // Always root for now

                catalog_updates.put_assume_capacity(
                    &catalog_key,
                    CatalogUpdate {
                        version: Box::from(target_version),
                        workspace_path: catalog_workspace_path,
                    },
                );
                continue;
            }

            // Get the workspace path for this package
            let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
            let workspace_resolution =
                manager.lockfile.packages.items_resolution()[pkg.workspace_pkg_id as usize];
            let workspace_path: &[u8] = if workspace_resolution.tag == resolution::Tag::Workspace {
                workspace_resolution.workspace().slice(string_buf)
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
        let has_catalog_updates = !catalog_updates.is_empty();

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
                    while let Some((catalog_key, catalog_update)) = it.next() {
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
                ctx.start_time = bun_core::time::nano_timestamp();

                // SAFETY: `ROOT_PACKAGE_JSON_PATH` is set once during
                // `PackageManager::init` (single-threaded CLI startup).
                let root_pkg_json = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
                // PORT NOTE: Zig passes `manager.root_dir.dir` (cwd dir handle);
                // the Rust port of `install_with_manager` takes the original cwd
                // path slice instead. Snapshot before the `&mut manager` borrow.
                let root_dir_path: &'static [u8] = manager.root_dir.dir;
                install_with_manager::install_with_manager(
                    manager,
                    &mut *ctx,
                    root_pkg_json,
                    root_dir_path,
                )?;
            }
        }
        Ok(())
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
                WorkspaceFilter::init(filter, original_cwd, &mut path_buf.0).expect("OOM")
            })
            .collect();
        // `defer { filter.deinit(allocator); allocator.free(...) }` — implicit via Drop.

        // SAFETY: `FileSystem::init` ran during `PackageManager::init`.
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
                                resolution::Tag::Workspace => res.workspace().slice(string_buf),
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
        packages: Vec<OutdatedPackage>,
    ) -> Result<Vec<OutdatedPackage>, bun_core::Error> {
        // Create a map to track catalog dependencies by name
        let mut catalog_map: StringHashMap<Vec<OutdatedPackage>> = StringHashMap::default();

        let mut result: Vec<OutdatedPackage> = Vec::new();

        // Group catalog dependencies
        for pkg in packages {
            if pkg.is_catalog {
                let entry = catalog_map
                    .get_or_put(&pkg.name)
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                if !entry.found_existing {
                    *entry.value_ptr = Vec::new();
                }
                entry.value_ptr.push(pkg);
            } else {
                result.push(pkg);
            }
        }

        // Add grouped catalog dependencies
        // PORT NOTE: `StringHashMap` is a Deref newtype over `std::HashMap` with no
        // owning `IntoIterator`; `.drain()` (via `DerefMut`) yields owned `(K, V)`.
        let mut iter = catalog_map.drain();
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
                let rest: Vec<OutdatedPackage> = catalog_packages.collect();
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

    fn get_outdated_packages(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
    ) -> Result<Vec<OutdatedPackage>, bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — Zig threads `*PackageManager`
        // into `manifests.byNameAllowExpired`, freely aliasing the receiver.
        // Hoist the four scalars that path reads into a by-value
        // `DiskCacheCtx` so the loop body holds only disjoint field borrows
        // (`&mut manager.manifests` against `&manager.lockfile` /
        // `&manager.options`). The returned `OutdatedPackage`s do *not*
        // borrow from `manager`, so the caller may keep using it afterwards.
        let cache_ctx = manager.manifest_disk_cache_ctx();
        let min_age_ms = manager.options.minimum_release_age_ms;
        let needs_extended = min_age_ms.is_some();
        let excludes = manager.options.minimum_release_age_excludes.as_deref();
        let update_to_latest = manager.options.do_.update_to_latest();
        let default_url_hash = *bun_install::npm::Registry::DEFAULT_URL_HASH;
        let global_uses_default_registry = manager.options.scope.url_hash == default_url_hash;

        let mut outdated_packages: Vec<OutdatedPackage> = Vec::new();

        let mut version_buf: String = String::new();

        for &workspace_pkg_id in workspace_pkg_ids {
            let pkg_deps =
                manager.lockfile.packages.items_dependencies()[workspace_pkg_id as usize];
            for dep_id in pkg_deps.begin()..pkg_deps.end() {
                let package_id = manager.lockfile.buffers.resolutions[dep_id as usize];
                if package_id == INVALID_PACKAGE_ID {
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

                let name_slice = dep.name.slice(string_buf);
                let package_name =
                    manager.lockfile.packages.items_name()[package_id as usize].slice(string_buf);

                let scope = manager.options.scope_for_package_name(package_name).clone();
                // Snapshot for `OutdatedPackage.uses_default_registry` (see
                // field PORT NOTE) — Zig defers this to render time via
                // `pkg.manager`, which we cannot soundly alias.
                let uses_default_registry = global_uses_default_registry
                    && manager.options.scope_for_package_name(name_slice).url_hash
                        == default_url_hash;
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

                let Some(latest) = manifest
                    .find_by_dist_tag_with_filter(b"latest", min_age_ms, excludes)
                    .unwrap()
                else {
                    continue;
                };

                // In interactive mode, show the constrained update version as "Target"
                // but always include packages (don't filter out breaking changes)
                let update_version = if resolved_version.tag == dependency::Tag::Npm {
                    manifest
                        .find_best_version_with_filter(
                            &resolved_version.npm().version,
                            string_buf,
                            min_age_ms,
                            excludes,
                        )
                        .unwrap()
                        .unwrap_or(latest)
                } else {
                    manifest
                        .find_by_dist_tag_with_filter(
                            resolved_version.dist_tag().tag.slice(string_buf),
                            min_age_ms,
                            excludes,
                        )
                        .unwrap()
                        .unwrap_or(latest)
                };

                // Skip only if both the constrained update AND the latest version are the same as current
                // This ensures we show packages where latest is newer even if constrained update isn't
                let current_ver = resolution.npm().version;
                let update_ver = update_version.version;
                let latest_ver = latest.version;

                let update_is_same = current_ver.major == update_ver.major
                    && current_ver.minor == update_ver.minor
                    && current_ver.patch == update_ver.patch
                    && current_ver.tag.eql(update_ver.tag);

                let latest_is_same = current_ver.major == latest_ver.major
                    && current_ver.minor == latest_ver.minor
                    && current_ver.patch == latest_ver.patch
                    && current_ver.tag.eql(latest_ver.tag);

                if update_is_same && latest_is_same {
                    continue;
                }

                version_buf.clear();
                write!(version_buf, "{}", current_ver.fmt(string_buf)).expect("OOM");
                let current_version_buf: Box<[u8]> = Box::from(version_buf.as_bytes());

                version_buf.clear();
                write!(
                    version_buf,
                    "{}",
                    update_version.version.fmt(&manifest.string_buf)
                )
                .expect("OOM");
                let update_version_buf: Box<[u8]> = Box::from(version_buf.as_bytes());

                version_buf.clear();
                write!(version_buf, "{}", latest.version.fmt(&manifest.string_buf)).expect("OOM");
                let latest_version_buf: Box<[u8]> = Box::from(version_buf.as_bytes());

                // Already filtered by version.order check above

                version_buf.clear();
                let dep_type: &'static [u8] = DependencyGroup::prop_for_behavior(dep.behavior);

                // Get workspace name but only show if it's actually a workspace
                let workspace_resolution =
                    manager.lockfile.packages.items_resolution()[workspace_pkg_id as usize];
                let workspace_name: &[u8] =
                    if workspace_resolution.tag == resolution::Tag::Workspace {
                        manager.lockfile.packages.items_name()[workspace_pkg_id as usize]
                            .slice(string_buf)
                    } else {
                        b""
                    };

                let is_catalog = dep.version.tag == dependency::Tag::Catalog;
                let catalog_name_str: &[u8] = if is_catalog {
                    dep.version.catalog().slice(string_buf)
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
                    dep_id: dep_id as DependencyID,
                    workspace_pkg_id,
                    dependency_type: dep_type,
                    workspace_name: Box::from(workspace_name),
                    behavior: dep.behavior,
                    uses_default_registry,
                    is_catalog,
                    catalog_name,
                    use_latest: update_to_latest, // default to --latest flag value
                });
            }
        }

        // Group catalog dependencies
        let mut grouped_result = Self::group_catalog_dependencies(outdated_packages)?;

        // Sort packages: dependencies first, then devDependencies, etc.
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

    fn calculate_column_widths(packages: &[OutdatedPackage]) -> ColumnWidths {
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
            if pkg.behavior.is_dev() {
                dev_tag_len = 4; // " dev"
            } else if pkg.behavior.is_peer() {
                dev_tag_len = 5; // " peer"
            } else if pkg.behavior.is_optional() {
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
            let mut size: bun_core::Winsize = bun_core::ffi::zeroed();
            // SAFETY: ioctl with TIOCGWINSZ on stdout fd; size is a valid out-ptr.
            if unsafe {
                libc::ioctl(
                    libc::STDOUT_FILENO,
                    libc::TIOCGWINSZ,
                    (&raw mut size).cast::<libc::c_void>(),
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
                Some(h) => h,
                None => {
                    return TerminalSize {
                        height: 20,
                        width: 80,
                    };
                }
            };

            // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
            let mut csbi: windows::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
            // SAFETY: handle is valid; csbi is a valid out-ptr.
            if unsafe { windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi) }
                != windows::FALSE
            {
                let width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                let height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
                // Reserve space for prompt + scroll indicators + buffer
                let usable_height = if height > 6 { height - 4 } else { 20 };
                return TerminalSize {
                    height: usize::try_from(usable_height).expect("int cast"),
                    width: usize::try_from(width).expect("int cast"),
                };
            }
        }
        TerminalSize {
            height: 20,
            width: 80,
        } // Default fallback
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
        let start_chars = if only_end {
            available_chars
        } else {
            available_chars / 2
        };
        let end_chars = available_chars - start_chars;

        let mut result = vec![0u8; start_chars + ellipsis.len() + end_chars];
        result[0..start_chars].copy_from_slice(&text[0..start_chars]);
        result[start_chars..start_chars + ellipsis.len()].copy_from_slice(ellipsis);
        result[start_chars + ellipsis.len()..].copy_from_slice(&text[text.len() - end_chars..]);

        result.into_boxed_slice()
    }

    #[allow(dead_code)]
    fn prompt_for_updates(
        packages: &mut [OutdatedPackage],
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

        // Set raw mode — RAII guard restores the original terminal mode on Drop.
        #[cfg(windows)]
        let _restore =
            bun_sys::windows::StdinModeGuard::set(bun_sys::windows::UpdateStdioModeFlagsOpts {
                set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                    | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
            });

        #[cfg(unix)]
        let _restore = bun_core::tty::RawModeGuard::new(0);

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

    fn process_multi_select<'s, 'b>(
        state: &'b mut MultiSelectState<'s>,
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
        scopeguard::defer! {
            if colors {
                Output::print(format_args!("\x1b[?25h")); // show cursor
                Output::print(format_args!("\x1b[?1000l")); // Disable mouse tracking
                Output::print(format_args!("\x1b[?1006l")); // Disable SGR extended mouse mode
            }
        }

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
                            Output::pretty(format_args!(
                                "<r>{}<r>",
                                BStr::new(pkg.dependency_type)
                            ));
                        }

                        // Calculate padding to align column headers with values
                        let mut j: usize = 0;
                        // Calculate actual displayed text length including count if present
                        let dep_type_text_len: usize = if selected_count > 0 {
                            pkg.dependency_type.len()
                                + 1
                                + bun_core::fmt::digit_count(selected_count) // +1 for space
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
                    if pkg.behavior.is_dev() {
                        dev_tag_len = 4; // " dev"
                    } else if pkg.behavior.is_peer() {
                        dev_tag_len = 5; // " peer"
                    } else if pkg.behavior.is_optional() {
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
                            _tag_padding: Default::default(),
                        };
                        let update_full = semver::Version {
                            major: update_ver_parsed.version.major.unwrap_or(0),
                            minor: update_ver_parsed.version.minor.unwrap_or(0),
                            patch: update_ver_parsed.version.patch.unwrap_or(0),
                            tag: update_ver_parsed.version.tag,
                            _tag_padding: Default::default(),
                        };

                        let target_ver_str: &[u8] = if pkg.use_latest {
                            &pkg.latest_version
                        } else {
                            &pkg.update_version
                        };
                        let diff = semver::Version::which_version_is_different(
                            update_full,
                            current_full,
                            target_ver_str,
                            &pkg.current_version,
                        );
                        if let Some(d) = diff {
                            match d {
                                semver::version::ChangedVersion::Major => checkbox_color = "red",
                                semver::version::ChangedVersion::Minor => {
                                    if current_full.major == 0 {
                                        checkbox_color = "red"; // 0.x.y minor changes are breaking
                                    } else {
                                        checkbox_color = "yellow";
                                    }
                                }
                                semver::version::ChangedVersion::Patch => {
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

                    let package_url: Box<[u8]> =
                        if Output::enable_ansi_colors_stdout() && pkg.uses_default_registry {
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

                    let hyperlink = TerminalHyperlink::new(
                        &package_url,
                        &display_name,
                        !package_url.is_empty(),
                    );

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
                    if pkg.behavior.is_dev() {
                        Output::pretty(format_args!("<r><d> dev<r>"));
                    } else if pkg.behavior.is_peer() {
                        Output::pretty(format_args!("<r><d> peer<r>"));
                    } else if pkg.behavior.is_optional() {
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
                            _tag_padding: Default::default(),
                        };
                        let target_full = semver::Version {
                            major: target_ver_parsed.version.major.unwrap_or(0),
                            minor: target_ver_parsed.version.minor.unwrap_or(0),
                            patch: target_ver_parsed.version.patch.unwrap_or(0),
                            tag: target_ver_parsed.version.tag,
                            _tag_padding: Default::default(),
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
                                    current_full,
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
                            _tag_padding: Default::default(),
                        };
                        let latest_full = semver::Version {
                            major: latest_ver_parsed.version.major.unwrap_or(0),
                            minor: latest_ver_parsed.version.minor.unwrap_or(0),
                            patch: latest_ver_parsed.version.patch.unwrap_or(0),
                            tag: latest_ver_parsed.version.tag,
                            _tag_padding: Default::default(),
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
                                    current_full,
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
                        if state.packages.len() - viewport_end == 1 {
                            ""
                        } else {
                            "s"
                        }
                    ));
                    lines_displayed += 1;
                }

                total_lines = lines_displayed + 1;
                Output::clear_to_end();
            }
            Output::flush();

            // Read input
            // TODO(port): std.fs.File.stdin().readerStreaming — use bun_sys stdin byte reader
            let mut reader = bun_core::output::stdin_reader();
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
                    let Ok(seq) = reader.take_byte() else {
                        continue;
                    };
                    if seq == b'[' {
                        let Ok(arrow) = reader.take_byte() else {
                            continue;
                        };
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
                                let Ok(tilde) = reader.take_byte() else {
                                    continue;
                                };
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
                                let Ok(tilde) = reader.take_byte() else {
                                    continue;
                                };
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
                                            let button: u32 =
                                                strings::parse_int(button_str, 10).unwrap_or(0);
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

fn dep_type_priority(dep_type: &[u8]) -> u8 {
    // caller-specific UI sort order; not baked into canonical
    match DependencyGroup::from_prop(dep_type) {
        Some(g) if g.behavior == Behavior::PROD => 0,
        Some(g) if g.behavior == Behavior::DEV => 1,
        Some(g) if g.behavior == Behavior::PEER => 2,
        Some(g) if g.behavior == Behavior::OPTIONAL => 3,
        _ => 4,
    }
}

/// Dupe a byte buffer into the process-lifetime CLI arena to obtain a
/// `'static` slice for storage in `E::EString.data` (the AST `Str` alias is
/// `&'static [u8]` until Phase B threads `'bump`). Mirrors Zig's
/// `allocator.dupe(u8, ...)` against the singleton `manager.allocator`.
#[inline]
fn leak_dup(bytes: &[u8]) -> &'static [u8] {
    crate::cli::cli_dupe(bytes)
}

/// Edit catalog definitions in package.json
// PORT NOTE: Zig threads `manager` only for `manager.allocator`; the Rust port
// uses a local `Bump` (`E::Object::put` ignores its allocator arg), so the
// parameter is dropped to keep `update_catalog_definitions` borrowck-clean.
pub fn edit_catalog_definitions(
    updates: &mut [CatalogUpdateRequest],
    current_package_json: &mut Expr,
) -> Result<(), bun_core::Error> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    // PORT NOTE: `Expr.Disabler` is a debug-only guard around the T4
    // `bun_js_parser` Store; the lower-tier `bun_ast::js_ast` `Expr` used
    // here boxes via its own thread-local `DATA_STORE` (see js_ast.rs), so
    // toggling the parser-tier disabler is a no-op for these allocations.
    let bump = Bump::new();

    for update in updates.iter() {
        if let Some(catalog_name) = &update.catalog_name {
            update_named_catalog(
                &bump,
                current_package_json,
                catalog_name,
                &update.package_name,
                &update.new_version,
            )?;
        } else {
            update_default_catalog(
                &bump,
                current_package_json,
                &update.package_name,
                &update.new_version,
            )?;
        }
    }
    Ok(())
}

/// Where `find_catalog_object` located the existing object — the lookup and
/// the post-mutate placement use *different* predicates in Zig (see
/// `update_default_catalog`), so the source must be tracked.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CatalogSource {
    Workspaces,
    Root,
    Missing,
}

/// Find the `StoreRef<E::Object>` for `package_json[.workspaces].<key>`, or
/// `None` if absent / not an object. Mirrors the labeled-block lookup in
/// updateDefaultCatalog/updateNamedCatalog.
fn find_catalog_object(
    package_json: &Expr,
    key: &[u8],
) -> (Option<bun_ast::StoreRef<E::Object>>, CatalogSource) {
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if workspaces_query.expr.is_object() {
            if let Some(q) = workspaces_query.expr.as_property(key) {
                if let Some(o) = q.expr.data.e_object() {
                    return (Some(o), CatalogSource::Workspaces);
                }
            }
        }
    }
    if let Some(q) = package_json.as_property(key) {
        if let Some(o) = q.expr.data.e_object() {
            return (Some(o), CatalogSource::Root);
        }
    }
    (None, CatalogSource::Missing)
}

fn update_default_catalog(
    bump: &Bump,
    package_json: &mut Expr,
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalog object
    // First check if catalog is under workspaces.catalog
    // PORT NOTE: reshaped — Zig copies `data.e_object.*` (struct bytes,
    // aliasing the `Vec` ptr) and writes the mutated copy back via
    // `parent.put("catalog", Expr.allocate(obj))`. Rust `Vec<T>` has a
    // `Drop` that frees its buffer, so a shallow copy would double-free.
    // Instead mutate the existing `StoreRef<E::Object>` in place (`StoreRef`
    // is `Copy + DerefMut`). Crucially, Zig's *placement* check is looser
    // than its lookup: it puts under `workspaces.<key>` whenever that key
    // *exists* (any type), even when the lookup fell back to the root-level
    // object. Track the lookup source so the in-place fast path is taken only
    // when source == placement; otherwise re-`put` the mutated arena slot at
    // the Zig-mandated location.
    let mut fresh_obj = E::Object::default();
    let (existing, source) = find_catalog_object(package_json, b"catalog");
    {
        let catalog_obj: &mut E::Object = match existing {
            Some(mut o) => {
                // SAFETY: `StoreRef` derefs into the live arena slot for the
                // duration of this block; no other `&mut` to it is live.
                unsafe { &mut *core::ptr::addr_of_mut!(*o) }
            }
            None => &mut fresh_obj,
        };

        // Get original version to preserve prefix if it exists
        let mut version_with_prefix: &'static [u8] = leak_dup(new_version);
        if let Some(existing_prop) = catalog_obj.get(package_name) {
            if let Some(e_str) = existing_prop.data.e_string() {
                let original_version = e_str.data.slice();
                version_with_prefix =
                    crate::cli::cli_dupe(&preserve_version_prefix(original_version, new_version)?);
            }
        }

        // Update or add the package version
        let new_expr = Expr::init(E::EString::init(version_with_prefix), Loc::EMPTY);
        catalog_obj
            .put(bump, leak_dup(package_name), new_expr)
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
    }

    // Check if we need to update under workspaces.catalog or root-level catalog
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let Some(mut ws_obj) = workspaces_query.expr.data.e_object() {
            if workspaces_query.expr.as_property(b"catalog").is_some() {
                // Update under workspaces.catalog
                if source == CatalogSource::Workspaces {
                    // Mutated in place; placement matches lookup.
                    return Ok(());
                }
                let expr = match existing {
                    // Re-seat the arena slot mutated above; `StoreRef` is a
                    // non-owning `Copy` handle so the previous `Data::EObject`
                    // pointing at it remains valid.
                    Some(o) => Expr {
                        loc: Loc::EMPTY,
                        data: js_expr::Data::EObject(o),
                    },
                    None => Expr::init(fresh_obj, Loc::EMPTY),
                };
                ws_obj
                    .put(bump, b"catalog", expr)
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if source == CatalogSource::Root {
        // Mutated in place; placement matches lookup.
        return Ok(());
    }
    // source ∈ {Missing}; Workspaces is unreachable here since it implies the
    // `workspaces.catalog` key exists.
    if let Some(root_obj) = package_json.data.e_object_mut() {
        root_obj
            .put(bump, b"catalog", Expr::init(fresh_obj, Loc::EMPTY))
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
    }
    Ok(())
}

fn update_named_catalog(
    bump: &Bump,
    package_json: &mut Expr,
    catalog_name: &[u8],
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalogs object
    // First check if catalogs is under workspaces.catalogs (newer structure)
    // PORT NOTE: reshaped — see `update_default_catalog` for the
    // shallow-copy-vs-in-place + lookup-vs-placement rationale.
    let mut fresh_catalogs = E::Object::default();
    let (existing_catalogs, source) = find_catalog_object(package_json, b"catalogs");
    {
        let catalogs_obj: &mut E::Object = match existing_catalogs {
            Some(mut o) => {
                // SAFETY: arena slot live for fn duration; no aliasing `&mut`.
                unsafe { &mut *core::ptr::addr_of_mut!(*o) }
            }
            None => &mut fresh_catalogs,
        };

        // Get or create the specific catalog
        let mut fresh_catalog = E::Object::default();
        let existing_catalog: Option<bun_ast::StoreRef<E::Object>> = catalogs_obj
            .get(catalog_name)
            .and_then(|e| e.data.e_object());
        let catalog_obj: &mut E::Object = match existing_catalog {
            Some(mut o) => {
                // SAFETY: arena slot live for fn duration; no aliasing `&mut`.
                unsafe { &mut *core::ptr::addr_of_mut!(*o) }
            }
            None => &mut fresh_catalog,
        };

        // Get original version to preserve prefix if it exists
        let mut version_with_prefix: &'static [u8] = leak_dup(new_version);
        if let Some(existing_prop) = catalog_obj.get(package_name) {
            if let Some(e_str) = existing_prop.data.e_string() {
                let original_version = e_str.data.slice();
                version_with_prefix =
                    crate::cli::cli_dupe(&preserve_version_prefix(original_version, new_version)?);
            }
        }

        // Update or add the package version
        let new_expr = Expr::init(E::EString::init(version_with_prefix), Loc::EMPTY);
        catalog_obj
            .put(bump, leak_dup(package_name), new_expr)
            .map_err(|_| bun_core::err!("OutOfMemory"))?;

        // Update the catalog in catalogs object
        if existing_catalog.is_none() {
            catalogs_obj
                .put(
                    bump,
                    leak_dup(catalog_name),
                    Expr::init(fresh_catalog, Loc::EMPTY),
                )
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
        }
    }

    // Check if we need to update under workspaces.catalogs or root-level catalogs
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let Some(mut ws_obj) = workspaces_query.expr.data.e_object() {
            if workspaces_query.expr.as_property(b"catalogs").is_some() {
                // Update under workspaces.catalogs
                if source == CatalogSource::Workspaces {
                    // Mutated in place; placement matches lookup.
                    return Ok(());
                }
                let expr = match existing_catalogs {
                    Some(o) => Expr {
                        loc: Loc::EMPTY,
                        data: js_expr::Data::EObject(o),
                    },
                    None => Expr::init(fresh_catalogs, Loc::EMPTY),
                };
                ws_obj
                    .put(bump, b"catalogs", expr)
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if source == CatalogSource::Root {
        // Mutated in place; placement matches lookup.
        return Ok(());
    }
    if let Some(root_obj) = package_json.data.e_object_mut() {
        root_obj
            .put(bump, b"catalogs", Expr::init(fresh_catalogs, Loc::EMPTY))
            .map_err(|_| bun_core::err!("OutOfMemory"))?;
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
        if let Some(after_npm) =
            strings::without_prefix_if_possible_comptime(original_version, b"npm:")
        {
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
                write!(&mut v, "{}={}", first_char as char, BStr::new(new_version))
                    .expect("infallible: in-memory write");
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
            write!(&mut v, "{}{}", first_char as char, BStr::new(new_version))
                .expect("infallible: in-memory write");
            return Ok(v.into_boxed_slice());
        }
        if let Some(a) = alias {
            let mut v = Vec::new();
            write!(&mut v, "npm:{}@{}", BStr::new(a), BStr::new(new_version))
                .expect("infallible: in-memory write");
            return Ok(v.into_boxed_slice());
        }
    }
    Ok(Box::from(new_version))
}

// ported from: src/cli/update_interactive_command.zig
