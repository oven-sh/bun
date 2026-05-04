use std::hash::Hasher as _;
use std::io::Write as _;
use std::sync::atomic::Ordering;

use bun_core::{analytics, fast_random, fmt as bun_fmt, Environment, Global, Output, Progress};
use bun_core::cli::Command;
use bun_collections::{ArrayHashMap, DynamicBitSet, DynamicBitSetList, HashMap, LinearFifo, StringArrayHashMap};
use bun_alloc::AllocError;
use bun_paths::{self as paths, AbsPath, AutoRelPath, PathBuffer, RelPath};
use bun_sys::{self as sys, Fd};
use bun_wyhash::{Wyhash, Wyhash11};
use bun_semver as semver;
use bun_logger as logger;
use bstr::BStr;

use crate::{
    self as install, DependencyID, PackageID, PackageInstall, PackageNameHash, Resolution, Store,
    invalid_dependency_id, invalid_package_id,
};
use crate::lockfile::{Lockfile, Tree};
use crate::package_manager::{PackageManager, ProgressStrings, WorkspaceFilter};
use crate::store::{self, Entry as StoreEntry, Node as StoreNode};

bun_output::declare_scope!(IsolatedInstall, visible);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(IsolatedInstall, $($arg)*) };
}

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
    peers: store::OrderedArraySet<store::node::TransitivePeer, store::node::transitive_peer::OrderedArraySetCtx>,
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

struct Wait<'a> {
    installer: &'a mut store::Installer,
    err: Option<bun_core::Error>,
}

impl<'a> Wait<'a> {
    pub fn is_done(&mut self) -> bool {
        let pkg_manager = self.installer.manager;
        if let Err(err) = pkg_manager.run_tasks(
            self.installer,
            // TODO(port): Zig passed an anon struct of callbacks; model as a
            // RunTasksCallbacks struct in Phase B.
            store::installer::RunTasksCallbacks {
                on_extract: store::Installer::on_package_extracted,
                on_resolve: (),
                on_package_manifest_error: (),
                on_package_download_error: store::Installer::on_package_download_error,
            },
            true,
            pkg_manager.options.log_level,
        ) {
            self.err = Some(err);
            return true;
        }

        if let Some(node) = pkg_manager.scripts_node {
            // if we're just waiting for scripts, make it known.

            // .monotonic is okay because this is just used for progress; we don't rely on
            // any side effects from completed tasks.
            let pending_lifecycle_scripts = pkg_manager.pending_lifecycle_script_tasks.load(Ordering::Relaxed);
            // `+ 1` because the root task needs to wait for everything
            if pending_lifecycle_scripts > 0 && pkg_manager.pending_task_count() <= pending_lifecycle_scripts + 1 {
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
) -> Result<PackageInstall::Summary, AllocError> {
    analytics::Features::isolated_bun_install.fetch_add(1);

    let lockfile = manager.lockfile;

    let store: Store = 'store: {
        let mut timer = std::time::Instant::now();
        // TODO(port): std.time.Timer.start() catch unreachable → Instant::now()
        let pkgs = lockfile.packages.slice();
        let pkg_dependency_slices = pkgs.items().dependencies;
        let pkg_resolutions = pkgs.items().resolution;
        let pkg_names = pkgs.items().name;

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
                peer_name_idx.put(dep.name_hash, ());
            }
        }
        let peer_name_count: u32 = u32::try_from(peer_name_idx.count()).unwrap();

        let mut leaking_peers: DynamicBitSetList = DynamicBitSetList::init_empty(
            lockfile.packages.len(),
            peer_name_count as usize,
        );

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
            let mut own_peers: DynamicBitSetList = DynamicBitSetList::init_empty(
                lockfile.packages.len(),
                peer_name_count as usize,
            );
            let mut provides: DynamicBitSetList = DynamicBitSetList::init_empty(
                lockfile.packages.len(),
                peer_name_count as usize,
            );
            for pkg_idx in 0..lockfile.packages.len() {
                let pkg_id: PackageID = u32::try_from(pkg_idx).unwrap();
                let deps = pkg_dependency_slices[pkg_id as usize];
                for _dep_id in deps.begin()..deps.end() {
                    let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
                    let dep = &dependencies[dep_id as usize];
                    let Some(bit) = peer_name_idx.get_index(&dep.name_hash) else {
                        continue;
                    };
                    if dep.behavior.is_peer() {
                        own_peers.set(pkg_id as usize, bit);
                    } else if !Tree::is_filtered_dependency_or_workspace(
                        dep_id,
                        pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
                    ) {
                        provides.set(pkg_id as usize, bit);
                    }
                }
            }

            let mut scratch = DynamicBitSet::init_empty(peer_name_count as usize);

            let mut changed = true;
            while changed {
                changed = false;
                for pkg_idx in 0..lockfile.packages.len() {
                    let pkg_id: PackageID = u32::try_from(pkg_idx).unwrap();
                    let deps = pkg_dependency_slices[pkg_id as usize];

                    scratch.copy_into(&own_peers.at(pkg_id as usize));

                    for _dep_id in deps.begin()..deps.end() {
                        let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
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

        let mut root_declares_workspace = DynamicBitSet::init_empty(lockfile.packages.len());
        for _dep_idx in pkg_dependency_slices[0].begin()..pkg_dependency_slices[0].end() {
            let dep_idx: DependencyID = u32::try_from(_dep_idx).unwrap();
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
            if Tree::is_filtered_dependency_or_workspace(
                dep_idx,
                0,
                workspace_filters,
                install_root_dependencies,
                manager,
                lockfile,
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
                let nodes_slice = nodes.slice();
                let node_pkg_ids = nodes_slice.items().pkg_id;
                let node_dep_ids = nodes_slice.items().dep_id;
                let node_parent_ids = nodes_slice.items().parent_id;
                let node_nodes = nodes_slice.items_mut().nodes;

                let mut curr_id = entry.parent_id;
                while curr_id != store::node::Id::INVALID {
                    if node_pkg_ids[curr_id.get()] == entry.pkg_id {
                        // skip the new node, and add the previously added node to parent so it appears in
                        // 'node_modules/.bun/parent@version/node_modules'.

                        let dep_id = node_dep_ids[curr_id.get()];
                        if dep_id == invalid_dependency_id && entry.dep_id == invalid_dependency_id {
                            node_nodes[entry.parent_id.get()].push(curr_id);
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
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
                            curr_dep.behavior.workspace == entry_dep.behavior.workspace
                        {
                            node_nodes[entry.parent_id.get()].push(curr_id);
                            // PERF(port): was appendAssumeCapacity — profile in Phase B
                            continue 'next_node;
                        }
                    }
                    curr_id = node_parent_ids[curr_id.get()];
                }
            }

            let node_id: store::node::Id = store::node::Id::from(u32::try_from(nodes.len()).unwrap());
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
                    let nodes_slice = nodes.slice();
                    let node_nodes = nodes_slice.items_mut().nodes;
                    let node_dep_ids = nodes_slice.items().dep_id;
                    let node_parent_ids = nodes_slice.items().parent_id;
                    let node_dependencies = nodes_slice.items().dependencies;
                    let node_peers = nodes_slice.items_mut().peers;

                    let ctx_hash: u64 = if entry_dep.version.tag == VersionTag::Workspace || peer_name_count == 0 {
                        0
                    } else {
                        'ctx: {
                            let leaks = leaking_peers.at(entry.pkg_id as usize);
                            if leaks.count() == 0 {
                                break 'ctx 0;
                            }

                            let peer_names = peer_name_idx.keys();
                            let mut hasher = Wyhash11::init(0);
                            let mut it = leaks.iterator(Default::default());
                            while let Some(bit) = it.next() {
                                let peer_name_hash = peer_names[bit];
                                let resolved: PackageID = 'resolved: {
                                    let mut curr_id = entry.parent_id;
                                    while curr_id != store::node::Id::INVALID {
                                        for ids in &node_dependencies[curr_id.get()] {
                                            if dependencies[ids.dep_id as usize].name_hash == peer_name_hash {
                                                break 'resolved ids.pkg_id;
                                            }
                                        }
                                        for ids in &node_peers[curr_id.get()].list {
                                            if !ids.auto_installed
                                                && dependencies[ids.dep_id as usize].name_hash == peer_name_hash
                                            {
                                                break 'resolved ids.pkg_id;
                                            }
                                        }
                                        curr_id = node_parent_ids[curr_id.get()];
                                    }
                                    break 'resolved invalid_package_id;
                                };
                                // Auto-install fallback is declarer-specific; let the
                                // second pass handle this position rather than risk an
                                // unsound key.
                                if resolved == invalid_package_id {
                                    break 'dont_dedupe;
                                }
                                hasher.update(bytes_of(&peer_name_hash));
                                hasher.update(bytes_of(&resolved));
                            }
                            break 'ctx hasher.final_();
                        }
                    };

                    let dedupe_entry = early_dedupe.get_or_put(EarlyDedupeKey {
                        pkg_id: entry.pkg_id,
                        ctx_hash,
                    });
                    if dedupe_entry.found_existing {
                        let dedupe_node_id = *dedupe_entry.value_ptr;

                        let dedupe_dep_id = node_dep_ids[dedupe_node_id.get()];
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
                        let set_ctx = store::node::transitive_peer::OrderedArraySetCtx {
                            string_buf,
                            pkg_names,
                        };
                        // PORT NOTE: reshaped for borrowck — clone the dedupe peers slice
                        // before mutating node_peers.
                        let dedupe_peers: Vec<_> = node_peers[dedupe_node_id.get()].list.iter().copied().collect();
                        for peer in dedupe_peers {
                            let peer_name_hash = dependencies[peer.dep_id as usize].name_hash;
                            let mut curr_id = entry.parent_id;
                            'walk: while curr_id != store::node::Id::INVALID {
                                for ids in &node_dependencies[curr_id.get()] {
                                    if dependencies[ids.dep_id as usize].name_hash == peer_name_hash {
                                        break 'walk;
                                    }
                                }
                                node_peers[curr_id.get()].insert(peer, &set_ctx)?;
                                curr_id = node_parent_ids[curr_id.get()];
                            }
                        }

                        node_nodes[entry.parent_id.get()].push(dedupe_node_id);
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
                    Vec::with_capacity(pkg_deps.len() as usize)
                },
                dependencies: if skip_dependencies {
                    Vec::new()
                } else {
                    Vec::with_capacity(pkg_deps.len() as usize)
                },
                ..Default::default()
            })?;

            let nodes_slice = nodes.slice();
            let node_parent_ids = nodes_slice.items().parent_id;
            let node_dependencies = nodes_slice.items_mut().dependencies;
            let node_peers = nodes_slice.items_mut().peers;
            let node_nodes = nodes_slice.items_mut().nodes;

            if let Some(parent_id) = entry.parent_id.try_get() {
                node_nodes[parent_id].push(node_id);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
            }

            if skip_dependencies {
                continue;
            }

            let queue_mark = node_queue.len();

            dep_ids_sort_buf.clear();
            dep_ids_sort_buf.reserve(pkg_deps.len() as usize);
            for _dep_id in pkg_deps.begin()..pkg_deps.end() {
                let dep_id: DependencyID = u32::try_from(_dep_id).unwrap();
                dep_ids_sort_buf.push(dep_id);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
            }

            // TODO: make this sort in an order that allows peers to be resolved last
            // and devDependency handling to match `hoistDependency`
            // TODO(port): std.sort.pdq → slice::sort_by with DepSorter
            dep_ids_sort_buf.sort_by(|a, b| {
                Lockfile::DepSorter { lockfile }.compare(*a, *b)
            });

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
                                    node_dependencies[node_id.get()].push(store::node::DependencyIds {
                                        dep_id,
                                        pkg_id,
                                    });
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
                    if Tree::is_filtered_dependency_or_workspace(
                        dep_id,
                        entry.pkg_id,
                        workspace_filters,
                        install_root_dependencies,
                        manager,
                        lockfile,
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
                        node_dependencies[node_id.get()].push(store::node::DependencyIds { dep_id, pkg_id });
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
                        for ids in &node_dependencies[curr_id.get()] {
                            let dep = &dependencies[ids.dep_id as usize];

                            if dep.name_hash != peer_dep.name_hash {
                                continue;
                            }

                            let res = &pkg_resolutions[ids.pkg_id as usize];

                            if peer_dep.version.tag != VersionTag::Npm || res.tag != ResolutionTag::Npm {
                                // TODO: print warning for this? we don't have a version
                                // to compare to say if this satisfies or not.
                                break 'resolved_pkg_id (ids.pkg_id, false);
                            }

                            let peer_dep_version = &peer_dep.version.value.npm.version;
                            let res_version = &res.value.npm.version;

                            if !peer_dep_version.satisfies(res_version, string_buf, string_buf) {
                                // TODO: add warning!
                            }

                            break 'resolved_pkg_id (ids.pkg_id, false);
                        }

                        let curr_peers = &node_peers[curr_id.get()];
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
                                curr_id = node_parent_ids[curr_id.get()];
                            }

                            break 'resolved_pkg_id (best_version, true);
                        }

                        // TODO: prevent marking workspace and symlink deps with transitive peers

                        // add to visited parents after searching for a peer resolution.
                        // if a node resolves a transitive peer, it can still be deduplicated
                        visited_parent_node_ids.push(curr_id);
                        curr_id = node_parent_ids[curr_id.get()];
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
                    let ctx = store::node::transitive_peer::OrderedArraySetCtx {
                        string_buf,
                        pkg_names,
                    };
                    let peer = store::node::TransitivePeer {
                        dep_id: peer_dep_id,
                        pkg_id: resolved_pkg_id,
                        auto_installed,
                    };
                    node_peers[visited_parent_id.get()].insert(peer, &ctx)?;
                }

                if !visited_parent_node_ids.is_empty() {
                    // visited parents length == 0 means the node satisfied it's own
                    // peer. don't queue.
                    node_dependencies[node_id.get()].push(store::node::DependencyIds {
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
                bun_fmt::fmt_duration_one_decimal(full_tree_end)
            ));
        }

        let mut dedupe: HashMap<PackageID, Vec<DedupeInfo>> = HashMap::default();

        let mut res_fmt_buf: Vec<u8> = Vec::new();

        let nodes_slice = nodes.slice();
        let node_pkg_ids = nodes_slice.items().pkg_id;
        let node_dep_ids = nodes_slice.items().dep_id;
        let node_peers: &[store::node::Peers] = nodes_slice.items().peers;
        let node_nodes = nodes_slice.items().nodes;

        let mut store_entries: store::entry::List = store::entry::List::default();

        let mut entry_queue: LinearFifo<QueuedEntry> = LinearFifo::new();

        entry_queue.write_item(QueuedEntry {
            node_id: store::node::Id::from(0),
            entry_parent_id: store::entry::Id::INVALID,
        })?;

        let mut public_hoisted: StringArrayHashMap<()> = StringArrayHashMap::default();

        let mut hidden_hoisted: StringArrayHashMap<()> = StringArrayHashMap::default();

        // Second pass: Deduplicate nodes when the pkg_id and peer set match an existing entry.
        'next_entry: while let Some(entry) = entry_queue.read_item() {
            let pkg_id = node_pkg_ids[entry.node_id.get()];

            let dedupe_entry = dedupe.get_or_put(pkg_id);
            if !dedupe_entry.found_existing {
                *dedupe_entry.value_ptr = Vec::new();
            } else {
                let curr_peers = &node_peers[entry.node_id.get()];
                let curr_dep_id = node_dep_ids[entry.node_id.get()];

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
                            if existing_dep.behavior.is_workspace() != curr_dep.behavior.is_workspace() {
                                continue;
                            }
                        }
                    }

                    let eql_ctx = store::node::transitive_peer::OrderedArraySetCtx {
                        string_buf,
                        pkg_names,
                    };

                    if info.peers.eql(curr_peers, &eql_ctx) {
                        // dedupe! depend on the already created entry

                        let entries = store_entries.slice();
                        let entry_dependencies = entries.items_mut().dependencies;
                        let entry_parents = entries.items_mut().parents;

                        let parents = &mut entry_parents[info.entry_id.get()];

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
                        entry_dependencies[entry.entry_parent_id.get()].insert(
                            store::entry::DependencyRef {
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
                let peers = &node_peers[entry.node_id.get()];
                if peers.len() == 0 {
                    break 'peer_hash store::entry::PeerHash::NONE;
                }
                let mut hasher = Wyhash11::init(0);
                for peer_ids in peers.slice() {
                    let pkg_name = pkg_names[peer_ids.pkg_id as usize];
                    hasher.update(pkg_name.slice(string_buf));
                    let pkg_res = &pkg_resolutions[peer_ids.pkg_id as usize];
                    res_fmt_buf.clear();
                    write!(&mut res_fmt_buf, "{}", pkg_res.fmt(string_buf, paths::Style::Posix))?;
                    hasher.update(&res_fmt_buf);
                }
                break 'peer_hash store::entry::PeerHash::from(hasher.final_());
            };

            let new_entry_dep_id = node_dep_ids[entry.node_id.get()];

            let new_entry_is_root = new_entry_dep_id == invalid_dependency_id;
            let new_entry_is_workspace =
                !new_entry_is_root && dependencies[new_entry_dep_id as usize].version.tag == VersionTag::Workspace;

            let new_entry_dependencies: store::entry::Dependencies = if dedupe_entry.found_existing && new_entry_is_workspace {
                store::entry::Dependencies::default()
            } else {
                store::entry::Dependencies::with_capacity(node_nodes[entry.node_id.get()].len())
            };

            let mut new_entry_parents: Vec<store::entry::Id> = Vec::with_capacity(1);
            new_entry_parents.push(entry.entry_parent_id);
            // PERF(port): was appendAssumeCapacity — profile in Phase B

            let hoisted = 'hoisted: {
                if new_entry_dep_id == invalid_dependency_id {
                    break 'hoisted false;
                }

                let dep_name = dependencies[new_entry_dep_id as usize].name.slice(string_buf);

                let Some(hoist_pattern) = &manager.options.hoist_pattern else {
                    let hoist_entry = hidden_hoisted.get_or_put(dep_name);
                    break 'hoisted !hoist_entry.found_existing;
                };

                if hoist_pattern.is_match(dep_name) {
                    let hoist_entry = hidden_hoisted.get_or_put(dep_name);
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
                ..Default::default()
            };

            let new_entry_id: store::entry::Id = store::entry::Id::from(u32::try_from(store_entries.len()).unwrap());
            store_entries.append(new_entry)?;

            if let Some(entry_parent_id) = entry.entry_parent_id.try_get() {
                'skip_adding_dependency: {
                    if new_entry_dep_id != invalid_dependency_id
                        && dependencies[new_entry_dep_id as usize].behavior.is_workspace()
                    {
                        // skip implicit workspace dependencies on the root.
                        break 'skip_adding_dependency;
                    }

                    let entries = store_entries.slice();
                    let entry_dependencies = entries.items_mut().dependencies;
                    let ctx = store::entry::DependenciesOrderedArraySetCtx {
                        string_buf,
                        dependencies,
                    };
                    entry_dependencies[entry_parent_id].insert(
                        store::entry::DependencyRef {
                            entry_id: new_entry_id,
                            dep_id: new_entry_dep_id,
                        },
                        &ctx,
                    )?;

                    if new_entry_dep_id != invalid_dependency_id {
                        if entry.entry_parent_id == store::entry::Id::ROOT {
                            // make sure direct dependencies are not replaced
                            let dep_name = dependencies[new_entry_dep_id as usize].name.slice(string_buf);
                            public_hoisted.put(dep_name, ());
                        } else {
                            // transitive dependencies (also direct dependencies of workspaces!)
                            let dep_name = dependencies[new_entry_dep_id as usize].name.slice(string_buf);
                            if let Some(public_hoist_pattern) = &manager.options.public_hoist_pattern {
                                if public_hoist_pattern.is_match(dep_name) {
                                    let hoist_entry = public_hoisted.get_or_put(dep_name);
                                    if !hoist_entry.found_existing {
                                        entry_dependencies[0].insert(
                                            store::entry::DependencyRef {
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
                peers: node_peers[entry.node_id.get()].clone(),
            });

            for &child_node_id in &node_nodes[entry.node_id.get()] {
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
                bun_fmt::fmt_duration_one_decimal(dedupe_end)
            ));
        }

        break 'store Store {
            entries: store_entries,
            nodes,
        };
    };

    let global_store_path: Option<bun_str::ZStr> = if manager.options.enable.global_virtual_store {
        'global_store_path: {
            let entries = store.entries.slice();
            let entry_hashes = entries.items_mut().entry_hash;
            let entry_node_ids = entries.items().node_id;
            let entry_dependencies = entries.items().dependencies;

            let node_pkg_ids = store.nodes.items().pkg_id;
            let node_dep_ids = store.nodes.items().dep_id;

            let pkgs = lockfile.packages.slice();
            let pkg_names = pkgs.items().name;
            let pkg_name_hashes = pkgs.items().name_hash;
            let pkg_resolutions = pkgs.items().resolution;
            let pkg_metas = pkgs.items().meta;

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
                    id: store::entry::Id::from(u32::try_from(_root_id).unwrap()),
                    dep_idx: 0,
                    // SAFETY: hasher is initialized below before first use when state == Unvisited
                    hasher: unsafe { core::mem::zeroed() },
                });

                while !stack.is_empty() {
                    let top_idx = stack.len() - 1;
                    // PORT NOTE: reshaped for borrowck — re-borrow `top` after each
                    // potential `stack.push()` realloc.
                    let id = stack[top_idx].id;
                    let idx = id.get();

                    if states[idx] == State::Unvisited {
                        states[idx] = State::InProgress;

                        let node_id = entry_node_ids[idx];
                        let pkg_id = node_pkg_ids[node_id.get()];
                        let dep_id = node_dep_ids[node_id.get()];
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
                                    let name_version = match write!(
                                        &mut &mut name_version_buf[..],
                                        "{}@{}",
                                        BStr::new(pkg_names[pkg_id as usize].slice(string_buf)),
                                        pkg_res.fmt(string_buf, paths::Style::Posix),
                                    ) {
                                        // TODO(port): std.fmt.bufPrint returned the written slice;
                                        // emulate via cursor tracking in Phase B.
                                        Ok(()) => &name_version_buf[..],
                                        Err(_) => {
                                            // Overflow is implausible (PathBuffer ≫
                                            // any name+version), but if it ever fired
                                            // the safe answer is "not eligible" rather
                                            // than letting a possibly-patched package
                                            // slip into the shared store.
                                            break 'eligible false;
                                        }
                                    };
                                    if lockfile
                                        .patched_dependencies
                                        .contains(semver::String::Builder::string_hash(name_version))
                                    {
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
                                    || trusted_from_update.contains(&(dep_name_hash as u32))
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
                            let mut hw = WyhashWriter { hasher: &mut stack[top_idx].hasher };
                            write!(hw, "{}", StoreEntry::fmt_store_path(id, &store, lockfile))
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
                            .update(bytes_of(&pkg_metas[pkg_id as usize].integrity));
                    }

                    if states[idx] == State::Ineligible {
                        stack.pop();
                        continue;
                    }

                    let deps = entry_dependencies[idx].slice();
                    let mut advanced = false;
                    while (stack[top_idx].dep_idx as usize) < deps.len() {
                        let dep = &deps[stack[top_idx].dep_idx as usize];
                        let dep_idx = dep.entry_id.get();
                        let dep_name_hash = dependencies[dep.dep_id as usize].name_hash;
                        match states[dep_idx] {
                            State::Done => {
                                stack[top_idx].hasher.update(bytes_of(&dep_name_hash));
                                stack[top_idx].hasher.update(bytes_of(&entry_hashes[dep_idx]));
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
                                stack[top_idx].hasher.update(bytes_of(&dep_name_hash));
                            }
                            State::Unvisited => {
                                stack.push(StackFrame {
                                    id: dep.entry_id,
                                    dep_idx: 0,
                                    // SAFETY: initialized on next iteration before use
                                    hasher: unsafe { core::mem::zeroed() },
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
                let n: u32 = u32::try_from(store.entries.len()).unwrap();
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
                    work.push(WorkFrame { v: u32::try_from(root).unwrap(), child: 0 });
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
                            let w = deps[work[frame_idx].child as usize].entry_id.get();
                            if tarjan_index[w] == u32::MAX {
                                work[frame_idx].child += 1;
                                work.push(WorkFrame { v: u32::try_from(w).unwrap(), child: 0 });
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
                                            StoreEntry::fmt_store_path(
                                                store::entry::Id::from(m),
                                                &store,
                                                lockfile
                                            )
                                        )
                                        .expect("unreachable");
                                    }
                                    sub.update(bytes_of(
                                        &pkg_metas[node_pkg_ids[entry_node_ids[m as usize].get()] as usize].integrity,
                                    ));
                                    let mut poisoned = false;
                                    for dep in entry_dependencies[m as usize].slice() {
                                        let dh = entry_hashes[dep.entry_id.get()];
                                        if dh == 0 {
                                            poisoned = true;
                                            break;
                                        }
                                        let dep_name_hash = dependencies[dep.dep_id as usize].name_hash;
                                        sub.update(bytes_of(&dep_name_hash));
                                        sub.update(bytes_of(&dh));
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
                                            StoreEntry::fmt_store_path(
                                                store::entry::Id::from(m),
                                                &store,
                                                lockfile
                                            )
                                        )
                                        .expect("unreachable");
                                    }
                                    sub.update(bytes_of(
                                        &pkg_metas[node_pkg_ids[entry_node_ids[m as usize].get()] as usize]
                                            .integrity,
                                    ));
                                    member_sub.push(sub.final_());
                                    for dep in entry_dependencies[m as usize].slice() {
                                        let di = dep.entry_id.get();
                                        // Skip intra-SCC edges; those are captured
                                        // by member_sub.
                                        if members.contains(&u32::try_from(di).unwrap()) {
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
                                        ext.update(bytes_of(&dependencies[dep.dep_id as usize].name_hash));
                                        ext.update(bytes_of(&entry_hashes[di]));
                                        scc_ext.put(ext.final_(), ());
                                    }
                                }
                                member_sub.sort_unstable();
                                let ext_keys = scc_ext.keys_mut();
                                ext_keys.sort_unstable();
                                let mut hasher = Wyhash::init(0x42A7C15F9E3779B9);
                                for k in &member_sub {
                                    hasher.update(bytes_of(k));
                                }
                                for k in ext_keys.iter() {
                                    hasher.update(bytes_of(k));
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
                        if entry_hashes[dep.entry_id.get()] == 0 {
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
            break 'global_store_path Some(bun_str::ZStr::from_bytes(
                paths::join_abs_string(cache_dir_path, &[b"links"], paths::Style::Auto),
            ));
        }
    } else {
        None
    };
    // (Drop frees global_store_path)

    // setup node_modules/.bun
    let is_new_bun_modules: bool = 'is_new_bun_modules: {
        let node_modules_path = paths::os_path_literal!("node_modules");
        let bun_modules_path =
            paths::os_path_literal!(concat!("node_modules/", Store::MODULES_DIR_NAME));
        // TODO(port): bun.OSPathLiteral compile-time concat — verify Store::MODULES_DIR_NAME is const &str

        match sys::mkdirat(Fd::cwd(), node_modules_path, 0o755).unwrap() {
            Ok(()) => {
                // fallthrough to creating bun_modules below
            }
            Err(_) => {
                match sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755).unwrap() {
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

                    let mut rename_path = AutoRelPath::init();

                    {
                        let mut mkdir_path: RelPath<{ paths::Sep::Auto }, u16> = RelPath::from(b"node_modules");
                        // TODO(port): RelPath generic params — verify exact type sig in Phase B

                        mkdir_path.append_fmt(format_args!(
                            ".old_modules-{}",
                            hex_lower(bytes_of(&fast_random()))
                        ));
                        rename_path.append(mkdir_path.slice());

                        // 1
                        if sys::mkdirat(Fd::cwd(), mkdir_path.slice_z(), 0o755).unwrap().is_err() {
                            break 'is_new_bun_modules true;
                        }
                    }

                    let Ok(node_modules) = sys::open_dir_for_iteration(Fd::cwd(), b"node_modules").unwrap() else {
                        break 'is_new_bun_modules true;
                    };

                    let mut entry_path = AutoRelPath::from(b"node_modules");

                    // 2
                    let mut node_modules_iter = sys::DirIterator::iterate(node_modules, sys::Unit::U8);
                    loop {
                        let next = match node_modules_iter.next().unwrap() {
                            Ok(v) => v,
                            Err(_) => break 'is_new_bun_modules true,
                        };
                        let Some(entry) = next else { break };
                        if bun_str::strings::starts_with_char(entry.name.slice(), b'.') {
                            continue;
                        }

                        let entry_path_save = entry_path.save();
                        let _restore_entry = scopeguard::guard((), |_| entry_path_save.restore());
                        // TODO(port): defer save.restore() pattern — verify RAII guard semantics

                        entry_path.append(entry.name.slice());

                        let rename_path_save = rename_path.save();
                        let _restore_rename = scopeguard::guard((), |_| rename_path_save.restore());

                        rename_path.append(entry.name.slice());

                        let _ = sys::renameat(Fd::cwd(), entry_path.slice_z(), Fd::cwd(), rename_path.slice_z()).unwrap();
                    }

                    // 3
                    for workspace_path in lockfile.workspace_paths.values() {
                        let mut workspace_node_modules =
                            AutoRelPath::from(workspace_path.slice(&lockfile.buffers.string_bytes));

                        let basename = workspace_node_modules.basename();

                        workspace_node_modules.append(b"node_modules");

                        let rename_path_save = rename_path.save();
                        let _restore_rename = scopeguard::guard((), |_| rename_path_save.restore());

                        rename_path.append_fmt(format_args!(".old_{}_modules", BStr::new(basename)));

                        let _ = sys::renameat(
                            Fd::cwd(),
                            workspace_node_modules.slice_z(),
                            Fd::cwd(),
                            rename_path.slice_z(),
                        )
                        .unwrap();
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
                    let temp_node_modules = bun_core::fs::FileSystem::tmpname(
                        b"tmp_modules",
                        &mut temp_node_modules_buf,
                        fast_random(),
                    )
                    .expect("unreachable");

                    // 1
                    if sys::renameat(Fd::cwd(), b"node_modules", Fd::cwd(), temp_node_modules)
                        .unwrap()
                        .is_err()
                    {
                        break 'is_new_bun_modules true;
                    }

                    // 2
                    if let Err(err) = sys::mkdirat(Fd::cwd(), node_modules_path, 0o755).unwrap() {
                        Output::err(err, "failed to create './node_modules'", format_args!(""));
                        Global::exit(1);
                    }

                    if let Err(err) = sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755).unwrap() {
                        Output::err(err, "failed to create './node_modules/.bun'", format_args!(""));
                        Global::exit(1);
                    }

                    let mut rename_path = AutoRelPath::from(b"node_modules");

                    rename_path.append_fmt(format_args!(
                        ".old_modules-{}",
                        hex_lower(bytes_of(&fast_random()))
                    ));

                    // 3
                    if sys::renameat(Fd::cwd(), temp_node_modules, Fd::cwd(), rename_path.slice_z())
                        .unwrap()
                        .is_err()
                    {
                        break 'is_new_bun_modules true;
                    }

                    rename_path.append(b".cache");

                    let mut cache_path = AutoRelPath::from(b"node_modules");
                    cache_path.append(b".cache");

                    // 4
                    let _ = sys::renameat(Fd::cwd(), rename_path.slice_z(), Fd::cwd(), cache_path.slice_z()).unwrap();

                    // remove .cache so we can append destination for each workspace
                    rename_path.undo(1);

                    // 5
                    for workspace_path in lockfile.workspace_paths.values() {
                        let mut workspace_node_modules =
                            AutoRelPath::from(workspace_path.slice(&lockfile.buffers.string_bytes));

                        let basename = workspace_node_modules.basename();

                        workspace_node_modules.append(b"node_modules");

                        let rename_path_save = rename_path.save();
                        let _restore = scopeguard::guard((), |_| rename_path_save.restore());

                        rename_path.append_fmt(format_args!(".old_{}_modules", BStr::new(basename)));

                        let _ = sys::renameat(
                            Fd::cwd(),
                            workspace_node_modules.slice_z(),
                            Fd::cwd(),
                            rename_path.slice_z(),
                        )
                        .unwrap();
                    }
                }

                break 'is_new_bun_modules true;
            }
        }

        if let Err(err) = sys::mkdirat(Fd::cwd(), bun_modules_path, 0o755).unwrap() {
            Output::err(err, "failed to create './node_modules/.bun'", format_args!(""));
            Global::exit(1);
        }

        break 'is_new_bun_modules true;
    };

    {
        let mut root_node: *mut Progress::Node = core::ptr::null_mut();
        // TODO(port): Progress.Node locals are conditionally initialized in Zig;
        // model with Option in Phase B.
        let mut download_node: Progress::Node;
        let mut install_node: Progress::Node;
        let mut scripts_node: Progress::Node;
        let progress = &mut manager.progress;

        if manager.options.log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            root_node = progress.start("", 0);
            // SAFETY: root_node was just assigned from progress.start() above and is
            // non-null inside this `log_level.show_progress()` branch.
            download_node = unsafe { (*root_node).start(ProgressStrings::download(), 0) };
            // SAFETY: same root_node validity as above.
            install_node = unsafe { (*root_node).start(ProgressStrings::install(), store.entries.len()) };
            // SAFETY: same root_node validity as above.
            scripts_node = unsafe { (*root_node).start(ProgressStrings::script(), 0) };

            manager.downloads_node = None;
            manager.scripts_node = Some(&mut scripts_node);
            manager.downloads_node = Some(&mut download_node);
        }

        let nodes_slice = store.nodes.slice();
        let node_pkg_ids = nodes_slice.items().pkg_id;
        let node_dep_ids = nodes_slice.items().dep_id;

        let entries = store.entries.slice();
        let entry_node_ids = entries.items().node_id;
        let entry_steps = entries.items().step;
        let entry_dependencies = entries.items().dependencies;
        let entry_hoisted = entries.items().hoisted;

        let string_buf = &lockfile.buffers.string_bytes[..];

        let pkgs = lockfile.packages.slice();
        let pkg_names = pkgs.items().name;
        let pkg_name_hashes = pkgs.items().name_hash;
        let pkg_resolutions = pkgs.items().resolution;

        let mut seen_entry_ids: HashMap<store::entry::Id, ()> = HashMap::default();
        seen_entry_ids.reserve(store.entries.len());

        // TODO: delete
        let mut seen_workspace_ids: HashMap<PackageID, ()> = HashMap::default();

        let mut tasks: Box<[store::installer::Task]> =
            // TODO(port): allocator.alloc → Box::new_uninit_slice; init below
            // SAFETY: every element is fully initialized in the for-loop immediately
            // below before any read of `tasks[..]`.
            unsafe { Box::new_uninit_slice(store.entries.len()).assume_init() };

        let mut installer = store::Installer {
            lockfile,
            manager,
            command_ctx,
            installed: DynamicBitSet::init_empty(lockfile.packages.len()),
            install_node: if manager.options.log_level.show_progress() { Some(&mut install_node) } else { None },
            scripts_node: if manager.options.log_level.show_progress() { Some(&mut scripts_node) } else { None },
            store: &store,
            tasks: &mut tasks[..],
            trusted_dependencies_mutex: Default::default(),
            trusted_dependencies_from_update_requests: manager.find_trusted_dependencies_from_update_requests(),
            supported_backend: std::sync::atomic::AtomicU32::new(PackageInstall::supported_method() as u32),
            // TODO(port): .init(PackageInstall.supported_method) — verify atomic enum init
            is_new_bun_modules,
            global_store_path: global_store_path.as_deref(),
            global_store_tmp_suffix: fast_random(),
            ..Default::default()
        };
        // (Drop handles installer.deinit())

        for (_entry_id, task) in tasks.iter_mut().enumerate() {
            let entry_id = store::entry::Id::from(u32::try_from(_entry_id).unwrap());
            *task = store::installer::Task {
                entry_id,
                installer: &mut installer as *mut _,
                // TODO(port): back-pointer to installer; raw ptr to avoid borrowck cycle
                result: store::installer::TaskResult::None,

                task: bun_threading::Task { callback: store::installer::Task::callback },
                next: None,
            };
        }

        // add the pending task count upfront
        manager.increment_pending_tasks(u32::try_from(store.entries.len()).unwrap());
        for _entry_id in 0..store.entries.len() {
            let entry_id = store::entry::Id::from(u32::try_from(_entry_id).unwrap());

            let node_id = entry_node_ids[entry_id.get()];
            let pkg_id = node_pkg_ids[node_id.get()];
            let dep_id = node_dep_ids[node_id.get()];

            let pkg_name = pkg_names[pkg_id as usize];
            let pkg_name_hash = pkg_name_hashes[pkg_id as usize];
            let pkg_res: Resolution = pkg_resolutions[pkg_id as usize];

            match pkg_res.tag {
                ResolutionTag::Root => {
                    if dep_id == invalid_dependency_id {
                        // .monotonic is okay in this block because the task isn't running on another
                        // thread.
                        entry_steps[entry_id.get()].store(store::entry::Step::SymlinkDependencies, Ordering::Relaxed);
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
                    if !seen_workspace_ids.get_or_put(pkg_id).found_existing {
                        entry_steps[entry_id.get()].store(store::entry::Step::SymlinkDependencies, Ordering::Relaxed);
                        installer.start_task(entry_id);
                        continue;
                    }
                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, store::installer::Result::Skipped);
                    continue;
                }
                ResolutionTag::Symlink => {
                    // no installation required, will only need to be linked to packages that depend on it.
                    debug_assert!(entry_dependencies[entry_id.get()].list.is_empty());
                    // .monotonic is okay because the task isn't running on another thread.
                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, store::installer::Result::Skipped);
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

                    let patch_info = installer.package_patch_info(pkg_name, pkg_name_hash, &pkg_res)?;

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
                    let has_stale_gvs_link = !uses_global_store && 'stale: {
                        if installer.global_store_path.is_none() {
                            break 'stale false;
                        }
                        let mut local: paths::Path<{ paths::Sep::Auto }> = paths::Path::init_top_level_dir();
                        installer.append_local_store_entry_path(&mut local, entry_id);
                        #[cfg(windows)]
                        {
                            break 'stale if let Some(a) = sys::get_file_attributes(local.slice_z()) {
                                a.is_reparse_point
                            } else {
                                false
                            };
                        }
                        #[cfg(not(windows))]
                        {
                            break 'stale if let Some(st) = sys::lstat(local.slice_z()).as_value() {
                                sys::posix::s_islnk(u32::try_from(st.mode).unwrap())
                            } else {
                                false
                            };
                        }
                    };

                    let needs_install = manager.options.enable.force_install
                        // A freshly-created `node_modules/.bun` only implies the
                        // *project-local* entries are missing; global virtual-
                        // store entries persist across `rm -rf node_modules` and
                        // should still take the cheap symlink-only path.
                        || (is_new_bun_modules && !uses_global_store)
                        || has_stale_gvs_link
                        || matches!(patch_info, install::PatchInfo::Remove)
                        || 'needs_install: {
                            let mut store_path: AbsPath = AbsPath::init_top_level_dir();
                            if uses_global_store {
                                // Global entries are built under a per-process
                                // staging path and renamed into place as the
                                // final step, so the directory existing at its
                                // final path is the completeness signal.
                                installer.append_global_store_entry_path(&mut store_path, entry_id, store::PathKind::Final);
                                break 'needs_install !sys::directory_exists_at(Fd::cwd(), store_path.slice_z())
                                    .as_value()
                                    .unwrap_or(false);
                            }
                            installer.append_real_store_path(&mut store_path, entry_id, store::PathKind::Final);
                            let scope_for_patch_tag_path = store_path.save();
                            if pkg_res_tag == ResolutionTag::Npm {
                                // if it's from npm, it should always have a package.json.
                                // in other cases, probably yes but i'm less confident.
                                store_path.append(b"package.json");
                            }
                            let exists = sys::exists_z(store_path.slice_z());

                            break 'needs_install match &patch_info {
                                install::PatchInfo::None => !exists,
                                // checked above
                                install::PatchInfo::Remove => unreachable!(),
                                install::PatchInfo::Patch(patch) => {
                                    let mut hash_buf: install::BuntagHashBuf = Default::default();
                                    let hash = install::buntaghashbuf_make(&mut hash_buf, patch.contents_hash);
                                    scope_for_patch_tag_path.restore();
                                    store_path.append(hash);
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
                                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                                    installer.on_task_fail(entry_id, store::installer::Fail::SymlinkDependencies(err));
                                    continue;
                                }
                            }
                        }
                        if entry_hoisted[entry_id.get()] {
                            installer.link_to_hidden_node_modules(entry_id);
                        }
                        // .monotonic is okay because the task isn't running on another thread.
                        entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                        installer.on_task_complete(entry_id, store::installer::Result::Skipped);
                        continue;
                    }

                    let mut pkg_cache_dir_subpath: RelPath<{ paths::Sep::Auto }> = RelPath::from(match pkg_res_tag {
                        ResolutionTag::Npm => manager.cached_npm_package_folder_name(
                            pkg_name.slice(string_buf),
                            &pkg_res.value.npm.version,
                            patch_info.contents_hash(),
                        ),
                        ResolutionTag::Git => {
                            manager.cached_git_folder_name(&pkg_res.value.git, patch_info.contents_hash())
                        }
                        ResolutionTag::Github => {
                            manager.cached_github_folder_name(&pkg_res.value.github, patch_info.contents_hash())
                        }
                        ResolutionTag::LocalTarball => manager
                            .cached_tarball_folder_name(pkg_res.value.local_tarball, patch_info.contents_hash()),
                        ResolutionTag::RemoteTarball => manager
                            .cached_tarball_folder_name(pkg_res.value.remote_tarball, patch_info.contents_hash()),

                        _ => unreachable!(),
                    });

                    let (cache_dir, cache_dir_path) = manager.get_cache_directory_and_abs_path();
                    let _ = &cache_dir_path; // dropped at scope exit (Zig: defer cache_dir_path.deinit())

                    let missing_from_cache = match manager.get_preinstall_state(pkg_id) {
                        install::PreinstallState::Done => false,
                        _ => 'missing_from_cache: {
                            if matches!(patch_info, install::PatchInfo::None) {
                                let exists = match pkg_res_tag {
                                    ResolutionTag::Npm => 'exists: {
                                        let cache_dir_path_save = pkg_cache_dir_subpath.save();
                                        let _r = scopeguard::guard((), |_| cache_dir_path_save.restore());
                                        pkg_cache_dir_subpath.append(b"package.json");
                                        break 'exists sys::exists_at(cache_dir, pkg_cache_dir_subpath.slice_z());
                                    }
                                    _ => sys::directory_exists_at(cache_dir, pkg_cache_dir_subpath.slice_z())
                                        .unwrap_or(false),
                                };
                                if exists {
                                    manager.set_preinstall_state(pkg_id, installer.lockfile, install::PreinstallState::Done);
                                }
                                break 'missing_from_cache !exists;
                            }

                            // TODO: why does this look like it will never work?
                            break 'missing_from_cache true;
                        }
                    };

                    if !missing_from_cache {
                        if let install::PatchInfo::Patch(patch) = &patch_info {
                            let mut patch_log = logger::Log::init();
                            installer.apply_package_patch(entry_id, patch, &mut patch_log);
                            if patch_log.has_errors() {
                                // monotonic is okay because we haven't started the task yet (it isn't running
                                // on another thread)
                                entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                                installer.on_task_fail(entry_id, store::installer::Fail::Patching(patch_log));
                                continue;
                            }
                        }
                        installer.start_task(entry_id);
                        continue;
                    }

                    let ctx = install::TaskCallbackContext::IsolatedPackageInstallContext(entry_id);

                    let dep = &lockfile.buffers.dependencies[dep_id as usize];

                    match pkg_res_tag {
                        ResolutionTag::Npm => {
                            match manager.enqueue_package_for_download(
                                pkg_name.slice(string_buf),
                                dep_id,
                                pkg_id,
                                &pkg_res.value.npm.version,
                                pkg_res.value.npm.url.slice(string_buf),
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => return Err(AllocError),
                                Err(err) => {
                                    // error.InvalidURL
                                    Output::err(
                                        err,
                                        "failed to enqueue package for download: {}@{}",
                                        format_args!(
                                            "{}@{}",
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, paths::Style::Auto)
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                                    installer.on_task_complete(entry_id, store::installer::Result::Fail);
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
                            let url = manager.alloc_github_url(&pkg_res.value.git);
                            // (Drop frees url)
                            match manager.enqueue_tarball_for_download(
                                dep_id,
                                pkg_id,
                                &url,
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => bun_core::out_of_memory(),
                                Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to enqueue github package for download: {}@{}",
                                        format_args!(
                                            "{}@{}",
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, paths::Style::Auto)
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                                    installer.on_task_complete(entry_id, store::installer::Result::Fail);
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
                                pkg_res.value.remote_tarball.slice(string_buf),
                                ctx,
                                patch_info.name_and_version_hash(),
                            ) {
                                Ok(()) => {}
                                Err(e) if e == bun_core::err!(OutOfMemory) => bun_core::out_of_memory(),
                                Err(err) => {
                                    Output::err(
                                        err,
                                        "failed to enqueue tarball for download: {}@{}",
                                        format_args!(
                                            "{}@{}",
                                            BStr::new(pkg_name.slice(string_buf)),
                                            pkg_res.fmt(string_buf, paths::Style::Auto)
                                        ),
                                    );
                                    Output::flush();
                                    if manager.options.enable.fail_early {
                                        Global::exit(1);
                                    }
                                    // .monotonic is okay because an error means the task isn't
                                    // running on another thread.
                                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                                    installer.on_task_complete(entry_id, store::installer::Result::Fail);
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
                    entry_steps[entry_id.get()].store(store::entry::Step::Done, Ordering::Relaxed);
                    installer.on_task_complete(entry_id, store::installer::Result::Skipped);
                    continue;
                }
            }
        }

        if manager.pending_task_count() > 0 {
            let mut wait = Wait { installer: &mut installer, err: None };
            manager.sleep_until(&mut wait, Wait::is_done);

            if let Some(err) = wait.err {
                Output::err(err, "failed to install packages", format_args!(""));
                Global::exit(1);
            }
        }

        if manager.options.log_level.show_progress() {
            progress.root.end();
            *progress = Progress::default();
        }

        if Environment::CI_ASSERT {
            let mut done = true;
            'next_entry: for (_entry_id, entry_step) in store.entries.items().step.iter().enumerate() {
                let entry_id = store::entry::Id::from(u32::try_from(_entry_id).unwrap());
                // .monotonic is okay because `Wait.isDone` should have already synchronized with
                // the completed task threads, via popping from the `UnboundedQueue` in `runTasks`,
                // and the .acquire load `pendingTaskCount`.
                let step = entry_step.load(Ordering::Relaxed);

                if step == store::entry::Step::Done {
                    continue;
                }

                done = false;

                log!("entry not done: {}, {}\n", entry_id.get(), <&'static str>::from(step));

                let deps = &store.entries.items().dependencies[entry_id.get()];
                for dep in deps.slice() {
                    // .monotonic is okay because `Wait.isDone` already synchronized with the tasks.
                    let dep_step = entry_steps[dep.entry_id.get()].load(Ordering::Relaxed);
                    if dep_step != store::entry::Step::Done {
                        log!(", parents:\n - ");
                        let parent_ids = StoreEntry::debug_gather_all_parents(entry_id, installer.store);
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

        installer.summary.successfully_installed = installer.installed;

        return Ok(installer.summary);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/// `std.mem.asBytes(&x)` — view a `Copy` value's bytes.
#[inline]
fn bytes_of<T: Copy>(v: &T) -> &[u8] {
    // SAFETY: T is Copy/POD; reading its bytes is sound.
    unsafe { core::slice::from_raw_parts((v as *const T).cast::<u8>(), core::mem::size_of::<T>()) }
}

/// `std.fmt.bytesToHex(.., .lower)`
#[inline]
fn hex_lower(bytes: &[u8]) -> impl core::fmt::Display + '_ {
    bun_fmt::hex_lower(bytes)
    // TODO(port): verify bun_core::fmt::hex_lower exists; otherwise hand-roll.
}

// TODO(port): VersionTag / ResolutionTag are placeholder names for the enum
// tags on Dependency.Version and Resolution. Phase B: import the real types.
use crate::dependency::VersionTag;
use crate::resolution::Tag as ResolutionTag;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install.zig (1957 lines)
//   confidence: medium
//   todos:      14
//   notes:      single 1.9k-line fn; MultiArrayList .items(.field) modeled as .items().field; inline-else switch demoted to runtime tag; AutoRelPath save/restore + Progress.Node init need Phase B attention
// ──────────────────────────────────────────────────────────────────────────
