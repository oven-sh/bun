use bun_collections::VecExt;
use core::cmp::Ordering;

use bun_alloc::AllocError;
use bun_collections::ArrayHashMap;
use bun_collections::array_hash_map::ArrayHashAdapter;
use bun_install::dependency::DependencyExt as _;
use bun_install::dependency::{
    NpmInfo, Tag as DependencyVersionTag, Value as DependencyVersionValue,
    Version as DependencyVersion,
};
use bun_install::lockfile::{Buffers, StringBuilder};
use bun_install::{Behavior, Dependency, Lockfile, PackageManager};
use bun_semver::SlicedString;
use core::mem::ManuallyDrop;
// Layering: every install-side caller (Package.rs / pnpm.rs) parses JSON/YAML
// into the lower-tier `bun_ast::js_ast` shape (re-exported via
// `crate::bun_json`). Importing `bun_js_parser` here would force a higher-tier
// dep and produce distinct-`Expr`-type errors at every call site, so use the
// T2 type directly.
use crate::bun_json::{E, Expr, ExprData, value_loc_of_property};
use bstr::BStr;
use bun_ast::{Log, Source};
use bun_semver::String;
use bun_semver::string::{ArrayHashContext, Buf as StringBuf, Builder as StringBuilderNs};

// `Map` is keyed by `bun_semver::String` whose hash/eq depend on an external
// string buffer. The default `AutoContext` cannot satisfy `String: Hash`, so
// every lookup/insert goes through the `*_adapted` methods with an explicit
// `ArrayHashContext` carrying the `arg_buf`/`existing_buf` pair.
pub type Map = ArrayHashMap<String, Dependency>;

#[derive(Default)]
pub struct CatalogMap {
    pub default: Map,
    pub groups: ArrayHashMap<String, Map>,
}

/// Convenience constructor that reads the lockfile's string buffer for both
/// arg & existing sides. Lives here
/// (not on `bun_semver::String`) to avoid a `bun_semver → bun_install` back-edge.
#[inline]
fn ctx(buf: &[u8]) -> ArrayHashContext<'_> {
    ArrayHashContext {
        arg_buf: buf,
        existing_buf: buf,
    }
}

impl CatalogMap {
    pub(crate) fn has_any(&self) -> bool {
        self.default.count() > 0 || self.groups.count() > 0
    }

    /// `catalog:` and `catalog:default` name the same catalog.
    pub(crate) fn same_name(a: &[u8], b: &[u8]) -> bool {
        let is_default = |name: &[u8]| name.is_empty() || name == b"default";
        a == b || (is_default(a) && is_default(b))
    }

    /// `(None, i)` indexes `default`, `(Some(g), i)` indexes `groups`; the default catalog is looked up under both spellings, the one matching `catalog_name` first.
    fn locate(
        &self,
        string_buf: &[u8],
        catalog_name: &[u8],
        dep_name: &[u8],
    ) -> Option<(Option<usize>, usize)> {
        let has_default = self.default.count() > 0;
        let has_groups = self.groups.count() > 0;
        if !has_default && !has_groups {
            return None;
        }
        let dep_key = String::init(dep_name, dep_name);
        let dep_ctx = ArrayHashContext {
            arg_buf: dep_name,
            existing_buf: string_buf,
        };
        let dep_hash = dep_ctx.hash(dep_key);
        let probe = |map: &Map| {
            map.get_index_adapted_raw(dep_hash, |existing: &String, i| {
                dep_ctx.eql(dep_key, *existing, i)
            })
        };
        let in_default = || {
            if !has_default {
                return None;
            }
            probe(&self.default).map(|i| (None, i))
        };
        let in_group = |name: &[u8]| {
            if !has_groups {
                return None;
            }
            let ctx = ArrayHashContext {
                arg_buf: name,
                existing_buf: string_buf,
            };
            let g = self
                .groups
                .get_index_adapted(&String::init(name, name), &ctx)?;
            let i = probe(&self.groups.values()[g])?;
            Some((Some(g), i))
        };
        if catalog_name.is_empty() {
            return in_default().or_else(|| in_group(b"default"));
        }
        in_group(catalog_name).or_else(|| (catalog_name == b"default").then(in_default).flatten())
    }

    pub fn find<'a>(
        &'a self,
        string_buf: &[u8],
        catalog_name: &[u8],
        dep_name: &[u8],
    ) -> Option<&'a Dependency> {
        let (group, i) = self.locate(string_buf, catalog_name, dep_name)?;
        let map = match group {
            Some(g) => &self.groups.values()[g],
            None => &self.default,
        };
        Some(&map.values()[i])
    }

    pub(crate) fn get_ref<'a>(
        &'a self,
        string_buf: &[u8],
        catalog_name: String,
        dep_name: String,
    ) -> Option<&'a Dependency> {
        self.find(
            string_buf,
            catalog_name.slice(string_buf),
            dep_name.slice(string_buf),
        )
    }

    pub(crate) fn get(
        &self,
        lockfile: &Lockfile,
        catalog_name: String,
        dep_name: String,
    ) -> Option<Dependency> {
        self.get_ref(
            lockfile.buffers.string_bytes.as_slice(),
            catalog_name,
            dep_name,
        )
        .cloned()
    }

    // Falls back to the unresolved `catalog:` version when the entry is missing.
    pub(crate) fn resolve_range<'a>(
        &'a self,
        string_buf: &[u8],
        dep: &'a Dependency,
    ) -> &'a DependencyVersion {
        if dep.version.tag != DependencyVersionTag::Catalog {
            return &dep.version;
        }
        match self.get_ref(string_buf, *dep.version.catalog(), dep.name) {
            Some(entry) => &entry.version,
            None => &dep.version,
        }
    }

    /// Only the root and its workspaces may reference catalogs; elsewhere a `catalog:` dependency is left unresolvable and a `catalog:` peer becomes an optional `*` peer, binding to whatever the importer provides.
    pub(crate) fn strip_reference(dep: &mut Dependency) {
        if dep.version.tag != DependencyVersionTag::Catalog {
            return;
        }
        let literal = dep.version.literal;
        if !dep.behavior.is_peer() {
            dep.version = DependencyVersion {
                tag: DependencyVersionTag::Uninitialized,
                literal,
                value: DependencyVersionValue::default(),
            };
            return;
        }
        let star = bun_semver::query::parse(b"*", SlicedString::init(b"*", b"*"))
            .unwrap_or_else(|_| bun_core::out_of_memory());
        dep.behavior.insert(Behavior::OPTIONAL);
        dep.version = DependencyVersion {
            tag: DependencyVersionTag::Npm,
            literal,
            value: DependencyVersionValue {
                npm: ManuallyDrop::new(NpmInfo {
                    name: dep.name,
                    version: star,
                    is_alias: false,
                }),
            },
        };
    }

    /// Takes `buf: &[u8]` (the lockfile's string buffer, used for the hash
    /// context) rather than the whole `Lockfile` so callers can hold
    /// `&mut lockfile.catalogs` while only borrowing `buffers.string_bytes`
    /// (disjoint field), instead of forcing a whole-`Lockfile` borrow that
    /// conflicts with the `&mut self` receiver.
    pub(crate) fn get_or_put_group(
        &mut self,
        buf: &[u8],
        catalog_name: String,
    ) -> Result<&mut Map, AllocError> {
        if catalog_name.is_empty() {
            return Ok(&mut self.default);
        }

        let entry = self.groups.get_or_put_adapted(&catalog_name, &ctx(buf))?;
        if !entry.found_existing {
            *entry.key_ptr = catalog_name;
            *entry.value_ptr = Map::default();
        }

        Ok(entry.value_ptr)
    }

    // Deliberately takes no `Lockfile` param so `lockfile.catalogs.parse_count`
    // call sites avoid the `&mut self` vs `&mut Lockfile` self-alias.
    pub(crate) fn parse_count(&mut self, expr: Expr, builder: &mut StringBuilder) {
        if let Some(default_catalog) = expr.get(b"catalog") {
            Self::count_catalog_group(&default_catalog, builder);
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            catalogs.for_each_property(|catalog_name, _, catalog_value| {
                builder.count(catalog_name);
                Self::count_catalog_group(&catalog_value, builder);
            });
        }
    }

    fn count_catalog_group(group: &Expr, builder: &mut StringBuilder) {
        group.for_each_property(|dep_name, _, version| {
            builder.count(dep_name);
            if let Some(version_str) = version.as_utf8_string_literal() {
                builder.count(version_str);
            }
        });
    }

    /// `builder` already holds `&mut string_bytes`, so the string buffer is
    /// read through it rather than taking a `lockfile` param — otherwise call
    /// sites would alias `&mut lockfile.catalogs` against `&mut lockfile`.
    pub(crate) fn parse_append(
        &mut self,
        pm: &mut PackageManager,
        log: &mut Log,
        source: &Source,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> crate::Result<bool> {
        let mut found_any = false;
        if let Some(default_catalog) = expr.get(b"catalog") {
            let group = self.get_or_put_group(builder.string_bytes.as_slice(), String::EMPTY)?;
            found_any = true;
            Self::parse_append_group(group, pm, log, source, &default_catalog, builder)?;
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            found_any = true;
            catalogs.try_for_each_property(|catalog_name_str, _, catalog_value| {
                let catalog_name = builder.append::<String>(catalog_name_str);
                let group = self.get_or_put_group(builder.string_bytes.as_slice(), catalog_name)?;
                Self::parse_append_group(group, pm, log, source, &catalog_value, builder)
            })?;
        }

        // `self.default` is only fed by the singular `catalog` object; `catalogs.default` lands in `groups`.
        if self.default.count() > 0
            && let Some(default_group) = expr.get(b"catalogs").and_then(|c| c.get(b"default"))
        {
            let buf = builder.string_bytes.as_slice();
            let singular = &self.default;
            let mut conflict = false;
            default_group.for_each_property(|dep_name, key_loc, _| {
                let ctx = ArrayHashContext {
                    arg_buf: dep_name,
                    existing_buf: buf,
                };
                if singular
                    .get_index_adapted(&String::init(dep_name, dep_name), &ctx)
                    .is_some()
                {
                    log.add_error_fmt(
                        Some(source),
                        key_loc,
                        format_args!(
                            "\"{}\" is defined in both \"catalog\" and \"catalogs.default\"; keep one of them",
                            BStr::new(dep_name)
                        ),
                    );
                    conflict = true;
                }
            });
            if conflict {
                return Err(crate::Error::InstallFailed);
            }
        }

        Ok(found_any)
    }

    fn parse_append_group(
        group: &mut Map,
        pm: &mut PackageManager,
        log: &mut Log,
        source: &Source,
        catalog: &Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), AllocError> {
        catalog.try_for_each_property(|dep_name_str, key_loc, value| {
            let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
            let dep_name = builder.append::<String>(dep_name_str);

            let Some(version_str) = value.as_utf8_string_literal() else {
                return Ok(());
            };
            let version_literal = builder.append::<String>(version_str);
            let buf = builder.string_bytes.as_slice();
            let version_sliced = version_literal.sliced(buf);

            let Some(version) = Dependency::parse(
                dep_name,
                dep_name_hash,
                version_sliced.slice,
                &version_sliced,
                &mut *log,
                Some(&mut *pm),
            ) else {
                log.add_error(
                    Some(source),
                    value_loc_of_property(&source.contents, key_loc, &value),
                    b"Invalid dependency version",
                );
                return Ok(());
            };

            let buf = builder.string_bytes.as_slice();
            let entry = group.get_or_put_adapted(&dep_name, &ctx(buf))?;

            if entry.found_existing {
                log.add_error(Some(source), key_loc, b"Duplicate catalog");
                return Ok(());
            }

            *entry.key_ptr = dep_name;
            *entry.value_ptr = Dependency {
                name: dep_name,
                name_hash: dep_name_hash,
                version,
                ..Dependency::default()
            };
            Ok(())
        })
    }

    // The only lockfile field this body touches is `lockfile.catalogs`, and
    // the call site in `pnpm.rs` must simultaneously hold `&mut StringBuf`
    // (which already borrows `lockfile.buffers.string_bytes` +
    // `lockfile.string_pool`). Taking `&mut Lockfile` here would alias those
    // borrows, so narrow to `&mut CatalogMap` and let the caller split the
    // disjoint fields.
    pub(crate) fn from_pnpm_lockfile(
        catalogs: &mut CatalogMap,
        log: &mut Log,
        catalogs_obj: &mut E::Object,
        string_buf: &mut StringBuf,
    ) -> Result<(), FromPnpmLockfileError> {
        for prop in catalogs_obj.properties.slice() {
            let key = prop.key.as_ref().expect("infallible: prop has key");
            let value = prop.value.as_ref().expect("infallible: prop has value");
            let Some(group_name_str) = key.as_utf8_string_literal() else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };

            let ExprData::EObject(entries_obj) = &value.data else {
                continue;
            };

            if group_name_str == b"default" {
                put_entries_from_pnpm_lockfile(
                    &mut catalogs.default,
                    log,
                    entries_obj,
                    string_buf,
                )?;
            } else {
                let group_name = string_buf.append(group_name_str)?;
                let group = catalogs.get_or_put_group(string_buf.bytes.as_slice(), group_name)?;
                put_entries_from_pnpm_lockfile(group, log, entries_obj, string_buf)?;
            }
        }
        Ok(())
    }

    // Takes `buffers: &Buffers` rather than the whole `Lockfile` so the call
    // site can hold `&mut lockfile.catalogs` while only borrowing
    // `lockfile.buffers` immutably (disjoint fields), instead of forcing a
    // whole-`Lockfile` shared borrow that conflicts with the `&mut self`
    // receiver.
    pub(crate) fn sort(&mut self, buffers: &Buffers) {
        let buf = buffers.string_bytes.as_slice();
        let dep_less_than = |_: &[String], deps: &[Dependency], l: usize, r: usize| -> bool {
            deps[l].name.order(deps[r].name, buf, buf) == Ordering::Less
        };

        self.default.sort(dep_less_than);

        for catalog in self.groups.values_mut() {
            catalog.sort(dep_less_than);
        }

        self.groups
            .sort(|names: &[String], _: &[Map], l: usize, r: usize| -> bool {
                names[l].order(names[r], buf, buf) == Ordering::Less
            });
    }

    // No explicit `deinit`: `Map` and `ArrayHashMap<String, Map>` are owned
    // collections whose `Drop` recursively frees the nested maps.

    /// Accepts `lockfile.buffers.string_bytes` directly (rather than the whole
    /// `Lockfile`) so callers can split-borrow the lockfile alongside a live
    /// `StringBuilder`.
    pub(crate) fn count(&self, string_bytes: &[u8], builder: &mut StringBuilder) {
        let buf = string_bytes;
        // `ArrayHashMap::iterator()` requires `&mut`; iterate the
        // `keys()`/`values()` slices instead so `count` can stay `&self`.
        for (dep_name, dep) in self.default.keys().iter().zip(self.default.values()) {
            builder.count(dep_name.slice(buf));
            dep.count(buf, builder);
        }

        for (catalog_name, deps) in self.groups.keys().iter().zip(self.groups.values()) {
            builder.count(catalog_name.slice(buf));

            for (dep_name, dep) in deps.keys().iter().zip(deps.values()) {
                builder.count(dep_name.slice(buf));
                dep.count(buf, builder);
            }
        }
    }

    /// `builder` already borrows the new lockfile's `buffers.string_bytes`, so
    /// the new-side buffer is read through it instead of taking a separate
    /// `new: &mut Lockfile` param that would alias `&mut new` twice.
    /// `pm` is generic over `NpmAliasRegistry` (was `&mut PackageManager`) so a
    /// caller already holding `&mut manager.lockfile` can pass
    /// `&mut manager.known_npm_aliases` instead of the whole manager.
    pub(crate) fn clone<PM: crate::dependency::NpmAliasRegistry>(
        &self,
        pm: &mut PM,
        old_buf: &[u8],
        builder: &mut StringBuilder,
    ) -> Result<CatalogMap, crate::Error> {
        let mut new_catalog = CatalogMap::default();

        new_catalog
            .default
            .ensure_total_capacity(self.default.count())?;

        // Per insert, finish the `&mut builder` appends FIRST, then snapshot
        // the buffer for the hash/eql closures. Snapshotting once up-front would freeze
        // the slice length pre-append and OOB-panic on any non-inline key.
        for (dep_name, dep) in self.default.keys().iter().zip(self.default.values()) {
            let new_key = builder.append::<String>(dep_name.slice(old_buf));
            let new_val = dep.clone_in(pm, old_buf, builder)?;
            let buf = builder.string_bytes.as_slice();
            new_catalog.default.put_assume_capacity_context(
                new_key,
                new_val,
                |k| ArrayHashAdapter::hash(&ctx(buf), k),
                |a, b, i| ArrayHashAdapter::eql(&ctx(buf), a, b, i),
            );
        }

        new_catalog
            .groups
            .ensure_total_capacity(self.groups.count())?;

        for (catalog_name, deps) in self.groups.keys().iter().zip(self.groups.values()) {
            let mut new_group = Map::default();
            new_group.ensure_total_capacity(deps.count())?;

            for (dep_name, dep) in deps.keys().iter().zip(deps.values()) {
                let new_key = builder.append::<String>(dep_name.slice(old_buf));
                let new_val = dep.clone_in(pm, old_buf, builder)?;
                let buf = builder.string_bytes.as_slice();
                new_group.put_assume_capacity_context(
                    new_key,
                    new_val,
                    |k| ArrayHashAdapter::hash(&ctx(buf), k),
                    |a, b, i| ArrayHashAdapter::eql(&ctx(buf), a, b, i),
                );
            }

            let new_name = builder.append::<String>(catalog_name.slice(old_buf));
            let buf = builder.string_bytes.as_slice();
            new_catalog.groups.put_assume_capacity_context(
                new_name,
                new_group,
                |k| ArrayHashAdapter::hash(&ctx(buf), k),
                |a, b, i| ArrayHashAdapter::eql(&ctx(buf), a, b, i),
            );
        }

        Ok(new_catalog)
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromPnpmLockfileError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidPnpmLockfile")]
    InvalidPnpmLockfile,
}

bun_core::oom_from_alloc!(FromPnpmLockfileError);

fn put_entries_from_pnpm_lockfile(
    catalog_map: &mut Map,
    log: &mut Log,
    entries_obj: &E::Object,
    string_buf: &mut StringBuf,
) -> Result<(), FromPnpmLockfileError> {
    for entry_prop in entries_obj.properties.slice() {
        let key = entry_prop.key.as_ref().unwrap();
        let value = entry_prop.value.as_ref().unwrap();
        let Some(dep_name_str) = key.as_utf8_string_literal() else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };
        let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
        let dep_name = string_buf.append_with_hash(dep_name_str, dep_name_hash)?;

        let Some(specifier) = value.get(b"specifier") else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };
        let Some(version_str) = specifier.as_utf8_string_literal() else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };
        let version_hash = StringBuilderNs::string_hash(version_str);
        let version = string_buf.append_with_hash(version_str, version_hash)?;
        let version_sliced = version.sliced(string_buf.bytes.as_slice());

        let Some(parsed_version) = Dependency::parse(
            dep_name,
            dep_name_hash,
            version_sliced.slice,
            &version_sliced,
            Some(&mut *log),
            None,
        ) else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };

        let dep = Dependency {
            name: dep_name,
            name_hash: dep_name_hash,
            version: parsed_version,
            ..Dependency::default()
        };

        let buf = string_buf.bytes.as_slice();
        let entry = catalog_map.get_or_put_adapted(&dep_name, &ctx(buf))?;

        if entry.found_existing {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        }

        *entry.key_ptr = dep_name;
        *entry.value_ptr = dep;
    }
    Ok(())
}
