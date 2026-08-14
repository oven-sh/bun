use core::cmp::Ordering;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::DynamicBitSet;
use bun_collections::bit_set::Range as BitRange;
use bun_core::{Output, UnwrapOrOom as _, prettyln};
use bun_semver as Semver;

use crate::audit_fix;
use crate::dedupe;
use crate::dependency::{self, Behavior};
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::npm::PackageManifest;
use crate::package_manager::Options::LogLevel;
use crate::package_manager_real::populate_manifest_cache::{self, Packages};
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
    to: Semver::Version,
}

/// The transitive half of a bare `bun update`: every edge owned by a non-workspace package moves to the newest release its own range allows.
#[derive(Default)]
pub struct TransitiveUpdate {
    pins: Vec<Pin>,
}

impl TransitiveUpdate {
    /// Runs on the loaded lockfile, before the differ; prints the plan.
    pub fn plan(manager: &mut PackageManager) -> crate::Result<TransitiveUpdate> {
        let (pins, rows) = plan_edges(manager)?;
        if !rows.is_empty() && manager.options.log_level != LogLevel::Silent {
            print_plan(&rows, manager.options.dry_run);
        }
        Ok(TransitiveUpdate { pins })
    }

    /// Runs after the differ has enqueued the direct dependencies; edges the differ already invalidated are left to it.
    pub fn enqueue(&self, manager: &mut PackageManager) -> crate::Result<()> {
        if self.pins.is_empty() {
            return Ok(());
        }
        let _ = manager.get_cache_directory();
        let _ = manager.get_temporary_directory();
        for pin in &self.pins {
            if manager.lockfile.buffers.resolutions[pin.dep_id as usize] != pin.from {
                continue;
            }
            audit_fix::enqueue_pinned(manager, pin.dep_id, pin.to)?;
            manager.summary.update += 1;
        }
        Ok(())
    }

    /// Once everything is resolved, the edges the plan skipped (peers, other workspaces' pins) follow a moved package when their range allows, as they do for a moved direct dependency.
    pub fn redirect_dependents(&self, lockfile: &mut Lockfile) {
        let moved: Vec<(DependencyID, PackageID)> =
            self.pins.iter().map(|pin| (pin.dep_id, pin.from)).collect();
        redirect_moved_edges(lockfile, &moved);
    }
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

fn print_plan(rows: &[Row], dry_run: bool) {
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
    if dry_run {
        let n = rows.len();
        prettyln!(
            "Would update {} {}",
            n,
            if n == 1 { "package" } else { "packages" }
        );
    }
    Output::flush();
}

struct Want {
    literal: Option<Semver::String>,
    range: dependency::Version,
    dep_ids: Vec<DependencyID>,
}

struct Instance {
    pkg_id: PackageID,
    current: Semver::Version,
    wants: Vec<Want>,
}

fn workspace_owned_dependencies(lockfile: &Lockfile) -> crate::Result<DynamicBitSet> {
    let mut owned = DynamicBitSet::init_empty(lockfile.buffers.dependencies.len())?;
    let pkg_res = lockfile.packages.items_resolution();
    for (owner, slice) in lockfile.packages.items_dependencies().iter().enumerate() {
        if matches!(
            pkg_res[owner].tag,
            ResolutionTag::Root | ResolutionTag::Workspace
        ) {
            owned.set_range_value(
                BitRange {
                    start: slice.begin() as usize,
                    end: slice.end() as usize,
                },
                true,
            );
        }
    }
    Ok(owned)
}

fn plan_edges(manager: &mut PackageManager) -> crate::Result<(Vec<Pin>, Vec<Row>)> {
    let mut instances: Vec<Instance> = Vec::new();
    {
        let lockfile = &*manager.lockfile;
        let res = lockfile.packages.items_resolution();
        let has_patches = lockfile.patched_dependencies.count() > 0;

        let mut instance_of: Vec<u32> = vec![u32::MAX; res.len()];
        for pkg_id in 0..res.len() {
            if res[pkg_id].tag != ResolutionTag::Npm {
                continue;
            }
            if has_patches
                && lockfile
                    .patched_dependencies
                    .contains(&Semver::string::Builder::string_hash(&dedupe::label(
                        lockfile,
                        pkg_id as PackageID,
                    )))
            {
                continue;
            }
            instance_of[pkg_id] = instances.len() as u32;
            instances.push(Instance {
                pkg_id: pkg_id as PackageID,
                current: res[pkg_id].npm().version,
                wants: Vec::new(),
            });
        }
        if instances.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }

        let workspace_owned = workspace_owned_dependencies(lockfile)?;
        let no_overrides = lockfile.overrides.is_empty();
        let deps = lockfile.buffers.dependencies.as_slice();
        for (dep_id, &target) in lockfile.buffers.resolutions.iter().enumerate() {
            let Some(&instance) = instance_of.get(target as usize) else {
                continue;
            };
            let dep = &deps[dep_id];
            if instance == u32::MAX
                || workspace_owned.is_set(dep_id)
                || dep.behavior.is_peer()
                || dep.behavior.is_bundled()
            {
                continue;
            }
            let dep_id = dep_id as DependencyID;
            let inst = &mut instances[instance as usize];
            let literal = (no_overrides
                && dep.version.tag == DependencyVersionTag::Npm
                && !dep.version.npm().is_alias)
                .then_some(dep.version.literal);
            if let Some(want) = inst
                .wants
                .iter_mut()
                .find(|want| want.literal.is_some() && want.literal == literal)
            {
                want.dep_ids.push(dep_id);
                continue;
            }
            let Some(range) = dedupe::effective_npm_range(lockfile, dep_id, dep) else {
                continue;
            };
            inst.wants.push(Want {
                literal,
                range,
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
        let releases = manifest.pkg.releases.keys.get(&manifest.versions);
        let release_pkgs = manifest.pkg.releases.values.get(&manifest.package_versions);
        let age_limit = min_age.filter(|_| !manifest.should_exclude_from_age_filter(excludes));

        let mut from: Vec<u8> = Vec::new();
        let _ = write!(from, "{}", inst.current.fmt(buf));
        for want in &inst.wants {
            let target = releases
                .iter()
                .enumerate()
                .rev()
                .take_while(|(_, v)| v.order(inst.current, manifest_buf, buf) == Ordering::Greater)
                .find_map(|(i, &v)| {
                    if v.tag.has_build()
                        || !want.range.npm().version.satisfies(v, buf, manifest_buf)
                    {
                        return None;
                    }
                    if let Some(limit) = age_limit
                        && PackageManifest::is_package_version_too_recent(&release_pkgs[i], limit)
                    {
                        return None;
                    }
                    Some(v)
                });
            let Some(v) = target else {
                continue;
            };
            let to = Semver::Version {
                major: v.major,
                minor: v.minor,
                patch: v.patch,
                ..Default::default()
            };
            pins.extend(want.dep_ids.iter().map(|&dep_id| Pin {
                dep_id,
                from: inst.pkg_id,
                to,
            }));
            let mut to_text: Vec<u8> = Vec::new();
            let _ = write!(to_text, "{}", v.fmt(manifest_buf));
            rows.push((
                Box::from(name),
                from.clone().into_boxed_slice(),
                to_text.into_boxed_slice(),
            ));
        }
    }

    rows.sort_unstable();
    rows.dedup();
    Ok((pins, rows))
}
