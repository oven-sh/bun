use std::io::Write as _;

use bun_collections::HashMap;
use bun_core::fmt::{Table, TableSymbols};
use bun_core::{Global, Output};
use bun_resolver::fs::FileSystem;
use bun_glob as glob;
use bun_install::dependency::{self, Behavior};
use bun_install::package_manager::{self, WorkspaceFilter};
use bun_install::package_manifest_map::CacheBehavior;
use bun_install::{invalid_package_id, resolution, DependencyID, PackageID, PackageManager};
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
            "<r><b>bun outdated <r><d>v{}<r>",
            Global::package_json_version_with_sha,
        ));
        Output::flush();

        // PORT NOTE: `PackageManager::CommandLineArguments::parse` and
        // `PackageManager::init` live in the gated `bun_install::package_manager_real`
        // module; the active `PackageManager` is a stub with no `lockfile`/`log`/
        // `manifests` fields. Body restored when reconciler-6 un-gates.
        let _ = ctx;
        todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6) — CommandLineArguments::parse / PackageManager::init")
    }

    fn outdated(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        // Body depends on `manager.lockfile.load_from_cwd`, `manager.log`,
        // `bun_install::LoadResult::{NotFound,Err,Ok}` enum variants and
        // `LoadStep::{OpenFile,...}` — all stubbed as unit structs in the active
        // `bun_install::lockfile` shim.
        let _ = (ctx, original_cwd, manager);
        todo!("blocked_on: bun_install::PackageManager::lockfile / bun_install::lockfile::LoadResult enum (reconciler-6)")
    }

    fn outdated_inner<const ENABLE_ANSI_COLORS: bool>(
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        // Body depends on `manager.options.{filter_patterns,do_.recursive}`,
        // `manager.populate_manifest_cache`, `manager.root_package_id`,
        // `manager.workspace_name_hash`, `manager.lockfile` — none on the stub.
        let _ = (original_cwd, manager);
        todo!("blocked_on: bun_install::PackageManagerOptionsStub::{{filter_patterns,do_,positionals}} / PackageManager::populate_manifest_cache (reconciler-6)")
    }

    fn get_all_workspaces(
        manager: &PackageManager,
    ) -> Result<Box<[PackageID]>, bun_alloc::AllocError> {
        // Body depends on `manager.lockfile.packages.slice().items_resolution()`.
        let _ = manager;
        todo!("blocked_on: bun_install::PackageManager::lockfile (reconciler-6)")
    }

    fn find_matching_workspaces(
        original_cwd: &[u8],
        manager: &PackageManager,
        filters: &[&[u8]],
    ) -> Result<Box<[PackageID]>, bun_alloc::AllocError> {
        // Body depends on `manager.lockfile.{packages,buffers}` (stubbed) and
        // `lockfile.packages.slice().{items_name,items_resolution}` columns.
        let _ = (original_cwd, manager, filters);
        todo!("blocked_on: bun_install::PackageManager::lockfile / lockfile::PackageList columns (reconciler-6)")
    }

    fn group_catalog_dependencies(
        manager: &PackageManager,
        outdated_items: &[OutdatedInfo],
        _: &[PackageID],
    ) -> Result<Vec<GroupedOutdatedInfo>, bun_core::Error> {
        // Body depends on `manager.lockfile.buffers.{string_bytes,dependencies}`
        // and `Behavior: Hash` (bitflags upstream lacks `Hash` derive).
        let _ = (manager, outdated_items);
        todo!("blocked_on: bun_install::PackageManager::lockfile / bun_install::Behavior: Hash (reconciler-6)")
    }

    fn print_outdated_info_table<const ENABLE_ANSI_COLORS: bool>(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        was_filtered: bool,
    ) -> Result<(), bun_core::Error> {
        // Body depends on `manager.options.{positionals,minimum_release_age_ms,
        // minimum_release_age_excludes}`, `manager.lockfile`, `manager.manifests`,
        // `lockfile.resolve_catalog_dependency`, `lockfile.packages.slice()` columns.
        // Mechanical fixes already applied in the gated original (Behavior bitflags,
        // Table::init arg order, TableSymbols access) but cannot compile without
        // the upstream fields.
        let _ = (manager, workspace_pkg_ids, was_filtered);
        todo!("blocked_on: bun_install::PackageManager::{{lockfile,manifests}} / PackageManagerOptionsStub::{{positionals,minimum_release_age_ms}} (reconciler-6)")
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
//   confidence: low
//   todos:      7
//   notes:      All function bodies stubbed `todo!()` — every path touches
//               `bun_install::PackageManager` fields (`lockfile`, `log`,
//               `manifests`, `root_package_id`, `workspace_name_hash`) and
//               `PackageManagerOptionsStub` fields (`filter_patterns`, `do_`,
//               `positionals`, `minimum_release_age_*`) that are absent from
//               the active upstream stub. Real enums `lockfile::LoadResult` /
//               `LoadStep` are shadowed by unit-struct stubs. Bodies preserved
//               in the .zig spec; restore once reconciler-6 un-gates
//               `bun_install::package_manager_real`.
//
//   mechanical fixes to re-apply on un-gate:
//     - `Output::err_generic(format_args!(..))` → `Output::err_generic(fmt, (args,))`
//     - `dep.behavior.{dev,peer,optional}` → `.is_dev()/.is_peer()/.is_optional()`
//     - `Behavior { prod: true, .. }` → `Behavior::PROD` (bitflags)
//     - `CatalogKey.behavior: Behavior` → store `.bits()` as `u8` for `Hash`
//     - `Table::init("blue", names, lengths)` → `Table::init(names, lengths, "blue")`
//     - `table.symbols.vertical_edge()` → `TableSymbols { enable_ansi_colors: C }.vertical_edge()`
//     - `ctx.log.has_errors()` → `unsafe { (*ctx.log).has_errors() }`
//     - `WorkspaceFilter::init(..)?` → drop `?` (returns `Self`, not `Result`)
//     - `PackageManager::Subcommand` → `package_manager::Subcommand`
// ──────────────────────────────────────────────────────────────────────────
