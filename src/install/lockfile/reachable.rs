use crate::dependency::{Behavior, Dependency};
use crate::lockfile::DependencySlice;
use crate::lockfile::package::{Meta, PackageColumns as _};
use crate::lockfile_real::Lockfile;
use crate::npm::{Architecture, Libc, OperatingSystem};
use crate::package_manager::WorkspaceFilter;
use crate::{DependencyID, PackageID, PackageManager};
use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom;

#[derive(Clone, Copy)]
pub struct Options {
    pub root: PackageID,
    pub dev: bool,
    pub optional: bool,
    pub peer: bool,
    pub optional_peer: bool,
    pub bundled: bool,
    pub platform: Option<(Architecture, OperatingSystem, Libc)>,
}

impl Options {
    pub fn all(root: PackageID) -> Options {
        Options {
            root,
            dev: true,
            optional: true,
            peer: true,
            optional_peer: true,
            bundled: true,
            platform: None,
        }
    }

    // What `bun install` would link with the manager's `--production` / `--omit` / os / cpu / libc settings.
    pub(crate) fn install(manager: &PackageManager) -> Options {
        let features = manager.options.local_package_features;
        Options {
            root: 0,
            dev: features.dev_dependencies,
            optional: features.optional_dependencies,
            peer: features.peer_dependencies,
            optional_peer: features.peer_dependencies,
            bundled: false,
            platform: Some((
                manager.options.cpu,
                manager.options.os,
                manager.options.libc,
            )),
        }
    }

    // Does the install take this row's dependency group?
    fn group_enabled(&self, behavior: Behavior) -> bool {
        if behavior.is_optional_peer() {
            self.optional_peer
        } else if behavior.is_peer() {
            self.peer
        } else if behavior.is_optional() {
            self.optional
        } else if behavior.is_dev() {
            self.dev
        } else {
            true
        }
    }

    // An optional peer resolves nothing itself: it borrows the package of a row of the same name in
    // `siblings`, the rows of its package.json. True when every such row is in an omitted group.
    fn omits_optional_peer(&self, dep: &Dependency, siblings: &[Dependency]) -> bool {
        if !dep.behavior.is_optional_peer() || (self.dev && self.optional) {
            return false;
        }
        let mut lender_omitted = false;
        for sibling in siblings {
            if sibling.name_hash == dep.name_hash && !sibling.behavior.is_peer() {
                if self.group_enabled(sibling.behavior) {
                    return false;
                }
                lender_omitted = true;
            }
        }
        lender_omitted
    }
}

/// The packages a `--production` / `--omit` install links. Computed on first use, for one `resolutions` buffer.
#[derive(Default)]
pub(crate) struct Linked(Option<DynamicBitSet>);

impl Linked {
    /// True for an optional peer of `parent_pkg_id` whose package only an omitted group asked for
    /// (`devDependencies` + optional `peerDependencies` under `--production`).
    pub(crate) fn omits_optional_peer(
        &mut self,
        dep_id: DependencyID,
        parent_pkg_id: PackageID,
        workspace_filters: &[WorkspaceFilter],
        install_root_dependencies: bool,
        manager: &PackageManager,
        lockfile: &Lockfile,
        resolutions: &[PackageID],
    ) -> bool {
        let options = Options::install(manager);
        let deps = lockfile.buffers.dependencies.as_slice();
        let dep_slices = lockfile.packages.items_dependencies();
        if !options.omits_optional_peer(
            &deps[dep_id as usize],
            dep_slices[parent_pkg_id as usize].get(deps),
        ) {
            return false;
        }
        let linked = self.0.get_or_insert_with(|| {
            let pruned = &manager.summary.pruned_workspaces;
            if workspace_filters.is_empty() && install_root_dependencies && pruned.is_empty() {
                return packages(lockfile, resolutions, options);
            }
            // `--filter` or a pruned checkout links only some importers.
            let mut roots: Vec<PackageID> = Vec::new();
            if install_root_dependencies {
                roots.push(0);
            }
            for row in dep_slices[0].begin() as usize..dep_slices[0].end() as usize {
                let workspace = resolutions[row];
                if deps[row].behavior.is_workspace()
                    && (workspace as usize) < dep_slices.len()
                    && !pruned.contains(&deps[row].name_hash)
                    && WorkspaceFilter::is_selected(workspace_filters, workspace)
                {
                    roots.push(workspace);
                }
            }
            packages_from(lockfile, resolutions, &roots, false, options)
        });
        !linked.is_set(resolutions[dep_id as usize] as usize)
    }
}

// `resolutions` is passed separately so callers can walk a candidate resolution buffer (dedupe).
pub fn packages(lockfile: &Lockfile, resolutions: &[PackageID], options: Options) -> DynamicBitSet {
    packages_from(
        lockfile,
        resolutions,
        core::slice::from_ref(&options.root),
        true,
        options,
    )
}

// `options.root` is ignored; `follow_workspace_edges: false` keeps a root's workspace edges out of the walk (`--filter`).
pub fn packages_from(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    roots: &[PackageID],
    follow_workspace_edges: bool,
    options: Options,
) -> DynamicBitSet {
    Walk::new(lockfile, resolutions, follow_workspace_edges, options).reach(roots)
}

// What an install that goes on without `left_out` still needs: an optional dependency on one of those is not followed.
pub(crate) fn packages_without(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    roots: &[PackageID],
    options: Options,
    left_out: &DynamicBitSet,
) -> DynamicBitSet {
    let mut walk = Walk::new(lockfile, resolutions, true, options);
    walk.left_out = Some(left_out);
    walk.reach(roots)
}

// Out-of-range ids (invalid_package_id) are treated as already seen.
fn mark(seen: &mut DynamicBitSet, id: PackageID) -> bool {
    let index = id as usize;
    if seen.is_set_allow_out_of_bound(index, true) {
        return false;
    }
    seen.set(index);
    true
}

// What the devDependencies of `roots` (and of the workspaces they own) pull in — `bun pm licenses --dev`.
pub fn dev_packages_from(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    roots: &[PackageID],
    follow_workspace_edges: bool,
    options: Options,
) -> DynamicBitSet {
    let walk = Walk::new(lockfile, resolutions, follow_workspace_edges, options);
    let mut seen = walk.empty_seen();
    let mut importers: Vec<PackageID> = Vec::new();
    for &root in roots {
        if mark(&mut seen, root) {
            importers.push(root);
        }
    }
    let mut worklist: Vec<PackageID> = Vec::new();
    while let Some(importer) = importers.pop() {
        let slice = walk.dep_slices[importer as usize];
        for dep_id in slice.begin() as usize..slice.end() as usize {
            let behavior = walk.deps[dep_id].behavior;
            let target = walk.resolutions[dep_id];
            if behavior.is_workspace() {
                if follow_workspace_edges && mark(&mut seen, target) {
                    importers.push(target);
                }
                continue;
            }
            if behavior.is_dev() && walk.follows(behavior) {
                walk.admit(target, behavior, &mut seen, &mut worklist);
            }
        }
    }
    walk.drain(&mut seen, &mut worklist);
    seen
}

struct Walk<'a> {
    dep_slices: &'a [DependencySlice],
    metas: &'a [Meta],
    deps: &'a [Dependency],
    resolutions: &'a [PackageID],
    follow_workspace_edges: bool,
    follow_all: bool,
    options: Options,
    left_out: Option<&'a DynamicBitSet>,
}

impl<'a> Walk<'a> {
    fn new(
        lockfile: &'a Lockfile,
        resolutions: &'a [PackageID],
        follow_workspace_edges: bool,
        options: Options,
    ) -> Walk<'a> {
        Walk {
            dep_slices: lockfile.packages.items_dependencies(),
            metas: lockfile.packages.items_meta(),
            deps: lockfile.buffers.dependencies.as_slice(),
            resolutions,
            follow_workspace_edges,
            follow_all: follow_workspace_edges
                && options.dev
                && options.optional
                && options.peer
                && options.optional_peer
                && options.bundled,
            options,
            left_out: None,
        }
    }

    fn empty_seen(&self) -> DynamicBitSet {
        DynamicBitSet::init_empty(self.dep_slices.len()).unwrap_or_oom()
    }

    fn reach(&self, roots: &[PackageID]) -> DynamicBitSet {
        let mut seen = self.empty_seen();
        let mut worklist: Vec<PackageID> = Vec::new();
        for &root in roots {
            if mark(&mut seen, root) {
                worklist.push(root);
            }
        }
        self.drain(&mut seen, &mut worklist);
        seen
    }

    fn follows(&self, behavior: Behavior) -> bool {
        !(!self.follow_workspace_edges && behavior.is_workspace())
            && !(behavior.is_bundled() && !self.options.bundled)
            && self.options.group_enabled(behavior)
    }

    // `behavior` is the edge `target` is reached through; like the tree builder
    // (`is_filtered_dependency_or_workspace`), libc only disables optional edges.
    fn admit(
        &self,
        target: PackageID,
        behavior: Behavior,
        seen: &mut DynamicBitSet,
        worklist: &mut Vec<PackageID>,
    ) {
        if seen.is_set_allow_out_of_bound(target as usize, true) {
            return;
        }
        if behavior.contains(Behavior::OPTIONAL)
            && self
                .left_out
                .is_some_and(|left_out| left_out.is_set(target as usize))
        {
            return;
        }
        if let Some((cpu, os, libc)) = self.options.platform
            && self.metas[target as usize].is_disabled(cpu, os, libc.for_dependency(behavior))
        {
            return;
        }
        seen.set(target as usize);
        worklist.push(target);
    }

    fn drain(&self, seen: &mut DynamicBitSet, worklist: &mut Vec<PackageID>) {
        while let Some(parent) = worklist.pop() {
            let slice = self.dep_slices[parent as usize];
            let siblings = slice.get(self.deps);
            for dep_id in slice.begin() as usize..slice.end() as usize {
                let dep = &self.deps[dep_id];
                let behavior = dep.behavior;
                if !(self.follow_all
                    || (self.follows(behavior) && !self.options.omits_optional_peer(dep, siblings)))
                {
                    continue;
                }
                self.admit(self.resolutions[dep_id], behavior, seen, worklist);
            }
        }
    }
}
