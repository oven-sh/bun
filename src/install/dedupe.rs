use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::bit_set::Range;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::{Global, Output, UnwrapOrOom as _, strings};

use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{LoadResult, Lockfile, Package, PackageIndexEntry};
use crate::package_manager::Options::{Enable, LogLevel};
use crate::package_manager::ROOT_PACKAGE_JSON_PATH;
use crate::{
    Dependency, DependencyID, DependencyVersionTag, Features, GetJsonResult, PackageID,
    PackageManager, ResolutionTag, dependency, invalid_package_id,
};

struct Pass<'a> {
    lockfile: &'a Lockfile,
    groups: &'a [Vec<PackageID>],
    group_of: &'a [u32],
    pinned: &'a DynamicBitSet,
    /// Packages below this id (loaded from the lockfile) keep their edges, and so do root/workspace rows and audit-fixed rows.
    frozen_below: Option<PackageID>,
    fixed_rows: &'a DynamicBitSet,
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
        frozen_below: Option<PackageID>,
        fixed_rows: &'a DynamicBitSet,
        max_candidates: usize,
        max_edges: usize,
    ) -> Pass<'a> {
        let package_count = lockfile.packages.len();
        Pass {
            lockfile,
            groups,
            group_of,
            pinned,
            frozen_below,
            fixed_rows,
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

            for (e, &(dep_id, direct)) in edges.iter().enumerate() {
                let dep = &deps[dep_id as usize];
                let target = cur[dep_id as usize];
                let cur_c = self
                    .candidates
                    .iter()
                    .position(|&c| c == target)
                    .expect("edge target is a live candidate of its group");
                self.cur_c[e] = cur_c;
                let row = e * n;

                let frozen = self.frozen_below.is_some_and(|below| {
                    direct
                        || target < below
                        || self
                            .fixed_rows
                            .is_set_allow_out_of_bound(dep_id as usize, false)
                });
                let range = if pinned.is_set(target as usize) || frozen || dep.behavior.is_bundled()
                {
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
                index_sort::sort_slice_unstable_by(&mut self.protected, |a, b| a.cmp(b));
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
    index_sort::sort_indices(ids, &mut |a, b| order_by_name_then_version(lockfile, a, b));
}

struct Row {
    name: Box<[u8]>,
    /// The removed version.
    from: Box<[u8]>,
    /// Surviving version(s); empty when `from` is dropped outright.
    to: Box<[u8]>,
    /// Every survivor is a lower major than `from`.
    downgrade: bool,
}

#[derive(Default)]
pub(crate) struct Report {
    rows: Vec<Row>,
    kept: Vec<Box<[u8]>>,
    checked: usize,
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

fn dedupe_lockfile(
    lockfile: &mut Lockfile,
    frozen_below: Option<PackageID>,
    fixed_rows: &DynamicBitSet,
) -> Report {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let checked = pkg_res.len();
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
        if candidates.len() < 2
            || frozen_below.is_some_and(|below| candidates.iter().all(|&id| id < below))
        {
            continue;
        }
        index_sort::sort_indices(&mut candidates, &mut |a, b| {
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
        return Report {
            checked,
            ..Report::default()
        };
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
                frozen_below,
                fixed_rows,
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

    index_sort::sort_vec_by(&mut kept, |(a, _), (b, _)| {
        order_by_name_then_version(lockfile, *a, *b)
    });
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
        return Report {
            rows: Vec::new(),
            kept,
            checked,
        };
    }

    sort_by_name_then_version(lockfile, &mut removed);
    let mut slot: Vec<u32> = vec![u32::MAX; pkg_res.len()];
    for (i, &id) in removed.iter().enumerate() {
        slot[id as usize] = i as u32;
    }
    let mut targets: Vec<Vec<PackageID>> = vec![Vec::new(); removed.len()];
    let original = lockfile.buffers.resolutions.as_slice();
    for (owner, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
        if !live.is_set(owner) {
            continue;
        }
        for dep_id in slice.begin() as usize..slice.end() as usize {
            let Some(&s) = slot.get(original[dep_id] as usize) else {
                continue;
            };
            if s == u32::MAX {
                continue;
            }
            let to = cur[dep_id];
            if !targets[s as usize].contains(&to) {
                targets[s as usize].push(to);
            }
        }
    }

    let names = lockfile.packages.items_name();
    let rows: Vec<Row> = removed
        .iter()
        .zip(&targets)
        .map(|(&id, moved_to)| {
            let from_version = pkg_res[id as usize].npm().version;
            let mut from: Vec<u8> = Vec::new();
            let _ = write!(from, "{}", from_version.fmt(buf));
            let mut survivors: Vec<PackageID> = moved_to.clone();
            index_sort::sort_vec_by(&mut survivors, |&a, &b| {
                pkg_res[a as usize]
                    .npm()
                    .version
                    .order(pkg_res[b as usize].npm().version, buf, buf)
            });
            let mut to: Vec<u8> = Vec::new();
            for &c in &survivors {
                if !to.is_empty() {
                    to.extend_from_slice(b", ");
                }
                let _ = write!(to, "{}", pkg_res[c as usize].npm().version.fmt(buf));
            }
            let downgrade = survivors
                .last()
                .is_some_and(|&c| pkg_res[c as usize].npm().version.major < from_version.major);
            Row {
                name: Box::from(names[id as usize].slice(buf)),
                from: from.into_boxed_slice(),
                to: to.into_boxed_slice(),
                downgrade,
            }
        })
        .collect();

    lockfile.buffers.resolutions = cur;
    Report {
        rows,
        kept,
        checked,
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

pub fn dedupe_before_install(
    manager: &mut PackageManager,
    load_result: &LoadResult<'_>,
) -> crate::Result<()> {
    let quiet = manager.options.log_level == LogLevel::Silent;

    match load_result {
        LoadResult::NotFound => {
            if !quiet {
                Output::err_generic("missing lockfile, nothing to dedupe", ());
                bun_core::note!("run 'bun install' first");
            }
            Global::exit(1);
        }
        LoadResult::Err(cause) => {
            if crate::migration::reported_unsupported_lockfile_version(cause) {
                Global::exit(1);
            }
            if !quiet {
                Output::err_generic(
                    "failed to {s} lockfile: {s}",
                    (cause.step.verb(), cause.value.name()),
                );
                print_log_errors(manager.log_mut());
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
        if package_json_declares_dependencies(manager)? {
            refuse_out_of_date(manager);
        }
        report_already_deduplicated(
            manager,
            &Report {
                checked: manager.lockfile.packages.len(),
                ..Report::default()
            },
        );
    }
    Ok(())
}

fn print_log_errors(log: &bun_ast::Log) {
    if log.has_errors() {
        let _ = log.print(core::ptr::from_mut(Output::error_writer()));
    }
}

fn package_json_declares_dependencies(manager: &mut PackageManager) -> crate::Result<bool> {
    let quiet = manager.options.log_level == LogLevel::Silent;
    let log = manager.log_mut();
    // SAFETY: written once inside `PackageManager::init` on this thread; only read afterwards.
    let path: &[u8] = unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_bytes();
    let (source, json) =
        match manager
            .workspace_package_json_cache
            .get_with_path(log, path, Default::default())
        {
            GetJsonResult::Entry(entry) => (entry.source.clone(), entry.root),
            GetJsonResult::ReadErr(err) | GetJsonResult::ParseErr(err) => {
                if !quiet {
                    print_log_errors(log);
                    Output::err(err, "failed to read {s}", (BStr::new(path),));
                }
                Global::exit(1);
            }
        };

    let mut lockfile = Lockfile::default();
    let mut root = Package::default();
    let mut resolver: () = ();
    if let Err(err) = root.parse_with_json::<()>(
        &mut lockfile,
        manager,
        log,
        &source,
        json,
        &mut resolver,
        Features::main(),
    ) {
        if !quiet {
            print_log_errors(log);
        }
        return Err(err);
    }
    Ok(root.dependencies.len > 0)
}

fn refuse_out_of_date(manager: &PackageManager) -> ! {
    if manager.options.log_level != LogLevel::Silent {
        Output::err_generic(
            "bun.lock does not match package.json, nothing to dedupe",
            (),
        );
        bun_core::note!("run 'bun install' first");
        Output::flush();
    }
    Global::exit(1);
}

fn report_already_deduplicated(manager: &PackageManager, report: &Report) -> ! {
    if manager.options.log_level != LogLevel::Silent {
        print_kept(&report.kept);
        if manager.options.do_.summary() {
            if !report.kept.is_empty() {
                bun_core::pretty!("\n");
            }
            bun_core::pretty!(
                "🎉 <green>No duplicates<r> <d>— checked {} package{} in bun.lock, every one already resolves to a single version<r> ",
                report.checked,
                plural(report.checked)
            );
            Output::print_start_end_stdout(
                bun_core::start_time(),
                bun_core::time::nano_timestamp(),
            );
            bun_core::pretty!("\n");
        }
        Output::flush();
    }
    Global::exit(0);
}

fn print_kept(kept: &[Box<[u8]>]) {
    for line in kept {
        bun_core::prettyln!("  <d>kept<r> {}", BStr::new(line));
    }
}

fn print_would_remove(manager: &PackageManager, report: &Report) {
    print_rows(report);
    if !manager.options.do_.summary() {
        return;
    }
    let n = report.rows.len();
    bun_core::pretty!(
        "\n<b>{}<r> duplicate version{} can be removed <d>(checked {} package{} in bun.lock)<r> ",
        n,
        plural(n),
        report.checked,
        plural(report.checked)
    );
    Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
    bun_core::pretty!("\n");
}

fn print_rows(report: &Report) {
    let (glyph, arrow) = if Output::enable_ansi_colors_stdout() {
        ("↳", "→")
    } else {
        ("~", "->")
    };
    for row in &report.rows {
        if row.to.is_empty() {
            bun_core::prettyln!(
                "<cyan>{}<r> <b>{}<r> <d>{} {} (removed)<r>",
                glyph,
                BStr::new(&row.name),
                BStr::new(&row.from),
                arrow
            );
        } else if row.downgrade {
            bun_core::prettyln!(
                "<cyan>{}<r> <b>{}<r> <d>{} {}<r> <b>{}<r> <yellow>(downgrade)<r>",
                glyph,
                BStr::new(&row.name),
                BStr::new(&row.from),
                arrow,
                BStr::new(&row.to)
            );
        } else {
            bun_core::prettyln!(
                "<cyan>{}<r> <b>{}<r> <d>{} {}<r> <b>{}<r>",
                glyph,
                BStr::new(&row.name),
                BStr::new(&row.from),
                arrow,
                BStr::new(&row.to)
            );
        }
    }
    print_kept(&report.kept);
}

pub(crate) fn print_dedupe_summary(manager: &PackageManager, installed: u32, start_time: i128) {
    let Some(report) = &manager.dedupe_report else {
        return;
    };
    if manager.options.log_level == LogLevel::Silent {
        return;
    }
    print_rows(report);
    if !manager.options.do_.summary() {
        Output::flush();
        return;
    }
    let n = report.rows.len();
    bun_core::pretty!("\n<b>{}<r> duplicate version{} removed", n, plural(n));
    if installed > 0 {
        bun_core::pretty!(
            ", <b>{}<r> package{} installed",
            installed,
            plural(installed as usize)
        );
    }
    bun_core::pretty!(
        " <d>(checked {} package{} in bun.lock)<r> ",
        report.checked,
        plural(report.checked)
    );
    Output::print_start_end_stdout(start_time, bun_core::time::nano_timestamp());
    bun_core::pretty!("\n");
    Output::flush();
}

pub fn dedupe_after_differ(manager: &mut PackageManager) {
    let quiet = manager.options.log_level == LogLevel::Silent;

    if manager.summary.changes_dependencies() {
        refuse_out_of_date(manager);
    }

    let report = dedupe_lockfile(&mut manager.lockfile, None, &DynamicBitSet::default());
    if report.rows.is_empty() {
        report_already_deduplicated(manager, &report);
    }

    if manager.options.dry_run {
        if !quiet {
            print_would_remove(manager, &report);
            bun_core::prettyln!("  <cyan>bun dedupe<r>");
            Output::flush();
        }
        Global::exit(manager.options.check as u32);
    }

    if !manager.options.do_.save_lockfile() {
        if !quiet {
            let why = if !manager.options.enable.frozen_lockfile() {
                "--no-save was passed"
            } else if manager.options.local_package_features.dev_dependencies {
                "--frozen-lockfile was passed"
            } else {
                "--production implies --frozen-lockfile"
            };
            print_would_remove(manager, &report);
            Output::flush();
            let n = report.rows.len();
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> {} duplicate version{} can be removed, but {}",
                n,
                plural(n),
                why
            );
            bun_core::note!(
                "run 'bun dedupe' to remove {}, or 'bun dedupe --check' in CI",
                if n == 1 { "it" } else { "them" }
            );
            Output::flush();
        }
        Global::exit(1);
    }

    manager.dedupe_report = Some(report);
    manager
        .options
        .enable
        .set(Enable::FORCE_SAVE_LOCKFILE, true);
}

/// Collapses the versions appended this session onto the fewest that satisfy their edges, so the result does not depend on the order manifests landed in. Packages loaded from the lockfile and root/workspace rows keep their edges.
pub fn collapse_appended(manager: &mut PackageManager) {
    let lockfile = &mut *manager.lockfile;
    let frozen_below = lockfile.loaded_package_count;
    if lockfile.packages.len() as PackageID <= frozen_below {
        return;
    }
    let report = dedupe_lockfile(lockfile, Some(frozen_below), &manager.fixed_rows);
    for row in &report.rows {
        bun_output::scoped_log!(
            PackageManager,
            "collapsed {}@{} onto {}",
            BStr::new(&row.name),
            BStr::new(&row.from),
            BStr::new(&row.to)
        );
    }
}
