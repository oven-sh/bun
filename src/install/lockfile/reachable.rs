use crate::dependency::{Behavior, Dependency};
use crate::lockfile::DependencySlice;
use crate::lockfile::package::{Meta, PackageColumns as _};
use crate::lockfile_real::Lockfile;
use crate::npm::{Architecture, Libc, OperatingSystem};
use crate::package_manager::WorkspaceFilter;
use crate::resolution::Tag as ResolutionTag;
use crate::{DependencyID, PackageID, PackageManager, PackageNameHash};
use bun_collections::DynamicBitSet;
use bun_core::UnwrapOrOom;

/// Where a walk starts.
#[derive(Clone, Copy)]
pub enum Start<'a> {
    /// The root package and every workspace in its `workspaces` list.
    Project,
    /// These packages. A dependency on the root leads to the root's own dependencies, not to its `workspaces` list.
    Packages(&'a [PackageID]),
}

impl<'a> Start<'a> {
    /// What a command that runs in the folder of `importer` covers: the project at the root, else that workspace.
    pub fn cwd(importer: &'a PackageID) -> Start<'a> {
        if *importer == 0 {
            Start::Project
        } else {
            Start::Packages(core::slice::from_ref(importer))
        }
    }

    fn roots(self) -> &'a [PackageID] {
        match self {
            Start::Project => &[0],
            Start::Packages(roots) => roots,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub dev: bool,
    pub optional: bool,
    pub peer: bool,
    pub optional_peer: bool,
    pub bundled: bool,
    pub platform: Option<(Architecture, OperatingSystem, Libc)>,
}

impl Options {
    pub fn all() -> Options {
        Options {
            dev: true,
            optional: true,
            peer: true,
            optional_peer: true,
            bundled: true,
            platform: None,
        }
    }

    // What `bun install` would link with the manager's `--production` / `--omit` / platform.
    pub(crate) fn install(manager: &PackageManager) -> Options {
        let features = manager.options.local_package_features;
        Options {
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

    // An optional peer borrows the package of a same-name row in `siblings`: are all those omitted?
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

/// Caches that are valid for one `resolutions` buffer. Each set is computed on first use.
#[derive(Default)]
pub(crate) struct Linked {
    /// The packages that this install links, given `--production`, `--omit` and `--filter`.
    packages: Option<DynamicBitSet>,
}

impl Linked {
    /// An optional peer of `parent_pkg_id` whose package only an omitted group asked for.
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
        let linked = self.packages.get_or_insert_with(|| {
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
            packages_from(lockfile, resolutions, Start::Packages(&roots), options)
        });
        !linked.is_set(resolutions[dep_id as usize] as usize)
    }
}

// The whole project. `resolutions` is passed separately so callers can walk a candidate resolution buffer (dedupe).
pub fn packages(lockfile: &Lockfile, resolutions: &[PackageID], options: Options) -> DynamicBitSet {
    packages_from(lockfile, resolutions, Start::Project, options)
}

pub fn packages_from(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    start: Start<'_>,
    options: Options,
) -> DynamicBitSet {
    Walk::new(lockfile, resolutions, start, options).reach(start.roots().iter())
}

// `start` and `more_roots`, plus every package a non-optional edge leads to. Skips optional edges to `left_out`.
pub(crate) fn required_without(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    start: Start<'_>,
    more_roots: &[PackageID],
    options: Options,
    left_out: &DynamicBitSet,
) -> DynamicBitSet {
    let mut walk = Walk::new(lockfile, resolutions, start, options);
    walk.left_out = Some(left_out);
    let roots = start.roots().iter().chain(more_roots);
    let reached = walk.reach(roots.clone());
    let mut required = walk.empty_seen();
    for &root in roots {
        mark(&mut required, root);
    }
    let mut parents = reached.iterator::<true, true>();
    while let Some(parent) = parents.next() {
        for (target, behavior) in walk.edges(parent as PackageID) {
            if !behavior.contains(Behavior::OPTIONAL)
                && reached.is_set_allow_out_of_bound(target as usize, false)
            {
                required.set(target as usize);
            }
        }
    }
    required
}

// Out-of-range ids (invalid_package_id) are treated as already seen.
/// Returns the dependency of `owner` that provides `name_hash` to the packages below it. Any regular
/// dependency does. So does a peer dependency of the root or of a workspace, resolved or not,
/// because it's installed like one of the project's regular dependencies. An `npm:` alias of a
/// package with a different name doesn't provide. See `enqueue::alias_of_every_dependent`.
pub(crate) fn peer_provider(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    owner: PackageID,
    name_hash: PackageNameHash,
) -> Option<DependencyID> {
    let deps = lockfile.buffers.dependencies.as_slice();
    let packages = lockfile.packages.items_resolution();
    let names = lockfile.packages.items_name_hash();
    let is_project = matches!(
        packages[owner as usize].tag,
        ResolutionTag::Root | ResolutionTag::Workspace
    );
    let list = lockfile.packages.items_dependencies()[owner as usize];
    (list.begin() as usize..list.end() as usize)
        .filter(|&id| {
            let dep = &deps[id];
            dep.name_hash == name_hash
                && if dep.behavior.is_peer() {
                    is_project && !dep.behavior.is_optional_peer()
                } else {
                    names.get(resolutions[id] as usize) == Some(&name_hash)
                }
        })
        .min_by_key(|&id| deps[id].behavior.is_peer())
        .map(|id| id as DependencyID)
}

/// Returns the packages that nothing provides a peer dependency on `name_hash` for: the ones that
/// aren't a provider and aren't below one.
///
/// pnpm decides this for each path to a package. bun.lock has one resolution per dependency and the
/// hoisted linker usually installs one copy of a package, so a provider on any path counts.
pub(crate) fn packages_without_peer_provider(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    name_hash: PackageNameHash,
) -> DynamicBitSet {
    let lists = lockfile.packages.items_dependencies();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let mut provided = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
    let mut stack: Vec<PackageID> = (0..lists.len() as PackageID)
        .filter(|&id| peer_provider(lockfile, resolutions, id, name_hash).is_some())
        .collect();
    for &id in &stack {
        provided.set(id as usize);
    }
    while let Some(id) = stack.pop() {
        let list = lists[id as usize];
        for row in list.begin() as usize..list.end() as usize {
            // Hoisting rebinds peers, so following them would make the result depend on when this
            // is called.
            if !dependencies[row].behavior.is_peer() && mark(&mut provided, resolutions[row]) {
                stack.push(resolutions[row]);
            }
        }
    }
    provided.toggle_all();
    provided
}

/// Returns the packages that nothing provides a peer dependency on `name_hash` for in at least one
/// place where they're used: the ones that can be reached from the root without passing a provider.
pub(crate) fn packages_reached_without_peer_provider(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    name_hash: PackageNameHash,
) -> DynamicBitSet {
    let lists = lockfile.packages.items_dependencies();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let mut seen = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
    let mut reached = DynamicBitSet::init_empty(lists.len()).unwrap_or_oom();
    let mut stack: Vec<PackageID> = Vec::new();
    if mark(&mut seen, 0) {
        stack.push(0);
    }
    while let Some(id) = stack.pop() {
        if peer_provider(lockfile, resolutions, id, name_hash).is_some() {
            continue;
        }
        reached.set(id as usize);
        let list = lists[id as usize];
        for row in list.begin() as usize..list.end() as usize {
            if !dependencies[row].behavior.is_peer() && mark(&mut seen, resolutions[row]) {
                stack.push(resolutions[row]);
            }
        }
    }
    reached
}

fn mark(seen: &mut DynamicBitSet, id: PackageID) -> bool {
    let index = id as usize;
    if seen.is_set_allow_out_of_bound(index, true) {
        return false;
    }
    seen.set(index);
    true
}

// What the devDependencies of `start` pull in, for `bun pm licenses --dev`.
pub fn dev_packages_from(
    lockfile: &Lockfile,
    resolutions: &[PackageID],
    start: Start<'_>,
    options: Options,
) -> DynamicBitSet {
    let walk = Walk::new(lockfile, resolutions, start, options);
    let mut seen = walk.empty_seen();
    let mut importers: Vec<PackageID> = Vec::new();
    for &root in start.roots() {
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
            if behavior.is_workspace_only() {
                if walk.from_project && mark(&mut seen, target) {
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
    from_project: bool,
    all_groups: bool,
    options: Options,
    left_out: Option<&'a DynamicBitSet>,
}

impl<'a> Walk<'a> {
    fn new(
        lockfile: &'a Lockfile,
        resolutions: &'a [PackageID],
        start: Start<'_>,
        options: Options,
    ) -> Walk<'a> {
        Walk {
            dep_slices: lockfile.packages.items_dependencies(),
            metas: lockfile.packages.items_meta(),
            deps: lockfile.buffers.dependencies.as_slice(),
            resolutions,
            from_project: matches!(start, Start::Project),
            all_groups: options.dev
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

    fn reach<'r>(&self, roots: impl Iterator<Item = &'r PackageID>) -> DynamicBitSet {
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
        !(!self.from_project && behavior.is_workspace_only())
            && !(behavior.is_bundled() && !self.options.bundled)
            && self.options.group_enabled(behavior)
    }

    // As in `is_filtered_dependency_or_workspace`, libc only disables optional edges.
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

    // The edges of `parent` that the walk follows.
    fn edges(&self, parent: PackageID) -> impl Iterator<Item = (PackageID, Behavior)> {
        let slice = self.dep_slices[parent as usize];
        let siblings = slice.get(self.deps);
        (slice.begin() as usize..slice.end() as usize).filter_map(move |dep_id| {
            let dep = &self.deps[dep_id];
            let followed =
                self.follows(dep.behavior) && !self.options.omits_optional_peer(dep, siblings);
            followed.then(|| (self.resolutions[dep_id], dep.behavior))
        })
    }

    fn drain(&self, seen: &mut DynamicBitSet, worklist: &mut Vec<PackageID>) {
        if self.all_groups {
            // `edges` without its checks: with every group enabled, it leaves out only the root's `workspaces` rows.
            while let Some(parent) = worklist.pop() {
                let slice = self.dep_slices[parent as usize];
                for dep_id in slice.begin() as usize..slice.end() as usize {
                    let behavior = self.deps[dep_id].behavior;
                    if self.from_project || !behavior.is_workspace_only() {
                        self.admit(self.resolutions[dep_id], behavior, seen, worklist);
                    }
                }
            }
            return;
        }
        while let Some(parent) = worklist.pop() {
            for (target, behavior) in self.edges(parent) {
                self.admit(target, behavior, seen, worklist);
            }
        }
    }
}
