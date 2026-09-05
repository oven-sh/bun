use core::cell::RefCell;
use core::cmp::Ordering;

use crate::DependencyID;
use crate::Error;
use crate::package_manager::workspace_package_json_cache::{GetJSONOptions, GetResult};
use crate::resolution::Tag as ResolutionTag;
use crate::{PackageID, invalid_package_id};
use bun_collections::{ArrayHashMap, index_sort};
use bun_install::dependency::{
    self, Behavior, Dependency, DependencyExt as _, NpmAliasRegistry, Tag as VersionTag,
    VersionExt as _,
};
use bun_install::{PackageManager, PackageNameHash};
use bun_output::{declare_scope, scoped_log};
use bun_paths::resolve_path;
use bun_semver::String as SemverString;
use bun_semver::Version as SemverVersion;
use bun_semver::string::Builder as SemverBuilder;

use super::override_selector::{
    PackageSelector, Selector, SelectorError, parse_package_segment, parse_selector,
};
use super::package::PackageColumns as _;
use super::package::workspace_map::WorkspaceMap;
use super::package::{DependencyGroup, value_loc_of};
use super::{Lockfile, StringBuilder, package::Package};
// LAYERING NOTE: package.json is parsed by `bun_parsers::json` which
// produces the T2 value-shaped `bun_ast::Expr` (aliased as
// `crate::bun_json::Expr`), NOT the full T4 `bun_ast::Expr`. JSON parse
// is always UTF-8, so `as_utf8_string_literal()` needs no allocator.
use crate::bun_json::Expr;

declare_scope!(OverrideMap, visible);

/// A rule that is not a plain name: scoped to a parent, to the range the dependent declares, or both.
pub struct ScopedOverride {
    pub(crate) parent: Option<Dependency>,
    pub(crate) target_range: dependency::Version,
    pub(crate) dep: Dependency,
}

impl ScopedOverride {
    #[inline]
    pub(crate) fn parent_has_range(&self) -> bool {
        self.parent
            .as_ref()
            .is_some_and(|parent| parent.version.tag == VersionTag::Npm)
    }

    #[inline]
    pub(crate) fn has_target_range(&self) -> bool {
        self.target_range.tag == VersionTag::Npm
    }
}

fn cmp_range_text(l: &ScopedOverride, r: &ScopedOverride, buf: &[u8]) -> Ordering {
    let by_parent = match (&l.parent, &r.parent) {
        (Some(a), Some(b)) if l.parent_has_range() && r.parent_has_range() => {
            a.version.literal.order(b.version.literal, buf, buf)
        }
        _ => Ordering::Equal,
    };
    by_parent.then_with(|| {
        l.target_range
            .literal
            .order(r.target_range.literal, buf, buf)
    })
}

/// dependency id -> owning package id, filled lazily because packages are only ever appended while a map is live.
#[derive(Default)]
struct OwnerIndex {
    by_dep: Vec<PackageID>,
    packages_indexed: usize,
}

#[derive(Default)]
pub struct OverrideMap {
    // `ArrayHashMap` defaults to identity hashing for integer keys.
    pub(crate) map: ArrayHashMap<PackageNameHash, Dependency>,
    pub(crate) scoped: Vec<ScopedOverride>,
    scoped_names: ArrayHashMap<PackageNameHash, ()>,
    owner_index: RefCell<OwnerIndex>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Field {
    Overrides,
    Resolutions,
}

impl Field {
    fn label(self) -> &'static str {
        match self {
            Field::Overrides => "override",
            Field::Resolutions => "resolution",
        }
    }

    fn json_name(self) -> &'static str {
        match self {
            Field::Overrides => "overrides",
            Field::Resolutions => "resolutions",
        }
    }

    fn missing_name_message(self) -> &'static str {
        match self {
            Field::Overrides => "Missing overridden package name",
            Field::Resolutions => "Missing resolution package name",
        }
    }
}

struct Ambiguous;

/// Scoped rules must not redirect every edge of the target name, so their `npm:` values are never registered as known aliases.
struct NoAliases;

impl NpmAliasRegistry for NoAliases {
    #[inline]
    fn record_npm_alias(&mut self, _hash: PackageNameHash, _version: &dependency::Version) {}
}

#[inline]
fn is_comment_key(key: &[u8]) -> bool {
    key.starts_with(b"//")
}

struct ParseContext<'a, 'b> {
    field: Field,
    pm: &'a mut PackageManager,
    lockfile_dependencies: &'a [Dependency],
    root_package: &'a Package,
    log: &'a mut bun_ast::Log,
    source: &'a bun_ast::Source,
    workspace_names: &'a WorkspaceMap,
    builder: &'a mut StringBuilder<'b>,
}

impl OverrideMap {
    /// Precedence: ranged parent > parent > none; within a tier a matching target range wins; ties go to the parent range text, then the target range text, that sorts first; then the flat map.
    pub(crate) fn get(
        &self,
        lockfile: &Lockfile,
        dependency_id: DependencyID,
        name_hash: PackageNameHash,
    ) -> Option<dependency::Version> {
        scoped_log!(OverrideMap, "looking up override for {:x}", name_hash);
        if self.scoped.is_empty() {
            return self.get_flat(name_hash);
        }
        if self.scoped_names.contains(&name_hash) {
            if let Some(rule) = self.scoped_rule_for(lockfile, dependency_id, name_hash) {
                return Some(rule.dep.version.clone());
            }
        }
        self.get_flat(name_hash)
    }

    #[inline]
    fn get_flat(&self, name_hash: PackageNameHash) -> Option<dependency::Version> {
        if self.map.count() == 0 {
            return None;
        }
        self.map.get(&name_hash).map(|dep| dep.version.clone())
    }

    fn scoped_rule_for<'s>(
        &'s self,
        lockfile: &Lockfile,
        dependency_id: DependencyID,
        name_hash: PackageNameHash,
    ) -> Option<&'s ScopedOverride> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let declared = &lockfile.buffers.dependencies[dependency_id as usize].version;
        let mut owner: Option<Option<(PackageNameHash, Option<SemverVersion>)>> = None;
        let mut best: Option<(&'s ScopedOverride, u8)> = None;

        for rule in &self.scoped {
            if rule.dep.name_hash != name_hash {
                continue;
            }
            let mut tier: u8 = 0;
            if let Some(parent) = &rule.parent {
                let Some((owner_name_hash, owner_version)) =
                    *owner.get_or_insert_with(|| self.owner_of(lockfile, dependency_id))
                else {
                    continue;
                };
                if owner_name_hash != parent.name_hash {
                    continue;
                }
                if rule.parent_has_range() {
                    let Some(owner_version) = owner_version else {
                        continue;
                    };
                    if !parent
                        .version
                        .npm()
                        .version
                        .satisfies(owner_version, buf, buf)
                    {
                        continue;
                    }
                    tier = 4;
                } else {
                    tier = 2;
                }
            }
            if rule.has_target_range() {
                if best.is_some_and(|(_, best_tier)| best_tier > tier + 1) {
                    continue;
                }
                if declared.tag != VersionTag::Npm
                    || !rule.target_range.npm().version.intersects(
                        buf,
                        &declared.npm().version,
                        buf,
                    )
                {
                    continue;
                }
                tier += 1;
            }
            let replace = match best {
                None => true,
                Some((best_rule, best_tier)) => {
                    tier > best_tier
                        || (tier == best_tier
                            && cmp_range_text(rule, best_rule, buf) == Ordering::Less)
                }
            };
            if replace {
                best = Some((rule, tier));
            }
        }

        best.map(|(rule, _)| rule)
    }

    fn owner_of(
        &self,
        lockfile: &Lockfile,
        dependency_id: DependencyID,
    ) -> Option<(PackageNameHash, Option<SemverVersion>)> {
        let owner_id = self.owner_package_id(lockfile, dependency_id);
        if owner_id == invalid_package_id {
            return None;
        }
        let owner_id = owner_id as usize;
        let owner_name_hash = lockfile.packages.items_name_hash()[owner_id];
        let resolution = &lockfile.packages.items_resolution()[owner_id];
        let owner_version = match resolution.tag {
            ResolutionTag::Npm => Some(resolution.npm().version),
            ResolutionTag::Workspace => lockfile.workspace_versions.get(&owner_name_hash).copied(),
            _ => None,
        };
        Some((owner_name_hash, owner_version))
    }

    fn owner_package_id(&self, lockfile: &Lockfile, dependency_id: DependencyID) -> PackageID {
        let dep_slices = lockfile.packages.items_dependencies();
        let dependencies_len = lockfile.buffers.dependencies.len();
        let mut index = self.owner_index.borrow_mut();
        let index = &mut *index;
        if index.packages_indexed < dep_slices.len() {
            for (pkg_id, slice) in dep_slices.iter().enumerate().skip(index.packages_indexed) {
                let end = (slice.end() as usize).min(dependencies_len);
                let begin = (slice.begin() as usize).min(end);
                if end > index.by_dep.len() {
                    index.by_dep.resize(end, invalid_package_id);
                }
                index.by_dep[begin..end].fill(pkg_id as PackageID);
            }
            index.packages_indexed = dep_slices.len();
        }
        let owner = index
            .by_dep
            .get(dependency_id as usize)
            .copied()
            .unwrap_or(invalid_package_id);
        debug_assert!(
            owner == invalid_package_id || dep_slices[owner as usize].contains(dependency_id)
        );
        owner
    }

    /// Plain rules only: a scoped rule does not make every edge of this name root-authored (trust checks in PackageManagerEnqueue.rs / PackageInstaller.rs).
    pub(crate) fn contains_name(
        &self,
        name_hash: PackageNameHash,
        name: &[u8],
        buf: &[u8],
    ) -> bool {
        if self.map.count() == 0 {
            return false;
        }
        self.map
            .get(&name_hash)
            .is_some_and(|dep| dep.name.slice(buf) == name)
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.map.count() == 0 && self.scoped.is_empty()
    }

    #[inline]
    pub(crate) fn has_scoped(&self) -> bool {
        !self.scoped.is_empty()
    }

    #[inline]
    pub(crate) fn has_rule_for_name(&self, name_hash: PackageNameHash) -> bool {
        self.map.contains(&name_hash) || self.scoped_names.contains(&name_hash)
    }

    pub(crate) fn append_overridden_name_hashes(&self, out: &mut Vec<PackageNameHash>) {
        out.extend_from_slice(self.map.keys());
        out.extend_from_slice(self.scoped_names.keys());
    }

    pub(crate) fn append_catalog_valued_name_hashes(&self, out: &mut Vec<PackageNameHash>) {
        for (name_hash, dep) in self.map.iter() {
            if dep.version.tag == VersionTag::Catalog {
                out.push(*name_hash);
            }
        }
        for rule in &self.scoped {
            if rule.dep.version.tag == VersionTag::Catalog {
                out.push(rule.dep.name_hash);
            }
        }
    }

    pub(crate) fn changed(
        from: &mut OverrideMap,
        from_string_bytes: &[u8],
        to: &mut OverrideMap,
        to_string_bytes: &[u8],
    ) -> bool {
        if from.map.count() != to.map.count() || from.scoped.len() != to.scoped.len() {
            return true;
        }
        if from.is_empty() {
            return false;
        }

        from.sort(from_string_bytes);
        to.sort(to_string_bytes);

        let flat_changed =
            from.map
                .iter()
                .zip(to.map.iter())
                .any(|((from_k, from_dep), (to_k, to_dep))| {
                    from_k != to_k || !from_dep.eql(to_dep, from_string_bytes, to_string_bytes)
                });
        if flat_changed {
            return true;
        }

        from.scoped
            .iter()
            .zip(&to.scoped)
            .any(|(from_rule, to_rule)| {
                let parent_changed = match (&from_rule.parent, &to_rule.parent) {
                    (None, None) => false,
                    (Some(from_parent), Some(to_parent)) => {
                        !from_parent.eql(to_parent, from_string_bytes, to_string_bytes)
                    }
                    _ => true,
                };
                parent_changed
                    || !from_rule.target_range.eql(
                        &to_rule.target_range,
                        from_string_bytes,
                        to_string_bytes,
                    )
                    || !from_rule
                        .dep
                        .eql(&to_rule.dep, from_string_bytes, to_string_bytes)
            })
    }

    // Every caller already holds `&mut self` on `lockfile.overrides`, so
    // accept just the string buffer (the only lockfile field `sort` reads)
    // rather than the whole `Lockfile`.
    pub(crate) fn sort(&mut self, string_bytes: &[u8]) {
        self.map.sort(|_, deps: &[Dependency], l, r| {
            deps[l].name.order(deps[r].name, string_bytes, string_bytes) == Ordering::Less
        });
        index_sort::sort_vec_by(&mut self.scoped, |l, r| {
            l.parent
                .is_some()
                .cmp(&r.parent.is_some())
                .then_with(|| match (&l.parent, &r.parent) {
                    (Some(lp), Some(rp)) => lp
                        .name
                        .order(rp.name, string_bytes, string_bytes)
                        .then_with(|| {
                            lp.version
                                .literal
                                .order(rp.version.literal, string_bytes, string_bytes)
                        }),
                    _ => Ordering::Equal,
                })
                .then_with(|| l.dep.name.order(r.dep.name, string_bytes, string_bytes))
                .then_with(|| {
                    l.target_range
                        .literal
                        .order(r.target_range.literal, string_bytes, string_bytes)
                })
        });
    }

    /// Accepts `lockfile.buffers.string_bytes` directly (rather than the whole
    /// `Lockfile`) so callers can split-borrow the lockfile alongside a live
    /// `StringBuilder`.
    pub(crate) fn count(&self, string_bytes: &[u8], builder: &mut StringBuilder) {
        for dep in self.map.values() {
            dep.count(string_bytes, builder);
        }
        for rule in &self.scoped {
            if let Some(parent) = &rule.parent {
                parent.count(string_bytes, builder);
            }
            if rule.has_target_range() {
                builder.count(rule.target_range.literal.slice(string_bytes));
            }
            rule.dep.count(string_bytes, builder);
        }
    }

    /// The new-side buffer lives inside `new_builder`, so no separate
    /// `new: &mut Lockfile` param is taken — that would alias the borrow.
    /// `pm` is generic over `NpmAliasRegistry` (not `&mut PackageManager`) so a
    /// caller already holding `&mut manager.lockfile` can pass
    /// `&mut manager.known_npm_aliases` instead of the whole manager.
    pub(crate) fn clone<PM: NpmAliasRegistry>(
        &self,
        pm: &mut PM,
        old_string_bytes: &[u8],
        new_builder: &mut StringBuilder,
    ) -> Result<OverrideMap, Error> {
        let mut new = OverrideMap::default();
        new.map.ensure_total_capacity(self.map.count())?;

        for (k, v) in self.map.keys().iter().zip(self.map.values()) {
            new.map
                .put_assume_capacity(*k, v.clone_in(pm, old_string_bytes, new_builder)?);
        }

        if !self.scoped.is_empty() {
            new.scoped = Vec::with_capacity(self.scoped.len());
            new.scoped_names
                .ensure_total_capacity(self.scoped_names.count())?;
            for rule in &self.scoped {
                let parent = match &rule.parent {
                    None => None,
                    Some(parent) => {
                        Some(parent.clone_in(&mut NoAliases, old_string_bytes, new_builder)?)
                    }
                };
                let dep = rule
                    .dep
                    .clone_in(&mut NoAliases, old_string_bytes, new_builder)?;
                let target_range = if rule.has_target_range() {
                    clone_range(&dep, &rule.target_range, old_string_bytes, new_builder)
                } else {
                    dependency::Version::default()
                };
                new.push_scoped(
                    ScopedOverride {
                        parent,
                        target_range,
                        dep,
                    },
                    new_builder.string_bytes.as_slice(),
                );
            }
        }

        Ok(new)
    }

    /// Replaces the rule with the same (parent, parent range, target, target range); `buf` is the buffer `rule` was appended into.
    pub(crate) fn push_scoped(&mut self, rule: ScopedOverride, buf: &[u8]) {
        if self.scoped_names.contains(&rule.dep.name_hash) {
            if let Some(existing) = self.scoped.iter_mut().find(|existing| {
                existing.dep.name_hash == rule.dep.name_hash
                    && match (&existing.parent, &rule.parent) {
                        (None, None) => true,
                        (Some(a), Some(b)) => {
                            a.name_hash == b.name_hash
                                && a.version.literal.eql(b.version.literal, buf, buf)
                        }
                        _ => false,
                    }
                    && existing
                        .target_range
                        .literal
                        .eql(rule.target_range.literal, buf, buf)
            }) {
                *existing = rule;
                return;
            }
        } else {
            self.scoped_names.insert(rule.dep.name_hash, ());
        }
        self.scoped.push(rule);
    }

    /// Row constructor for bun.lock / pnpm-lock.yaml; `Ok(false)` when `value`, the parent range or the target range does not parse.
    pub(crate) fn put_lockfile_rule(
        &mut self,
        parent: Option<PackageSelector<'_>>,
        target: PackageSelector<'_>,
        value: &[u8],
        buf: &mut bun_semver::string::Buf<'_>,
        log: &mut bun_ast::Log,
        manager: Option<&mut PackageManager>,
    ) -> Result<bool, Error> {
        let name_hash = SemverBuilder::string_hash(target.name);
        let name = buf.append_with_hash(target.name, name_hash)?;
        let Some(target_range) = lockfile_range(name, name_hash, target.range, buf, log)? else {
            return Ok(false);
        };

        let parent = match parent {
            None => None,
            Some(selector) => {
                let parent_name_hash = SemverBuilder::string_hash(selector.name);
                let parent_name = buf.append_with_hash(selector.name, parent_name_hash)?;
                let Some(version) =
                    lockfile_range(parent_name, parent_name_hash, selector.range, buf, log)?
                else {
                    return Ok(false);
                };
                Some(Dependency {
                    name: parent_name,
                    name_hash: parent_name_hash,
                    version,
                    behavior: Behavior::default(),
                })
            }
        };

        let is_flat = parent.is_none() && target_range.tag != VersionTag::Npm;
        let manager = if is_flat { manager } else { None };
        let value = buf.append(value)?;
        let sliced = value.sliced(buf.bytes.as_slice());
        let Some(version) = dependency::parse(name, name_hash, sliced.slice, &sliced, log, manager)
        else {
            return Ok(false);
        };
        let dep = Dependency {
            name,
            name_hash,
            version,
            behavior: Behavior::default(),
        };

        if is_flat {
            self.map.put(name_hash, dep)?;
        } else {
            self.push_scoped(
                ScopedOverride {
                    parent,
                    target_range,
                    dep,
                },
                buf.bytes.as_slice(),
            );
        }
        Ok(true)
    }

    // the rest of this struct is expression parsing code:

    pub(crate) fn parse_count(
        &mut self,
        pm: &mut PackageManager,
        log: &mut bun_ast::Log,
        json_source: &bun_ast::Source,
        workspace_names: &WorkspaceMap,
        expr: Expr,
        builder: &mut StringBuilder,
    ) {
        let (field, field_expr) = if let Some(overrides) = expr.as_property(b"overrides") {
            (Field::Overrides, overrides.expr)
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            (Field::Resolutions, resolutions.expr)
        } else {
            return;
        };

        field_expr.for_each_property(|key, _key_loc, value| {
            if is_comment_key(key) {
                return;
            }
            builder.count(key);
            if let Some(value) = value.as_utf8_string_literal() {
                if let Ok(Selector { parent, target }) = parse_selector(key) {
                    builder.count(target.name);
                    builder.count(target.range);
                    if let Some(parent) = parent {
                        builder.count(parent.name);
                        builder.count(parent.range);
                    }
                }
                builder.count(value);
                count_ref_value(pm, log, json_source, workspace_names, &expr, value, builder);
                return;
            }
            if field != Field::Overrides || !value.is_object() {
                return;
            }
            if let Ok(parent) = parse_package_segment(key) {
                builder.count(parent.name);
                builder.count(parent.range);
            }
            value.for_each_property(|child_key, _child_key_loc, child_value| {
                if is_comment_key(child_key) {
                    return;
                }
                if let Ok(selector) = parse_selector(child_key) {
                    builder.count(selector.target.name);
                    builder.count(selector.target.range);
                }
                if let Some(child_value) = child_value.as_utf8_string_literal() {
                    builder.count(child_value);
                    count_ref_value(
                        pm,
                        log,
                        json_source,
                        workspace_names,
                        &expr,
                        child_value,
                        builder,
                    );
                }
            });
        });
    }

    /// Given a package json expression, detect and parse override configuration into the given override map.
    /// It is assumed the input map is uninitialized (zero entries)
    pub(crate) fn parse_append(
        &mut self,
        pm: &mut PackageManager,
        lockfile_dependencies: &[Dependency],
        root_package: &Package,
        log: &mut bun_ast::Log,
        json_source: &bun_ast::Source,
        workspace_names: &WorkspaceMap,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        debug_assert!(self.map.count() == 0 && self.scoped.is_empty()); // only call parse once
        let (field, field_expr) = if let Some(overrides) = expr.as_property(b"overrides") {
            (Field::Overrides, overrides.expr)
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            (Field::Resolutions, resolutions.expr)
        } else {
            return Ok(());
        };
        let mut ctx = ParseContext {
            field,
            pm,
            lockfile_dependencies,
            root_package,
            log,
            source: json_source,
            workspace_names,
            builder,
        };
        match field {
            Field::Overrides => self.parse_from_overrides(&mut ctx, field_expr)?,
            Field::Resolutions => self.parse_from_resolutions(&mut ctx, field_expr)?,
        }
        scoped_log!(
            OverrideMap,
            "parsed {} overrides, {} scoped",
            self.map.count(),
            self.scoped.len()
        );
        Ok(())
    }

    /// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    fn parse_from_overrides(
        &mut self,
        ctx: &mut ParseContext<'_, '_>,
        expr: Expr,
    ) -> Result<(), Error> {
        if !expr.is_object() {
            return Err(not_an_object(ctx, expr.loc));
        }

        self.map.ensure_unused_capacity(expr.property_count())?;

        expr.try_for_each_property(|k, key_loc, value_expr| {
            if k.is_empty() {
                ctx.log.add_warning_fmt(
                    Some(ctx.source),
                    key_loc,
                    format_args!("{}", ctx.field.missing_name_message()),
                );
                return Ok(());
            }

            if is_comment_key(k) {
                return Ok(());
            }
            let value_loc =
                crate::bun_json::value_loc_of_property(&ctx.source.contents, key_loc, &value_expr);
            if let Some(value) = value_expr.as_utf8_string_literal() {
                return self.parse_string_rule(ctx, k, key_loc, value, value_loc);
            }
            if !value_expr.is_object() {
                ctx.log.add_warning_fmt(
                    Some(ctx.source),
                    value_loc,
                    format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)),
                );
                return Ok(());
            }

            let parent_selector = match parse_package_segment(k) {
                Ok(parent) => parent,
                Err(err) => {
                    warn_selector_error(ctx, k, key_loc, err);
                    return Ok(());
                }
            };
            let Some(parent) = parse_parent(ctx, key_loc, &parent_selector) else {
                return Ok(());
            };

            value_expr.try_for_each_property(|child_key, child_key_loc, child_value_expr| {
                if is_comment_key(child_key) {
                    return Ok(());
                }
                let child_value_loc = crate::bun_json::value_loc_of_property(
                    &ctx.source.contents,
                    child_key_loc,
                    &child_value_expr,
                );
                if child_value_expr.is_object() {
                    warn_selector_error(ctx, child_key, child_key_loc, SelectorError::TooDeep);
                    return Ok(());
                }
                let Some(child_value) = child_value_expr.as_utf8_string_literal() else {
                    ctx.log.add_warning_fmt(
                        Some(ctx.source),
                        child_value_loc,
                        format_args!(
                            "Invalid override value for \"{}\"",
                            bstr::BStr::new(child_key)
                        ),
                    );
                    return Ok(());
                };

                if child_key == b"." {
                    return self.put_rule(
                        ctx,
                        None,
                        &parent_selector,
                        key_loc,
                        child_value,
                        child_value_loc,
                    );
                }

                let target = match parse_selector(child_key) {
                    Ok(Selector {
                        parent: None,
                        target,
                    }) => target,
                    Ok(Selector {
                        parent: Some(_), ..
                    }) => {
                        warn_selector_error(ctx, child_key, child_key_loc, SelectorError::TooDeep);
                        return Ok(());
                    }
                    Err(err) => {
                        warn_selector_error(ctx, child_key, child_key_loc, err);
                        return Ok(());
                    }
                };
                self.put_rule(
                    ctx,
                    Some(&parent),
                    &target,
                    child_key_loc,
                    child_value,
                    child_value_loc,
                )
            })
        })
    }

    /// yarn classic: https://classic.yarnpkg.com/lang/en/docs/selective-version-resolutions/
    /// yarn berry: https://yarnpkg.com/configuration/manifest#resolutions
    fn parse_from_resolutions(
        &mut self,
        ctx: &mut ParseContext<'_, '_>,
        expr: Expr,
    ) -> Result<(), Error> {
        if !expr.is_object() {
            return Err(not_an_object(ctx, expr.loc));
        }
        self.map.ensure_unused_capacity(expr.property_count())?;
        expr.try_for_each_property(|k, key_loc, value_expr| {
            if k.is_empty() {
                ctx.log.add_warning_fmt(
                    Some(ctx.source),
                    key_loc,
                    format_args!("{}", ctx.field.missing_name_message()),
                );
                return Ok(());
            }
            if is_comment_key(k) {
                return Ok(());
            }
            let value_loc =
                crate::bun_json::value_loc_of_property(&ctx.source.contents, key_loc, &value_expr);
            let Some(value) = value_expr.as_utf8_string_literal() else {
                ctx.log.add_warning_fmt(
                    Some(ctx.source),
                    value_loc,
                    format_args!("Invalid resolution value for \"{}\"", bstr::BStr::new(k)),
                );
                return Ok(());
            };
            self.parse_string_rule(ctx, k, key_loc, value, value_loc)
        })
    }

    fn parse_string_rule(
        &mut self,
        ctx: &mut ParseContext<'_, '_>,
        key: &[u8],
        key_loc: bun_ast::Loc,
        value: &[u8],
        value_loc: bun_ast::Loc,
    ) -> Result<(), Error> {
        let Selector { parent, target } = match parse_selector(key) {
            Ok(selector) => selector,
            Err(err) => {
                warn_selector_error(ctx, key, key_loc, err);
                return Ok(());
            }
        };
        let parent = match parent {
            None => None,
            Some(selector) => match parse_parent(ctx, key_loc, &selector) {
                Some(parent) => Some(parent),
                None => return Ok(()),
            },
        };
        self.put_rule(ctx, parent.as_ref(), &target, key_loc, value, value_loc)
    }

    fn put_rule(
        &mut self,
        ctx: &mut ParseContext<'_, '_>,
        parent: Option<&Dependency>,
        target: &PackageSelector<'_>,
        key_loc: bun_ast::Loc,
        value: &[u8],
        value_loc: bun_ast::Loc,
    ) -> Result<(), Error> {
        if value.starts_with(b"patch:") {
            // TODO(dylan-conway): apply .patch files to packages
            ctx.log.add_warning_fmt(
                Some(ctx.source),
                key_loc,
                format_args!(
                    "Bun currently does not support patched package \"{}\"",
                    ctx.field.json_name()
                ),
            );
            return Ok(());
        }

        let is_flat = parent.is_none() && target.range.is_empty();
        let Some(dep) = parse_override_value(ctx, value_loc, target.name, value, is_flat)? else {
            return Ok(());
        };
        let Some(target_range) = parse_range(ctx, key_loc, dep.name, dep.name_hash, target.range)
        else {
            return Ok(());
        };
        if parent.is_none() && target_range.tag != VersionTag::Npm {
            self.map.put_assume_capacity(dep.name_hash, dep);
        } else {
            self.push_scoped(
                ScopedOverride {
                    parent: parent.cloned(),
                    target_range,
                    dep,
                },
                ctx.builder.string_bytes.as_slice(),
            );
        }
        Ok(())
    }
}

fn lockfile_range(
    name: SemverString,
    name_hash: PackageNameHash,
    range: &[u8],
    buf: &mut bun_semver::string::Buf<'_>,
    log: &mut bun_ast::Log,
) -> Result<Option<dependency::Version>, Error> {
    if range.is_empty() {
        return Ok(Some(dependency::Version::default()));
    }
    let range = buf.append(range)?;
    let sliced = range.sliced(buf.bytes.as_slice());
    Ok(
        match dependency::parse(
            name,
            name_hash,
            sliced.slice,
            &sliced,
            log,
            None::<&mut PackageManager>,
        ) {
            Some(version) if version.tag == VersionTag::Npm => Some(version),
            _ => None,
        },
    )
}

/// Re-parses like `Dependency::clone_in` so a prerelease comparator does not keep pointing into the old buffer.
fn clone_range(
    dep: &Dependency,
    range: &dependency::Version,
    old_string_bytes: &[u8],
    new_builder: &mut StringBuilder,
) -> dependency::Version {
    let literal = new_builder.append::<SemverString>(range.literal.slice(old_string_bytes));
    let sliced = literal.sliced(new_builder.string_bytes.as_slice());
    dependency::parse_with_tag(
        dep.name,
        Some(dep.name_hash),
        sliced.slice,
        VersionTag::Npm,
        &sliced,
        None,
        None,
    )
    .unwrap_or_default()
}

/// A non-object `"overrides"` / `"resolutions"` field is a typo that would otherwise install with no rules applied, so it fails the install.
#[cold]
fn not_an_object(ctx: &mut ParseContext<'_, '_>, loc: bun_ast::Loc) -> Error {
    let name = ctx.field.json_name();
    ctx.log.add_error_fmt(
        ctx.source,
        value_loc_of(ctx.source, loc),
        format_args!(
            "\"{name}\" expects a map of package names to versions, e.g.\n  \"{name}\": {{\n    \"react\": \"18.2.0\"\n  }}"
        ),
    );
    Error::InvalidPackageJSON
}

fn warn_selector_error(
    ctx: &mut ParseContext<'_, '_>,
    key: &[u8],
    key_loc: bun_ast::Loc,
    err: SelectorError,
) {
    let source = Some(ctx.source);
    match err {
        SelectorError::EmptyName => ctx.log.add_warning_fmt(
            source,
            key_loc,
            format_args!("{}", ctx.field.missing_name_message()),
        ),
        SelectorError::InvalidName => ctx.log.add_warning_fmt(
            source,
            key_loc,
            format_args!("Invalid package name \"{}\"", bstr::BStr::new(key)),
        ),
        SelectorError::TooDeep => ctx.log.add_warning_fmt(
            source,
            key_loc,
            format_args!(
                "Bun currently only supports one level of nested \"{}\"",
                ctx.field.json_name()
            ),
        ),
        SelectorError::EmptyRange => ctx.log.add_warning_fmt(
            source,
            key_loc,
            format_args!("Missing version range after \"{}\"", bstr::BStr::new(key)),
        ),
    }
}

fn parse_parent(
    ctx: &mut ParseContext<'_, '_>,
    key_loc: bun_ast::Loc,
    selector: &PackageSelector<'_>,
) -> Option<Dependency> {
    let name_hash = SemverBuilder::string_hash(selector.name);
    let name = ctx.builder.append::<SemverString>(selector.name);
    let version = parse_range(ctx, key_loc, name, name_hash, selector.range)?;
    Some(Dependency {
        name,
        name_hash,
        version,
        behavior: Behavior::default(),
    })
}

fn parse_range(
    ctx: &mut ParseContext<'_, '_>,
    key_loc: bun_ast::Loc,
    name: SemverString,
    name_hash: PackageNameHash,
    range: &[u8],
) -> Option<dependency::Version> {
    if range.is_empty() {
        return Some(dependency::Version::default());
    }
    let appended = ctx.builder.append::<SemverString>(range);
    let sliced = appended.sliced(ctx.builder.string_bytes.as_slice());
    match dependency::parse(
        name,
        name_hash,
        sliced.slice,
        &sliced,
        &mut *ctx.log,
        None::<&mut PackageManager>,
    ) {
        Some(version) if version.tag == VersionTag::Npm => Some(version),
        _ => {
            ctx.log.add_warning_fmt(
                Some(ctx.source),
                key_loc,
                format_args!(
                    "Invalid version range \"{}\" for \"{}\"",
                    bstr::BStr::new(range),
                    bstr::BStr::new(name.slice(ctx.builder.string_bytes.as_slice()))
                ),
            );
            None
        }
    }
}

/// The rule is always stored under `key`; a `$ref` value only supplies the version spec (npm/pnpm semantics).
fn parse_override_value(
    ctx: &mut ParseContext<'_, '_>,
    loc: bun_ast::Loc,
    key: &[u8],
    value: &[u8],
    register_aliases: bool,
) -> Result<Option<Dependency>, Error> {
    let field = ctx.field.label();
    if value.is_empty() {
        ctx.log.add_warning_fmt(
            Some(ctx.source),
            loc,
            format_args!("Missing {} value", field),
        );
        return Ok(None);
    }
    if value == b"-" {
        ctx.log.add_warning_fmt(
            Some(ctx.source),
            loc,
            format_args!(
                "Removing \"{}\" with \"-\" is not supported",
                bstr::BStr::new(key)
            ),
        );
        return Ok(None);
    }

    let name_hash = SemverBuilder::string_hash(key);
    let name = ctx.builder.append::<SemverString>(key);

    // https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    let literal: SemverString = if value[0] == b'$' {
        let ref_name = &value[1..];
        let ref_name_str = SemverString::init(ref_name, ref_name);
        // The spec the root declares for `ref_name`, as written: a range `Package::parse` linked
        // to a workspace is still that range here (and in bun.lock), and the root's `workspaces`
        // entries are not declarations.
        let root_ref = ctx
            .root_package
            .dependencies
            .get(ctx.lockfile_dependencies)
            .iter()
            .find(|dep| {
                !dep.behavior.is_workspace()
                    && dep
                        .name
                        .eql(ref_name_str, ctx.builder.string_bytes.as_slice(), ref_name)
            })
            .map(|dep| dep.version.literal);

        match root_ref {
            Some(root_ref) => root_ref,
            None => match workspace_ref_literal(
                ctx.pm,
                ctx.log,
                ctx.source,
                ctx.workspace_names,
                ref_name,
            ) {
                Ok(Some(literal)) => ctx.builder.append::<SemverString>(&literal),
                Ok(None) => {
                    ctx.log.add_warning_fmt(
                        Some(ctx.source),
                        loc,
                        format_args!(
                            "Could not resolve \"{}\": \"{}\" is not in dependencies",
                            bstr::BStr::new(value),
                            bstr::BStr::new(ref_name),
                        ),
                    );
                    return Ok(None);
                }
                Err(Ambiguous) => {
                    ctx.log.add_warning_fmt(
                        Some(ctx.source),
                        loc,
                        format_args!(
                            "Could not resolve \"{}\": workspaces declare different versions of \"{}\"",
                            bstr::BStr::new(value),
                            bstr::BStr::new(ref_name),
                        ),
                    );
                    return Ok(None);
                }
            },
        }
    } else {
        ctx.builder.append::<SemverString>(value)
    };

    let sliced = literal.sliced(ctx.builder.string_bytes.as_slice());
    let alias_registry: Option<&mut PackageManager> = if register_aliases {
        Some(&mut *ctx.pm)
    } else {
        None
    };
    let Some(version) = Dependency::parse(
        name,
        name_hash,
        sliced.slice,
        &sliced,
        &mut *ctx.log,
        alias_registry,
    ) else {
        ctx.log.add_warning_fmt(
            Some(ctx.source),
            loc,
            format_args!("Invalid {} value \"{}\"", field, bstr::BStr::new(value)),
        );
        return Ok(None);
    };

    Ok(Some(Dependency {
        name,
        name_hash,
        version,
        behavior: Behavior::default(),
    }))
}

/// First string-valued entry for `name` across the four dependency sections of a package.json object.
fn declared_dependency(root: &Expr, name: &[u8]) -> Option<Expr> {
    DependencyGroup::FOUR.iter().find_map(|group| {
        root.get(group.prop)
            .and_then(|deps| deps.get(name))
            .filter(|value| value.as_utf8_string_literal().is_some())
    })
}

fn count_ref_value(
    pm: &mut PackageManager,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    workspace_names: &WorkspaceMap,
    root_json: &Expr,
    value: &[u8],
    builder: &mut StringBuilder,
) {
    let Some(ref_name) = value.strip_prefix(b"$") else {
        return;
    };
    if let Some(declared) = declared_dependency(root_json, ref_name) {
        if let Some(literal) = declared.as_utf8_string_literal() {
            builder.count(literal);
        }
        return;
    }
    if let Ok(Some(literal)) = workspace_ref_literal(pm, log, source, workspace_names, ref_name) {
        builder.count(&literal);
    }
}

fn workspace_ref_literal(
    pm: &mut PackageManager,
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    workspace_names: &WorkspaceMap,
    ref_name: &[u8],
) -> Result<Option<Vec<u8>>, Ambiguous> {
    if workspace_names.count() == 0 {
        return Ok(None);
    }
    let root_dir: &[u8] = source.path.name().dir;
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let mut found: Option<Vec<u8>> = None;
    for relative_dir in workspace_names.keys() {
        let Some(abs_package_json_path) =
            resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Auto>(
                root_dir,
                &mut path_buf.0,
                &[&relative_dir[..], b"package.json"],
            )
        else {
            continue;
        };
        let GetResult::Entry(entry) = pm.workspace_package_json_cache.get_with_path(
            log,
            abs_package_json_path,
            GetJSONOptions {
                init_reset_store: false,
                guess_indentation: true,
                ..Default::default()
            },
        ) else {
            continue;
        };
        let Some(declared) = declared_dependency(&entry.root, ref_name) else {
            continue;
        };
        let Some(literal) = declared.as_utf8_string_literal() else {
            continue;
        };
        match found.as_deref() {
            None => found = Some(literal.to_vec()),
            Some(first) if first == literal => {}
            Some(_) => return Err(Ambiguous),
        }
    }
    Ok(found)
}
