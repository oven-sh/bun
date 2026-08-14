use core::cmp::Ordering;
use core::mem::ManuallyDrop;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::HashMap;
use bun_core::{Global, Output, prettyln, strings};
use bun_semver::query::Group;
use bun_semver::{self as Semver, SlicedString};

use crate::dependency::Behavior;
use crate::lockfile::package::PackageColumns as _;
use crate::npm::PackageManifest;
use crate::package_manager::Options::{Enable, LogLevel};
use crate::package_manager_real::enqueue_dependency_with_main;
use crate::package_manager_real::populate_manifest_cache::{self, Packages};
use crate::{
    Dependency, DependencyID, DependencyVersionTag, ManifestLoad, PackageID, PackageManager,
    PackageNameHash, ResolutionTag, dependency, invalid_package_id,
};

pub struct Advisory {
    pub package_name: Box<[u8]>,
    pub vulnerable_versions: Box<[u8]>,
}

#[derive(Clone)]
pub struct PlannedFix {
    pub name: Box<[u8]>,
    pub name_hash: PackageNameHash,
    pub from: Box<[u8]>,
    pub to: Box<[u8]>,
    pub to_version: Semver::Version,
}

pub struct Blocker {
    pub dependent: Box<[u8]>,
    pub range: Box<[u8]>,
    pub bundled: bool,
}

pub struct BlockedFix {
    pub name: Box<[u8]>,
    pub from: Box<[u8]>,
    pub needs: Box<[u8]>,
    pub blockers: Vec<Blocker>,
}

pub enum UnfixableReason {
    NoSafeRelease,
    TooRecent(Box<[u8]>),
    ManifestUnavailable,
}

pub struct UnfixableFix {
    pub name: Box<[u8]>,
    pub from: Box<[u8]>,
    pub reason: UnfixableReason,
}

pub struct UnmatchedAdvisory {
    pub name: Box<[u8]>,
    pub range: Box<[u8]>,
}

pub struct FixPlan {
    pub fixes: Vec<PlannedFix>,
    pub blocked: Vec<BlockedFix>,
    pub unfixable: Vec<UnfixableFix>,
    pub unmatched: Vec<UnmatchedAdvisory>,
    pub fixed_vulnerabilities: u32,
    pub remaining_vulnerabilities: u32,
}

struct Edge {
    range: Option<dependency::Version>,
    literal: Box<[u8]>,
    dependent: Box<[u8]>,
    bundled: bool,
}

struct Instance {
    pkg_id: PackageID,
    name: Box<[u8]>,
    name_hash: PackageNameHash,
    from: Box<[u8]>,
    current: Semver::Version,
    advisories: Vec<usize>,
    edges: Vec<Edge>,
}

fn fmt_version(version: Semver::Version, buf: &[u8]) -> Box<[u8]> {
    let mut out: Vec<u8> = Vec::new();
    let _ = write!(out, "{}", version.fmt(buf));
    out.into_boxed_slice()
}

fn vuln_word(n: u32) -> &'static str {
    if n == 1 {
        "vulnerability"
    } else {
        "vulnerabilities"
    }
}

fn pkg_word(n: usize) -> &'static str {
    if n == 1 { "package" } else { "packages" }
}

fn order_name_from(a_name: &[u8], a_from: &[u8], b_name: &[u8], b_from: &[u8]) -> Ordering {
    strings::order(a_name, b_name).then_with(|| strings::order(a_from, b_from))
}

pub fn exit_unless_lockfile_writable(manager: &PackageManager) {
    if manager.options.dry_run || manager.options.do_.save_lockfile() {
        return;
    }
    if manager.options.log_level != LogLevel::Silent {
        if manager.options.enable.frozen_lockfile() {
            Output::err_generic(
                "bun audit fix needs to write bun.lock, but the lockfile is frozen",
                (),
            );
            bun_core::note!(
                "remove --frozen-lockfile / --production (or the bunfig.toml equivalent) and run again"
            );
        } else {
            Output::err_generic(
                "bun audit fix needs to write bun.lock, but saving the lockfile is disabled",
                (),
            );
            bun_core::note!(
                "remove --no-save (or install.lockfile.save = false in bunfig.toml) and run again"
            );
        }
        Output::flush();
    }
    Global::exit(1);
}

pub fn plan_fixes(manager: &mut PackageManager, advisories: &[Advisory]) -> crate::Result<FixPlan> {
    let mut range_buf: Vec<u8> = Vec::new();
    let mut range_spans: Vec<(usize, usize)> = Vec::with_capacity(advisories.len());
    for advisory in advisories {
        let range: &[u8] = if advisory.vulnerable_versions.is_empty() {
            b"*"
        } else {
            &advisory.vulnerable_versions
        };
        range_spans.push((range_buf.len(), range.len()));
        range_buf.extend_from_slice(range);
    }
    let advisory_groups: Vec<Option<Group>> = range_spans
        .iter()
        .map(|&(start, len)| {
            let input = &range_buf[start..start + len];
            Semver::query::parse(input, SlicedString::init(&range_buf, input))
                .ok()
                .filter(|group| !group.is_empty())
        })
        .collect();
    let mut by_name: HashMap<PackageNameHash, Vec<usize>> = HashMap::new();
    for (i, advisory) in advisories.iter().enumerate() {
        by_name
            .entry(Semver::string::Builder::string_hash(&advisory.package_name))
            .or_default()
            .push(i);
    }

    let mut advisory_matched: Vec<bool> = vec![false; advisories.len()];
    let mut instances: Vec<Instance> = Vec::new();
    {
        let lockfile = &*manager.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let names = lockfile.packages.items_name();
        let name_hashes = lockfile.packages.items_name_hash();
        let res = lockfile.packages.items_resolution();
        let dep_slices = lockfile.packages.items_dependencies();
        let deps = lockfile.buffers.dependencies.as_slice();
        let resolutions = lockfile.buffers.resolutions.as_slice();

        let mut instance_of: Vec<u32> = vec![u32::MAX; res.len()];
        for pkg_id in 0..res.len() {
            if res[pkg_id].tag != ResolutionTag::Npm {
                continue;
            }
            let Some(candidates) = by_name.get(&name_hashes[pkg_id]) else {
                continue;
            };
            let current = res[pkg_id].npm().version;
            let matched: Vec<usize> = candidates
                .iter()
                .copied()
                .filter(|&i| {
                    advisory_groups[i].as_ref().is_some_and(|group| {
                        group.satisfies_including_prerelease(current, &range_buf, buf)
                    })
                })
                .collect();
            if matched.is_empty() {
                continue;
            }
            for &i in &matched {
                advisory_matched[i] = true;
            }
            instance_of[pkg_id] = instances.len() as u32;
            instances.push(Instance {
                pkg_id: pkg_id as PackageID,
                name: Box::from(names[pkg_id].slice(buf)),
                name_hash: name_hashes[pkg_id],
                from: fmt_version(current, buf),
                current,
                advisories: matched,
                edges: Vec::new(),
            });
        }

        if !instances.is_empty() {
            let mut parent_of: Vec<PackageID> = vec![invalid_package_id; deps.len()];
            for (pkg_id, slice) in dep_slices.iter().enumerate() {
                let end = (slice.end() as usize).min(deps.len());
                for slot in &mut parent_of[(slice.begin() as usize).min(end)..end] {
                    *slot = pkg_id as PackageID;
                }
            }

            for (dep_id, &target) in resolutions.iter().enumerate() {
                if target == invalid_package_id {
                    continue;
                }
                let Some(&instance) = instance_of.get(target as usize) else {
                    continue;
                };
                if instance == u32::MAX || deps[dep_id].behavior.is_optional_peer() {
                    continue;
                }
                let dep = &deps[dep_id];
                let parent = parent_of[dep_id];
                let mut dependent: Vec<u8> = Vec::new();
                if parent != invalid_package_id {
                    let parent = parent as usize;
                    if res[parent].tag == ResolutionTag::Npm {
                        let _ = write!(
                            dependent,
                            "{}@{}",
                            BStr::new(names[parent].slice(buf)),
                            res[parent].npm().version.fmt(buf)
                        );
                    } else {
                        dependent.extend_from_slice(names[parent].slice(buf));
                    }
                }
                if dependent.is_empty() {
                    dependent.extend_from_slice(b"package.json");
                }
                instances[instance as usize].edges.push(Edge {
                    range: crate::dedupe::effective_npm_range(lockfile, dep),
                    literal: Box::from(dep.version.literal.slice(buf)),
                    dependent: dependent.into_boxed_slice(),
                    bundled: dep.behavior.is_bundled(),
                });
            }
        }
    }

    let mut unmatched: Vec<UnmatchedAdvisory> = advisories
        .iter()
        .zip(&range_spans)
        .zip(&advisory_matched)
        .filter(|&(_, &matched)| !matched)
        .map(|((advisory, &(start, len)), _)| UnmatchedAdvisory {
            name: advisory.package_name.clone(),
            range: Box::from(&range_buf[start..start + len]),
        })
        .collect();
    unmatched.sort_by(|a, b| order_name_from(&a.name, &a.range, &b.name, &b.range));
    unmatched.dedup_by(|a, b| a.name == b.name && a.range == b.range);

    if instances.is_empty() {
        return Ok(FixPlan {
            fixes: Vec::new(),
            blocked: Vec::new(),
            unfixable: Vec::new(),
            unmatched,
            fixed_vulnerabilities: 0,
            remaining_vulnerabilities: advisories.len() as u32,
        });
    }

    manager.options.enable.set(Enable::MANIFEST_CACHE, false);
    manager
        .options
        .enable
        .set(Enable::MANIFEST_CACHE_CONTROL, false);
    let ids: Vec<PackageID> = instances.iter().map(|inst| inst.pkg_id).collect();
    populate_manifest_cache::populate_manifest_cache(manager, Packages::Exact(&ids))?;
    manager
        .log_mut()
        .print(std::ptr::from_mut(Output::error_writer()))?;
    manager.log_mut().reset();

    let cache_ctx = manager.manifest_disk_cache_ctx();
    let min_age = manager.options.minimum_release_age_ms;
    let excludes = manager.options.minimum_release_age_excludes;
    let buf = manager.lockfile.buffers.string_bytes.as_slice();

    let mut fixes: Vec<PlannedFix> = Vec::new();
    let mut blocked: Vec<BlockedFix> = Vec::new();
    let mut unfixable: Vec<UnfixableFix> = Vec::new();
    let mut advisory_still_present: Vec<bool> = advisory_matched.iter().map(|&m| !m).collect();

    for inst in instances {
        let mut expired = false;
        let scope = manager.options.scope_for_package_name(&inst.name);
        let Some(manifest) = manager.manifests.by_name_allow_expired(
            cache_ctx,
            scope,
            &inst.name,
            Some(&mut expired),
            ManifestLoad::LoadFromMemoryFallbackToDisk,
            min_age.is_some(),
        ) else {
            for &a in &inst.advisories {
                advisory_still_present[a] = true;
            }
            unfixable.push(UnfixableFix {
                name: inst.name,
                from: inst.from,
                reason: UnfixableReason::ManifestUnavailable,
            });
            continue;
        };
        let manifest: &PackageManifest = manifest;
        let manifest_buf: &[u8] = &manifest.string_buf;
        let releases = manifest.pkg.releases.keys.get(&manifest.versions);
        let release_pkgs = manifest.pkg.releases.values.get(&manifest.package_versions);
        let age_limit = min_age.filter(|_| !manifest.should_exclude_from_age_filter(excludes));
        let name_advisories: &[usize] = match by_name.get(&inst.name_hash) {
            Some(indices) => indices,
            None => &[],
        };

        let mut needs: Option<Semver::Version> = None;
        let mut too_recent: Option<Semver::Version> = None;
        let mut target: Option<Semver::Version> = None;
        for (i, &v) in releases.iter().enumerate() {
            if v.order(inst.current, manifest_buf, buf) != Ordering::Greater {
                continue;
            }
            let still_vulnerable = name_advisories.iter().any(|&a| {
                advisory_groups[a].as_ref().is_some_and(|group| {
                    group.satisfies_including_prerelease(v, &range_buf, manifest_buf)
                })
            });
            if still_vulnerable {
                continue;
            }
            if let Some(limit) = age_limit
                && PackageManifest::is_package_version_too_recent(&release_pkgs[i], limit)
            {
                too_recent.get_or_insert(v);
                continue;
            }
            if needs.is_none() {
                needs = Some(v);
            }
            let all_dependents_accept = inst.edges.iter().all(|edge| {
                !edge.bundled
                    && edge
                        .range
                        .as_ref()
                        .is_some_and(|range| range.npm().version.satisfies(v, buf, manifest_buf))
            });
            if all_dependents_accept {
                target = Some(v);
                break;
            }
        }

        if let Some(v) = target {
            fixes.push(PlannedFix {
                name: inst.name,
                name_hash: inst.name_hash,
                from: inst.from,
                to: fmt_version(v, manifest_buf),
                to_version: Semver::Version {
                    major: v.major,
                    minor: v.minor,
                    patch: v.patch,
                    ..Default::default()
                },
            });
            continue;
        }

        for &a in &inst.advisories {
            advisory_still_present[a] = true;
        }
        let Some(needs) = needs else {
            unfixable.push(UnfixableFix {
                name: inst.name,
                from: inst.from,
                reason: match too_recent {
                    Some(v) => UnfixableReason::TooRecent(fmt_version(v, manifest_buf)),
                    None => UnfixableReason::NoSafeRelease,
                },
            });
            continue;
        };
        let blockers: Vec<Blocker> = inst
            .edges
            .iter()
            .filter(|edge| {
                edge.bundled
                    || !edge.range.as_ref().is_some_and(|range| {
                        range.npm().version.satisfies(needs, buf, manifest_buf)
                    })
            })
            .map(|edge| Blocker {
                dependent: edge.dependent.clone(),
                range: if edge.bundled {
                    inst.from.clone()
                } else {
                    match &edge.range {
                        Some(range) => Box::from(range.literal.slice(buf)),
                        None => edge.literal.clone(),
                    }
                },
                bundled: edge.bundled,
            })
            .collect();
        blocked.push(BlockedFix {
            name: inst.name,
            from: inst.from,
            needs: fmt_version(needs, manifest_buf),
            blockers,
        });
    }

    fixes.sort_by(|a, b| order_name_from(&a.name, &a.from, &b.name, &b.from));
    blocked.sort_by(|a, b| order_name_from(&a.name, &a.from, &b.name, &b.from));
    unfixable.sort_by(|a, b| order_name_from(&a.name, &a.from, &b.name, &b.from));

    let remaining = advisory_still_present
        .iter()
        .filter(|&&present| present)
        .count() as u32;
    Ok(FixPlan {
        fixes,
        blocked,
        unfixable,
        unmatched,
        fixed_vulnerabilities: advisories.len() as u32 - remaining,
        remaining_vulnerabilities: remaining,
    })
}

impl FixPlan {
    pub fn print_sections(&self) {
        if !self.fixes.is_empty() {
            prettyln!("fixing:");
            for fix in &self.fixes {
                prettyln!(
                    "  {}@{} → <green>{}<r>",
                    BStr::new(&fix.name),
                    BStr::new(&fix.from),
                    BStr::new(&fix.to)
                );
            }
            prettyln!("");
        }
        if !self.blocked.is_empty() {
            prettyln!("<yellow>requires a semver-major update:<r>");
            for item in &self.blocked {
                prettyln!(
                    "  {}@{} → {}",
                    BStr::new(&item.name),
                    BStr::new(&item.from),
                    BStr::new(&item.needs)
                );
                for blocker in &item.blockers {
                    prettyln!(
                        "    {} {} {}@{}",
                        BStr::new(&blocker.dependent),
                        if blocker.bundled {
                            "bundles"
                        } else {
                            "depends on"
                        },
                        BStr::new(&item.name),
                        BStr::new(&blocker.range)
                    );
                }
            }
            prettyln!("");
        }
        if !self.unfixable.is_empty() {
            prettyln!("<red>no fix available:<r>");
            for item in &self.unfixable {
                let name = BStr::new(&item.name);
                let from = BStr::new(&item.from);
                match &item.reason {
                    UnfixableReason::NoSafeRelease => prettyln!("  {}@{}", name, from),
                    UnfixableReason::TooRecent(version) => prettyln!(
                        "  {}@{} <d>({} is newer than --minimum-release-age)<r>",
                        name,
                        from,
                        BStr::new(version)
                    ),
                    UnfixableReason::ManifestUnavailable => {
                        prettyln!("  {}@{} <d>(failed to fetch the manifest)<r>", name, from)
                    }
                }
            }
            prettyln!("");
        }
        if !self.unmatched.is_empty() {
            prettyln!("<red>not matched to an installed version:<r>");
            for item in &self.unmatched {
                prettyln!("  {}@{}", BStr::new(&item.name), BStr::new(&item.range));
            }
            prettyln!("");
        }
        Output::flush();
    }

    pub fn print_summary(&self, dry_run: bool) {
        if self.fixes.is_empty() {
            prettyln!("No fixable vulnerabilities");
        } else {
            let packages = self
                .fixes
                .iter()
                .zip(self.fixes.iter().skip(1))
                .filter(|(a, b)| a.name != b.name)
                .count()
                + 1;
            prettyln!(
                "<green>{}<r> {} {} in {} {}",
                if dry_run { "Would fix" } else { "Fixed" },
                self.fixed_vulnerabilities,
                vuln_word(self.fixed_vulnerabilities),
                packages,
                pkg_word(packages)
            );
        }
        if self.remaining_vulnerabilities > 0 {
            prettyln!(
                "<red>{} {} remaining<r>",
                self.remaining_vulnerabilities,
                vuln_word(self.remaining_vulnerabilities)
            );
        }
    }

    pub fn exit_code(&self) -> u32 {
        u32::from(self.remaining_vulnerabilities > 0)
    }

    pub fn pins(&self) -> Box<[PlannedFix]> {
        self.fixes.clone().into_boxed_slice()
    }
}

pub fn enqueue_planned_fixes(manager: &mut PackageManager) -> crate::Result<()> {
    let pins = core::mem::take(&mut manager.audit_fix_pins);
    let _ = manager.get_cache_directory();
    let _ = manager.get_temporary_directory();
    manager
        .options
        .enable
        .set(Enable::FORCE_SAVE_LOCKFILE, true);

    let target_of: Vec<u32> = {
        let lockfile = &*manager.lockfile;
        let buf = lockfile.buffers.string_bytes.as_slice();
        let name_hashes = lockfile.packages.items_name_hash();
        let res = lockfile.packages.items_resolution();
        (0..res.len())
            .map(|pkg_id| {
                if res[pkg_id].tag != ResolutionTag::Npm {
                    return u32::MAX;
                }
                let mut version: Option<Box<[u8]>> = None;
                for (i, pin) in pins.iter().enumerate() {
                    if pin.name_hash != name_hashes[pkg_id] {
                        continue;
                    }
                    let version =
                        version.get_or_insert_with(|| fmt_version(res[pkg_id].npm().version, buf));
                    if version[..] == pin.from[..] {
                        return i as u32;
                    }
                }
                u32::MAX
            })
            .collect()
    };

    let n = manager.lockfile.buffers.resolutions.len();
    for dep_id in 0..n {
        let target = manager.lockfile.buffers.resolutions[dep_id];
        if target == invalid_package_id
            || target as usize >= target_of.len()
            || target_of[target as usize] == u32::MAX
        {
            continue;
        }
        let row = manager.lockfile.buffers.dependencies[dep_id].clone();
        if row.behavior.is_optional_peer() || row.behavior.is_bundled() {
            continue;
        }
        let pkg_name = manager.lockfile.packages.items_name()[target as usize];
        let pin = &pins[target_of[target as usize] as usize];
        let pinned = Dependency {
            name: row.name,
            name_hash: row.name_hash,
            behavior: row.behavior.with(Behavior::PEER, false),
            version: dependency::Version {
                tag: DependencyVersionTag::Npm,
                literal: Semver::String::default(),
                value: dependency::Value {
                    npm: ManuallyDrop::new(dependency::NpmInfo {
                        name: pkg_name,
                        version: Group::from(pin.to_version),
                        is_alias: true,
                    }),
                },
            },
        };
        manager.lockfile.buffers.resolutions[dep_id] = invalid_package_id;
        enqueue_dependency_with_main(
            manager,
            dep_id as DependencyID,
            &pinned,
            invalid_package_id,
            false,
        )?;
    }
    Ok(())
}
