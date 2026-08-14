use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::DynamicBitSet;
use bun_collections::bit_set::Range;
use bun_core::{Global, Output, UnwrapOrOom as _, strings};

use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{LoadResult, LoadStep, Lockfile, PackageIndexEntry};
use crate::package_manager::Options::{Enable, LogLevel};
use crate::{
    Dependency, DependencyID, DependencyVersionTag, PackageID, PackageManager, ResolutionTag,
    dependency, invalid_package_id,
};

struct Pass<'a> {
    lockfile: &'a Lockfile,
    groups: &'a [Vec<PackageID>],
    group_of: &'a [u32],
    pinned: &'a DynamicBitSet,
    edges: Vec<Vec<(DependencyID, bool)>>,
    candidates: Vec<PackageID>,
    edge_count: usize,
    sat: DynamicBitSet,
    movable: DynamicBitSet,
    cur_c: Vec<usize>,
    required: DynamicBitSet,
    chosen: DynamicBitSet,
    survivors: DynamicBitSet,
    covered: DynamicBitSet,
    voters: DynamicBitSet,
    voted: DynamicBitSet,
    count: Vec<u32>,
    protected: Vec<usize>,
}

impl<'a> Pass<'a> {
    fn new(
        lockfile: &'a Lockfile,
        groups: &'a [Vec<PackageID>],
        group_of: &'a [u32],
        pinned: &'a DynamicBitSet,
        max_candidates: usize,
        max_edges: usize,
    ) -> Pass<'a> {
        let package_count = lockfile.packages.len();
        Pass {
            lockfile,
            groups,
            group_of,
            pinned,
            edges: vec![Vec::new(); groups.len()],
            candidates: Vec::with_capacity(max_candidates),
            edge_count: 0,
            sat: DynamicBitSet::init_empty(max_edges * max_candidates).unwrap_or_oom(),
            movable: DynamicBitSet::init_empty(max_edges).unwrap_or_oom(),
            cur_c: Vec::with_capacity(max_edges),
            required: DynamicBitSet::init_empty(max_candidates).unwrap_or_oom(),
            chosen: DynamicBitSet::init_empty(max_candidates).unwrap_or_oom(),
            survivors: DynamicBitSet::init_empty(max_candidates).unwrap_or_oom(),
            covered: DynamicBitSet::init_empty(max_edges).unwrap_or_oom(),
            voters: DynamicBitSet::init_empty(package_count).unwrap_or_oom(),
            voted: DynamicBitSet::init_empty(package_count).unwrap_or_oom(),
            count: Vec::with_capacity(max_candidates),
            protected: Vec::new(),
        }
    }

    // Greedy minimum cover of the group's edges seeded with `required`; candidates are ordered highest version first.
    fn cover(&mut self) -> usize {
        let n = self.candidates.len();
        let m = self.edge_count;
        self.required.copy_into(&mut self.chosen);
        self.covered.unmanaged.set_all(false);
        let mut uncovered = m;
        let mut size = 0;
        for c in 0..n {
            if self.chosen.is_set(c) {
                size += 1;
                uncovered = self.mark_covered(c, uncovered);
            }
        }
        while uncovered > 0 {
            self.count.clear();
            self.count.resize(n, 0);
            for e in 0..m {
                if self.covered.is_set(e) {
                    continue;
                }
                let row = e * n;
                for c in 0..n {
                    self.count[c] += self.sat.is_set(row + c) as u32;
                }
            }
            let mut best: Option<usize> = None;
            for c in 0..n {
                if self.chosen.is_set(c) || self.count[c] == 0 {
                    continue;
                }
                if best.is_none_or(|b| self.count[c] > self.count[b]) {
                    best = Some(c);
                }
            }
            let Some(b) = best else {
                debug_assert!(false, "every edge is satisfied by its own live target");
                break;
            };
            self.chosen.set(b);
            size += 1;
            uncovered = self.mark_covered(b, uncovered);
        }
        size
    }

    fn mark_covered(&mut self, c: usize, mut uncovered: usize) -> usize {
        let n = self.candidates.len();
        for e in 0..self.edge_count {
            if !self.covered.is_set(e) && self.sat.is_set(e * n + c) {
                self.covered.set(e);
                uncovered -= 1;
            }
        }
        uncovered
    }

    fn placement(&self, e: usize) -> Option<usize> {
        let n = self.candidates.len();
        let row = e * n;
        (0..n).find(|&c| self.survivors.is_set(c) && self.sat.is_set(row + c))
    }

    // Keeps the fewest versions that satisfy every group edge owned by `voters` and re-points only edges whose version is dropped; `voted` records who voted.
    fn vote(&mut self, cur: &[PackageID], live: &DynamicBitSet) -> Vec<PackageID> {
        let lockfile = self.lockfile;
        let groups = self.groups;
        let group_of = self.group_of;
        let pinned = self.pinned;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let dep_slices = lockfile.packages.items_dependencies();
        let deps = lockfile.buffers.dependencies.as_slice();

        for edges in &mut self.edges {
            edges.clear();
        }
        self.voted.unmanaged.set_all(false);
        for (pkg_id, slice) in dep_slices.iter().enumerate() {
            if !self.voters.is_set(pkg_id) {
                continue;
            }
            let direct = matches!(
                pkg_res[pkg_id].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            );
            for dep_id in slice.begin() as usize..slice.end() as usize {
                let target = cur[dep_id];
                if target == invalid_package_id {
                    continue;
                }
                let Some(&g) = group_of.get(target as usize) else {
                    continue;
                };
                if g == u32::MAX {
                    continue;
                }
                self.edges[g as usize].push((dep_id as DependencyID, direct));
                self.voted.set(pkg_id);
            }
        }

        let mut next: Vec<PackageID> = cur.to_vec();
        for (g, group) in groups.iter().enumerate() {
            if self.edges[g].is_empty() {
                continue;
            }
            self.candidates.clear();
            self.candidates
                .extend(group.iter().copied().filter(|&id| live.is_set(id as usize)));
            let n = self.candidates.len();
            if n < 2 {
                continue;
            }
            let edges = core::mem::take(&mut self.edges[g]);
            let m = edges.len();
            self.edge_count = m;
            self.sat.set_range_value(
                Range {
                    start: 0,
                    end: m * n,
                },
                false,
            );
            self.movable.unmanaged.set_all(false);
            self.cur_c.clear();
            self.cur_c.resize(m, 0);
            self.required.unmanaged.set_all(false);

            for (e, &(dep_id, _)) in edges.iter().enumerate() {
                let dep = &deps[dep_id as usize];
                let target = cur[dep_id as usize];
                let cur_c = self
                    .candidates
                    .iter()
                    .position(|&c| c == target)
                    .expect("edge target is a live candidate of its group");
                self.cur_c[e] = cur_c;
                let row = e * n;

                let range = if pinned.is_set(target as usize) || dep.behavior.is_bundled() {
                    None
                } else {
                    effective_npm_range(lockfile, dep_id, dep)
                };
                match range {
                    None => {
                        self.sat.set(row + cur_c);
                        self.required.set(cur_c);
                    }
                    Some(range) => {
                        self.movable.set(e);
                        let query = &range.npm().version;
                        for c in 0..n {
                            let id = self.candidates[c];
                            if query.satisfies(pkg_res[id as usize].npm().version, buf, buf) {
                                self.sat.set(row + c);
                            }
                        }
                    }
                }
            }

            let base_size = self.cover();
            self.chosen.copy_into(&mut self.survivors);

            self.protected.clear();
            for (e, &(_, direct)) in edges.iter().enumerate() {
                if !direct || !self.movable.is_set(e) || self.survivors.is_set(self.cur_c[e]) {
                    continue;
                }
                if self.placement(e).is_some_and(|p| p > self.cur_c[e]) {
                    self.protected.push(self.cur_c[e]);
                }
            }
            if !self.protected.is_empty() {
                self.protected.sort_unstable();
                self.protected.dedup();
                for i in 0..self.protected.len() {
                    let k = self.protected[i];
                    if self.survivors.is_set(k) {
                        continue;
                    }
                    self.required.set(k);
                    if self.cover() == base_size {
                        self.chosen.copy_into(&mut self.survivors);
                    } else {
                        self.required.unset(k);
                    }
                }
            }

            for (e, &(dep_id, _)) in edges.iter().enumerate() {
                if !self.movable.is_set(e) || self.survivors.is_set(self.cur_c[e]) {
                    continue;
                }
                if let Some(p) = self.placement(e) {
                    next[dep_id as usize] = self.candidates[p];
                }
            }
            self.edges[g] = edges;
        }
        next
    }

    // Packages the pass itself removes must not vote (pnpm/pnpm#9213): shrink voters until the outcome agrees.
    fn settle(&mut self, cur: &[PackageID], live: &DynamicBitSet) -> Vec<PackageID> {
        live.copy_into(&mut self.voters);
        let mut best: Option<Vec<PackageID>> = None;
        loop {
            let next = self.vote(cur, live);
            let after = reachable(self.lockfile, &next);
            if !after.unmanaged.subset_of(&self.voters.unmanaged) {
                return best.unwrap_or(next);
            }
            self.voted.unmanaged.set_exclude(&after.unmanaged);
            if self.voted.count() == 0 {
                return next;
            }
            self.voters.unmanaged.set_exclude(&self.voted.unmanaged);
            best = Some(next);
        }
    }
}

pub(crate) fn label(lockfile: &Lockfile, id: PackageID) -> Vec<u8> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let mut label = Vec::new();
    let _ = write!(
        label,
        "{}@{}",
        BStr::new(lockfile.packages.items_name()[id as usize].slice(buf)),
        lockfile.packages.items_resolution()[id as usize]
            .npm()
            .version
            .fmt(buf)
    );
    label
}

fn order_by_name_then_version(lockfile: &Lockfile, a: PackageID, b: PackageID) -> Ordering {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let pkg_res = lockfile.packages.items_resolution();
    let (a, b) = (a as usize, b as usize);
    strings::order(names[a].slice(buf), names[b].slice(buf)).then_with(|| {
        pkg_res[a]
            .npm()
            .version
            .order(pkg_res[b].npm().version, buf, buf)
    })
}

fn sort_by_name_then_version(lockfile: &Lockfile, ids: &mut [PackageID]) {
    ids.sort_by(|&a, &b| order_by_name_then_version(lockfile, a, b));
}

#[derive(Default)]
struct Outcome {
    removed: Vec<Box<[u8]>>,
    kept: Vec<Box<[u8]>>,
}

fn dedupe_lockfile(lockfile: &mut Lockfile) -> Outcome {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let has_patches = lockfile.patched_dependencies.count() > 0;

    let mut groups: Vec<Vec<PackageID>> = Vec::new();
    let mut group_of: Vec<u32> = vec![u32::MAX; pkg_res.len()];
    let mut pinned = DynamicBitSet::init_empty(pkg_res.len()).unwrap_or_oom();
    let mut max_candidates = 0;

    if has_patches {
        for id in 0..pkg_res.len() {
            if pkg_res[id].tag == ResolutionTag::Npm
                && lockfile.patched_dependencies.contains(
                    &bun_semver::string::Builder::string_hash(&label(lockfile, id as PackageID)),
                )
            {
                pinned.set(id);
            }
        }
    }

    for entry in lockfile.package_index.values() {
        let PackageIndexEntry::Ids(ids) = entry else {
            continue;
        };
        let mut candidates: Vec<PackageID> = ids
            .iter()
            .copied()
            .filter(|&id| pkg_res[id as usize].tag == ResolutionTag::Npm)
            .collect();
        if candidates.len() < 2 {
            continue;
        }
        candidates.sort_by(|&a, &b| {
            pkg_res[b as usize]
                .npm()
                .version
                .order(pkg_res[a as usize].npm().version, buf, buf)
                .then(a.cmp(&b))
        });
        for &id in &candidates {
            group_of[id as usize] = groups.len() as u32;
        }
        max_candidates = max_candidates.max(candidates.len());
        groups.push(candidates);
    }

    if groups.is_empty() {
        return Outcome::default();
    }

    // Re-pointing keeps an edge inside its group, so the initial per-group edge counts bound every pass.
    let mut edge_counts: Vec<u32> = vec![0; groups.len()];
    for &target in lockfile.buffers.resolutions.iter() {
        if let Some(&g) = group_of.get(target as usize)
            && g != u32::MAX
        {
            edge_counts[g as usize] += 1;
        }
    }
    let max_edges = edge_counts.iter().copied().max().unwrap_or(0) as usize;

    let initial = reachable(lockfile, &lockfile.buffers.resolutions);
    let patched: Vec<PackageID> = (0..pkg_res.len())
        .filter(|&p| pinned.is_set(p) && initial.is_set(p))
        .map(|p| p as PackageID)
        .collect();
    let mut kept: Vec<(PackageID, Vec<PackageID>)> = Vec::new();

    // Walked over the original resolutions: pinning every removed version that led to the orphan keeps those paths intact on the re-run.
    let (cur, live) = loop {
        let mut live = initial.clone().unwrap_or_oom();
        let mut cur: Vec<PackageID> = lockfile.buffers.resolutions.clone();
        {
            let mut pass = Pass::new(
                lockfile,
                &groups,
                &group_of,
                &pinned,
                max_candidates,
                max_edges,
            );
            loop {
                cur = pass.settle(&cur, &live);
                let after = reachable(lockfile, &cur);
                if after.unmanaged.eql(&live.unmanaged) {
                    break;
                }
                live = after;
            }
        }

        let orphaned: Vec<PackageID> = patched
            .iter()
            .copied()
            .filter(|&p| !live.is_set(p as usize))
            .collect();
        if orphaned.is_empty() {
            break (cur, live);
        }
        let before = kept.len();
        for &v in groups.iter().flatten() {
            let i = v as usize;
            if !initial.is_set(i) || live.is_set(i) || pinned.is_set(i) {
                continue;
            }
            let leads = crate::lockfile::reachable::packages_from(
                lockfile,
                &lockfile.buffers.resolutions,
                core::slice::from_ref(&v),
                true,
                crate::lockfile::reachable::Options::all(0),
            );
            let needed: Vec<PackageID> = orphaned
                .iter()
                .copied()
                .filter(|&p| leads.is_set(p as usize))
                .collect();
            if !needed.is_empty() {
                pinned.set(i);
                kept.push((v, needed));
            }
        }
        if kept.len() == before {
            debug_assert!(
                false,
                "an orphaned patched package has no removed dependent"
            );
            break (cur, live);
        }
    };

    kept.sort_by(|(a, _), (b, _)| order_by_name_then_version(lockfile, *a, *b));
    let kept: Vec<Box<[u8]>> = kept
        .into_iter()
        .map(|(v, mut needed)| {
            sort_by_name_then_version(lockfile, &mut needed);
            let mut line = label(lockfile, v);
            line.extend_from_slice(b" (needed to reach patched ");
            for (i, &p) in needed.iter().enumerate() {
                if i > 0 {
                    line.extend_from_slice(b", ");
                }
                line.extend_from_slice(&label(lockfile, p));
            }
            line.push(b')');
            line.into_boxed_slice()
        })
        .collect();

    let mut removed: Vec<PackageID> = groups
        .iter()
        .flatten()
        .copied()
        .filter(|&id| initial.is_set(id as usize) && !live.is_set(id as usize))
        .collect();
    if removed.is_empty() {
        return Outcome {
            removed: Vec::new(),
            kept,
        };
    }

    sort_by_name_then_version(lockfile, &mut removed);
    let labels = removed
        .iter()
        .map(|&id| label(lockfile, id).into_boxed_slice())
        .collect();

    lockfile.buffers.resolutions = cur;
    Outcome {
        removed: labels,
        kept,
    }
}

pub(crate) fn effective_npm_range(
    lockfile: &Lockfile,
    dep_id: DependencyID,
    dep: &Dependency,
) -> Option<dependency::Version> {
    effective_version(lockfile, dep_id, dep)
        .filter(|version| version.tag == DependencyVersionTag::Npm)
}

pub(crate) fn effective_version(
    lockfile: &Lockfile,
    dep_id: DependencyID,
    dep: &Dependency,
) -> Option<dependency::Version> {
    let mut version = if dep.behavior.is_workspace()
        || (dep.version.tag == DependencyVersionTag::Npm && dep.version.npm().is_alias)
    {
        dep.version.clone()
    } else {
        lockfile
            .overrides
            .get(lockfile, dep_id, dep.name_hash)
            .unwrap_or_else(|| dep.version.clone())
    };
    if version.tag == DependencyVersionTag::Catalog {
        version = lockfile
            .catalogs
            .get(lockfile, *version.catalog(), dep.name)?
            .version;
    }
    Some(version)
}

// Optional-peer edges are followed too: with an in-sync package.json `clean` runs with `keep_optional_peer_targets`.
fn reachable(lockfile: &Lockfile, resolutions: &[PackageID]) -> DynamicBitSet {
    crate::lockfile::reachable::packages(
        lockfile,
        resolutions,
        crate::lockfile::reachable::Options::all(0),
    )
}

fn load_step_verb(step: LoadStep) -> &'static str {
    match step {
        LoadStep::OpenFile => "open",
        LoadStep::ReadFile => "read",
        LoadStep::ParseFile => "parse",
        LoadStep::Migrating => "migrate",
    }
}

pub fn dedupe_before_install(
    manager: &mut PackageManager,
    load_result: &LoadResult<'_>,
) -> crate::Result<()> {
    let quiet = manager.options.log_level == LogLevel::Silent;

    match load_result {
        LoadResult::NotFound => {
            if !quiet {
                Output::err_generic("missing lockfile, nothing to dedupe", ());
            }
            Global::exit(1);
        }
        LoadResult::Err(cause) => {
            if !quiet {
                Output::err_generic(
                    "failed to {s} lockfile: {s}",
                    (load_step_verb(cause.step), cause.value.name()),
                );
                if manager.log_mut().has_errors() {
                    let _ = manager
                        .log_mut()
                        .print(core::ptr::from_mut(Output::error_writer()));
                }
            }
            Global::crash();
        }
        LoadResult::Ok(_) => {}
    }

    if manager
        .lockfile
        .root_package()
        .is_none_or(|root| root.dependencies.len == 0)
    {
        report_already_deduplicated(manager, &[]);
    }
    Ok(())
}

fn report_already_deduplicated(manager: &PackageManager, kept: &[Box<[u8]>]) {
    if manager.options.log_level != LogLevel::Silent {
        let packages = manager.lockfile.packages.len().saturating_sub(1);
        bun_core::pretty!(
            "🎉 <green>No duplicates<r> <d>— checked {} package{}, every one already resolves to a single version<r> ",
            packages,
            if packages == 1 { "" } else { "s" }
        );
        Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
        bun_core::pretty!("\n");
        print_kept(kept);
        Output::flush();
    }
    if manager.options.dry_run {
        Global::exit(0);
    }
}

fn print_kept(kept: &[Box<[u8]>]) {
    for line in kept {
        bun_core::prettyln!("  <d>kept<r> {}", BStr::new(line));
    }
}

pub fn dedupe_after_differ(manager: &mut PackageManager) {
    let quiet = manager.options.log_level == LogLevel::Silent;

    if manager.summary.changes_dependencies() {
        if !quiet {
            Output::err_generic(
                "the lockfile is out of date with package.json, nothing was deduplicated",
                (),
            );
            bun_core::note!("run 'bun install' first");
            Output::flush();
        }
        Global::exit(1);
    }

    let outcome = dedupe_lockfile(&mut manager.lockfile);
    if outcome.removed.is_empty() {
        report_already_deduplicated(manager, &outcome.kept);
        return;
    }
    let removed = &outcome.removed;

    let n = removed.len();
    let plural = if n == 1 { "" } else { "s" };
    if !quiet {
        for label in removed {
            bun_core::prettyln!("<red>-<r> {}", BStr::new(label));
        }
    }

    if manager.options.dry_run {
        if !quiet {
            bun_core::pretty!(
                "<yellow>{}<r> duplicate version{} can be removed ",
                n,
                plural
            );
            Output::print_start_end_stdout(
                bun_core::start_time(),
                bun_core::time::nano_timestamp(),
            );
            bun_core::pretty!("\n");
            print_kept(&outcome.kept);
            bun_core::prettyln!("  <cyan>bun dedupe<r>");
            Output::flush();
        }
        Global::exit(1);
    }

    if !manager.options.do_.save_lockfile() {
        if !quiet {
            let why = if manager.options.enable.frozen_lockfile() {
                "the lockfile is frozen"
            } else {
                "saving the lockfile is disabled"
            };
            Output::flush();
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> {} duplicate version{} can be removed, but {}",
                n,
                plural,
                why
            );
            print_kept(&outcome.kept);
            bun_core::prettyln!("  <cyan>bun dedupe --check<r>");
            Output::flush();
        }
        Global::exit(1);
    }

    if !quiet {
        bun_core::prettyln!("Removed <green>{}<r> duplicate version{}", n, plural);
        print_kept(&outcome.kept);
        Output::flush();
    }
    manager
        .options
        .enable
        .set(Enable::FORCE_SAVE_LOCKFILE, true);
}
