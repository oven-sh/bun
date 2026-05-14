// ───────────────────────────────────────────────────────────────────────────
// Submodules — Zig basenames preserved per PORTING.md, hence #[path] attrs.
// These are the install-to-disk primitives the Installer state machine drives.
// ───────────────────────────────────────────────────────────────────────────
#[path = "isolated_install/FileCloner.rs"]
pub mod file_cloner;
#[path = "isolated_install/FileCopier.rs"]
pub mod file_copier;
#[path = "isolated_install/Hardlinker.rs"]
pub mod hardlinker;
#[path = "isolated_install/Installer.rs"]
pub mod installer;
#[path = "isolated_install/Store.rs"]
pub mod store;
#[path = "isolated_install/Symlinker.rs"]
pub mod symlinker;

pub use file_copier::FileCopier;
pub use store::Store;
/// Alias so `crate::isolated_install::store::EntryId` (used by
/// `TaskCallbackContext` in lib.rs) resolves to the real `entry::Id` newtype.
pub use store::entry::Id as EntryId;

use crate::lockfile::package::PackageColumns as _;
use std::hash::Hasher as _;
use std::io::Write as _;
use std::sync::atomic::Ordering;

use bstr::BStr;
use bun_alloc::AllocError;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_collections::{
    ArrayHashMap, DynamicBitSet, DynamicBitSetList, DynamicBitSetUnmanaged, HashMap, LinearFifo,
    StringArrayHashMap,
};
use bun_core::{Environment, Global, Output, fast_random, fmt as bun_fmt};
use bun_paths::path_options::AssumeOk as _;
use bun_paths::{self as paths, AutoAbsPath as AbsPath, AutoRelPath, PathBuffer};
use bun_semver as semver;
use bun_sys::{self as sys, Fd};
use bun_wyhash::{Wyhash, Wyhash11};

use crate::analytics;
use crate::bun_bunfig::Arguments as Command;
use crate::bun_progress::{Node as ProgressNode, Progress};
use crate::lockfile::tree::is_filtered_dependency_or_workspace;
use crate::lockfile::{self, Lockfile};
use crate::package_manager::{self, PackageManager, WorkspaceFilter, run_tasks};
use crate::package_manager_real::ProgressStrings;
use crate::package_manager_task as Task;
use crate::{
    self as install, DependencyID, PackageID, PackageInstall, PackageNameHash, Resolution,
    invalid_dependency_id, invalid_package_id,
};
use store::{Entry as StoreEntry, EntryColumns as _, Node as StoreNode, NodeColumns as _};

bun_output::define_scoped_log!(log, IsolatedInstall, visible);

// ───────────────────────────────────────────────────────────────────────────
// Inner helper types (hoisted from fn body — Rust does not allow local
// struct decls that borrow outer locals via closures the same way; field
// order matches the Zig declarations).
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

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum State {
    Unvisited,
    InProgress,
    Ineligible,
    Done,
}

struct StackFrame {
    id: store::entry::Id,
    dep_idx: u32,
    hasher: Wyhash,
}

#[derive(Clone, Copy)]
struct WorkFrame {
    v: u32,
    child: u32,
}

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

impl<'a> WyhashWriter<'a> {
    // TODO(port): Zig used std.io.GenericWriter; here we impl std::io::Write
    // directly so `write!()` works and never errors.
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

/// `RunTasksCallbacks` impl for the isolated-install loop. Mirrors the Zig
/// anonymous-struct call shape `{ .onExtract = onPackageExtracted, .onResolve = {},
/// .onPackageManifestError = {}, .onPackageDownloadError = onPackageDownloadError,
/// .progress_bar = false, .manifests_only = false }` with `Ctx == *Store.Installer`.
pub struct StoreRunTasksCallbacks<'a>(core::marker::PhantomData<&'a mut ()>);

impl<'a> run_tasks::RunTasksCallbacks for StoreRunTasksCallbacks<'a> {
    type Ctx = store::Installer<'a>;

    const HAS_ON_EXTRACT: bool = true;
    const HAS_ON_PACKAGE_DOWNLOAD_ERROR: bool = true;
    const IS_STORE_INSTALLER: bool = true;

    fn on_extract_store_installer(ctx: &mut Self::Ctx, task_id: Task::Id) {
        ctx.on_package_extracted(task_id);
    }

    fn on_package_download_error_store(
        ctx: &mut Self::Ctx,
        id: Task::Id,
        name: &[u8],
        resolution: &Resolution,
        err: bun_core::Error,
        url: &[u8],
    ) {
        ctx.on_package_download_error(id, name, resolution, err, url);
    }

    fn as_store_installer<'x>(ctx: &'x mut Self::Ctx) -> &'x mut store::Installer<'x> {
        // SAFETY: identity cast — narrows the invariant `'a` param to the
        // borrow-local `'x` (`'a: 'x` is implied by `&'x mut Installer<'a>`).
        // The returned reference cannot outlive `'x`, so all inner `'a`
        // borrows remain valid. Inner-lifetime variance cast via raw pointer.
        unsafe { &mut *core::ptr::from_mut(ctx).cast::<store::Installer<'x>>() }
    }
}

struct Wait<'a, 'b> {
    installer: &'a mut store::Installer<'b>,
    err: Option<bun_core::Error>,
}

impl<'a, 'b> Wait<'a, 'b> {
    pub fn is_done(&mut self) -> bool {
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

/// Runs on main thread
pub fn install_isolated_packages(
    manager: &mut PackageManager,
    command_ctx: Command::Context,
    install_root_dependencies: bool,
    workspace_filters: &[WorkspaceFilter],
    packages_to_install: Option<&[PackageID]>,
) -> Result<crate::package_install::Summary, AllocError> {
    analytics::features::isolated_bun_install.fetch_add(1, Ordering::Relaxed);

    // PORT NOTE: reshaped for borrowck — Zig holds `*Lockfile` while also
    // passing `*PackageManager` (which owns it); take a raw pointer so column
    // borrows below don't tie up `&mut manager`.
    let lockfile: *mut Lockfile = &raw mut *manager.lockfile;
    let lockfile: &mut Lockfile = unsafe { &mut *lockfile };

    let store: Store = 'store: {
        let mut timer = std::time::Instant::now();
        // TODO(port): std.time.Timer.start() catch unreachable → Instant::now()
        let pkgs = lockfile.packages.slice();
        let pkg_dependency_slices = pkgs.items_dependencies();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_names = pkgs.items_name();

        let resolutions = &lockfile.buffers.resolutions[..];
        let dependencies = &lockfile.buffers.dependencies[..];
        let string_buf = &lockfile.buffers.string_bytes[..];

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

        let mut leaking_peers: DynamicBitSetList =
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
            let mut own_peers: DynamicBitSetList =
                DynamicBitSetList::init_empty(lockfile.packages.len(), peer_name_count as usize)?;
            let mut provides: DynamicBitSetList =
                DynamicBitSetList::init_empty(lockfile.packages.len(), peer_name_count as usize)?;
            for pkg_idx in 0..lockfile.packages.len() {
                let pkg_id: PackageID = u32::try_from(pkg_idx).expect("int cast");
                let deps = pkg_dependency_slices[pkg_id as usize];
                for _dep_id in deps.begin()..deps.end() {
                    let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                    let dep = &dependencies[dep_id as usize];
                    let Some(bit) = peer_name_idx.get_index(&dep.name_hash) else {
                        continue;
                    };
                    if dep.behavior.is_peer() {
                        own_peers.set(pkg_id as usize, bit);
                    } else if !is_filtered_dependency_or_workspace(
                        dep_id,
                        pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                        resolutions,
                    ) {
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

                    for _dep_id in deps.begin()..deps.end() {
                        let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
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
        for _dep_idx in pkg_dependency_slices[0].begin()..pkg_dependency_slices[0].end() {
            let dep_idx: DependencyID = u32::try_from(_dep_idx).expect("int cast");
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

        let mut peer_dep_ids: Vec<DependencyID> = Vec::new();

        let mut visited_parent_node_ids: Vec<store::node::Id> = Vec::new();

        // First pass: create full dependency tree with resolved peers
        'next_node: while let Some(entry) = node_queue.pop() {
            'check_cycle: {
                // check for cycles
                let mut nodes_slice = nodes.slice();
                // PORT NOTE: Zig grabbed multiple mutable column views from one
                // Slice; `split_mut()` yields disjoint `&mut [_]` per column.
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
                        // skip the new node, and add the previously added node to parent so it appears in
                        // 'node_modules/.bun/parent@version/node_modules'.

                        let dep_id = node_dep_ids[curr_id.get() as usize];
                        if dep_id == invalid_dependency_id && entry.dep_id == invalid_dependency_id
                        {
                            node_nodes[entry.parent_id.get() as usize].push(curr_id);
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
                            continue 'next_node;
                        }

                        if dep_id == invalid_dependency_id || entry.dep_id == invalid_dependency_id
                        {
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
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
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
                    // PORT NOTE: disjoint-column views via `split_mut`.
                    let store::node::NodeColumnsMut {
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
                                            for ids in &node_dependencies[curr_id.get() as usize] {
                                                if dependencies[ids.dep_id as usize].name_hash
                                                    == peer_name_hash
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
                                    // Auto-install fallback is declarer-specific; let the
                                    // second pass handle this position rather than risk an
                                    // unsound key.
                                    if resolved == invalid_package_id {
                                        break 'dont_dedupe;
                                    }
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
                            if dedupe_dep.behavior.is_workspace()
                                != entry_dep.behavior.is_workspace()
                            {
                                break 'dont_dedupe;
                            }
                        }

                        // The skipped subtree would have walked up through this
                        // ancestor chain marking each node with its leaking peers.
                        // DFS guarantees `dedupe_node`'s subtree is fully processed,
                        // so its `peers` is exactly that set; propagate it here.
                        let set_ctx = store::node::TransitivePeerOrderedArraySetCtx {
                            string_buf,
                            pkg_names,
                        };
                        // PORT NOTE: reshaped for borrowck — clone the dedupe peers slice
                        // before mutating node_peers.
                        let dedupe_peers: Vec<_> = node_peers[dedupe_node_id.get() as usize]
                            .list
                            .iter()
                            .copied()
                            .collect();
                        for peer in dedupe_peers {
                            let peer_name_hash = dependencies[peer.dep_id as usize].name_hash;
                            let mut curr_id = entry.parent_id;
                            'walk: while curr_id != store::node::Id::INVALID {
                                for ids in &node_dependencies[curr_id.get() as usize] {
                                    if dependencies[ids.dep_id as usize].name_hash == peer_name_hash
                                    {
                                        break 'walk;
                                    }
                                }
                                node_peers[curr_id.get() as usize].insert(peer, &set_ctx)?;
                                curr_id = node_parent_ids[curr_id.get() as usize];
                            }
                        }

                        node_nodes[entry.parent_id.get() as usize].push(dedupe_node_id);
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
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
            // PORT NOTE: disjoint-column views via `split_mut`.
            let store::node::NodeColumnsMut {
                parent_id: node_parent_ids,
                dependencies: node_dependencies,
                peers: node_peers,
                nodes: node_nodes,
                ..
            } = nodes_slice.split_mut();

            if let Some(parent_id) = entry.parent_id.try_get() {
                node_nodes[parent_id as usize].push(node_id);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
            }

            if skip_dependencies {
                continue;
            }

            let queue_mark = node_queue.len();

            dep_ids_sort_buf.clear();
            dep_ids_sort_buf.reserve(pkg_deps.len as usize);
            for _dep_id in pkg_deps.begin()..pkg_deps.end() {
                let dep_id: DependencyID = u32::try_from(_dep_id).expect("int cast");
                dep_ids_sort_buf.push(dep_id);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
            }

            // TODO: make this sort in an order that allows peers to be resolved last
            // and devDependency handling to match `hoistDependency`
            // TODO(port): std.sort.pdq → slice::sort_by with DepSorter
            {
                let sorter = lockfile::DepSorter { lockfile };
                dep_ids_sort_buf.sort_by(|a, b| {
                    if sorter.is_less_than(*a, *b) {
                        core::cmp::Ordering::Less
                    } else if sorter.is_less_than(*b, *a) {
                        core::cmp::Ordering::Greater
                    } else {
                        core::cmp::Ordering::Equal
                    }
                });
            }

            peer_dep_ids.clear();

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
                                    // PERF(port): was appendAssumeCapacity — profile in Phase B
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
                    if is_filtered_dependency_or_workspace(
                        dep_id,
                        entry.pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                        resolutions,
                    ) {
                        continue;
                    }

                    let pkg_id = resolutions[dep_id as usize];
                    let dep = &dependencies[dep_id as usize];

                    // TODO: handle duplicate dependencies. should be similar logic
                    // like we have for dev dependencies in `hoistDependency`

                    if !dep.behavior.is_peer() {
                        // simple case:
                        // - add it as a dependency
                        // - queue it
                        node_dependencies[node_id.get() as usize]
                            .push(store::node::DependencyIds { dep_id, pkg_id });
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
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

                    // TODO: double check this
                    // Start with the current package. A package
                    // can satisfy it's own peers.
                    let mut curr_id = node_id;

                    visited_parent_node_ids.clear();
                    while curr_id != store::node::Id::INVALID {
                        for ids in &node_dependencies[curr_id.get() as usize] {
                            let dep = &dependencies[ids.dep_id as usize];

                            if dep.name_hash != peer_dep.name_hash {
                                continue;
                            }

                            let res = &pkg_resolutions[ids.pkg_id as usize];

                            if peer_dep.version.tag != VersionTag::Npm
                                || res.tag != ResolutionTag::Npm
                            {
                                // TODO: print warning for this? we don't have a version
                                // to compare to say if this satisfies or not.
                                break 'resolved_pkg_id (ids.pkg_id, false);
                            }

                            // SAFETY: tag was checked == .Npm directly above for both
                            // `peer_dep.version` and `res`.
                            let peer_dep_version = &peer_dep.version.npm().version;
                            let res_version = &res.npm().version;

                            if !peer_dep_version.satisfies(*res_version, string_buf, string_buf) {
                                // TODO: add warning!
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

                                // TODO: add warning if not satisfies()!
                                break 'resolved_pkg_id (ids.pkg_id, false);
                            }

                            // It didn't find a matching name and auto installed
                            // from somewhere this peer can't reach. Choose best
                            // version. Only mark all parents if resolution is
                            // different from this transitive peer.

                            let best_version = resolutions[peer_dep_id as usize];

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
                    break 'resolved_pkg_id (resolutions[peer_dep_id as usize], true);
                };

                if resolved_pkg_id == invalid_package_id {
                    // these are optional peers that failed to find any dependency with a matching
                    // name. they are completely excluded
                    continue;
                }

                for &visited_parent_id in &visited_parent_node_ids {
                    let ctx = store::node::TransitivePeerOrderedArraySetCtx {
                        string_buf,
                        pkg_names,
                    };
                    let peer = store::node::TransitivePeer {
                        dep_id: peer_dep_id,
                        pkg_id: resolved_pkg_id,
                        auto_installed,
                    };
                    node_peers[visited_parent_id.get() as usize].insert(peer, &ctx)?;
                }

                if !visited_parent_node_ids.is_empty() {
                    // visited parents length == 0 means the node satisfied it's own
                    // peer. don't queue.
                    node_dependencies[node_id.get() as usize].push(store::node::DependencyIds {
                        dep_id: peer_dep_id,
                        pkg_id: resolved_pkg_id,
                    });
                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    node_queue.push(QueuedNode {
                        parent_id: node_id,
                        dep_id: peer_dep_id,
                        pkg_id: resolved_pkg_id,
                    });
                }
            }

            // node_queue is a stack: reverse children so the first one pushed is the
            // first popped, matching BFS sibling order.
            node_queue[queue_mark..].reverse();
        }

        if manager.options.log_level.is_verbose() {
            let full_tree_end = timer.elapsed();
            timer = std::time::Instant::now();
            Output::pretty_errorln(format_args!(
                "Resolved peers [{}]",
                bun_fmt::fmt_duration_one_decimal(full_tree_end.as_nanos() as u64)
            ));
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
                    if info.dep_id == invalid_dependency_id || curr_dep_id == invalid_dependency_id
                    {
                        if info.dep_id != curr_dep_id {
                            continue;
                        }
                    }
                    if info.dep_id != invalid_dependency_id && curr_dep_id != invalid_dependency_id
                    {
                        let curr_dep = &dependencies[curr_dep_id as usize];
                        let existing_dep = &dependencies[info.dep_id as usize];

                        if existing_dep.version.tag == VersionTag::Workspace
                            && curr_dep.version.tag == VersionTag::Workspace
                        {
                            if existing_dep.behavior.is_workspace()
                                != curr_dep.behavior.is_workspace()
                            {
                                continue;
                            }
                        }
                    }

                    let eql_ctx = store::node::TransitivePeerOrderedArraySetCtx {
                        string_buf,
                        pkg_names,
                    };

                    if info.peers.eql(curr_peers, &eql_ctx) {
                        // dedupe! depend on the already created entry

                        let mut entries = store_entries.slice();
                        // PORT NOTE: disjoint-column views via `split_mut`.
                        let store::entry::EntryColumnsMut {
                            dependencies: entry_dependencies,
                            parents: entry_parents,
                            ..
                        } = entries.split_mut();

                        let parents = &mut entry_parents[info.entry_id.get() as usize];

                        if curr_dep_id != invalid_dependency_id
                            && dependencies[curr_dep_id as usize].behavior.is_workspace()
                        {
                            parents.push(entry.entry_parent_id);
                            continue 'next_entry;
                        }
                        let ctx = store::entry::DependenciesOrderedArraySetCtx {
                            string_buf,
                            dependencies,
                        };
                        entry_dependencies[entry.entry_parent_id.get() as usize].insert(
                            store::entry::DependenciesItem {
                                entry_id: info.entry_id,
                                dep_id: curr_dep_id,
                            },
                            &ctx,
                        )?;
                        parents.push(entry.entry_parent_id);
                        continue 'next_entry;
                    }
                }

                // nothing matched - create a new entry
            }

            let new_entry_peer_hash: store::entry::PeerHash = 'peer_hash: {
                let peers = &node_peers[entry.node_id.get() as usize];
                if peers.len() == 0 {
                    break 'peer_hash store::entry::PeerHash::NONE;
                }
                let mut hasher = Wyhash11::init(0);
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

            let mut new_entry_parents: Vec<store::entry::Id> = Vec::with_capacity(1);
            new_entry_parents.push(entry.entry_parent_id);
            // PERF(port): was appendAssumeCapacity — profile in Phase B

            let hoisted = 'hoisted: {
                if new_entry_dep_id == invalid_dependency_id {
                    break 'hoisted false;
                }

                let dep_name = dependencies[new_entry_dep_id as usize]
                    .name
                    .slice(string_buf);

                let Some(hoist_pattern) = &manager.options.hoist_pattern else {
                    let hoist_entry = hidden_hoisted.get_or_put(dep_name)?;
                    break 'hoisted !hoist_entry.found_existing;
                };

                if hoist_pattern.is_match(dep_name) {
                    let hoist_entry = hidden_hoisted.get_or_put(dep_name)?;
                    break 'hoisted !hoist_entry.found_existing;
                }

                break 'hoisted false;
            };

            let new_entry = StoreEntry {
                node_id: entry.node_id,
                dependencies: new_entry_dependencies,
                parents: new_entry_parents,
                peer_hash: new_entry_peer_hash,
                hoisted,
                step: core::sync::atomic::AtomicU32::new(0),
                entry_hash: 0,
                scripts: core::cell::Cell::new(None),
            };

            let new_entry_id: store::entry::Id =
                store::entry::Id::from(u32::try_from(store_entries.len()).expect("int cast"));
            store_entries.append(new_entry)?;

            if let Some(entry_parent_id) = entry.entry_parent_id.try_get() {
                'skip_adding_dependency: {
                    if new_entry_dep_id != invalid_dependency_id
                        && dependencies[new_entry_dep_id as usize]
                            .behavior
                            .is_workspace()
                    {
                        // skip implicit workspace dependencies on the root.
                        break 'skip_adding_dependency;
                    }

                    let mut entries = store_entries.slice();
                    let entry_dependencies = entries.items_dependencies_mut();
                    let ctx = store::entry::DependenciesOrderedArraySetCtx {
                        string_buf,
                        dependencies,
                    };
                    entry_dependencies[entry_parent_id as usize].insert(
                        store::entry::DependenciesItem {
                            entry_id: new_entry_id,
                            dep_id: new_entry_dep_id,
                        },
                        &ctx,
                    )?;

                    if new_entry_dep_id != invalid_dependency_id {
                        if entry.entry_parent_id == store::entry::Id::ROOT {
                            // make sure direct dependencies are not replaced
                            let dep_name = dependencies[new_entry_dep_id as usize]
                                .name
                                .slice(string_buf);
                            public_hoisted.put(dep_name, ())?;
                        } else {
                            // transitive dependencies (also direct dependencies of workspaces!)
                            let dep_name = dependencies[new_entry_dep_id as usize]
                                .name
                                .slice(string_buf);
                            if let Some(public_hoist_pattern) =
                                &manager.options.public_hoist_pattern
                            {
                                if public_hoist_pattern.is_match(dep_name) {
                                    let hoist_entry = public_hoisted.get_or_put(dep_name)?;
                                    if !hoist_entry.found_existing {
                                        entry_dependencies[0].insert(
                                            store::entry::DependenciesItem {
                                                entry_id: new_entry_id,
                                                dep_id: new_entry_dep_id,
                                            },
                                            &ctx,
                                        )?;
                                    }
                                }
                            }
                        }
                    }
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

        if manager.options.log_level.is_verbose() {
            let dedupe_end = timer.elapsed();
            Output::pretty_errorln(format_args!(
                "Created store [{}]",
                bun_fmt::fmt_duration_one_decimal(dedupe_end.as_nanos() as u64)
            ));
        }

        break 'store Store {
            entries: store_entries,
            nodes,
        };
    };

    let global_store_path: Option<Vec<u8>> = if manager.options.enable.global_virtual_store() {
        'global_store_path: {
            let mut entries = store.entries.slice();
            // PORT NOTE: disjoint-column views via `split_mut`.
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
            let pkg_name_hashes = pkgs.items_name_hash();
            let pkg_resolutions = pkgs.items_resolution();
            let pkg_metas = pkgs.items_meta();

            let string_buf = &lockfile.buffers.string_bytes[..];
            let dependencies = &lockfile.buffers.dependencies[..];

            // Packages newly trusted via `bun add --trust` (not yet written to the
            // lockfile) will have their lifecycle scripts run this install; treat
            // them the same as lockfile-trusted packages for eligibility.
            let trusted_from_update = manager.find_trusted_dependencies_from_update_requests();

            let mut states = vec![State::Unvisited; store.entries.len()].into_boxed_slice();

            // Iterative DFS so dependency cycles (which the isolated graph permits)
            // can't overflow the stack and are handled deterministically: a back-edge
            // contributes the dependency *name* to the parent's hash but not the
            // child's own hash (still being computed). Two entries that only differ
            // by which side of a cycle they sit on still get distinct hashes via
            // their own store-path bytes.
            let mut stack: Vec<StackFrame> = Vec::new();

            for _root_id in 0..store.entries.len() {
                if states[_root_id] != State::Unvisited {
                    continue;
                }
                stack.push(StackFrame {
                    id: store::entry::Id::from(u32::try_from(_root_id).expect("int cast")),
                    dep_idx: 0,
                    // Placeholder; reinitialized below before first use when state == Unvisited.
                    hasher: Wyhash::init(0),
                });

                while !stack.is_empty() {
                    let top_idx = stack.len() - 1;
                    // PORT NOTE: reshaped for borrowck — re-borrow `top` after each
                    // potential `stack.push()` realloc.
                    let id = stack[top_idx].id;
                    let idx = id.get() as usize;

                    if states[idx] == State::Unvisited {
                        states[idx] = State::InProgress;

                        let node_id = entry_node_ids[idx];
                        let pkg_id = node_pkg_ids[node_id.get() as usize];
                        let dep_id = node_dep_ids[node_id.get() as usize];
                        let pkg_res = &pkg_resolutions[pkg_id as usize];

                        let eligible = match pkg_res.tag {
                            ResolutionTag::Npm
                            | ResolutionTag::Git
                            | ResolutionTag::Github
                            | ResolutionTag::LocalTarball
                            | ResolutionTag::RemoteTarball => 'eligible: {
                                // Patched packages and packages with lifecycle scripts
                                // mutate (or may mutate) their install directory, so a
                                // shared global copy would either diverge from the
                                // patch or be mutated underneath other projects.
                                if lockfile.patched_dependencies.count() > 0 {
                                    let mut name_version_buf = PathBuffer::uninit();
                                    // TODO(port): std.fmt.bufPrint returned the written
                                    // slice; emulate via cursor write into the PathBuffer.
                                    let mut cursor =
                                        std::io::Cursor::new(&mut name_version_buf.0[..]);
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
                                        Err(_) => {
                                            // Overflow is implausible (PathBuffer ≫
                                            // any name+version), but if it ever fired
                                            // the safe answer is "not eligible" rather
                                            // than letting a possibly-patched package
                                            // slip into the shared store.
                                            break 'eligible false;
                                        }
                                    };
                                    if lockfile.patched_dependencies.contains(
                                        &semver::semver_string::Builder::string_hash(name_version),
                                    ) {
                                        break 'eligible false;
                                    }
                                }
                                // `run_preinstall()` authorizes scripts by the
                                // dependency *alias* name, so an aliased install
                                // like `foo: npm:bar@1` is trusted if `foo` is in
                                // trustedDependencies even though the package name
                                // is `bar`. Mirror that here so the alias case
                                // can't slip past the eligibility check.
                                //
                                // Intentionally *not* gated on `do.run_scripts`
                                // (a later install without `--ignore-scripts`
                                // would run the postinstall through the project
                                // symlink and mutate the shared directory) *or*
                                // on `meta.hasInstallScript()` (that flag is not
                                // serialised in `bun.lock`, so it reads `false`
                                // on every install after the first; a trusted
                                // scripted package would flip from project-local
                                // on the cold install to global on the warm one).
                                // Over-excludes the rare "trusted but actually no
                                // scripts" case in exchange for not needing a
                                // lockfile-format change.
                                let (dep_name, dep_name_hash) = if dep_id != invalid_dependency_id {
                                    (
                                        dependencies[dep_id as usize].name.slice(string_buf),
                                        dependencies[dep_id as usize].name_hash,
                                    )
                                } else {
                                    (
                                        pkg_names[pkg_id as usize].slice(string_buf),
                                        pkg_name_hashes[pkg_id as usize],
                                    )
                                };
                                if lockfile.has_trusted_dependency(dep_name, pkg_res)
                                    || trusted_from_update.contains(
                                        &(dep_name_hash as crate::TruncatedPackageNameHash),
                                    )
                                {
                                    break 'eligible false;
                                }
                                break 'eligible true;
                            }
                            _ => false,
                        };

                        if !eligible {
                            states[idx] = State::Ineligible;
                            entry_hashes[idx] = 0;
                            stack.pop();
                            continue;
                        }

                        // Seed the hash with this entry's own store-path string so
                        // entries with identical dep sets but different package
                        // versions never collide. Hashed through a writer so an
                        // unusually long store path (long scope + git URL + peer
                        // hash) can't overflow a fixed buffer and feed
                        // uninitialized stack bytes into the hash.
                        stack[top_idx].hasher = Wyhash::init(0x9E3779B97F4A7C15);
                        {
                            let mut hw = WyhashWriter {
                                hasher: &mut stack[top_idx].hasher,
                            };
                            write!(hw, "{}", store::entry::fmt_store_path(id, &store, lockfile))
                                .expect("unreachable");
                        }
                        // The store path for `.npm` is just `name@version`, which
                        // is *not* unique across registries (an enterprise proxy
                        // can serve a patched `foo@1.0.0`). Fold in the tarball
                        // integrity so a cross-registry / cross-tarball collision
                        // gets a different global directory instead of reusing the
                        // first project's bytes.
                        stack[top_idx]
                            .hasher
                            .update(bun_core::bytes_of(&pkg_metas[pkg_id as usize].integrity));
                    }

                    if states[idx] == State::Ineligible {
                        stack.pop();
                        continue;
                    }

                    let deps = entry_dependencies[idx].slice();
                    let mut advanced = false;
                    while (stack[top_idx].dep_idx as usize) < deps.len() {
                        let dep = &deps[stack[top_idx].dep_idx as usize];
                        let dep_idx = dep.entry_id.get() as usize;
                        let dep_name_hash = dependencies[dep.dep_id as usize].name_hash;
                        match states[dep_idx] {
                            State::Done => {
                                stack[top_idx]
                                    .hasher
                                    .update(bun_core::bytes_of(&dep_name_hash));
                                stack[top_idx]
                                    .hasher
                                    .update(bun_core::bytes_of(&entry_hashes[dep_idx]));
                            }
                            State::Ineligible => {
                                // A dep that can't live in the global store poisons
                                // this entry too: its symlink would point at a
                                // project-local path.
                                states[idx] = State::Ineligible;
                                entry_hashes[idx] = 0;
                            }
                            State::InProgress => {
                                // Cycle back-edge: the dep's hash isn't known yet.
                                // Fold a placeholder; the SCC pass below replaces
                                // every cycle member's hash with one that's
                                // independent of which edge happened to be the
                                // back-edge in this DFS.
                                stack[top_idx]
                                    .hasher
                                    .update(bun_core::bytes_of(&dep_name_hash));
                            }
                            State::Unvisited => {
                                stack.push(StackFrame {
                                    id: dep.entry_id,
                                    dep_idx: 0,
                                    // Placeholder; reinitialized on next iteration before use.
                                    hasher: Wyhash::init(0),
                                });
                                advanced = true;
                                // re-fetch `top` after potential realloc
                                break;
                            }
                        }
                        if states[idx] == State::Ineligible {
                            break;
                        }
                        stack[top_idx].dep_idx += 1;
                    }

                    if advanced {
                        continue;
                    }

                    if states[idx] != State::Ineligible {
                        let mut h = stack[top_idx].hasher.final_();
                        // 0 is the "not eligible" sentinel.
                        if h == 0 {
                            h = 1;
                        }
                        entry_hashes[idx] = h;
                        states[idx] = State::Done;
                    }
                    stack.pop();
                }
            }

            // SCC pass: the DFS hash above is visit-order-dependent for cycle
            // members (which edge becomes the back-edge depends on which member
            // the outer loop reached first, which depends on entry IDs, which
            // depend on the *whole project's* dependency set). That's harmless
            // for correctness — different orderings just give different keys —
            // but it means a package that's part of an npm cycle never shares a
            // global entry across projects, defeating the feature for chunks of
            // the ecosystem (`es-abstract`↔`object.assign`, the babel core
            // cycle, etc.).
            //
            // Tarjan's algorithm groups entries into strongly-connected
            // components. For singleton SCCs the pass-1 hash is already
            // visit-order-independent and is left alone. For multi-member SCCs
            // every member gets the same hash, computed from the sorted member
            // store-paths plus the sorted external-dep hashes — inputs that are
            // identical regardless of which member the project happened to list
            // first. The dep symlinks inside the SCC then point at siblings with
            // the same hash suffix, so they resolve in any project that produces
            // the same SCC closure.
            {
                let n: u32 = u32::try_from(store.entries.len()).expect("int cast");
                let mut tarjan_index = vec![u32::MAX; n as usize].into_boxed_slice();
                let mut lowlink = vec![0u32; n as usize].into_boxed_slice();
                let mut on_stack = vec![false; n as usize].into_boxed_slice();

                let mut scc_stack: Vec<u32> = Vec::new();
                let mut work: Vec<WorkFrame> = Vec::new();
                let mut scc_ext: ArrayHashMap<u64, ()> = ArrayHashMap::default();

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
                            let start = 'blk: {
                                let mut i = scc_stack.len();
                                while i > 0 {
                                    if scc_stack[i - 1] == v {
                                        break 'blk i - 1;
                                    }
                                    i -= 1;
                                }
                                unreachable!();
                            };
                            // PORT NOTE: reshaped for borrowck — copy members to
                            // avoid holding a borrow into scc_stack while mutating.
                            let members: Vec<u32> = scc_stack[start..].to_vec();
                            for &m in &members {
                                on_stack[m as usize] = false;
                            }
                            if members.len() == 1 {
                                // Singleton SCC. Tarjan emits SCCs in reverse
                                // topological order, so every dep's hash is final
                                // by now (including any cycle-member deps that
                                // just got their SCC hash). Recompute this entry's
                                // hash from those final values so a dependent of
                                // a cycle picks up the order-independent SCC hash
                                // rather than the pass-1 placeholder.
                                let m = members[0];
                                if entry_hashes[m as usize] != 0 {
                                    let mut sub = Wyhash::init(0x9E3779B97F4A7C15);
                                    {
                                        let mut hw = WyhashWriter { hasher: &mut sub };
                                        write!(
                                            hw,
                                            "{}",
                                            store::entry::fmt_store_path(
                                                store::entry::Id::from(m),
                                                &store,
                                                lockfile
                                            )
                                        )
                                        .expect("unreachable");
                                    }
                                    sub.update(bun_core::bytes_of(
                                        &pkg_metas[node_pkg_ids
                                            [entry_node_ids[m as usize].get() as usize]
                                            as usize]
                                            .integrity,
                                    ));
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
                                    if poisoned {
                                        entry_hashes[m as usize] = 0;
                                    } else {
                                        let mut h = sub.final_();
                                        if h == 0 {
                                            h = 1;
                                        }
                                        entry_hashes[m as usize] = h;
                                    }
                                }
                            } else if members.len() > 1 {
                                // One order-independent hash for the whole SCC:
                                // collect a sub-hash per member (store path +
                                // integrity), collect every external-dep hash,
                                // sort both lists, then hash the concatenation.
                                // Sorting by *content* (not entry index) is what
                                // makes this stable across projects.
                                scc_ext.clear_retaining_capacity();
                                let mut member_sub: Vec<u64> = Vec::new();
                                let mut any_ineligible = false;
                                for &m in &members {
                                    if entry_hashes[m as usize] == 0 {
                                        any_ineligible = true;
                                    }
                                    let mut sub = Wyhash::init(0);
                                    {
                                        let mut hw = WyhashWriter { hasher: &mut sub };
                                        write!(
                                            hw,
                                            "{}",
                                            store::entry::fmt_store_path(
                                                store::entry::Id::from(m),
                                                &store,
                                                lockfile
                                            )
                                        )
                                        .expect("unreachable");
                                    }
                                    sub.update(bun_core::bytes_of(
                                        &pkg_metas[node_pkg_ids
                                            [entry_node_ids[m as usize].get() as usize]
                                            as usize]
                                            .integrity,
                                    ));
                                    member_sub.push(sub.final_());
                                    for dep in entry_dependencies[m as usize].slice() {
                                        let di = dep.entry_id.get() as usize;
                                        // Skip intra-SCC edges; those are captured
                                        // by member_sub.
                                        if members.contains(&u32::try_from(di).expect("int cast")) {
                                            continue;
                                        }
                                        if entry_hashes[di] == 0 {
                                            any_ineligible = true;
                                        }
                                        // Dep symlinks inside the entry are named
                                        // by the dependency *alias*, so two SCCs
                                        // that reach the same external entry under
                                        // different aliases must hash differently.
                                        let mut ext = Wyhash::init(0);
                                        ext.update(bun_core::bytes_of(
                                            &dependencies[dep.dep_id as usize].name_hash,
                                        ));
                                        ext.update(bun_core::bytes_of(&entry_hashes[di]));
                                        scc_ext.put(ext.final_(), ())?;
                                    }
                                }
                                member_sub.sort_unstable();
                                let ext_keys = scc_ext.keys_mut();
                                ext_keys.sort_unstable();
                                let mut hasher = Wyhash::init(0x42A7C15F9E3779B9);
                                for k in &member_sub {
                                    hasher.update(bun_core::bytes_of(k));
                                }
                                for k in ext_keys.iter() {
                                    hasher.update(bun_core::bytes_of(k));
                                }
                                let mut h = hasher.final_();
                                if h == 0 {
                                    h = 1;
                                }
                                let final_h: u64 = if any_ineligible { 0 } else { h };
                                for &m in &members {
                                    entry_hashes[m as usize] = final_h;
                                }
                            }
                            scc_stack.truncate(start);
                        }
                        work.pop();
                        if !work.is_empty() {
                            let parent_idx = work.len() - 1;
                            let pv = work[parent_idx].v;
                            lowlink[pv as usize] = lowlink[pv as usize].min(lowlink[v as usize]);
                        }
                    }
                }
            }

            // Ineligibility can surface mid-cycle: A→B→A where B turns out to
            // depend on a workspace package. The DFS above already finalised A's
            // hash via the `.in_progress` back-edge before B was marked
            // ineligible, so A would wrongly land in the global store with a
            // dangling dep symlink. Close the gap with a fixed-point pass: any
            // entry that still links to an ineligible dep becomes ineligible too.
            let mut changed = true;
            while changed {
                changed = false;
                for idx in 0..store.entries.len() {
                    if entry_hashes[idx] == 0 {
                        continue;
                    }
                    for dep in entry_dependencies[idx].slice() {
                        if entry_hashes[dep.entry_id.get() as usize] == 0 {
                            entry_hashes[idx] = 0;
                            changed = true;
                            break;
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
            // PORT NOTE: Zig allocated a `[:0]u8` via `joinAbsStringBufZ`; here
            // we own a Vec<u8> with a trailing NUL so it can be re-borrowed as
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
    // (Drop frees global_store_path)

    // setup node_modules/.bun
    let is_new_bun_modules: bool = 'is_new_bun_modules: {
        // Zig: `bun.OSPathLiteral(...)` — but `sys::mkdirat` is `&ZStr`-only
        // (it widens to NT path internally on Windows), so use `path_literal!`
        // here to keep the call-site cross-platform without a `&WStr` overload.
        let node_modules_path = paths::path_literal!("node_modules");
        // Zig: `bun.OSPathLiteral("node_modules/" ++ Store.modules_dir_name)`.
        // Rust `concat!` can't take a `&[u8]` const, so spell the literal —
        // matches `Installer::NODE_MODULES_BUN`.
        let bun_modules_path = paths::path_literal!("node_modules/.bun");

        match sys::mkdirat(Fd::cwd(), node_modules_path, 0o755) {
            Ok(()) => {
                // fallthrough to creating bun_modules below
            }
            Err(_) => {
                match sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755) {
                    Err(_) => break 'is_new_bun_modules false,
                    Ok(()) => {}
                }

                // 'node_modules' exists and 'node_modules/.bun' doesn't

                #[cfg(windows)]
                {
                    // Windows:
                    // 1. create 'node_modules/.old_modules-{hex}'
                    // 2. for each entry in 'node_modules' rename into 'node_modules/.old_modules-{hex}'
                    // 3. for each workspace 'node_modules' rename into 'node_modules/.old_modules-{hex}/old_{basename}_modules'

                    // PORT NOTE: Zig builds a separate `RelPath(.{.unit=.u16})`
                    // for `mkdirat` because Zig's `sys.mkdirat` on Windows takes
                    // `[:0]const u16`. The Rust `sys::mkdirat`/`renameat` take
                    // `&ZStr` (u8) and widen internally, so a single u8
                    // `AutoRelPath` covers both the mkdir and rename targets.
                    let mut rename_path = AutoRelPath::from(b"node_modules").assume_ok();
                    let rand = fast_random();
                    rename_path
                        .append_fmt(format_args!(
                            ".old_modules-{}",
                            bun_fmt::hex_lower(bun_core::bytes_of(&rand))
                        ))
                        .assume_ok();

                    // 1
                    if sys::mkdirat(Fd::cwd(), rename_path.slice_z(), 0o755).is_err() {
                        break 'is_new_bun_modules true;
                    }

                    let Ok(node_modules) = sys::open_dir_for_iteration(Fd::cwd(), b"node_modules")
                    else {
                        break 'is_new_bun_modules true;
                    };
                    // Windows HANDLE-leak audit: `Fd` is `Copy` (no Drop) and the
                    // `WrappedIterator` from `sys::iterate_dir` does not own/close it.
                    // The Zig spec (isolated_install.zig:1299) likewise lacks a
                    // `defer node_modules.close()`, so this leak is pre-existing in
                    // the spec — fixed in both per the audit. The guard fires on
                    // normal fall-through to step 3 and on every
                    // `break 'is_new_bun_modules true` early exit.
                    let _close_node_modules = scopeguard::guard(node_modules, |fd| {
                        use bun_sys::FdExt as _;
                        fd.close();
                    });

                    let mut entry_path = AutoRelPath::from(b"node_modules").assume_ok();

                    // 2
                    let mut node_modules_iter = sys::iterate_dir(node_modules);
                    loop {
                        let Some(entry) = (match node_modules_iter.next() {
                            Ok(v) => v,
                            Err(_) => break 'is_new_bun_modules true,
                        }) else {
                            break;
                        };
                        if bun_core::starts_with_char(entry.name.slice_u8(), b'.') {
                            continue;
                        }

                        // PORT NOTE: reshaped for borrowck — Zig `save()/restore()`
                        // holds `*Path`; capture lengths and truncate manually so
                        // the paths stay unborrowed across the loop body.
                        let entry_path_save = entry_path.len();
                        entry_path.append(entry.name.slice()).assume_ok();

                        let rename_path_save = rename_path.len();
                        rename_path.append(entry.name.slice()).assume_ok();

                        let _ = sys::renameat(
                            Fd::cwd(),
                            entry_path.slice_z(),
                            Fd::cwd(),
                            rename_path.slice_z(),
                        );

                        rename_path.set_length(rename_path_save);
                        entry_path.set_length(entry_path_save);
                    }

                    // 3
                    for workspace_path in lockfile.workspace_paths.values() {
                        let mut workspace_node_modules =
                            AutoRelPath::from(workspace_path.slice(&lockfile.buffers.string_bytes))
                                .assume_ok();

                        // PORT NOTE: reshaped for borrowck — clone basename before
                        // mutating `workspace_node_modules` (Zig held a slice into
                        // the buffer across an append-with-separator).
                        let basename = workspace_node_modules.basename().to_vec();

                        workspace_node_modules.append(b"node_modules").assume_ok();

                        // PORT NOTE: reshaped for borrowck — capture length instead
                        // of `save()` so `rename_path` stays unborrowed.
                        let rename_path_save = rename_path.len();
                        rename_path
                            .append_fmt(format_args!(".old_{}_modules", BStr::new(&basename)))
                            .assume_ok();

                        let _ = sys::renameat(
                            Fd::cwd(),
                            workspace_node_modules.slice_z(),
                            Fd::cwd(),
                            rename_path.slice_z(),
                        );

                        rename_path.set_length(rename_path_save);
                    }
                }
                #[cfg(not(windows))]
                {
                    // Posix:
                    // 1. rename existing 'node_modules' to temp location
                    // 2. create new 'node_modules' directory
                    // 3. rename temp into 'node_modules/.old_modules-{hex}'
                    // 4. attempt renaming 'node_modules/.old_modules-{hex}/.cache' to 'node_modules/.cache'
                    // 5. rename each workspace 'node_modules' into 'node_modules/.old_modules-{hex}/old_{basename}_modules'
                    let mut temp_node_modules_buf = PathBuffer::uninit();
                    let temp_node_modules = paths::fs::FileSystem::tmpname(
                        b"tmp_modules",
                        &mut temp_node_modules_buf.0,
                        fast_random(),
                    )
                    .expect("unreachable");

                    // 1
                    if sys::renameat(
                        Fd::cwd(),
                        bun_core::zstr!("node_modules"),
                        Fd::cwd(),
                        temp_node_modules,
                    )
                    .is_err()
                    {
                        break 'is_new_bun_modules true;
                    }

                    // 2
                    if let Err(err) = sys::mkdirat(Fd::cwd(), node_modules_path, 0o755) {
                        Output::err(err, "failed to create './node_modules'", format_args!(""));
                        Global::exit(1);
                    }

                    if let Err(err) = sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755) {
                        Output::err(
                            err,
                            "failed to create './node_modules/.bun'",
                            format_args!(""),
                        );
                        Global::exit(1);
                    }

                    let mut rename_path = AutoRelPath::from(b"node_modules").assume_ok();

                    let rand = fast_random();
                    rename_path
                        .append_fmt(format_args!(
                            ".old_modules-{}",
                            bun_fmt::hex_lower(bun_core::bytes_of(&rand))
                        ))
                        .assume_ok();

                    // 3
                    if sys::renameat(
                        Fd::cwd(),
                        temp_node_modules,
                        Fd::cwd(),
                        rename_path.slice_z(),
                    )
                    .is_err()
                    {
                        break 'is_new_bun_modules true;
                    }

                    rename_path.append(b".cache").assume_ok();

                    let mut cache_path = AutoRelPath::from(b"node_modules").assume_ok();
                    cache_path.append(b".cache").assume_ok();

                    // 4
                    let _ = sys::renameat(
                        Fd::cwd(),
                        rename_path.slice_z(),
                        Fd::cwd(),
                        cache_path.slice_z(),
                    );

                    // remove .cache so we can append destination for each workspace
                    rename_path.undo(1);

                    // 5
                    for workspace_path in lockfile.workspace_paths.values() {
                        let mut workspace_node_modules =
                            AutoRelPath::from(workspace_path.slice(&lockfile.buffers.string_bytes))
                                .assume_ok();

                        // PORT NOTE: reshaped for borrowck — clone basename before
                        // mutating `workspace_node_modules` (Zig held a slice into
                        // the buffer across an append-with-separator).
                        let basename = workspace_node_modules.basename().to_vec();

                        workspace_node_modules.append(b"node_modules").assume_ok();

                        // PORT NOTE: reshaped for borrowck — Zig `save()/restore()`
                        // holds a `*Path`; capture the length and truncate manually
                        // so `rename_path` stays unborrowed between save/restore.
                        let rename_path_save = rename_path.len();

                        rename_path
                            .append_fmt(format_args!(".old_{}_modules", BStr::new(&basename)))
                            .assume_ok();

                        let _ = sys::renameat(
                            Fd::cwd(),
                            workspace_node_modules.slice_z(),
                            Fd::cwd(),
                            rename_path.slice_z(),
                        );

                        rename_path.set_length(rename_path_save);
                    }
                }

                break 'is_new_bun_modules true;
            }
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

    {
        // TODO(port): Progress.Node locals are conditionally initialized in Zig;
        // model with Option in Phase B.
        let mut download_node: ProgressNode = ProgressNode::default();
        let mut install_node: ProgressNode = ProgressNode::default();
        let mut scripts_node: ProgressNode = ProgressNode::default();
        let progress: *mut Progress = &raw mut manager.progress;
        // SAFETY: `progress` aliases `manager.progress`; reborrows below are
        // disjoint from the other `manager.*` field accesses (Zig holds the
        // same two pointers freely).
        let progress = unsafe { &mut *progress };

        if manager.options.log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            // `Progress::start` returns `&mut Node` (points into `progress.root`);
            // keep it as a safe reborrow — it's only used to spawn the three
            // children below and is dead before the `manager.*` writes that
            // follow (NLL), so no raw-ptr round-trip is needed.
            let root_node = progress.start(b"", 0);
            download_node = root_node.start(ProgressStrings::download(), 0);
            install_node = root_node.start(ProgressStrings::install(), store.entries.len());
            scripts_node = root_node.start(ProgressStrings::script(), 0);

            manager.downloads_node = None;
            manager.scripts_node = Some(core::ptr::NonNull::from(&mut scripts_node));
            manager.downloads_node = Some(&raw mut download_node);
        }

        let nodes_slice = store.nodes.slice();
        let node_pkg_ids = nodes_slice.items_pkg_id();
        let node_dep_ids = nodes_slice.items_dep_id();

        let entries = store.entries.slice();
        let entry_node_ids = entries.items_node_id();
        let entry_steps = entries.items_step();
        let entry_dependencies = entries.items_dependencies();
        let entry_hoisted = entries.items_hoisted();

        // PORT NOTE: reshaped for borrowck — Zig holds `*Lockfile` (mut) while
        // also keeping immutable column slices into it. Reborrow through a
        // `BackRef` so `string_buf` / `pkgs` don't tie up `&mut lockfile` for
        // the `Installer { lockfile, .. }` move below. `BackRef` is the
        // canonical non-owning back-pointer wrapper; the lockfile lives for
        // the full scope and the column buffers sliced here are read-only
        // across the install loop (never mutated through `installer.lockfile`).
        let lockfile_ptr: *mut Lockfile = lockfile;
        let lockfile_ref = bun_ptr::BackRef::<Lockfile>::from(
            core::ptr::NonNull::new(lockfile_ptr).expect("lockfile BACKREF non-null"),
        );
        let lockfile_ro: &Lockfile = lockfile_ref.get();
        let string_buf = &lockfile_ro.buffers.string_bytes[..];

        let pkgs = lockfile_ro.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_name_hashes = pkgs.items_name_hash();
        let pkg_resolutions = pkgs.items_resolution();

        let mut seen_entry_ids: HashMap<store::entry::Id, ()> = HashMap::default();
        seen_entry_ids.reserve(store.entries.len());

        // TODO: delete
        let mut seen_workspace_ids: HashMap<PackageID, ()> = HashMap::default();

        // PORT NOTE: reshaped — Zig does `allocator.alloc(Task, n)` then
        // `task.* = .{..}` in-place, which is safe because Zig has no drop
        // glue and no validity invariants on uninit memory. In Rust,
        // `installer::Task` carries `result: Result` (Drop via `TaskError`
        // payloads) and a non-nullable fn-ptr in `thread_pool::Task`, so
        // `assume_init()` on uninit memory is instant UB and a subsequent
        // `*task = ..` would drop garbage. Instead, fully initialize each
        // slot via `MaybeUninit::write` with a null `installer` back-pointer
        // placeholder, finalize the slice, move it into `Installer`, then
        // patch the back-pointer in a second loop once `installer` exists.
        let tasks: Box<[installer::Task]> = {
            let mut uninit: Box<[core::mem::MaybeUninit<installer::Task>]> =
                Box::new_uninit_slice(store.entries.len());
            for (i, slot) in uninit.iter_mut().enumerate() {
                slot.write(installer::Task {
                    entry_id: store::entry::Id::from(u32::try_from(i).expect("int cast")),
                    // patched below once `installer` has an address — dangling
                    // placeholder is never dereferenced
                    installer: bun_ptr::BackRef::from(core::ptr::NonNull::dangling()),
                    result: installer::Result::None,
                    task: bun_threading::thread_pool::Task {
                        callback: installer::Task::callback,
                        node: Default::default(),
                    },
                    next: bun_threading::Link::new(),
                });
            }
            // SAFETY: every element was written in the loop above.
            unsafe { uninit.assume_init() }
        };

        let show_progress = manager.options.log_level.show_progress();
        let installed = DynamicBitSet::init_empty(lockfile.packages.len())?;
        let trusted_dependencies_from_update_requests =
            manager.find_trusted_dependencies_from_update_requests();
        // Reuse the `NonNull` already stored in `manager.scripts_node` rather
        // than taking a fresh `&mut scripts_node` below — a second `&mut` from
        // the local would pop the stored raw's Stacked Borrows tag, and the
        // run-tasks tick callback dereferences that raw via `scripts_node_mut()`.
        let scripts_node_ptr = manager.scripts_node;
        // `Installer.manager` is a BACKREF raw pointer; copying `manager_ptr`
        // does not move `manager`, so the body keeps using `manager` via the
        // shadow-reborrow below.
        let manager_ptr: *mut PackageManager = manager;
        let mut installer = store::Installer {
            lockfile: lockfile_ptr,
            manager: manager_ptr,
            command_ctx,
            installed,
            install_node: if show_progress {
                Some(&mut install_node)
            } else {
                None
            },
            scripts_node: if show_progress {
                scripts_node_ptr
            } else {
                None
            },
            store: &store,
            tasks,
            trusted_dependencies_mutex: Default::default(),
            trusted_dependencies_from_update_requests,
            supported_backend: std::sync::atomic::AtomicU8::new(
                PackageInstall::supported_method() as u8
            ),
            is_new_bun_modules,
            global_store_path: global_store_path
                .as_deref()
                .map(|b: &[u8]| -> &bun_core::ZStr {
                    // SAFETY: `global_store_path` was built with a trailing NUL above.
                    bun_core::ZStr::from_slice_with_nul(&b[..])
                }),
            global_store_tmp_suffix: fast_random(),
            summary: Default::default(),
            task_queue: Default::default(),
        };
        let manager = unsafe { &mut *manager_ptr };
        // (Drop handles installer.deinit())

        // PORT NOTE: reshaped for borrowck — Zig writes `installer: &installer`
        // into `installer.tasks[i]`; in Rust the back-pointer is taken before
        // the `tasks` borrow. `Task.installer` is typed
        // `BackRef<Installer<'static>>` (raw back-ref, no real `'static` data),
        // so erase the lifetime via a void-pointer cast — `*mut T` is invariant
        // and won't coerce on its own.
        let installer_ptr: *mut store::Installer<'static> =
            (&raw mut installer).cast::<()>().cast();
        let installer_backref =
            bun_ptr::BackRef::from(core::ptr::NonNull::new(installer_ptr).unwrap());
        for task in installer.tasks.iter_mut() {
            task.installer = installer_backref;
        }

        // PORT NOTE: hoisted — Zig lazily calls `globalLinkDirPath()` inside
        // `appendStorePath` (worker threads, via `*const Installer`). Rust
        // can't take `&mut PackageManager` from `&self` there, so ensure the
        // global link dir once on the main thread before any `.symlink`
        // resolution can be reached by a task. Guarded so installs without
        // `link:` deps don't touch the global dir (matches Zig laziness).
        if pkg_resolutions
            .iter()
            .any(|r| r.tag == ResolutionTag::Symlink)
        {
            let _ = crate::package_manager_real::directories::global_link_dir_path(manager);
        }

        // add the pending task count upfront
        manager.increment_pending_tasks(u32::try_from(store.entries.len()).expect("int cast"));
        for _entry_id in 0..store.entries.len() {
            let entry_id = store::entry::Id::from(u32::try_from(_entry_id).expect("int cast"));

            let node_id = entry_node_ids[entry_id.get() as usize];
            let pkg_id = node_pkg_ids[node_id.get() as usize];
            let dep_id = node_dep_ids[node_id.get() as usize];

            let pkg_name = pkg_names[pkg_id as usize];
            let pkg_name_hash = pkg_name_hashes[pkg_id as usize];
            let pkg_res: Resolution = pkg_resolutions[pkg_id as usize];

            match pkg_res.tag {
                ResolutionTag::Root => {
                    if dep_id == invalid_dependency_id {
                        // .monotonic is okay in this block because the task isn't running on another
                        // thread.
                        entry_steps[entry_id.get() as usize].store(
                            installer::Step::SymlinkDependencies as u32,
                            Ordering::Relaxed,
                        );
                    } else {
                        // dep_id is valid meaning this was a dependency that resolved to the root
                        // package. it gets an entry in the store.
                    }
                    installer.start_task(entry_id);
                    continue;
                }
                ResolutionTag::Workspace => {
                    // .monotonic is okay in this block because the task isn't running on another
                    // thread.

                    // if injected=true this might be false
                    if !seen_workspace_ids.get_or_put(pkg_id)?.found_existing {
                        entry_steps[entry_id.get() as usize].store(
                            installer::Step::SymlinkDependencies as u32,
                            Ordering::Relaxed,
                        );
                        installer.start_task(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get() as usize]
                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, installer::CompleteState::Skipped);
                    continue;
                }
                ResolutionTag::Symlink => {
                    // no installation required, will only need to be linked to packages that depend on it.
                    debug_assert!(entry_dependencies[entry_id.get() as usize].list.is_empty());
                    // .monotonic is okay because the task isn't running on another thread.
                    entry_steps[entry_id.get() as usize]
                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, installer::CompleteState::Skipped);
                    continue;
                }
                ResolutionTag::Folder => {
                    // folders are always hardlinked to keep them up-to-date
                    installer.start_task(entry_id);
                    continue;
                }

                ResolutionTag::Npm
                | ResolutionTag::Git
                | ResolutionTag::Github
                | ResolutionTag::LocalTarball
                | ResolutionTag::RemoteTarball => {
                    // PORT NOTE: Zig used `inline ... => |pkg_res_tag|` to monomorphize the
                    // body per-tag. Rust collapses to a single arm with a runtime
                    // `pkg_res.tag` re-match where the body branches. // PERF(port): was
                    // comptime monomorphization — profile in Phase B.
                    let pkg_res_tag = pkg_res.tag;

                    let patch_info =
                        installer.package_patch_info(pkg_name, pkg_name_hash, &pkg_res)?;

                    let uses_global_store = installer.entry_uses_global_store(entry_id);

                    // An entry that lost global-store eligibility since the
                    // previous install (newly patched, newly trusted, a dep
                    // that became a workspace package) still has a stale
                    // `node_modules/.bun/<storepath>` symlink/junction into
                    // `<cache>/links/`. The existence check below would pass
                    // *through* it and skip the task, leaving the project to
                    // run against the shared entry (and, if the task did run,
                    // write the new project-local tree through the link into
                    // the shared cache). Treat the stale link as
                    // needs-install so `link_package` detaches and rebuilds.
                    let has_stale_gvs_link = !uses_global_store
                        && 'stale: {
                            if installer.global_store_path.is_none() {
                                break 'stale false;
                            }
                            let mut local: paths::AutoAbsPath =
                                paths::AutoAbsPath::init_top_level_dir();
                            installer.append_local_store_entry_path(&mut local, entry_id);
                            #[cfg(windows)]
                            {
                                break 'stale if let Some(a) =
                                    sys::get_file_attributes(local.slice_z())
                                {
                                    a.is_reparse_point
                                } else {
                                    false
                                };
                            }
                            #[cfg(not(windows))]
                            {
                                break 'stale if let Ok(st) = sys::lstat(local.slice_z()) {
                                    sys::posix::s_islnk(
                                        u32::try_from(st.st_mode).expect("int cast"),
                                    )
                                } else {
                                    false
                                };
                            }
                        };

                    let needs_install = manager.options.enable.force_install()
                        // A freshly-created `node_modules/.bun` only implies the
                        // *project-local* entries are missing; global virtual-
                        // store entries persist across `rm -rf node_modules` and
                        // should still take the cheap symlink-only path.
                        || (is_new_bun_modules && !uses_global_store)
                        || has_stale_gvs_link
                        || matches!(patch_info, installer::PatchInfo::Remove(_))
                        || 'needs_install: {
                            let mut store_path: AbsPath = AbsPath::init_top_level_dir();
                            if uses_global_store {
                                // Global entries are built under a per-process
                                // staging path and renamed into place as the
                                // final step, so the directory existing at its
                                // final path is the completeness signal.
                                installer.append_global_store_entry_path(&mut store_path, entry_id, installer::Which::Final);
                                break 'needs_install !sys::directory_exists_at(Fd::cwd(), store_path.slice_z())
                                    .ok()
                                    .unwrap_or(false);
                            }
                            installer.append_real_store_path(&mut store_path, entry_id, installer::Which::Final);
                            // PORT NOTE: reshaped for borrowck — Zig `save()` returns a
                            // `ResetScope` holding `*Path`; capture the length instead so
                            // `store_path` stays unborrowed.
                            let scope_for_patch_tag_path = store_path.len();
                            if pkg_res_tag == ResolutionTag::Npm {
                                // if it's from npm, it should always have a package.json.
                                // in other cases, probably yes but i'm less confident.
                                store_path.append(b"package.json").assume_ok();
                            }
                            let exists = sys::exists_z(store_path.slice_z());

                            break 'needs_install match &patch_info {
                                installer::PatchInfo::None => !exists,
                                // checked above
                                installer::PatchInfo::Remove(_) => unreachable!(),
                                installer::PatchInfo::Patch(patch) => {
                                    let mut hash_buf: install::BuntagHashBuf = Default::default();
                                    let hash = install::buntaghashbuf_make(&mut hash_buf, patch.contents_hash);
                                    store_path.set_length(scope_for_patch_tag_path);
                                    store_path.append(&*hash).assume_ok();
                                    !sys::exists_z(store_path.slice_z())
                                }
                            };
                        };

                    if !needs_install {
                        if uses_global_store {
                            // Warm hit: the global virtual store already holds
                            // this entry's files, dep symlinks, and bin links.
                            // The only per-install work is the project-level
                            // `node_modules/.bun/<storepath>` → global symlink.
                            match installer.link_project_to_global_store(entry_id) {
                                bun_sys::Result::Ok(()) => {}
                                bun_sys::Result::Err(err) => {
                                    entry_steps[entry_id.get() as usize]
                                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                                    installer.on_task_fail(
                                        entry_id,
                                        installer::TaskError::SymlinkDependencies(err),
                                    );
                                    continue;
                                }
                            }
                        }
                        if entry_hoisted[entry_id.get() as usize] {
                            installer.link_to_hidden_node_modules(entry_id);
                        }
                        // .monotonic is okay because the task isn't running on another thread.
                        entry_steps[entry_id.get() as usize]
                            .store(installer::Step::Done as u32, Ordering::Relaxed);
                        installer.on_task_complete(entry_id, installer::CompleteState::Skipped);
                        continue;
                    }

                    // SAFETY: each arm reads the union field that `pkg_res_tag`
                    // (== `pkg_res.tag`) names as active.
                    let cache_subpath_z: &bun_core::ZStr = match pkg_res_tag {
                        ResolutionTag::Npm => package_manager::cached_npm_package_folder_name(
                            manager,
                            pkg_name.slice(string_buf),
                            pkg_res.npm().version,
                            patch_info.contents_hash(),
                        ),
                        ResolutionTag::Git => package_manager::cached_git_folder_name(
                            manager,
                            pkg_res.git(),
                            patch_info.contents_hash(),
                        ),
                        ResolutionTag::Github => package_manager::cached_github_folder_name(
                            manager,
                            pkg_res.github(),
                            patch_info.contents_hash(),
                        ),
                        ResolutionTag::LocalTarball => package_manager::cached_tarball_folder_name(
                            manager,
                            *pkg_res.local_tarball(),
                            patch_info.contents_hash(),
                        ),
                        ResolutionTag::RemoteTarball => {
                            package_manager::cached_tarball_folder_name(
                                manager,
                                *pkg_res.remote_tarball(),
                                patch_info.contents_hash(),
                            )
                        }

                        _ => unreachable!(),
                    };
                    let mut pkg_cache_dir_subpath: AutoRelPath =
                        AutoRelPath::from(cache_subpath_z.as_bytes()).assume_ok();

                    let (cache_dir, cache_dir_path) = manager.get_cache_directory_and_abs_path();
                    let _ = &cache_dir_path; // dropped at scope exit (Zig: defer cache_dir_path.deinit())

                    let missing_from_cache = match manager.get_preinstall_state(pkg_id) {
                        install::PreinstallState::Done => false,
                        _ => 'missing_from_cache: {
                            if matches!(patch_info, installer::PatchInfo::None) {
                                let exists = match pkg_res_tag {
                                    ResolutionTag::Npm => {
                                        // PORT NOTE: reshaped for borrowck — capture length
                                        // instead of `save()` so the path stays unborrowed.
                                        let cache_dir_path_save = pkg_cache_dir_subpath.len();
                                        pkg_cache_dir_subpath.append(b"package.json").assume_ok();
                                        let exists = sys::exists_at(
                                            cache_dir,
                                            pkg_cache_dir_subpath.slice_z(),
                                        );
                                        pkg_cache_dir_subpath.set_length(cache_dir_path_save);
                                        exists
                                    }
                                    _ => sys::directory_exists_at(
                                        cache_dir,
                                        pkg_cache_dir_subpath.slice_z(),
                                    )
                                    .unwrap_or(false),
                                };
                                if exists {
                                    manager.set_preinstall_state(
                                        pkg_id,
                                        install::PreinstallState::Done,
                                    );
                                }
                                break 'missing_from_cache !exists;
                            }

                            // TODO: why does this look like it will never work?
                            break 'missing_from_cache true;
                        }
                    };

                    if !missing_from_cache {
                        if let installer::PatchInfo::Patch(patch) = &patch_info {
                            let mut patch_log = bun_ast::Log::init();
                            installer.apply_package_patch(entry_id, patch, &mut patch_log);
                            if patch_log.has_errors() {
                                // monotonic is okay because we haven't started the task yet (it isn't running
                                // on another thread)
                                entry_steps[entry_id.get() as usize]
                                    .store(installer::Step::Done as u32, Ordering::Relaxed);
                                installer.on_task_fail(
                                    entry_id,
                                    installer::TaskError::Patching(patch_log),
                                );
                                continue;
                            }
                        }
                        installer.start_task(entry_id);
                        continue;
                    }

                    let ctx = install::TaskCallbackContext::IsolatedPackageInstallContext(entry_id);

                    let dep = &lockfile_ro.buffers.dependencies[dep_id as usize];

                    match pkg_res_tag {
                        ResolutionTag::Npm => {
                            match manager.enqueue_package_for_download(
                                pkg_name.slice(string_buf),
                                dep_id,
                                pkg_id,
                                pkg_res.npm().version,
                                pkg_res.npm().url.slice(string_buf),
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => {
                                    return Err(AllocError);
                                }
                                Err(err) => {
                                    // error.InvalidURL
                                    Output::err(
                                        err,
                                        "failed to enqueue package for download: {}@{}",
                                        (
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early() {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get() as usize]
                                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                                    installer
                                        .on_task_complete(entry_id, installer::CompleteState::Fail);
                                    continue;
                                }
                            }
                        }
                        ResolutionTag::Git => {
                            manager.enqueue_git_for_checkout(
                                dep_id,
                                dep.name.slice(string_buf),
                                &pkg_res,
                                ctx,
                                patch_info.name_and_version_hash(),
                            );
                        }
                        ResolutionTag::Github => {
                            // Zig (isolated_install.zig:1759) reads `pkg_res.value.git` here as
                            // a raw union pun (`git`/`github` arms share `Repository` layout);
                            // Rust's `.git()` accessor adds a `debug_assert_eq!(tag, Git)` that
                            // fires under `Github`, so use the tag-correct `.github()` instead.
                            let url = manager.alloc_github_url(pkg_res.github());
                            // (Drop frees url)
                            match manager.enqueue_tarball_for_download(
                                dep_id,
                                pkg_id,
                                &url,
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => {
                                    bun_core::out_of_memory()
                                }
                                Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to enqueue github package for download: {}@{}",
                                        (
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early() {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get() as usize]
                                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                                    installer
                                        .on_task_complete(entry_id, installer::CompleteState::Fail);
                                    continue;
                                }
                            }
                        }
                        ResolutionTag::LocalTarball => {
                            manager.enqueue_tarball_for_reading(
                                dep_id,
                                pkg_id,
                                dep.name.slice(string_buf),
                                &pkg_res,
                                ctx,
                            );
                        }
                        ResolutionTag::RemoteTarball => {
                            match manager.enqueue_tarball_for_download(
                                dep_id,
                                pkg_id,
                                pkg_res.remote_tarball().slice(string_buf),
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => {
                                    bun_core::out_of_memory()
                                }
                                Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to enqueue tarball for download: {}@{}",
                                        (
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, bun_fmt::PathSep::Auto),
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early() {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get() as usize]
                                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                                    installer
                                        .on_task_complete(entry_id, installer::CompleteState::Fail);
                                    continue;
                                }
                            }
                        }
                        _ => unreachable!(),
                    }
                }

                _ => {
                    // this is `uninitialized` or `single_file_module`.
                    debug_assert!(false);
                    // .monotonic is okay because the task isn't running on another thread.
                    entry_steps[entry_id.get() as usize]
                        .store(installer::Step::Done as u32, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, installer::CompleteState::Skipped);
                    continue;
                }
            }
        }

        if manager.pending_task_count() > 0 {
            let mgr: *mut PackageManager = manager;
            let mut wait = Wait {
                installer: &mut installer,
                err: None,
            };
            // SAFETY: `mgr` derived from the live exclusive `manager` borrow;
            // `sleep_until` + `tick_raw` hold no `&mut PackageManager` across
            // `Wait::is_done`.
            unsafe { PackageManager::sleep_until(mgr, &mut wait, Wait::is_done) };

            if let Some(err) = wait.err {
                Output::err(err, "failed to install packages", format_args!(""));
                Global::exit(1);
            }
        }

        if manager.options.log_level.show_progress() {
            progress.root.end();
            *progress = Progress::default();
        }
        // Defensive: clear the stack-local progress-node pointers so the
        // accessors can't observe dangling pointers after this frame returns.
        manager.scripts_node = None;
        manager.downloads_node = None;

        if Environment::CI_ASSERT {
            let mut done = true;
            'next_entry: for (_entry_id, entry_step) in
                store.entries.items_step().iter().enumerate()
            {
                let entry_id = store::entry::Id::from(u32::try_from(_entry_id).expect("int cast"));
                // .monotonic is okay because `Wait.isDone` should have already synchronized with
                // the completed task threads, via popping from the `UnboundedQueue` in `runTasks`,
                // and the .acquire load `pendingTaskCount`.
                let step = entry_step.load(Ordering::Relaxed);

                if step == installer::Step::Done as u32 {
                    continue;
                }

                done = false;

                log!(
                    "entry not done: {}, {}\n",
                    entry_id.get(),
                    <&'static str>::from(installer::Step::from_u32(step))
                );

                let deps = &store.entries.items_dependencies()[entry_id.get() as usize];
                for dep in deps.slice() {
                    // .monotonic is okay because `Wait.isDone` already synchronized with the tasks.
                    let dep_step = entry_steps[dep.entry_id.get() as usize].load(Ordering::Relaxed);
                    if dep_step != installer::Step::Done as u32 {
                        log!(", parents:\n - ");
                        let parent_ids =
                            store::entry::debug_gather_all_parents(entry_id, installer.store);
                        for &parent_id in &parent_ids {
                            if parent_id == store::entry::Id::ROOT {
                                log!("root ");
                            } else {
                                log!("{} ", parent_id.get());
                            }
                        }

                        log!("\n");
                        continue 'next_entry;
                    }
                }

                log!(" and is able to run\n");
            }

            debug_assert!(done);
        }

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

// ported from: src/install/isolated_install.zig
