use core::fmt;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output, UnwrapOrOom as _};
use bun_semver as Semver;

use crate::dependency::{Behavior, Tag as DependencyTag, Version as DependencyVersion};
use crate::lockfile::package::{PackageColumns as _, folder_relative_to_top_level_dir};
use crate::lockfile::{self, DependencySlice, Lockfile, Package};
use crate::npm::{FindResult, FindVersionResult, MinimumReleaseAgeExcludes, PackageManifest};
use crate::{
    Dependency, DependencyID, Features, PackageID, PackageNameHash, ResolutionTag,
    invalid_package_id,
};

use super::PackageManager;
use super::add_remove_with_filter::{WorkspaceTarget, fetch_entry, root_package_json_path};
use super::workspace_package_json_cache::GetJSONOptions;
use super::workspace_selection::WorkspaceGraph;

/// Root + member package.json files parsed the way `bun install` parses them, into a throw-away lockfile.
/// Errors the parse only logs (an invalid catalog range, say) fail it, as in `bun install`.
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
    /// `features` must include `workspaces` for that, and `is_main` for the catalogs.
    pub(crate) fn parse_root(
        &mut self,
        manager: &mut PackageManager,
        features: Features,
    ) -> crate::Result<()> {
        // Cloned because the `workspaces` walk below may grow the cache holding this entry.
        let (root_source, root_json) = {
            let entry = fetch_entry(manager, &WorkspaceTarget::root());
            (entry.source.clone(), entry.root)
        };
        let mut resolver: () = ();
        self.root.parse_with_json(
            &mut self.lockfile,
            manager,
            &mut self.log,
            &root_source,
            root_json,
            &mut resolver,
            features,
        )?;
        self.fail_on_logged_errors()
    }

    /// Doesn't read any workspace. Uses bun.lock's workspace paths, but not its versions, which may
    /// be stale.
    fn parse_root_alone(&mut self, manager: &mut PackageManager) -> crate::Result<()> {
        let installed = &manager.lockfile;
        let buf = installed.buffers.string_bytes.as_slice();
        let (mut builder, scratch) = self.lockfile.string_builder_split();
        for path in installed.workspace_paths.values() {
            builder.count(path.slice(buf));
        }
        builder.allocate()?;
        for (name_hash, path) in installed
            .workspace_paths
            .keys()
            .iter()
            .zip(installed.workspace_paths.values())
        {
            let path = builder.append::<Semver::String>(path.slice(buf));
            scratch.workspace_paths.put(*name_hash, path)?;
        }
        builder.clamp();

        self.parse_root(
            manager,
            Features {
                workspaces: false,
                unchecked_workspace_ranges: true,
                ..Features::main()
            },
        )
    }

    /// For a caller that continues without the file. Nothing is printed, and `log` is left clean.
    fn try_parse_member(
        &mut self,
        manager: &mut PackageManager,
        target: &WorkspaceTarget,
    ) -> crate::Result<Package> {
        manager
            .workspace_package_json_cache
            .get_with_path(
                &mut bun_ast::Log::init(),
                &target.package_json_path,
                GetJSONOptions {
                    init_reset_store: false,
                    guess_indentation: true,
                },
            )
            .unwrap()?;
        let parsed = self.parse_member_as(
            manager,
            target,
            Features {
                unchecked_workspace_ranges: true,
                ..Features::WORKSPACE
            },
        );
        if parsed.is_err() {
            self.log = bun_ast::Log::init();
        }
        parsed
    }

    pub(crate) fn parse_member(
        &mut self,
        manager: &mut PackageManager,
        target: &WorkspaceTarget,
    ) -> crate::Result<Package> {
        self.parse_member_as(manager, target, Features::WORKSPACE)
    }

    fn parse_member_as(
        &mut self,
        manager: &mut PackageManager,
        target: &WorkspaceTarget,
        features: Features,
    ) -> crate::Result<Package> {
        let (source, json) = {
            let entry = fetch_entry(manager, target);
            (bun_ptr::ParentRef::new(&entry.source), entry.root)
        };
        let mut resolver: () = ();
        let mut pkg = Package::default();
        // Unlike the root's workspaces walk, a `Features::WORKSPACE` parse never grows the cache, so the entry stays put.
        pkg.parse_with_json(
            &mut self.lockfile,
            manager,
            &mut self.log,
            source.get(),
            json,
            &mut resolver,
            features,
        )?;
        self.fail_on_logged_errors()?;
        Ok(pkg)
    }

    fn fail_on_logged_errors(&self) -> crate::Result<()> {
        if self.log.has_errors() {
            return Err(crate::Error::InstallFailed);
        }
        Ok(())
    }
}

/// A name listed in two groups has one row per group, so the group counts.
pub(crate) fn same_row(scratch: &Dependency, row: &Dependency) -> bool {
    row.name_hash == scratch.name_hash && row.behavior == scratch.behavior
}

#[derive(Clone, Copy)]
pub struct DeclaredDependency {
    /// The root or workspace package whose package.json declares it.
    pub workspace_pkg_id: PackageID,
    /// Its row in the package.json parse, for [`DeclaredDependencies::dependency`].
    dep_id: DependencyID,
    /// The npm package that the last install resolved it to, in `manager.lockfile`.
    pub package_id: PackageID,
}

/// What the package.json files declare now. bun.lock only supplies what's installed for each
/// dependency.
pub struct DeclaredDependencies {
    /// The result of parsing the package.json files: dependencies, their strings and the root's
    /// catalogs. It has no packages.
    lockfile: Lockfile,
    rows: Vec<DeclaredDependency>,
}

/// What [`DeclaredDependencies::load`] does when a workspace's package.json can't be read.
#[derive(Clone, Copy)]
pub enum BrokenMember {
    /// The command installs afterwards, which reads every member, selected or not.
    Fatal,
    /// The command only reports. If a selected workspace can't be read, its name is printed to
    /// stderr. The others are never read.
    LeftOut,
}

impl DeclaredDependencies {
    /// Exits if the root package.json doesn't parse. A dependency that's declared but not installed
    /// is skipped.
    pub fn load(
        manager: &mut PackageManager,
        workspace_pkg_ids: &[PackageID],
        broken_member: BrokenMember,
    ) -> Self {
        let mut scratch = ScratchManifests::new();
        let root = match broken_member {
            BrokenMember::Fatal => scratch.parse_root(manager, Features::main()),
            BrokenMember::LeftOut => scratch.parse_root_alone(manager),
        };
        if let Err(err) = root {
            crash(
                &mut scratch.log,
                err,
                format_args!("failed to read package.json"),
            );
        }
        let mut rows = Vec::new();
        for &workspace_pkg_id in workspace_pkg_ids {
            let Some(target) =
                WorkspaceTarget::of_lockfile_package(&manager.lockfile, workspace_pkg_id)
            else {
                continue;
            };
            let pkg = if target.name_hash.is_none() {
                scratch.root
            } else {
                match broken_member {
                    BrokenMember::Fatal => match scratch.parse_member(manager, &target) {
                        Ok(pkg) => pkg,
                        Err(err) => crash(
                            &mut scratch.log,
                            err,
                            format_args!(
                                "failed to read package.json for workspace '{}'",
                                BStr::new(&target.name)
                            ),
                        ),
                    },
                    BrokenMember::LeftOut => match scratch.try_parse_member(manager, &target) {
                        Ok(pkg) => pkg,
                        Err(err) => {
                            Output::err_generic(
                                "failed to load {}: {}",
                                (BStr::new(&target.package_json_path), err.name()),
                            );
                            continue;
                        }
                    },
                }
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

    /// The buffer that the names in [`Self::dependency`] slice into.
    pub fn string_bytes(&self) -> &[u8] {
        self.lockfile.buffers.string_bytes.as_slice()
    }

    pub fn dependency(&self, row: &DeclaredDependency) -> &Dependency {
        &self.lockfile.buffers.dependencies[row.dep_id as usize]
    }

    /// An npm range or a dist tag, `catalog:` references resolved through the root package.json.
    fn range(&self, row: &DeclaredDependency) -> &DependencyVersion {
        self.lockfile
            .catalogs
            .resolve_range(self.string_bytes(), self.dependency(row))
    }

    /// The newest version that the declared range allows, under the minimum release age.
    pub fn find_update<'m>(
        &self,
        row: &DeclaredDependency,
        manifest: &'m PackageManifest,
        minimum_release_age_ms: Option<f64>,
        exclusions: Option<&MinimumReleaseAgeExcludes>,
    ) -> FindVersionResult<'m> {
        manifest.find_for_dependency(
            self.range(row),
            self.string_bytes(),
            minimum_release_age_ms,
            exclusions,
        )
    }
}

/// True if `bun update` would change the installed version, or if `latest` is newer than it.
/// `bun update` can also downgrade, when a dist-tag now points to an older version.
pub fn is_outdated(
    current: Semver::Version,
    current_buf: &[u8],
    update: Option<FindResult<'_>>,
    latest: FindResult<'_>,
    manifest: &PackageManifest,
) -> bool {
    update.is_some_and(|update| !update.version.eql(current))
        || latest.is_newer_than(manifest, current, current_buf)
}

/// Falls back to a row of the same name when `dep` moved to another group since the last install.
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

/// The values that `bun pm pack` and `bun publish` substitute. They're read from the files, because
/// bun.lock's versions may be stale.
pub struct WorkspaceManifests {
    lockfile: Lockfile,
    /// Has one `Behavior::WORKSPACE` entry per workspace, with its name and its directory relative
    /// to the root.
    root_dependencies: DependencySlice,
    root_package_json_path: Box<[u8]>,
}

impl WorkspaceManifests {
    /// Exits with `bun install`'s errors when the root package.json or a workspace does not parse.
    pub fn load(manager: &mut PackageManager) -> WorkspaceManifests {
        Self::try_load(manager).unwrap_or_else(|(mut log, err)| {
            crash(
                &mut log,
                err,
                format_args!("failed to read workspace package.json files"),
            )
        })
    }

    /// For a caller that continues without them. An unreadable root package.json still exits.
    pub fn try_load(
        manager: &mut PackageManager,
    ) -> Result<WorkspaceManifests, (bun_ast::Log, crate::Error)> {
        // Only what pack reads. The checks that `bun install` runs on the root's lists don't fail a
        // pack.
        let features = Features {
            is_main: true,
            workspaces: true,
            dependencies: false,
            peer_dependencies: false,
            ..Features::default()
        };
        let mut scratch = ScratchManifests::new();
        if let Err(err) = scratch.parse_root(manager, features) {
            return Err((scratch.log, err));
        }
        // `workspace:` also links the root package by its name, unless a member has that name.
        let root_name_hash = scratch.root.name_hash;
        let lockfile = &mut scratch.lockfile;
        if root_name_hash != 0 && !lockfile.workspace_paths.contains(&root_name_hash) {
            lockfile
                .workspace_paths
                .put(root_name_hash, Semver::String::from(b"."))
                .unwrap_or_oom();
            let version = fetch_entry(manager, &WorkspaceTarget::root())
                .root
                .get(b"version");
            if let Some(version) = version.as_ref().and_then(|v| v.as_utf8_string_literal()) {
                let version = lockfile.string_buf().append(version).unwrap_or_oom();
                let parsed = Semver::Version::parse(
                    version.sliced(lockfile.buffers.string_bytes.as_slice()),
                );
                if parsed.valid && parsed.wildcard == Semver::query::token::Wildcard::None {
                    lockfile
                        .workspace_versions
                        .put(root_name_hash, parsed.version.min())
                        .unwrap_or_oom();
                }
            }
        }
        Ok(WorkspaceManifests {
            lockfile: scratch.lockfile,
            root_dependencies: scratch.root.dependencies,
            root_package_json_path: root_package_json_path(),
        })
    }

    /// Returns true if `workspace:` can link to a package named `name`, which is either a workspace
    /// or the root package.
    pub fn has_workspace(&self, name: &[u8]) -> bool {
        let name_hash: PackageNameHash = bun_semver::string::Builder::string_hash(name);
        self.lockfile.workspace_paths.contains(&name_hash)
    }

    /// The workspace `workspace:<path>` in `package_dir` links, per `Package::parse_dependency`.
    pub fn workspace_name_at_path(&self, package_dir: &[u8], path: &[u8]) -> Option<&[u8]> {
        // Joined as a path, a bare `workspace:` would refer to `package_dir` itself.
        if path.is_empty() {
            return None;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let relative_directory = folder_relative_to_top_level_dir(package_dir, path, &mut buf[..])?;
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        self.root_dependencies
            .get(self.lockfile.buffers.dependencies.as_slice())
            .iter()
            .find(|dependency| {
                dependency.behavior.is_workspace()
                    && dependency.version.workspace().slice(string_buf) == relative_directory
            })
            .map(|dependency| dependency.name.slice(string_buf))
    }

    pub fn contains_package_dir(&self, package_dir: &[u8]) -> bool {
        let mut buf = bun_paths::path_buffer_pool::get();
        folder_relative_to_top_level_dir(package_dir, b".", &mut buf[..])
            .is_some_and(|relative| relative == b".")
            || self.workspace_name_at_path(package_dir, b".").is_some()
    }

    /// The packed package's own when it is no workspace.
    pub fn root_package_json_path(&self) -> &[u8] {
        &self.root_package_json_path
    }

    pub fn workspace_version(&self, name: &[u8]) -> Option<impl fmt::Display + '_> {
        let name_hash: PackageNameHash = bun_semver::string::Builder::string_hash(name);
        let version = self.lockfile.workspace_versions.get(&name_hash)?;
        Some(version.fmt(self.lockfile.buffers.string_bytes.as_slice()))
    }

    /// The range as written. `""` or `"default"` names the default catalog.
    pub fn catalog_version(&self, catalog_name: &[u8], dependency_name: &[u8]) -> Option<&[u8]> {
        let string_buf = self.lockfile.buffers.string_bytes.as_slice();
        let dependency = self
            .lockfile
            .catalogs
            .find(string_buf, catalog_name, dependency_name)?;
        Some(dependency.version.literal.slice(string_buf))
    }
}

/// Graph index i == `targets[i]`; the target whose `name_hash` is `None` is the root.
pub(crate) fn relation_graph(
    manager: &mut PackageManager,
    targets: &[&WorkspaceTarget],
    pattern: &[u8],
) -> WorkspaceGraph {
    let mut scratch = ScratchManifests::new();
    if let Err(err) = scratch.parse_root(manager, Features::main()) {
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

/// Returns the package.json paths that `--filter` selects (all of them without a filter). Each one
/// comes after the ones it depends on.
pub fn selected_in_dependency_order(
    manager: &mut PackageManager,
    original_cwd: &[u8],
) -> Vec<Box<[u8]>> {
    let targets = match super::add_remove_with_filter::select_targets(manager, original_cwd) {
        Ok(targets) => targets,
        Err(err) => {
            Output::err_generic("failed to select workspaces: {}", (err.name(),));
            Global::crash();
        }
    };
    let pattern = manager.options.filter_patterns.first().copied();
    let graph = relation_graph(
        manager,
        &targets.iter().collect::<Vec<_>>(),
        pattern.unwrap_or(b"*"),
    );
    graph
        .dependency_order()
        .into_iter()
        .map(|i| targets[i as usize].package_json_path.clone())
        .collect()
}

fn crash_for_filter(log: &mut bun_ast::Log, pattern: &[u8], err: crate::Error) -> ! {
    crash(
        log,
        err,
        format_args!(
            "failed to read workspace dependencies for --filter \"{}\"",
            BStr::new(pattern)
        ),
    )
}

/// If there are parse errors, they explain the failure. `what` and `err` are the fallback.
fn crash(log: &mut bun_ast::Log, err: crate::Error, what: fmt::Arguments<'_>) -> ! {
    if log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    } else {
        Output::err_generic("{}: {}", (what, err.name()));
    }
    Global::crash();
}
