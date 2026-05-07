use core::cmp::Ordering;

use bun_alloc::AllocError;
use bun_collections::ArrayHashMap;
use bun_collections::array_hash_map::ArrayHashAdapter;
use bun_install::{Dependency, Lockfile, PackageManager};
use bun_install::lockfile::StringBuilder;
use bun_js_parser::{E, Expr, ExprData};
use bun_logger::{Log, Source};
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
    ArrayHashContext { arg_buf: buf, existing_buf: buf }
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

    pub fn get_or_put_group(
        &mut self,
        lockfile: &Lockfile,
        catalog_name: String,
    ) -> Result<&mut Map, AllocError> {
        if catalog_name.is_empty() {
            return Ok(&mut self.default);
        }

        let buf = lockfile.buffers.string_bytes.as_slice();
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
            ArrayHashContext { arg_buf: catalog_name_buf, existing_buf: map_buf },
        )
    }

    pub fn parse_count(
        &mut self,
        _lockfile: &mut Lockfile,
        expr: Expr,
        builder: &mut StringBuilder,
    ) {
        if let Some(default_catalog) = expr.get(b"catalog") {
            if let ExprData::EObject(obj) = &default_catalog.data {
                for item in obj.properties.slice() {
                    let key = item.key.as_ref().unwrap();
                    builder.count(key.as_utf8_string_literal().unwrap());
                    if let ExprData::EString(version_str) = &item.value.as_ref().unwrap().data {
                        builder.count(version_str.data);
                    }
                }
            }
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            if let ExprData::EObject(catalog_names) = &catalogs.data {
                for catalog in catalog_names.properties.slice() {
                    let catalog_key = catalog.key.as_ref().unwrap();
                    builder.count(catalog_key.as_utf8_string_literal().unwrap());
                    if let ExprData::EObject(obj) = &catalog.value.as_ref().unwrap().data {
                        for item in obj.properties.slice() {
                            let key = item.key.as_ref().unwrap();
                            builder.count(key.as_utf8_string_literal().unwrap());
                            if let ExprData::EString(version_str) =
                                &item.value.as_ref().unwrap().data
                            {
                                builder.count(version_str.data);
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn parse_append(
        &mut self,
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        log: &mut Log,
        source: &Source,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<bool, AllocError> {
        let mut found_any = false;
        if let Some(default_catalog) = expr.get(b"catalog") {
            let group = self.get_or_put_group(lockfile, String::EMPTY)?;
            found_any = true;
            if let ExprData::EObject(obj) = &default_catalog.data {
                for item in obj.properties.slice() {
                    let key = item.key.as_ref().unwrap();
                    let value = item.value.as_ref().unwrap();
                    let dep_name_str = key.as_utf8_string_literal().unwrap();

                    let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                    let dep_name = builder.append_with_hash::<String>(dep_name_str, dep_name_hash);

                    if let ExprData::EString(version_str) = &value.data {
                        let version_literal = builder.append::<String>(version_str.data);

                        let buf = lockfile.buffers.string_bytes.as_slice();
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
                            )?;
                            continue;
                        };

                        let buf = lockfile.buffers.string_bytes.as_slice();
                        let entry = group.get_or_put_adapted(dep_name, ctx(buf))?;

                        if entry.found_existing {
                            log.add_error(Some(source), key.loc, b"Duplicate catalog")?;
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
                    let catalog_name_str = catalog_key.as_utf8_string_literal().unwrap();
                    let catalog_name = builder.append::<String>(catalog_name_str);

                    let group = self.get_or_put_group(lockfile, catalog_name)?;

                    if let ExprData::EObject(obj) = &catalog.value.as_ref().unwrap().data {
                        for item in obj.properties.slice() {
                            let key = item.key.as_ref().unwrap();
                            let value = item.value.as_ref().unwrap();
                            let dep_name_str = key.as_utf8_string_literal().unwrap();
                            let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                            let dep_name =
                                builder.append_with_hash::<String>(dep_name_str, dep_name_hash);
                            if let ExprData::EString(version_str) = &value.data {
                                let version_literal =
                                    builder.append::<String>(version_str.data);
                                let buf = lockfile.buffers.string_bytes.as_slice();
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
                                    )?;
                                    continue;
                                };

                                let buf = lockfile.buffers.string_bytes.as_slice();
                                let entry = group.get_or_put_adapted(dep_name, ctx(buf))?;

                                if entry.found_existing {
                                    log.add_error(
                                        Some(source),
                                        key.loc,
                                        b"Duplicate catalog",
                                    )?;
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

    pub fn from_pnpm_lockfile(
        lockfile: &mut Lockfile,
        log: &mut Log,
        catalogs_obj: &mut E::Object,
        string_buf: &mut StringBuf,
    ) -> Result<(), FromPnpmLockfileError> {
        for prop in catalogs_obj.properties.slice() {
            let Some(group_name_str) = prop.key.unwrap().as_utf8_string_literal() else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };

            if !prop.value.unwrap().is_object() {
                continue;
            }

            let ExprData::EObject(entries_obj) = &prop.value.unwrap().data else {
                unreachable!()
            };

            // PORT NOTE: reshaped for borrowck — the Zig version threads
            // `*Lockfile` through; here `string_buf` already borrows the
            // lockfile's `string_bytes`/`string_pool`, so we resolve the
            // group up front and pass only what's disjoint.
            if group_name_str == b"default" {
                put_entries_from_pnpm_lockfile(
                    &mut lockfile.catalogs.default,
                    log,
                    entries_obj,
                    string_buf,
                )?;
            } else {
                let group_name = string_buf.append(group_name_str)?;
                let group = {
                    let buf = string_buf.bytes.as_slice();
                    let entry = lockfile
                        .catalogs
                        .groups
                        .get_or_put_adapted(group_name, ctx(buf))?;
                    if !entry.found_existing {
                        *entry.key_ptr = group_name;
                        *entry.value_ptr = Map::default();
                    }
                    entry.value_ptr
                };
                put_entries_from_pnpm_lockfile(group, log, entries_obj, string_buf)?;
            }
        }
        Ok(())
    }

    pub fn sort(&mut self, lockfile: &Lockfile) {
        let buf = lockfile.buffers.string_bytes.as_slice();

        let dep_less_than = |_: &[String], deps: &[Dependency], l: usize, r: usize| -> bool {
            deps[l].name.order(&deps[r].name, buf, buf) == Ordering::Less
        };

        self.default.sort(dep_less_than);

        let mut iter = self.groups.iterator();
        while let Some(catalog) = iter.next() {
            catalog.value_ptr.sort(dep_less_than);
        }

        self.groups.sort(|names: &[String], _: &[Map], l: usize, r: usize| -> bool {
            names[l].order(&names[r], buf, buf) == Ordering::Less
        });
    }

    // Zig `deinit(allocator)` deleted: `Map` and `ArrayHashMap<String, Map>` are owned
    // collections whose `Drop` recursively frees the nested maps.

    pub fn count(&mut self, lockfile: &mut Lockfile, builder: &mut StringBuilder) {
        let buf = lockfile.buffers.string_bytes.as_slice();
        let mut deps_iter = self.default.iterator();
        while let Some(entry) = deps_iter.next() {
            builder.count(entry.key_ptr.slice(buf));
            entry.value_ptr.count(buf, builder);
        }

        let mut groups_iter = self.groups.iterator();
        while let Some(catalog) = groups_iter.next() {
            builder.count(catalog.key_ptr.slice(buf));

            let mut deps_iter = catalog.value_ptr.iterator();
            while let Some(entry) = deps_iter.next() {
                builder.count(entry.key_ptr.slice(buf));
                entry.value_ptr.count(buf, builder);
            }
        }
    }

    pub fn clone(
        &mut self,
        pm: &mut PackageManager,
        old: &mut Lockfile,
        new: &mut Lockfile,
        builder: &mut StringBuilder,
    ) -> Result<CatalogMap, bun_core::Error> {
        let mut new_catalog = CatalogMap::default();

        new_catalog.default.ensure_total_capacity(self.default.count())?;

        let old_buf = old.buffers.string_bytes.as_slice();
        let new_buf = new.buffers.string_bytes.as_slice();
        let new_ctx = ctx(new_buf);

        let mut deps_iter = self.default.iterator();
        while let Some(entry) = deps_iter.next() {
            new_catalog.default.put_assume_capacity_context(
                builder.append::<String>(entry.key_ptr.slice(old_buf)),
                entry.value_ptr.clone_in(pm, old_buf, builder)?,
                |k| new_ctx.hash(k),
                |a, b, i| new_ctx.eql(a, b, i),
            );
        }

        new_catalog.groups.ensure_total_capacity(self.groups.count())?;

        let mut groups_iter = self.groups.iterator();
        while let Some(group) = groups_iter.next() {
            let catalog_name = group.key_ptr;
            let deps = group.value_ptr;

            let mut new_group = Map::default();
            new_group.ensure_total_capacity(deps.count())?;

            let mut deps_iter = deps.iterator();
            while let Some(entry) = deps_iter.next() {
                new_group.put_assume_capacity_context(
                    builder.append::<String>(entry.key_ptr.slice(old_buf)),
                    entry.value_ptr.clone_in(pm, old_buf, builder)?,
                    |k| new_ctx.hash(k),
                    |a, b, i| new_ctx.eql(a, b, i),
                );
            }

            new_catalog.groups.put_assume_capacity_context(
                builder.append::<String>(catalog_name.slice(old_buf)),
                new_group,
                |k| new_ctx.hash(k),
                |a, b, i| new_ctx.eql(a, b, i),
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

impl From<AllocError> for FromPnpmLockfileError {
    fn from(_: AllocError) -> Self {
        FromPnpmLockfileError::OutOfMemory
    }
}

impl From<FromPnpmLockfileError> for bun_core::Error {
    fn from(e: FromPnpmLockfileError) -> Self {
        match e {
            FromPnpmLockfileError::OutOfMemory => bun_core::err!(OutOfMemory),
            FromPnpmLockfileError::InvalidPnpmLockfile => bun_core::err!(InvalidPnpmLockfile),
        }
    }
}

fn put_entries_from_pnpm_lockfile(
    catalog_map: &mut Map,
    log: &mut Log,
    entries_obj: &E::Object,
    string_buf: &mut StringBuf,
) -> Result<(), FromPnpmLockfileError> {
    for entry_prop in entries_obj.properties.slice() {
        let Some(dep_name_str) = entry_prop.key.unwrap().as_utf8_string_literal() else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };
        let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
        let dep_name = string_buf.append_with_hash(dep_name_str, dep_name_hash)?;

        let Some(specifier) = entry_prop.value.unwrap().get(b"specifier") else {
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
            Some(log),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/CatalogMap.zig (471 lines)
//   confidence: high
//   notes:      ArrayHashMap *_context calls routed via *_adapted (ArrayHashAdapter
//               impl added on bun_semver::string::ArrayHashContext); allocator
//               params dropped per global-mimalloc rule; from_pnpm_lockfile
//               reshaped to thread the catalog map directly so `string_buf`
//               (which already borrows the lockfile's string buffer) supplies
//               the hash-context bytes.
// ──────────────────────────────────────────────────────────────────────────
