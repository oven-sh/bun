use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_core::{Global, Output, strings};

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
    pinned: &'a [bool],
    edges: Vec<Vec<DependencyID>>,
    candidates: Vec<PackageID>,
    sat: Vec<bool>,
    movable: Vec<bool>,
    count: Vec<u32>,
}

impl Pass<'_> {
    // Re-points the group edges owned by `voters` onto the best `live` version; also returns who voted.
    fn vote(
        &mut self,
        cur: &[PackageID],
        live: &[bool],
        voters: &[bool],
    ) -> (Vec<PackageID>, Vec<bool>) {
        let lockfile = self.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let dep_slices = lockfile.packages.items_dependencies();
        let deps = lockfile.buffers.dependencies.as_slice();

        for edges in &mut self.edges {
            edges.clear();
        }
        let mut voted = vec![false; dep_slices.len()];
        for (pkg_id, slice) in dep_slices.iter().enumerate() {
            if !voters[pkg_id] {
                continue;
            }
            for dep_id in slice.begin() as usize..slice.end() as usize {
                let target = cur[dep_id];
                if target == invalid_package_id {
                    continue;
                }
                let Some(&g) = self.group_of.get(target as usize) else {
                    continue;
                };
                if g == u32::MAX {
                    continue;
                }
                self.edges[g as usize].push(dep_id as DependencyID);
                voted[pkg_id] = true;
            }
        }

        let mut next: Vec<PackageID> = cur.to_vec();
        for (g, group) in self.groups.iter().enumerate() {
            let edges = &self.edges[g];
            if edges.is_empty() {
                continue;
            }
            self.candidates.clear();
            self.candidates
                .extend(group.iter().copied().filter(|&id| live[id as usize]));
            let candidates = self.candidates.as_slice();
            let n = candidates.len();
            if n < 2 {
                continue;
            }
            let m = edges.len();
            self.sat.clear();
            self.sat.resize(m * n, false);
            self.movable.clear();
            self.movable.resize(m, false);
            self.count.clear();
            self.count.resize(n, 0);

            for (e, &dep_id) in edges.iter().enumerate() {
                let dep = &deps[dep_id as usize];
                let target = cur[dep_id as usize];
                let cur_c = candidates
                    .iter()
                    .position(|&c| c == target)
                    .expect("edge target is a live candidate of its group");
                let row = &mut self.sat[e * n..(e + 1) * n];

                let range = if self.pinned[target as usize] || dep.behavior.is_bundled() {
                    None
                } else {
                    effective_npm_range(lockfile, dep)
                };
                match range {
                    None => row[cur_c] = true,
                    Some(range) => {
                        self.movable[e] = true;
                        let query = &range.npm().version;
                        for (c, &id) in candidates.iter().enumerate() {
                            row[c] = query.satisfies(pkg_res[id as usize].npm().version, buf, buf);
                        }
                    }
                }
                for (c, &ok) in row.iter().enumerate() {
                    self.count[c] += ok as u32;
                }
            }

            for (e, &dep_id) in edges.iter().enumerate() {
                if !self.movable[e] {
                    continue;
                }
                let row = &self.sat[e * n..(e + 1) * n];
                let mut best: Option<usize> = None;
                for c in 0..n {
                    if !row[c] {
                        continue;
                    }
                    let Some(b) = best else {
                        best = Some(c);
                        continue;
                    };
                    let better = match self.count[c].cmp(&self.count[b]) {
                        Ordering::Greater => true,
                        Ordering::Less => false,
                        Ordering::Equal => {
                            let vc = pkg_res[candidates[c] as usize].npm().version;
                            let vb = pkg_res[candidates[b] as usize].npm().version;
                            match vc.order(vb, buf, buf) {
                                Ordering::Greater => true,
                                Ordering::Less => false,
                                Ordering::Equal => candidates[c] < candidates[b],
                            }
                        }
                    };
                    if better {
                        best = Some(c);
                    }
                }
                if let Some(b) = best {
                    next[dep_id as usize] = candidates[b];
                }
            }
        }
        (next, voted)
    }

    // Packages the pass itself removes must not vote (pnpm/pnpm#9213): shrink voters until the outcome agrees.
    fn settle(&mut self, cur: &[PackageID], live: &[bool]) -> Vec<PackageID> {
        let dep_slices = self.lockfile.packages.items_dependencies();
        let mut voters = live.to_vec();
        let mut best: Option<Vec<PackageID>> = None;
        loop {
            let (next, voted) = self.vote(cur, live, &voters);
            let after = reachable(dep_slices, &next);
            if (0..after.len()).any(|p| after[p] && !voters[p]) {
                return best.unwrap_or(next);
            }
            let mut died = false;
            for p in 0..after.len() {
                if voted[p] && !after[p] {
                    voters[p] = false;
                    died = true;
                }
            }
            if !died {
                return next;
            }
            best = Some(next);
        }
    }
}

fn label(lockfile: &Lockfile, id: PackageID) -> Vec<u8> {
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

pub fn dedupe_lockfile(lockfile: &mut Lockfile) -> Vec<Box<[u8]>> {
    let pkg_res = lockfile.packages.items_resolution();
    let dep_slices = lockfile.packages.items_dependencies();
    let has_patches = lockfile.patched_dependencies.count() > 0;

    let mut groups: Vec<Vec<PackageID>> = Vec::new();
    let mut group_of: Vec<u32> = vec![u32::MAX; pkg_res.len()];
    let mut pinned: Vec<bool> = vec![false; pkg_res.len()];

    for entry in lockfile.package_index.values() {
        let PackageIndexEntry::Ids(ids) = entry else {
            continue;
        };
        let candidates: Vec<PackageID> = ids
            .iter()
            .copied()
            .filter(|&id| pkg_res[id as usize].tag == ResolutionTag::Npm)
            .collect();
        if candidates.len() < 2 {
            continue;
        }
        for &id in &candidates {
            group_of[id as usize] = groups.len() as u32;
            pinned[id as usize] = has_patches
                && lockfile.patched_dependencies.contains(
                    &bun_semver::string::Builder::string_hash(&label(lockfile, id)),
                );
        }
        groups.push(candidates);
    }

    if groups.is_empty() {
        return Vec::new();
    }

    let initial = reachable(dep_slices, &lockfile.buffers.resolutions);
    let mut live = initial.clone();
    let mut cur: Vec<PackageID> = lockfile.buffers.resolutions.to_vec();
    {
        let mut pass = Pass {
            lockfile,
            groups: &groups,
            group_of: &group_of,
            pinned: &pinned,
            edges: vec![Vec::new(); groups.len()],
            candidates: Vec::new(),
            sat: Vec::new(),
            movable: Vec::new(),
            count: Vec::new(),
        };
        loop {
            cur = pass.settle(&cur, &live);
            let after = reachable(dep_slices, &cur);
            if after == live {
                break;
            }
            live = after;
        }
    }

    let mut removed: Vec<PackageID> = groups
        .iter()
        .flatten()
        .copied()
        .filter(|&id| initial[id as usize] && !live[id as usize])
        .collect();
    if removed.is_empty() {
        return Vec::new();
    }

    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    removed.sort_by(|&a, &b| {
        let (a, b) = (a as usize, b as usize);
        strings::order(names[a].slice(buf), names[b].slice(buf)).then_with(|| {
            pkg_res[a]
                .npm()
                .version
                .order(pkg_res[b].npm().version, buf, buf)
        })
    });
    let labels = removed
        .iter()
        .map(|&id| label(lockfile, id).into_boxed_slice())
        .collect();

    lockfile.buffers.resolutions = cur;
    labels
}

pub(crate) fn effective_npm_range(
    lockfile: &Lockfile,
    dep: &Dependency,
) -> Option<dependency::Version> {
    let mut version = if dep.version.tag == DependencyVersionTag::Npm && dep.version.npm().is_alias
    {
        dep.version.clone()
    } else {
        lockfile
            .overrides
            .get(dep.name_hash)
            .unwrap_or_else(|| dep.version.clone())
    };
    if version.tag == DependencyVersionTag::Catalog {
        version = lockfile
            .catalogs
            .get(lockfile, *version.catalog(), dep.name)?
            .version;
    }
    (version.tag == DependencyVersionTag::Npm).then_some(version)
}

// Optional-peer edges are followed too: with an in-sync package.json `clean` runs with `keep_optional_peer_targets`.
fn reachable(
    dep_slices: &[crate::lockfile::DependencySlice],
    resolutions: &[PackageID],
) -> Vec<bool> {
    let mut seen = vec![false; dep_slices.len()];
    if seen.is_empty() {
        return seen;
    }
    seen[0] = true;
    let mut worklist: Vec<PackageID> = vec![0];
    while let Some(pkg_id) = worklist.pop() {
        let slice = dep_slices[pkg_id as usize];
        for i in slice.begin() as usize..slice.end() as usize {
            let target = resolutions[i];
            if target == invalid_package_id {
                continue;
            }
            let Some(slot) = seen.get_mut(target as usize) else {
                continue;
            };
            if !*slot {
                *slot = true;
                worklist.push(target);
            }
        }
    }
    seen
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

    let removed = dedupe_lockfile(&mut manager.lockfile);

    if removed.is_empty() {
        if !quiet {
            bun_core::prettyln!("Already deduplicated.");
            Output::flush();
        }
        if manager.options.dry_run {
            Global::exit(0);
        }
        return Ok(());
    }

    let n = removed.len();
    let plural = if n == 1 { "" } else { "s" };
    let mut list: Vec<u8> = Vec::new();
    for (i, label) in removed.iter().enumerate() {
        if i > 0 {
            list.extend_from_slice(b", ");
        }
        list.extend_from_slice(label);
    }

    if manager.options.dry_run {
        if !quiet {
            bun_core::prettyln!(
                "<yellow>{}<r> duplicate version{} can be removed: {}",
                n,
                plural,
                BStr::new(&list)
            );
            bun_core::note!("run 'bun dedupe' to remove them");
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
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> {} duplicate version{} can be removed, but {}: {}",
                n,
                plural,
                why,
                BStr::new(&list)
            );
            bun_core::note!("run 'bun dedupe --check' to only report duplicates");
            Output::flush();
        }
        Global::exit(1);
    }

    if !quiet {
        bun_core::prettyln!(
            "Removed <green>{}<r> duplicate version{}: {}",
            n,
            plural,
            BStr::new(&list)
        );
        Output::flush();
    }
    manager
        .options
        .enable
        .set(Enable::FORCE_SAVE_LOCKFILE, true);
    Ok(())
}
