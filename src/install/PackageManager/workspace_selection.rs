use std::collections::VecDeque;

use bstr::BStr;
use bun_collections::{DynamicBitSet, HashMap, index_sort};
use bun_core::{Global, Output, UnwrapOrOom as _, strings};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};

use crate::bun_fs::FileSystem;
use crate::dependency::Behavior;
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::resolution::Tag as ResolutionTag;
use crate::{PackageID, PackageNameHash};

pub struct Candidate<'a> {
    pub name: &'a [u8],
    pub abs_posix_dir: &'a [u8],
    pub is_root: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RootSelection {
    Implicit,
    ExplicitOnly,
}

pub struct Selection {
    pub selected: DynamicBitSet,
    pub unmatched_patterns: Vec<usize>,
}

pub struct LockfileSelection {
    pub ids: Vec<PackageID>,
    pub unmatched_patterns: Vec<usize>,
}

/// Importers a filtered add/remove/update selected; None is the root. Only their dependencies get linked.
pub(crate) struct LinkTargets {
    importers: Box<[Option<PackageNameHash>]>,
}

pub struct WorkspaceGraph {
    dependencies: Vec<Vec<u32>>,
    dependents: Vec<Vec<u32>>,
}

enum Base {
    All,
    Name(Box<[u8]>),
    Path(Box<[u8]>),
    Subtree(Box<[u8]>),
}

struct Selector {
    negated: bool,
    dependencies: bool,
    dependents: bool,
    exclude_self: bool,
    base: Base,
}

fn strip_negations(raw: &[u8]) -> (&[u8], bool) {
    let mut remain = raw;
    let mut negated = false;
    while let Some(rest) = remain.strip_prefix(b"!") {
        negated = !negated;
        remain = rest;
    }
    (remain, negated)
}

/// Accepted shapes: `!`* then `...`/`...^` prefix and/or `...`/`^...` suffix around `*`, `{dir}`, `./path` or a name glob.
fn parse(raw: &[u8], original_cwd: &[u8], path_buf: &mut [u8]) -> Selector {
    let (mut remain, negated) = strip_negations(raw);
    let mut dependencies = false;
    let mut dependents = false;
    let mut exclude_self = false;

    if let Some(rest) = remain.strip_prefix(b"...") {
        dependents = true;
        remain = rest;
        if let Some(rest) = remain.strip_prefix(b"^") {
            exclude_self = true;
            remain = rest;
        }
    }
    if let Some(rest) = remain.strip_suffix(b"...") {
        dependencies = true;
        remain = rest;
        if let Some(rest) = remain.strip_suffix(b"^") {
            exclude_self = true;
            remain = rest;
        }
    }

    if (dependencies || dependents) && remain.is_empty() {
        Output::err_generic(
            "--filter \"{}\" is missing a workspace name or path",
            (BStr::new(raw),),
        );
        Global::crash();
    }

    let resolve = |part: &[u8], path_buf: &mut [u8]| -> Box<[u8]> {
        strings::without_trailing_slash(join_abs_string_buf::<platform::Posix>(
            original_cwd,
            path_buf,
            &[part],
        ))
        .into()
    };

    let base = if remain == b"*" || remain == b"**" {
        Base::All
    } else if remain.len() >= 2 && remain[0] == b'{' && remain[remain.len() - 1] == b'}' {
        Base::Subtree(resolve(&remain[1..remain.len() - 1], path_buf))
    } else if remain.first() == Some(&b'.') {
        Base::Path(resolve(remain, path_buf))
    } else {
        Base::Name(remain.into())
    };

    Selector {
        negated,
        dependencies,
        dependents,
        exclude_self,
        base,
    }
}

fn base_matches(base: &Base, c: &Candidate<'_>, explicit_root_only: bool) -> bool {
    match base {
        // A package.json without a name (bun run --filter's walk) is only selectable by path.
        Base::All => {
            if c.is_root {
                !explicit_root_only
            } else {
                !c.name.is_empty()
            }
        }
        Base::Name(glob) => bun_glob::r#match(glob, c.name).matches(),
        Base::Path(glob) => bun_glob::r#match(glob, c.abs_posix_dir).matches(),
        Base::Subtree(glob) => {
            let mut dir = c.abs_posix_dir;
            loop {
                if bun_glob::r#match(glob, dir).matches() {
                    return true;
                }
                match strings::last_index_of_char(dir, b'/') {
                    Some(i) if i > 0 => dir = &dir[..i],
                    _ => return false,
                }
            }
        }
    }
}

fn bitset(n: usize) -> DynamicBitSet {
    DynamicBitSet::init_empty(n).unwrap_or_oom()
}

/// `unreachable` is the root under `RootSelection::ExplicitOnly`: edges never select it, but it still seeds the walk when named.
fn walk(
    graph: &WorkspaceGraph,
    sel: &Selector,
    base: &DynamicBitSet,
    unreachable: Option<usize>,
) -> DynamicBitSet {
    let n = base.bit_length();
    let mut reached = bitset(n);
    let mut visited = bitset(n);
    let mut queue: VecDeque<u32> = VecDeque::new();

    for adjacency in [
        sel.dependencies.then_some(&graph.dependencies),
        sel.dependents.then_some(&graph.dependents),
    ]
    .into_iter()
    .flatten()
    {
        base.copy_into(&mut visited);
        if let Some(i) = unreachable {
            visited.set(i);
        }
        let mut seeds = base.iterator::<true, true>();
        while let Some(i) = seeds.next() {
            queue.push_back(i as u32);
        }
        while let Some(u) = queue.pop_front() {
            for &v in &adjacency[u as usize] {
                if !visited.is_set(v as usize) {
                    visited.set(v as usize);
                    queue.push_back(v);
                }
            }
        }
        reached.unmanaged.set_union(&visited.unmanaged);
    }

    if sel.exclude_self {
        reached.unmanaged.set_exclude(&base.unmanaged);
    } else {
        reached.unmanaged.set_union(&base.unmanaged);
    }
    if let Some(i) = unreachable.filter(|&i| !base.is_set(i)) {
        reached.unset(i);
    }
    reached
}

pub fn first_relational<'a>(patterns: &[&'a [u8]]) -> Option<&'a [u8]> {
    patterns.iter().copied().find(|raw| {
        let (trimmed, _) = strip_negations(raw);
        strings::has_prefix(trimmed, b"...") || trimmed.ends_with(b"...")
    })
}

pub fn select(
    patterns: &[&[u8]],
    original_cwd: &[u8],
    candidates: &[Candidate<'_>],
    graph: Option<&WorkspaceGraph>,
    root: RootSelection,
) -> Selection {
    let n = candidates.len();
    let explicit_root_only = root == RootSelection::ExplicitOnly && n > 1;
    let root_index = explicit_root_only
        .then(|| candidates.iter().position(|c| c.is_root))
        .flatten();
    let mut include = bitset(n);
    let mut exclude = bitset(n);
    let mut any_positive = false;
    let mut unmatched_patterns: Vec<usize> = Vec::new();
    let mut path_buf = path_buffer_pool::get();

    for (index, raw) in patterns.iter().enumerate() {
        let sel = parse(raw, original_cwd, &mut path_buf.0);
        let mut set = bitset(n);
        for (i, c) in candidates.iter().enumerate() {
            if base_matches(&sel.base, c, explicit_root_only) {
                set.set(i);
            }
        }
        if sel.dependencies || sel.dependents {
            debug_assert!(graph.is_some());
            if let Some(graph) = graph {
                set = walk(graph, &sel, &set, root_index);
            }
        }
        if sel.negated {
            exclude.unmanaged.set_union(&set.unmanaged);
        } else {
            any_positive = true;
            if set.count() == 0 {
                unmatched_patterns.push(index);
            }
            include.unmanaged.set_union(&set.unmanaged);
        }
    }

    if !any_positive {
        for (i, c) in candidates.iter().enumerate() {
            if base_matches(&Base::All, c, explicit_root_only) {
                include.set(i);
            }
        }
    }

    include.unmanaged.set_exclude(&exclude.unmanaged);
    Selection {
        selected: include,
        unmatched_patterns,
    }
}

impl WorkspaceGraph {
    pub(crate) fn from_edges(
        candidate_count: usize,
        edges: impl IntoIterator<Item = (u32, u32)>,
    ) -> WorkspaceGraph {
        let mut graph = WorkspaceGraph {
            dependencies: vec![Vec::new(); candidate_count],
            dependents: vec![Vec::new(); candidate_count],
        };
        for (from, to) in edges {
            graph.dependencies[from as usize].push(to);
            graph.dependents[to as usize].push(from);
        }
        graph
    }

    pub(crate) fn from_lockfile(
        lockfile: &Lockfile,
        candidate_name_hashes: &[Option<PackageNameHash>],
    ) -> WorkspaceGraph {
        let n = candidate_name_hashes.len();
        let root_candidate = candidate_name_hashes
            .iter()
            .position(Option::is_none)
            .map(|i| i as u32);
        let mut by_hash: HashMap<PackageNameHash, u32> = HashMap::with_capacity(n);
        for (i, hash) in candidate_name_hashes.iter().enumerate() {
            if let Some(hash) = hash {
                by_hash.insert(*hash, i as u32);
            }
        }

        let pkg_resolutions = lockfile.packages.items_resolution();
        let name_hashes = lockfile.packages.items_name_hash();
        let res_lists = lockfile.packages.items_resolutions();
        let dep_lists = lockfile.packages.items_dependencies();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let dependencies = lockfile.buffers.dependencies.as_slice();

        let candidate_of: Vec<u32> = pkg_resolutions
            .iter()
            .zip(name_hashes)
            .map(|(res, name_hash)| match res.tag {
                ResolutionTag::Root => root_candidate.unwrap_or(u32::MAX),
                ResolutionTag::Workspace => by_hash.get(name_hash).copied().unwrap_or(u32::MAX),
                _ => u32::MAX,
            })
            .collect();

        let mut graph = WorkspaceGraph {
            dependencies: vec![Vec::new(); n],
            dependents: vec![Vec::new(); n],
        };
        for (pkg_id, &from) in candidate_of.iter().enumerate() {
            if from == u32::MAX {
                continue;
            }
            let deps = dep_lists[pkg_id].get(dependencies);
            for (dep, &dep_pkg) in deps.iter().zip(res_lists[pkg_id].get(resolutions)) {
                // The root's `workspaces` entries are not dependencies on the workspaces.
                if dep.behavior == Behavior::WORKSPACE {
                    continue;
                }
                let Some(&to) = candidate_of.get(dep_pkg as usize) else {
                    continue;
                };
                if to == u32::MAX || to == from {
                    continue;
                }
                graph.dependencies[from as usize].push(to);
                graph.dependents[to as usize].push(from);
            }
        }
        graph
    }

    /// Candidate indices, each after the candidates it depends on. A cycle is broken at one of its members.
    pub fn dependency_order(&self) -> Vec<u32> {
        let n = self.dependencies.len();
        let mut remaining: Vec<usize> = self.dependencies.iter().map(Vec::len).collect();
        let mut order: Vec<u32> = Vec::with_capacity(n);
        let mut queued = bitset(n);
        let mut queue: VecDeque<u32> = VecDeque::new();
        for i in 0..n {
            if remaining[i] == 0 {
                queued.set(i);
                queue.push_back(i as u32);
            }
        }

        loop {
            while let Some(u) = queue.pop_front() {
                order.push(u);
                for &v in &self.dependents[u as usize] {
                    if queued.is_set(v as usize) {
                        continue;
                    }
                    remaining[v as usize] -= 1;
                    if remaining[v as usize] == 0 {
                        queued.set(v as usize);
                        queue.push_back(v);
                    }
                }
            }
            if order.len() == n {
                return order;
            }
            // Stalled on a cycle. Follow unmet edges until one repeats: that candidate is on it.
            let mut on_walk = bitset(n);
            let mut cur = (0..n)
                .find(|&i| !queued.is_set(i))
                .expect("order.len() < n");
            while !on_walk.is_set(cur) {
                on_walk.set(cur);
                cur = self.dependencies[cur]
                    .iter()
                    .map(|&d| d as usize)
                    .find(|&d| !queued.is_set(d))
                    .expect("remaining[cur] > 0");
            }
            queued.set(cur);
            queue.push_back(cur as u32);
        }
    }

    pub fn from_dependency_names<D, I>(names: &[&[u8]], mut dependency_names: D) -> WorkspaceGraph
    where
        D: FnMut(usize) -> I,
        I: IntoIterator,
        I::Item: AsRef<[u8]>,
    {
        let n = names.len();
        let mut by_name: HashMap<&[u8], u32> = HashMap::with_capacity(n);
        for (i, &name) in names.iter().enumerate() {
            if !name.is_empty() && !by_name.contains_key(name) {
                by_name.insert(name, i as u32);
            }
        }

        let mut graph = WorkspaceGraph {
            dependencies: vec![Vec::new(); n],
            dependents: vec![Vec::new(); n],
        };
        for from in 0..n {
            for dep in dependency_names(from) {
                let Some(&to) = by_name.get(dep.as_ref()) else {
                    continue;
                };
                if to as usize == from {
                    continue;
                }
                graph.dependencies[from].push(to);
                graph.dependents[to as usize].push(from as u32);
            }
        }
        graph
    }
}

pub fn select_lockfile_workspaces(
    lockfile: &Lockfile,
    patterns: &[&[u8]],
    original_cwd: &[u8],
    root: RootSelection,
) -> LockfileSelection {
    let pkg_resolutions = lockfile.packages.items_resolution();

    let ids: Vec<PackageID> = pkg_resolutions
        .iter()
        .enumerate()
        .filter(|(_, res)| matches!(res.tag, ResolutionTag::Root | ResolutionTag::Workspace))
        .map(|(pkg_id, _)| pkg_id as PackageID)
        .collect();

    if patterns.is_empty() {
        return LockfileSelection {
            ids,
            unmatched_patterns: Vec::new(),
        };
    }

    let pkg_names = lockfile.packages.items_name();
    let name_hashes = lockfile.packages.items_name_hash();
    let string_buf = lockfile.buffers.string_bytes.as_slice();
    let top_level_dir = FileSystem::instance().top_level_dir();

    let mut path_buf = path_buffer_pool::get();
    let dirs: Vec<Box<[u8]>> = ids
        .iter()
        .map(|&pkg_id| {
            let res = &pkg_resolutions[pkg_id as usize];
            let rel: &[u8] = match res.tag {
                ResolutionTag::Workspace => res.workspace().slice(string_buf),
                _ => b".",
            };
            strings::without_trailing_slash(join_abs_string_buf::<platform::Posix>(
                top_level_dir,
                &mut path_buf.0,
                &[rel],
            ))
            .into()
        })
        .collect();

    let candidates: Vec<Candidate<'_>> = ids
        .iter()
        .zip(&dirs)
        .map(|(&pkg_id, dir)| Candidate {
            name: pkg_names[pkg_id as usize].slice(string_buf),
            abs_posix_dir: dir,
            is_root: pkg_resolutions[pkg_id as usize].tag == ResolutionTag::Root,
        })
        .collect();

    let graph = first_relational(patterns).map(|_| {
        let hashes: Vec<Option<PackageNameHash>> = candidates
            .iter()
            .zip(&ids)
            .map(|(c, &pkg_id)| (!c.is_root).then(|| name_hashes[pkg_id as usize]))
            .collect();
        WorkspaceGraph::from_lockfile(lockfile, &hashes)
    });

    let Selection {
        selected,
        unmatched_patterns,
    } = select(patterns, original_cwd, &candidates, graph.as_ref(), root);
    let ids: Vec<PackageID> = ids
        .into_iter()
        .enumerate()
        .filter(|&(i, _)| selected.is_set(i))
        .map(|(_, pkg_id)| pkg_id)
        .collect();
    LockfileSelection {
        ids,
        unmatched_patterns,
    }
}

/// `ids` (root and workspace packages) reordered so each one comes after the selected workspaces it depends on.
pub fn order_lockfile_workspaces(lockfile: &Lockfile, ids: &[PackageID]) -> Vec<PackageID> {
    let pkg_resolutions = lockfile.packages.items_resolution();
    let name_hashes = lockfile.packages.items_name_hash();
    let hashes: Vec<Option<PackageNameHash>> = ids
        .iter()
        .map(|&pkg_id| {
            (pkg_resolutions[pkg_id as usize].tag != ResolutionTag::Root)
                .then(|| name_hashes[pkg_id as usize])
        })
        .collect();
    WorkspaceGraph::from_lockfile(lockfile, &hashes)
        .dependency_order()
        .into_iter()
        .map(|i| ids[i as usize])
        .collect()
}

pub fn quote_patterns(patterns: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, pattern) in patterns.iter().enumerate() {
        if i > 0 {
            out.extend_from_slice(b", ");
        }
        out.push(b'"');
        out.extend_from_slice(pattern);
        out.push(b'"');
    }
    out
}

/// `No workspace packages matched the filter "a"` / `... the filters "a", "b"`; the one sentence every --filter command prints.
pub fn unmatched_message(patterns: &[&[u8]]) -> Vec<u8> {
    let mut out: Vec<u8> = if patterns.len() == 1 {
        b"No workspace packages matched the filter ".to_vec()
    } else {
        b"No workspace packages matched the filters ".to_vec()
    };
    out.extend_from_slice(&quote_patterns(patterns));
    out
}

pub fn warn_unmatched(patterns: &[&[u8]], unmatched_patterns: &[usize]) {
    if unmatched_patterns.is_empty() {
        return;
    }
    let unmatched: Vec<&[u8]> = unmatched_patterns.iter().map(|&i| patterns[i]).collect();
    bun_core::warn!("{}", BStr::new(&unmatched_message(&unmatched)));
}

/// The nothing-selected case: `error: No workspace packages matched the filter(s) ...`, exit 1.
pub fn error_unmatched(patterns: &[&[u8]]) -> ! {
    Output::flush();
    Output::err_generic("{}", (BStr::new(&unmatched_message(patterns)),));
    Global::crash();
}

impl LinkTargets {
    pub(crate) fn from_importers(
        importers: impl Iterator<Item = Option<PackageNameHash>>,
    ) -> LinkTargets {
        let mut importers: Vec<Option<PackageNameHash>> = importers.collect();
        index_sort::sort_vec_unstable_by(&mut importers, |a, b| a.cmp(b));
        importers.dedup();
        LinkTargets {
            importers: importers.into_boxed_slice(),
        }
    }

    pub(crate) fn package_ids(&self, lockfile: &Lockfile) -> Vec<PackageID> {
        let tags = lockfile.packages.items_resolution();
        let name_hashes = lockfile.packages.items_name_hash();
        (0..tags.len())
            .filter(|&i| match tags[i].tag {
                ResolutionTag::Root => self.importers.binary_search(&None).is_ok(),
                ResolutionTag::Workspace => {
                    self.importers.binary_search(&Some(name_hashes[i])).is_ok()
                }
                _ => false,
            })
            .map(|i| i as PackageID)
            .collect()
    }
}
