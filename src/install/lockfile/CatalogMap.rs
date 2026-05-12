use bun_collections::VecExt;
use core::cmp::Ordering;

use bun_alloc::AllocError;
use bun_collections::ArrayHashMap;
use bun_collections::array_hash_map::ArrayHashAdapter;
use bun_install::dependency::DependencyExt as _;
use bun_install::lockfile::{Buffers, StringBuilder};
use bun_install::{Dependency, Lockfile, PackageManager};
// PORT NOTE (layering): Zig `bun.ast.Expr` resolves to the full T4 parser AST,
// but every install-side caller (Package.rs / pnpm.rs) parses JSON/YAML into
// the lower-tier `bun_ast::js_ast` shape (re-exported via `crate::bun_json`).
// Importing `bun_js_parser` here forced a higher-tier dep and produced
// distinct-`Expr`-type errors at every call site, so use the T2 type directly.
use crate::bun_json::{E, Expr, ExprData};
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

/// Zig `String.arrayHashContext(lockfile, null)` — convenience constructor that
/// reads the lockfile's string buffer for both arg & existing sides. Lives here
/// (not on `bun_semver::String`) to avoid a `bun_semver → bun_install` back-edge.
#[inline]
fn ctx(buf: &[u8]) -> ArrayHashContext<'_> {
    ArrayHashContext {
        arg_buf: buf,
        existing_buf: buf,
    }
}

impl CatalogMap {
    pub fn has_any(&self) -> bool {
        self.default.count() > 0 || self.groups.count() > 0
    }

    pub fn get(
        &self,
        lockfile: &Lockfile,
        catalog_name: String,
        dep_name: String,
    ) -> Option<Dependency> {
        let buf = lockfile.buffers.string_bytes.as_slice();
        if catalog_name.is_empty() {
            if self.default.count() == 0 {
                return None;
            }
            return self.default.get_adapted(&dep_name, ctx(buf)).cloned();
        }

        let group = self.groups.get_adapted(&catalog_name, ctx(buf))?;

        if group.count() == 0 {
            return None;
        }

        group.get_adapted(&dep_name, ctx(buf)).cloned()
    }

    /// PORT NOTE: Zig took `lockfile: *Lockfile` but only reads its string
    /// buffer for the hash context. Narrow to `buf: &[u8]` so callers can hold
    /// `&mut lockfile.catalogs` while only borrowing `buffers.string_bytes`
    /// (disjoint field), instead of forcing a whole-`Lockfile` borrow that
    /// conflicts with the `&mut self` receiver.
    pub fn get_or_put_group(
        &mut self,
        buf: &[u8],
        catalog_name: String,
    ) -> Result<&mut Map, AllocError> {
        if catalog_name.is_empty() {
            return Ok(&mut self.default);
        }

        let entry = self.groups.get_or_put_adapted(catalog_name, ctx(buf))?;
        if !entry.found_existing {
            *entry.key_ptr = catalog_name;
            *entry.value_ptr = Map::default();
        }

        Ok(entry.value_ptr)
    }

    pub fn get_group(
        &mut self,
        map_buf: &[u8],
        catalog_name: String,
        catalog_name_buf: &[u8],
    ) -> Option<&mut Map> {
        if catalog_name.is_empty() {
            return Some(&mut self.default);
        }

        self.groups.get_ptr_adapted(
            &catalog_name,
            ArrayHashContext {
                arg_buf: catalog_name_buf,
                existing_buf: map_buf,
            },
        )
    }

    // PORT NOTE: Zig took `lockfile: *Lockfile` only for `.allocator` (dropped
    // per global-mimalloc rule). Removing it lets `lockfile.catalogs.parse_count`
    // call sites avoid the `&mut self` vs `&mut Lockfile` self-alias.
    pub fn parse_count(&mut self, expr: Expr, builder: &mut StringBuilder) {
        if let Some(default_catalog) = expr.get(b"catalog") {
            if let ExprData::EObject(obj) = &default_catalog.data {
                for item in obj.properties.slice() {
                    let key = item.key.as_ref().expect("infallible: prop has key");
                    builder.count(
                        key.as_utf8_string_literal()
                            .expect("infallible: is_string checked"),
                    );
                    if let ExprData::EString(version_str) = &item
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .data
                    {
                        builder.count(&version_str.data);
                    }
                }
            }
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            if let ExprData::EObject(catalog_names) = &catalogs.data {
                for catalog in catalog_names.properties.slice() {
                    let catalog_key = catalog.key.as_ref().unwrap();
                    builder.count(
                        catalog_key
                            .as_utf8_string_literal()
                            .expect("infallible: is_string checked"),
                    );
                    if let ExprData::EObject(obj) = &catalog.value.as_ref().unwrap().data {
                        for item in obj.properties.slice() {
                            let key = item.key.as_ref().expect("infallible: prop has key");
                            builder.count(
                                key.as_utf8_string_literal()
                                    .expect("infallible: is_string checked"),
                            );
                            if let ExprData::EString(version_str) = &item
                                .value
                                .as_ref()
                                .expect("infallible: prop has value")
                                .data
                            {
                                builder.count(&version_str.data);
                            }
                        }
                    }
                }
            }
        }
    }

    /// PORT NOTE: Zig threaded `lockfile: *Lockfile` for `.allocator` and
    /// `.buffers.string_bytes`. The allocator is dropped (global mimalloc) and
    /// `builder` already holds `&mut string_bytes`, so read the buffer through
    /// `builder` and drop the `lockfile` param — otherwise call sites would
    /// alias `&mut lockfile.catalogs` against `&mut lockfile`.
    pub fn parse_append(
        &mut self,
        pm: &mut PackageManager,
        log: &mut Log,
        source: &Source,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<bool, AllocError> {
        let mut found_any = false;
        if let Some(default_catalog) = expr.get(b"catalog") {
            let group = self.get_or_put_group(builder.string_bytes.as_slice(), String::EMPTY)?;
            found_any = true;
            if let ExprData::EObject(obj) = &default_catalog.data {
                for item in obj.properties.slice() {
                    let key = item.key.as_ref().expect("infallible: prop has key");
                    let value = item.value.as_ref().expect("infallible: prop has value");
                    let dep_name_str = key
                        .as_utf8_string_literal()
                        .expect("infallible: is_string checked");

                    let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                    let dep_name = builder.append_with_hash::<String>(dep_name_str, dep_name_hash);

                    if let ExprData::EString(version_str) = &value.data {
                        let version_literal = builder.append::<String>(&version_str.data);

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
                            log.add_error(Some(source), value.loc, b"Invalid dependency version");
                            continue;
                        };

                        let buf = builder.string_bytes.as_slice();
                        let entry = group.get_or_put_adapted(dep_name, ctx(buf))?;

                        if entry.found_existing {
                            log.add_error(Some(source), key.loc, b"Duplicate catalog");
                            continue;
                        }

                        *entry.key_ptr = dep_name;
                        *entry.value_ptr = Dependency {
                            name: dep_name,
                            name_hash: dep_name_hash,
                            version,
                            ..Dependency::default()
                        };
                    }
                }
            }
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            found_any = true;
            if let ExprData::EObject(catalog_names) = &catalogs.data {
                for catalog in catalog_names.properties.slice() {
                    let catalog_key = catalog.key.as_ref().unwrap();
                    let catalog_name_str = catalog_key
                        .as_utf8_string_literal()
                        .expect("infallible: is_string checked");
                    let catalog_name = builder.append::<String>(catalog_name_str);

                    let group =
                        self.get_or_put_group(builder.string_bytes.as_slice(), catalog_name)?;

                    if let ExprData::EObject(obj) = &catalog.value.as_ref().unwrap().data {
                        for item in obj.properties.slice() {
                            let key = item.key.as_ref().expect("infallible: prop has key");
                            let value = item.value.as_ref().expect("infallible: prop has value");
                            let dep_name_str = key
                                .as_utf8_string_literal()
                                .expect("infallible: is_string checked");
                            let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                            let dep_name =
                                builder.append_with_hash::<String>(dep_name_str, dep_name_hash);
                            if let ExprData::EString(version_str) = &value.data {
                                let version_literal = builder.append::<String>(&version_str.data);
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
                                        value.loc,
                                        b"Invalid dependency version",
                                    );
                                    continue;
                                };

                                let buf = builder.string_bytes.as_slice();
                                let entry = group.get_or_put_adapted(dep_name, ctx(buf))?;

                                if entry.found_existing {
                                    log.add_error(Some(source), key.loc, b"Duplicate catalog");
                                    continue;
                                }

                                *entry.key_ptr = dep_name;
                                *entry.value_ptr = Dependency {
                                    name: dep_name,
                                    name_hash: dep_name_hash,
                                    version,
                                    ..Dependency::default()
                                };
                            }
                        }
                    }
                }
            }
        }

        Ok(found_any)
    }

    // PORT NOTE: reshaped for borrowck — Zig threads `*Lockfile` through, but
    // the only field this body touches is `lockfile.catalogs`, and the call
    // site in `pnpm.rs` must simultaneously hold `&mut StringBuf` (which
    // already borrows `lockfile.buffers.string_bytes` + `lockfile.string_pool`).
    // Taking `&mut Lockfile` here would alias those borrows, so narrow to
    // `&mut CatalogMap` and let the caller split the disjoint fields.
    pub fn from_pnpm_lockfile(
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

    // PORT NOTE: Zig took `lockfile: *const Lockfile` but only reads its
    // string buffer. Narrow to `buffers: &Buffers` so the call site can hold
    // `&mut lockfile.catalogs` while only borrowing `lockfile.buffers`
    // immutably (disjoint fields), instead of forcing a whole-`Lockfile`
    // shared borrow that conflicts with the `&mut self` receiver.
    pub fn sort(&mut self, buffers: &Buffers) {
        let buf = buffers.string_bytes.as_slice();
        let dep_less_than = |_: &[String], deps: &[Dependency], l: usize, r: usize| -> bool {
            deps[l].name.order(&deps[r].name, buf, buf) == Ordering::Less
        };

        self.default.sort(dep_less_than);

        for catalog in self.groups.values_mut() {
            catalog.sort(dep_less_than);
        }

        self.groups
            .sort(|names: &[String], _: &[Map], l: usize, r: usize| -> bool {
                names[l].order(&names[r], buf, buf) == Ordering::Less
            });
    }

    // Zig `deinit(allocator)` deleted: `Map` and `ArrayHashMap<String, Map>` are owned
    // collections whose `Drop` recursively frees the nested maps.

    /// PORT NOTE: Zig took `*const Lockfile` but only ever read
    /// `lockfile.buffers.string_bytes` — accept the slice directly so callers
    /// can split-borrow the lockfile alongside a live `StringBuilder`.
    pub fn count(&self, string_bytes: &[u8], builder: &mut StringBuilder) {
        let buf = string_bytes;
        // PORT NOTE: `ArrayHashMap::iterator()` requires `&mut`; iterate the
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

    /// PORT NOTE: Zig also passed `*Lockfile new`, but `builder` already
    /// borrows `new.buffers.string_bytes` — read the new-side buffer through
    /// it instead so the call site doesn't alias `&mut new` twice.
    /// `pm` is generic over `NpmAliasRegistry` (was `&mut PackageManager`) so a
    /// caller already holding `&mut manager.lockfile` can pass
    /// `&mut manager.known_npm_aliases` instead of the whole manager.
    pub fn clone<PM: crate::dependency::NpmAliasRegistry>(
        &self,
        pm: &mut PM,
        old_buf: &[u8],
        builder: &mut StringBuilder,
    ) -> Result<CatalogMap, bun_core::Error> {
        let mut new_catalog = CatalogMap::default();

        new_catalog
            .default
            .ensure_total_capacity(self.default.count())?;

        // Zig re-reads `new.buffers.string_bytes.items` at every
        // `putAssumeCapacityContext` call. Mirror that here: per insert,
        // finish the `&mut builder` appends FIRST, then snapshot the buffer
        // for the hash/eql closures. Snapshotting once up-front would freeze
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

bun_core::named_error_set!(FromPnpmLockfileError);

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
        let entry = catalog_map.get_or_put_adapted(dep_name, ctx(buf))?;

        if entry.found_existing {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        }

        *entry.key_ptr = dep_name;
        *entry.value_ptr = dep;
    }
    Ok(())
}

// ported from: src/install/lockfile/CatalogMap.zig
