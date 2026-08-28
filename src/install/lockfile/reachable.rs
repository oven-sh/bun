use crate::dependency::{Behavior, Dependency};
use crate::lockfile::DependencySlice;
use crate::lockfile::package::{Meta, PackageColumns as _};
use crate::lockfile_real::Lockfile;
use crate::npm::{Architecture, OperatingSystem};
use crate::{PackageID, PackageManager};
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
    pub platform: Option<(Architecture, OperatingSystem)>,
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

    // What `bun install` would link with the manager's `--production` / `--omit` / os / cpu settings.
    pub(crate) fn install(manager: &PackageManager) -> Options {
        let features = manager.options.local_package_features;
        Options {
            root: 0,
            dev: features.dev_dependencies,
            optional: features.optional_dependencies,
            peer: features.peer_dependencies,
            optional_peer: features.peer_dependencies,
            bundled: false,
            platform: Some((manager.options.cpu, manager.options.os)),
        }
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
    let walk = Walk::new(lockfile, resolutions, follow_workspace_edges, options);
    let mut seen = walk.empty_seen();
    let mut worklist: Vec<PackageID> = Vec::new();
    for &root in roots {
        if mark(&mut seen, root) {
            worklist.push(root);
        }
    }
    walk.drain(&mut seen, &mut worklist);
    seen
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
                walk.admit(target, &mut seen, &mut worklist);
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
        }
    }

    fn empty_seen(&self) -> DynamicBitSet {
        DynamicBitSet::init_empty(self.dep_slices.len()).unwrap_or_oom()
    }

    fn follows(&self, behavior: Behavior) -> bool {
        let options = &self.options;
        if (!self.follow_workspace_edges && behavior.is_workspace())
            || (behavior.is_bundled() && !options.bundled)
        {
            false
        } else if behavior.is_optional_peer() {
            options.optional_peer
        } else if behavior.is_peer() {
            options.peer
        } else if behavior.is_optional() {
            options.optional
        } else if behavior.is_dev() {
            options.dev
        } else {
            true
        }
    }

    fn admit(&self, target: PackageID, seen: &mut DynamicBitSet, worklist: &mut Vec<PackageID>) {
        if seen.is_set_allow_out_of_bound(target as usize, true) {
            return;
        }
        if let Some((cpu, os)) = self.options.platform
            && self.metas[target as usize].is_disabled(cpu, os)
        {
            return;
        }
        seen.set(target as usize);
        worklist.push(target);
    }

    fn drain(&self, seen: &mut DynamicBitSet, worklist: &mut Vec<PackageID>) {
        while let Some(parent) = worklist.pop() {
            let slice = self.dep_slices[parent as usize];
            for dep_id in slice.begin() as usize..slice.end() as usize {
                if !(self.follow_all || self.follows(self.deps[dep_id].behavior)) {
                    continue;
                }
                self.admit(self.resolutions[dep_id], seen, worklist);
            }
        }
    }
}
