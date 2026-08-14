use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::bit_set::Range as BitRange;
use bun_collections::{DynamicBitSet, index_sort};
use bun_core::{Output, UnwrapOrOom as _, prettyln};
use bun_semver as Semver;

use crate::audit_fix;
use crate::dedupe;
use crate::dependency::{self, Behavior};
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::npm::PackageManifest;
use crate::package_manager::Options::LogLevel;
use crate::package_manager_real::enqueue_dependency_with_main;
use crate::package_manager_real::populate_manifest_cache::{self, Packages};
use crate::update_scope::UpdateScope;
use crate::{
    DependencyID, DependencyVersionTag, ManifestLoad, PackageID, PackageManager, PackageNameHash,
    ResolutionTag, invalid_package_id,
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

    fn moved_rows(&self, lockfile: &Lockfile) -> Vec<Row> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let pkg_res = lockfile.packages.items_resolution();
        let pkg_names = lockfile.packages.items_name();
        self.moved_pairs(lockfile)
            .into_iter()
            .filter(|&(old, _)| pkg_res[old as usize].tag == ResolutionTag::Npm)
            .map(|(old, new)| {
                row(
                    pkg_names[old as usize].slice(buf),
                    pkg_res[old as usize].npm().version.fmt(buf),
                    pkg_res[new as usize].npm().version.fmt(buf),
                )
            })
            .collect()
    }
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

/// The transitive half of a bare `bun update`: every edge owned by a non-workspace package the selected workspaces reach (all of them from the root or with -r) moves to the newest release its own range allows, or to wherever its dist-tag points now.
#[derive(Default)]
pub struct TransitiveUpdate {
    pins: Vec<Pin>,
    dry_run_rows: Option<Vec<Row>>,
}

impl TransitiveUpdate {
    /// Runs once the differ has installed package.json's overrides and catalogs, before anything is enqueued; prints the plan unless `--dry-run` defers it to `print_dry_run`.
    pub fn plan(manager: &mut PackageManager) -> crate::Result<TransitiveUpdate> {
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
        let (pins, rows) = plan_edges(manager, &edges)?;
        if manager.options.log_level == LogLevel::Silent {
            return Ok(TransitiveUpdate {
                pins,
                dry_run_rows: None,
            });
        }
        if manager.options.dry_run {
            return Ok(TransitiveUpdate {
                pins,
                dry_run_rows: Some(rows),
            });
        }
        if !rows.is_empty() {
            print_rows(&rows);
            Output::flush();
        }
        Ok(TransitiveUpdate {
            pins,
            dry_run_rows: None,
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
                None => {
                    let dep = manager.lockfile.buffers.dependencies[pin.dep_id as usize].clone();
                    manager.lockfile.buffers.resolutions[pin.dep_id as usize] = invalid_package_id;
                    enqueue_dependency_with_main(
                        manager,
                        pin.dep_id,
                        &dep,
                        invalid_package_id,
                        false,
                    )?;
                }
            }
            if let Some(pinned) = pinned.as_deref_mut() {
                pinned.set(pin.dep_id as usize);
            }
            manager.summary.update += 1;
        }
        Ok(())
    }

    /// `--dry-run`: once everything is resolved, lists the direct dependencies that moved alongside the transitive plan and counts them together.
    pub fn print_dry_run(&self, direct: &DirectDependencies, lockfile: &Lockfile) {
        let Some(planned) = &self.dry_run_rows else {
            return;
        };
        let mut rows = planned.clone();
        rows.extend(direct.moved_rows(lockfile));
        sort_dedup_rows(&mut rows);
        if rows.is_empty() {
            return;
        }
        print_rows(&rows);
        let n = rows.len();
        prettyln!(
            "Would update {} {}",
            n,
            if n == 1 { "package" } else { "packages" }
        );
        Output::flush();
    }

    /// Once everything is resolved, the edges the plan skipped (peers, other workspaces' pins) follow a moved package when their range allows, as they do for a moved direct dependency.
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
    let (pins, rows) = plan_edges(manager, &edges)?;
    if !rows.is_empty() && manager.options.log_level != LogLevel::Silent {
        print_rows(&rows);
        Output::flush();
    }
    let update = TransitiveUpdate {
        pins,
        dry_run_rows: None,
    };
    update.enqueue(manager)?;
    Ok(update
        .pins
        .iter()
        .map(|pin| (pin.dep_id, pin.from))
        .collect())
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

type Row = (Box<[u8]>, Box<[u8]>, Box<[u8]>);

fn row(name: &[u8], from: impl core::fmt::Display, to: impl core::fmt::Display) -> Row {
    let mut from_text: Vec<u8> = Vec::new();
    let _ = write!(from_text, "{from}");
    let mut to_text: Vec<u8> = Vec::new();
    let _ = write!(to_text, "{to}");
    (
        Box::from(name),
        from_text.into_boxed_slice(),
        to_text.into_boxed_slice(),
    )
}

fn sort_dedup_rows(rows: &mut Vec<Row>) {
    index_sort::sort_vec_unstable_by(rows, |a, b| a.cmp(b));
    rows.dedup();
}

fn print_rows(rows: &[Row]) {
    prettyln!("updating:");
    for (name, from, to) in rows {
        prettyln!(
            "  {}@{} → <green>{}<r>",
            BStr::new(name),
            BStr::new(from),
            BStr::new(to)
        );
    }
    prettyln!("");
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

/// `edges` selects the rows to plan; each moves to the newest release its (post-override/catalog) range allows, or follows its dist-tag.
fn plan_edges(
    manager: &mut PackageManager,
    edges: &DynamicBitSet,
) -> crate::Result<(Vec<Pin>, Vec<Row>)> {
    let mut instances: Vec<Instance> = Vec::new();
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
        let mut set_edges = edges.iterator::<true, true>();
        while let Some(dep_id) = set_edges.next() {
            let Some(&target) = resolutions.get(dep_id) else {
                break;
            };
            let Some(&slot) = instance_of.get(target as usize) else {
                continue;
            };
            let dep = &deps[dep_id];
            if slot == SKIP || dep.behavior.is_peer() || dep.behavior.is_bundled() {
                continue;
            }
            let instance = if slot != u32::MAX {
                slot
            } else {
                let pkg_id = target as usize;
                if res[pkg_id].tag != ResolutionTag::Npm
                    || (has_patches
                        && lockfile.patched_dependencies.contains(
                            &Semver::string::Builder::string_hash(&dedupe::label(lockfile, target)),
                        ))
                {
                    instance_of[pkg_id] = SKIP;
                    continue;
                }
                instance_of[pkg_id] = instances.len() as u32;
                instances.push(Instance {
                    pkg_id: target,
                    current: res[pkg_id].npm().version,
                    wants: Vec::new(),
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
    instances.retain(|inst| !inst.wants.is_empty());
    if instances.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let ids: Vec<PackageID> = instances.iter().map(|inst| inst.pkg_id).collect();
    populate_manifest_cache::populate_manifest_cache(manager, Packages::Exact(&ids))?;
    manager
        .log_mut()
        .print(core::ptr::from_mut(Output::error_writer()))?;
    manager.log_mut().reset();

    let cache_ctx = manager.manifest_disk_cache_ctx();
    let min_age = manager.options.minimum_release_age_ms;
    let excludes = manager.options.minimum_release_age_excludes;
    let buf = manager.lockfile.buffers.string_bytes.as_slice();
    let pkg_names = manager.lockfile.packages.items_name();

    let mut pins: Vec<Pin> = Vec::new();
    let mut rows: Vec<Row> = Vec::new();
    // Non-inline prerelease strings of planned versions live in the manifest buffer; copied into the lockfile's below.
    let mut pre_strings: Vec<(core::ops::Range<usize>, u64, Box<[u8]>)> = Vec::new();
    for inst in &instances {
        let name = pkg_names[inst.pkg_id as usize].slice(buf);
        let mut expired = false;
        let scope = manager.options.scope_for_package_name(name);
        let Some(manifest) = manager.manifests.by_name_allow_expired(
            cache_ctx,
            scope,
            name,
            Some(&mut expired),
            ManifestLoad::LoadFromMemoryFallbackToDisk,
            min_age.is_some(),
        ) else {
            continue;
        };
        let manifest: &PackageManifest = manifest;
        let manifest_buf: &[u8] = &manifest.string_buf;
        for want in &inst.wants {
            let (v, to) = if want.version.tag == DependencyVersionTag::Npm {
                let range = &want.version.npm().version;
                let Some(found) = manifest
                    .find_best_version_with_filter(range, buf, min_age, excludes)
                    .unwrap()
                else {
                    continue;
                };
                let v = found.version;
                if v.order(inst.current, manifest_buf, buf) != Ordering::Greater {
                    continue;
                }
                if !v.tag.pre.value.is_inline() {
                    let end = pins.len() + want.dep_ids.len();
                    pre_strings.push((
                        pins.len()..end,
                        v.tag.pre.hash,
                        Box::from(v.tag.pre.slice(manifest_buf)),
                    ));
                }
                (v, Some(v))
            } else {
                let tag = want.version.dist_tag().tag.slice(buf);
                let Some(found) = manifest
                    .find_by_dist_tag_with_filter(tag, min_age, excludes)
                    .unwrap()
                else {
                    continue;
                };
                if found.version.order(inst.current, manifest_buf, buf) == Ordering::Equal {
                    continue;
                }
                (found.version, None)
            };
            pins.extend(want.dep_ids.iter().map(|&dep_id| Pin {
                dep_id,
                from: inst.pkg_id,
                to,
            }));
            rows.push(row(name, inst.current.fmt(buf), v.fmt(manifest_buf)));
        }
    }

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

    sort_dedup_rows(&mut rows);
    Ok((pins, rows))
}
