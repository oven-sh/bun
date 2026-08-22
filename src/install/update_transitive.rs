use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::bit_set::Range as BitRange;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::{Output, UnwrapOrOom as _, pretty, prettyln, strings};
use bun_semver as Semver;

use crate::audit_fix;
use crate::dedupe;
use crate::dependency::{self, Behavior, TagExt as _};
use crate::lockfile::package::PackageColumns as _;
use crate::lockfile::{Lockfile, PackageIndexEntry};
use crate::npm::PackageManifest;
use crate::package_manager::Options::LogLevel;
use crate::package_manager::ROOT_PACKAGE_JSON_PATH;
use crate::package_manager_real::populate_manifest_cache::{self, Packages};
use crate::package_manager_real::{PackageUpdateInfo, enqueue_dependency_with_main};
use crate::update_scope::UpdateScope;
use crate::{
    DependencyID, DependencyVersionTag, GetJsonOptions, GetJsonResult, PackageID, PackageManager,
    PackageNameHash, ResolutionTag, invalid_package_id,
};

/// Root/workspace dependency rows as loaded from bun.lock, taken before the differ re-enqueues them.
#[derive(Default)]
pub struct DirectDependencies {
    owners: Vec<(PackageID, u32, u32)>,
    rows: Vec<(PackageNameHash, Behavior, PackageID)>,
}

impl DirectDependencies {
    pub fn snapshot(lockfile: &Lockfile) -> DirectDependencies {
        let pkg_res = lockfile.packages.items_resolution();
        let dep_slices = lockfile.packages.items_dependencies();
        let res_slices = lockfile.packages.items_resolutions();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();

        let mut out = DirectDependencies::default();
        for owner in 0..pkg_res.len() {
            if !matches!(
                pkg_res[owner].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            ) {
                continue;
            }
            let start = out.rows.len();
            out.rows.extend(
                dep_slices[owner]
                    .get(deps)
                    .iter()
                    .zip(res_slices[owner].get(resolutions))
                    .map(|(dep, &resolved)| (dep.name_hash, dep.behavior, resolved)),
            );
            out.owners.push((
                owner as PackageID,
                start as u32,
                (out.rows.len() - start) as u32,
            ));
        }
        out
    }

    /// Edges still resolving to the previous package of a direct dependency that moved follow it when their range allows.
    pub fn redirect_dependents(&self, lockfile: &mut Lockfile) {
        if self.owners.is_empty() || lockfile.loaded_package_count == 0 {
            return;
        }
        redirect(lockfile, self.moved_pairs(lockfile));
    }

    fn moved_pairs(&self, lockfile: &Lockfile) -> Vec<(PackageID, PackageID)> {
        let packages_len = lockfile.packages.len();
        let pkg_res = lockfile.packages.items_resolution();
        let name_hashes = lockfile.packages.items_name_hash();
        let dep_slices = lockfile.packages.items_dependencies();
        let res_slices = lockfile.packages.items_resolutions();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();

        let mut pairs: Vec<(PackageID, PackageID)> = Vec::new();
        for &(owner, start, len) in &self.owners {
            let owner = owner as usize;
            if owner >= packages_len {
                continue;
            }
            let rows = &self.rows[start as usize..(start + len) as usize];
            let mut claimed: Option<DynamicBitSet> = None;
            let current = dep_slices[owner]
                .get(deps)
                .iter()
                .zip(res_slices[owner].get(resolutions));
            for (i, (dep, &new)) in current.enumerate() {
                let same = |row: &(PackageNameHash, Behavior, PackageID)| {
                    row.0 == dep.name_hash && row.1 == dep.behavior
                };
                let index = if claimed.is_none() && rows.get(i).is_some_and(same) {
                    i
                } else {
                    // Every row before the first miss was a same-index hit.
                    let taken = claimed.get_or_insert_with(|| {
                        let mut taken = DynamicBitSet::init_empty(rows.len()).unwrap_or_oom();
                        taken.set_range_value(
                            BitRange {
                                start: 0,
                                end: i.min(rows.len()),
                            },
                            true,
                        );
                        taken
                    });
                    let hit = if !taken.is_set_allow_out_of_bound(i, true) && same(&rows[i]) {
                        Some(i)
                    } else {
                        (0..rows.len()).find(|&k| !taken.is_set(k) && same(&rows[k]))
                    };
                    let Some(k) = hit else {
                        continue;
                    };
                    taken.set(k);
                    k
                };
                let old = rows[index].2;
                if old == new
                    || (old as usize) >= packages_len
                    || (new as usize) >= packages_len
                    || pkg_res[new as usize].tag != ResolutionTag::Npm
                    || name_hashes[old as usize] != name_hashes[new as usize]
                {
                    continue;
                }
                pairs.push((old, new));
            }
        }
        pairs
    }
}

/// One row per `(old, new)` npm pair, with the `(vX available)` hint of the `+` rows.
fn rows_between(manager: &mut PackageManager, pairs: Vec<(PackageID, PackageID)>) -> Vec<Row> {
    let mut rows = Vec::with_capacity(pairs.len());
    for (old, new) in pairs {
        let (name, from, to) = {
            let lockfile: &Lockfile = &manager.lockfile;
            let buf = lockfile.buffers.string_bytes.as_slice();
            let pkg_res = lockfile.packages.items_resolution();
            if pkg_res[old as usize].tag != ResolutionTag::Npm {
                continue;
            }
            (
                Box::<[u8]>::from(lockfile.packages.items_name()[old as usize].slice(buf)),
                text(pkg_res[old as usize].npm().version.fmt(buf)),
                text(pkg_res[new as usize].npm().version.fmt(buf)),
            )
        };
        let later = later_in_cache(manager, new);
        rows.push(Row {
            name,
            from,
            to,
            later,
        });
    }
    rows
}

fn later_in_cache(manager: &mut PackageManager, pkg_id: PackageID) -> Box<[u8]> {
    let (name, name_hash, resolution) = {
        let lockfile: &Lockfile = &manager.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        (
            Box::<[u8]>::from(lockfile.packages.items_name()[pkg_id as usize].slice(buf)),
            lockfile.packages.items_name_hash()[pkg_id as usize],
            lockfile.packages.items_resolution()[pkg_id as usize],
        )
    };
    match manager.format_later_version_in_cache(&name, name_hash, &resolution) {
        Some(later) => text(later),
        None => Box::default(),
    }
}

/// `moved` as recorded by the named path (row, package it resolved to before), paired with what the row resolves to now.
fn named_pairs(
    lockfile: &Lockfile,
    moved: &[(DependencyID, PackageID)],
) -> Vec<(PackageID, PackageID)> {
    let packages_len = lockfile.packages.len();
    let pkg_res = lockfile.packages.items_resolution();
    let name_hashes = lockfile.packages.items_name_hash();
    let resolutions = lockfile.buffers.resolutions.as_slice();
    moved
        .iter()
        .map(|&(dep_id, from)| (from, resolutions[dep_id as usize]))
        .filter(|&(from, to)| {
            from != to
                && (from as usize) < packages_len
                && (to as usize) < packages_len
                && pkg_res[to as usize].tag == ResolutionTag::Npm
                && name_hashes[from as usize] == name_hashes[to as usize]
        })
        .collect()
}

/// Every edge still resolving to an `old` package whose range accepts its `new` npm package is re-pointed at it.
fn redirect(lockfile: &mut Lockfile, pairs: Vec<(PackageID, PackageID)>) {
    if pairs.is_empty() {
        return;
    }
    let mut new_of: Vec<PackageID> = vec![invalid_package_id; lockfile.packages.len()];
    for (old, new) in pairs {
        let slot = &mut new_of[old as usize];
        if *slot == invalid_package_id {
            *slot = new;
        }
    }

    let moved: Vec<(usize, PackageID)> = {
        let lockfile: &Lockfile = lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let deps = lockfile.buffers.dependencies.as_slice();
        let mut moved = Vec::new();
        for (j, &target) in lockfile.buffers.resolutions.iter().enumerate() {
            let Some(&new) = new_of.get(target as usize) else {
                continue;
            };
            if new == invalid_package_id {
                continue;
            }
            let dep = &deps[j];
            if dep.behavior.is_bundled() {
                continue;
            }
            let Some(range) = dedupe::effective_npm_range(lockfile, j as DependencyID, dep) else {
                continue;
            };
            if range
                .npm()
                .version
                .satisfies(pkg_res[new as usize].npm().version, buf, buf)
            {
                moved.push((j, new));
            }
        }
        moved
    };
    for (j, new) in moved {
        lockfile.buffers.resolutions[j] = new;
    }
}

struct Pin {
    dep_id: DependencyID,
    from: PackageID,
    /// `None` re-resolves the edge through its own dist-tag.
    to: Option<Semver::Version>,
}

struct Planned {
    v: Semver::Version,
    /// `None` re-resolves the edge through its own dist-tag.
    to: Option<Semver::Version>,
    later: Box<[u8]>,
}

/// The transitive half of a bare `bun update`: every edge owned by a non-workspace package the selected workspaces reach (all of them from the root or with -r) moves to the newest release its own range allows, or to wherever its dist-tag points now.
#[derive(Default)]
pub struct TransitiveUpdate {
    pins: Vec<Pin>,
    /// Kept for `print_plan` when no install summary will print the rows (`--dry-run`, `--lockfile-only`).
    report: Option<Report>,
}

impl TransitiveUpdate {
    /// Runs once the differ has installed package.json's overrides and catalogs, before anything is enqueued; the moves surface as update rows of the install summary, or via `print_plan`.
    pub fn plan(
        manager: &mut PackageManager,
        direct: &DirectDependencies,
    ) -> crate::Result<TransitiveUpdate> {
        let edges = {
            let lockfile = &*manager.lockfile;
            let scope = UpdateScope::of(&*manager);
            let owners = (!scope.is_whole_workspace()).then(|| scope.reachable(lockfile));
            let mut edges = DynamicBitSet::init_empty(lockfile.buffers.dependencies.len())?;
            for owner in 0..lockfile.packages.len() {
                if owners.is_none_or(|reachable| reachable.is_set_allow_out_of_bound(owner, false))
                {
                    set_rows_of(&mut edges, lockfile, owner);
                }
            }
            edges
        };
        let (pins, report) = plan_edges(manager, &edges, direct)?;
        register_moved(manager, &report.moved)?;
        let printed_here = manager.options.dry_run || manager.options.lockfile_only;
        Ok(TransitiveUpdate {
            pins,
            report: printed_here.then_some(report),
        })
    }

    /// Runs after the differ's own enqueues (including its override/catalog invalidation loops) so the pins win; edges the differ moved off their package are left to it.
    pub fn enqueue(&self, manager: &mut PackageManager) -> crate::Result<()> {
        self.enqueue_inner(manager, None)
    }

    /// Like `enqueue`, also returning the rows it pinned so later invalidation passes leave them alone.
    pub fn enqueue_tracked(&self, manager: &mut PackageManager) -> crate::Result<DynamicBitSet> {
        let mut pinned = DynamicBitSet::init_empty(manager.lockfile.buffers.resolutions.len())?;
        self.enqueue_inner(manager, Some(&mut pinned))?;
        Ok(pinned)
    }

    fn enqueue_inner(
        &self,
        manager: &mut PackageManager,
        mut pinned: Option<&mut DynamicBitSet>,
    ) -> crate::Result<()> {
        if self.pins.is_empty() {
            return Ok(());
        }
        let _ = manager.get_cache_directory();
        let _ = manager.get_temporary_directory();
        for pin in &self.pins {
            if manager.lockfile.buffers.resolutions[pin.dep_id as usize] != pin.from {
                continue;
            }
            match pin.to {
                Some(to) => audit_fix::enqueue_pinned(manager, pin.dep_id, to)?,
                None => reresolve(manager, pin.dep_id)?,
            }
            if let Some(pinned) = pinned.as_deref_mut() {
                pinned.set(pin.dep_id as usize);
            }
            manager.summary.update += 1;
        }
        Ok(())
    }

    /// `--dry-run` / `--lockfile-only` have no install summary: once everything is resolved this prints the update rows (transitive plan, moved direct dependencies, `named` moves) and, for a dry run, the count line.
    pub fn print_plan(
        &self,
        manager: &mut PackageManager,
        direct: &DirectDependencies,
        named: &[(DependencyID, PackageID)],
    ) {
        let options = &manager.options;
        if manager.subcommand != crate::Subcommand::Update
            || !(options.dry_run || options.lockfile_only)
            || !options.do_.summary()
        {
            return;
        }
        let dry_run = options.dry_run;
        let mut rows = self
            .report
            .as_ref()
            .map_or_else(Vec::new, |report| report.rows.clone());
        let mut pairs = direct.moved_pairs(&manager.lockfile);
        pairs.extend(named_pairs(&manager.lockfile, named));
        rows.extend(rows_between(manager, pairs));
        sort_dedup_rows(&mut rows);
        let kept = kept_patched_rows(manager);
        if !dry_run && rows.is_empty() && kept.is_empty() {
            return;
        }
        prettyln!("");
        print_rows(&rows);
        print_kept_rows(&kept);
        if dry_run {
            if !rows.is_empty() || !kept.is_empty() {
                prettyln!("");
            }
            if rows.is_empty() {
                let n = manager.lockfile.packages.len();
                pretty!(
                    "Checked <green>{} package{}<r>, nothing to update ",
                    n,
                    if n == 1 { "" } else { "s" }
                );
            } else {
                let n = rows.len();
                pretty!(
                    "<green>{}<r> package{} would be updated ",
                    n,
                    if n == 1 { "" } else { "s" }
                );
            }
            Output::print_start_end_stdout(
                bun_core::start_time(),
                bun_core::time::nano_timestamp(),
            );
            prettyln!("");
        }
        Output::flush();
    }

    /// Once everything is resolved, the edges the plan skipped (peers that have a provider, bundled rows, other workspaces' pins) follow a moved package when their range allows, as they do for a moved direct dependency.
    pub fn redirect_dependents(&self, lockfile: &mut Lockfile) {
        let moved: Vec<(DependencyID, PackageID)> =
            self.pins.iter().map(|pin| (pin.dep_id, pin.from)).collect();
        redirect_moved_edges(lockfile, &moved);
    }
}

/// `bun update <name> --latest`: the edges owned by the given packages move in-range as under a bare update; call before anything is enqueued (like `plan`) and pass the returned moves to `redirect_moved_edges` once resolved.
pub(crate) fn refresh_children_of(
    manager: &mut PackageManager,
    package_ids: &[PackageID],
) -> crate::Result<Vec<(DependencyID, PackageID)>> {
    if package_ids.is_empty() {
        return Ok(Vec::new());
    }
    let edges = {
        let lockfile = &*manager.lockfile;
        let mut edges = DynamicBitSet::init_empty(lockfile.buffers.dependencies.len())?;
        for &owner in package_ids {
            if (owner as usize) < lockfile.packages.len() {
                set_rows_of(&mut edges, lockfile, owner as usize);
            }
        }
        edges
    };
    let (pins, report) = plan_edges(manager, &edges, &DirectDependencies::default())?;
    register_moved(manager, &report.moved)?;
    let update = TransitiveUpdate { pins, report: None };
    update.enqueue(manager)?;
    Ok(update
        .pins
        .iter()
        .map(|pin| (pin.dep_id, pin.from))
        .collect())
}

/// Only the synchronous resolve sees the cleared peer bit (the manifest callback re-reads the buffer row), so callers fetch the manifest first.
fn reresolve(manager: &mut PackageManager, dep_id: DependencyID) -> crate::Result<()> {
    let mut dep = manager.lockfile.buffers.dependencies[dep_id as usize].clone();
    dep.behavior = dep.behavior.with(Behavior::PEER, false);
    manager.lockfile.buffers.resolutions[dep_id as usize] = invalid_package_id;
    enqueue_dependency_with_main(manager, dep_id, &dep, invalid_package_id, false)
}

/// `bun update <name>`: the `plannable_peer_rows` naming a requested package, re-resolved after their manifests are fetched; each is appended to `moved` for `redirect_moved_edges`, and every package in `moved` is registered so the summary prints its update row.
pub(crate) fn enqueue_peer_rows(
    manager: &mut PackageManager,
    rows: &[DependencyID],
    moved: &mut Vec<(DependencyID, PackageID)>,
) -> crate::Result<()> {
    if !rows.is_empty() {
        let mut targets: Vec<PackageID> = rows
            .iter()
            .map(|&row| manager.lockfile.buffers.resolutions[row as usize])
            .collect();
        index_sort::sort_indices_unstable(&mut targets, &mut |a, b| a.cmp(&b));
        targets.dedup();
        populate_manifest_cache::populate_manifest_cache(manager, Packages::Exact(&targets))?;
        print_log(manager)?;
        for &row in rows {
            moved.push((row, manager.lockfile.buffers.resolutions[row as usize]));
            reresolve(manager, row)?;
        }
    }
    let mut from: Vec<PackageID> = moved.iter().map(|&(_, from)| from).collect();
    index_sort::sort_indices_unstable(&mut from, &mut |a, b| a.cmp(&b));
    from.dedup();
    register_moved(manager, &from)
}

/// Pending log lines go to stderr; `--silent` drops everything but errors.
fn print_log(manager: &PackageManager) -> crate::Result<()> {
    let log = manager.log_mut();
    if manager.options.log_level != LogLevel::Silent || log.has_errors() {
        log.print(core::ptr::from_mut(Output::error_writer()))?;
    }
    log.reset();
    Ok(())
}

/// `moved` pairs an invalidated edge with the package it used to resolve to; every other edge still on that package follows it to the edge's new npm resolution when its range allows.
pub(crate) fn redirect_moved_edges(lockfile: &mut Lockfile, moved: &[(DependencyID, PackageID)]) {
    let pairs: Vec<(PackageID, PackageID)> = {
        let pkg_res = lockfile.packages.items_resolution();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        moved
            .iter()
            .map(|&(dep_id, from)| (from, resolutions[dep_id as usize]))
            .filter(|&(from, to)| {
                to != from
                    && (to as usize) < pkg_res.len()
                    && pkg_res[to as usize].tag == ResolutionTag::Npm
            })
            .collect()
    };
    redirect(lockfile, pairs);
}

/// Packages of `cleaned` that the `moved` edges of `before_clean` resolved to, for seeding the security scan.
pub(crate) fn moved_targets_after_clean(
    before_clean: &Lockfile,
    cleaned: &Lockfile,
    moved: &[(DependencyID, PackageID)],
) -> Vec<PackageID> {
    if moved.is_empty() {
        return Vec::new();
    }
    let old_resolutions = before_clean.buffers.resolutions.as_slice();
    let old_name_hashes = before_clean.packages.items_name_hash();
    let old_res = before_clean.packages.items_resolution();
    let old_buf = before_clean.buffers.string_bytes.as_slice();
    let new_res = cleaned.packages.items_resolution();
    let new_buf = cleaned.buffers.string_bytes.as_slice();

    let mut targets: Vec<PackageID> = Vec::new();
    for &(dep_id, _) in moved {
        let Some(&old_id) = old_resolutions.get(dep_id as usize) else {
            continue;
        };
        if (old_id as usize) >= old_res.len() {
            continue;
        }
        let Some(entry) = cleaned.package_index.get(&old_name_hashes[old_id as usize]) else {
            continue;
        };
        if let Some(&id) = entry
            .as_slice()
            .iter()
            .find(|&&c| new_res[c as usize].eql(&old_res[old_id as usize], new_buf, old_buf))
        {
            targets.push(id);
        }
    }
    targets
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Row {
    name: Box<[u8]>,
    from: Box<[u8]>,
    to: Box<[u8]>,
    /// The `latest` dist-tag when it is newer than `to`; empty otherwise.
    later: Box<[u8]>,
}

#[derive(Default)]
struct Report {
    rows: Vec<Row>,
    /// Pre-clean ids of the instances at least one row moves away from.
    moved: Vec<PackageID>,
}

/// Registers each npm package of `moved` (pre-clean ids) like a `bun update <name>` request so the install summary prints its update row; a name with several moving instances keeps its lowest original.
pub(crate) fn register_moved(
    manager: &mut PackageManager,
    moved: &[PackageID],
) -> crate::Result<()> {
    if moved.is_empty() {
        return Ok(());
    }
    let lockfile: &Lockfile = &manager.lockfile;
    let updating = &mut manager.updating_packages;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let names = lockfile.packages.items_name();
    let res = lockfile.packages.items_resolution();
    for &pkg_id in moved {
        if (pkg_id as usize) >= res.len() || res[pkg_id as usize].tag != ResolutionTag::Npm {
            continue;
        }
        let current = res[pkg_id as usize].npm().version;
        let entry = updating.get_or_put(names[pkg_id as usize].slice(buf))?;
        if entry.found_existing {
            let info = &*entry.value_ptr;
            let keep = !info.original_version_literal.is_empty()
                || info.original_version.is_some_and(|original| {
                    original.order(current, &info.original_version_string_buf, buf)
                        != Ordering::Greater
                });
            if keep {
                continue;
            }
        }
        let mut tag_buf =
            vec![0u8; current.tag.pre.len() + current.tag.build.len()].into_boxed_slice();
        let mut cursor: &mut [u8] = &mut tag_buf;
        let original = current.clone_into(buf, &mut cursor);
        *entry.value_ptr = PackageUpdateInfo {
            original_version_literal: Box::default(),
            written_back: false,
            original_version_string_buf: tag_buf,
            original_version: Some(original),
        };
    }
    Ok(())
}

fn text(value: impl core::fmt::Display) -> Box<[u8]> {
    let mut out: Vec<u8> = Vec::new();
    let _ = write!(out, "{value}");
    out.into_boxed_slice()
}

fn sort_dedup_rows(rows: &mut Vec<Row>) {
    index_sort::sort_vec_unstable_by(rows, |a, b| a.cmp(b));
    rows.dedup_by(|a, b| a.name == b.name && a.from == b.from && a.to == b.to);
}

/// The install family's version-change glyphs, degraded to ASCII when stdout has no colors.
pub struct RowGlyphs {
    pub up: &'static str,
    pub down: &'static str,
    pub arrow: &'static str,
}

pub fn row_glyphs() -> RowGlyphs {
    if Output::enable_ansi_colors_stdout() {
        RowGlyphs {
            up: "↑",
            down: "↓",
            arrow: "→",
        }
    } else {
        RowGlyphs {
            up: "^",
            down: "v",
            arrow: "->",
        }
    }
}

/// `↑ name from → to` (`↓` in yellow for a downgrade) without the newline, so callers can append a suffix.
pub fn pretty_update_row(name: &[u8], from: &[u8], to: &[u8], downgrade: bool) {
    let glyphs = row_glyphs();
    if downgrade {
        pretty!("<yellow>{}<r> ", glyphs.down);
    } else {
        pretty!("<cyan>{}<r> ", glyphs.up);
    }
    pretty!(
        "<b>{}<r> <d>{} {}<r> <b><cyan>{}<r>",
        BStr::new(name),
        BStr::new(from),
        glyphs.arrow,
        BStr::new(to)
    );
}

fn print_rows(rows: &[Row]) {
    for row in rows {
        pretty_update_row(&row.name, &row.from, &row.to, false);
        if !row.later.is_empty() {
            pretty!(" <d>(<blue>v{} available<r><d>)<r>", BStr::new(&row.later));
        }
        prettyln!("");
    }
}

/// `name@version` of every drained `manager.kept_patched` id (pre-clean) whose rows would allow something newer, with that version.
fn kept_patched_rows(manager: &mut PackageManager) -> Vec<Row> {
    let mut kept = core::mem::take(&mut manager.kept_patched);
    index_sort::sort_indices_unstable(&mut kept, &mut |a, b| a.cmp(&b));
    kept.dedup();
    let mut rows = Vec::new();
    for id in kept {
        let Some(later) = newest_allowed(manager, id) else {
            continue;
        };
        let lockfile: &Lockfile = &manager.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        rows.push(Row {
            name: Box::from(lockfile.packages.items_name()[id as usize].slice(buf)),
            from: text(
                lockfile.packages.items_resolution()[id as usize]
                    .npm()
                    .version
                    .fmt(buf),
            ),
            to: Box::default(),
            later,
        });
    }
    rows
}

fn render_kept_rows(rows: &[Row]) -> Vec<u8> {
    let colors = Output::enable_ansi_colors_stdout();
    let mut out: Vec<u8> = Vec::new();
    for row in rows {
        let _ = bun_core::write_pretty!(
            out,
            colors,
            "<d>kept<r> <b>{}<r><d>@{}<r> <d>(patched, <blue>v{} available<r><d>)<r>\n",
            BStr::new(&row.name),
            BStr::new(&row.from),
            BStr::new(&row.later)
        );
    }
    out
}

fn print_kept_rows(rows: &[Row]) {
    if !rows.is_empty() {
        Output::print(format_args!("{}", BStr::new(&render_kept_rows(rows))));
    }
}

/// Once after resolution, before the lockfile is cleaned: the patched packages a move was held back for, rendered for the install summary (`tree_printer` flushes `kept_patched_text` after the update rows); `print_plan` prints them itself when it runs first.
pub(crate) fn print_kept_patched(manager: &mut PackageManager) {
    if manager.kept_patched.is_empty() {
        return;
    }
    if !manager.options.do_.summary() {
        manager.kept_patched.clear();
        return;
    }
    let rows = kept_patched_rows(manager);
    manager.kept_patched_text = render_kept_rows(&rows);
}

/// After `bun update` cleaned the lockfile: one warning per root `patchedDependencies` key whose `name@version` no longer names an installed npm package.
pub(crate) fn warn_orphaned_patches(manager: &mut PackageManager) {
    if manager.lockfile.patched_dependencies.count() == 0
        || manager.options.log_level == LogLevel::Silent
    {
        return;
    }
    let keys: Vec<Box<[u8]>> = {
        let log = manager.log_mut();
        // SAFETY: written once inside `PackageManager::init` on this thread; only read afterwards.
        let path: &[u8] = unsafe { ROOT_PACKAGE_JSON_PATH.read() }.as_bytes();
        let opts = GetJsonOptions {
            init_reset_store: false,
            ..Default::default()
        };
        let GetJsonResult::Entry(entry) = manager
            .workspace_package_json_cache
            .get_with_path(log, path, opts)
        else {
            return;
        };
        let Some(patched) = entry.root.get_object(b"patchedDependencies") else {
            return;
        };
        let mut keys: Vec<Box<[u8]>> = Vec::with_capacity(patched.property_count());
        patched.for_each_property(|key, _, _| keys.push(Box::from(key)));
        keys
    };

    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    for key in keys {
        let Some(at) = strings::last_index_of_char(&key, b'@').filter(|&at| at > 0) else {
            continue;
        };
        let Some(patch) = lockfile
            .patched_dependencies
            .get(&Semver::string::Builder::string_hash(&key))
        else {
            continue;
        };
        let (name, version) = (&key[..at], &key[at + 1..]);
        let installed: &[PackageID] = lockfile
            .package_index
            .get(&Semver::string::Builder::string_hash(name))
            .map_or(&[], PackageIndexEntry::as_slice);
        if installed
            .iter()
            .any(|&id| pkg_res[id as usize].tag != ResolutionTag::Npm)
        {
            continue;
        }
        let mut now: Vec<u8> = Vec::new();
        let mut still_applies = false;
        for &id in installed {
            let current = text(pkg_res[id as usize].npm().version.fmt(buf));
            if &*current == version {
                still_applies = true;
                break;
            }
            if !now.is_empty() {
                now.extend_from_slice(b", ");
            }
            now.extend_from_slice(&current);
        }
        if still_applies {
            continue;
        }
        if now.is_empty() {
            bun_core::warn!(
                "{} no longer applies ({} is no longer installed)",
                BStr::new(patch.path.slice(buf)),
                BStr::new(name)
            );
        } else {
            bun_core::warn!(
                "{} no longer applies ({} is now {})",
                BStr::new(patch.path.slice(buf)),
                BStr::new(name),
                BStr::new(&now)
            );
        }
    }
    Output::flush();
}

/// Newest release the rows still resolving to `pkg_id` allow, when it is newer than the installed one.
fn newest_allowed(manager: &mut PackageManager, pkg_id: PackageID) -> Option<Box<[u8]>> {
    let cache_ctx = manager.manifest_disk_cache_ctx();
    let min_age = manager.options.minimum_release_age_ms;
    let excludes = manager.options.minimum_release_age_excludes;
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let pkg = pkg_id as usize;
    let res = lockfile.packages.items_resolution();
    if pkg >= res.len() || res[pkg].tag != ResolutionTag::Npm {
        return None;
    }
    let current = res[pkg].npm().version;
    let name = lockfile.packages.items_name()[pkg].slice(buf);
    let manifest: &PackageManifest = manager.manifests.by_name_hash_allow_expired(
        cache_ctx,
        manager.options.scope_for_package_name(name),
        name,
        lockfile.packages.items_name_hash()[pkg],
        Some(&mut false),
        min_age.is_some(),
    )?;
    let manifest_buf: &[u8] = &manifest.string_buf;
    let mut best: Option<Semver::Version> = None;
    let rows = lockfile
        .buffers
        .dependencies
        .iter()
        .zip(lockfile.buffers.resolutions.iter())
        .enumerate();
    for (dep_id, (dep, &target)) in rows {
        if target != pkg_id || dep.behavior.is_bundled() {
            continue;
        }
        let Some(range) = dedupe::effective_npm_range(lockfile, dep_id as DependencyID, dep) else {
            continue;
        };
        let Some(found) = manifest
            .find_best_version_with_filter(&range.npm().version, buf, min_age, excludes)
            .unwrap()
        else {
            continue;
        };
        if best.is_none_or(|best| {
            found.version.order(best, manifest_buf, manifest_buf) == Ordering::Greater
        }) {
            best = Some(found.version);
        }
    }
    let best = best?;
    (best.order(current, manifest_buf, buf) == Ordering::Greater)
        .then(|| text(best.fmt(manifest_buf)))
}

/// Pairs each unchecked `(name, version)` with the fetch failure the manifest task logged for it and reports both as one warning; nothing under `--silent`.
fn warn_unchecked(
    manager: &PackageManager,
    msgs_before: usize,
    unchecked: &[(Box<[u8]>, Box<[u8]>)],
) {
    if unchecked.is_empty() {
        return;
    }
    let log = manager.log_mut();
    let silent = manager.options.log_level == LogLevel::Silent;
    let mut used = DynamicBitSet::init_empty(log.msgs.len()).unwrap_or_oom();
    for (name, version) in unchecked {
        let reason = log
            .msgs
            .iter()
            .enumerate()
            .skip(msgs_before)
            .find(|(_, msg)| msg.kind == bun_ast::Kind::Warn && mentions(&msg.data.text, name));
        if let Some((i, _)) = reason {
            used.set(i);
        }
        if silent {
            continue;
        }
        match reason {
            Some((_, msg)) => bun_core::warn!(
                "{}@{} was not checked for updates: {}",
                BStr::new(name),
                BStr::new(version),
                BStr::new(&msg.data.text)
            ),
            None => bun_core::warn!(
                "{}@{} was not checked for updates",
                BStr::new(name),
                BStr::new(version)
            ),
        }
    }
    let consumed = used.count();
    if consumed == 0 {
        return;
    }
    let mut i = 0usize;
    log.msgs.retain(|_| {
        let keep = !used.is_set(i);
        i += 1;
        keep
    });
    log.warnings = log.warnings.saturating_sub(consumed as u32);
}

/// The fetch failures name the package as a URL segment (`/` + name, `/` encoded as `%2f`) or after `manifest `, followed by a space, an escape, or the end.
fn mentions(message: &[u8], name: &[u8]) -> bool {
    if mentions_spelling(message, name) {
        return true;
    }
    strings::contains_char(name, b'/')
        && mentions_spelling(message, &strings::replace_owned(name, b"/", b"%2f"))
}

fn mentions_spelling(message: &[u8], spelling: &[u8]) -> bool {
    let mut offset = 0usize;
    while let Some(i) = strings::index_of(&message[offset..], spelling) {
        let start = offset + i;
        let end = start + spelling.len();
        let bounded_before = start == 0 || matches!(message[start - 1], b'/' | b' ' | b'm');
        let bounded_after = message.get(end).is_none_or(|&b| b == b' ' || b == 0x1b);
        if bounded_before && bounded_after {
            return true;
        }
        offset = start + 1;
    }
    false
}

struct Want {
    literal: Option<Semver::String>,
    /// Post-override/catalog version; `Npm` or `DistTag`.
    version: dependency::Version,
    dep_ids: Vec<DependencyID>,
}

struct Instance {
    pkg_id: PackageID,
    current: Semver::Version,
    wants: Vec<Want>,
    /// Patched: the manifest is still fetched so the kept row can say what it would have moved to.
    held: bool,
}

/// Workspace-owned rows belong to the differ; rows it orphaned by re-parsing a workspace belong to nobody.
fn set_rows_of(edges: &mut DynamicBitSet, lockfile: &Lockfile, owner: usize) {
    let slice = lockfile.packages.items_dependencies()[owner];
    if slice.len == 0
        || matches!(
            lockfile.packages.items_resolution()[owner].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        )
    {
        return;
    }
    edges.set_range_value(
        BitRange {
            start: slice.begin() as usize,
            end: slice.end() as usize,
        },
        true,
    );
}

/// Peer rows of non-workspace packages whose target nothing depends on outright: the peer is the package's only reason to exist, so an update re-resolves it instead of following a provider.
pub(crate) fn plannable_peer_rows(
    lockfile: &Lockfile,
    direct: &DirectDependencies,
) -> DynamicBitSet {
    let packages_len = lockfile.packages.len();
    let pkg_res = lockfile.packages.items_resolution();
    let dep_slices = lockfile.packages.items_dependencies();
    let res_slices = lockfile.packages.items_resolutions();
    let deps = lockfile.buffers.dependencies.as_slice();
    let resolutions = lockfile.buffers.resolutions.as_slice();

    let mut providers = DynamicBitSet::init_empty(packages_len).unwrap_or_oom();
    for &(_, behavior, resolved) in &direct.rows {
        if !behavior.is_peer() && (resolved as usize) < packages_len {
            providers.set(resolved as usize);
        }
    }
    for owner in 0..packages_len {
        let owned = dep_slices[owner]
            .get(deps)
            .iter()
            .zip(res_slices[owner].get(resolutions));
        for (dep, &resolved) in owned {
            if !dep.behavior.is_peer() && (resolved as usize) < packages_len {
                providers.set(resolved as usize);
            }
        }
    }

    let mut rows = DynamicBitSet::init_empty(deps.len()).unwrap_or_oom();
    for owner in 0..packages_len {
        if matches!(
            pkg_res[owner].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        ) {
            continue;
        }
        let first = dep_slices[owner].begin() as usize;
        let owned = dep_slices[owner]
            .get(deps)
            .iter()
            .zip(res_slices[owner].get(resolutions));
        for (i, (dep, &resolved)) in owned.enumerate() {
            if dep.behavior.is_peer()
                && !dep.behavior.is_optional_peer()
                && (resolved as usize) < packages_len
                && !providers.is_set(resolved as usize)
            {
                rows.set(first + i);
            }
        }
    }
    rows
}

/// `edges` selects the rows to plan; each moves to the newest release its (post-override/catalog) range allows, or follows its dist-tag.
fn plan_edges(
    manager: &mut PackageManager,
    edges: &DynamicBitSet,
    direct: &DirectDependencies,
) -> crate::Result<(Vec<Pin>, Report)> {
    let mut instances: Vec<Instance> = Vec::new();
    let mut kept: Vec<PackageID> = Vec::new();
    {
        let lockfile = &*manager.lockfile;
        let res = lockfile.packages.items_resolution();
        let has_patches = lockfile.patched_dependencies.count() > 0;
        const SKIP: u32 = u32::MAX - 1;
        let mut instance_of: Vec<u32> = vec![u32::MAX; res.len()];

        let no_overrides = lockfile.overrides.is_empty();
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_names = lockfile.packages.items_name();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();
        let mut plannable_peers: Option<DynamicBitSet> = None;
        let mut set_edges = edges.iterator::<true, true>();
        while let Some(dep_id) = set_edges.next() {
            let Some(&target) = resolutions.get(dep_id) else {
                break;
            };
            let Some(&slot) = instance_of.get(target as usize) else {
                continue;
            };
            let dep = &deps[dep_id];
            if slot == SKIP || dep.behavior.is_bundled() {
                continue;
            }
            if dep.behavior.is_peer()
                && !plannable_peers
                    .get_or_insert_with(|| plannable_peer_rows(lockfile, direct))
                    .is_set(dep_id)
            {
                continue;
            }
            let instance = if slot != u32::MAX {
                slot
            } else {
                let pkg_id = target as usize;
                if res[pkg_id].tag != ResolutionTag::Npm {
                    instance_of[pkg_id] = SKIP;
                    continue;
                }
                let held = has_patches
                    && lockfile.patched_dependencies.contains(
                        &Semver::string::Builder::string_hash(&dedupe::label(lockfile, target)),
                    );
                if held {
                    kept.push(target);
                }
                instance_of[pkg_id] = instances.len() as u32;
                instances.push(Instance {
                    pkg_id: target,
                    current: res[pkg_id].npm().version,
                    wants: Vec::new(),
                    held,
                });
                instance_of[pkg_id]
            };
            let dep_id = dep_id as DependencyID;
            let inst = &mut instances[instance as usize];
            let literal = (no_overrides
                && match dep.version.tag {
                    DependencyVersionTag::Npm => !dep.version.npm().is_alias,
                    DependencyVersionTag::DistTag => true,
                    _ => false,
                })
            .then_some(dep.version.literal);
            if let Some(want) = inst
                .wants
                .iter_mut()
                .find(|want| want.literal.is_some() && want.literal == literal)
            {
                want.dep_ids.push(dep_id);
                continue;
            }
            let Some(version) = dedupe::effective_version(lockfile, dep_id, dep) else {
                continue;
            };
            let names = match version.tag {
                DependencyVersionTag::Npm => version.npm().name,
                DependencyVersionTag::DistTag => version.dist_tag().name,
                _ => continue,
            };
            if !names.eql(pkg_names[inst.pkg_id as usize], buf, buf) {
                continue;
            }
            inst.wants.push(Want {
                literal,
                version,
                dep_ids: vec![dep_id],
            });
        }
    }
    if !kept.is_empty() {
        manager.kept_patched.extend(kept);
    }
    instances.retain(|inst| !inst.wants.is_empty());
    if instances.is_empty() {
        return Ok((Vec::new(), Report::default()));
    }
    let edges_on = edges_on_instances(manager, &instances, direct);

    let ids: Vec<PackageID> = instances.iter().map(|inst| inst.pkg_id).collect();
    let msgs_before = manager.log_mut().msgs.len();
    populate_manifest_cache::populate_manifest_cache(manager, Packages::Exact(&ids))?;

    let cache_ctx = manager.manifest_disk_cache_ctx();
    let min_age = manager.options.minimum_release_age_ms;
    let excludes = manager.options.minimum_release_age_excludes;
    let buf = manager.lockfile.buffers.string_bytes.as_slice();
    let pkg_names = manager.lockfile.packages.items_name();

    let mut pins: Vec<Pin> = Vec::new();
    let mut report = Report::default();
    let mut unchecked: Vec<(Box<[u8]>, Box<[u8]>)> = Vec::new();
    // Non-inline prerelease strings of planned versions live in the manifest buffer; copied into the lockfile's below.
    let mut pre_strings: Vec<(core::ops::Range<usize>, u64, Box<[u8]>)> = Vec::new();
    for (inst_i, inst) in instances.iter().enumerate() {
        if inst.held {
            continue;
        }
        let name = pkg_names[inst.pkg_id as usize].slice(buf);
        let mut expired = false;
        let scope = manager.options.scope_for_package_name(name);
        let Some(manifest) = manager.manifests.by_name_allow_expired(
            cache_ctx,
            scope,
            name,
            Some(&mut expired),
            min_age.is_some(),
        ) else {
            let entry = (Box::from(name), text(inst.current.fmt(buf)));
            if !unchecked.contains(&entry) {
                unchecked.push(entry);
            }
            continue;
        };
        let manifest: &PackageManifest = manifest;
        let manifest_buf: &[u8] = &manifest.string_buf;
        let rows_before = report.rows.len();
        let planned: Vec<Option<Planned>> = inst
            .wants
            .iter()
            .map(|want| {
                if want.version.tag == DependencyVersionTag::Npm {
                    let range = &want.version.npm().version;
                    manifest
                        .find_best_version_with_filter(range, buf, min_age, excludes)
                        .unwrap()
                        .map(|found| found.version)
                        .filter(|&v| v.order(inst.current, manifest_buf, buf) == Ordering::Greater)
                        .map(|v| Planned {
                            v,
                            to: Some(v),
                            later: later_than(manifest, v, min_age, excludes),
                        })
                } else {
                    let tag = want.version.dist_tag().tag.slice(buf);
                    manifest
                        .find_by_dist_tag_with_filter(tag, min_age, excludes)
                        .unwrap()
                        .map(|found| found.version)
                        .filter(|&v| v.order(inst.current, manifest_buf, buf) != Ordering::Equal)
                        .map(|v| Planned {
                            v,
                            to: None,
                            later: Box::default(),
                        })
                }
            })
            .collect();
        let edge_wants: Vec<(DependencyID, Option<usize>)> = edges_on.followers[inst_i]
            .iter()
            .map(|&edge| {
                let owner = inst
                    .wants
                    .iter()
                    .position(|want| want.dep_ids.contains(&edge));
                (edge, owner)
            })
            .collect();
        // Rows landing back on `current` are stayers the redirect can still carry; the first moved row's landing is the instance's only direct redirect target (`redirect` is first-wins over `moved_pairs`, both in owner order).
        let mut direct_stayers: Vec<DependencyID> = Vec::new();
        let mut direct_landing: Option<(Semver::Version, bool)> = None;
        for &(dep_id, latest, keep, res_slot) in &edges_on.direct[inst_i] {
            let Some((landing, in_manifest)) = direct_row_landing(
                &manager.lockfile,
                manifest,
                dep_id,
                latest,
                keep,
                min_age,
                excludes,
            ) else {
                continue;
            };
            let landing_buf = if in_manifest { manifest_buf } else { buf };
            if landing.order(inst.current, landing_buf, buf) == Ordering::Equal {
                direct_stayers.push(dep_id);
            } else if res_slot == inst_i as u32 && direct_landing.is_none() {
                direct_landing = Some((landing, in_manifest));
            }
        }
        // Holds cascade (a held want stays behind and can block another), so iterate to a fixed point.
        let mut held_wants = vec![false; inst.wants.len()];
        loop {
            let mut changed = false;
            for w in 0..inst.wants.len() {
                let Some(plan) = &planned[w] else {
                    continue;
                };
                if held_wants[w] || plan.to.is_none() {
                    continue;
                }
                // The redirect carries every remaining edge toward the FIRST pinned want's target (dist-tag pins included).
                let redirect_v = (0..inst.wants.len())
                    .find(|&i| !held_wants[i] && planned[i].is_some())
                    .and_then(|i| planned[i].as_ref().map(|plan| plan.v))
                    .unwrap_or(plan.v);
                if forks_surviving_instance(
                    &manager.lockfile,
                    inst,
                    w,
                    &planned,
                    &held_wants,
                    &edge_wants,
                    &direct_stayers,
                    direct_landing,
                    redirect_v,
                    manifest_buf,
                ) {
                    held_wants[w] = true;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for (w, want) in inst.wants.iter().enumerate() {
            let Some(plan) = &planned[w] else {
                continue;
            };
            if held_wants[w] {
                continue;
            }
            let (v, to) = (plan.v, plan.to);
            if to.is_some() && !v.tag.pre.value.is_inline() {
                let end = pins.len() + want.dep_ids.len();
                pre_strings.push((
                    pins.len()..end,
                    v.tag.pre.hash,
                    Box::from(v.tag.pre.slice(manifest_buf)),
                ));
            }
            pins.extend(want.dep_ids.iter().map(|&dep_id| Pin {
                dep_id,
                from: inst.pkg_id,
                to,
            }));
            report.rows.push(Row {
                name: Box::from(name),
                from: text(inst.current.fmt(buf)),
                to: text(v.fmt(manifest_buf)),
                later: plan.later.clone(),
            });
        }
        if report.rows.len() != rows_before {
            report.moved.push(inst.pkg_id);
        }
    }
    index_sort::sort_vec_unstable_by(&mut unchecked, |a, b| a.cmp(b));
    warn_unchecked(manager, msgs_before, &unchecked);
    print_log(manager)?;

    for (range, hash, pre) in pre_strings {
        let pre = manager
            .lockfile
            .string_buf()
            .append_external_with_hash(&pre, hash)?;
        for pin in &mut pins[range] {
            if let Some(to) = pin.to.as_mut() {
                to.tag.pre = pre;
            }
        }
    }

    sort_dedup_rows(&mut report.rows);
    Ok((pins, report))
}

/// Live rows per planned instance: `followers` move only via the post-resolve redirect; `direct` rows are the root/workspace rows the differ re-resolves, as `(dep_id, lands on the latest dist-tag, keep_locked_if_ahead model)` per `should_update`.
struct InstanceEdges {
    followers: Vec<Vec<DependencyID>>,
    direct: Vec<Vec<(DependencyID, bool, KeepLocked, u32)>>,
}

fn edges_on_instances(
    manager: &mut PackageManager,
    instances: &[Instance],
    direct_deps: &DirectDependencies,
) -> InstanceEdges {
    struct DirectRow {
        dep_id: DependencyID,
        inst: u32,
        /// Slot of the instance the row currently resolves to, `u32::MAX` when unresolved or unplanned.
        res_slot: u32,
        /// The version of the npm instance the row resolved to (live or snapshot).
        locked: Option<Semver::Version>,
        catalog: bool,
        /// The effective version is an npm range (as opposed to a dist-tag).
        npm: bool,
    }
    let mut followers: Vec<Vec<DependencyID>> = vec![Vec::new(); instances.len()];
    let mut direct: Vec<Vec<(DependencyID, bool, KeepLocked, u32)>> =
        vec![Vec::new(); instances.len()];
    let mut direct_rows: Vec<DirectRow> = Vec::new();
    {
        let lockfile: &Lockfile = &manager.lockfile;
        let packages_len = lockfile.packages.len();
        let mut slot_of: Vec<u32> = vec![u32::MAX; packages_len];
        for (i, inst) in instances.iter().enumerate() {
            slot_of[inst.pkg_id as usize] = i as u32;
        }
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let pkg_names = lockfile.packages.items_name();
        let name_hashes = lockfile.packages.items_name_hash();
        let dep_slices = lockfile.packages.items_dependencies();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();

        // Removed or superseded subtrees (a dropped workspace member included) are still in the buffers: only owners reachable from the root contribute rows.
        let mut reachable = DynamicBitSet::init_empty(packages_len).unwrap_or_oom();
        let mut queue: Vec<usize> = Vec::new();
        for owner in 0..packages_len {
            if pkg_res[owner].tag == ResolutionTag::Root {
                reachable.set(owner);
                queue.push(owner);
            }
        }
        while let Some(owner) = queue.pop() {
            let slice = dep_slices[owner];
            let snapshot = matches!(
                pkg_res[owner].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            );
            for row in slice.begin() as usize..slice.end() as usize {
                let mut target = resolutions[row] as usize;
                if target >= packages_len && snapshot {
                    target = snapshot_resolution(
                        direct_deps,
                        owner as PackageID,
                        deps[row].name_hash,
                        deps[row].behavior,
                    )
                    .map_or(usize::MAX, |resolved| resolved as usize);
                }
                if target < packages_len && !reachable.is_set(target) {
                    reachable.set(target);
                    queue.push(target);
                }
            }
        }

        for owner in 0..packages_len {
            if !reachable.is_set(owner) {
                continue;
            }
            let slice = dep_slices[owner];
            let is_direct = matches!(
                pkg_res[owner].tag,
                ResolutionTag::Root | ResolutionTag::Workspace
            );
            for row in slice.begin() as usize..slice.end() as usize {
                if !is_direct {
                    let Some(&slot) = slot_of.get(resolutions[row] as usize) else {
                        continue;
                    };
                    if slot != u32::MAX {
                        followers[slot as usize].push(row as DependencyID);
                    }
                    continue;
                }
                let Some(version) =
                    dedupe::effective_version(lockfile, row as DependencyID, &deps[row])
                else {
                    continue;
                };
                let names = match version.tag {
                    DependencyVersionTag::Npm => version.npm().name,
                    DependencyVersionTag::DistTag => version.dist_tag().name,
                    _ => continue,
                };
                let row_hash = Semver::string::Builder::string_hash(names.slice(buf));
                // The differ re-appends root rows unresolved; their pre-diff resolution lives in the snapshot.
                let locked_id = if (resolutions[row] as usize) < packages_len {
                    Some(resolutions[row])
                } else {
                    snapshot_resolution(
                        direct_deps,
                        owner as PackageID,
                        deps[row].name_hash,
                        deps[row].behavior,
                    )
                };
                let res_slot = locked_id
                    .and_then(|id| slot_of.get(id as usize).copied())
                    .unwrap_or(u32::MAX);
                let locked = locked_id.and_then(|id| {
                    // An optional row the loaded lockfile left unresolved snapshots as invalid.
                    let res = pkg_res.get(id as usize)?;
                    (res.tag == ResolutionTag::Npm).then(|| res.npm().version)
                });
                for (i, inst) in instances.iter().enumerate() {
                    if name_hashes[inst.pkg_id as usize] == row_hash
                        && names.eql(pkg_names[inst.pkg_id as usize], buf, buf)
                    {
                        direct_rows.push(DirectRow {
                            dep_id: row as DependencyID,
                            inst: i as u32,
                            res_slot,
                            locked,
                            catalog: deps[row].version.tag == DependencyVersionTag::Catalog,
                            npm: version.tag == DependencyVersionTag::Npm,
                        });
                    }
                }
            }
        }
    }

    let bare = manager.update_requests.is_empty();
    let has_targets = manager.update_target_workspaces.is_some();
    let to_latest = manager
        .options
        .do_
        .contains(crate::package_manager::options::Do::UPDATE_TO_LATEST);
    for row in direct_rows {
        let in_targets = {
            let lockfile: &Lockfile = &manager.lockfile;
            manager
                .update_target_workspaces
                .as_deref()
                .is_some_and(|targets| lockfile.is_dependency_of_workspace_in(targets, row.dep_id))
        };
        // Mirrors `should_update`: bare updates re-resolve the target (or cwd) workspaces' rows and catalog rows; named updates re-resolve the in-scope requested rows.
        let reresolves = if bare {
            row.catalog
                || if has_targets {
                    in_targets
                } else {
                    let this_ptr: *mut PackageManager = manager;
                    // SAFETY: as in `should_update` — `is_root_dependency` reads
                    // `manager.root_package_id` and the workspace package.json cache only,
                    // disjoint from `manager.lockfile`.
                    unsafe { &*(*this_ptr).lockfile }
                        .is_root_dependency(unsafe { &mut *this_ptr }, row.dep_id)
                }
        } else {
            named_row_in_scope(manager, row.dep_id)
        };
        if !reresolves {
            // The row keeps its locked resolution, so it sits on exactly that instance; only the redirect can carry it.
            if row.inst == row.res_slot {
                followers[row.inst as usize].push(row.dep_id);
            }
            continue;
        }
        // Mirrors `latest_for_target` (catalog and overridden rows resolve by their range, never by `latest`); named rows reach plan_edges via the --latest-only path.
        let overridden = overridden_row(&manager.lockfile, row.dep_id);
        let latest = to_latest && (!bare || in_targets) && !row.catalog && !overridden;
        // `keep_locked_if_ahead` finds a locked version only where its path can: the range's loaded lockfile instance for -r/--filter npm rows, the invoking workspace's rewritten rows otherwise (rows that were dist-tag literals follow their tag).
        let keep = if !to_latest || row.catalog || overridden {
            KeepLocked::No
        } else if has_targets && in_targets && row.npm {
            KeepLocked::Range
        } else if !has_targets && !row.npm && !original_literal_is_dist_tag(manager, row.dep_id) {
            row.locked.map_or(KeepLocked::No, KeepLocked::Version)
        } else {
            KeepLocked::No
        };
        direct[row.inst as usize].push((row.dep_id, latest, keep, row.res_slot));
    }
    InstanceEdges { followers, direct }
}

#[derive(Clone, Copy)]
enum KeepLocked {
    No,
    /// The highest loaded instance the row's range accepts keeps the row when it is ahead.
    Range,
    /// The row's own locked version keeps it when ahead of the lookup.
    Version(Semver::Version),
}

/// Mirrors `locked_version_of_invoking_workspace_row`'s dist-tag-literal exclusion.
fn original_literal_is_dist_tag(manager: &PackageManager, dep_id: DependencyID) -> bool {
    let lockfile: &Lockfile = &manager.lockfile;
    let dep = &lockfile.buffers.dependencies[dep_id as usize];
    manager
        .updating_packages
        .get(lockfile.str(&dep.name))
        .is_some_and(|entry| {
            DependencyVersionTag::infer(&entry.original_version_literal)
                == DependencyVersionTag::DistTag
        })
}

/// Mirrors `patched_package_satisfying`: a patched loaded instance the row's range accepts captures the row before any lookup.
fn patched_capture(lockfile: &Lockfile, dep_id: DependencyID) -> Option<Semver::Version> {
    if lockfile.patched_dependencies.count() == 0 {
        return None;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let dep = &lockfile.buffers.dependencies[dep_id as usize];
    let version = dedupe::effective_version(lockfile, dep_id, dep)?;
    if version.tag != DependencyVersionTag::Npm {
        return None;
    }
    let hash = Semver::string::Builder::string_hash(version.npm().name.slice(buf));
    let candidates = lockfile.package_index.get(&hash)?.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let range = &version.npm().version;
    candidates
        .iter()
        .copied()
        .filter(|&id| (id as usize) < lockfile.packages.len())
        .find(|&id| {
            let res = &pkg_res[id as usize];
            res.tag == ResolutionTag::Npm
                && range.satisfies(res.npm().version, buf, buf)
                && lockfile
                    .patched_dependencies
                    .contains(&Semver::string::Builder::string_hash(&dedupe::label(
                        lockfile, id,
                    )))
        })
        .map(|id| pkg_res[id as usize].npm().version)
}

/// Mirrors `locked_version_in_lockfile`: the highest loaded npm instance the row's range accepts.
fn locked_in_lockfile(lockfile: &Lockfile, dep_id: DependencyID) -> Option<Semver::Version> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let dep = &lockfile.buffers.dependencies[dep_id as usize];
    let version = dedupe::effective_version(lockfile, dep_id, dep)?;
    if version.tag != DependencyVersionTag::Npm {
        return None;
    }
    let hash = Semver::string::Builder::string_hash(version.npm().name.slice(buf));
    let candidates = lockfile.package_index.get(&hash)?.as_slice();
    let pkg_res = lockfile.packages.items_resolution();
    let range = &version.npm().version;
    candidates
        .iter()
        .copied()
        .filter(|&id| id < lockfile.loaded_package_count)
        .map(|id| &pkg_res[id as usize])
        .filter(|res| res.tag == ResolutionTag::Npm)
        .map(|res| res.npm().version)
        .find(|&locked| range.satisfies(locked, buf, buf))
}

/// The pre-differ resolution of a root/workspace row, matched by owner, name hash and behavior like `moved_pairs`.
fn snapshot_resolution(
    direct_deps: &DirectDependencies,
    owner: PackageID,
    name_hash: PackageNameHash,
    behavior: Behavior,
) -> Option<PackageID> {
    let &(_, start, len) = direct_deps
        .owners
        .iter()
        .find(|&&(pkg, _, _)| pkg == owner)?;
    direct_deps.rows[start as usize..(start + len) as usize]
        .iter()
        .find(|&&(row_hash, row_behavior, _)| row_hash == name_hash && row_behavior == behavior)
        .map(|&(_, _, resolved)| resolved)
}

/// Mirrors `should_update`'s named branch: the row names a requested package and sits in the update scope.
fn named_row_in_scope(manager: &PackageManager, dep_id: DependencyID) -> bool {
    let lockfile: &Lockfile = &manager.lockfile;
    let buf = lockfile.buffers.string_bytes.as_slice();
    let dep = &lockfile.buffers.dependencies[dep_id as usize];
    let aliased =
        dedupe::effective_version(lockfile, dep_id, dep).and_then(|version| match version.tag {
            DependencyVersionTag::Npm => Some(version.npm().name),
            DependencyVersionTag::DistTag => Some(version.dist_tag().name),
            _ => None,
        });
    let named = manager.is_update_request(dep.name_hash, dep.name.slice(buf))
        || aliased.is_some_and(|name| {
            let hash = Semver::string::Builder::string_hash(name.slice(buf));
            hash != dep.name_hash && manager.is_update_request(hash, name.slice(buf))
        });
    named && UpdateScope::of(manager).contains_dependency(lockfile, dep_id)
}

/// Overridden rows resolve by the override range, never by `latest` (`!version_was_replaced` in `latest_for_target`).
fn overridden_row(lockfile: &Lockfile, dep_id: DependencyID) -> bool {
    let dep = &lockfile.buffers.dependencies[dep_id as usize];
    !dep.behavior.is_workspace()
        && !(dep.version.tag == DependencyVersionTag::Npm && dep.version.npm().is_alias)
        && lockfile
            .overrides
            .get(lockfile, dep_id, dep.name_hash)
            .is_some()
}

/// The release the differ lands this row on (with whether it lives in the manifest buffer): the patched capture, the keep-locked version, or the lookup (`latest` dist-tag for `--latest` target rows, else the row's own range or tag).
fn direct_row_landing(
    lockfile: &Lockfile,
    manifest: &PackageManifest,
    dep_id: DependencyID,
    latest: bool,
    keep: KeepLocked,
    min_age: Option<f64>,
    excludes: Option<&[&[u8]]>,
) -> Option<(Semver::Version, bool)> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    // `patched_package_satisfying` captures the row before any lookup; peer rows fall through.
    if !lockfile.buffers.dependencies[dep_id as usize]
        .behavior
        .is_peer()
    {
        if let Some(patched) = patched_capture(lockfile, dep_id) {
            return Some((patched, false));
        }
    }
    let found = if latest {
        manifest
            .find_by_dist_tag_with_filter(b"latest", min_age, excludes)
            .unwrap()
    } else {
        let dep = &lockfile.buffers.dependencies[dep_id as usize];
        let version = dedupe::effective_version(lockfile, dep_id, dep)?;
        match version.tag {
            DependencyVersionTag::Npm => manifest
                .find_best_version_with_filter(&version.npm().version, buf, min_age, excludes)
                .unwrap(),
            DependencyVersionTag::DistTag => manifest
                .find_by_dist_tag_with_filter(version.dist_tag().tag.slice(buf), min_age, excludes)
                .unwrap(),
            _ => return None,
        }
    };
    let found = found?;
    // `keep_locked_if_ahead`: a lookup below the row's locked version lands it back on that version, when the manifest still has it.
    let locked = match keep {
        KeepLocked::No => None,
        KeepLocked::Version(locked) => Some(locked),
        KeepLocked::Range => locked_in_lockfile(lockfile, dep_id),
    };
    if let Some(locked) = locked {
        if found.version.order(locked, &manifest.string_buf, buf) == Ordering::Less
            && manifest.find_by_version(locked).is_some()
        {
            return Some((locked, false));
        }
    }
    Some((found.version, true))
}

/// An edge left behind at a still-satisfying `current` would re-create the duplicate `bun dedupe` removes.
#[allow(clippy::too_many_arguments)]
fn forks_surviving_instance(
    lockfile: &Lockfile,
    inst: &Instance,
    want_index: usize,
    planned: &[Option<Planned>],
    held_wants: &[bool],
    edge_wants: &[(DependencyID, Option<usize>)],
    direct_stayers: &[DependencyID],
    direct_landing: Option<(Semver::Version, bool)>,
    redirect_v: Semver::Version,
    manifest_buf: &[u8],
) -> bool {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let want = &inst.wants[want_index];
    if want.version.tag != DependencyVersionTag::Npm
        || !want.version.npm().version.satisfies(inst.current, buf, buf)
    {
        return false;
    }
    let deps = lockfile.buffers.dependencies.as_slice();
    let stays = |version: &dependency::Version| {
        if version.tag != DependencyVersionTag::Npm {
            return true;
        }
        let range = &version.npm().version;
        !range.satisfies(redirect_v, buf, manifest_buf)
            && !direct_landing.is_some_and(|(landing, in_manifest)| {
                range.satisfies(landing, buf, if in_manifest { manifest_buf } else { buf })
            })
    };
    let uncarried = |edge: DependencyID| {
        let dep = &deps[edge as usize];
        dep.behavior.is_bundled()
            || dedupe::effective_npm_range(lockfile, edge, dep).is_none_or(|range| stays(&range))
    };
    if direct_stayers.iter().any(|&edge| uncarried(edge)) {
        return true;
    }
    edge_wants.iter().any(|&(edge, owner)| match owner {
        Some(w) if w == want_index => false,
        Some(w) => (planned[w].is_none() || held_wants[w]) && stays(&inst.wants[w].version),
        None => uncarried(edge),
    })
}

/// The `latest` dist-tag when it is newer than the release `v` an in-range move stops at, like the `+` rows' `(vX available)`.
fn later_than(
    manifest: &PackageManifest,
    v: Semver::Version,
    min_age: Option<f64>,
    excludes: Option<&[&[u8]]>,
) -> Box<[u8]> {
    if v.tag.has_pre() {
        return Box::default();
    }
    let manifest_buf: &[u8] = &manifest.string_buf;
    let latest = manifest
        .find_by_dist_tag_with_filter(b"latest", min_age, excludes)
        .unwrap()
        .map(|found| found.version)
        .filter(|latest| latest.order(v, manifest_buf, manifest_buf) == Ordering::Greater);
    latest.map_or_else(Box::default, |latest| text(latest.fmt(manifest_buf)))
}
