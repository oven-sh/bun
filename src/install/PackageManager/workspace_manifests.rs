use core::fmt;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output};

use crate::dependency::{Behavior, Tag as DependencyTag};
use crate::lockfile::{Lockfile, Package};
use crate::{Features, PackageNameHash};

use super::PackageManager;
use super::add_remove_with_filter::{WorkspaceTarget, fetch_entry, root_package_json_path};
use super::workspace_selection::WorkspaceGraph;

/// Root + member package.json files parsed the way `bun install` parses them, into a throw-away lockfile.
/// Errors the parse only logs (an invalid catalog range, say) fail it here, as they fail `bun install`.
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
        let root_target = WorkspaceTarget {
            name: Box::default(),
            name_hash: None,
            package_json_path: root_package_json_path(),
        };
        // Cloned because the `workspaces` walk below may grow the cache holding this entry.
        let (root_source, root_json) = {
            let entry = fetch_entry(manager, &root_target);
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
            features,
        )?;
        self.fail_on_logged_errors()
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

/// The workspace versions and catalogs `bun pm pack` / `bun publish` substitute, read from the
/// package.json files as they are now. Not from bun.lock: it has the versions of the last install,
/// and releases bump versions between that install and the publish.
pub struct WorkspaceManifests {
    lockfile: Lockfile,
    root_package_json_path: Box<[u8]>,
}

impl WorkspaceManifests {
    /// Exits with `bun install`'s errors when the root package.json or a workspace does not parse.
    pub fn load(manager: &mut PackageManager) -> WorkspaceManifests {
        // Only the two things pack reads: the `workspaces` walk and the catalogs. The root's own
        // dependency sections are not parsed, so `bun install`'s checks on them (a `workspace:1.2.3`
        // range no workspace satisfies, say) do not decide whether a package packs.
        let features = Features {
            is_main: true,
            workspaces: true,
            dependencies: false,
            peer_dependencies: false,
            ..Features::default()
        };
        let mut scratch = ScratchManifests::new();
        if let Err(err) = scratch.parse_root(manager, features) {
            crash(
                &mut scratch.log,
                err,
                format_args!("failed to read the workspace's package.json files"),
            );
        }
        WorkspaceManifests {
            lockfile: scratch.lockfile,
            root_package_json_path: root_package_json_path(),
        }
    }

    /// The package.json whose `workspaces` and catalogs these are: the workspace root's when the
    /// package being packed is one of its workspaces, otherwise the package's own.
    pub fn root_package_json_path(&self) -> &[u8] {
        &self.root_package_json_path
    }

    /// The `version` in the package.json of the workspace named `name`. `None` when no workspace
    /// has that name or its package.json has no (semver) version.
    pub fn workspace_version(&self, name: &[u8]) -> Option<impl fmt::Display + '_> {
        let name_hash: PackageNameHash = bun_semver::string::Builder::string_hash(name);
        let version = self.lockfile.workspace_versions.get(&name_hash)?;
        Some(version.fmt(self.lockfile.buffers.string_bytes.as_slice()))
    }

    /// The range catalog `catalog_name` (`""` and `"default"` both name the default catalog)
    /// declares for `dependency_name`, as written in the root package.json.
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

    let link_workspace_packages = manager.options.link_workspace_packages;
    let workspace_versions = &scratch.lockfile.workspace_versions;
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
                DependencyTag::Npm if link_workspace_packages && !version.npm().is_alias => {
                    let range = &version.npm().version;
                    (range.is_star()
                        || workspace_versions
                            .get(&dep.name_hash)
                            .is_some_and(|ver| range.satisfies(*ver, sbuf, sbuf)))
                    .then(|| index_by_hash.get(&dep.name_hash).copied())
                    .flatten()
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
