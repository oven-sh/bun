// ───────────────────────────────────────────────────────────────────────────
// Submodules — these are the install-to-disk primitives the Installer state
// machine drives.
// ───────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
#[path = "isolated_install/FileCloner.rs"]
pub(crate) mod file_cloner;
#[path = "isolated_install/FileCopier.rs"]
pub mod file_copier;
#[path = "isolated_install/Hardlinker.rs"]
pub(crate) mod hardlinker;
#[path = "isolated_install/Installer.rs"]
pub mod installer;
#[path = "isolated_install/Store.rs"]
pub mod store;
#[path = "isolated_install/Symlinker.rs"]
pub mod symlinker;

pub(crate) use file_copier::FileCopier;
pub use store::Store;
/// Alias so `crate::isolated_install::store::EntryId` (used by
/// `TaskCallbackContext` in lib.rs) resolves to the real `entry::Id` newtype.
pub use store::entry::Id as EntryId;

use crate::lockfile::package::PackageColumns as _;
use std::io::Write as _;
use std::sync::atomic::Ordering;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_collections::{
    ArrayHashMap, DynamicBitSet, DynamicBitSetList, DynamicBitSetUnmanaged, HashMap, LinearFifo,
    StringArrayHashMap, index_sort,
};
use bun_core::{Global, Output, fast_random, fmt as bun_fmt};
use bun_paths::path_options::AssumeOk as _;
use bun_paths::{self as paths, AutoAbsPath as AbsPath, AutoRelPath};
use bun_semver as semver;
use bun_sys::{self as sys, Fd};
use bun_wyhash::{Wyhash, Wyhash11};

use crate::analytics;
use crate::bun_bunfig::Arguments as Command;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{self, Lockfile};
use crate::network_task::ForTarballError;
use crate::package_manager::Options::LogLevel;
use crate::package_manager::{self, PackageManager, WorkspaceFilter, run_tasks};
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_task as Task;
use crate::prune::{LinkedNodeModules, OldModules};
use crate::{
    self as install, DependencyID, PackageID, PackageInstall, PackageNameHash, Resolution,
    invalid_dependency_id, invalid_package_id,
};
use installer::{CompleteState, PatchInfo, Step, TaskError, Which};
use store::{Entry as StoreEntry, EntryColumns as _, Node as StoreNode, NodeColumns as _};

// ───────────────────────────────────────────────────────────────────────────
// Inner helper types (hoisted from fn body — Rust does not allow local
// struct decls that borrow outer locals via closures the same way).
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct QueuedNode {
    parent_id: store::node::Id,
    dep_id: DependencyID,
    pkg_id: PackageID,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct EarlyDedupeKey {
    pkg_id: PackageID,
    ctx_hash: u64,
}

struct DedupeInfo {
    entry_id: store::entry::Id,
    dep_id: DependencyID,
    peers: store::node::Peers,
}

#[derive(Clone, Copy)]
struct QueuedEntry {
    node_id: store::node::Id,
    entry_parent_id: store::entry::Id,
}

/// Returns the hash of the DefinitelyTyped name: `react` becomes `@types/react`, and `@scope/pkg`
/// becomes `@types/scope__pkg`.
fn types_package_name_hash(name: &[u8]) -> PackageNameHash {
    let mut types_name = b"@types/".to_vec();
    for &c in name.strip_prefix(b"@").unwrap_or(name) {
        if c == b'/' {
            types_name.extend_from_slice(b"__");
        } else {
            types_name.push(c);
        }
    }
    semver::semver_string::Builder::string_hash(&types_name)
}

#[derive(Clone, Copy)]
struct WorkFrame {
    v: u32,
    child: u32,
}

/// Part of every global-store entry's hash. Bump it when what Bun writes into an entry changes.
const GLOBAL_STORE_LAYOUT: u8 = 1;

/// Compute entry_hash for the global virtual store. The hash makes a
/// global-store directory name unique to this entry's *resolved* dependency
/// closure, so two projects that resolve `react@18.3.1` to the same set of
/// transitive versions share one on-disk entry, while a project that
/// resolves a transitive dep to a different version gets its own.
///
/// Eligibility propagates: an entry is only global-store-eligible (hash != 0)
/// when the package itself comes from an immutable cache (npm/git/tarball,
/// unpatched, no lifecycle scripts) *and* every dependency it links to is
/// also eligible. The second condition matters because dep symlinks live
/// inside the global entry; baking a project-local path (workspace, folder)
/// into a shared directory would break for every other consumer.
struct WyhashWriter<'a> {
    hasher: &'a mut Wyhash,
}

impl<'a> std::io::Write for WyhashWriter<'a> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.hasher.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// `RunTasksCallbacks` impl for the isolated-install loop, with
/// `Ctx == store::Installer`.
pub(crate) struct StoreRunTasksCallbacks<'a>(core::marker::PhantomData<&'a mut ()>);

impl<'a> run_tasks::RunTasksCallbacks for StoreRunTasksCallbacks<'a> {
    type Ctx = store::Installer<'a>;

    const HAS_ON_EXTRACT: bool = true;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = true;
    const IS_STORE_INSTALLER: bool = true;

    fn on_extract_store_installer(
        ctx: &mut Self::Ctx,
        task_id: Task::Id,
        data: &install::ExtractData,
    ) {
        ctx.on_package_extracted(task_id, data);
    }

    fn on_package_download_error_store(
        ctx: &mut Self::Ctx,
        id: Task::Id,
        name: &[u8],
        resolution: &Resolution,
        err: crate::Error,
        url: &[u8],
    ) {
        ctx.on_package_download_error(id, name, resolution, err, url);
    }
}

struct Wait<'a, 'b> {
    installer: &'a mut store::Installer<'b>,
    err: Option<crate::Error>,
}

impl<'a, 'b> Wait<'a, 'b> {
    fn is_done(&mut self) -> bool {
        // `Installer.manager` is a BACKREF raw pointer; `manager_mut()`
        // materializes the unique `&mut PackageManager` for this main-thread
        // tick without aliasing `&mut Installer`.
        let pkg_manager = self.installer.manager_mut();
        let log_level = pkg_manager.options.log_level;
        // `run_tasks` must not call `installer.manager_mut()` — `pkg_manager`
        // is the live `&mut PackageManager` for this call.
        if let Err(err) = run_tasks::run_tasks::<StoreRunTasksCallbacks>(
            pkg_manager,
            self.installer,
            true,
            log_level,
        ) {
            self.err = Some(err);
            return true;
        }
        self.installer.release_members();

        let pkg_manager = self.installer.manager_mut();
        if let Some(node) = pkg_manager.scripts_node_mut() {
            // if we're just waiting for scripts, make it known.

            // .monotonic is okay because this is just used for progress; we don't rely on
            // any side effects from completed tasks.
            let pending_lifecycle_scripts = pkg_manager
                .pending_lifecycle_script_tasks
                .load(Ordering::Relaxed);
            // `+ 1` because the root task needs to wait for everything
            if pending_lifecycle_scripts > 0
                && pkg_manager.pending_task_count() <= pending_lifecycle_scripts + 1
            {
                node.activate();
                pkg_manager.progress.refresh();
            }
        }

        pkg_manager.pending_task_count() == 0
    }
}

/// Grants `node_modules/.bun/node_modules/<dep_name>` to the first dependency that asks for it.
fn claim_hidden_hoist(
    manager: &PackageManager,
    hidden_hoisted: &mut StringArrayHashMap<()>,
    dep_name: &[u8],
) -> Result<bool, AllocError> {
    Ok(manager.options.hoist
        && (manager.options.hoist_pattern.as_ref())
            .is_none_or(|hoist_pattern| hoist_pattern.is_match(dep_name))
        && !hidden_hoisted.get_or_put(dep_name)?.found_existing)
}

/// Every `(peer edge, package)` pair the isolated store wires, one per peer context of the owner.
pub fn served_peers(
    manager: &PackageManager,
    lockfile: &Lockfile,
) -> Result<Vec<(DependencyID, PackageID)>, AllocError> {
    let store = build_whole_store(manager, lockfile)?;
    Ok(peers_served_in(&store, lockfile, None))
}

/// Returns the nodes whose links are written to disk: one per entry, and only the first entry of a
/// workspace.
fn linked_nodes(store: &Store, lockfile: &Lockfile) -> Result<DynamicBitSet, AllocError> {
    let pkg_resolutions = lockfile.packages.items_resolution();
    let node_pkg_ids = store.nodes.items_pkg_id();
    let entry_node_ids = store.entries.items_node_id();
    let entry_dependencies = store.entries.items_dependencies();
    let workspace_of = |entry: usize| {
        let pkg_id = node_pkg_ids[entry_node_ids[entry].get() as usize] as usize;
        (pkg_resolutions[pkg_id].tag == ResolutionTag::Workspace).then_some(pkg_id)
    };

    let mut queue: Vec<usize> = vec![0];
    let mut workspaces = DynamicBitSet::init_empty(pkg_resolutions.len())?;
    for entry in 1..entry_node_ids.len() {
        if let Some(pkg_id) = workspace_of(entry)
            && !workspaces.is_set(pkg_id)
        {
            workspaces.set(pkg_id);
            queue.push(entry);
        }
    }

    let mut linked = DynamicBitSet::init_empty(node_pkg_ids.len())?;
    while let Some(entry) = queue.pop() {
        let node = entry_node_ids[entry].get() as usize;
        if linked.is_set(node) {
            continue;
        }
        linked.set(node);
        for dependency in entry_dependencies[entry].slice() {
            let entry = dependency.entry_id.get() as usize;
            if workspace_of(entry).is_none() {
                queue.push(entry);
            }
        }
    }
    Ok(linked)
}

fn peers_served_in(
    store: &Store,
    lockfile: &Lockfile,
    only: Option<&DynamicBitSet>,
) -> Vec<(DependencyID, PackageID)> {
    let nodes = store.nodes.slice();
    let node_pkg_ids = nodes.items_pkg_id();
    let node_dependencies = nodes.items_dependencies();
    let dependencies = lockfile.buffers.dependencies.as_slice();
    let pkg_dependencies = lockfile.packages.items_dependencies();

    let mut served: Vec<(DependencyID, PackageID)> = Vec::new();
    let mut seen: HashMap<(DependencyID, PackageID), ()> = HashMap::default();
    for node in (0..nodes.len()).filter(|&node| only.is_none_or(|only| only.is_set(node))) {
        let wired = &node_dependencies[node];
        let deps = pkg_dependencies[node_pkg_ids[node] as usize];
        for dep_id in deps.begin()..deps.end() {
            let dep = &dependencies[dep_id as usize];
            if !dep.behavior.is_peer() {
                continue;
            }
            // The edge itself if the store queued it, else the owner's own dependency of that name.
            let target = wired
                .iter()
                .find(|ids| ids.dep_id == dep_id)
                .or_else(|| {
                    wired
                        .iter()
                        .find(|ids| dependencies[ids.dep_id as usize].name_hash == dep.name_hash)
                })
                .map(|ids| ids.pkg_id);
            if let Some(target) = target
                && target != invalid_package_id
                && seen.insert((dep_id, target), ()).is_none()
            {
                served.push((dep_id, target));
            }
        }
    }
    served
}

/// A dependency's directory under `node_modules/.bun`.
pub struct StoreFolder {
    /// One of the dependencies that resolve to it.
    pub dep_id: DependencyID,
    pub pkg_id: PackageID,
    /// Edges between the root and `dep_id`'s owner.
    pub depth: usize,
    /// `node_modules/.bun/<entry>`; the package is in `node_modules/<package name>` below it.
    /// For a `link:` dependency, this is the folder of the package that declares `dep_id`, and the
    /// link is in `node_modules/<dependency name>` below it.
    pub entry_dir: Vec<u8>,
}

pub fn store_folders(
    manager: &PackageManager,
    lockfile: &Lockfile,
) -> Result<Vec<StoreFolder>, AllocError> {
    let store = build_whole_store(manager, lockfile)?;
    let node_dep_ids = store.nodes.items_dep_id();
    let node_pkg_ids = store.nodes.items_pkg_id();
    let node_parent_ids = store.nodes.items_parent_id();
    let entry_nested_folder = store.entries.items_nested_folder();
    let entry_parents = store.entries.items_parents();
    let pkg_resolutions = lockfile.packages.items_resolution();

    let mut folders: Vec<StoreFolder> = Vec::new();
    for (entry, node_id) in store.entries.items_node_id().iter().enumerate() {
        let dep_id = node_dep_ids[node_id.get() as usize];
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let tag = pkg_resolutions[pkg_id as usize].tag;
        if dep_id == invalid_dependency_id
            || entry_nested_folder[entry]
            || matches!(tag, ResolutionTag::Root | ResolutionTag::Workspace)
        {
            continue;
        }
        let mut depth = 0;
        let mut parent = node_parent_ids[node_id.get() as usize];
        while parent != store::node::Id::ROOT && parent != store::node::Id::INVALID {
            depth += 1;
            parent = node_parent_ids[parent.get() as usize];
        }
        let holder = if tag == ResolutionTag::Symlink {
            entry_parents[entry][0]
        } else {
            store::entry::Id::from(entry as u32)
        };
        let holder_res = &pkg_resolutions[store.ids(holder).pkg_id as usize];
        let mut entry_dir: Vec<u8> = Vec::new();
        match holder_res.tag {
            ResolutionTag::Root => {}
            ResolutionTag::Workspace => {
                entry_dir.extend_from_slice(lockfile.str(holder_res.workspace()));
            }
            _ => write!(
                entry_dir,
                "node_modules/.bun/{}",
                store::entry::fmt_store_path(holder, &store, lockfile),
            )
            .expect("formatting into a Vec is infallible"),
        }
        folders.push(StoreFolder {
            dep_id,
            pkg_id,
            depth,
            entry_dir,
        });
    }
    Ok(folders)
}

/// A `file:` path relative to the package declaring it, not to the project (local, `overrides`).
fn dependency_is_contained_folder(
    lockfile: &Lockfile,
    declarer: &Resolution,
    dep: &install::Dependency,
) -> bool {
    if declarer.tag.is_local_package() || dep.version.tag != VersionTag::Folder {
        return false;
    }
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    !lockfile
        .overrides
        .contains_name(dep.name_hash, dep.name.slice(string_buf), string_buf)
}

/// The `DependencyID`s that are contained folders, and the `PackageID`s only those resolve to.
fn contained_folders(lockfile: &Lockfile) -> Result<(DynamicBitSet, DynamicBitSet), AllocError> {
    let pkgs = lockfile.packages.slice();
    let pkg_resolutions = pkgs.items_resolution();
    let resolutions = &lockfile.buffers.resolutions[..];
    let dependencies = &lockfile.buffers.dependencies[..];

    let mut contained = DynamicBitSet::init_empty(dependencies.len())?;
    let mut nested = DynamicBitSet::init_empty(pkg_resolutions.len())?;
    for (pkg_id, pkg_res) in pkg_resolutions.iter().enumerate() {
        if pkg_res.tag == ResolutionTag::Folder {
            nested.set(pkg_id);
        }
    }
    if nested.count() == 0 {
        return Ok((contained, nested));
    }
    let mut inside_a_package = DynamicBitSet::init_empty(pkg_resolutions.len())?;

    for (pkg_id, pkg_deps) in pkgs.items_dependencies().iter().enumerate() {
        for dep_id in pkg_deps.begin()..pkg_deps.end() {
            let target = resolutions[dep_id as usize];
            if target == invalid_package_id
                || target as usize >= pkg_resolutions.len()
                || pkg_resolutions[target as usize].tag != ResolutionTag::Folder
            {
                continue;
            }
            if dependency_is_contained_folder(
                lockfile,
                &pkg_resolutions[pkg_id],
                &dependencies[dep_id as usize],
            ) {
                contained.set(dep_id as usize);
                inside_a_package.set(target as usize);
            } else if !dependencies[dep_id as usize].behavior.is_peer() {
                nested.unset(target as usize);
            }
        }
    }
    // The hoisted tree binds an optional peer to a folder whose path only its declarer can follow.
    nested.set_intersection(&inside_a_package);

    Ok((contained, nested))
}

/// `pkg_id` has a `dependency_is_contained_folder` dependency resolving to `folder_pkg_id`.
pub(crate) fn folder_is_inside_package(
    lockfile: &Lockfile,
    pkg_id: PackageID,
    folder_pkg_id: PackageID,
) -> bool {
    let pkgs = lockfile.packages.slice();
    let declarer = &pkgs.items_resolution()[pkg_id as usize];
    let pkg_deps = pkgs.items_dependencies()[pkg_id as usize];
    let resolutions = &lockfile.buffers.resolutions[..];
    let dependencies = &lockfile.buffers.dependencies[..];

    (pkg_deps.begin()..pkg_deps.end()).any(|dep_id| {
        resolutions[dep_id as usize] == folder_pkg_id
            && dependency_is_contained_folder(lockfile, declarer, &dependencies[dep_id as usize])
    })
}

/// For a finished node with more than `SHORT_LIST` dependencies, the index of the first dependency
/// with a given name. Only names that are peer dependencies somewhere are recorded.
type FirstNamed = HashMap<(store::node::Id, PackageNameHash), usize>;
const SHORT_LIST: usize = 16;

/// Returns the dependencies of a finished node, starting at the first one named `name_hash`.
/// A list of at most `SHORT_LIST` is returned whole, so callers still have to compare names.
fn dependencies_named<'a>(
    first_named: &FirstNamed,
    node_dependencies: &'a [Vec<store::node::DependencyIds>],
    node_id: store::node::Id,
    name_hash: PackageNameHash,
) -> &'a [store::node::DependencyIds] {
    let list = &node_dependencies[node_id.get() as usize][..];
    if list.len() <= SHORT_LIST {
        return list;
    }
    match first_named.get(&(node_id, name_hash)) {
        Some(&first) => &list[first..],
        None => &[],
    }
}

/// The store of an install that selects everything.
pub(crate) fn build_whole_store(
    manager: &PackageManager,
    lockfile: &Lockfile,
) -> Result<Store, AllocError> {
    let (install_root_dependencies, print_timings) = (true, false);
    build_store(
        manager,
        lockfile,
        install_root_dependencies,
        &[],
        None,
        print_timings,
    )
}

fn build_store(
    manager: &PackageManager,
    lockfile: &Lockfile,
    install_root_dependencies: bool,
    workspace_filters: &[WorkspaceFilter],
    packages_to_install: Option<&[PackageID]>,
    print_timings: bool,
) -> Result<Store, AllocError> {
    let mut timer = std::time::Instant::now();
    let pkgs = lockfile.packages.slice();
    let pkg_dependency_slices = pkgs.items_dependencies();
    let pkg_resolutions = pkgs.items_resolution();
    let pkg_names = pkgs.items_name();

    let resolutions = &lockfile.buffers.resolutions[..];
    let dependencies = &lockfile.buffers.dependencies[..];
    let string_buf = &lockfile.buffers.string_bytes[..];

    let peer_range_cache = lockfile::bun_lock::PeerRangeCache::default();
    let peer_ranges = lockfile::bun_lock::PeerRanges {
        cache: &peer_range_cache,
        lockfile,
    };

    let peer_ctx = store::node::TransitivePeerOrderedArraySetCtx {
        string_buf,
        pkg_names,
    };
    let dependencies_ctx = store::entry::DependenciesOrderedArraySetCtx {
        string_buf,
        dependencies,
    };

    let (contained, nested_folders) = contained_folders(lockfile)?;
    let is_contained_folder = |dep_id: DependencyID| contained.is_set(dep_id as usize);
    let mut linked = lockfile::reachable::Linked::default();

    let mut nodes: store::node::List = store::node::List::default();

    // DFS so a deduplicated node's full subtree (and therefore its `peers`)
    // is finalized before any later sibling encounters it.
    let mut node_queue: Vec<QueuedNode> = Vec::new();

    node_queue.push(QueuedNode {
        parent_id: store::node::Id::INVALID,
        dep_id: invalid_dependency_id,
        pkg_id: 0,
    });

    let mut dep_ids_sort_buf: Vec<DependencyID> = Vec::new();

    // For each package, the peer dependency names declared anywhere in its
    // transitive closure that are not satisfied within that closure (i.e., the
    // walk-up in the loop below would continue past this package).
    //
    // A node's `peers` set (the second-pass dedup key) is exactly the resolved
    // package for each of these names as seen from the node's ancestor chain, so
    // two nodes with the same package and the same ancestor resolution for each
    // name will produce identical subtrees and identical second-pass entries.
    //
    // The universe of distinct peer-dependency names is small even in large
    // lockfiles, so each per-package set is a bitset over that universe and the
    // fixpoint is bitwise OR/ANDNOT on a contiguous buffer.
    let mut peer_name_idx: ArrayHashMap<PackageNameHash, ()> = ArrayHashMap::default();
    for dep in dependencies {
        if dep.behavior.is_peer() {
            peer_name_idx.put(dep.name_hash, ())?;
        }
    }
    let peer_name_count: u32 = u32::try_from(peer_name_idx.count()).expect("int cast");

    let leaking_peers: DynamicBitSetList =
        DynamicBitSetList::init_empty(lockfile.packages.len(), peer_name_count as usize)?;

    if peer_name_count != 0 {
        // The runtime child of a peer edge is whichever package an ancestor's
        // dependency with that name resolves to, which may be an `npm:`-aliased
        // target whose package name differs. Index resolutions by *dependency*
        // name so the union below covers every package a peer could become.
        let mut peer_targets: Vec<Vec<PackageID>> = vec![Vec::new(); peer_name_count as usize];
        debug_assert_eq!(dependencies.len(), resolutions.len());
        for (dep, &res) in dependencies.iter().zip(resolutions) {
            if res == invalid_package_id {
                continue;
            }
            let Some(bit) = peer_name_idx.get_index(&dep.name_hash) else {
                continue;
            };
            if !peer_targets[bit].contains(&res) {
                peer_targets[bit].push(res);
            }
        }

        // Per-package bits computed once: own peer-dep names, and non-peer
        // dependency names that will appear in `node_dependencies` (i.e., not
        // filtered out by bundled/disabled/unresolved).
        let own_peers: DynamicBitSetList =
            DynamicBitSetList::init_empty(lockfile.packages.len(), peer_name_count as usize)?;
        let provides: DynamicBitSetList =
            DynamicBitSetList::init_empty(lockfile.packages.len(), peer_name_count as usize)?;
        for pkg_idx in 0..lockfile.packages.len() {
            let pkg_id: PackageID = u32::try_from(pkg_idx).expect("int cast");
            let deps = pkg_dependency_slices[pkg_id as usize];
            for dep_id in deps.begin()..deps.end() {
                let dep = &dependencies[dep_id as usize];
                let Some(bit) = peer_name_idx.get_index(&dep.name_hash) else {
                    continue;
                };
                if dep.behavior.is_peer() {
                    own_peers.set(pkg_id as usize, bit);
                } else if !is_contained_folder(dep_id)
                    && !is_filtered_dependency_or_workspace(
                        dep_id,
                        pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                        resolutions,
                        &mut linked,
                    )
                {
                    provides.set(pkg_id as usize, bit);
                }
            }
        }

        let mut scratch = DynamicBitSetUnmanaged::init_empty(peer_name_count as usize)?;

        let mut changed = true;
        while changed {
            changed = false;
            for pkg_idx in 0..lockfile.packages.len() {
                let pkg_id: PackageID = u32::try_from(pkg_idx).expect("int cast");
                let deps = pkg_dependency_slices[pkg_id as usize];

                scratch.copy_into(&own_peers.at(pkg_id as usize));

                for dep_id in deps.begin()..deps.end() {
                    let dep = &dependencies[dep_id as usize];
                    if dep.behavior.is_peer() {
                        if let Some(bit) = peer_name_idx.get_index(&dep.name_hash) {
                            for &child in &peer_targets[bit] {
                                scratch.set_union(&leaking_peers.at(child as usize));
                            }
                        }
                    } else {
                        let res_pkg = resolutions[dep_id as usize];
                        if res_pkg != invalid_package_id {
                            scratch.set_union(&leaking_peers.at(res_pkg as usize));
                        }
                    }
                }
                scratch.set_exclude(&provides.at(pkg_id as usize));

                let mut dst = leaking_peers.at(pkg_id as usize);
                if !scratch.eql(&dst) {
                    dst.copy_into(&scratch);
                    changed = true;
                }
            }
        }
    }

    // Two would-be nodes with the same (pkg_id, ctx_hash) will end up with the
    // same `peers` set and therefore become the same entry in the second pass.
    // ctx_hash is 0 when the package has no leaking peers (or is a workspace).
    let mut early_dedupe: HashMap<EarlyDedupeKey, store::node::Id> = HashMap::default();

    let mut root_declares_workspace = DynamicBitSet::init_empty(lockfile.packages.len())?;
    for dep_idx in pkg_dependency_slices[0].begin()..pkg_dependency_slices[0].end() {
        if !dependencies[dep_idx as usize].behavior.is_workspace() {
            continue;
        }
        let res = resolutions[dep_idx as usize];
        if res == invalid_package_id {
            continue;
        }
        // Only mark workspaces that root will actually queue; an entry excluded
        // by --filter or `bun install <pkgs>` never gets a root-declared node,
        // so a `workspace:` reference must keep its dependencies.
        if is_filtered_dependency_or_workspace(
            dep_idx,
            0,
            workspace_filters,
            install_root_dependencies,
            manager,
            lockfile,
            resolutions,
            &mut linked,
        ) {
            continue;
        }
        if let Some(packages) = packages_to_install {
            if !packages.contains(&res) {
                continue;
            }
        }
        root_declares_workspace.set(res as usize);
    }

    // A workspace member is not linked into the root's `node_modules` when one of the root's own
    // dependencies has the same name.
    let root_folder = (lockfile.buffers.trees.first()).map(|tree| {
        tree.dependencies
            .get(&lockfile.buffers.hoisted_dependencies)
    });
    let is_unlinked_member = |dep_id: DependencyID| {
        dependencies[dep_id as usize].behavior.is_workspace()
            && root_folder.is_some_and(|placed| !placed.contains(&dep_id))
    };

    let mut peer_dep_ids: Vec<DependencyID> = Vec::new();

    let mut first_named = FirstNamed::default();

    let mut visited_parent_node_ids: Vec<store::node::Id> = Vec::new();

    // First pass: create full dependency tree with resolved peers
    'next_node: while let Some(entry) = node_queue.pop() {
        'check_cycle: {
            // check for cycles
            let mut nodes_slice = nodes.slice();
            // `split_mut()` yields disjoint `&mut [_]` per column.
            let store::node::NodeColumnsMut {
                pkg_id: node_pkg_ids,
                dep_id: node_dep_ids,
                parent_id: node_parent_ids,
                nodes: node_nodes,
                ..
            } = nodes_slice.split_mut();

            let mut curr_id = entry.parent_id;
            while curr_id != store::node::Id::INVALID {
                if node_pkg_ids[curr_id.get() as usize] == entry.pkg_id {
                    bun_core::hint::cold();
                    // skip the new node, and add the previously added node to parent so it appears in
                    // 'node_modules/.bun/parent@version/node_modules'.
                    let dep_id = node_dep_ids[curr_id.get() as usize];
                    if dep_id == invalid_dependency_id && entry.dep_id == invalid_dependency_id {
                        node_nodes[entry.parent_id.get() as usize].push(curr_id);
                        continue 'next_node;
                    }

                    if dep_id == invalid_dependency_id || entry.dep_id == invalid_dependency_id {
                        // one is the root package, one is a dependency on the root package (it has a valid dep_id)
                        // create a new node for it.
                        break 'check_cycle;
                    }

                    let curr_dep = &dependencies[dep_id as usize];
                    let entry_dep = &dependencies[entry.dep_id as usize];

                    // ensure the dependency name is the same before skipping the cycle. if they aren't
                    // we lose dependency name information for the symlinks
                    if curr_dep.name_hash == entry_dep.name_hash &&
                        // also ensure workspace self deps are not skipped.
                        // implicit workspace dep != explicit workspace dep
                        curr_dep.behavior.is_workspace() == entry_dep.behavior.is_workspace()
                    {
                        node_nodes[entry.parent_id.get() as usize].push(curr_id);
                        continue 'next_node;
                    }
                }
                curr_id = node_parent_ids[curr_id.get() as usize];
            }
        }

        let node_id: store::node::Id =
            store::node::Id::from(u32::try_from(nodes.len()).expect("int cast"));
        let pkg_deps = pkg_dependency_slices[entry.pkg_id as usize];

        // for skipping dependnecies of workspace packages and the root package. the dependencies
        // of these packages should only be pulled in once, but we might need to create more than
        // one entry if there's multiple dependencies on the workspace or root package.
        let mut skip_dependencies = entry.pkg_id == 0 && entry.dep_id != invalid_dependency_id;

        if entry.dep_id != invalid_dependency_id {
            let entry_dep = &dependencies[entry.dep_id as usize];

            // A `workspace:` protocol reference does not own the workspace's
            // dependencies when root also declares that workspace; the
            // root-declared entry does. (If root does not declare it, the
            // protocol reference is the only one and must keep them.)
            if entry_dep.version.tag == VersionTag::Workspace
                && !entry_dep.behavior.is_workspace()
                && root_declares_workspace.is_set(entry.pkg_id as usize)
            {
                skip_dependencies = true;
            }

            'dont_dedupe: {
                let mut nodes_slice = nodes.slice();
                // disjoint-column views via `split_mut`.
                let store::node::NodeColumnsMut {
                    pkg_id: node_pkg_ids,
                    nodes: node_nodes,
                    dep_id: node_dep_ids,
                    parent_id: node_parent_ids,
                    dependencies: node_dependencies,
                    peers: node_peers,
                    ..
                } = nodes_slice.split_mut();

                let ctx_hash: u64 =
                    if entry_dep.version.tag == VersionTag::Workspace || peer_name_count == 0 {
                        0
                    } else {
                        'ctx: {
                            let leaks = leaking_peers.at(entry.pkg_id as usize);
                            if leaks.count() == 0 {
                                break 'ctx 0;
                            }

                            let peer_names = peer_name_idx.keys();
                            let mut hasher = Wyhash11::init(0);
                            let mut it = leaks.iterator::<true, true>();
                            while let Some(bit) = it.next() {
                                let peer_name_hash = peer_names[bit];
                                let resolved: PackageID = 'resolved: {
                                    let mut curr_id = entry.parent_id;
                                    while curr_id != store::node::Id::INVALID {
                                        for ids in dependencies_named(
                                            &first_named,
                                            node_dependencies,
                                            curr_id,
                                            peer_name_hash,
                                        ) {
                                            if dependencies[ids.dep_id as usize].name_hash
                                                == peer_name_hash
                                                && !is_contained_folder(ids.dep_id)
                                            {
                                                break 'resolved ids.pkg_id;
                                            }
                                        }
                                        for ids in &node_peers[curr_id.get() as usize].list {
                                            if !ids.auto_installed
                                                && dependencies[ids.dep_id as usize].name_hash
                                                    == peer_name_hash
                                            {
                                                break 'resolved ids.pkg_id;
                                            }
                                        }
                                        curr_id = node_parent_ids[curr_id.get() as usize];
                                    }
                                    break 'resolved invalid_package_id;
                                };
                                // `invalid_package_id` is part of the key: an
                                // unresolved peer auto-installs the declarer's own
                                // `resolutions[peer_dep_id]`, which is position-
                                // independent, so two positions that both leave
                                // the name unresolved expand identically.
                                hasher.update(bun_core::bytes_of(&peer_name_hash));
                                hasher.update(bun_core::bytes_of(&resolved));
                            }
                            break 'ctx hasher.final_();
                        }
                    };

                let dedupe_entry = early_dedupe.get_or_put(EarlyDedupeKey {
                    pkg_id: entry.pkg_id,
                    ctx_hash,
                })?;
                if dedupe_entry.found_existing {
                    let dedupe_node_id = *dedupe_entry.value_ptr;

                    let dedupe_dep_id = node_dep_ids[dedupe_node_id.get() as usize];
                    if dedupe_dep_id == invalid_dependency_id {
                        break 'dont_dedupe;
                    }
                    let dedupe_dep = &dependencies[dedupe_dep_id as usize];

                    if dedupe_dep.name_hash != entry_dep.name_hash {
                        break 'dont_dedupe;
                    }

                    if (dedupe_dep.version.tag == VersionTag::Workspace)
                        != (entry_dep.version.tag == VersionTag::Workspace)
                    {
                        break 'dont_dedupe;
                    }

                    if dedupe_dep.version.tag == VersionTag::Workspace
                        && entry_dep.version.tag == VersionTag::Workspace
                    {
                        if dedupe_dep.behavior.is_workspace() != entry_dep.behavior.is_workspace() {
                            break 'dont_dedupe;
                        }
                    }

                    // The skipped subtree would have walked up through this
                    // ancestor chain marking each node with its leaking peers.
                    // DFS guarantees `dedupe_node`'s subtree is fully processed,
                    // so its `peers` is exactly that set; propagate it here.
                    // Reshaped for borrowck — clone the dedupe peers slice
                    // before mutating node_peers.
                    let dedupe_peers: Vec<_> =
                        node_peers[dedupe_node_id.get() as usize].list.clone();
                    for peer in dedupe_peers {
                        let peer_name_hash = dependencies[peer.dep_id as usize].name_hash;
                        let mut curr_id = entry.parent_id;
                        'walk: while curr_id != store::node::Id::INVALID {
                            for ids in dependencies_named(
                                &first_named,
                                node_dependencies,
                                curr_id,
                                peer_name_hash,
                            ) {
                                if dependencies[ids.dep_id as usize].name_hash == peer_name_hash
                                    && !is_contained_folder(ids.dep_id)
                                {
                                    break 'walk;
                                }
                            }
                            // A package is never its own peer.
                            if node_pkg_ids[curr_id.get() as usize] != peer.pkg_id {
                                node_peers[curr_id.get() as usize].insert(peer, &peer_ctx)?;
                            }
                            curr_id = node_parent_ids[curr_id.get() as usize];
                        }
                    }

                    node_nodes[entry.parent_id.get() as usize].push(dedupe_node_id);
                    continue 'next_node;
                }

                *dedupe_entry.value_ptr = node_id;
            }
        }

        nodes.append(StoreNode {
            pkg_id: entry.pkg_id,
            dep_id: entry.dep_id,
            parent_id: entry.parent_id,
            nodes: if skip_dependencies {
                Vec::new()
            } else {
                Vec::with_capacity(pkg_deps.len as usize)
            },
            dependencies: if skip_dependencies {
                Vec::new()
            } else {
                Vec::with_capacity(pkg_deps.len as usize)
            },
            ..Default::default()
        })?;

        let mut nodes_slice = nodes.slice();
        // disjoint-column views via `split_mut`.
        let store::node::NodeColumnsMut {
            pkg_id: node_pkg_ids,
            parent_id: node_parent_ids,
            dependencies: node_dependencies,
            peers: node_peers,
            nodes: node_nodes,
            ..
        } = nodes_slice.split_mut();

        if let Some(parent_id) = entry.parent_id.try_get() {
            node_nodes[parent_id as usize].push(node_id);
        }

        if skip_dependencies {
            continue;
        }

        let queue_mark = node_queue.len();

        dep_ids_sort_buf.clear();
        dep_ids_sort_buf.extend(pkg_deps.begin()..pkg_deps.end());

        // TODO: make this sort in an order that allows peers to be resolved last
        // and devDependency handling to match `hoistDependency`
        {
            let sorter = lockfile::DepSorter { lockfile };
            index_sort::sort_indices(&mut dep_ids_sort_buf, &mut |a, b| {
                if sorter.is_less_than(a, b) {
                    core::cmp::Ordering::Less
                } else if sorter.is_less_than(b, a) {
                    core::cmp::Ordering::Greater
                } else {
                    core::cmp::Ordering::Equal
                }
            });
        }

        peer_dep_ids.clear();

        // Under `--omit=peer` the copy an ancestor provides is installed anyway, and is linked.
        let dep_features =
            (manager.options).dependency_features(pkg_resolutions[entry.pkg_id as usize].tag);
        let is_omitted_peer = |dep: &install::Dependency| {
            dep.behavior.is_peer() && !dep.behavior.is_placed(dep_features)
        };

        'queue_deps: {
            if let Some(packages) = packages_to_install {
                if node_id == store::node::Id::ROOT {
                    // TODO: print an error when scanner is actually a dependency of a workspace (we should not support this)
                    for &dep_id in &dep_ids_sort_buf {
                        let pkg_id = resolutions[dep_id as usize];
                        if pkg_id == invalid_package_id {
                            continue;
                        }

                        for &package_to_install in packages {
                            if package_to_install == pkg_id {
                                node_dependencies[node_id.get() as usize]
                                    .push(store::node::DependencyIds { dep_id, pkg_id });
                                node_queue.push(QueuedNode {
                                    parent_id: node_id,
                                    dep_id,
                                    pkg_id,
                                });
                                break;
                            }
                        }
                    }
                    break 'queue_deps;
                }
            }

            for &dep_id in &dep_ids_sort_buf {
                let dep = &dependencies[dep_id as usize];
                if !is_omitted_peer(dep)
                    && is_filtered_dependency_or_workspace(
                        dep_id,
                        entry.pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                        resolutions,
                        &mut linked,
                    )
                {
                    continue;
                }

                let pkg_id = resolutions[dep_id as usize];

                // TODO: handle duplicate dependencies. should be similar logic
                // like we have for dev dependencies in `hoistDependency`

                if !dep.behavior.is_peer() {
                    // simple case:
                    // - add it as a dependency
                    // - queue it
                    if !is_unlinked_member(dep_id) {
                        node_dependencies[node_id.get() as usize]
                            .push(store::node::DependencyIds { dep_id, pkg_id });
                    }
                    node_queue.push(QueuedNode {
                        parent_id: node_id,
                        dep_id,
                        pkg_id,
                    });
                    continue;
                }

                peer_dep_ids.push(dep_id);
            }
        }

        for &peer_dep_id in &peer_dep_ids {
            let (resolved_pkg_id, auto_installed) = 'resolved_pkg_id: {
                // Go through the peers parents looking for a package with the same name.
                // If none is found, use current best version. Parents visited must have
                // the package id for the chosen peer marked as a transitive peer. Nodes
                // are deduplicated only if their package id and their transitive peer package
                // ids are equal.
                let peer_dep = &dependencies[peer_dep_id as usize];
                let best_version = (peer_ranges.shared_version(entry.pkg_id, peer_dep))
                    .unwrap_or(resolutions[peer_dep_id as usize]);
                let best_version = if is_omitted_peer(peer_dep)
                    || nested_folders.is_set_allow_out_of_bound(best_version as usize, false)
                {
                    invalid_package_id
                } else {
                    best_version
                };

                // TODO: double check this
                // Start with the current package. A package
                // can satisfy it's own peers.
                let mut curr_id = node_id;

                visited_parent_node_ids.clear();
                while curr_id != store::node::Id::INVALID {
                    let named = if curr_id == node_id {
                        &node_dependencies[curr_id.get() as usize][..]
                    } else {
                        let name_hash = peer_dep.name_hash;
                        dependencies_named(&first_named, node_dependencies, curr_id, name_hash)
                    };
                    for ids in named {
                        let dep = &dependencies[ids.dep_id as usize];

                        if dep.name_hash != peer_dep.name_hash {
                            continue;
                        }

                        // It's private to the ancestor. A package's own folder still satisfies its
                        // own peer.
                        if curr_id != node_id && is_contained_folder(ids.dep_id) {
                            continue;
                        }

                        // As in `hoist_dependency`, no other package stands in for an overridden
                        // peer.
                        if curr_id != node_id
                            && best_version != invalid_package_id
                            && pkgs.items_name_hash()[ids.pkg_id as usize]
                                != pkgs.items_name_hash()[best_version as usize]
                            && lockfile.is_overridden_dependency(peer_dep_id)
                        {
                            break 'resolved_pkg_id (best_version, true);
                        }

                        break 'resolved_pkg_id (ids.pkg_id, false);
                    }

                    let curr_peers = &node_peers[curr_id.get() as usize];
                    for ids in &curr_peers.list {
                        let transitive_peer_dep = &dependencies[ids.dep_id as usize];

                        if transitive_peer_dep.name_hash != peer_dep.name_hash {
                            continue;
                        }

                        // A transitive peer with the same name has already passed
                        // through this node

                        if !ids.auto_installed {
                            // The resolution was found here or above. Choose the same
                            // peer resolution. No need to mark this node or above.
                            break 'resolved_pkg_id (ids.pkg_id, false);
                        }

                        // It didn't find a matching name and auto installed
                        // from somewhere this peer can't reach. Choose best
                        // version. Only mark all parents if resolution is
                        // different from this transitive peer.

                        if best_version == invalid_package_id {
                            break 'resolved_pkg_id (invalid_package_id, true);
                        }

                        if best_version == ids.pkg_id {
                            break 'resolved_pkg_id (ids.pkg_id, true);
                        }

                        // add the remaining parent ids
                        while curr_id != store::node::Id::INVALID {
                            visited_parent_node_ids.push(curr_id);
                            curr_id = node_parent_ids[curr_id.get() as usize];
                        }

                        break 'resolved_pkg_id (best_version, true);
                    }

                    // TODO: prevent marking workspace and symlink deps with transitive peers

                    // add to visited parents after searching for a peer resolution.
                    // if a node resolves a transitive peer, it can still be deduplicated
                    visited_parent_node_ids.push(curr_id);
                    curr_id = node_parent_ids[curr_id.get() as usize];
                }

                // choose the current best version
                break 'resolved_pkg_id (best_version, true);
            };

            if resolved_pkg_id == invalid_package_id {
                // no parent provides the peer, and it is optional or omitted
                continue;
            }

            if lockfile::pruned_workspaces::skips_link_to_pruned_workspace(
                manager,
                lockfile,
                entry.pkg_id,
                &dependencies[peer_dep_id as usize],
                resolved_pkg_id,
            ) {
                continue;
            }

            for &visited_parent_id in &visited_parent_node_ids {
                // A package is never its own peer.
                if node_pkg_ids[visited_parent_id.get() as usize] == resolved_pkg_id {
                    continue;
                }
                let peer = store::node::TransitivePeer {
                    dep_id: peer_dep_id,
                    pkg_id: resolved_pkg_id,
                    auto_installed,
                };
                node_peers[visited_parent_id.get() as usize].insert(peer, &peer_ctx)?;
            }

            if !visited_parent_node_ids.is_empty() {
                // visited parents length == 0 means the node satisfied it's own
                // peer. don't queue.
                node_dependencies[node_id.get() as usize].push(store::node::DependencyIds {
                    dep_id: peer_dep_id,
                    pkg_id: resolved_pkg_id,
                });
                node_queue.push(QueuedNode {
                    parent_id: node_id,
                    dep_id: peer_dep_id,
                    pkg_id: resolved_pkg_id,
                });
            }
        }

        let list = &node_dependencies[node_id.get() as usize];
        for (i, ids) in list.iter().enumerate().filter(|_| list.len() > SHORT_LIST) {
            let name_hash = dependencies[ids.dep_id as usize].name_hash;
            if peer_name_idx.contains(&name_hash) {
                let first = first_named.get_or_put((node_id, name_hash))?;
                if !first.found_existing {
                    *first.value_ptr = i;
                }
            }
        }

        // node_queue is a stack: reverse children so the first one pushed is the
        // first popped, matching BFS sibling order.
        node_queue[queue_mark..].reverse();
    }

    if print_timings {
        let full_tree_end = timer.elapsed();
        timer = std::time::Instant::now();
        bun_core::pretty_errorln!(
            "Resolved peers [{}]",
            bun_fmt::fmt_duration_one_decimal(full_tree_end.as_nanos() as u64)
        );
    }

    let mut dedupe: HashMap<PackageID, Vec<DedupeInfo>> = HashMap::default();

    let mut res_fmt_buf: Vec<u8> = Vec::new();

    let nodes_slice = nodes.slice();
    let node_pkg_ids = nodes_slice.items_pkg_id();
    let node_dep_ids = nodes_slice.items_dep_id();
    let node_peers: &[store::node::Peers] = nodes_slice.items_peers();
    let node_nodes = nodes_slice.items_nodes();

    let mut store_entries: store::entry::List = store::entry::List::default();

    let mut entry_queue: LinearFifo<QueuedEntry, DynamicBuffer<QueuedEntry>> =
        LinearFifo::<QueuedEntry, DynamicBuffer<QueuedEntry>>::init();

    entry_queue.write_item(QueuedEntry {
        node_id: store::node::Id::from(0),
        entry_parent_id: store::entry::Id::INVALID,
    })?;

    let mut public_hoisted: StringArrayHashMap<()> = StringArrayHashMap::default();

    let mut hidden_hoisted: StringArrayHashMap<()> = StringArrayHashMap::default();
    let mut hidden_hoist_keys: Vec<store::entry::DependenciesItem> = Vec::new();

    // Second pass: Deduplicate nodes when the pkg_id and peer set match an existing entry.
    'next_entry: while let Some(entry) = entry_queue.read_item() {
        let pkg_id = node_pkg_ids[entry.node_id.get() as usize];

        let dedupe_entry = dedupe.get_or_put(pkg_id)?;
        if !dedupe_entry.found_existing {
            *dedupe_entry.value_ptr = Vec::new();
        } else {
            let curr_peers = &node_peers[entry.node_id.get() as usize];
            let curr_dep_id = node_dep_ids[entry.node_id.get() as usize];

            for info in dedupe_entry.value_ptr.iter() {
                if info.dep_id == invalid_dependency_id || curr_dep_id == invalid_dependency_id {
                    if info.dep_id != curr_dep_id {
                        continue;
                    }
                }
                if info.dep_id != invalid_dependency_id && curr_dep_id != invalid_dependency_id {
                    let curr_dep = &dependencies[curr_dep_id as usize];
                    let existing_dep = &dependencies[info.dep_id as usize];

                    if existing_dep.version.tag == VersionTag::Workspace
                        && curr_dep.version.tag == VersionTag::Workspace
                    {
                        if existing_dep.behavior.is_workspace() != curr_dep.behavior.is_workspace()
                        {
                            continue;
                        }
                    }
                }

                if info.peers.eql(curr_peers, &peer_ctx) {
                    // dedupe! depend on the already created entry
                    let item = store::entry::DependenciesItem {
                        entry_id: info.entry_id,
                        dep_id: curr_dep_id,
                    };

                    // A second name for the entry. One that is not linked leaves it to the next.
                    if curr_dep_id != invalid_dependency_id
                        && info.dep_id != invalid_dependency_id
                        && pkg_resolutions[pkg_id as usize].can_enqueue_install_task()
                    {
                        let curr_dep = &dependencies[curr_dep_id as usize];
                        if curr_dep.name_hash != dependencies[info.dep_id as usize].name_hash
                            && claim_hidden_hoist(
                                manager,
                                &mut hidden_hoisted,
                                curr_dep.name.slice(string_buf),
                            )?
                        {
                            hidden_hoist_keys.push(item);
                        }
                    }

                    let mut entries = store_entries.slice();
                    // disjoint-column views via `split_mut`.
                    let store::entry::EntryColumnsMut {
                        dependencies: entry_dependencies,
                        parents: entry_parents,
                        ..
                    } = entries.split_mut();

                    entry_parents[info.entry_id.get() as usize].push(entry.entry_parent_id);
                    if curr_dep_id == invalid_dependency_id
                        || !dependencies[curr_dep_id as usize].behavior.is_workspace()
                    {
                        entry_dependencies[entry.entry_parent_id.get() as usize]
                            .insert(item, &dependencies_ctx)?;
                    }
                    continue 'next_entry;
                }
            }

            // nothing matched - create a new entry
        }

        let new_entry_peer_hash: store::entry::PeerHash = 'peer_hash: {
            let peers = &node_peers[entry.node_id.get() as usize];
            // Read it once, here, because the integrity of a package that has none is recorded
            // while tasks run.
            let pinned: &[u8] = match pkg_resolutions[pkg_id as usize].tag {
                ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                    pkgs.items_meta()[pkg_id as usize].integrity.slice()
                }
                _ => &[],
            };
            if peers.len() == 0 {
                break 'peer_hash pinned
                    .first_chunk()
                    .map_or(store::entry::PeerHash::NONE, |head| {
                        store::entry::PeerHash::from(u64::from_be_bytes(*head))
                    });
            }
            let mut hasher = Wyhash11::init(0);
            hasher.update(pinned);
            for peer_ids in peers.slice() {
                let pkg_name = pkg_names[peer_ids.pkg_id as usize];
                hasher.update(pkg_name.slice(string_buf));
                let pkg_res = &pkg_resolutions[peer_ids.pkg_id as usize];
                res_fmt_buf.clear();
                write!(
                    &mut res_fmt_buf,
                    "{}",
                    pkg_res.fmt(string_buf, bun_fmt::PathSep::Posix)
                )
                .expect("Vec<u8> write is infallible");
                hasher.update(&res_fmt_buf);
            }
            break 'peer_hash store::entry::PeerHash::from(hasher.final_());
        };

        let new_entry_dep_id = node_dep_ids[entry.node_id.get() as usize];

        let new_entry_is_root = new_entry_dep_id == invalid_dependency_id;
        let new_entry_is_workspace = !new_entry_is_root
            && dependencies[new_entry_dep_id as usize].version.tag == VersionTag::Workspace;

        let new_entry_dependencies: store::entry::Dependencies =
            if dedupe_entry.found_existing && new_entry_is_workspace {
                store::entry::Dependencies::default()
            } else {
                store::entry::Dependencies::init_capacity(
                    node_nodes[entry.node_id.get() as usize].len(),
                )?
            };

        // never hoisted, so it must not claim the hoist slots for its name below
        let new_entry_nested_folder = nested_folders.is_set(pkg_id as usize);

        // An entry that is not linked claims its name too, or a deeper package would shadow it.
        let hoisted = !new_entry_nested_folder
            && new_entry_dep_id != invalid_dependency_id
            && !is_unlinked_member(new_entry_dep_id)
            && claim_hidden_hoist(
                manager,
                &mut hidden_hoisted,
                lockfile.str(&dependencies[new_entry_dep_id as usize].name),
            )?;

        let new_entry_id: store::entry::Id =
            store::entry::Id::from(u32::try_from(store_entries.len()).expect("int cast"));
        store_entries.append(StoreEntry {
            node_id: entry.node_id,
            dependencies: new_entry_dependencies,
            parents: vec![entry.entry_parent_id],
            peer_hash: new_entry_peer_hash,
            hoisted,
            nested_folder: new_entry_nested_folder,
            step: core::sync::atomic::AtomicU32::new(0),
            entry_hash: 0,
            scripts: core::cell::Cell::new(None),
        })?;

        // skip implicit workspace dependencies on the root.
        if let Some(entry_parent_id) = entry.entry_parent_id.try_get()
            && let Some(new_entry_dep) = dependencies.get(new_entry_dep_id as usize)
            && !new_entry_dep.behavior.is_workspace()
        {
            let item = store::entry::DependenciesItem {
                entry_id: new_entry_id,
                dep_id: new_entry_dep_id,
            };
            let mut entries = store_entries.slice();
            let entry_dependencies = entries.items_dependencies_mut();
            entry_dependencies[entry_parent_id as usize].insert(item, &dependencies_ctx)?;

            let dep_name = new_entry_dep.name.slice(string_buf);
            if entry.entry_parent_id == store::entry::Id::ROOT {
                // make sure direct dependencies are not replaced
                public_hoisted.put(dep_name, ())?;
            } else if !new_entry_nested_folder
                && (manager.options.public_hoist_pattern.as_ref())
                    .is_some_and(|pattern| pattern.is_match(dep_name))
                && !public_hoisted.get_or_put(dep_name)?.found_existing
            {
                // transitive dependencies (also direct dependencies of workspaces!)
                entry_dependencies[0].insert(item, &dependencies_ctx)?;
            }
        }

        dedupe_entry.value_ptr.push(DedupeInfo {
            entry_id: new_entry_id,
            dep_id: new_entry_dep_id,
            peers: node_peers[entry.node_id.get() as usize].clone(),
        });

        for &child_node_id in &node_nodes[entry.node_id.get() as usize] {
            entry_queue.write_item(QueuedEntry {
                node_id: child_node_id,
                entry_parent_id: new_entry_id,
            })?;
        }
    }

    if print_timings {
        let dedupe_end = timer.elapsed();
        bun_core::pretty_errorln!(
            "Created store [{}]",
            bun_fmt::fmt_duration_one_decimal(dedupe_end.as_nanos() as u64)
        );
    }

    Ok(Store {
        entries: store_entries,
        nodes,
        hidden_hoist_keys,
    })
}

/// Moves what another linker installed out of every `node_modules`, into `.old_modules-<hex>`. The
/// entries are moved one by one, because `node_modules` itself may be a mount point.
pub(crate) fn move_node_modules_aside(
    lockfile: &Lockfile,
    keep_links: bool,
    log_level: LogLevel,
) -> Option<OldModules> {
    let mut old_modules = AutoRelPath::from(b"node_modules").assume_ok();
    let rand = fast_random();
    old_modules
        .append_fmt(format_args!(
            "{}{}",
            OldModules::PREFIX,
            bun_fmt::hex_lower(bun_core::bytes_of(&rand))
        ))
        .assume_ok();
    if sys::mkdirat(Fd::cwd(), old_modules.slice_z(), 0o755).is_err() {
        return None;
    }
    let old_modules_name = old_modules.basename().to_vec();
    let mut not_cleared: Vec<Box<[u8]>> = Vec::new();
    // Nothing is moved out of a `node_modules` that is a symlink. See `LinkedNodeModules`.
    // Returns `None` if `node_modules` does not exist.
    let mut is_linked = |node_modules: &mut AutoRelPath| {
        let is_linked = LinkedNodeModules::is_at(node_modules.slice_z())?;
        if is_linked && holds_a_tree(node_modules.slice(), &old_modules_name) {
            not_cleared.push(node_modules.slice().into());
        }
        Some(is_linked)
    };

    let mut node_modules = AutoRelPath::from(b"node_modules").assume_ok();
    if is_linked(&mut node_modules) == Some(false) {
        move_entries_aside(&mut node_modules, &mut old_modules, keep_links, log_level);
    }

    for (i, workspace_path) in lockfile.workspace_paths.values().iter().enumerate() {
        let workspace_path = workspace_path.slice(&lockfile.buffers.string_bytes);
        if lockfile.is_member_path_outside(workspace_path) {
            continue;
        }
        let mut workspace_node_modules = AutoRelPath::from(workspace_path).assume_ok();
        workspace_node_modules.append(b"node_modules").assume_ok();
        if is_linked(&mut workspace_node_modules) != Some(false) {
            continue;
        }

        // Don't use the folder's name, because `apps/web` and `packages/web` would collide.
        let old_modules_len = old_modules.len();
        old_modules
            .append_fmt(format_args!(".old_{i}_modules"))
            .assume_ok();

        move_entries_aside(
            &mut workspace_node_modules,
            &mut old_modules,
            false,
            log_level,
        );
        let _ = sys::rmdir(workspace_node_modules.slice_z());

        old_modules.set_length(old_modules_len);
    }
    LinkedNodeModules::warn_not_cleared(log_level, &not_cleared);

    if sys::rmdir(old_modules.slice_z()).is_ok() {
        // nothing was there
        return None;
    }
    Some(OldModules(old_modules_name.into_boxed_slice()))
}

/// Returns true if a linker created the `node_modules` entry `name`. No package name starts with a
/// dot, so a dot entry that no package manager creates belongs to another tool (e.g. `.vite`).
fn is_a_linkers(name: &[u8]) -> bool {
    const OF_A_PACKAGE_MANAGER: [&[u8]; 6] = [
        b".bin",
        b".bun",
        b".modules.yaml",
        b".package-lock.json",
        b".yarn-integrity",
        b".yarn-state.yml",
    ];
    name[0] != b'.'
        || OF_A_PACKAGE_MANAGER.contains(&name)
        || name.starts_with(b".pnpm")
        || crate::prune::is_leftover(name)
}

/// Returns true if `move_entries_aside` would move anything out of `node_modules`.
fn holds_a_tree(node_modules: &[u8], old_modules_name: &[u8]) -> bool {
    use bun_sys::FdExt as _;

    let Ok(dir) = sys::open_dir_for_iteration(Fd::cwd(), node_modules) else {
        return false;
    };
    let mut iter = sys::iterate_dir(dir);
    let mut found = false;
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if is_a_linkers(name) && name != old_modules_name {
            found = true;
            break;
        }
    }
    dir.close();
    found
}

/// Creates `to` and moves every entry that a linker created from `from` into it. `to` may be a
/// directory inside `from`.
fn move_entries_aside(
    from: &mut AutoRelPath,
    to: &mut AutoRelPath,
    keep_links: bool,
    log_level: LogLevel,
) {
    use bun_sys::FdExt as _;

    let Ok(dir) = sys::open_dir_for_iteration(Fd::cwd(), from.slice()) else {
        return;
    };
    let _ = sys::mkdirat(Fd::cwd(), to.slice_z(), 0o755);
    let mut iter = sys::iterate_dir(dir);
    while let Ok(Some(entry)) = iter.next() {
        let name = entry.name.slice_u8();
        if !is_a_linkers(name) || name == to.basename() {
            continue;
        }
        if keep_links && entry.kind == sys::EntryKind::SymLink {
            continue;
        }

        let (from_len, to_len) = (from.len(), to.len());
        let moved = if from.try_append(name).is_err() || to.try_append(name).is_err() {
            Err(sys::Error::from_code(
                sys::E::ENAMETOOLONG,
                sys::Tag::rename,
            ))
        } else if entry.kind == sys::EntryKind::Directory && name[0] == b'@' {
            move_entries_aside(from, to, keep_links, log_level);
            let _ = sys::rmdir(from.slice_z());
            Ok(())
        } else {
            move_or_delete(from.slice_z(), to.slice_z())
        };
        if let Err(err) = moved
            && log_level != LogLevel::Silent
        {
            bun_core::warn!(
                "{}: failed to remove {} (installed by another linker)",
                BStr::new(err.name()),
                BStr::new(from.slice()),
            );
        }

        from.set_length(from_len);
        to.set_length(to_len);
    }
    dir.close();
}

/// Moves `from` to `to`, or deletes it if it cannot be moved, because anything left of the other
/// linker's tree would shadow the new one. A mount point is left in place.
fn move_or_delete(from: &bun_core::ZStr, to: &bun_core::ZStr) -> sys::Result<()> {
    use bun_sys::FdExt as _;

    let Err(err) = sys::renameat(Fd::cwd(), from, Fd::cwd(), to) else {
        return Ok(());
    };
    if err.get_errno() == sys::E::ENOENT {
        return Ok(());
    }
    match sys::rmdir(from) {
        Err(err) if err.get_errno() != sys::E::EBUSY => {}
        // `EBUSY` means that `from` is a mount point. The rename's own error does not show that: it
        // is `EXDEV` when `to` is inside a mounted volume as well.
        _ => return Ok(()),
    }
    // `from` is on another file system, or it is a directory from a lower overlayfs layer (Docker).
    if err.get_errno() == sys::E::EXDEV {
        return Fd::cwd().delete_tree(from);
    }
    // On Windows, a program has a file in `from` open. Deleting `from` would stop halfway, so it is
    // left intact.
    Err(err)
}

/// Fails unless `path`, links followed, is a directory.
fn expect_directory(path: &bun_core::ZStr) -> sys::Result<()> {
    // `exists_at_type` reports a junction itself, so a dangling one would pass.
    #[cfg(windows)]
    {
        use bun_sys::FdExt as _;
        sys::openat(Fd::cwd(), path, sys::O::RDONLY | sys::O::DIRECTORY, 0).map(|fd| fd.close())
    }
    #[cfg(not(windows))]
    {
        match sys::exists_at_type(Fd::cwd(), path)? {
            sys::ExistsAtType::Directory => Ok(()),
            sys::ExistsAtType::File => {
                Err(sys::Error::from_code(sys::E::ENOTDIR, sys::Tag::fstatat))
            }
        }
    }
}

/// Runs before anything on disk changes, because dependencies loaded from bun.lock skip the
/// resolver's trust check.
fn check_link_entries(manager: &mut PackageManager, lockfile: &Lockfile, store: &Store) {
    let string_buf = &lockfile.buffers.string_bytes[..];
    let pkgs = lockfile.packages.slice();
    let pkg_names = pkgs.items_name();
    let pkg_resolutions = pkgs.items_resolution();
    let node_pkg_ids = store.nodes.items_pkg_id();
    for &node_id in store.entries.items_node_id() {
        let pkg_id = node_pkg_ids[node_id.get() as usize];
        let pkg_res = &pkg_resolutions[pkg_id as usize];
        if pkg_res.tag != ResolutionTag::Symlink {
            continue;
        }
        let target = pkg_res.symlink().slice(string_buf);
        let name = BStr::new(pkg_names[pkg_id as usize].slice(string_buf));
        let base_len = if !crate::dependency::is_link_path(target) {
            crate::package_manager_real::directories::global_link_dir_path(manager).len() + 1
        } else if !lockfile.is_trusted_folder_package(pkg_id) {
            Output::err_generic(
                "refusing to link dependency <b>{}<r> to \"{}\": {}",
                (
                    name,
                    bun_core::fmt::escape_control_chars(target),
                    crate::dependency::LINK_PATH_RULE,
                ),
            );
            Output::flush();
            Global::exit(1);
        } else if bun_paths::is_absolute(target) {
            0
        } else {
            crate::bun_fs::FileSystem::instance().top_level_dir().len() + 1
        };
        if base_len + target.len() >= bun_paths::MAX_PATH_BYTES {
            Output::err(
                "ENAMETOOLONG",
                "link path for package <b>{}<r> is too long",
                (name,),
            );
            Output::flush();
            Global::exit(1);
        }
    }
}

/// Runs on main thread
pub(crate) fn install_isolated_packages(
    manager: &mut PackageManager,
    command_ctx: Command::Context,
    install_root_dependencies: bool,
    workspace_filters: &[WorkspaceFilter],
    packages_to_install: Option<&[PackageID]>,
    warn_incorrect_peers: bool,
) -> Result<crate::package_install::Summary, AllocError> {
    analytics::features::isolated_bun_install.fetch_add(1, Ordering::Relaxed);

    let lockfile: *mut Lockfile = &raw mut *manager.lockfile;
    // SAFETY: `lockfile` was just derived from `&raw mut *manager.lockfile`;
    // `manager` outlives this function and no other `&mut Lockfile` is formed
    // while this reborrow is live (column slices below borrow through it).
    let lockfile: &mut Lockfile = unsafe { &mut *lockfile };

    let store: Store = build_store(
        &*manager,
        &*lockfile,
        install_root_dependencies,
        workspace_filters,
        packages_to_install,
        manager.options.log_level.is_verbose(),
    )?;
    check_link_entries(manager, &*lockfile, &store);
    if warn_incorrect_peers {
        let linked = linked_nodes(&store, &*lockfile)?;
        manager.warn_incorrect_peers(&peers_served_in(&store, &*lockfile, Some(&linked)));
    }

    let global_store_path: Option<Vec<u8>> = if manager.options.enable.global_virtual_store() {
        'global_store_path: {
            let mut entries = store.entries.slice();
            let store::entry::EntryColumnsMut {
                entry_hash: entry_hashes,
                node_id: entry_node_ids,
                dependencies: entry_dependencies,
                ..
            } = entries.split_mut();

            let node_pkg_ids = store.nodes.items_pkg_id();
            let node_dep_ids = store.nodes.items_dep_id();

            let pkgs = lockfile.packages.slice();
            let pkg_names = pkgs.items_name();
            let pkg_resolutions = pkgs.items_resolution();
            let pkg_metas = pkgs.items_meta();

            let string_buf = &lockfile.buffers.string_bytes[..];
            let dependencies = &lockfile.buffers.dependencies[..];

            // Packages newly trusted via `bun add --trust` (not yet written to the
            // lockfile) will have their lifecycle scripts run this install; treat
            // them the same as lockfile-trusted packages for eligibility.
            let trusted_from_update = manager.find_trusted_dependencies_from_update_requests();

            let no_verify = manager.skips_verify(ResolutionTag::Npm);
            // Include the integrity, because the store path `name@version` isn't unique across
            // registries.
            let hash_entry = |seed: u64, id: store::entry::Id| {
                let mut h = Wyhash::init(seed);
                // `no_verify` is hashed so that a verified install never shares an entry whose
                // bytes were not checked.
                h.update(&[GLOBAL_STORE_LAYOUT, u8::from(no_verify)]);
                let path = store::entry::fmt_store_path(id, &store, lockfile);
                // The path is the only input without a fixed length, so a NUL marks its end.
                write!(WyhashWriter { hasher: &mut h }, "{path}\0").expect("unreachable");
                let pkg_id = store.ids(id).pkg_id as usize;
                h.update(bun_core::bytes_of(&pkg_metas[pkg_id].integrity));
                h
            };

            let mut trusted_entries: Vec<usize> = Vec::new();

            let mut types_pkg_name_hashes: ArrayHashMap<PackageNameHash, ()> =
                ArrayHashMap::default();
            for (name, &name_hash) in pkg_names.iter().zip(pkgs.items_name_hash()) {
                if name.slice(string_buf).starts_with(b"@types/") {
                    types_pkg_name_hashes.put(name_hash, ())?;
                }
            }

            // 0 means "not eligible". The SCC pass turns each 1 into the entry's hash, or into 0.
            for entry_idx in 0..store.entries.len() {
                let node_id = entry_node_ids[entry_idx];
                let pkg_id = node_pkg_ids[node_id.get() as usize];
                let dep_id = node_dep_ids[node_id.get() as usize];
                let pkg_res = &pkg_resolutions[pkg_id as usize];

                // Don't use `do.run_scripts` or `hasInstallScript()`, because they vary between
                // installs.
                let is_trusted = {
                    let dep_name = if dep_id != invalid_dependency_id {
                        dependencies[dep_id as usize].name.slice(string_buf)
                    } else {
                        pkg_names[pkg_id as usize].slice(string_buf)
                    };
                    lockfile.has_trusted_dependency(
                        dep_name,
                        pkg_names[pkg_id as usize].slice(string_buf),
                        pkg_res,
                    ) || trusted_from_update.contains(&pkg_id)
                };

                let eligible = match pkg_res.tag {
                    ResolutionTag::Npm
                    | ResolutionTag::Git
                    | ResolutionTag::Github
                    | ResolutionTag::LocalTarball
                    | ResolutionTag::RemoteTarball => 'eligible: {
                        // A patch or a lifecycle script changes the package's own directory.
                        if is_trusted {
                            trusted_entries.push(entry_idx);
                            break 'eligible false;
                        }
                        if lockfile.patched_dependencies.count() > 0 {
                            let mut name_version_buf = bun_paths::path_buffer_pool::get();
                            let mut cursor = std::io::Cursor::new(&mut name_version_buf.0[..]);
                            let name_version: &[u8] = match write!(
                                &mut cursor,
                                "{}@{}",
                                BStr::new(pkg_names[pkg_id as usize].slice(string_buf)),
                                pkg_res.fmt(string_buf, bun_fmt::PathSep::Posix),
                            ) {
                                Ok(()) => {
                                    let n = cursor.position() as usize;
                                    &name_version_buf.0[..n]
                                }
                                // Too long to look up, so possibly patched.
                                Err(_) => break 'eligible false,
                            };
                            if lockfile.patched_dependencies.contains(
                                &semver::semver_string::Builder::string_hash(name_version),
                            ) {
                                break 'eligible false;
                            }
                        }
                        // From the cache TypeScript cannot reach the project's `@types`.
                        if types_pkg_name_hashes.count() > 0 {
                            let peers = &store.nodes.items_peers()[node_id.get() as usize];
                            for peer in peers.slice() {
                                let types_name_hash = types_package_name_hash(
                                    dependencies[peer.dep_id as usize].name.slice(string_buf),
                                );
                                if types_pkg_name_hashes.contains(&types_name_hash)
                                    && !entry_dependencies[entry_idx].slice().iter().any(|dep| {
                                        dependencies[dep.dep_id as usize].name_hash
                                            == types_name_hash
                                    })
                                {
                                    break 'eligible false;
                                }
                            }
                        }
                        true
                    }
                    // The root and workspaces are excluded, because otherwise most of the graph
                    // would be project-local.
                    ResolutionTag::Folder => {
                        if is_trusted {
                            trusted_entries.push(entry_idx);
                        }
                        false
                    }
                    _ => false,
                };
                entry_hashes[entry_idx] = u64::from(eligible);
            }

            // A trusted entry's scripts can write through its `node_modules/<dep>` links.
            {
                let mut visited = DynamicBitSet::init_empty(store.entries.len())?;
                while let Some(entry_idx) = trusted_entries.pop() {
                    for dep in entry_dependencies[entry_idx].slice() {
                        let dep_entry_idx = dep.entry_id.get() as usize;
                        if !visited.is_set(dep_entry_idx) {
                            visited.set(dep_entry_idx);
                            entry_hashes[dep_entry_idx] = 0;
                            trusted_entries.push(dep_entry_idx);
                        }
                    }
                }
            }

            // SCC pass (Tarjan). The members of a cycle share one hash, no matter which one is
            // listed first.
            {
                let n: u32 = u32::try_from(store.entries.len()).expect("int cast");
                let mut tarjan_index = vec![u32::MAX; n as usize].into_boxed_slice();
                let mut lowlink = vec![0u32; n as usize].into_boxed_slice();
                let mut on_stack = vec![false; n as usize].into_boxed_slice();

                let mut scc_stack: Vec<u32> = Vec::new();
                let mut work: Vec<WorkFrame> = Vec::new();

                let mut index_counter: u32 = 0;
                for root in 0..n as usize {
                    if tarjan_index[root] != u32::MAX {
                        continue;
                    }
                    work.push(WorkFrame {
                        v: u32::try_from(root).expect("int cast"),
                        child: 0,
                    });
                    while !work.is_empty() {
                        let frame_idx = work.len() - 1;
                        let v = work[frame_idx].v;
                        if work[frame_idx].child == 0 {
                            tarjan_index[v as usize] = index_counter;
                            lowlink[v as usize] = index_counter;
                            index_counter += 1;
                            scc_stack.push(v);
                            on_stack[v as usize] = true;
                        }
                        let deps = entry_dependencies[v as usize].slice();
                        let mut recursed = false;
                        while (work[frame_idx].child as usize) < deps.len() {
                            let w = deps[work[frame_idx].child as usize].entry_id.get() as usize;
                            if tarjan_index[w] == u32::MAX {
                                work[frame_idx].child += 1;
                                work.push(WorkFrame {
                                    v: u32::try_from(w).expect("int cast"),
                                    child: 0,
                                });
                                recursed = true;
                                break;
                            } else if on_stack[w] {
                                lowlink[v as usize] = lowlink[v as usize].min(tarjan_index[w]);
                            }
                            work[frame_idx].child += 1;
                        }
                        if recursed {
                            continue;
                        }
                        if lowlink[v as usize] == tarjan_index[v as usize] {
                            let start = scc_stack.iter().rposition(|&m| m == v).unwrap();
                            let members: Vec<u32> = scc_stack[start..].to_vec();
                            for &m in &members {
                                on_stack[m as usize] = false;
                            }
                            if members.len() == 1 {
                                // SCCs come in reverse topological order, so the hash of each
                                // dependency is already final.
                                let m = members[0];
                                if entry_hashes[m as usize] != 0 {
                                    let mut sub =
                                        hash_entry(0x9E3779B97F4A7C15, store::entry::Id::from(m));
                                    let mut poisoned = false;
                                    for dep in entry_dependencies[m as usize].slice() {
                                        let dh = entry_hashes[dep.entry_id.get() as usize];
                                        if dh == 0 {
                                            poisoned = true;
                                            break;
                                        }
                                        let dep_name_hash =
                                            dependencies[dep.dep_id as usize].name_hash;
                                        sub.update(bun_core::bytes_of(&dep_name_hash));
                                        sub.update(bun_core::bytes_of(&dh));
                                    }
                                    entry_hashes[m as usize] =
                                        if poisoned { 0 } else { sub.final_().max(1) };
                                }
                            } else if members.len() > 1 {
                                // The whole SCC gets one hash of its members' sub-hashes, which are
                                // sorted by content so that the hash is the same in every project.
                                let own: Vec<u64> = (members.iter())
                                    .map(|&m| hash_entry(0, store::entry::Id::from(m)).final_())
                                    .collect();
                                let mut member_sub: Vec<u64> = Vec::new();
                                let mut any_ineligible = false;
                                for (&m, own_hash) in members.iter().zip(&own) {
                                    if entry_hashes[m as usize] == 0 {
                                        any_ineligible = true;
                                    }
                                    let mut sub = Wyhash::init(0);
                                    sub.update(bun_core::bytes_of(own_hash));
                                    // The list is sorted by alias, which is the name of the link.
                                    for dep in entry_dependencies[m as usize].slice() {
                                        let di = dep.entry_id.get();
                                        // The final hash of another member is not known yet, so
                                        // its `own` hash is used instead.
                                        let in_scc = members.iter().position(|&other| other == di);
                                        let linked = match in_scc {
                                            Some(other) => own[other],
                                            None => entry_hashes[di as usize],
                                        };
                                        if linked == 0 {
                                            any_ineligible = true;
                                        }
                                        sub.update(bun_core::bytes_of(
                                            &dependencies[dep.dep_id as usize].name_hash,
                                        ));
                                        sub.update(&[u8::from(in_scc.is_some())]);
                                        sub.update(bun_core::bytes_of(&linked));
                                    }
                                    member_sub.push(sub.final_());
                                }
                                index_sort::sort_slice_unstable_by(&mut member_sub, |a, b| {
                                    a.cmp(b)
                                });
                                let mut hasher = Wyhash::init(0x42A7C15F9E3779B9);
                                for k in &member_sub {
                                    hasher.update(bun_core::bytes_of(k));
                                }
                                let h = hasher.final_().max(1);
                                let final_h: u64 = if any_ineligible { 0 } else { h };
                                for &m in &members {
                                    entry_hashes[m as usize] = final_h;
                                }
                            }
                            scc_stack.truncate(start);
                        }
                        work.pop();
                        if let Some(parent) = work.last() {
                            let pv = parent.v as usize;
                            lowlink[pv] = lowlink[pv].min(lowlink[v as usize]);
                        }
                    }
                }
            }

            // <cache_dir>/links — created lazily by the first task that misses.
            // getCacheDirectory() populates `cache_directory_path` as a side-effect.
            let _ = manager.get_cache_directory();
            let cache_dir_path = &manager.cache_directory_path;
            if cache_dir_path.is_empty() {
                break 'global_store_path None;
            }
            // Own a Vec<u8> with a trailing NUL so it can be re-borrowed as
            // a `&ZStr` for `Installer.global_store_path` below.
            let joined = paths::resolve_path::join_abs_string::<paths::platform::Auto>(
                cache_dir_path,
                &[b"links"],
            );
            let mut owned = joined.to_vec();
            owned.push(0);
            break 'global_store_path Some(owned);
        }
    } else {
        None
    };

    let linked = {
        let mut node_modules = AbsPath::init_top_level_dir();
        node_modules.append(b"node_modules").assume_ok();
        LinkedNodeModules::at(node_modules.slice_z())
    };

    // setup node_modules/.bun
    let mut old_modules: Option<OldModules> = None;
    let is_new_bun_modules: bool = 'is_new_bun_modules: {
        let node_modules_path = paths::path_literal!("node_modules");
        let bun_modules_path = paths::path_literal!("node_modules/.bun");

        let is_new_node_modules = sys::mkdirat(Fd::cwd(), node_modules_path, 0o755).is_ok();
        // 'node_modules' itself may be a link.
        if !is_new_node_modules
            && let Err(err) = crate::prune::remove_planted_links(
                paths::path_literal!("node_modules/.bun/node_modules").as_bytes(),
                node_modules_path.len(),
            )
        {
            Output::err(
                err,
                "failed to remove a link at './node_modules/.bun'",
                format_args!(""),
            );
            Global::exit(1);
        }
        if !is_new_node_modules
            && sys::directory_exists_at(Fd::cwd(), bun_modules_path).unwrap_or(false)
        {
            break 'is_new_bun_modules false;
        }

        // The existing contents weren't created by this linker. `--filter` leaves the workspaces
        // that it doesn't link alone.
        if !is_new_node_modules
            || (!lockfile.workspace_paths.is_empty() && workspace_filters.is_empty())
        {
            old_modules = move_node_modules_aside(
                lockfile,
                manager.options.global,
                manager.options.log_level,
            );
        }

        if let Err(err) = sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755) {
            Output::err(
                err,
                "failed to create './node_modules/.bun'",
                format_args!(""),
            );
            Global::exit(1);
        }

        break 'is_new_bun_modules true;
    };

    // Remove the fallback a previous install with hoisting on left behind.
    // `delete_tree` succeeds on a missing tree, so any error here is real.
    let clears_fallback = !is_new_bun_modules && linked.is_none();
    if clears_fallback && !manager.options.hoist {
        use bun_sys::FdExt as _;
        if let Err(err) =
            Fd::cwd().delete_tree(paths::path_literal!("node_modules/.bun/node_modules"))
        {
            Output::err(
                err,
                "hoist is disabled, but the existing './node_modules/.bun/node_modules' could not be removed",
                format_args!(""),
            );
            Global::exit(1);
        }
    } else if clears_fallback {
        crate::prune::unlink_unhoisted(manager);
    }

    let store_inode = sys::stat(paths::path_literal!("node_modules/.bun"))
        .ok()
        .map(|st| (st.st_dev, st.st_ino));

    {
        let mut download_node: ProgressNode;
        let mut install_node: ProgressNode = ProgressNode::default();
        let mut scripts_node: ProgressNode;
        let progress: *mut Progress = &raw mut manager.progress;
        // SAFETY: `progress` aliases `manager.progress`; reborrows below are
        // disjoint from the other `manager.*` field accesses.
        let progress = unsafe { &mut *progress };

        if manager.options.log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            let root_node = progress.start(b"", 0);
            download_node = root_node.start(ProgressStrings::download(), 0);
            install_node = root_node.start(ProgressStrings::install(), store.entries.len());
            scripts_node = root_node.start(ProgressStrings::script(), 0);

            manager.downloads_node = None;
            manager.scripts_node = Some(core::ptr::NonNull::from(&mut scripts_node));
            manager.downloads_node = Some(&raw mut download_node);
        }

        let node_pkg_ids = store.nodes.items_pkg_id();

        let entries = store.entries.slice();
        let entry_node_ids = entries.items_node_id();
        let entry_steps = entries.items_step();
        let entry_dependencies = entries.items_dependencies();
        let entry_nested_folder = entries.items_nested_folder();

        // The columns sliced here are never mutated through `installer.lockfile`.
        let lockfile_ptr: *mut Lockfile = lockfile;
        let lockfile_ref = bun_ptr::BackRef::<Lockfile>::from(
            core::ptr::NonNull::new(lockfile_ptr).expect("lockfile BACKREF non-null"),
        );
        let lockfile_ro: &Lockfile = lockfile_ref.get();
        let string_buf = &lockfile_ro.buffers.string_bytes[..];

        let pkgs = lockfile_ro.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();

        // TODO: delete
        let mut seen_workspace_ids: HashMap<PackageID, ()> = HashMap::default();

        let tasks_in_flight = bun_threading::WaitGroup::init();

        let tasks: Box<[installer::Task]> = (0..store.entries.len())
            .map(|i| installer::Task {
                entry_id: store::entry::Id::from(u32::try_from(i).expect("int cast")),
                // Patched below once `installer` has an address. It's never dereferenced before
                // that.
                installer: bun_ptr::BackRef::from(core::ptr::NonNull::dangling()),
                result: installer::Result::None,
                relink: installer::Relink::Off,
                newly_trusted: false,
                blocked_scripts: 0,
                left_out_links: Vec::new(),
                task: bun_threading::thread_pool::CountedTask::new(
                    installer::Task::callback,
                    &tasks_in_flight,
                ),
                next: bun_threading::Link::new(),
            })
            .collect();

        let show_progress = manager.options.log_level.show_progress();
        let installed = DynamicBitSet::init_empty(lockfile.packages.len())?;
        let trusted_dependencies_from_update_requests =
            manager.find_trusted_dependencies_from_update_requests();
        let manager_ptr: *mut PackageManager = manager;
        let mut installer = store::Installer {
            lockfile: lockfile_ptr,
            manager: manager_ptr,
            command_ctx,
            installed,
            install_node: show_progress.then_some(&mut install_node),
            store: &store,
            tasks,
            tasks_in_flight: &tasks_in_flight,
            waiters_head: vec![store::entry::Id::INVALID; store.entries.len()].into_boxed_slice(),
            next_waiter: vec![store::entry::Id::INVALID; store.entries.len()].into_boxed_slice(),
            trusted_dependencies_from_update_requests,
            supported_backend: std::sync::atomic::AtomicU8::new(
                PackageInstall::supported_method() as u8
            ),
            is_new_bun_modules,
            linked,
            staging_lock: Default::default(),
            global_store_path: global_store_path
                .as_deref()
                .map(bun_core::ZStr::from_slice_with_nul),
            global_store_tmp_suffix: fast_random(),
            summary: crate::package_install::Summary {
                old_modules,
                ..Default::default()
            },
            task_queue: Default::default(),
            held_members: Some(Vec::new()),
            left_out_entries: Vec::new(),
            pending_lifecycle_scripts: Default::default(),
        };
        // From here on, no `&mut PackageManager` is held across a call on `installer`, because it
        // would alias.

        let installer_ptr: *mut store::Installer<'static> =
            (&raw mut installer).cast::<()>().cast();
        let installer_backref =
            bun_ptr::BackRef::from(core::ptr::NonNull::new(installer_ptr).unwrap());
        for task in installer.tasks.iter_mut() {
            task.installer = installer_backref;
        }

        // Check this before any file system work, because an entry is linked under names that later
        // entries declare.
        for (&node_id, deps) in entry_node_ids.iter().zip(entry_dependencies) {
            let pkg_id = node_pkg_ids[node_id.get() as usize];
            let name = pkg_names[pkg_id as usize].slice(string_buf);
            // Only a package that's downloaded or copied gets a folder with its own name, in its
            // store entry.
            let own_name_is_safe = if pkg_resolutions[pkg_id as usize].can_enqueue_install_task() {
                crate::package_installer::alias_is_safe_install_target(name)
            } else {
                crate::package_installer::name_is_single_path_entry(name)
            };
            let unsafe_folder_name = if !name.is_empty() && !own_name_is_safe {
                Some(name)
            } else {
                (deps.slice().iter())
                    .map(|dep| {
                        lockfile_ro.buffers.dependencies[dep.dep_id as usize]
                            .name
                            .slice(string_buf)
                    })
                    .find(|name| !crate::package_installer::alias_is_safe_install_target(name))
            };
            if let Some(name) = unsafe_folder_name {
                Output::err_generic(
                    "\"{}\" is not a valid install folder name",
                    (bun_core::fmt::escape_control_chars(name),),
                );
                Output::flush();
                Global::exit(1);
            }
        }

        // add the pending task count upfront
        installer
            .manager_mut()
            .increment_pending_tasks(u32::try_from(store.entries.len()).expect("int cast"));
        // `link:` entries go first, because `Installer::start_link_task` must run before the tasks
        // of their dependents start.
        let is_link = |&entry: &usize| {
            let pkg_id = node_pkg_ids[entry_node_ids[entry].get() as usize];
            pkg_resolutions[pkg_id as usize].tag == ResolutionTag::Symlink
        };
        let links = (0..store.entries.len()).filter(is_link);
        let others = (0..store.entries.len()).filter(|entry| !is_link(entry));
        for _entry_id in links.chain(others) {
            let entry_id = store::entry::Id::from(u32::try_from(_entry_id).expect("int cast"));
            let store::Ids { dep_id, pkg_id } = store.ids(entry_id);
            let pkg_name = pkg_names[pkg_id as usize];
            let pkg_res: Resolution = pkg_resolutions[pkg_id as usize];

            match pkg_res.tag {
                ResolutionTag::Root => {
                    if dep_id == invalid_dependency_id {
                        installer.set_step(entry_id, Step::SymlinkDependencies);
                        installer.start_task(entry_id);
                        continue;
                    }
                    // Dependents link straight to the project's folder. Older versions of Bun
                    // copied the project into the store, so that copy is deleted.
                    if !is_new_bun_modules {
                        use bun_sys::FdExt as _;
                        let mut old_copy: AbsPath = AbsPath::init_top_level_dir();
                        let _ = installer
                            .append_local_store_entry_path(&mut old_copy, entry_id)
                            .and_then(|()| Fd::cwd().delete_tree(old_copy.slice()));
                    }
                    installer.set_step(entry_id, Step::Done);
                    installer.on_task_complete(entry_id, CompleteState::Skipped);
                }
                ResolutionTag::Workspace => {
                    // if injected=true this might be false
                    if !seen_workspace_ids.get_or_put(pkg_id)?.found_existing {
                        installer.set_step(entry_id, Step::SymlinkDependencies);
                        installer.start_task(entry_id);
                        continue;
                    }
                    installer.set_step(entry_id, Step::Done);
                    installer.on_task_complete(entry_id, CompleteState::Skipped);
                }
                ResolutionTag::Symlink => {
                    // Same target check as the hoisted linker's `install_from_link`.
                    let mut link_target = bun_paths::AutoAbsPath::init_top_level_dir();
                    match installer
                        .append_store_path(&mut link_target, entry_id)
                        .and_then(|()| expect_directory(link_target.slice_z()))
                    {
                        Ok(()) => installer.start_link_task(entry_id, link_target.slice_z()),
                        Err(err) => installer.on_task_fail(entry_id, &TaskError::LinkPackage(err)),
                    }
                }
                ResolutionTag::Folder => {
                    // linked by the packages containing it (`Installer::symlink_dependencies`)
                    let nested = entry_nested_folder[entry_id.get() as usize];
                    let folder = pkg_res.folder().slice(string_buf);
                    // The resolver rejects these, so only an edited or old lockfile gets here.
                    let refused = crate::bin::bin_target_escapes_package_dir(folder)
                        && (nested || !lockfile_ro.is_trusted_folder_package(pkg_id));
                    if nested || refused {
                        let state = if refused {
                            Output::err_generic(
                                "refusing to install dependency <b>{}<r> with unsafe folder path \"{}\"",
                                (
                                    BStr::new(pkg_name.slice(string_buf)),
                                    bun_core::fmt::escape_control_chars(folder),
                                ),
                            );
                            Output::flush();
                            if installer.manager().options.enable.fail_early() {
                                Global::exit(1);
                            }
                            CompleteState::Fail
                        } else {
                            CompleteState::Skipped
                        };
                        installer.set_step(entry_id, Step::Done);
                        installer.on_task_complete(entry_id, state);
                        continue;
                    }

                    // folders are always hardlinked to keep them up-to-date
                    if !is_new_bun_modules && !installer.manager().options.enable.force_install() {
                        let mut store_path: AbsPath = AbsPath::init_top_level_dir();
                        if installer
                            .append_real_store_path(&mut store_path, entry_id, Which::Final)
                            .is_ok()
                            && let (Ok(src), Ok(dest)) =
                                (sys::Dir::open(folder), sys::Dir::open(store_path.slice()))
                            && crate::package_install::is_linked_folder(&src, &dest)
                        {
                            installer.start_relink_task(entry_id);
                            continue;
                        }
                    }
                    installer.start_task(entry_id);
                }

                ResolutionTag::Npm
                | ResolutionTag::Git
                | ResolutionTag::Github
                | ResolutionTag::LocalTarball
                | ResolutionTag::RemoteTarball => {
                    let patch_info = match installer.package_patch_info(pkg_id) {
                        Ok(patch_info) => patch_info,
                        Err(err) => {
                            installer.on_task_fail(entry_id, &err);
                            continue;
                        }
                    };

                    let uses_global_store = installer.entry_uses_global_store(entry_id);

                    let needs_install = installer.manager().options.enable.force_install()
                        // A freshly-created `node_modules/.bun` only implies the
                        // *project-local* entries are missing; global virtual-
                        // store entries persist across `rm -rf node_modules` and
                        // should still take the cheap symlink-only path.
                        || (is_new_bun_modules && !uses_global_store)
                        || matches!(patch_info, PatchInfo::Remove)
                        || 'needs_install: {
                            let mut store_path: AbsPath = AbsPath::init_top_level_dir();
                            if uses_global_store {
                                // Global entries are built under a per-process
                                // staging path and renamed into place as the
                                // final step, so the directory existing at its
                                // final path is the completeness signal.
                                break 'needs_install !installer
                                    .append_global_store_entry_path(&mut store_path, entry_id, Which::Final)
                                    .and_then(|()| sys::directory_exists_at(Fd::cwd(), store_path.slice_z()))
                                    .unwrap_or(false);
                            }
                            // Likewise, the package directory appears here only once fully linked.
                            if installer.append_local_store_entry_path(&mut store_path, entry_id).is_err() {
                                break 'needs_install true;
                            }
                            let local_entry_len = store_path.len();
                            if store_path.try_append(b"node_modules").is_err()
                                || store_path.try_append(pkg_name.slice(string_buf)).is_err()
                            {
                                break 'needs_install true;
                            }
                            let package_len = store_path.len();
                            let mut hash_buf: install::BuntagHashBuf = Default::default();
                            let marker = installer::installed_marker(pkg_res.tag, &patch_info, &mut hash_buf);
                            // `exists` follows the link of an entry that left the global store.
                            if store_path.try_append(marker).is_err() || !sys::exists_z(store_path.slice_z()) {
                                break 'needs_install true;
                            }
                            // Like the hoisted linker, replace a tarball copy that holds other bytes than bun.lock pins.
                            if matches!(pkg_res.tag, ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball) {
                                store_path.set_length(package_len);
                                let is_current = store_path.try_append(crate::package_install::BUN_TAG).is_ok()
                                    && sys::File::read_from(Fd::cwd(), store_path.slice()).is_ok_and(|tag| {
                                        crate::package_install::tarball_tag_matches(
                                            &tag,
                                            &pkgs.items_meta()[pkg_id as usize].integrity,
                                            installer.manager().skips_verify(pkg_res.tag),
                                        )
                                    });
                                if !is_current {
                                    break 'needs_install true;
                                }
                            }
                            if cfg!(windows) {
                                // The `..` check below does not work on Windows, which removes `..`
                                // from a path before it follows links.
                                store_path.set_length(local_entry_len);
                                break 'needs_install installer::is_link(store_path.slice_z()) == Some(true);
                            }
                            // `..` goes up from a symlink's target. If part of this path is a link
                            // out of the store, going back up does not reach `node_modules/.bun`.
                            store_path.set_length(package_len);
                            let up: &[u8] = if bun_core::strings::contains_char(pkg_name.slice(string_buf), b'/') {
                                b"../../../.."
                            } else {
                                b"../../.."
                            };
                            store_path.try_append(up).is_err()
                                || !sys::stat(store_path.slice_z()).is_ok_and(|st| Some((st.st_dev, st.st_ino)) == store_inode)
                        };

                    if !needs_install {
                        if installer.manager().options.offline
                            == crate::package_manager_real::options::OfflineMode::Offline
                        {
                            installer.summary.offline_misses.in_place.push(pkg_id);
                        }
                        let mut state = CompleteState::Skipped;
                        if uses_global_store {
                            // Warm hit: the global virtual store already holds
                            // this entry's files, dep symlinks, and bin links.
                            // The only per-install work is the project-level
                            // `node_modules/.bun/<storepath>` → global symlink.
                            match installer.link_project_to_global_store(entry_id) {
                                // The entry is new to this project and none of its tasks run, so
                                // its blocked scripts are counted here.
                                Ok(true) => {
                                    let blocked = installer::Task::count_blocked_scripts(
                                        &installer,
                                        entry_id,
                                        Which::Final,
                                    );
                                    installer.tasks[entry_id.get() as usize].blocked_scripts =
                                        blocked;
                                    state = CompleteState::Success;
                                }
                                Ok(false) => {}
                                Err(err) => {
                                    installer.on_task_fail(
                                        entry_id,
                                        &TaskError::SymlinkDependencies(err),
                                    );
                                    continue;
                                }
                            }
                        }
                        installer.link_to_hidden_node_modules(entry_id);
                        if !uses_global_store {
                            installer.start_relink_task(entry_id);
                            continue;
                        }
                        installer.set_step(entry_id, Step::Done);
                        installer.on_task_complete(entry_id, state);
                        continue;
                    }

                    // Downloads only produce the unpatched folder; `apply_package_patch` derives the rest.
                    let cache_subpath_z = installer.cached_folder_name(entry_id, None);
                    let cache_dir = installer.manager_mut().get_cache_directory();

                    let missing_from_cache = match installer.manager().get_preinstall_state(pkg_id)
                    {
                        // A tarball's cache entry has no name until extraction records its
                        // integrity.
                        _ if cache_subpath_z.is_empty() => true,
                        install::PreinstallState::Done => false,
                        _ => {
                            let exists = package_manager::directories::is_package_in_cache_at(
                                cache_dir,
                                cache_subpath_z,
                                pkg_res.tag,
                            );
                            if exists {
                                installer
                                    .manager_mut()
                                    .set_preinstall_state(pkg_id, install::PreinstallState::Done);
                            }
                            !exists
                        }
                    };

                    if !missing_from_cache {
                        match installer.apply_package_patch(entry_id, &patch_info) {
                            Ok(()) => installer.start_task(entry_id),
                            Err(err) => installer.on_task_fail(entry_id, &err),
                        }
                        continue;
                    }

                    let ctx = install::TaskCallbackContext::IsolatedPackageInstallContext(entry_id);

                    let dep = &lockfile_ro.buffers.dependencies[dep_id as usize];

                    let enqueued = match pkg_res.tag {
                        ResolutionTag::Npm => package_manager::enqueue_package_for_download(
                            installer.manager_mut(),
                            pkg_name.slice(string_buf),
                            dep_id,
                            pkg_id,
                            pkg_res.npm().version,
                            pkg_res.npm().url.slice(string_buf),
                            ctx,
                        ),
                        ResolutionTag::Git => package_manager::enqueue_git_for_checkout(
                            installer.manager_mut(),
                            dep_id,
                            pkg_id,
                            dep.name.slice(string_buf),
                            ctx,
                            patch_info.name_and_version_hash(),
                        ),
                        ResolutionTag::Github => {
                            let url = installer.manager().alloc_github_url(pkg_res.github());
                            package_manager::enqueue_tarball_for_download(
                                installer.manager_mut(),
                                dep_id,
                                pkg_id,
                                &url,
                                ctx,
                            )
                        }
                        ResolutionTag::LocalTarball => {
                            package_manager::enqueue_tarball_for_reading(
                                installer.manager_mut(),
                                dep_id,
                                pkg_id,
                                dep.name.slice(string_buf),
                                &pkg_res,
                                ctx,
                            )
                        }
                        _ => package_manager::enqueue_tarball_for_download(
                            installer.manager_mut(),
                            dep_id,
                            pkg_id,
                            pkg_res.remote_tarball().slice(string_buf),
                            ctx,
                        ),
                    };
                    match enqueued {
                        Ok(()) => {}
                        Err(ForTarballError::OutOfMemory) => bun_core::out_of_memory(),
                        Err(ForTarballError::AlreadyFailed | ForTarballError::Offline) => {
                            installer.on_download_not_queued(entry_id);
                        }
                        Err(err @ ForTarballError::InvalidURL) => {
                            Output::err(
                                err,
                                "failed to enqueue {} for download: {}@{}",
                                (
                                    match pkg_res.tag {
                                        ResolutionTag::Npm => "package",
                                        ResolutionTag::Github => "github package",
                                        _ => "tarball",
                                    },
                                    BStr::new(pkg_name.slice(string_buf)),
                                    bun_fmt::for_terminal(
                                        pkg_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                                    ),
                                ),
                            );
                            Output::flush();
                            if installer.manager().options.enable.fail_early() {
                                Global::exit(1);
                            }
                            installer.set_step(entry_id, Step::Done);
                            installer.on_task_complete(entry_id, CompleteState::Fail);
                        }
                    }
                }

                _ => {
                    // this is `uninitialized` or `single_file_module`.
                    debug_assert!(false);
                    installer.set_step(entry_id, Step::Done);
                    installer.on_task_complete(entry_id, CompleteState::Skipped);
                }
            }
        }

        if installer.manager().pending_task_count() > 0 {
            let mgr: *mut PackageManager = manager_ptr;
            let mut wait = Wait {
                installer: &mut installer,
                err: None,
            };
            // SAFETY: `mgr` is the same raw `manager_ptr` stored in
            // `installer.manager`; `sleep_until` + `tick_raw` hold no
            // `&mut PackageManager` across `Wait::is_done`.
            unsafe { PackageManager::sleep_until(mgr, &mut wait, Wait::is_done) };

            if let Some(err) = wait.err {
                Output::err(err, "failed to install packages", format_args!(""));
                Global::exit(1);
            }
        }
        installer.tasks_in_flight.wait();

        debug_assert!(
            entry_steps
                .iter()
                .all(|step| step.load(Ordering::Relaxed) == Step::Done as u32)
        );

        installer.relink_bins_of_members_with_scripts();
        installer.unlink_left_out_entries();
        installer.warn_left_out_links();
        installer.record_update_request_trust();

        if installer.manager().options.log_level.show_progress() {
            progress.root.end();
            *progress = Progress::default();
        }
        // Defensive: clear the stack-local progress-node pointers so the
        // accessors can't observe dangling pointers after this frame returns.
        installer.manager_mut().scripts_node = None;
        installer.manager_mut().downloads_node = None;

        let mut summary = core::mem::take(&mut installer.summary);
        summary.successfully_installed = Some(core::mem::take(&mut installer.installed));

        return Ok(summary);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

use crate::dependency::VersionTag;
use crate::resolution::Tag as ResolutionTag;
