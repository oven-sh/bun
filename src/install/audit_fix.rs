use core::cmp::Ordering;
use core::mem::ManuallyDrop;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::{DynamicBitSet, HashMap, index_sort};
use bun_core::{Global, Output, UnwrapOrOom as _, pretty, prettyln, strings};
use bun_semver::query::Group;
use bun_semver::{self as Semver, SlicedString};

use crate::dependency::Behavior;
use crate::lockfile::Lockfile;
use crate::lockfile::package::PackageColumns as _;
use crate::npm::PackageManifest;
use crate::package_manager::Options::{Do, Enable, LogLevel};
use crate::package_manager_real::enqueue_dependency_with_main;
use crate::package_manager_real::populate_manifest_cache::{self, Packages};
use crate::update_transitive::{pretty_update_row, row_glyphs};
use crate::{
    Dependency, DependencyID, DependencyVersionTag, PackageID, PackageManager, PackageNameHash,
    ResolutionTag, dependency, invalid_package_id,
};

mod json;
mod package_json_edits;
pub use package_json_edits::PackageJsonEdit;

pub struct Advisory {
    pub package_name: Box<[u8]>,
    pub vulnerable_versions: Box<[u8]>,
    /// What `bun audit --ignore` takes for this advisory: its GHSA id when the url has one, else its numeric id.
    pub ignore_token: Box<[u8]>,
}

#[derive(Clone)]
pub struct PlannedFix {
    pub name: Box<[u8]>,
    pub name_hash: PackageNameHash,
    pub from: Box<[u8]>,
    pub to: Box<[u8]>,
    pub to_version: Semver::Version,
    pub edges: Vec<PlannedEdge>,
    pub downgrade: bool,
    pub too_recent: bool,
    pub edits: Vec<PackageJsonEdit>,
}

/// `dep_id` is only valid against the pre-install lockfile; the differ re-appends an importer's dependency rows, so `parent` is used to find the live row.
#[derive(Clone, Copy)]
pub struct PlannedEdge {
    pub dep_id: DependencyID,
    pub parent: PackageID,
}

pub struct Blocker {
    pub dependent: Box<[u8]>,
    pub range: Box<[u8]>,
    pub bundled: bool,
    pub latest_fixes: bool,
}

pub struct BlockedFix {
    pub name: Box<[u8]>,
    pub from: Box<[u8]>,
    pub needs: Box<[u8]>,
    pub needs_is_downgrade: bool,
    pub blockers: Vec<Blocker>,
}

pub struct UnfixableFix {
    pub name: Box<[u8]>,
    pub from: Box<[u8]>,
    pub ignore_tokens: Vec<Box<[u8]>>,
}

pub struct ManifestUnavailable {
    pub name: Box<[u8]>,
    pub from: Box<[u8]>,
    /// `404`, the network error name, or `unknown`.
    pub error: Box<[u8]>,
    pub detail: Box<[u8]>,
}

pub struct UnmatchedAdvisory {
    pub name: Box<[u8]>,
    pub range: Box<[u8]>,
}

pub struct UnauditedRegistry {
    /// The registry's href without URL credentials or a trailing slash.
    pub registry: Box<[u8]>,
    pub packages: Vec<Box<[u8]>>,
    /// Status code or error name; empty when unknown.
    pub reason: Box<[u8]>,
}

pub struct FixPlan {
    pub fixes: Vec<PlannedFix>,
    pub blocked: Vec<BlockedFix>,
    pub unfixable: Vec<UnfixableFix>,
    pub manifest_unavailable: Vec<ManifestUnavailable>,
    pub unmatched: Vec<UnmatchedAdvisory>,
    pub unaudited: Vec<UnauditedRegistry>,
    pub fixed_vulnerabilities: u32,
    pub remaining_vulnerabilities: u32,
    /// Distinct npm package names in the lockfile, i.e. what the audit request covered (before `unaudited` skips).
    pub checked_packages: usize,
    pub quiet: bool,
    pub(crate) advisories: AdvisoryIndex,
    pub(crate) expected_gone: Vec<(PackageNameHash, Box<[u8]>)>,
}

pub(crate) struct AdvisoryIndex {
    pub(crate) range_buf: Vec<u8>,
    pub(crate) spans: Vec<(usize, usize)>,
    pub(crate) groups: Vec<Option<Group>>,
    pub(crate) by_name: HashMap<PackageNameHash, Vec<usize>>,
    pub(crate) matched_before_install: DynamicBitSet,
}

impl AdvisoryIndex {
    pub(crate) fn build(advisories: &[Advisory]) -> Result<AdvisoryIndex, bun_alloc::AllocError> {
        let mut range_buf: Vec<u8> = Vec::new();
        let mut spans: Vec<(usize, usize)> = Vec::with_capacity(advisories.len());
        for advisory in advisories {
            let range: &[u8] = if advisory.vulnerable_versions.is_empty() {
                b"*"
            } else {
                &advisory.vulnerable_versions
            };
            spans.push((range_buf.len(), range.len()));
            range_buf.extend_from_slice(range);
        }
        let groups: Vec<Option<Group>> = spans
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
        Ok(AdvisoryIndex {
            range_buf,
            spans,
            groups,
            by_name,
            matched_before_install: DynamicBitSet::init_empty(advisories.len())?,
        })
    }

    pub(crate) fn range(&self, i: usize) -> &[u8] {
        let (start, len) = self.spans[i];
        &self.range_buf[start..start + len]
    }

    pub(crate) fn matches(&self, i: usize, version: Semver::Version, version_buf: &[u8]) -> bool {
        self.groups[i].as_ref().is_some_and(|group| {
            group.satisfies_including_prerelease(version, &self.range_buf, version_buf)
        })
    }
}

pub struct StillVulnerable {
    pub name: Box<[u8]>,
    pub version: Box<[u8]>,
    pub advisories: Vec<Box<[u8]>>,
}

pub struct FixOutcome {
    pub fixed_vulnerabilities: u32,
    pub remaining_vulnerabilities: u32,
    pub still_vulnerable: Vec<StillVulnerable>,
}

struct Edge {
    dep_id: DependencyID,
    parent: PackageID,
    range: Option<dependency::Version>,
    literal: Box<[u8]>,
    dependent: Box<[u8]>,
    bundled: bool,
    peer: bool,
    latest_fixes: bool,
    pin: Option<PackageJsonEdit>,
}

#[derive(Clone, Copy)]
struct Target {
    candidate: usize,
    edit: bool,
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

struct Candidate {
    version: Semver::Version,
    index: usize,
    downgrade: bool,
}

fn fmt_version(version: Semver::Version, buf: &[u8]) -> Box<[u8]> {
    let mut out: Vec<u8> = Vec::new();
    let _ = write!(out, "{}", version.fmt(buf));
    out.into_boxed_slice()
}

pub fn vuln_word(n: u32) -> &'static str {
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

fn print_elapsed_line() {
    pretty!(" ");
    Output::print_start_end_stdout(bun_core::start_time(), bun_core::time::nano_timestamp());
    prettyln!("");
}

fn print_tokens(tokens: &[Box<[u8]>]) {
    for (i, token) in tokens.iter().enumerate() {
        pretty!("{}{}", if i > 0 { ", " } else { "" }, BStr::new(token));
    }
}

pub fn exit_unless_lockfile_matches_package_json(
    manager: &mut PackageManager,
) -> crate::Result<()> {
    crate::prune::exit_unless_lockfile_matches_package_json(manager, "fix").map(drop)
}

pub fn exit_unless_lockfile_writable(manager: &PackageManager) {
    if manager.options.dry_run || manager.options.do_.save_lockfile() {
        return;
    }
    if manager.options.log_level != LogLevel::Silent {
        Output::flush();
        if manager.options.enable.frozen_lockfile() {
            Output::err_generic(
                "bun audit fix needs to write bun.lock, but the lockfile is frozen",
                (),
            );
            bun_core::note!("run 'bun audit fix' without --frozen-lockfile / --production");
        } else {
            Output::err_generic(
                "bun audit fix needs to write bun.lock, but saving the lockfile is disabled",
                (),
            );
            bun_core::note!("run 'bun audit fix' without --no-save");
        }
        Output::flush();
    }
    Global::exit(1);
}

pub fn skipped_package_count(groups: &[UnauditedRegistry]) -> usize {
    groups.iter().map(|group| group.packages.len()).sum()
}

pub fn print_unaudited(groups: &[UnauditedRegistry]) {
    if groups.is_empty() {
        return;
    }
    Output::flush();
    for group in groups {
        let mut packages: Vec<u8> = Vec::new();
        for (i, package) in group.packages.iter().enumerate() {
            if i > 0 {
                packages.extend_from_slice(b", ");
            }
            packages.extend_from_slice(package);
        }
        if group.reason.is_empty() {
            bun_core::warn!(
                "{} did not answer the audit request; skipped {}",
                bun_core::fmt::redacted_npm_url(&group.registry),
                BStr::new(&packages)
            );
        } else {
            bun_core::warn!(
                "{} did not answer the audit request ({}); skipped {}",
                bun_core::fmt::redacted_npm_url(&group.registry),
                BStr::new(&group.reason),
                BStr::new(&packages)
            );
        }
    }
    Output::flush();
}

fn importer_file(lockfile: &Lockfile, parent: PackageID) -> Option<Box<[u8]>> {
    let buf = lockfile.buffers.string_bytes.as_slice();
    let parent_res = &lockfile.packages.items_resolution()[parent as usize];
    match parent_res.tag {
        ResolutionTag::Root => Some(Box::from(&b"package.json"[..])),
        ResolutionTag::Workspace => {
            let dir = strings::without_trailing_slash(parent_res.workspace().slice(buf));
            let mut file: Vec<u8> = Vec::with_capacity(dir.len() + b"/package.json".len());
            if !dir.is_empty() {
                file.extend_from_slice(dir);
                file.push(b'/');
            }
            file.extend_from_slice(b"package.json");
            Some(file.into_boxed_slice())
        }
        _ => None,
    }
}

fn dependent_label(lockfile: &Lockfile, parent: PackageID) -> Box<[u8]> {
    if parent == invalid_package_id {
        return Box::from(&b"package.json"[..]);
    }
    if let Some(file) = importer_file(lockfile, parent) {
        return file;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let name = lockfile.packages.items_name()[parent as usize].slice(buf);
    let res = &lockfile.packages.items_resolution()[parent as usize];
    if res.tag != ResolutionTag::Npm {
        return Box::from(name);
    }
    let mut label: Vec<u8> = Vec::new();
    let _ = write!(label, "{}@{}", BStr::new(name), res.npm().version.fmt(buf));
    label.into_boxed_slice()
}

fn without_ansi(text: &[u8]) -> Vec<u8> {
    let mut plain: Vec<u8> = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = strings::index_of_char_usize(rest, 0x1b) {
        plain.extend_from_slice(&rest[..i]);
        rest = &rest[i + 1..];
        rest = match rest.iter().position(|b| b.is_ascii_alphabetic()) {
            Some(end) => &rest[end + 1..],
            None => b"",
        };
    }
    plain.extend_from_slice(rest);
    plain
}

/// Matches `GET <registry>/<name> - 404` (name may be `%2f`-encoded) or `<Err> downloading package manifest <name>`.
fn mentions_package(plain: &[u8], name: &[u8], encoded: &[u8]) -> bool {
    for needle in [encoded, name] {
        let mut start = 0;
        while let Some(i) = strings::index_of(&plain[start..], needle) {
            let at = start + i;
            let end = at + needle.len();
            if at > 0
                && matches!(plain[at - 1], b'/' | b' ')
                && plain.get(end).is_none_or(|&b| b == b' ')
            {
                return true;
            }
            start = at + 1;
        }
    }
    false
}

fn take_manifest_error(msgs: &mut Vec<bun_ast::Msg>, name: &[u8]) -> (Box<[u8]>, Box<[u8]>) {
    let encoded = strings::replace_owned(name, b"/", b"%2f");
    for i in 0..msgs.len() {
        let plain = without_ansi(msgs[i].data.text.trim_ascii());
        if !mentions_package(&plain, name, &encoded) {
            continue;
        }
        msgs.remove(i);
        let mut tokens = strings::tokenize(&plain, b" ");
        let first: &[u8] = tokens.next().unwrap_or(b"unknown");
        let error = match tokens.last() {
            Some(last) if last.iter().all(u8::is_ascii_digit) => last,
            _ => first,
        };
        return (Box::from(error), plain.into_boxed_slice());
    }
    (
        Box::from(&b"unknown"[..]),
        Box::from(&b"manifest not fetched"[..]),
    )
}

fn print_manifest_unavailable(manager: &PackageManager, items: &[ManifestUnavailable]) {
    let log = manager.log_mut();
    if manager.options.log_level == LogLevel::Silent {
        log.reset();
        return;
    }
    Output::flush();
    for item in items {
        bun_core::warn!(
            "{}@{} was not checked for updates: {}",
            BStr::new(&item.name),
            BStr::new(&item.from),
            BStr::new(&item.detail)
        );
    }
    if !log.msgs.is_empty() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    }
    log.reset();
    Output::flush();
}

fn pin_for(
    lockfile: &Lockfile,
    dep_id: usize,
    dep: &Dependency,
    parent: PackageID,
    latest: bool,
) -> Option<PackageJsonEdit> {
    if parent == invalid_package_id || dep.behavior.is_bundled() || dep.behavior.is_workspace() {
        return None;
    }
    let buf = lockfile.buffers.string_bytes.as_slice();
    let res = lockfile.packages.items_resolution();
    let parent_res = &res[parent as usize];
    if !matches!(
        parent_res.tag,
        ResolutionTag::Root | ResolutionTag::Workspace
    ) {
        return None;
    }
    let is_alias = dep.version.tag == DependencyVersionTag::Npm && dep.version.npm().is_alias;
    if !is_alias
        && lockfile
            .overrides
            .get(lockfile, dep_id as DependencyID, dep.name_hash)
            .is_some()
    {
        return None;
    }
    let key: Box<[u8]> = Box::from(dep.name.slice(buf));
    match dep.version.tag {
        DependencyVersionTag::Catalog => {
            let catalog_name = dep.version.catalog().slice(buf);
            let entry = lockfile
                .catalogs
                .find(buf, catalog_name, dep.name.slice(buf))?;
            if entry.version.tag != DependencyVersionTag::Npm
                || (!latest && entry.version.npm().version.get_exact_version().is_none())
            {
                return None;
            }
            Some(PackageJsonEdit {
                owner: 0,
                file: Box::from(&b"package.json"[..]),
                catalog: Some(Box::from(catalog_name)),
                key,
                old_literal: Box::from(entry.version.literal.slice(buf)),
                new_literal: Box::default(),
            })
        }
        DependencyVersionTag::Npm => {
            if !latest {
                dep.version.npm().version.get_exact_version()?;
            }
            Some(PackageJsonEdit {
                owner: parent,
                file: importer_file(lockfile, parent)?,
                catalog: None,
                key,
                old_literal: Box::from(dep.version.literal.slice(buf)),
                new_literal: Box::default(),
            })
        }
        _ => None,
    }
}

pub fn plan_fixes(manager: &mut PackageManager, advisories: &[Advisory]) -> crate::Result<FixPlan> {
    let latest = manager.options.do_.update_to_latest();
    let exact = manager.options.enable.exact_versions();
    let quiet = manager.options.log_level == LogLevel::Silent;
    let mut index = AdvisoryIndex::build(advisories)?;

    let mut instances: Vec<Instance> = Vec::new();
    let mut checked_names: HashMap<PackageNameHash, ()> = HashMap::new();
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
            checked_names.insert(name_hashes[pkg_id], ());
            let Some(candidates) = index.by_name.get(&name_hashes[pkg_id]) else {
                continue;
            };
            let current = res[pkg_id].npm().version;
            let matched: Vec<usize> = candidates
                .iter()
                .copied()
                .filter(|&i| index.matches(i, current, buf))
                .collect();
            if matched.is_empty() {
                continue;
            }
            for &i in &matched {
                index.matched_before_install.set(i);
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
                let mut pin = pin_for(lockfile, dep_id, dep, parent, true);
                let latest_fixes = !latest && pin.is_some();
                if latest_fixes {
                    pin = pin_for(lockfile, dep_id, dep, parent, false);
                }
                instances[instance as usize].edges.push(Edge {
                    dep_id: dep_id as DependencyID,
                    parent,
                    range: crate::dedupe::effective_npm_range(
                        lockfile,
                        dep_id as DependencyID,
                        dep,
                    ),
                    literal: Box::from(dep.version.literal.slice(buf)),
                    dependent: dependent_label(lockfile, parent),
                    bundled: dep.behavior.is_bundled(),
                    peer: dep.behavior.is_peer(),
                    latest_fixes,
                    pin,
                });
            }
        }
    }

    let mut unmatched: Vec<UnmatchedAdvisory> = (0..advisories.len())
        .filter(|&i| !index.matched_before_install.is_set(i))
        .map(|i| UnmatchedAdvisory {
            name: advisories[i].package_name.clone(),
            range: Box::from(index.range(i)),
        })
        .collect();
    index_sort::sort_vec_by(&mut unmatched, |a, b| {
        order_name_from(&a.name, &a.range, &b.name, &b.range)
    });
    unmatched.dedup_by(|a, b| a.name == b.name && a.range == b.range);

    if instances.is_empty() {
        return Ok(FixPlan {
            fixes: Vec::new(),
            blocked: Vec::new(),
            unfixable: Vec::new(),
            manifest_unavailable: Vec::new(),
            unmatched,
            unaudited: Vec::new(),
            fixed_vulnerabilities: 0,
            remaining_vulnerabilities: advisories.len() as u32,
            checked_packages: checked_names.len(),
            quiet,
            advisories: index,
            expected_gone: Vec::new(),
        });
    }

    manager.options.enable.set(Enable::MANIFEST_CACHE, false);
    manager
        .options
        .enable
        .set(Enable::MANIFEST_CACHE_CONTROL, false);
    let ids: Vec<PackageID> = instances.iter().map(|inst| inst.pkg_id).collect();
    populate_manifest_cache::populate_manifest_cache(manager, Packages::Exact(&ids))?;
    let log_msgs = &mut manager.log_mut().msgs;

    let cache_ctx = manager.manifest_disk_cache_ctx();
    let min_age = manager.options.minimum_release_age_gate_ms();
    let excludes = manager.options.minimum_release_age_excludes;
    let buf = manager.lockfile.buffers.string_bytes.as_slice();

    let mut fixes: Vec<PlannedFix> = Vec::new();
    let mut blocked: Vec<BlockedFix> = Vec::new();
    let mut unfixable: Vec<UnfixableFix> = Vec::new();
    let mut manifest_unavailable: Vec<ManifestUnavailable> = Vec::new();
    let mut expected_gone: Vec<(PackageNameHash, Box<[u8]>)> = Vec::new();
    let mut advisory_still_present = index.matched_before_install.clone()?;
    advisory_still_present.toggle_all();

    for inst in instances {
        let mut expired = false;
        let scope = manager.options.scope_for_package_name(&inst.name);
        let Some(manifest) = manager.manifests.by_name_allow_expired(
            cache_ctx,
            scope,
            &inst.name,
            Some(&mut expired),
            min_age.is_some(),
        ) else {
            for &a in &inst.advisories {
                advisory_still_present.set(a);
            }
            let (error, detail) = take_manifest_error(log_msgs, &inst.name);
            manifest_unavailable.push(ManifestUnavailable {
                name: inst.name,
                from: inst.from,
                error,
                detail,
            });
            continue;
        };
        let manifest: &PackageManifest = manifest;
        let manifest_buf: &[u8] = &manifest.string_buf;
        let releases = manifest.pkg.releases.keys.get(&manifest.versions);
        let release_pkgs = manifest.pkg.releases.values.get(&manifest.package_versions);
        let age_limit = min_age.filter(|_| !manifest.should_exclude_from_age_filter(excludes));
        let name_advisories: &[usize] = match index.by_name.get(&inst.name_hash) {
            Some(indices) => indices,
            None => &[],
        };
        let is_safe = |v: Semver::Version| {
            !name_advisories
                .iter()
                .any(|&a| index.matches(a, v, manifest_buf))
        };

        let mut candidates: Vec<Candidate> = Vec::new();
        for (i, &v) in releases.iter().enumerate() {
            if v.order(inst.current, manifest_buf, buf) == Ordering::Greater && is_safe(v) {
                candidates.push(Candidate {
                    version: v,
                    index: i,
                    downgrade: false,
                });
            }
        }
        let upgrade_count = candidates.len();
        for (i, &v) in releases.iter().enumerate().rev() {
            if v.order(inst.current, manifest_buf, buf) == Ordering::Less && is_safe(v) {
                candidates.push(Candidate {
                    version: v,
                    index: i,
                    downgrade: true,
                });
            }
        }
        if candidates.is_empty() {
            for &a in &inst.advisories {
                advisory_still_present.set(a);
            }
            let mut ignore_tokens: Vec<Box<[u8]>> = inst
                .advisories
                .iter()
                .map(|&a| advisories[a].ignore_token.clone())
                .collect();
            index_sort::sort_vec_unstable_by(&mut ignore_tokens, |a, b| a.cmp(b));
            ignore_tokens.dedup();
            unfixable.push(UnfixableFix {
                name: inst.name,
                from: inst.from,
                ignore_tokens,
            });
            continue;
        }

        let mut caret_buf: Vec<u8> = Vec::new();
        let mut caret: Option<Group> = None;
        if !latest && inst.edges.iter().any(|edge| edge.pin.is_some()) {
            caret_buf.reserve_exact(inst.from.len() + 1);
            caret_buf.push(b'^');
            caret_buf.extend_from_slice(&inst.from);
            caret = Some(Semver::query::parse(
                &caret_buf,
                SlicedString::init(&caret_buf, &caret_buf),
            )?);
        }
        let range_accepts = |edge: &Edge, v: Semver::Version| -> bool {
            !edge.bundled
                && edge
                    .range
                    .as_ref()
                    .is_some_and(|range| range.npm().version.satisfies(v, buf, manifest_buf))
        };
        let pin_accepts = |edge: &Edge, v: Semver::Version| -> bool {
            edge.pin.is_some()
                && (latest
                    || caret
                        .as_ref()
                        .is_some_and(|caret| caret.satisfies(v, &caret_buf, manifest_buf)))
        };
        let accepts = |edge: &Edge, target: Target, v: Semver::Version| -> bool {
            if target.edit {
                pin_accepts(edge, v)
            } else {
                range_accepts(edge, v)
            }
        };
        let find_target = |edge: &Edge, span: core::ops::Range<usize>| -> Option<Target> {
            span.clone()
                .find(|&c| range_accepts(edge, candidates[c].version))
                .map(|c| Target {
                    candidate: c,
                    edit: false,
                })
                .or_else(|| {
                    span.clone()
                        .find(|&c| pin_accepts(edge, candidates[c].version))
                        .map(|c| Target {
                            candidate: c,
                            edit: true,
                        })
                })
        };

        let mut target: Vec<Option<Target>> = inst
            .edges
            .iter()
            .map(|edge| {
                find_target(edge, 0..upgrade_count)
                    .or_else(|| find_target(edge, upgrade_count..candidates.len()))
            })
            .collect();
        let upgraders = || {
            inst.edges.iter().zip(&target).filter_map(|(edge, t)| {
                t.filter(|t| t.candidate < upgrade_count).map(|t| (edge, t))
            })
        };
        if upgraders().next().is_some() {
            let common = (0..upgrade_count)
                .find(|&c| upgraders().all(|(edge, t)| accepts(edge, t, candidates[c].version)));
            if let Some(common) = common {
                for t in target.iter_mut().flatten() {
                    if t.candidate < upgrade_count {
                        t.candidate = common;
                    }
                }
            }
        }

        let mut chosen: Vec<usize> = if inst.edges.is_empty() {
            vec![0]
        } else {
            target.iter().flatten().map(|t| t.candidate).collect()
        };
        index_sort::sort_slice_unstable_by(&mut chosen, |a, b| a.cmp(b));
        chosen.dedup();
        for &c in &chosen {
            let candidate = &candidates[c];
            let to = fmt_version(candidate.version, manifest_buf);
            let mut edges: Vec<PlannedEdge> = Vec::new();
            let mut edits: Vec<PackageJsonEdit> = Vec::new();
            for (edge, t) in inst
                .edges
                .iter()
                .zip(&target)
                .filter_map(|(edge, t)| t.filter(|t| t.candidate == c).map(|t| (edge, t)))
            {
                match &edge.pin {
                    Some(pin) if t.edit => {
                        if !edits.iter().any(|edit| edit.same_site(pin)) {
                            let mut edit = pin.clone();
                            edit.new_literal =
                                package_json_edits::new_literal_for(&pin.old_literal, &to, exact);
                            edits.push(edit);
                        }
                        // A rewritten peer row is deferred by the differ and rebinds to the old package unless the edge is pinned too.
                        if edge.peer {
                            edges.push(PlannedEdge {
                                dep_id: edge.dep_id,
                                parent: edge.parent,
                            });
                        }
                    }
                    _ => edges.push(PlannedEdge {
                        dep_id: edge.dep_id,
                        parent: edge.parent,
                    }),
                }
            }
            fixes.push(PlannedFix {
                name: inst.name.clone(),
                name_hash: inst.name_hash,
                from: inst.from.clone(),
                to,
                to_version: Semver::Version {
                    major: candidate.version.major,
                    minor: candidate.version.minor,
                    patch: candidate.version.patch,
                    ..Default::default()
                },
                edges,
                downgrade: candidate.downgrade,
                too_recent: age_limit.is_some_and(|limit| {
                    PackageManifest::is_package_version_too_recent(
                        &release_pkgs[candidate.index],
                        limit,
                    )
                }),
                edits,
            });
        }

        let blockers: Vec<Blocker> = inst
            .edges
            .iter()
            .zip(&target)
            .filter(|(_, t)| t.is_none())
            .map(|(edge, _)| Blocker {
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
                latest_fixes: edge.latest_fixes,
            })
            .collect();
        if blockers.is_empty() {
            expected_gone.push((inst.name_hash, inst.from));
            continue;
        }
        for &a in &inst.advisories {
            advisory_still_present.set(a);
        }
        blocked.push(BlockedFix {
            name: inst.name,
            from: inst.from,
            needs: fmt_version(candidates[0].version, manifest_buf),
            needs_is_downgrade: candidates[0].downgrade,
            blockers,
        });
    }

    index_sort::sort_vec_by(&mut fixes, |a, b| {
        order_name_from(&a.name, &a.from, &b.name, &b.from)
            .then_with(|| a.to_version.order(b.to_version, b"", b""))
    });
    index_sort::sort_vec_by(&mut blocked, |a, b| {
        order_name_from(&a.name, &a.from, &b.name, &b.from)
    });
    index_sort::sort_vec_by(&mut unfixable, |a, b| {
        order_name_from(&a.name, &a.from, &b.name, &b.from)
    });
    index_sort::sort_vec_by(&mut manifest_unavailable, |a, b| {
        order_name_from(&a.name, &a.from, &b.name, &b.from)
    });
    print_manifest_unavailable(manager, &manifest_unavailable);

    let remaining = advisory_still_present.count() as u32;
    Ok(FixPlan {
        fixes,
        blocked,
        unfixable,
        manifest_unavailable,
        unmatched,
        unaudited: Vec::new(),
        fixed_vulnerabilities: advisories.len() as u32 - remaining,
        remaining_vulnerabilities: remaining,
        checked_packages: checked_names.len(),
        quiet,
        advisories: index,
        expected_gone,
    })
}

impl FixPlan {
    pub fn print_sections(&self) {
        if self.quiet {
            return;
        }
        let glyphs = row_glyphs();
        if !self.fixes.is_empty() {
            prettyln!("fixing:");
            for fix in &self.fixes {
                pretty!("  ");
                pretty_update_row(&fix.name, &fix.from, &fix.to, fix.downgrade);
                if fix.downgrade {
                    pretty!(" <d>(downgrade)<r>");
                }
                if fix.too_recent {
                    pretty!(" <yellow>(newer than --minimum-release-age)<r>");
                }
                prettyln!("");
                for edit in &fix.edits {
                    pretty!("    {}", BStr::new(&edit.file));
                    match edit.catalog.as_deref() {
                        None => {}
                        Some(b"" | b"default") => pretty!(" (catalog)"),
                        Some(catalog) => pretty!(" (catalog {})", BStr::new(catalog)),
                    }
                    prettyln!(
                        ": <d>{} {}<r> {}",
                        BStr::new(&edit.old_literal),
                        glyphs.arrow,
                        BStr::new(&edit.new_literal)
                    );
                }
            }
            prettyln!("");
        }
        if !self.blocked.is_empty() {
            prettyln!("blocked by a dependent's range:");
            for item in &self.blocked {
                pretty!(
                    "  {} <b>{}<r> <d>{} {}<r> <b>{}<r>",
                    if item.needs_is_downgrade {
                        glyphs.down
                    } else {
                        glyphs.up
                    },
                    BStr::new(&item.name),
                    BStr::new(&item.from),
                    glyphs.arrow,
                    BStr::new(&item.needs)
                );
                if item.needs_is_downgrade {
                    pretty!(" <d>(downgrade)<r>");
                }
                prettyln!("");
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
                if item.blockers.iter().any(|blocker| blocker.latest_fixes) {
                    prettyln!("    <cyan>bun audit fix --latest<r>");
                }
            }
            prettyln!("");
        }
        if !self.unfixable.is_empty() {
            prettyln!("no published version fixes:");
            let mut all_tokens: Vec<Box<[u8]>> = Vec::new();
            for item in &self.unfixable {
                pretty!("  {}@{}  <d>", BStr::new(&item.name), BStr::new(&item.from));
                print_tokens(&item.ignore_tokens);
                prettyln!("<r>");
                for token in &item.ignore_tokens {
                    if !all_tokens.contains(token) {
                        all_tokens.push(token.clone());
                    }
                }
            }
            pretty!("    <cyan>bun audit fix");
            for token in &all_tokens {
                pretty!(" --ignore {}", BStr::new(token));
            }
            prettyln!("<r>");
            prettyln!("");
        }
        if !self.unmatched.is_empty() {
            prettyln!("not matched to an installed version:");
            for item in &self.unmatched {
                prettyln!("  {}@{}", BStr::new(&item.name), BStr::new(&item.range));
            }
            prettyln!("");
        }
        Output::flush();
    }

    fn print_checked(&self) {
        let skipped = skipped_package_count(&self.unaudited);
        let checked = self.checked_packages.saturating_sub(skipped);
        if skipped > 0 {
            pretty!(" <d>(checked {}, {} skipped)<r>", checked, skipped);
        } else {
            pretty!(" <d>(checked {})<r>", checked);
        }
    }

    fn print_summary_lines(&self, dry_run: bool, fixed: u32, remaining: u32) {
        if self.fixes.is_empty() {
            let total = fixed + remaining;
            pretty!("Fixed <b>0<r> of {} {}", total, vuln_word(total));
        } else {
            let packages = self
                .fixes
                .iter()
                .zip(self.fixes.iter().skip(1))
                .filter(|(a, b)| a.name != b.name)
                .count()
                + 1;
            if dry_run {
                pretty!("Would fix <b>{}<r>", fixed);
            } else if fixed > 0 {
                pretty!("Fixed <green>{}<r>", fixed);
            } else {
                pretty!("Fixed <b>0<r>");
            }
            pretty!(
                " {} in {} {}",
                vuln_word(fixed),
                packages,
                pkg_word(packages)
            );
        }
        self.print_checked();
        print_elapsed_line();
        if remaining > 0 {
            prettyln!("<red>{}<r> {} remaining", remaining, vuln_word(remaining));
        }
    }

    pub fn finish_planned(&self, json: bool, dry_run: bool) -> u32 {
        if json {
            json::write(self, None, dry_run);
        } else if !self.quiet {
            self.print_summary_lines(
                dry_run,
                self.fixed_vulnerabilities,
                self.remaining_vulnerabilities,
            );
        }
        Output::flush();
        u32::from(self.remaining_vulnerabilities > 0)
    }

    pub fn finish_installed(
        &self,
        lockfile: &Lockfile,
        installed_advisories: &[Advisory],
        json: bool,
    ) -> u32 {
        let outcome = self.outcome(lockfile, installed_advisories);
        if json {
            json::write(self, Some(&outcome), false);
        } else if !self.quiet {
            if !outcome.still_vulnerable.is_empty() {
                prettyln!("vulnerable after install:");
                for item in &outcome.still_vulnerable {
                    pretty!(
                        "  {}@{}  <d>",
                        BStr::new(&item.name),
                        BStr::new(&item.version)
                    );
                    print_tokens(&item.advisories);
                    prettyln!("<r>");
                }
                prettyln!("");
            }
            self.print_summary_lines(
                false,
                outcome.fixed_vulnerabilities,
                outcome.remaining_vulnerabilities,
            );
        }
        Output::flush();
        u32::from(outcome.remaining_vulnerabilities > 0)
    }

    pub fn outcome(&self, lockfile: &Lockfile, installed_advisories: &[Advisory]) -> FixOutcome {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let names = lockfile.packages.items_name();
        let name_hashes = lockfile.packages.items_name_hash();
        let res = lockfile.packages.items_resolution();
        let planned = &self.advisories;
        let installed = AdvisoryIndex::build(installed_advisories).unwrap_or_oom();

        let mut plan_remaining = planned.matched_before_install.clone().unwrap_or_oom();
        plan_remaining.toggle_all();
        let staying: Vec<(PackageNameHash, &[u8])> = self
            .blocked
            .iter()
            .map(|b| (&*b.name, &*b.from))
            .chain(self.unfixable.iter().map(|u| (&*u.name, &*u.from)))
            .chain(
                self.manifest_unavailable
                    .iter()
                    .map(|m| (&*m.name, &*m.from)),
            )
            .map(|(name, from)| (Semver::string::Builder::string_hash(name), from))
            .collect();

        let mut still_vulnerable: Vec<StillVulnerable> = Vec::new();
        for pkg_id in 0..res.len() {
            if res[pkg_id].tag != ResolutionTag::Npm {
                continue;
            }
            let name_hash = name_hashes[pkg_id];
            let version = res[pkg_id].npm().version;
            if let Some(list) = planned.by_name.get(&name_hash) {
                for &i in list {
                    if planned.matches(i, version, buf) {
                        plan_remaining.set(i);
                    }
                }
            }
            let Some(list) = installed.by_name.get(&name_hash) else {
                continue;
            };
            let mut advisories: Vec<Box<[u8]>> = list
                .iter()
                .filter(|&&i| installed.matches(i, version, buf))
                .map(|&i| installed_advisories[i].ignore_token.clone())
                .collect();
            if advisories.is_empty() {
                continue;
            }
            index_sort::sort_vec_unstable_by(&mut advisories, |a, b| a.cmp(b));
            advisories.dedup();
            let ver = fmt_version(version, buf);
            let planned_gone = self
                .expected_gone
                .iter()
                .any(|(hash, from)| *hash == name_hash && **from == *ver);
            let reported_staying = staying
                .iter()
                .any(|&(hash, from)| hash == name_hash && *from == *ver);
            if planned_gone || !reported_staying {
                still_vulnerable.push(StillVulnerable {
                    name: Box::from(names[pkg_id].slice(buf)),
                    version: ver,
                    advisories,
                });
            }
        }
        index_sort::sort_vec_by(&mut still_vulnerable, |a, b| {
            order_name_from(&a.name, &a.version, &b.name, &b.version)
        });
        still_vulnerable.dedup_by(|a, b| a.name == b.name && a.version == b.version);

        FixOutcome {
            fixed_vulnerabilities: plan_remaining.bit_length() as u32
                - plan_remaining.count() as u32,
            remaining_vulnerabilities: installed_advisories.len() as u32,
            still_vulnerable,
        }
    }
}

pub fn prepare_install(manager: &mut PackageManager, plan: &FixPlan) -> crate::Result<()> {
    package_json_edits::apply(manager, plan)?;

    if plan.fixes.iter().any(|fix| fix.too_recent) {
        let mut names: Vec<&'static [u8]> = manager
            .options
            .minimum_release_age_excludes
            .map_or_else(Vec::new, <[_]>::to_vec);
        names.extend(
            plan.fixes
                .iter()
                .filter(|fix| fix.too_recent)
                .map(|fix| &*bun_core::heap::release(fix.name.clone())),
        );
        manager.options.minimum_release_age_excludes =
            Some(&*bun_core::heap::release(names.into_boxed_slice()));
    }

    manager.audit_fix_pins = plan
        .fixes
        .iter()
        .filter(|fix| !fix.edges.is_empty())
        .cloned()
        .collect();

    manager.options.do_.set(Do::SUMMARY, false);
    Ok(())
}

pub fn enqueue_planned_fixes(manager: &mut PackageManager) -> crate::Result<()> {
    let pins = core::mem::take(&mut manager.audit_fix_pins);
    let _ = manager.get_cache_directory();
    let _ = manager.get_temporary_directory();
    manager
        .options
        .enable
        .set(Enable::FORCE_SAVE_LOCKFILE, true);

    for pin in &pins {
        for edge in &pin.edges {
            let Some((live_dep_id, pkg_name)) = live_edge(&manager.lockfile, pin, *edge) else {
                continue;
            };
            enqueue_pinned_as(manager, live_dep_id, pkg_name, pin.to_version)?;
            manager.summary.update += 1;
        }
    }
    Ok(())
}

fn live_edge(
    lockfile: &Lockfile,
    pin: &PlannedFix,
    edge: PlannedEdge,
) -> Option<(DependencyID, Semver::String)> {
    let deps = lockfile.buffers.dependencies.as_slice();
    let target = *lockfile.buffers.resolutions.get(edge.dep_id as usize)? as usize;
    let res = lockfile.packages.items_resolution().get(target)?;
    if res.tag != ResolutionTag::Npm
        || lockfile.packages.items_name_hash()[target] != pin.name_hash
        || fmt_version(res.npm().version, lockfile.buffers.string_bytes.as_slice())[..]
            != pin.from[..]
    {
        return None;
    }
    let pkg_name = lockfile.packages.items_name()[target];
    let Some(&slice) = lockfile
        .packages
        .items_dependencies()
        .get(edge.parent as usize)
    else {
        return Some((edge.dep_id, pkg_name));
    };
    if slice.contains(edge.dep_id) {
        return Some((edge.dep_id, pkg_name));
    }
    let planned = &deps[edge.dep_id as usize];
    let live = slice
        .get(deps)
        .iter()
        .position(|dep| dep.name_hash == planned.name_hash && dep.behavior == planned.behavior)?;
    Some((slice.off + live as DependencyID, pkg_name))
}

/// Re-resolves the edge `dep_id` (which must currently resolve to an npm package) to exactly `to_version`.
pub(crate) fn enqueue_pinned(
    manager: &mut PackageManager,
    dep_id: DependencyID,
    to_version: Semver::Version,
) -> crate::Result<()> {
    let target = manager.lockfile.buffers.resolutions[dep_id as usize];
    let pkg_name = manager.lockfile.packages.items_name()[target as usize];
    enqueue_pinned_as(manager, dep_id, pkg_name, to_version)
}

fn enqueue_pinned_as(
    manager: &mut PackageManager,
    dep_id: DependencyID,
    pkg_name: Semver::String,
    to_version: Semver::Version,
) -> crate::Result<()> {
    let row = manager.lockfile.buffers.dependencies[dep_id as usize].clone();
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
                    version: Group::from(to_version),
                    is_alias: true,
                }),
            },
        },
    };
    manager.lockfile.buffers.resolutions[dep_id as usize] = invalid_package_id;
    enqueue_dependency_with_main(manager, dep_id, &pinned, invalid_package_id, false)
}
