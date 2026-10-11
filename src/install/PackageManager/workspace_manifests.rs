use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output};
use bun_semver as Semver;

use crate::dependency::{Behavior, Tag as DependencyTag};
use crate::lockfile::{self, Lockfile, Package};
use crate::{Features, PackageNameHash};

use super::PackageManager;
use super::add_remove_with_filter::{WorkspaceTarget, fetch_entry, root_package_json_path};
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
}

/// Graph index i == `targets[i]`; the target whose `name_hash` is `None` is the root.
pub(crate) fn relation_graph(
    manager: &mut PackageManager,
    targets: &[&WorkspaceTarget],
    pattern: &[u8],
) -> WorkspaceGraph {
    let mut scratch = ScratchManifests::new();
    if let Err(err) = scratch.parse_root(manager) {
        crash(&mut scratch.log, pattern, err);
    }

    let mut parsed: Vec<(u32, Package)> = Vec::with_capacity(targets.len());
    for (i, target) in targets.iter().enumerate() {
        if target.name_hash.is_none() {
            parsed.push((i as u32, core::mem::take(&mut scratch.root)));
            continue;
        }
        match scratch.parse_member(manager, target) {
            Ok(pkg) => parsed.push((i as u32, pkg)),
            Err(err) => crash(&mut scratch.log, pattern, err),
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

fn crash(log: &mut bun_ast::Log, pattern: &[u8], err: crate::Error) -> ! {
    if log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    } else {
        Output::err_generic(
            "failed to read the workspace dependencies for --filter \"{}\": {}",
            (BStr::new(pattern), err.name()),
        );
    }
    Global::crash();
}
