//! `packageExtensions`. The dependencies that an extension adds become ordinary dependencies in the
//! lockfile. `Applied` records which ones were added, so that removing an extension can undo it.

use std::io::Write as _;

use bun_alloc::AllocError;
use bun_ast::Expr;
use bun_collections::index_sort;
use bun_core::fmt::format_json_string_utf8;
use bun_semver::string::Builder;
use bun_semver::{self as semver, SlicedString, String as SemverString};

use crate::dependency::{self, Behavior, TagExt as _, VersionTag};
use crate::lockfile_real::override_selector::parse_package_segment;
use crate::lockfile_real::package::{Package, PackageColumns as _};
use crate::lockfile_real::{DependencySlice, Lockfile, PackageIDSlice};
use crate::resolution_real::Tag as ResolutionTag;
use crate::{Dependency, DependencyID, PackageID, PackageNameHash, invalid_package_id};

#[derive(Default)]
pub(crate) struct PackageExtensions {
    /// From package.json, on every install. Not saved.
    pub(crate) rules: Vec<Rule>,
    /// What the extensions changed in this lockfile's packages. Saved in the lockfile.
    pub(crate) applied: Vec<Applied>,
}

/// `"<name>[@<range>]": { .. }`
pub(crate) struct Rule {
    name_hash: PackageNameHash,
    /// Empty means every version.
    range: Box<[u8]>,
    /// At most one that is a peer and one that is not for a name.
    edges: Vec<Edge>,
}

struct Edge {
    name: Box<[u8]>,
    name_hash: PackageNameHash,
    literal: Box<[u8]>,
    /// `PROD`, `OPTIONAL`, `PEER` or `PEER | OPTIONAL`
    behavior: Behavior,
}

/// The hash of `<name>@<version>` (like the keys of `patched_dependencies`), the dependency's name,
/// and what was done to it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Applied(u64, PackageNameHash, Kind);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A row in `dependencies` or `optionalDependencies` that the package does not declare.
    Dependency = 0,
    /// A row in `peerDependencies` that the package does not declare.
    Peer = 1,
    /// A peer the package declares, made optional.
    OptionalPeer = 2,
}

/// The keys of an entry in bun.lock.
const KINDS: [(Kind, &str); 3] = [
    (Kind::Dependency, "dependencies"),
    (Kind::Peer, "peerDependencies"),
    (Kind::OptionalPeer, "optionalPeers"),
];

const GROUPS: [(&[u8], Behavior); 3] = [
    (b"dependencies", Behavior::PROD),
    (b"optionalDependencies", Behavior::OPTIONAL),
    (b"peerDependencies", Behavior::PEER),
];

impl Edge {
    fn new(name: &[u8], literal: &[u8], behavior: Behavior) -> Edge {
        Edge {
            name: Box::from(name),
            name_hash: Builder::string_hash(name),
            literal: Box::from(literal),
            behavior,
        }
    }
}

impl Rule {
    fn parse(key: &[u8], value: &Expr, arena: &bun_alloc::Arena) -> Result<Rule, &'static str> {
        let Ok(selector) = parse_package_segment(key) else {
            return Err("expected \"name\" or \"name@range\"");
        };
        if !selector.range.is_empty()
            && semver_range(selector.range).is_none_or(|range| range.is_empty())
        {
            return Err("expected a semver range after the \"@\"");
        }
        if !value.is_object() {
            return Err("expected an object");
        }

        let mut edges: Vec<Edge> = Vec::new();
        for (group, behavior) in GROUPS {
            let Some(rows) = value.get(group) else {
                continue;
            };
            if !rows.is_object() {
                return Err("expected a map of specifiers");
            }
            rows.try_for_each_property(|name, _, literal| {
                let Some(literal) = literal.as_string(arena) else {
                    return Err("expected a map of specifiers");
                };
                if name.is_empty() || !is_supported_specifier(literal) {
                    // A path would be read against the extended package, not the project.
                    return Err(
                        "expected a version, a tag, a git repository or a tarball URL for every dependency",
                    );
                }
                let edge = Edge::new(name, literal, behavior);
                match edges.iter_mut().find(|other| {
                    other.name_hash == edge.name_hash
                        && other.behavior.is_peer() == behavior.is_peer()
                }) {
                    // As in a manifest, `optionalDependencies` overrides `dependencies`.
                    Some(other) => *other = edge,
                    None => edges.push(edge),
                }
                Ok(())
            })?;
        }
        if let Some(meta) = value.get(b"peerDependenciesMeta") {
            meta.for_each_property(|name, _, peer_meta| {
                if peer_meta.get(b"optional").and_then(|e| e.as_bool()) != Some(true) {
                    return;
                }
                let name_hash = Builder::string_hash(name);
                match edges
                    .iter_mut()
                    .find(|edge| edge.name_hash == name_hash && edge.behavior.is_peer())
                {
                    Some(peer) => peer.behavior.insert(Behavior::OPTIONAL),
                    None => edges.push(Edge::new(name, b"*", Behavior::PEER | Behavior::OPTIONAL)),
                }
            });
        }

        Ok(Rule {
            name_hash: Builder::string_hash(selector.name),
            range: Box::from(selector.range),
            edges,
        })
    }

    fn matches(&self, version: semver::Version, version_buf: &[u8]) -> bool {
        range_matches(&self.range, version, version_buf)
    }
}

/// Matches prereleases too, like yarn. An empty range matches every version.
fn range_matches(range: &[u8], version: semver::Version, version_buf: &[u8]) -> bool {
    range.is_empty()
        || semver_range(range)
            .is_some_and(|group| group.satisfies_including_prerelease(version, range, version_buf))
}

/// Returns true if an extension with the key `key` applies to `name` at `version`.
pub(crate) fn key_matches(
    key: &[u8],
    name: &[u8],
    version: semver::Version,
    version_buf: &[u8],
) -> bool {
    parse_package_segment(key).is_ok_and(|selector| {
        selector.name == name && range_matches(selector.range, version, version_buf)
    })
}

/// Why an install would ignore this rule, if it would.
pub(crate) fn rule_problem(key: &[u8], value: &Expr) -> Option<&'static str> {
    Rule::parse(key, value, &bun_alloc::Arena::new()).err()
}

fn semver_range(range: &[u8]) -> Option<semver::query::Group> {
    semver::query::parse_including_prerelease(range, SlicedString::init(range, range)).ok()
}

fn is_supported_specifier(literal: &[u8]) -> bool {
    let trimmed = dependency::trim_literal(literal);
    let tag = VersionTag::infer(trimmed);
    match tag {
        VersionTag::Npm | VersionTag::DistTag | VersionTag::Git | VersionTag::Github => {}
        VersionTag::Tarball if dependency::is_remote_tarball(trimmed) => {}
        _ => return false,
    }
    dependency::parse_with_tag(
        SemverString::default(),
        None,
        trimmed,
        tag,
        &SlicedString::init(literal, trimmed),
        None,
        None,
    )
    .is_some()
}

/// What the extensions want for one name in one package.
struct Wanted<'a> {
    edge: &'a Edge,
    behavior: Behavior,
    /// The package has a row for it.
    found: bool,
}

impl Wanted<'_> {
    fn of<'a>(
        rules: &'a [Rule],
        name_hash: PackageNameHash,
        version: semver::Version,
        buf: &[u8],
    ) -> Vec<Wanted<'a>> {
        let mut wanted: Vec<Wanted<'a>> = Vec::new();
        for rule in rules {
            if rule.name_hash != name_hash || !rule.matches(version, buf) {
                continue;
            }
            for edge in &rule.edges {
                match wanted
                    .iter_mut()
                    .find(|first| first.is_for(edge.name_hash, edge.behavior))
                {
                    // Like in Yarn, the first extension for a name wins, but any of them can make a
                    // peer optional.
                    Some(first) => {
                        if edge.behavior.is_optional_peer() {
                            first.behavior.insert(Behavior::OPTIONAL);
                        }
                    }
                    None => wanted.push(Wanted {
                        edge,
                        behavior: edge.behavior,
                        found: false,
                    }),
                }
            }
        }
        wanted
    }

    fn is_for(&self, name_hash: PackageNameHash, behavior: Behavior) -> bool {
        self.edge.name_hash == name_hash && self.behavior.is_peer() == behavior.is_peer()
    }

    /// bun.lock lists an unresolved required peer as optional, so that difference doesn't mean the
    /// extension changed.
    fn is_row(&self, row: &Dependency, buf: &[u8]) -> bool {
        let optional = row.behavior.contains(Behavior::OPTIONAL);
        *row.version.literal.slice(buf) == *self.edge.literal
            && (optional == self.behavior.contains(Behavior::OPTIONAL)
                || (optional && self.behavior.is_peer()))
    }
}

impl PackageExtensions {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.rules.is_empty() && self.applied.is_empty()
    }

    pub(crate) fn parse(
        &mut self,
        log: &mut bun_ast::Log,
        source: &bun_ast::Source,
        root_package_json: &Expr,
    ) {
        self.rules.clear();
        if let Some(extensions) = root_package_json.get(b"packageExtensions") {
            self.parse_rules(log, source, &extensions);
        }
    }

    #[cold]
    #[inline(never)]
    fn parse_rules(&mut self, log: &mut bun_ast::Log, source: &bun_ast::Source, rules: &Expr) {
        if !rules.is_object() {
            log.add_warning(
                Some(source),
                rules.loc,
                b"\"packageExtensions\" expects an object",
            );
            return;
        }
        let arena = bun_alloc::Arena::new();
        rules.for_each_property(
            |key, key_loc, value| match Rule::parse(key, &value, &arena) {
                Ok(rule) => self.rules.push(rule),
                Err(problem) => log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!(
                        "Ignored \"{}\" in \"packageExtensions\": {}",
                        bun_core::fmt::escape_control_chars(key),
                        problem,
                    ),
                ),
            },
        );
    }

    /// Returns the dependencies `packageExtensions` adds to a package, as `(name hash, is peer)`.
    pub(crate) fn dependencies_added_to(
        &self,
        name_hash: PackageNameHash,
        version: semver::Version,
        buf: &[u8],
    ) -> Vec<(PackageNameHash, bool)> {
        Wanted::of(&self.rules, name_hash, version, buf)
            .iter()
            .map(|wanted| (wanted.edge.name_hash, wanted.behavior.is_peer()))
            .collect()
    }

    fn record(&mut self, applied: Applied) {
        if !self.applied.contains(&applied) {
            self.applied.push(applied);
        }
    }

    /// Reads the records from bun.lock. A record that isn't understood is skipped, so its
    /// dependency counts as declared by the package.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_applied(&mut self, section: &Expr) {
        section.for_each_property(|label, _, lists| {
            for (kind, key) in KINDS {
                let Some(mut names) = lists.get(key.as_bytes()).and_then(|list| list.as_array())
                else {
                    continue;
                };
                while let Some(name) = names.next() {
                    if let Some(name) = name.as_utf8_string_literal() {
                        self.record(Applied(
                            Builder::string_hash(label),
                            Builder::string_hash(name),
                            kind,
                        ));
                    }
                }
            }
        });
    }

    /// For bun.lockb. Each record is `[package, name_hash, kind]`.
    #[cold]
    #[inline(never)]
    pub(crate) fn applied_words(&self) -> Vec<u64> {
        let mut words = Vec::with_capacity(self.applied.len() * 3);
        for applied in &self.applied {
            words.extend_from_slice(&[applied.0, applied.1, applied.2 as u64]);
        }
        words
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn set_applied_words(&mut self, words: &[u64]) {
        for word in words.as_chunks::<3>().0 {
            if let Some(&(kind, _)) = KINDS.iter().find(|(kind, _)| *kind as u64 == word[2]) {
                self.record(Applied(word[0], word[1], kind));
            }
        }
    }
}

impl Lockfile {
    pub(crate) fn package_extension_key(&self, id: PackageID) -> u64 {
        Builder::string_hash(&crate::dedupe::label(self, id))
    }

    fn package_extension_row(
        &mut self,
        wanted: &Wanted<'_>,
        log: &mut bun_ast::Log,
    ) -> Result<Dependency, AllocError> {
        let edge = wanted.edge;
        let mut string_buf = self.string_buf();
        let name = string_buf.append_with_hash(&edge.name, edge.name_hash)?;
        let literal = string_buf.append(&edge.literal)?;
        let sliced = literal.sliced(self.buffers.string_bytes.as_slice());
        Ok(Dependency {
            name,
            name_hash: edge.name_hash,
            behavior: wanted.behavior,
            version: dependency::parse_with_tag(
                name,
                Some(edge.name_hash),
                sliced.slice,
                VersionTag::infer(dependency::trim_literal(sliced.slice)),
                &sliced,
                Some(log),
                None,
            )
            .unwrap_or_default(),
        })
    }

    /// Appends what's applied now to `now`, and the dependencies that need resolving to
    /// `unresolved`. Returns true if anything changed.
    fn extend_package(
        &mut self,
        rules: &[Rule],
        applied: &[Applied],
        log: &mut bun_ast::Log,
        id: PackageID,
        now: &mut Vec<Applied>,
        unresolved: &mut Vec<DependencyID>,
    ) -> Result<bool, AllocError> {
        let resolution = self.packages.items_resolution()[id as usize];
        if resolution.tag != ResolutionTag::Npm {
            return Ok(false);
        }
        let mut wanted = Wanted::of(
            rules,
            self.packages.items_name_hash()[id as usize],
            resolution.npm().version,
            self.buffers.string_bytes.as_slice(),
        );
        if wanted.is_empty() && applied.is_empty() {
            return Ok(false);
        }
        let package = self.package_extension_key(id);
        if wanted.is_empty() && !applied.iter().any(|applied| applied.0 == package) {
            return Ok(false);
        }
        let was = |name_hash, kind| applied.contains(&Applied(package, name_hash, kind));
        let kind_of = |row: &Dependency| {
            if row.behavior.is_peer() {
                Kind::Peer
            } else {
                Kind::Dependency
            }
        };

        let slice = self.packages.items_dependencies()[id as usize];
        let (off, len) = (slice.off as usize, slice.len as usize);
        let mut rows: Vec<(Dependency, PackageID)> = Vec::with_capacity(len + wanted.len());
        let mut changed = false;
        for i in off..off + len {
            let mut row = self.buffers.dependencies[i].clone();
            let mut resolved = self.buffers.resolutions[i];
            let name_hash = row.name_hash;
            let is_peer = row.behavior.is_peer();
            let mut rule = wanted
                .iter_mut()
                .find(|wanted| wanted.is_for(name_hash, row.behavior));
            if let Some(rule) = &mut rule {
                rule.found = true;
            }
            let kind = kind_of(&row);
            if was(name_hash, kind) {
                let Some(rule) = rule else {
                    changed = true;
                    continue;
                };
                if !rule.is_row(&row, self.buffers.string_bytes.as_slice()) {
                    row = self.package_extension_row(rule, &mut *log)?;
                    resolved = invalid_package_id;
                    changed = true;
                }
                now.push(Applied(package, name_hash, kind));
            } else if is_peer {
                // The package's own row wins. All a rule can do to it is make the peer optional.
                let is_optional = row.behavior.contains(Behavior::OPTIONAL);
                let made_optional = was(name_hash, Kind::OptionalPeer);
                if rule.is_some_and(|rule| rule.behavior.contains(Behavior::OPTIONAL)) {
                    if made_optional || !is_optional {
                        row.behavior.insert(Behavior::OPTIONAL);
                        changed |= !is_optional;
                        now.push(Applied(package, name_hash, Kind::OptionalPeer));
                    }
                } else if made_optional {
                    row.behavior.remove(Behavior::OPTIONAL);
                    changed = true;
                }
            }
            rows.push((row, resolved));
        }
        for rule in wanted.iter().filter(|wanted| !wanted.found) {
            // One row for a name, as in `Package::from_npm`.
            if rows
                .iter()
                .any(|(row, _)| row.name_hash == rule.edge.name_hash)
            {
                continue;
            }
            let row = self.package_extension_row(rule, &mut *log)?;
            now.push(Applied(package, row.name_hash, kind_of(&row)));
            rows.push((row, invalid_package_id));
            changed = true;
        }
        if !changed {
            return Ok(false);
        }

        // The rows are rewritten at the end of the buffer. `clean_with_logger` drops the old ones.
        let dependencies = &mut self.buffers.dependencies;
        let resolutions = &mut self.buffers.resolutions;
        debug_assert_eq!(dependencies.len(), resolutions.len());
        // Rows at the end are overwritten in place only if no rule was applied before. Then every
        // old row keeps its index, so the trees and slices loaded from the lockfile stay valid.
        if applied.is_empty() && off + len == dependencies.len() {
            dependencies.truncate(off);
            resolutions.truncate(off);
        }
        let off = dependencies.len() as u32;
        let len = rows.len() as u32;
        for (row, resolved) in rows {
            // An optional peer isn't resolved here. It waits for another package to install it.
            if resolved == invalid_package_id && !row.behavior.is_optional_peer() {
                unresolved.push(dependencies.len() as DependencyID);
            }
            dependencies.push(row);
            resolutions.push(resolved);
        }
        self.packages.items_dependencies_mut()[id as usize] = DependencySlice::new(off, len);
        self.packages.items_resolutions_mut()[id as usize] = PackageIDSlice::new(off, len);
        Ok(true)
    }

    /// For a migration that added the rows itself.
    pub(crate) fn record_package_extensions(
        &mut self,
        id: PackageID,
        added: &[(PackageNameHash, Kind)],
    ) {
        if added.is_empty()
            || self.packages.items_resolution()[id as usize].tag != ResolutionTag::Npm
        {
            return;
        }
        let package = self.package_extension_key(id);
        for &(name_hash, kind) in added {
            self.package_extensions
                .record(Applied(package, name_hash, kind));
        }
    }

    /// Used when migrating from pnpm-lock.yaml, which doesn't say which dependencies came from
    /// `packageExtensions`. `added` lists the ones that the package's manifest doesn't declare, as
    /// `(package, name hash, is peer)`. Each one gets the extension's range, keeps its resolved
    /// version, and is recorded as added by an extension.
    #[cold]
    #[inline(never)]
    pub(crate) fn record_migrated_package_extensions(
        &mut self,
        log: &mut bun_ast::Log,
        added: &[(PackageID, PackageNameHash, bool)],
    ) -> Result<(), AllocError> {
        let rules = core::mem::take(&mut self.package_extensions.rules);
        let result = added.iter().try_for_each(|&(id, name_hash, is_peer)| {
            self.record_migrated_package_extension(&rules, log, id, name_hash, is_peer)
        });
        self.package_extensions.rules = rules;
        result
    }

    fn record_migrated_package_extension(
        &mut self,
        rules: &[Rule],
        log: &mut bun_ast::Log,
        id: PackageID,
        name_hash: PackageNameHash,
        is_peer: bool,
    ) -> Result<(), AllocError> {
        let wanted = Wanted::of(
            rules,
            self.packages.items_name_hash()[id as usize],
            self.packages.items_resolution()[id as usize].npm().version,
            self.buffers.string_bytes.as_slice(),
        );
        let slice = self.packages.items_dependencies()[id as usize];
        let at = (slice.off as usize..(slice.off + slice.len) as usize).find(|&at| {
            let row = &self.buffers.dependencies[at];
            row.name_hash == name_hash && row.behavior.is_peer() == is_peer
        });
        let wanted = wanted.iter().find(|wanted| {
            wanted.edge.name_hash == name_hash && wanted.behavior.is_peer() == is_peer
        });
        let (Some(wanted), Some(at)) = (wanted, at) else {
            return Ok(());
        };
        let version = self.package_extension_row(wanted, log)?.version;
        // Leave the dependency alone if an override resolved it outside the extension's range.
        let buf = self.buffers.string_bytes.as_slice();
        let resolved =
            (self.packages.items_resolution()).get(self.buffers.resolutions[at] as usize);
        let is_in_range = version.tag == VersionTag::Npm
            && resolved.is_none_or(|resolved| {
                resolved.tag == ResolutionTag::Npm
                    && (version.npm().version).satisfies(resolved.npm().version, buf, buf)
            });
        if !is_in_range || (resolved.is_none() && !is_peer) {
            return Ok(());
        }
        self.buffers.dependencies[at].version = version;
        let kind = if is_peer {
            Kind::Peer
        } else {
            Kind::Dependency
        };
        let package = self.package_extension_key(id);
        self.package_extensions
            .record(Applied(package, name_hash, kind));
        Ok(())
    }

    /// For a package that `Package::from_npm` just made. Returns it with its new rows.
    #[cold]
    #[inline(never)]
    pub(crate) fn extend_new_package(
        &mut self,
        log: &mut bun_ast::Log,
        id: PackageID,
    ) -> Result<Package, AllocError> {
        let rules = core::mem::take(&mut self.package_extensions.rules);
        let mut now = Vec::new();
        // The caller walks every row of a new package.
        let extended = self.extend_package(&rules, &[], log, id, &mut now, &mut Vec::new());
        self.package_extensions.rules = rules;
        extended?;
        for applied in now {
            self.package_extensions.record(applied);
        }
        Ok(*self.packages.get(id as usize))
    }

    /// Applies the rules to a lockfile loaded from disk. If anything changed, returns the rows to
    /// resolve and the rows that no rule adds anymore, as `(package_extension_key, name hash)`.
    #[cold]
    #[inline(never)]
    pub(crate) fn reconcile_package_extensions(
        &mut self,
        log: &mut bun_ast::Log,
    ) -> Result<Option<(Vec<DependencyID>, Vec<(u64, PackageNameHash)>)>, AllocError> {
        let PackageExtensions { rules, applied } = core::mem::take(&mut self.package_extensions);
        let mut now = Vec::with_capacity(applied.len());
        let mut unresolved = Vec::new();
        let mut changed = false;
        for id in 0..self.packages.len() as PackageID {
            changed |=
                self.extend_package(&rules, &applied, &mut *log, id, &mut now, &mut unresolved)?;
        }
        // If there are fewer, a record belonged to a package that's no longer in the lockfile.
        changed |= now.len() != applied.len();
        let removed = (applied.iter())
            .filter(|applied| applied.2 != Kind::OptionalPeer && !now.contains(applied))
            .map(|applied| (applied.0, applied.1))
            .collect();
        self.package_extensions = PackageExtensions {
            rules,
            applied: now,
        };
        Ok(changed.then_some((unresolved, removed)))
    }

    /// For `clean_with_logger`: keeps the records of the packages that are still in the lockfile.
    #[cold]
    #[inline(never)]
    pub(crate) fn keep_package_extensions_of(&mut self, old: &Lockfile) {
        for id in 0..self.packages.len() as PackageID {
            if self.packages.items_resolution()[id as usize].tag != ResolutionTag::Npm {
                continue;
            }
            let package = self.package_extension_key(id);
            self.package_extensions.applied.extend(
                (old.package_extensions.applied.iter()).filter(|applied| applied.0 == package),
            );
        }
    }

    /// The entries of `packageExtensions` in bun.lock, one line each, sorted.
    #[cold]
    #[inline(never)]
    pub(crate) fn package_extension_lines(&self) -> Vec<Vec<u8>> {
        let buf = self.buffers.string_bytes.as_slice();
        let applied = &self.package_extensions.applied;
        let hoisted = &self.buffers.hoisted_dependencies;
        let resolutions = &self.buffers.resolutions;
        let mut lines: Vec<Vec<u8>> = Vec::new();
        for id in 0..self.packages.len() {
            if self.packages.items_resolution()[id].tag != ResolutionTag::Npm {
                continue;
            }
            let label = crate::dedupe::label(self, id as PackageID);
            let package = Builder::string_hash(&label);
            if !applied.iter().any(|applied| applied.0 == package) {
                continue;
            }
            // bun.lock's `packages` only lists packages that are in an install tree.
            if !hoisted
                .iter()
                .any(|&row| resolutions[row as usize] as usize == id)
            {
                continue;
            }
            let rows =
                self.packages.items_dependencies()[id].get(self.buffers.dependencies.as_slice());
            let mut line: Vec<u8> = Vec::new();
            for (kind, key) in KINDS {
                let mut names: Vec<&[u8]> = rows
                    .iter()
                    .filter(|row| {
                        row.behavior.is_peer() == (kind != Kind::Dependency)
                            && applied.contains(&Applied(package, row.name_hash, kind))
                    })
                    .map(|row| row.name.slice(buf))
                    .collect();
                if names.is_empty() {
                    continue;
                }
                index_sort::sort_slice_unstable_by(&mut names, |a, b| a.cmp(b));
                let _ = if line.is_empty() {
                    write!(
                        line,
                        "{}: {{",
                        format_json_string_utf8(&label, Default::default())
                    )
                } else {
                    line.write_all(b",")
                };
                let _ = write!(line, " \"{key}\": [");
                for (i, name) in names.iter().enumerate() {
                    let _ = write!(
                        line,
                        "{}{}",
                        if i == 0 { "" } else { ", " },
                        format_json_string_utf8(name, Default::default()),
                    );
                }
                line.push(b']');
            }
            if !line.is_empty() {
                line.extend_from_slice(b" },\n");
                lines.push(line);
            }
        }
        index_sort::sort_slice_unstable_by(&mut lines, |a, b| a.cmp(b));
        lines
    }
}
