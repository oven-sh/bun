use std::collections::VecDeque;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output, strings};
use bun_paths::path_buffer_pool;
use bun_paths::resolve_path::{join_abs_string_buf, platform};

use crate::bun_fs::FileSystem;
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::resolution::Tag as ResolutionTag;
use crate::{PackageID, PackageNameHash};

pub(crate) struct Candidate<'a> {
    pub(crate) name: &'a [u8],
    pub(crate) abs_posix_dir: &'a [u8],
    pub(crate) is_root: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootSelection {
    Implicit,
    ExplicitOnly,
}

pub(crate) struct Selection {
    pub(crate) selected: Vec<bool>,
    pub(crate) unmatched_patterns: Vec<usize>,
}

pub(crate) struct WorkspaceGraph {
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
        Base::All => !(c.is_root && explicit_root_only),
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

fn walk(graph: &WorkspaceGraph, sel: &Selector, base: &[bool]) -> Vec<bool> {
    let n = base.len();
    let mut reached = vec![false; n];
    let mut queue: VecDeque<u32> = VecDeque::new();

    for adjacency in [
        sel.dependencies.then_some(&graph.dependencies),
        sel.dependents.then_some(&graph.dependents),
    ]
    .into_iter()
    .flatten()
    {
        let mut visited = vec![false; n];
        queue.clear();
        queue.extend((0..n).filter(|&i| base[i]).map(|i| i as u32));
        while let Some(u) = queue.pop_front() {
            for &v in &adjacency[u as usize] {
                let v_index = v as usize;
                if !visited[v_index] {
                    visited[v_index] = true;
                    reached[v_index] = true;
                    queue.push_back(v);
                }
            }
        }
    }

    for (reached, &in_base) in reached.iter_mut().zip(base) {
        if sel.exclude_self {
            *reached &= !in_base;
        } else {
            *reached |= in_base;
        }
    }
    reached
}

pub(crate) fn first_relational<'a>(patterns: &[&'a [u8]]) -> Option<&'a [u8]> {
    patterns.iter().copied().find(|raw| {
        let (trimmed, _) = strip_negations(raw);
        strings::has_prefix(trimmed, b"...") || trimmed.ends_with(b"...")
    })
}

pub(crate) fn select(
    patterns: &[&[u8]],
    original_cwd: &[u8],
    candidates: &[Candidate<'_>],
    graph: Option<&WorkspaceGraph>,
    root: RootSelection,
) -> Selection {
    let n = candidates.len();
    let explicit_root_only = root == RootSelection::ExplicitOnly && n > 1;
    let mut include = vec![false; n];
    let mut exclude = vec![false; n];
    let mut any_positive = false;
    let mut unmatched_patterns: Vec<usize> = Vec::new();
    let mut path_buf = path_buffer_pool::get();

    for (index, raw) in patterns.iter().enumerate() {
        let sel = parse(raw, original_cwd, &mut path_buf.0);
        let mut set: Vec<bool> = candidates
            .iter()
            .map(|c| base_matches(&sel.base, c, explicit_root_only))
            .collect();
        if sel.dependencies || sel.dependents {
            debug_assert!(graph.is_some());
            if let Some(graph) = graph {
                set = walk(graph, &sel, &set);
            }
        }
        if sel.negated {
            for (excluded, &hit) in exclude.iter_mut().zip(&set) {
                *excluded |= hit;
            }
        } else {
            any_positive = true;
            if !set.iter().any(|&hit| hit) {
                unmatched_patterns.push(index);
            }
            for (included, &hit) in include.iter_mut().zip(&set) {
                *included |= hit;
            }
        }
    }

    if !any_positive {
        for (included, c) in include.iter_mut().zip(candidates) {
            *included = !(c.is_root && explicit_root_only);
        }
    }

    let selected = include
        .iter()
        .zip(&exclude)
        .map(|(&included, &excluded)| included && !excluded)
        .collect();
    Selection {
        selected,
        unmatched_patterns,
    }
}

impl WorkspaceGraph {
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
        let resolutions = lockfile.buffers.resolutions.as_slice();

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
            for &dep_pkg in res_lists[pkg_id].get(resolutions) {
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
}

pub(crate) fn select_lockfile_workspaces(
    lockfile: &Lockfile,
    patterns: &[&[u8]],
    original_cwd: &[u8],
    root: RootSelection,
) -> Vec<PackageID> {
    let pkg_resolutions = lockfile.packages.items_resolution();

    let ids: Vec<PackageID> = pkg_resolutions
        .iter()
        .enumerate()
        .filter(|(_, res)| matches!(res.tag, ResolutionTag::Root | ResolutionTag::Workspace))
        .map(|(pkg_id, _)| pkg_id as PackageID)
        .collect();

    if patterns.is_empty() {
        return ids;
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

    let selection = select(patterns, original_cwd, &candidates, graph.as_ref(), root);
    ids.into_iter()
        .zip(selection.selected)
        .filter(|(_, selected)| *selected)
        .map(|(pkg_id, _)| pkg_id)
        .collect()
}
