use core::fmt;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output};
use bun_semver as Semver;

use crate::dependency::{Behavior, Tag as DependencyTag, Version as DependencyVersion};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{self, DependencySlice, Lockfile, Package};
use crate::npm::{FindVersionResult, PackageManifest};
use crate::{
    Dependency, DependencyID, Features, PackageID, PackageNameHash, ResolutionTag,
    invalid_package_id,
};

use super::PackageManager;
use super::add_remove_with_filter::{WorkspaceTarget, fetch_entry};
use super::workspace_selection::WorkspaceGraph;

/// Root + member package.json files parsed the way `bun install` parses them, into a throw-away lockfile.
pub(crate) struct ScratchManifests {
    pub(crate) lockfile: Lockfile,
    pub(crate) log: bun_ast::Log,
    pub(crate) root: Package,
}

impl ScratchManifests {
    pub(crate) fn new() -> ScratchManifests {
        ScratchManifests {
            lockfile: Lockfile::default(),
            log: bun_ast::Log::init(),
            root: Package::default(),
        }
    }

    /// Must run first: it fills `lockfile.workspace_paths`, which `workspace:` rows in every file resolve through.
    pub(crate) fn parse_root(&mut self, manager: &mut PackageManager) -> crate::Result<()> {
        // Cloned because the `workspaces` walk below may grow the cache holding this entry.
        let (root_source, root_json) = {
            let entry = fetch_entry(manager, &WorkspaceTarget::root());
            (entry.source.clone(), entry.root)
        };
        let mut resolver: () = ();
        self.root.parse_with_json::<()>(
            &mut self.lockfile,
            manager,
            &mut self.log,
            &root_source,
            root_json,
            &mut resolver,
            Features::main(),
        )
    }

    pub(crate) fn parse_member(
        &mut self,
        manager: &mut PackageManager,
        target: &WorkspaceTarget,
    ) -> crate::Result<Package> {
        let (source, json) = {
            let entry = fetch_entry(manager, target);
            (bun_ptr::ParentRef::new(&entry.source), entry.root)
        };
        let mut resolver: () = ();
        let mut pkg = Package::default();
        // Unlike the root's workspaces walk, a `Features::WORKSPACE` parse never grows the cache, so the entry stays put.
        pkg.parse_with_json::<()>(
            &mut self.lockfile,
            manager,
            &mut self.log,
            source.get(),
            json,
            &mut resolver,
            Features::WORKSPACE,
        )?;
        Ok(pkg)
    }

    /// The package.json behind package `pkg_id` of `manager.lockfile`: the root's (already parsed by `parse_root`, not
    /// parsed again), or a workspace member's, read from the path its `workspace:` resolution stores.
    pub(crate) fn parse_lockfile_package(
        &mut self,
        manager: &mut PackageManager,
        pkg_id: PackageID,
    ) -> crate::Result<Package> {
        let Some(target) = WorkspaceTarget::of_lockfile_package(&manager.lockfile, pkg_id) else {
            return Err(crate::Error::InvalidPackageID);
        };
        if target.name_hash.is_none() {
            return Ok(self.root);
        }
        self.parse_member(manager, &target)
    }
}

/// Whether bun.lock row `row` is the one the last install wrote for package.json dependency `scratch` of the same
/// package. A name listed in two groups (`dependencies` and `peerDependencies`) has one row per group.
pub(crate) fn same_row(scratch: &Dependency, row: &Dependency) -> bool {
    row.name_hash == scratch.name_hash && row.behavior == scratch.behavior
}

/// One npm dependency that a package.json declares now, with the package bun.lock has installed for it.
#[derive(Clone, Copy)]
pub struct DeclaredDependency {
    /// The root or workspace package whose package.json declares it.
    pub workspace_pkg_id: PackageID,
    /// Its row in the package.json parse, for [`DeclaredDependencies::dependency`].
    pub dep_id: DependencyID,
    /// The npm package that the last install resolved it to, in `manager.lockfile`.
    pub package_id: PackageID,
}

/// The npm dependencies that the package.json files declare now, for the commands that report on direct
/// dependencies (`bun outdated`, `bun update -i`). bun.lock keeps the names, groups and ranges of the last
/// install, so only the installed package is taken from it. A dependency that is declared but not installed
/// yet has no row.
pub struct DeclaredDependencies {
    /// The package.json parse: dependency rows, their strings and the root catalogs. No packages.
    lockfile: Lockfile,
    rows: Vec<DeclaredDependency>,
}

impl DeclaredDependencies {
    /// Parses the root package.json and the package.json of each of `workspace_pkg_ids` the way `bun install`
    /// does, and exits with its errors when one does not parse. Rows keep the order of `workspace_pkg_ids`, then
    /// package.json order (group, then name).
    pub fn load(manager: &mut PackageManager, workspace_pkg_ids: &[PackageID]) -> Self {
        let mut scratch = ScratchManifests::new();
        if let Err(err) = scratch.parse_root(manager) {
            crash(
                &mut scratch.log,
                err,
                format_args!("failed to read package.json"),
            );
        }
        let mut rows = Vec::new();
        for &workspace_pkg_id in workspace_pkg_ids {
            let pkg = match scratch.parse_lockfile_package(manager, workspace_pkg_id) {
                Ok(pkg) => pkg,
                Err(err) => crash(
                    &mut scratch.log,
                    err,
                    format_args!("failed to read a workspace package.json"),
                ),
            };
            let installed =
                manager.lockfile.packages.items_dependencies()[workspace_pkg_id as usize];
            for dep_id in pkg.dependencies.begin()..pkg.dependencies.end() {
                let dep = &scratch.lockfile.buffers.dependencies[dep_id as usize];
                let range = scratch
                    .lockfile
                    .catalogs
                    .resolve_range(scratch.lockfile.buffers.string_bytes.as_slice(), dep);
                if !matches!(range.tag, DependencyTag::Npm | DependencyTag::DistTag) {
                    continue;
                }
                let Some(installed_dep_id) = installed_row(&manager.lockfile, installed, dep)
                else {
                    continue;
                };
                let package_id = manager.lockfile.buffers.resolutions[installed_dep_id as usize];
                if package_id == invalid_package_id
                    || manager.lockfile.packages.items_resolution()[package_id as usize].tag
                        != ResolutionTag::Npm
                {
                    continue;
                }
                rows.push(DeclaredDependency {
                    workspace_pkg_id,
                    dep_id,
                    package_id,
                });
            }
        }
        DeclaredDependencies {
            lockfile: scratch.lockfile,
            rows,
        }
    }

    pub fn rows(&self) -> &[DeclaredDependency] {
        &self.rows
    }

    /// The buffer that [`Self::dependency`] names, catalog names and [`Self::range`] slice into.
    pub fn string_bytes(&self) -> &[u8] {
        self.lockfile.buffers.string_bytes.as_slice()
    }

    pub fn dependency(&self, row: &DeclaredDependency) -> &Dependency {
        &self.lockfile.buffers.dependencies[row.dep_id as usize]
    }

    /// The declared range with a `catalog:` reference resolved through the root package.json: an npm range or a
    /// dist tag.
    pub fn range(&self, row: &DeclaredDependency) -> &DependencyVersion {
        self.lockfile
            .catalogs
            .resolve_range(self.string_bytes(), self.dependency(row))
    }

    /// The newest version of `manifest` that [`Self::range`] allows, under the minimum release age.
    pub fn find_update<'m>(
        &self,
        row: &DeclaredDependency,
        manifest: &'m PackageManifest,
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&[&[u8]]>,
    ) -> FindVersionResult<'m> {
        let range = self.range(row);
        if range.tag == DependencyTag::Npm {
            manifest.find_best_version_with_filter(
                &range.npm().version,
                self.string_bytes(),
                minimum_release_age_ms,
                exclusions,
            )
        } else {
            manifest.find_by_dist_tag_with_filter(
                range.dist_tag().tag.slice(self.string_bytes()),
                minimum_release_age_ms,
                exclusions,
            )
        }
    }
}

/// The bun.lock row, out of one package's `rows`, that the last install wrote for package.json dependency `dep` of
/// that package. A dependency that moved to another group since then still finds its old row.
fn installed_row(
    lockfile: &Lockfile,
    rows: DependencySlice,
    dep: &Dependency,
) -> Option<DependencyID> {
    let mut same_name = None;
    for id in rows.begin()..rows.end() {
        let row = &lockfile.buffers.dependencies[id as usize];
        if same_row(dep, row) {
            return Some(id);
        }
        if row.name_hash == dep.name_hash {
            same_name.get_or_insert(id);
        }
    }
    same_name
}

/// Graph index i == `targets[i]`; the target whose `name_hash` is `None` is the root.
pub(crate) fn relation_graph(
    manager: &mut PackageManager,
    targets: &[&WorkspaceTarget],
    pattern: &[u8],
) -> WorkspaceGraph {
    let mut scratch = ScratchManifests::new();
    if let Err(err) = scratch.parse_root(manager) {
        crash_for_filter(&mut scratch.log, pattern, err);
    }

    let mut parsed: Vec<(u32, Package)> = Vec::with_capacity(targets.len());
    for (i, target) in targets.iter().enumerate() {
        if target.name_hash.is_none() {
            parsed.push((i as u32, core::mem::take(&mut scratch.root)));
            continue;
        }
        match scratch.parse_member(manager, target) {
            Ok(pkg) => parsed.push((i as u32, pkg)),
            Err(err) => crash_for_filter(&mut scratch.log, pattern, err),
        }
    }

    let sbuf = scratch.lockfile.buffers.string_bytes.as_slice();
    let dbuf = scratch.lockfile.buffers.dependencies.as_slice();
    let mut index_by_path: HashMap<&[u8], u32> = HashMap::with_capacity(targets.len());
    let mut index_by_hash: HashMap<PackageNameHash, u32> = HashMap::with_capacity(targets.len());
    for (i, target) in targets.iter().enumerate() {
        let Some(hash) = target.name_hash else {
            continue;
        };
        index_by_hash.insert(hash, i as u32);
        if let Some(path) = scratch.lockfile.workspace_paths.get(&hash) {
            index_by_path.insert(path.slice(sbuf), i as u32);
        }
    }

    let mut edges: Vec<(u32, u32)> = Vec::new();
    for (from, pkg) in &parsed {
        for dep in pkg.dependencies.get(dbuf) {
            if dep.behavior == Behavior::WORKSPACE {
                continue;
            }
            let version = scratch.lockfile.catalogs.resolve_range(sbuf, dep);
            let to: Option<u32> = match version.tag {
                DependencyTag::Workspace => index_by_path
                    .get(version.workspace().slice(sbuf))
                    .copied()
                    .or_else(|| index_by_hash.get(&dep.name_hash).copied()),
                DependencyTag::Npm => {
                    let npm = version.npm();
                    lockfile::linked_workspace_path(
                        manager.options.link_workspace_packages,
                        &scratch.lockfile.workspace_paths,
                        &scratch.lockfile.workspace_versions,
                        Semver::string::Builder::string_hash(npm.name.slice(sbuf)),
                        &npm.version,
                        sbuf,
                    )
                    .and_then(|path| index_by_path.get(path.slice(sbuf)).copied())
                }
                _ => None,
            };
            let Some(to) = to else {
                continue;
            };
            if to == *from {
                continue;
            }
            edges.push((*from, to));
        }
    }

    WorkspaceGraph::from_edges(targets.len(), edges)
}

fn crash_for_filter(log: &mut bun_ast::Log, pattern: &[u8], err: crate::Error) -> ! {
    crash(
        log,
        err,
        format_args!(
            "failed to read the workspace dependencies for --filter \"{}\"",
            BStr::new(pattern)
        ),
    )
}

/// The parse errors explain the failure when there are any; `what` and `err` are the fallback.
fn crash(log: &mut bun_ast::Log, err: crate::Error, what: fmt::Arguments<'_>) -> ! {
    if log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    } else {
        Output::err_generic("{}: {}", (what, err.name()));
    }
    Global::crash();
}
