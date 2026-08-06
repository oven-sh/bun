//! Resolution and tree construction as a single ordered pass.
//!
//! One cursor walks a live tree in a fixed order (breadth-first from the root,
//! `DepSorter` order within a package) and decides one dependency edge at a
//! time by looking at the tree built so far: the first same-named slot walking
//! up from the edge's owner either satisfies the edge (bind, no fetch), or the
//! edge takes its own slot below the conflict. Manifest fetches, git clones
//! and tarball downloads run in parallel and speculatively; their outcomes
//! land in caches. The cursor is the only thing that decides, and it never
//! reads a fetch outcome unless it genuinely needs the package. Determinism
//! comes from the fixed cursor order: network arrival never changes a
//! decision, only how long the cursor waits.

use std::collections::VecDeque;

use bun_collections::HashMap;
use bun_core::{UnwrapOrOom, strings};
use bun_paths::{self as Path, PathBuffer};
use bun_semver::{self as Semver, String as SemverString};
use bun_threading::thread_pool as ThreadPool;

use crate::_folder_resolver::{
    self as FolderResolution, FolderResolution as FolderResolutionValue, GlobalOrRelative,
    PackageWorkspaceSearchPathFormatter,
};
use crate::bun_fs::FileSystem;
use crate::dependency::DependencyExt as _;
use crate::lockfile::DepSorter;
use crate::lockfile::package::{Package, PackageColumns as _};
use crate::package_manager_real::options::LogLevel;
use crate::package_manager_real::{
    PackageManager, determine_preinstall_state, get_preinstall_state, run_tasks,
    set_preinstall_state,
};
use crate::package_manager_task as Task;
use crate::patch_install::EnqueueAfterState;
use crate::repository_real::RepositoryExt as _;
use crate::resolution::{
    NpmVersionInfo as ResolutionNpmValue, Tag as ResolutionTag, TaggedValue as ResolutionTagged,
};
use crate::{ManifestLoad, dependency};
use bun_install::NetworkTask;
use bun_install::{
    self as install, Dependency, DependencyID, Features, Integrity, Npm, PackageID,
    PackageNameHash, PatchTask, Repository, Resolution, invalid_package_id,
};

use super::enqueue::{
    enqueue_git_checkout, enqueue_git_clone, enqueue_local_tarball, enqueue_network_task,
    enqueue_patch_task,
};

const MS_PER_S: f64 = bun_core::time::MS_PER_S as f64;

// ──────────────────────────────────────────────────────────────────────────
// The live tree
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type NodeId = u32;
pub(crate) const ROOT_NODE: NodeId = 0;

struct Node {
    parent: NodeId,
    package_id: PackageID,
    /// Folder-name hash (the dependency's `name_hash`) -> child node.
    slots: HashMap<PackageNameHash, NodeId>,
    /// Its already-bound edges have been placed. A node the decide pass
    /// creates has not walked its bound subtree, so an unresolved edge
    /// deeper inside would otherwise never be reached.
    bound_placed: bool,
}

impl Node {
    fn new(parent: NodeId, package_id: PackageID) -> Self {
        Self {
            parent,
            package_id,
            slots: HashMap::default(),
            bound_placed: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Cursor state
// ──────────────────────────────────────────────────────────────────────────

/// The node whose edges are currently being decided, and the resume position.
struct NodeCursor {
    node: NodeId,
    /// `nodes.len()` when this node started: the nodes created while its
    /// edges were decided are its children, prefetched once it finishes.
    children_start: usize,
    edges: Vec<DependencyID>,
    index: usize,
    /// Names of the edges not yet decided, so a child placed under this
    /// node knows in O(1) which names could still gain a slot above it.
    remaining_names: HashMap<PackageNameHash, u32>,
}

/// What a blocked edge is waiting on. Cached so a retry checks the wait
/// target directly instead of recomputing the whole decision (so a clone's
/// `git rev-parse` is not re-run on every event-loop wake).
#[derive(Clone, Copy)]
enum WaitTarget {
    Manifest,
    GitClone(Task::Id),
    Task(Task::Id),
}

struct Wait {
    dep_id: DependencyID,
    target: WaitTarget,
}

pub(crate) enum Step {
    /// Advanced: an edge was decided, a node was placed, or a phase moved on.
    Progress,
    /// Nothing to advance until an in-flight task lands.
    Blocked,
    Done,
}

enum EdgeStep {
    Done,
    Blocked(WaitTarget),
}

/// Result of walking up-tree from a start node for a folder name.
enum Walk {
    /// A slot up-tree holds a package that satisfies the edge.
    Bound(PackageID),
    /// A same-named slot up-tree holds a package that does not satisfy.
    /// `candidate` is the highest free node visited below the conflict, or
    /// `None` if the conflict is at the walk's first node.
    Conflict {
        occupant: PackageID,
        same_kind: bool,
        candidate: Option<NodeId>,
    },
    /// No same-named slot anywhere on the path. `candidate` is the highest
    /// node visited (the root).
    Free { candidate: NodeId },
}

enum Satisfies {
    Yes,
    /// Same kind of package (semver npm) but the version does not satisfy.
    No,
    /// A different kind of package occupies the name (folder, tarball, ...).
    WrongKind,
}

/// What an edge must match against a slot's package.
enum EdgeMatch<'a> {
    /// An npm range. `alias_target` is compared only for `npm:` alias edges
    /// (the slot's package must be the alias target); plain ranges are
    /// name-blind, matching the runtime's lookup.
    NpmRange {
        alias_target: Option<SemverString>,
        group: &'a Semver::query::Group,
        name_hash: PackageNameHash,
    },
    /// A concrete package (pre-bound edges, locally resolved packages,
    /// downloaded packages): satisfied only by that same package.
    Exact { package_id: PackageID },
    /// Never satisfied; classifies a same-named occupant as an npm package
    /// (same-kind) or not, so a dist-tag peer can find its parent scope's
    /// occupant before resolving anything.
    AnyNpm,
}

/// The cursor runs two passes. The first places every edge the lockfile
/// (or an earlier decision) already bound — the recorded tree, no I/O, never
/// blocking. The second sweeps every node deciding the unbound edges, so a
/// new dependency resolves against the whole existing tree, not just the
/// part built above it so far. With nothing bound (a fresh install) the
/// first pass places nothing and the second is the entire resolve.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pass {
    PlaceBound,
    Decide,
}

pub(crate) struct GraphResolver {
    nodes: Vec<Node>,
    /// PlaceBound pass: nodes to place, breadth-first from the root.
    /// Decide pass: nodes to re-walk (a package re-parsed from disk).
    queue: VecDeque<NodeId>,
    pass: Pass,
    /// Decide-pass sweep position over `nodes` (creation order, which is
    /// breadth-first). Nodes created during the sweep are appended and
    /// reached by it.
    sweep_index: usize,
    /// Root edges that live outside the root package's dependency slice
    /// (synthetic dependencies appended by the runtime auto-installer).
    extra_root_edges: Vec<DependencyID>,
    /// First node placed for each package. A folder/workspace/link package
    /// re-parsed from disk mid-resolution has a fresh dependency list that
    /// the node built from the old one must walk again.
    package_first_node: HashMap<PackageID, NodeId>,
    /// Edges that failed while their I/O was being started; the error was
    /// reported against the dependency and the edge stays unresolved.
    failed_edges: HashMap<DependencyID, ()>,
    /// Whether peer edges are decided at all. The runtime auto-installer
    /// resolves only what an import needs and leaves peers unresolved.
    resolve_peers: bool,
    current: Option<NodeCursor>,
    blocked: Option<Wait>,
}

// ──────────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────────

/// When the driver announces itself ("Resolving dependencies" / the
/// progress bar) and prints its summary.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Announce {
    /// Never announce (resolution driven from outside an install command).
    Silent,
    /// The caller already announced (work was pending before the cursor
    /// started); the driver only prints the summary.
    Already,
    /// Announce only if the cursor has to wait on I/O; a resolve that never
    /// waits stays quiet.
    OnFirstWait,
}

/// How a resolve run behaves for its caller.
pub(crate) struct ResolveOptions {
    pub announce: Announce,
    /// Whether peer edges are decided. The runtime auto-installer resolves
    /// only what an import needs and leaves peers unresolved.
    pub resolve_peers: bool,
}

impl ResolveOptions {
    /// The install command: full resolution, peers included.
    pub(crate) fn install(announce: Announce) -> Self {
        Self {
            announce,
            resolve_peers: true,
        }
    }

    /// The runtime auto-installer: one import's closure, quiet.
    pub(crate) fn auto_install() -> Self {
        Self {
            announce: Announce::Silent,
            resolve_peers: false,
        }
    }
}

impl PackageManager {
    /// Resolve every unbound dependency edge reachable from the root package,
    /// growing the graph. Blocks the calling thread, ticking the event loop
    /// while manifests, clones and downloads land. Edges that already have a
    /// resolution (from a loaded lockfile) are kept as-is and only placed.
    pub(crate) fn resolve_graph<C: run_tasks::RunTasksCallbacks<Ctx = ()>>(
        &mut self,
        log_level: LogLevel,
        extra_root_edges: &[DependencyID],
        opts: ResolveOptions,
    ) -> Result<(), crate::Error> {
        if self.lockfile.packages.len() == 0 {
            return Ok(());
        }
        let announce = opts.announce;

        let mut resolver = GraphResolver::new(extra_root_edges.to_vec(), opts.resolve_peers);
        resolver.seed_root();

        let mut announced = announce == Announce::Already;

        loop {
            match resolver.step(self)? {
                Step::Progress => {}
                Step::Done => break,
                Step::Blocked => {
                    if announce == Announce::OnFirstWait && !announced {
                        announced = true;
                        announce_resolution(self, log_level);
                    }
                    wait_for_progress::<C>(self, &mut resolver, log_level)?;
                }
            }
        }

        self.flush_pending_tasks();

        // Downloads and extractions fired during resolution carry ids into the
        // current lockfile buffers; they must all land before the caller
        // renumbers those buffers (`clean_with_logger`).
        if self.pending_task_count() > 0 {
            if announce == Announce::OnFirstWait && !announced {
                announced = true;
                announce_resolution(self, log_level);
            }
            wait_for_pending_tasks::<C>(self, log_level)?;
        }

        if announced {
            if log_level.show_progress() {
                self.end_progress_bar();
            } else if log_level != LogLevel::Silent {
                bun_core::pretty_errorln!(
                    "Resolved, downloaded and extracted [{}]",
                    self.total_tasks,
                );
                bun_core::Output::flush();
            }
        }
        Ok(())
    }

    /// Hand queued network tasks and thread-pool batches to the HTTP thread
    /// / thread pool. Fired tasks otherwise sit in the fifos.
    pub(crate) fn flush_pending_tasks(&mut self) {
        self.flush_network_queue();
        self.flush_patch_task_queue();
        let _ = self.schedule_tasks();
    }

    /// Mark every currently-unresolved edge that the manifest diff did not
    /// invalidate as settled: the loaded lockfile is authoritative for it,
    /// holes included, and the resolution cursor leaves it unresolved.
    pub(crate) fn mark_settled_unresolved_edges(&mut self, redecide_ids: &[DependencyID]) {
        let packages_len = self.lockfile.packages.len() as u64;
        let edges_len = self.lockfile.buffers.resolutions.len();
        if self.settled_unresolved_edges.bit_length() < edges_len {
            bun_core::handle_oom(self.settled_unresolved_edges.resize(edges_len, false));
        }
        for (id, &resolution) in self
            .lockfile
            .buffers
            .resolutions
            .as_slice()
            .iter()
            .enumerate()
        {
            if (resolution as u64) >= packages_len {
                self.settled_unresolved_edges.set(id);
            }
        }
        for &id in redecide_ids {
            self.settled_unresolved_edges.unset(id as usize);
        }
    }

    /// Record that fetching the manifest for `name` failed (already reported)
    /// so the resolution cursor stops waiting on it.
    #[inline]
    pub(crate) fn mark_manifest_fetch_failed(&mut self, name: &[u8]) {
        self.failed_manifests.insert(
            Semver::string::Builder::string_hash(name),
            crate::package_manager_real::ManifestFailure::Reported,
        );
    }

    #[inline]
    pub(crate) fn edge_is_settled_unresolved(&self, dep_id: DependencyID) -> bool {
        self.settled_unresolved_edges
            .is_set_allow_out_of_bound(dep_id as usize, false)
    }
}

fn wait_for_progress<C: run_tasks::RunTasksCallbacks<Ctx = ()>>(
    this: &mut PackageManager,
    resolver: &mut GraphResolver,
    log_level: LogLevel,
) -> Result<(), crate::Error> {
    struct Closure {
        manager: *mut PackageManager,
        resolver: *mut GraphResolver,
        log_level: LogLevel,
        err: Option<crate::Error>,
    }

    impl Closure {
        fn is_done<C: run_tasks::RunTasksCallbacks<Ctx = ()>>(&mut self) -> bool {
            // SAFETY: `manager`/`resolver` are the raw provenance roots set
            // below; `sleep_until` holds no `&mut` across this callback.
            let manager = unsafe { &mut *self.manager };
            let resolver = unsafe { &mut *self.resolver };

            if let Err(err) = run_tasks::run_tasks::<C>(manager, &mut (), self.log_level) {
                self.err = Some(err);
                return true;
            }

            match resolver.step(manager) {
                Ok(Step::Progress) | Ok(Step::Done) => return true,
                Ok(Step::Blocked) => {}
                Err(err) => {
                    self.err = Some(err);
                    return true;
                }
            }

            manager.flush_pending_tasks();

            if PackageManager::verbose_install() && manager.pending_task_count() > 0 {
                if PackageManager::has_enough_time_passed_between_waiting_messages() {
                    bun_core::pretty_errorln!(
                        "<d>[PackageManager]<r> waiting for {} tasks\n",
                        manager.pending_task_count()
                    );
                }
            }

            debug_assert!(
                manager.pending_task_count() > 0,
                "resolution cursor is blocked with no pending tasks"
            );
            false
        }
    }

    this.flush_pending_tasks();

    let mgr: *mut PackageManager = this;
    let mut closure = Closure {
        manager: mgr,
        resolver: std::ptr::from_mut(resolver),
        log_level,
        err: None,
    };
    // SAFETY: `mgr` is derived from the live exclusive `this`; `sleep_until`
    // and `tick_raw` hold no `&mut PackageManager` across `is_done`, so the
    // callback's `&mut *closure.manager` is the unique live borrow.
    unsafe { PackageManager::sleep_until(mgr, &mut closure, Closure::is_done::<C>) };

    match closure.err {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

/// First sign that resolution has to wait on I/O: the progress bar, or the
/// "Resolving dependencies" line when there is no bar.
pub(crate) fn announce_resolution(this: &mut PackageManager, log_level: LogLevel) {
    if log_level.show_progress() {
        this.start_progress_bar();
    } else if log_level != LogLevel::Silent {
        bun_core::pretty_errorln!("Resolving dependencies");
        bun_core::Output::flush();
    }
}

/// Tick the event loop until every scheduled task has completed.
fn wait_for_pending_tasks<C: run_tasks::RunTasksCallbacks<Ctx = ()>>(
    this: &mut PackageManager,
    log_level: LogLevel,
) -> Result<(), crate::Error> {
    if this.pending_task_count() == 0 {
        return Ok(());
    }

    struct Closure {
        manager: *mut PackageManager,
        log_level: LogLevel,
        err: Option<crate::Error>,
    }

    impl Closure {
        fn is_done<C: run_tasks::RunTasksCallbacks<Ctx = ()>>(&mut self) -> bool {
            // SAFETY: `manager` is the raw provenance root set below;
            // `sleep_until` holds no `&mut` across this callback.
            let manager = unsafe { &mut *self.manager };
            if let Err(err) = run_tasks::run_tasks::<C>(manager, &mut (), self.log_level) {
                self.err = Some(err);
                return true;
            }
            manager.flush_pending_tasks();

            let pending = manager.pending_task_count();
            if PackageManager::verbose_install() && pending > 0 {
                if PackageManager::has_enough_time_passed_between_waiting_messages() {
                    bun_core::pretty_errorln!(
                        "<d>[PackageManager]<r> waiting for {} tasks\n",
                        pending
                    );
                }
            }
            pending == 0
        }
    }

    let mgr: *mut PackageManager = this;
    let mut closure = Closure {
        manager: mgr,
        log_level,
        err: None,
    };
    // SAFETY: see `wait_for_progress`.
    unsafe { PackageManager::sleep_until(mgr, &mut closure, Closure::is_done::<C>) };

    match closure.err {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GraphResolver
// ──────────────────────────────────────────────────────────────────────────

impl GraphResolver {
    fn new(extra_root_edges: Vec<DependencyID>, resolve_peers: bool) -> Self {
        Self {
            nodes: Vec::new(),
            queue: VecDeque::new(),
            pass: Pass::PlaceBound,
            sweep_index: 0,
            extra_root_edges,
            package_first_node: HashMap::default(),
            failed_edges: HashMap::default(),
            resolve_peers,
            current: None,
            blocked: None,
        }
    }

    fn seed_root(&mut self) {
        debug_assert!(self.nodes.is_empty());
        self.nodes.push(Node::new(ROOT_NODE, 0));
        self.package_first_node.insert(0, ROOT_NODE);
        self.queue.push_back(ROOT_NODE);
    }

    fn parent(&self, node: NodeId) -> NodeId {
        self.nodes[node as usize].parent
    }

    /// The synthetic root edge created for a runtime import (auto-install),
    /// as opposed to an entry from a package.json.
    fn is_synthetic_edge(&self, dep_id: DependencyID) -> bool {
        self.extra_root_edges.contains(&dep_id)
    }

    /// The package already sits at `node` or an ancestor of it: placing it
    /// again below `node` would only extend a dependency cycle no
    /// node_modules layout can satisfy (`a@1` needs `a@2` needs `a@1`).
    fn ancestor_has_package(&self, mut node: NodeId, package_id: PackageID) -> bool {
        loop {
            let n = &self.nodes[node as usize];
            if n.package_id == package_id {
                return true;
            }
            if node == ROOT_NODE {
                return false;
            }
            node = n.parent;
        }
    }

    /// An edge `bun update` was asked to update: a dependency of the package
    /// the command ran in whose name was requested (or every such
    /// dependency for a bare `bun update`). It resolves fresh from the
    /// manifest, ignoring the existing tree and its own current version.
    fn is_update_target(
        &self,
        this: &mut PackageManager,
        dep_id: DependencyID,
        dependency: &Dependency,
    ) -> bool {
        if !this.to_update {
            return false;
        }
        let workspace_name_hash = this.workspace_name_hash;
        // reshaped for borrowck: `root_package_id` and `lockfile` are disjoint fields.
        let this_ptr: *mut PackageManager = this;
        // SAFETY: `root_package_id` is only a memo cell; the lookup reads `lockfile`.
        let root_id = unsafe {
            (*this_ptr)
                .root_package_id
                .get(&(*this_ptr).lockfile, workspace_name_hash)
        };
        let slice = this.lockfile.packages.items_dependencies()[root_id as usize];
        // A dependency of the current root package, or a catalog reference
        // (declared in any workspace package but versioned by the root's
        // catalog, so `bun update` moves it too).
        let is_root_dep = dep_id >= slice.off && dep_id < slice.off + slice.len;
        if !(is_root_dep || dependency.version.tag == dependency::version::Tag::Catalog) {
            return false;
        }
        this.update_requests.is_empty()
            || this.updating_packages.contains(
                dependency
                    .name
                    .slice(this.lockfile.buffers.string_bytes.as_slice()),
            )
    }

    /// Decide edges until one blocks or none remain.
    pub(crate) fn step(&mut self, this: &mut PackageManager) -> Result<Step, crate::Error> {
        if self.current.is_none() {
            if let Some(node) = self.queue.pop_front() {
                self.start_node(this, node)?;
            } else if self.pass == Pass::PlaceBound {
                // The recorded tree is placed. Sweep the nodes, deciding the
                // unbound edges against it.
                self.pass = Pass::Decide;
                self.sweep_index = 0;
                self.start_node(this, ROOT_NODE)?;
            } else {
                let next = self.sweep_index + 1;
                if next >= self.nodes.len() {
                    return Ok(Step::Done);
                }
                self.sweep_index = next;
                self.start_node(this, NodeId::try_from(next).expect("tree node overflow"))?;
            }
        }

        let (node, dep_id) = {
            let cursor = self.current.as_ref().unwrap();
            if cursor.index >= cursor.edges.len() {
                // The node's slots all exist now, so its children's walks
                // are gated correctly: start their manifest fetches ahead
                // of the cursor reaching them (level-wide pipelining) without
                // requesting a name a sibling slot here already satisfies.
                let children = cursor.children_start..self.nodes.len();
                self.current = None;
                for child in children {
                    let child = NodeId::try_from(child).expect("tree node overflow");
                    let edges = self.decide_edges_of(this, child);
                    self.prefetch_node_deps(this, child, &edges);
                }
                return Ok(Step::Progress);
            }
            (cursor.node, cursor.edges[cursor.index])
        };

        match self.decide_edge(this, node, dep_id) {
            Ok(EdgeStep::Done) => {
                self.blocked = None;
                self.advance_cursor(this);
                Ok(Step::Progress)
            }
            Ok(EdgeStep::Blocked(target)) => {
                self.blocked = Some(Wait { dep_id, target });
                Ok(Step::Blocked)
            }
            Err(err) => {
                // A failure while deciding one edge is reported against
                // that dependency and leaves it unbound; the rest of the graph
                // is still decided.
                log_dependency_error(this, dep_id, err);
                self.blocked = None;
                self.advance_cursor(this);
                Ok(Step::Progress)
            }
        }
    }

    fn start_node(&mut self, this: &mut PackageManager, node: NodeId) -> Result<(), crate::Error> {
        let package_id = self.nodes[node as usize].package_id;
        let dependency_slice = this.lockfile.packages.items_dependencies()[package_id as usize];
        let end = dependency_slice.off.saturating_add(dependency_slice.len);

        // Optional peers are not decided here; the hoister binds them to a
        // sibling when one is present. Every other edge — peers included — is
        // decided in the node's edge order, peers sorting last so the package's
        // own dependencies are placed before its peers look up-tree.
        //
        // The placement pass takes the bound edges; the decide pass takes the
        // unbound edges the lockfile has not settled.
        // A node the decide pass created has not placed its bound subtree;
        // place it here so unresolved edges deeper inside are reached.
        let place_bound = self.pass == Pass::PlaceBound || !self.nodes[node as usize].bound_placed;
        self.nodes[node as usize].bound_placed = true;

        let mut edges: Vec<DependencyID> = Vec::with_capacity(dependency_slice.len as usize);
        {
            let dependencies = this.lockfile.buffers.dependencies.as_slice();
            let resolutions = this.lockfile.buffers.resolutions.as_slice();
            let packages_len = this.lockfile.packages.len();
            for dep_id in dependency_slice.off..end {
                let behavior = dependencies[dep_id as usize].behavior;
                if behavior.is_optional_peer() {
                    continue;
                }
                if !self.resolve_peers && behavior.is_peer() {
                    continue;
                }
                let bound = (resolutions[dep_id as usize] as usize) < packages_len;
                if bound {
                    if place_bound {
                        edges.push(dep_id);
                    }
                } else if self.pass == Pass::Decide && !this.edge_is_settled_unresolved(dep_id) {
                    edges.push(dep_id);
                }
            }
        }

        {
            let sorter = DepSorter {
                lockfile: &this.lockfile,
            };
            edges.sort_by(|&a, &b| sorter.cmp(a, b));
        }

        if self.pass == Pass::Decide && node == ROOT_NODE {
            edges.extend_from_slice(&self.extra_root_edges);
        }

        // In the decide pass, start the I/O for this node's edges: the
        // whole recorded tree is placed, so a name any slot up-tree already
        // satisfies is not requested at all.
        if self.pass == Pass::Decide {
            self.prefetch_node_deps(this, node, &edges);
        }

        let mut remaining_names: HashMap<PackageNameHash, u32> = HashMap::default();
        {
            let dependencies = this.lockfile.buffers.dependencies.as_slice();
            for &dep_id in &edges {
                *remaining_names
                    .entry(dependencies[dep_id as usize].name_hash)
                    .or_default() += 1;
            }
        }
        self.current = Some(NodeCursor {
            node,
            children_start: self.nodes.len(),
            remaining_names,
            edges,
            index: 0,
        });
        Ok(())
    }

    /// Fire manifest fetches / clones / downloads for the edges of a node
    /// the cursor is about to decide, skipping every edge a slot up-tree
    /// already satisfies. Bound and peer edges are skipped.
    fn prefetch_node_deps(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        edges: &[DependencyID],
    ) {
        for &dep_id in edges {
            if let Err(err) = self.prefetch_edge(this, node, dep_id) {
                // Starting the I/O for one edge failed; report it against that
                // dependency and leave the edge unresolved. The decision does
                // not repeat the attempt.
                log_dependency_error(this, dep_id, err);
                self.failed_edges.insert(dep_id, ());
            }
        }
    }

    fn prefetch_edge(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dep_id: DependencyID,
    ) -> Result<(), crate::Error> {
        {
            let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
            if dependency.behavior.is_peer() {
                return Ok(());
            }
            let (real_name, real_name_hash, version) =
                normalize_dependency_version(this, &dependency);
            match version.tag {
                dependency::version::Tag::Npm | dependency::version::Tag::DistTag => {
                    if version.tag == dependency::version::Tag::Npm {
                        if workspace_satisfies(this, real_name_hash, &version) {
                            return Ok(());
                        }
                        // A slot up-tree that already satisfies the range means the
                        // edge binds without a manifest.
                        let npm = version.npm();
                        if let Walk::Bound(_) = self.walk(
                            this,
                            node,
                            dependency.name_hash,
                            &EdgeMatch::NpmRange {
                                alias_target: if npm.is_alias { Some(npm.name) } else { None },
                                group: &npm.version,
                                name_hash: real_name_hash,
                            },
                        ) {
                            return Ok(());
                        }
                    }
                    prefetch_manifest(this, real_name, real_name_hash, &version, &dependency)?;
                }
                dependency::version::Tag::Git
                | dependency::version::Tag::Github
                | dependency::version::Tag::Tarball => {
                    let res = download_resolution(&version);
                    if this.lockfile.get_package_id(real_name_hash, &res).is_none() {
                        fire_download_task(this, &dependency, dep_id, &version, &res)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    // ── walking ────────────────────────────────────────────────────────────────

    /// Walk up-tree from `start` for the first slot named `folder_name_hash`.
    /// First match stops the walk, exactly as the runtime lookup does.
    fn walk(
        &self,
        this: &PackageManager,
        start: NodeId,
        folder_name_hash: PackageNameHash,
        edge: &EdgeMatch,
    ) -> Walk {
        let mut candidate: Option<NodeId> = None;
        let mut n = start;
        loop {
            let node = &self.nodes[n as usize];
            if let Some(&child) = node.slots.get(&folder_name_hash) {
                let occupant = self.nodes[child as usize].package_id;
                return match edge_matches(this, edge, occupant) {
                    Satisfies::Yes => Walk::Bound(occupant),
                    Satisfies::No => Walk::Conflict {
                        occupant,
                        same_kind: true,
                        candidate,
                    },
                    Satisfies::WrongKind => Walk::Conflict {
                        occupant,
                        same_kind: false,
                        candidate,
                    },
                };
            }
            candidate = Some(n);
            if n == ROOT_NODE {
                return Walk::Free { candidate: n };
            }
            n = node.parent;
        }
    }

    /// Attach `package_id` as a child of `at` under `folder_name_hash`, and
    /// queue the new node so its own edges get decided.
    fn place(
        &mut self,
        this: &mut PackageManager,
        at: NodeId,
        folder_name_hash: PackageNameHash,
        package_id: PackageID,
    ) -> Result<(), crate::Error> {
        // The package already sits at `at` or above it: a version-conflict
        // cycle (`a@1` needs `a@2` needs `a@1`) that no layout satisfies.
        // Bind without another node, as npm does.
        if self.ancestor_has_package(at, package_id) {
            return Ok(());
        }
        let id = self.push_node(at, package_id);
        self.nodes[at as usize].slots.insert(folder_name_hash, id);
        // Start the new node's manifest fetches now, ahead of the cursor
        // reaching it, so the whole frontier fetches in parallel. Only names
        // the owning node has yet to decide can still gain a slot above the
        // child; those wait for the owner to finish (see `step`).
        if self.pass == Pass::Decide {
            let edges: Vec<DependencyID> = self
                .decide_edges_of(this, id)
                .into_iter()
                .filter(|&dep_id| {
                    !self.owner_has_pending_name(
                        this.lockfile.buffers.dependencies[dep_id as usize].name_hash,
                    )
                })
                .collect();
            self.prefetch_node_deps(this, id, &edges);
        }
        Ok(())
    }

    /// Move the cursor past the edge just decided, dropping its name from
    /// the set that can still gain a slot above the owner's children.
    fn advance_cursor(&mut self, this: &PackageManager) {
        let cursor = self.current.as_mut().unwrap();
        let dep_id = cursor.edges[cursor.index];
        let name_hash = this.lockfile.buffers.dependencies[dep_id as usize].name_hash;
        if let Some(count) = cursor.remaining_names.get_mut(&name_hash) {
            *count -= 1;
            if *count == 0 {
                cursor.remaining_names.remove(&name_hash);
            }
        }
        cursor.index += 1;
    }

    /// Whether the owning (current) node has yet to decide an edge with this
    /// name. Such a name can still place a slot the current placement's
    /// children would walk up to, so their prefetch waits for the owner.
    fn owner_has_pending_name(&self, name_hash: PackageNameHash) -> bool {
        match &self.current {
            Some(cursor) => cursor.remaining_names.get(&name_hash).is_some(),
            None => false,
        }
    }

    fn push_node(&mut self, parent: NodeId, package_id: PackageID) -> NodeId {
        debug_assert!(
            !self.ancestor_has_package(parent, package_id),
            "cycle: package placed under itself"
        );
        let id = NodeId::try_from(self.nodes.len()).expect("tree node overflow");
        self.nodes.push(Node::new(parent, package_id));
        if self.package_first_node.get(&package_id).is_none() {
            self.package_first_node.insert(package_id, id);
        }
        // The placement pass walks placed nodes breadth-first through the
        // queue; the decide pass reaches new nodes by its sweep instead.
        if self.pass == Pass::PlaceBound {
            self.queue.push_back(id);
        }
        id
    }

    /// The edges of a node that the decide pass will decide: unbound,
    /// non-optional-peer, honoring the peer switch and the settled-hole rule.
    fn decide_edges_of(&self, this: &PackageManager, node: NodeId) -> Vec<DependencyID> {
        let package_id = self.nodes[node as usize].package_id;
        let dependency_slice = this.lockfile.packages.items_dependencies()[package_id as usize];
        let end = dependency_slice.off.saturating_add(dependency_slice.len);
        let dependencies = this.lockfile.buffers.dependencies.as_slice();
        let resolutions = this.lockfile.buffers.resolutions.as_slice();
        let packages_len = this.lockfile.packages.len();
        let mut edges = Vec::new();
        for dep_id in dependency_slice.off..end {
            let behavior = dependencies[dep_id as usize].behavior;
            if behavior.is_optional_peer() || (!self.resolve_peers && behavior.is_peer()) {
                continue;
            }
            let bound = (resolutions[dep_id as usize] as usize) < packages_len;
            if !bound && !this.edge_is_settled_unresolved(dep_id) {
                edges.push(dep_id);
            }
        }
        edges
    }

    /// A package that was resolved for an edge but has nowhere to go — its
    /// name is taken at the owner's own scope — still needs its dependency
    /// list decided. Give it a node with no slot (nothing can walk to it by
    /// name); the hoister reports the conflict itself later.
    fn place_detached_if_unplaced(&mut self, parent: NodeId, package_id: PackageID) {
        if self.package_first_node.get(&package_id).is_some()
            || self.ancestor_has_package(parent, package_id)
        {
            return;
        }
        self.push_node(parent, package_id);
    }

    /// Place a package for an edge given the walk's result: dedupe onto a
    /// satisfying slot, nest below a conflict, or take the highest free
    /// node. `floor` is the node that owns the edge.
    fn place_by_walk(
        &mut self,
        this: &mut PackageManager,
        walk: Walk,
        floor: NodeId,
        folder_name_hash: PackageNameHash,
        package_id: PackageID,
    ) -> Result<(), crate::Error> {
        match walk {
            Walk::Bound(_) => Ok(()),
            Walk::Free { candidate } => {
                self.place(this, candidate, folder_name_hash, package_id)?;
                Ok(())
            }
            Walk::Conflict { candidate, .. } => {
                let at = candidate.unwrap_or(floor);
                if self.nodes[at as usize]
                    .slots
                    .get(&folder_name_hash)
                    .is_some()
                {
                    // The name is taken at every scope down to the owner: no
                    // slot for this package. Its dependency list is still
                    // walked; the hoister reports the conflict.
                    self.place_detached_if_unplaced(at, package_id);
                    return Ok(());
                }
                self.place(this, at, folder_name_hash, package_id)?;
                Ok(())
            }
        }
    }

    // ── deciding ───────────────────────────────────────────────────────────────

    fn decide_edge(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dep_id: DependencyID,
    ) -> Result<EdgeStep, crate::Error> {
        // A wait target already computed for this edge is checked first, so a
        // wake is a cheap re-check rather than a re-derivation.
        let waiting = match &self.blocked {
            Some(wait) if wait.dep_id == dep_id => Some(wait.target),
            _ => None,
        };
        if let Some(target) = waiting {
            match target {
                WaitTarget::Task(task_id) => {
                    if let Some(&package_id) = this.resolved_task_packages.get(&task_id) {
                        return self.bind_downloaded(this, node, dep_id, package_id);
                    }
                    if this.network_task_has_failed(task_id) {
                        return Ok(EdgeStep::Done);
                    }
                    return Ok(EdgeStep::Blocked(WaitTarget::Task(task_id)));
                }
                WaitTarget::GitClone(clone_id) => {
                    if this.git_repositories.get(&clone_id).is_none() {
                        if this.network_task_has_failed(clone_id) {
                            return Ok(EdgeStep::Done);
                        }
                        return Ok(EdgeStep::Blocked(WaitTarget::GitClone(clone_id)));
                    }
                    // The clone finished; the full decision below now takes
                    // the checkout path.
                }
                WaitTarget::Manifest => {
                    // The manifest lookup below is a cache read.
                }
            }
        }

        let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
        let resolution = this.lockfile.buffers.resolutions[dep_id as usize];

        debug_assert!(!dependency.behavior.is_optional_peer());
        debug_assert!(!this.edge_is_settled_unresolved(dep_id));

        // Its I/O could not be started and the error was already reported.
        if self.failed_edges.get(&dep_id).is_some() {
            return Ok(EdgeStep::Done);
        }

        if (resolution as usize) < this.lockfile.packages.len() {
            // Bound — kept from the lockfile or decided at an earlier node of
            // the same package. Only placement remains.
            let is_peer = dependency.behavior.is_peer();
            let start = self.lookup_start(node, is_peer);
            let walk = self.walk(
                this,
                start,
                dependency.name_hash,
                &EdgeMatch::Exact {
                    package_id: resolution,
                },
            );
            self.place_by_walk(this, walk, node, dependency.name_hash, resolution)?;
            return Ok(EdgeStep::Done);
        }

        let (real_name, real_name_hash, version) = normalize_dependency_version(this, &dependency);

        match version.tag {
            dependency::version::Tag::Npm => self.decide_npm(
                this,
                node,
                &dependency,
                dep_id,
                real_name,
                real_name_hash,
                &version,
            ),
            dependency::version::Tag::DistTag => self.decide_dist_tag(
                this,
                node,
                &dependency,
                dep_id,
                real_name,
                real_name_hash,
                &version,
            ),
            dependency::version::Tag::Folder
            | dependency::version::Tag::Workspace
            | dependency::version::Tag::Symlink => self.decide_local(
                this,
                node,
                &dependency,
                dep_id,
                real_name,
                real_name_hash,
                &version,
            ),
            dependency::version::Tag::Git
            | dependency::version::Tag::Github
            | dependency::version::Tag::Tarball => {
                self.decide_download(this, node, &dependency, dep_id, real_name_hash, &version)
            }
            _ => Ok(EdgeStep::Done),
        }
    }

    fn lookup_start(&self, node: NodeId, is_peer: bool) -> NodeId {
        if is_peer && node != ROOT_NODE {
            self.parent(node)
        } else {
            node
        }
    }

    fn decide_npm(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dependency: &Dependency,
        dep_id: DependencyID,
        real_name: SemverString,
        real_name_hash: PackageNameHash,
        version: &dependency::Version,
    ) -> Result<EdgeStep, crate::Error> {
        let npm = version.npm();
        let is_peer = dependency.behavior.is_peer();
        // An edge `bun update` was asked to update resolves fresh from the
        // manifest: it ignores the version the tree already carries for it.
        let update_target = self.is_update_target(this, dep_id, dependency);
        let start = self.lookup_start(node, is_peer);
        let walk = self.walk(
            this,
            start,
            dependency.name_hash,
            &EdgeMatch::NpmRange {
                alias_target: if npm.is_alias { Some(npm.name) } else { None },
                group: &npm.version,
                name_hash: real_name_hash,
            },
        );

        match walk {
            Walk::Bound(package_id) if !update_target => {
                this.assign_resolution(dep_id, package_id);
                Ok(EdgeStep::Done)
            }
            Walk::Bound(_) => {
                // The slot carries the version being updated; resolve the
                // request fresh and let the hoister give it the top slot.
                match self.resolve_npm_package(
                    this,
                    dependency,
                    dep_id,
                    real_name,
                    real_name_hash,
                    version,
                    true,
                )? {
                    NpmResolve::Package(package_id) => {
                        this.assign_resolution(dep_id, package_id);
                        self.place_detached_if_unplaced(node, package_id);
                        Ok(EdgeStep::Done)
                    }
                    NpmResolve::Blocked(target) => Ok(EdgeStep::Blocked(target)),
                    NpmResolve::Unresolved => Ok(EdgeStep::Done),
                }
            }
            Walk::Conflict {
                occupant,
                same_kind: true,
                ..
            } if is_peer => {
                warn_incorrect_peer(this, occupant);
                this.assign_resolution(dep_id, occupant);
                Ok(EdgeStep::Done)
            }
            walk => {
                // The package is genuinely needed: resolve it from the
                // manifest, then place it where the walk said.
                match self.resolve_npm_package(
                    this,
                    dependency,
                    dep_id,
                    real_name,
                    real_name_hash,
                    version,
                    update_target,
                )? {
                    NpmResolve::Package(package_id) => {
                        this.assign_resolution(dep_id, package_id);
                        self.place_resolved(this, walk, node, dep_id, package_id)
                    }
                    NpmResolve::Blocked(target) => Ok(EdgeStep::Blocked(target)),
                    NpmResolve::Unresolved => Ok(EdgeStep::Done),
                }
            }
        }
    }

    fn place_resolved(
        &mut self,
        this: &mut PackageManager,
        walk: Walk,
        node: NodeId,
        dep_id: DependencyID,
        package_id: PackageID,
    ) -> Result<EdgeStep, crate::Error> {
        // `assign_resolution` back-fills empty git/tarball dependency names,
        // so the folder name is read from the buffer after binding.
        let folder_name_hash = this.lockfile.buffers.dependencies[dep_id as usize].name_hash;
        self.place_by_walk(this, walk, node, folder_name_hash, package_id)?;
        Ok(EdgeStep::Done)
    }

    fn resolve_npm_package(
        &mut self,
        this: &mut PackageManager,
        dependency: &Dependency,
        dep_id: DependencyID,
        real_name: SemverString,
        real_name_hash: PackageNameHash,
        version: &dependency::Version,
        update_target: bool,
    ) -> Result<NpmResolve, crate::Error> {
        let this_ptr: *mut PackageManager = this;

        // A registry package the lockfile already carries at a satisfying
        // version wins over a fresh version from the manifest, so an install
        // that must resolve one changed edge does not churn versions the
        // lockfile settled. Peers take the manifest's best version, and an
        // updated edge ignores what the tree carries.
        if !dependency.behavior.is_peer()
            && !update_target
            && version.tag == dependency::version::Tag::Npm
        {
            if let Some(package_id) = this
                .lockfile
                .get_present_satisfying_id(real_name_hash, &version.npm().version)
            {
                return Ok(NpmResolve::Package(package_id));
            }
        }

        let manifest = match load_manifest(this, real_name, real_name_hash, version, dependency)? {
            ManifestState::Ready(manifest) => manifest,
            ManifestState::Pending => return Ok(NpmResolve::Blocked(WaitTarget::Manifest)),
            ManifestState::Failed(err) => {
                if let Some(err) = err {
                    log_dependency_error(this, dep_id, err);
                }
                return Ok(NpmResolve::Unresolved);
            }
        };

        // reshaped for borrowck — `manifest` borrows `this.manifests`; the
        // package creation reborrows `this` `&mut` through `this_ptr`
        // (`from_npm` never touches `manifests`).
        let manifest_ref = bun_ptr::BackRef::new(manifest);

        let find = match find_npm_version(
            // SAFETY: `this_ptr` is the live exclusive `this` borrow.
            unsafe { &mut *this_ptr },
            self.is_synthetic_edge(dep_id),
            dependency,
            dep_id,
            real_name,
            real_name_hash,
            version,
            manifest_ref.get(),
        )? {
            Some(find) => find,
            None => return Ok(NpmResolve::Unresolved),
        };

        let find_result = match find {
            NpmFind::Workspace(package_id) => return Ok(NpmResolve::Package(package_id)),
            NpmFind::Version(find_result) => find_result,
        };

        let result = create_npm_package(
            // SAFETY: see `this_ptr` note above.
            unsafe { &mut *this_ptr },
            real_name,
            real_name_hash,
            dependency,
            dep_id,
            manifest_ref.get(),
            find_result,
        )?;
        // SAFETY: see `this_ptr` note above.
        schedule_package_task(unsafe { &mut *this_ptr }, &result)?;
        // SAFETY: see `this_ptr` note above.
        log_resolved(unsafe { &mut *this_ptr }, &result, version);
        Ok(NpmResolve::Package(result.package.meta.id))
    }

    fn decide_dist_tag(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dependency: &Dependency,
        dep_id: DependencyID,
        real_name: SemverString,
        real_name_hash: PackageNameHash,
        version: &dependency::Version,
    ) -> Result<EdgeStep, crate::Error> {
        // A dist-tag peer whose parent scope already holds a same-named npm
        // package binds to it — silently if it is the tagged version, with
        // a warning otherwise — creating and downloading nothing.
        if dependency.behavior.is_peer() {
            let start = self.lookup_start(node, true);
            if let Walk::Conflict {
                occupant,
                same_kind: true,
                ..
            } = self.walk(this, start, dependency.name_hash, &EdgeMatch::AnyNpm)
            {
                let tagged =
                    match tagged_version(this, real_name, real_name_hash, version, dependency)? {
                        TaggedVersion::Version(version) => Some(version),
                        TaggedVersion::Pending => {
                            return Ok(EdgeStep::Blocked(WaitTarget::Manifest));
                        }
                        TaggedVersion::Unknown => None,
                    };
                let occupant_version = this.lockfile.packages.items_resolution()[occupant as usize]
                    .npm()
                    .version;
                let matches = match tagged {
                    Some(tag_version) => {
                        let buf = this.lockfile.buffers.string_bytes.as_slice();
                        tag_version.order(occupant_version, buf, buf).is_eq()
                    }
                    None => false,
                };
                if !matches {
                    warn_incorrect_peer(this, occupant);
                }
                this.assign_resolution(dep_id, occupant);
                return Ok(EdgeStep::Done);
            }
        }

        // A tag names a concrete version; resolve it first, then the edge
        // behaves like an exact edge. (A tag is never satisfied by a present
        // range match, so only the update-target flag matters here.)
        let update_target = self.is_update_target(this, dep_id, dependency);
        let package_id = match self.resolve_npm_package(
            this,
            dependency,
            dep_id,
            real_name,
            real_name_hash,
            version,
            update_target,
        )? {
            NpmResolve::Package(package_id) => package_id,
            NpmResolve::Blocked(target) => return Ok(EdgeStep::Blocked(target)),
            NpmResolve::Unresolved => return Ok(EdgeStep::Done),
        };
        self.bind_resolved(this, node, dependency, dep_id, package_id)
    }

    fn decide_local(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dependency: &Dependency,
        dep_id: DependencyID,
        real_name: SemverString,
        real_name_hash: PackageNameHash,
        version: &dependency::Version,
    ) -> Result<EdgeStep, crate::Error> {
        match resolve_local_package(this, real_name, real_name_hash, dependency, dep_id, version) {
            Ok(Some((package_id, is_first_time))) => {
                if is_first_time {
                    log_resolved_package(this, package_id, version);
                    // A folder/workspace/link package parsed for the first time
                    // this session has a fresh dependency list even when it
                    // replaced a lockfile entry; a node already built from the
                    // old list walks it again.
                    if let Some(&existing) = self.package_first_node.get(&package_id) {
                        self.queue.push_back(existing);
                    }
                }
                self.bind_resolved(this, node, dependency, dep_id, package_id)
            }
            Ok(None) => {
                log_local_not_found(this, real_name, dependency, version);
                Ok(EdgeStep::Done)
            }
            Err(crate::Error::MissingPackageJSON) => {
                // A missing `file:` target reports its package.json; a missing
                // workspace or `link:` target reports itself as not found /
                // not linked.
                if version.tag == dependency::version::Tag::Folder {
                    log_resolve_error(
                        this,
                        node == ROOT_NODE,
                        dependency,
                        dep_id,
                        real_name,
                        version,
                        crate::Error::MissingPackageJSON,
                    );
                } else {
                    log_local_not_found(this, real_name, dependency, version);
                }
                Ok(EdgeStep::Done)
            }
            Err(err) => Err(err),
        }
    }

    /// Bind an edge to a concrete package and place it with the exact-package
    /// walk (dedupe onto the same package up-tree, or nest below a conflict).
    fn bind_resolved(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dependency: &Dependency,
        dep_id: DependencyID,
        package_id: PackageID,
    ) -> Result<EdgeStep, crate::Error> {
        this.assign_resolution(dep_id, package_id);
        let is_peer = dependency.behavior.is_peer();
        let start = self.lookup_start(node, is_peer);
        let folder_name_hash = this.lockfile.buffers.dependencies[dep_id as usize].name_hash;
        let walk = self.walk(
            this,
            start,
            folder_name_hash,
            &EdgeMatch::Exact { package_id },
        );
        // A peer whose parent scope already holds a different same-kind
        // package binds to it with a warning rather than installing a second
        // copy — the same policy range peers get in `decide_npm`.
        if is_peer {
            if let Walk::Conflict {
                occupant,
                same_kind: true,
                ..
            } = walk
            {
                warn_incorrect_peer(this, occupant);
                this.assign_resolution(dep_id, occupant);
                return Ok(EdgeStep::Done);
            }
        }
        self.place_resolved(this, walk, node, dep_id, package_id)
    }

    fn decide_download(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dependency: &Dependency,
        dep_id: DependencyID,
        real_name_hash: PackageNameHash,
        version: &dependency::Version,
    ) -> Result<EdgeStep, crate::Error> {
        let res: Resolution = download_resolution(version);

        // Already resolved this session or loaded from the lockfile?
        if let Some(package_id) = this.lockfile.get_package_id(real_name_hash, &res) {
            return self.bind_downloaded(this, node, dep_id, package_id);
        }

        match fire_download_task(this, dependency, dep_id, version, &res)? {
            DownloadStep::Package(package_id) => {
                self.bind_downloaded(this, node, dep_id, package_id)
            }
            DownloadStep::Wait(target) => Ok(EdgeStep::Blocked(target)),
            DownloadStep::Failed => Ok(EdgeStep::Done),
        }
    }

    /// Bind an edge to a package produced by an extraction/checkout, filling
    /// the dependency's name/resolved fields from the package, then place it.
    fn bind_downloaded(
        &mut self,
        this: &mut PackageManager,
        node: NodeId,
        dep_id: DependencyID,
        package_id: PackageID,
    ) -> Result<EdgeStep, crate::Error> {
        {
            let (name, resolved) = {
                let pkg = this.lockfile.packages.get(package_id as usize);
                let resolved = match pkg.resolution.tag {
                    // `git` and `github` share the `Repository` payload.
                    ResolutionTag::Git | ResolutionTag::Github => {
                        Some(pkg.resolution.repository().resolved)
                    }
                    _ => None,
                };
                (pkg.name, resolved)
            };
            let version = &mut this.lockfile.buffers.dependencies[dep_id as usize].version;
            match version.tag {
                dependency::version::Tag::Git => {
                    let repo = version.git_mut();
                    repo.package_name = name;
                    if let Some(resolved) = resolved {
                        repo.resolved = resolved;
                    }
                }
                dependency::version::Tag::Github => {
                    let repo = version.github_mut();
                    repo.package_name = name;
                    if let Some(resolved) = resolved {
                        repo.resolved = resolved;
                    }
                }
                dependency::version::Tag::Tarball => {
                    version.tarball_mut().package_name = name;
                }
                _ => {}
            }
        }

        this.assign_resolution(dep_id, package_id);
        let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
        let is_peer = dependency.behavior.is_peer();
        let start = self.lookup_start(node, is_peer);
        let walk = self.walk(
            this,
            start,
            dependency.name_hash,
            &EdgeMatch::Exact { package_id },
        );
        self.place_resolved(this, walk, node, dep_id, package_id)
    }
}

enum NpmResolve {
    Package(PackageID),
    Blocked(WaitTarget),
    /// A resolution error was logged (no matching version, tag not found,
    /// too recent, missing manifest). The edge stays unbound.
    Unresolved,
}

enum DownloadStep {
    Package(PackageID),
    Wait(WaitTarget),
    Failed,
}

fn download_resolution(version: &dependency::Version) -> Resolution {
    match version.tag {
        dependency::version::Tag::Git => Resolution::init(ResolutionTagged::Git(*version.git())),
        dependency::version::Tag::Github => {
            Resolution::init(ResolutionTagged::Github(*version.github()))
        }
        dependency::version::Tag::Tarball => match &version.tarball().uri {
            dependency::tarball::Uri::Local(path) => {
                Resolution::init(ResolutionTagged::LocalTarball(*path))
            }
            dependency::tarball::Uri::Remote(url) => {
                Resolution::init(ResolutionTagged::RemoteTarball(*url))
            }
        },
        _ => unreachable!(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Slot matching
// ──────────────────────────────────────────────────────────────────────────

fn edge_matches(this: &PackageManager, edge: &EdgeMatch, occupant: PackageID) -> Satisfies {
    match edge {
        EdgeMatch::AnyNpm => {
            if this.lockfile.packages.items_resolution()[occupant as usize].tag
                == ResolutionTag::Npm
            {
                Satisfies::No
            } else {
                Satisfies::WrongKind
            }
        }
        EdgeMatch::Exact { package_id } => {
            if *package_id == occupant {
                Satisfies::Yes
            } else if this.lockfile.packages.items_resolution()[occupant as usize].tag
                == this.lockfile.packages.items_resolution()[*package_id as usize].tag
            {
                Satisfies::No
            } else {
                Satisfies::WrongKind
            }
        }
        EdgeMatch::NpmRange {
            alias_target,
            group,
            name_hash,
        } => {
            let string_buf = this.lockfile.buffers.string_bytes.as_slice();
            let resolution = &this.lockfile.packages.items_resolution()[occupant as usize];
            match resolution.tag {
                ResolutionTag::Npm => {
                    if let Some(target) = alias_target {
                        let occupant_name = this.lockfile.packages.items_name()[occupant as usize];
                        if !strings::eql_long(
                            occupant_name.slice(string_buf),
                            target.slice(string_buf),
                            true,
                        ) {
                            return Satisfies::WrongKind;
                        }
                    }
                    if group.satisfies(resolution.npm().version, string_buf, string_buf) {
                        Satisfies::Yes
                    } else {
                        Satisfies::No
                    }
                }
                ResolutionTag::Workspace => {
                    if alias_target.is_some() || !this.options.link_workspace_packages {
                        return Satisfies::WrongKind;
                    }
                    if this.lockfile.packages.items_name_hash()[occupant as usize] != *name_hash {
                        return Satisfies::WrongKind;
                    }
                    let satisfied = match this.lockfile.workspace_versions.get(name_hash) {
                        Some(workspace_version) => {
                            group.satisfies(*workspace_version, string_buf, string_buf)
                                || group.is_star()
                        }
                        None => group.is_star(),
                    };
                    if satisfied {
                        Satisfies::Yes
                    } else {
                        Satisfies::WrongKind
                    }
                }
                _ => Satisfies::WrongKind,
            }
        }
    }
}

/// Whether a workspace's declared version satisfies the range (or a
/// versionless workspace matches `*`), so the edge links the workspace package
/// instead of a registry version. Read from the workspace tables, which are
/// populated at parse time — before any edge is decided.
fn workspace_satisfies(
    this: &PackageManager,
    name_hash: PackageNameHash,
    version: &dependency::Version,
) -> bool {
    if !this.options.link_workspace_packages {
        return false;
    }
    let workspace_path = if this.lockfile.workspace_paths.count() > 0 {
        this.lockfile.workspace_paths.get(&name_hash)
    } else {
        None
    };
    let workspace_version = this.lockfile.workspace_versions.get(&name_hash);
    let buf = this.lockfile.buffers.string_bytes.as_slice();
    let group = &version.npm().version;

    (workspace_version.is_some()
        && group.satisfies(*workspace_version.unwrap(), buf, buf))
        // A versionless workspace still links for a wildcard range.
        // https://github.com/oven-sh/bun/pull/10899#issuecomment-2099609419
        || (workspace_path.is_some() && group.is_star())
}

/// The root's resolved workspace edge for `name_hash`, if placed.
fn workspace_package_id(this: &PackageManager, name_hash: PackageNameHash) -> Option<PackageID> {
    let root_package = this.lockfile.root_package()?;
    let root_dependencies = root_package
        .dependencies
        .get(this.lockfile.buffers.dependencies.as_slice());
    let root_resolutions = root_package
        .resolutions
        .get(this.lockfile.buffers.resolutions.as_slice());
    debug_assert_eq!(root_dependencies.len(), root_resolutions.len());
    for (root_dep, &package_id) in root_dependencies.iter().zip(root_resolutions) {
        if package_id != invalid_package_id
            && root_dep.version.tag == dependency::version::Tag::Workspace
            && root_dep.name_hash == name_hash
        {
            return Some(package_id);
        }
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// Version normalization (overrides, catalogs, real names)
// ──────────────────────────────────────────────────────────────────────────

/// Applies overrides and catalogs, and computes the real (registry) name of
/// the edge. The dependency's own `name_hash` remains the folder-name key.
fn normalize_dependency_version(
    this: &PackageManager,
    dependency: &Dependency,
) -> (SemverString, PackageNameHash, dependency::Version) {
    let mut name = dependency.realname();
    let mut name_hash = match dependency.version.tag {
        dependency::version::Tag::DistTag
        | dependency::version::Tag::Git
        | dependency::version::Tag::Github
        | dependency::version::Tag::Npm
        | dependency::version::Tag::Tarball
        | dependency::version::Tag::Workspace => {
            Semver::string::Builder::string_hash(this.lockfile.str(&name))
        }
        _ => dependency.name_hash,
    };

    let version: dependency::Version = 'version: {
        // Overrides apply to all dependencies except `npm:` aliases and
        // workspace edges.
        if !dependency.behavior.is_workspace()
            && (dependency.version.tag != dependency::version::Tag::Npm
                || !dependency.version.npm().is_alias)
        {
            if let Some(new) = this.lockfile.overrides.get(name_hash) {
                bun_output::scoped_log!(
                    PackageManager,
                    "override: {} -> {}",
                    bstr::BStr::new(this.lockfile.str(&dependency.version.literal)),
                    bstr::BStr::new(this.lockfile.str(&new.literal))
                );

                (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                    &this.lockfile,
                    name,
                    name_hash,
                    &new,
                );

                if new.tag == dependency::version::Tag::Catalog {
                    if let Some(catalog_dep) =
                        this.lockfile
                            .catalogs
                            .get(&this.lockfile, *new.catalog(), name)
                    {
                        let v = catalog_dep.version;
                        (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                            &this.lockfile,
                            name,
                            name_hash,
                            &v,
                        );
                        break 'version v;
                    }
                }

                break 'version new;
            }

            if dependency.version.tag == dependency::version::Tag::Catalog {
                if let Some(catalog_dep) =
                    this.lockfile
                        .catalogs
                        .get(&this.lockfile, *dependency.version.catalog(), name)
                {
                    let v = catalog_dep.version;
                    (name, name_hash) = update_name_and_name_hash_from_version_replacement(
                        &this.lockfile,
                        name,
                        name_hash,
                        &v,
                    );
                    break 'version v;
                }
            }
        }

        break 'version dependency.version.clone();
    };

    (name, name_hash, version)
}

fn update_name_and_name_hash_from_version_replacement(
    lockfile: &crate::lockfile_real::Lockfile,
    original_name: SemverString,
    original_name_hash: PackageNameHash,
    new_version: &dependency::Version,
) -> (SemverString, PackageNameHash) {
    match new_version.tag {
        // git/github/tarball packages have no name until extracted
        dependency::version::Tag::DistTag => (
            new_version.dist_tag().name,
            Semver::string::Builder::string_hash(lockfile.str(&new_version.dist_tag().name)),
        ),
        dependency::version::Tag::Npm => (
            new_version.npm().name,
            Semver::string::Builder::string_hash(lockfile.str(&new_version.npm().name)),
        ),
        dependency::version::Tag::Git => (new_version.git().package_name, original_name_hash),
        dependency::version::Tag::Github => (new_version.github().package_name, original_name_hash),
        dependency::version::Tag::Tarball => {
            (new_version.tarball().package_name, original_name_hash)
        }
        _ => (original_name, original_name_hash),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Manifests
// ──────────────────────────────────────────────────────────────────────────

enum ManifestState<'a> {
    Ready(&'a Npm::PackageManifest),
    Pending,
    /// The fetch failed. `Some(err)` when the fetch could not be started
    /// and the error is to be reported against this dependency; `None` when
    /// the failure was already reported.
    Failed(Option<crate::Error>),
}

/// Look up the manifest for `real_name`; if it is not usable yet, make sure a
/// fetch is in flight and report `Pending`.
/// The manifest cache's answer for a name: the cached manifest if any, and
/// whether it can be used without a fetch — fresh under cache-control,
/// already holding an exact requested version, or the result of a fetch that
/// finished this session (the freshness rule decides whether to fetch, never
/// to refetch). An unusable manifest still seeds a revalidating fetch.
struct CachedManifest<'a> {
    manifest: Option<&'a Npm::PackageManifest>,
    usable: bool,
}

fn cached_manifest<'a>(
    this: &'a mut PackageManager,
    name_str: &[u8],
    real_name_hash: PackageNameHash,
    version: &dependency::Version,
) -> CachedManifest<'a> {
    let cache_ctx = this.manifest_disk_cache_ctx();
    let needs_extended_manifest = this.options.minimum_release_age_ms.is_some();
    let manifest_cache_control = this.options.enable.manifest_cache_control();
    let fetched_this_session = this
        .finished_manifest_fetches
        .get(&real_name_hash)
        .is_some();
    let this_ptr: *mut PackageManager = this;

    let mut expired = false;
    // SAFETY: `this_ptr` is the live exclusive borrow; `options` and
    // `manifests` are disjoint fields.
    let scope: *const crate::npm::registry::Scope =
        unsafe { &(*this_ptr).options }.scope_for_package_name(name_str);
    // SAFETY: `manifests` projected from `this_ptr`; `cache_ctx` was
    // snapshotted before `this_ptr`.
    let Some(manifest) = (unsafe {
        (*this_ptr).manifests.by_name_hash_allow_expired(
            cache_ctx,
            &*scope,
            real_name_hash,
            Some(&mut expired),
            ManifestLoad::LoadFromMemoryFallbackToDisk,
            needs_extended_manifest,
        )
    }) else {
        return CachedManifest {
            manifest: None,
            usable: false,
        };
    };

    let fresh = manifest_cache_control && !expired;
    let exact_hit = version.tag == dependency::version::Tag::Npm
        && version.npm().version.is_exact()
        && manifest
            .find_by_version(version.npm().version.head.head.range.left.version)
            .is_some();
    // SAFETY: `manifest` borrows the `manifests` field of `*this_ptr`,
    // disjoint from every field the caller mutates while it is alive
    // (`lockfile`, task queues).
    let manifest: &'a Npm::PackageManifest =
        unsafe { &*std::ptr::from_ref::<Npm::PackageManifest>(manifest) };
    CachedManifest {
        manifest: Some(manifest),
        usable: fetched_this_session || fresh || exact_hit,
    }
}

fn load_manifest<'a>(
    this: &'a mut PackageManager,
    real_name: SemverString,
    real_name_hash: PackageNameHash,
    version: &dependency::Version,
    dependency: &Dependency,
) -> Result<ManifestState<'a>, crate::Error> {
    let this_ptr: *mut PackageManager = this;
    // SAFETY: `string_bytes` is not resized before `name_str` is copied into
    // owned storage below.
    let name_str: Vec<u8> = this.lockfile.str(&real_name).to_vec();

    // SAFETY: `this_ptr` is the live exclusive `this` borrow.
    let cached = cached_manifest(
        unsafe { &mut *this_ptr },
        &name_str,
        real_name_hash,
        version,
    );
    if cached.usable {
        return Ok(ManifestState::Ready(cached.manifest.expect("usable")));
    }
    // A stale copy seeds the fetch; keep only its address so the clone
    // happens after the dedupe check inside `fire_manifest_fetch`, on the
    // path that actually fires.
    let stale: Option<*const Npm::PackageManifest> = cached.manifest.map(std::ptr::from_ref);

    if let Some(&failure) = this.failed_manifests.get(&real_name_hash) {
        return Ok(match failure {
            crate::package_manager_real::ManifestFailure::Fire(err) => {
                ManifestState::Failed(Some(err))
            }
            crate::package_manager_real::ManifestFailure::Reported => ManifestState::Failed(None),
        });
    }

    // `fire_manifest_fetch` dedupes an in-flight fetch and OR-upgrades its
    // required bit for this dependency, so a task an optional edge created
    // becomes required once a required edge waits on it.
    fire_manifest_fetch(
        this,
        &name_str,
        real_name_hash,
        // SAFETY: `stale` points into `this.manifests`, which the fetch
        // path does not mutate before this copy is taken.
        move || stale.map(|manifest| unsafe { (*manifest).clone() }),
        dependency.behavior.is_required(),
        dependency.behavior.is_optional(),
    )?;

    // The fetch may have failed to start (an unusable registry URL).
    if let Some(&crate::package_manager_real::ManifestFailure::Fire(err)) =
        this.failed_manifests.get(&real_name_hash)
    {
        return Ok(ManifestState::Failed(Some(err)));
    }
    Ok(ManifestState::Pending)
}

/// Start a manifest fetch for `name` unless one was already created this
/// session. A fetch that cannot be started (unusable registry URL) is
/// recorded in `failed_manifests` with its error, for each dependency that
/// needs the manifest to report against itself.
fn fire_manifest_fetch(
    this: &mut PackageManager,
    name: &[u8],
    name_hash: PackageNameHash,
    // Produces the cached manifest to seed the fetch. Called only when the
    // fetch actually fires, so a dedupe hit never pays for the manifest copy.
    seed_manifest: impl FnOnce() -> Option<Npm::PackageManifest>,
    is_required: bool,
    is_optional: bool,
) -> Result<(), crate::Error> {
    let task_id = Task::Id::for_manifest(name);
    // Dedupes an in-flight fetch and OR-upgrades its required bit.
    if this.has_created_network_task(task_id, is_required) {
        return Ok(());
    }
    let loaded_manifest = seed_manifest();

    if PackageManager::verbose_install() {
        bun_core::pretty_errorln!(
            "Enqueue package manifest for download: {}",
            bstr::BStr::new(name)
        );
    }

    let needs_extended_manifest = this.options.minimum_release_age_ms.is_some();
    let this_ptr: *mut PackageManager = this;
    let network_task = this.get_network_task();
    // SAFETY: `network_task` is the unique handle to a freshly-vended pool
    // slot; `write_init` resets every defaulted field.
    unsafe {
        NetworkTask::write_init(network_task, task_id, this_ptr, None);
    }

    let scope = this.scope_for_package_name(name);
    // SAFETY: `network_task` points to a valid, initialized NetworkTask slot.
    let fired = unsafe {
        (*network_task).for_manifest(
            name,
            scope,
            loaded_manifest.as_ref(),
            is_optional,
            needs_extended_manifest,
        )
    };
    match fired {
        Ok(()) => {
            enqueue_network_task(this, network_task);
        }
        Err(err) => {
            // SAFETY: `network_task` is the pool slot vended above and was
            // never scheduled; return it to the pool.
            unsafe { (*this_ptr).preallocated_network_tasks.put(network_task) };
            this.failed_manifests.insert(
                name_hash,
                crate::package_manager_real::ManifestFailure::Fire(err.into()),
            );
        }
    }
    Ok(())
}

fn prefetch_manifest(
    this: &mut PackageManager,
    real_name: SemverString,
    real_name_hash: PackageNameHash,
    version: &dependency::Version,
    dependency: &Dependency,
) -> Result<(), crate::Error> {
    let this_ptr: *mut PackageManager = this;
    let name_str: Vec<u8> = this.lockfile.str(&real_name).to_vec();

    // SAFETY: `this_ptr` is the live exclusive `this` borrow.
    let cached = cached_manifest(
        unsafe { &mut *this_ptr },
        &name_str,
        real_name_hash,
        version,
    );
    if cached.usable {
        return Ok(());
    }
    let stale: Option<*const Npm::PackageManifest> = cached.manifest.map(std::ptr::from_ref);

    fire_manifest_fetch(
        this,
        &name_str,
        real_name_hash,
        // SAFETY: `stale` points into `this.manifests`, which the fetch
        // path does not mutate before this copy is taken.
        move || stale.map(|manifest| unsafe { (*manifest).clone() }),
        dependency.behavior.is_required(),
        dependency.behavior.is_optional(),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Version selection and package creation (registry)
// ──────────────────────────────────────────────────────────────────────────

enum TaggedVersion {
    Version(Semver::Version),
    Pending,
    /// The manifest failed or does not carry the tag; no version to compare.
    Unknown,
}

/// The version a dist-tag names, read from the manifest. Nothing is created.
fn tagged_version(
    this: &mut PackageManager,
    real_name: SemverString,
    real_name_hash: PackageNameHash,
    version: &dependency::Version,
    dependency: &Dependency,
) -> Result<TaggedVersion, crate::Error> {
    // The tag string lives in the lockfile's buffer; copy it out before the
    // manifest lookup borrows the manager.
    let tag: Vec<u8> = this.lockfile.str(&version.dist_tag().tag).to_vec();
    // Same filter the resolver applies (`minimumReleaseAge` / excludes), so
    // the peer is compared against the version that would be installed.
    let min_age = this.options.minimum_release_age_ms;
    let excludes = this.options.minimum_release_age_excludes;
    let manifest = match load_manifest(this, real_name, real_name_hash, version, dependency)? {
        ManifestState::Ready(manifest) => manifest,
        ManifestState::Pending => return Ok(TaggedVersion::Pending),
        ManifestState::Failed(_) => return Ok(TaggedVersion::Unknown),
    };
    Ok(
        match manifest
            .find_by_dist_tag_with_filter(&tag, min_age, excludes)
            .unwrap()
        {
            Some(found) => TaggedVersion::Version(found.version),
            None => TaggedVersion::Unknown,
        },
    )
}

enum NpmFind<'a> {
    Version(Npm::FindResult<'a>),
    Workspace(PackageID),
}

/// Choose the version an npm/dist-tag edge resolves to from its manifest.
/// `Ok(None)` means a resolution error was reported and the edge stays
/// unbound.
fn find_npm_version<'a>(
    this: &mut PackageManager,
    is_synthetic_edge: bool,
    dependency: &Dependency,
    dep_id: DependencyID,
    name: SemverString,
    name_hash: PackageNameHash,
    version: &dependency::Version,
    manifest: &'a Npm::PackageManifest,
) -> Result<Option<NpmFind<'a>>, crate::Error> {
    let version_result: Npm::FindVersionResult = match version.tag {
        dependency::version::Tag::DistTag => manifest.find_by_dist_tag_with_filter(
            this.lockfile.str(&version.dist_tag().tag),
            this.options.minimum_release_age_ms,
            this.options.minimum_release_age_excludes,
        ),
        dependency::version::Tag::Npm => manifest.find_best_version_with_filter(
            &version.npm().version,
            this.lockfile.buffers.string_bytes.as_slice(),
            this.options.minimum_release_age_ms,
            this.options.minimum_release_age_excludes,
        ),
        _ => unreachable!(),
    };

    match version_result {
        Npm::FindVersionResult::Found(result) => Ok(Some(NpmFind::Version(result))),
        Npm::FindVersionResult::FoundWithFilter {
            result,
            newest_filtered,
        } => {
            if this.options.log_level.is_verbose() {
                if let Some(newest) = &newest_filtered {
                    let package_name = this.lockfile.str(&name);
                    let min_age_seconds =
                        this.options.minimum_release_age_ms.unwrap_or(0.0) / MS_PER_S;
                    let manifest_buf: &[u8] = &manifest.string_buf;
                    match version.tag {
                        dependency::version::Tag::DistTag => {
                            let tag_str = this.lockfile.str(&version.dist_tag().tag);
                            bun_core::pretty_errorln!(
                                "<d>[minimum-release-age]<r> <b>{}@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                bstr::BStr::new(package_name),
                                bstr::BStr::new(tag_str),
                                result.version.fmt(manifest_buf),
                                newest.fmt(manifest_buf),
                                min_age_seconds,
                            );
                        }
                        _ => {
                            let version_str = &version.npm().version.fmt(manifest_buf);
                            bun_core::pretty_errorln!(
                                "<d>[minimum-release-age]<r> <b>{}<r>@{}<r> selected <green>{}<r> instead of <yellow>{}<r> due to {}-second filter",
                                bstr::BStr::new(package_name),
                                version_str,
                                result.version.fmt(manifest_buf),
                                newest.fmt(manifest_buf),
                                min_age_seconds,
                            );
                        }
                    }
                }
            }
            Ok(Some(NpmFind::Version(result)))
        }
        Npm::FindVersionResult::Err(err_type) => match err_type {
            Npm::FindVersionError::TooRecent | Npm::FindVersionError::AllVersionsTooRecent => {
                log_resolve_error(
                    this,
                    is_synthetic_edge,
                    dependency,
                    dep_id,
                    name,
                    version,
                    crate::Error::TooRecentVersion,
                );
                Ok(None)
            }
            Npm::FindVersionError::NotFound => {
                // A dist tag that names no published version can still name
                // a workspace.
                if version.tag == dependency::version::Tag::DistTag
                    && this.lockfile.workspace_paths.count() > 0
                    && this.lockfile.workspace_paths.get(&name_hash).is_some()
                {
                    if let Some(package_id) = workspace_package_id(this, name_hash) {
                        return Ok(Some(NpmFind::Workspace(package_id)));
                    }
                }
                // A peer with no satisfying version simply stays unresolved.
                if dependency.behavior.is_peer() {
                    return Ok(None);
                }
                let err = match version.tag {
                    dependency::version::Tag::Npm => crate::Error::NoMatchingVersion,
                    dependency::version::Tag::DistTag => crate::Error::DistTagNotFound,
                    _ => unreachable!(),
                };
                log_resolve_error(
                    this,
                    is_synthetic_edge,
                    dependency,
                    dep_id,
                    name,
                    version,
                    err,
                );
                Ok(None)
            }
        },
    }
}

pub(crate) enum ResolvedPackageTask {
    /// Pending network task to schedule
    NetworkTask(*mut NetworkTask),

    /// Apply patch task or calc patch hash task
    PatchTask(*mut PatchTask),
}

pub(crate) struct ResolvedPackageResult {
    pub package: Package,

    /// Is this the first time we've seen this package?
    pub is_first_time: bool,

    pub task: Option<ResolvedPackageTask>,
}

/// Get the exact registry package `name@version`, creating it (and its
/// download or patch task) if it does not exist yet.
fn create_npm_package(
    this: &mut PackageManager,
    name: SemverString,
    name_hash: PackageNameHash,
    dependency: &Dependency,
    dependency_id: DependencyID,
    manifest: &Npm::PackageManifest,
    find_result: Npm::FindResult,
) -> Result<ResolvedPackageResult, crate::Error> {
    let resolution = Resolution::init(ResolutionTagged::Npm(ResolutionNpmValue {
        version: find_result.version,
        url: find_result.package.tarball_url.value,
    }));

    if let Some(id) = this.lockfile.get_package_id(name_hash, &resolution) {
        return Ok(ResolvedPackageResult {
            package: *this.lockfile.packages.get(id as usize),
            is_first_time: false,
            task: None,
        });
    }

    // appendPackage sets the PackageID on the package
    let log = this.log_mut();
    let new_package = Package::from_npm(
        &mut this.lockfile,
        log,
        manifest,
        find_result.version,
        find_result.package,
        Features::NPM,
    )?;
    let package = this.lockfile.append_package(&new_package)?;

    debug_assert!(package.meta.id != invalid_package_id);

    // non-null if the package is in "patchedDependencies"
    let mut name_and_version_hash: Option<u64> = None;
    let mut patchfile_hash: Option<u64> = None;

    let result = match determine_preinstall_state(
        this,
        &package,
        &mut name_and_version_hash,
        &mut patchfile_hash,
    ) {
        // Is this package already in the cache?
        // We don't need to download the tarball, but we should enqueue dependencies
        install::PreinstallState::Done => ResolvedPackageResult {
            package,
            is_first_time: true,
            task: None,
        },
        // Do we need to download the tarball?
        install::PreinstallState::Extract => 'extract: {
            // Skip tarball download when prefetch_resolved_tarballs is disabled (e.g., --lockfile-only)
            if !this
                .options
                .do_
                .contains(crate::package_manager_real::options::Do::PREFETCH_RESOLVED_TARBALLS)
            {
                break 'extract ResolvedPackageResult {
                    package,
                    is_first_time: true,
                    task: None,
                };
            }

            let task_id = Task::Id::for_npm_package(
                this.lockfile.str(&name),
                package.resolution.npm().version,
            );
            debug_assert!(!this.network_dedupe_map.contains(&task_id));

            let network_task = match run_tasks::generate_network_task_for_tarball(
                this,
                task_id,
                manifest.str(&find_result.package.tarball_url),
                dependency.behavior.is_required(),
                dependency_id,
                &package,
                name_and_version_hash,
                crate::network_task::Authorization::AllowAuthorization,
            ) {
                Ok(task) => task.expect("unreachable"),
                // The dedupe entry exists before the task is built; a build
                // error must mark it failed so a later edge on the same
                // tarball fails fast instead of waiting on it.
                Err(err) => {
                    this.mark_network_task_failed(task_id);
                    return Err(err.into());
                }
            };

            ResolvedPackageResult {
                package,
                is_first_time: true,
                task: Some(ResolvedPackageTask::NetworkTask(network_task)),
            }
        }
        install::PreinstallState::CalcPatchHash => ResolvedPackageResult {
            package,
            is_first_time: true,
            task: Some(ResolvedPackageTask::PatchTask(
                PatchTask::new_calc_patch_hash(
                    this,
                    name_and_version_hash.unwrap(),
                    Some(EnqueueAfterState {
                        pkg_id: package.meta.id,
                        dependency_id,
                        url: Box::<[u8]>::from(manifest.str(&find_result.package.tarball_url)),
                    }),
                ),
            )),
        },
        install::PreinstallState::ApplyPatch => ResolvedPackageResult {
            package,
            is_first_time: true,
            task: Some(ResolvedPackageTask::PatchTask(
                PatchTask::new_apply_patch_hash(
                    this,
                    package.meta.id,
                    patchfile_hash.unwrap(),
                    name_and_version_hash.unwrap(),
                ),
            )),
        },
        _ => unreachable!(),
    };

    Ok(result)
}

/// Start the download or patch task produced when a new registry package was
/// created.
fn schedule_package_task(
    this: &mut PackageManager,
    result: &ResolvedPackageResult,
) -> Result<(), crate::Error> {
    let Some(task) = &result.task else {
        return Ok(());
    };
    match *task {
        ResolvedPackageTask::NetworkTask(network_task) => {
            if get_preinstall_state(this, result.package.meta.id)
                == install::PreinstallState::Extract
            {
                set_preinstall_state(
                    this,
                    result.package.meta.id,
                    install::PreinstallState::Extracting,
                );
                enqueue_network_task(this, network_task);
            }
        }
        ResolvedPackageTask::PatchTask(patch_task) => {
            // SAFETY: `patch_task` is a non-null `heap::alloc`.
            let cb = unsafe { &(*patch_task).callback };
            if cb.is_calc_hash()
                && get_preinstall_state(this, result.package.meta.id)
                    == install::PreinstallState::CalcPatchHash
            {
                set_preinstall_state(
                    this,
                    result.package.meta.id,
                    install::PreinstallState::CalcingPatchHash,
                );
                // SAFETY: `patch_task` is a non-null `heap::alloc`.
                unsafe { enqueue_patch_task(this, patch_task) };
            } else if cb.is_apply()
                && get_preinstall_state(this, result.package.meta.id)
                    == install::PreinstallState::ApplyPatch
            {
                set_preinstall_state(
                    this,
                    result.package.meta.id,
                    install::PreinstallState::ApplyingPatch,
                );
                // SAFETY: `patch_task` is a non-null `heap::alloc`.
                unsafe { enqueue_patch_task(this, patch_task) };
            }
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// Local (folder / workspace / link) resolution
// ──────────────────────────────────────────────────────────────────────────

/// Resolve a `file:`, `workspace:` or `link:` edge to its package.
/// `Ok(Some((id, is_first_time)))` on success; `Ok(None)` when the
/// workspace / link does not exist.
fn resolve_local_package(
    this: &mut PackageManager,
    name: SemverString,
    name_hash: PackageNameHash,
    dependency: &Dependency,
    dependency_id: DependencyID,
    version: &dependency::Version,
) -> Result<Option<(PackageID, bool)>, crate::Error> {
    let res = match version.tag {
        dependency::version::Tag::Folder => {
            let folder = *version.folder();
            'res: {
                if this.lockfile.is_workspace_dependency(dependency_id) {
                    // relative to cwd
                    // SAFETY: `get_or_put` copies `folder_path_abs` into the
                    // lockfile string buffer before any other mutation.
                    let folder_path = this.lockfile.str_detached(&folder);
                    let mut buf2 = PathBuffer::uninit();
                    let folder_path_abs = if bun_paths::is_absolute(folder_path) {
                        folder_path
                    } else {
                        Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
                            FileSystem::instance().top_level_dir(),
                            &mut buf2,
                            &[folder_path],
                        )
                    };

                    break 'res FolderResolution::get_or_put(
                        GlobalOrRelative::Relative(dependency::version::Tag::Folder),
                        version,
                        folder_path_abs,
                        this,
                    );
                }

                // transitive folder dependencies do not have their dependencies resolved
                if crate::bin::bin_target_escapes_package_dir(this.lockfile.str(&folder)) {
                    // overrides/resolutions are only ever parsed from the root
                    // package.json, so a folder path that reached here via an
                    // override was written by the user and is trusted the same
                    // as a direct dependency of the root.
                    let buf = this.lockfile.buffers.string_bytes.as_slice();
                    if !this.lockfile.overrides.contains_name(
                        dependency.name_hash,
                        dependency.name.slice(buf),
                        buf,
                    ) {
                        break 'res FolderResolutionValue::Err(crate::Error::MissingPackageJSON);
                    }
                }

                let mut package = Package::default();

                {
                    // only need name and path
                    // copy the two slices out of `string_bytes` before
                    // creating the builder — `StringBuilder::allocate` may
                    // grow the buffer and invalidate borrows into it.
                    let name_slice: Vec<u8> = this.lockfile.str(&name).to_vec();
                    let folder_path: Vec<u8> = this.lockfile.str(&folder).to_vec();
                    let mut builder = this.lockfile.string_builder();

                    builder.count(&name_slice);
                    builder.count(&folder_path);

                    builder.allocate().unwrap_or_oom();

                    package.name = builder.append::<SemverString>(&name_slice);
                    package.name_hash = name_hash;

                    package.resolution = Resolution::init(ResolutionTagged::Folder(
                        builder.append::<SemverString>(&folder_path),
                    ));

                    package.scripts.filled = true;
                    package.meta.set_has_install_script(false);

                    builder.clamp();
                }

                // these are always new
                package = this.lockfile.append_package(&package).unwrap_or_oom();

                FolderResolutionValue::NewPackageId(package.meta.id)
            }
        }
        dependency::version::Tag::Workspace => {
            // package name hash should be used to find workspace path from map
            let workspace_path_raw: SemverString = this
                .lockfile
                .workspace_paths
                .get(&name_hash)
                .copied()
                .unwrap_or_else(|| *version.workspace());
            // SAFETY: `get_or_put` copies `workspace_path_u8` into the
            // lockfile string buffer before any other mutation.
            let workspace_path = this.lockfile.str_detached(&workspace_path_raw);
            let mut buf2 = PathBuffer::uninit();
            let workspace_path_u8 = if bun_paths::is_absolute(workspace_path) {
                workspace_path
            } else {
                Path::resolve_path::join_abs_string_buf::<Path::platform::Auto>(
                    FileSystem::instance().top_level_dir(),
                    &mut buf2,
                    &[workspace_path],
                )
            };

            FolderResolution::get_or_put(
                GlobalOrRelative::Relative(dependency::version::Tag::Workspace),
                version,
                workspace_path_u8,
                this,
            )
        }
        dependency::version::Tag::Symlink => {
            // SAFETY: `global_link_dir_path` returns a slice into the lazily-
            // initialized `PackageManager.global_link_dir_path` (a `Box<[u8]>`
            // set once and never freed); `get_or_put` copies `symlink_path`
            // into the lockfile string buffer before any other mutation.
            let link_dir = unsafe {
                bun_ptr::detach_lifetime(crate::package_manager_real::global_link_dir_path(this))
            };
            let symlink_path = this.lockfile.str_detached(version.symlink());
            FolderResolution::get_or_put(
                GlobalOrRelative::Global(link_dir),
                version,
                symlink_path,
                this,
            )
        }
        _ => unreachable!(),
    };

    match res {
        FolderResolutionValue::Err(err) => Err(err),
        FolderResolutionValue::PackageId(package_id) => Ok(Some((package_id, false))),
        FolderResolutionValue::NewPackageId(package_id) => Ok(Some((package_id, true))),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Downloads (git / github / tarball)
// ──────────────────────────────────────────────────────────────────────────

/// Make sure the clone/checkout/download for a git, github or tarball edge
/// is in flight, and report where it stands.
fn fire_download_task(
    this: &mut PackageManager,
    dependency: &Dependency,
    dep_id: DependencyID,
    version: &dependency::Version,
    res: &Resolution,
) -> Result<DownloadStep, crate::Error> {
    match version.tag {
        dependency::version::Tag::Git => {
            let repository: Repository = *version.git();
            // SAFETY: `string_bytes` is not resized in this arm; the enqueue
            // callees copy the slices into the filename store.
            let alias = this.lockfile.str_detached(&dependency.name);
            let url = this.lockfile.str_detached(&repository.repo);
            let clone_id = Task::Id::for_git_clone(url);

            if this.network_task_has_failed(clone_id) {
                return Ok(DownloadStep::Failed);
            }

            let Some(repo_fd) = this.git_repositories.get(&clone_id).copied() else {
                if this.has_created_network_task(clone_id, dependency.behavior.is_required()) {
                    return Ok(DownloadStep::Wait(WaitTarget::GitClone(clone_id)));
                }
                let task =
                    enqueue_git_clone(this, clone_id, alias, &repository, dependency, res, None);
                this.task_batch.push(ThreadPool::Batch::from(task));
                return Ok(DownloadStep::Wait(WaitTarget::GitClone(clone_id)));
            };

            let resolved = Repository::find_commit(
                this.env_mut(),
                this.log_mut(),
                repo_fd,
                alias,
                this.lockfile.str(&repository.committish),
                clone_id,
            )?;
            let checkout_id = Task::Id::for_git_checkout(url, &resolved);

            if let Some(&package_id) = this.resolved_task_packages.get(&checkout_id) {
                return Ok(DownloadStep::Package(package_id));
            }
            if this.network_task_has_failed(checkout_id) {
                return Ok(DownloadStep::Failed);
            }
            if this.has_created_network_task(checkout_id, dependency.behavior.is_required()) {
                return Ok(DownloadStep::Wait(WaitTarget::Task(checkout_id)));
            }

            let task = enqueue_git_checkout(
                this,
                checkout_id,
                repo_fd,
                dep_id,
                alias,
                res,
                &resolved,
                None,
            );
            this.task_batch.push(ThreadPool::Batch::from(task));
            Ok(DownloadStep::Wait(WaitTarget::Task(checkout_id)))
        }
        dependency::version::Tag::Github => {
            let url = this.alloc_github_url(version.github());
            let task_id = Task::Id::for_tarball(&url);

            if let Some(&package_id) = this.resolved_task_packages.get(&task_id) {
                return Ok(DownloadStep::Package(package_id));
            }
            if this.network_task_has_failed(task_id) {
                return Ok(DownloadStep::Failed);
            }

            let created = run_tasks::generate_network_task_for_tarball(
                this,
                task_id,
                &url,
                dependency.behavior.is_required(),
                dep_id,
                &Package {
                    name: dependency.name,
                    name_hash: dependency.name_hash,
                    resolution: *res,
                    ..Package::default()
                },
                None,
                crate::network_task::Authorization::NoAuthorization,
            );
            // The dedupe entry exists before the task is built; a build error
            // must mark it failed so a later edge on the same tarball fails
            // fast instead of waiting on a task that will never run.
            let network_task = match created {
                Ok(task) => task,
                Err(err) => {
                    this.mark_network_task_failed(task_id);
                    return Err(err.into());
                }
            };
            if let Some(network_task) = network_task {
                // reshaped for borrowck — see `enqueue_tarball_for_download`.
                let nt: *mut NetworkTask = network_task;
                enqueue_network_task(this, nt);
            }
            Ok(DownloadStep::Wait(WaitTarget::Task(task_id)))
        }
        dependency::version::Tag::Tarball => {
            // SAFETY: `string_bytes` is not resized before the callees copy
            // `url` into the filename store.
            let url = unsafe {
                bun_ptr::detach_lifetime(match &version.tarball().uri {
                    dependency::tarball::Uri::Local(path) => this.lockfile.str(path),
                    dependency::tarball::Uri::Remote(url) => this.lockfile.str(url),
                })
            };
            let task_id = Task::Id::for_tarball(url);

            if let Some(&package_id) = this.resolved_task_packages.get(&task_id) {
                return Ok(DownloadStep::Package(package_id));
            }
            if this.network_task_has_failed(task_id) {
                return Ok(DownloadStep::Failed);
            }

            match &version.tarball().uri {
                dependency::tarball::Uri::Local(_) => {
                    if this.has_created_network_task(task_id, dependency.behavior.is_required()) {
                        return Ok(DownloadStep::Wait(WaitTarget::Task(task_id)));
                    }
                    // SAFETY: `string_bytes` is not resized before
                    // `enqueue_local_tarball` copies `dep_name` into the
                    // filename store.
                    let dep_name = this.lockfile.str_detached(&dependency.name);
                    let task = enqueue_local_tarball(
                        this,
                        task_id,
                        dep_id,
                        dep_name,
                        url,
                        res,
                        &Integrity::default(),
                    );
                    this.task_batch.push(ThreadPool::Batch::from(task));
                }
                dependency::tarball::Uri::Remote(_) => {
                    let created = run_tasks::generate_network_task_for_tarball(
                        this,
                        task_id,
                        url,
                        dependency.behavior.is_required(),
                        dep_id,
                        &Package {
                            name: dependency.name,
                            name_hash: dependency.name_hash,
                            resolution: *res,
                            ..Package::default()
                        },
                        None,
                        crate::network_task::Authorization::NoAuthorization,
                    );
                    // See the GitHub arm: a build error must mark the
                    // pre-inserted dedupe entry failed.
                    let network_task = match created {
                        Ok(task) => task.map(std::ptr::from_mut::<NetworkTask>),
                        Err(err) => {
                            this.mark_network_task_failed(task_id);
                            return Err(err.into());
                        }
                    };
                    if let Some(network_task) = network_task {
                        enqueue_network_task(this, network_task);
                    }
                }
            }
            Ok(DownloadStep::Wait(WaitTarget::Task(task_id)))
        }
        _ => unreachable!(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Logging
// ──────────────────────────────────────────────────────────────────────────

/// Report an error raised while deciding a single dependency, with a note
/// naming the dependency. Optional and peer edges warn; the rest error and
/// fail the install once resolution finishes.
#[cold]
#[inline(never)]
fn log_dependency_error(this: &mut PackageManager, dep_id: DependencyID, err: crate::Error) {
    let dependency = this.lockfile.buffers.dependencies[dep_id as usize].clone();
    let path_sep = match dependency.version.tag {
        dependency::version::Tag::Folder => bun_core::fmt::PathSep::Auto,
        _ => bun_core::fmt::PathSep::Any,
    };
    let realname = dependency.realname();
    let path = this.lockfile.str(&realname).to_vec();
    let path_fmt = bun_core::fmt::fmt_path(
        &path,
        bun_core::fmt::PathFormatOptions {
            path_sep,
            ..Default::default()
        },
    );
    let log = this.log_mut();
    if dependency.behavior.is_optional() || dependency.behavior.is_peer() {
        log.add_warning_with_note(
            None,
            bun_ast::Loc::default(),
            err.name().as_bytes(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    } else {
        log.add_zig_error_with_note(
            err.name(),
            format_args!("error occurred while resolving {}", path_fmt),
        );
    }
}

fn warn_incorrect_peer(this: &mut PackageManager, existing_id: PackageID) {
    let existing_package = *this.lockfile.packages.get(existing_id as usize);
    this.log_mut().add_warning_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "incorrect peer dependency \"{}@{}\"",
            existing_package
                .name
                .fmt(this.lockfile.buffers.string_bytes.as_slice()),
            existing_package.resolution.fmt(
                this.lockfile.buffers.string_bytes.as_slice(),
                bun_core::fmt::PathSep::Auto
            ),
        ),
    );
}

fn log_resolved(
    this: &mut PackageManager,
    result: &ResolvedPackageResult,
    version: &dependency::Version,
) {
    if result.is_first_time {
        log_resolved_package(this, result.package.meta.id, version);
    }
}

fn log_resolved_package(
    this: &mut PackageManager,
    package_id: PackageID,
    version: &dependency::Version,
) {
    if !PackageManager::verbose_install() {
        return;
    }
    let package = *this.lockfile.packages.get(package_id as usize);
    let label = this.lockfile.str(&version.literal);
    bun_core::pretty_errorln!(
        "   -> \"{}\": \"{}\" -> {}@{}",
        bstr::BStr::new(this.lockfile.str(&package.name)),
        bstr::BStr::new(label),
        bstr::BStr::new(this.lockfile.str(&package.name)),
        package.resolution.fmt(
            this.lockfile.buffers.string_bytes.as_slice(),
            bun_core::fmt::PathSep::Auto
        ),
    );
}

fn log_local_not_found(
    this: &mut PackageManager,
    name: SemverString,
    dependency: &Dependency,
    version: &dependency::Version,
) {
    if dependency.behavior.is_required() {
        if version.tag == dependency::version::Tag::Workspace {
            bun_ast::add_error_pretty!(
                this.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                bstr::BStr::new(this.lockfile.str(&name)),
                PackageWorkspaceSearchPathFormatter {
                    manager: this,
                    version: version.clone(),
                    quoted: true
                },
            );
        } else {
            bun_ast::add_error_pretty!(
                this.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                bstr::BStr::new(this.lockfile.str(&name)),
            );
        }
    } else if this.options.log_level.is_verbose() {
        if version.tag == dependency::version::Tag::Workspace {
            bun_ast::add_warning_pretty!(
                this.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "Workspace dependency \"{}\" not found\n\nSearched in <b>{}<r>\n\nWorkspace documentation: https://bun.com/docs/install/workspaces\n\n",
                bstr::BStr::new(this.lockfile.str(&name)),
                PackageWorkspaceSearchPathFormatter {
                    manager: this,
                    version: version.clone(),
                    quoted: true
                },
            );
        } else {
            bun_ast::add_warning_pretty!(
                this.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "Package \"{}\" is not linked\n\nTo install a linked package:\n   <cyan>bun link my-pkg-name-from-package-json<r>\n\nTip: the package name is from package.json, which can differ from the folder name.\n\n",
                bstr::BStr::new(this.lockfile.str(&name)),
            );
        }
    }
}

/// Report a resolution failure for a required dependency. The synthetic
/// edge the runtime auto-installer resolves notifies the runtime instead of
/// logging.
fn log_resolve_error(
    this: &mut PackageManager,
    is_synthetic_edge: bool,
    dependency: &Dependency,
    dep_id: DependencyID,
    name: SemverString,
    version: &dependency::Version,
    err: crate::Error,
) {
    if !dependency.behavior.is_required() {
        return;
    }

    if is_synthetic_edge && this.on_wake.context.is_some() {
        this.fail_root_resolution(dependency, dep_id, err);
        return;
    }

    match err {
        crate::Error::DistTagNotFound => {
            this.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Package \"{}\" with tag \"{}\" not found, but package exists",
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.dist_tag().tag)),
                ),
            );
        }
        crate::Error::NoMatchingVersion => {
            bun_ast::add_error_pretty!(
                this.log_mut(),
                None,
                bun_ast::Loc::EMPTY,
                "No version matching \"{}\" found for specifier \"{}\"<r> <d>(but package exists)<r>",
                bstr::BStr::new(this.lockfile.str(&version.literal)),
                bstr::BStr::new(this.lockfile.str(&name)),
            );
        }
        crate::Error::TooRecentVersion => {
            let age_gate_ms = this.options.minimum_release_age_ms.unwrap_or(0.0);
            if version.tag == dependency::version::Tag::DistTag {
                bun_ast::add_error_pretty!(
                    this.log_mut(),
                    None,
                    bun_ast::Loc::EMPTY,
                    "Package \"{}\" with tag \"{}\" not found<r> <d>(all versions blocked by minimum-release-age: {} seconds)<r>",
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.dist_tag().tag)),
                    age_gate_ms / MS_PER_S,
                );
            } else {
                bun_ast::add_error_pretty!(
                    this.log_mut(),
                    None,
                    bun_ast::Loc::EMPTY,
                    "No version matching \"{}\" found for specifier \"{}\"<r> <d>(blocked by minimum-release-age: {} seconds)<r>",
                    bstr::BStr::new(this.lockfile.str(&name)),
                    bstr::BStr::new(this.lockfile.str(&version.literal)),
                    age_gate_ms / MS_PER_S,
                );
            }
        }
        crate::Error::MissingPackageJSON => {
            if version.tag == dependency::version::Tag::Folder {
                this.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Could not find package.json for \"file:{}\" dependency \"{}\"",
                        bstr::BStr::new(this.lockfile.str(version.folder())),
                        bstr::BStr::new(this.lockfile.str(&name)),
                    ),
                );
            } else {
                this.log_mut().add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Could not find package.json for dependency \"{}\"",
                        bstr::BStr::new(this.lockfile.str(&name)),
                    ),
                );
            }
        }
        err => {
            this.log_mut().add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "{} resolving dependency \"{}\"",
                    err.name(),
                    bstr::BStr::new(this.lockfile.str(&name)),
                ),
            );
        }
    }
}
