use core::cmp::Ordering;

use bun_alloc::AllocError;
use bun_collections::ArrayHashMap;
use bun_install::{Dependency, Lockfile, PackageManager};
use bun_install::lockfile::StringBuilder;
use bun_js_parser::{Expr, ExprData, E};
use bun_logger::{Log, Source};
use bun_semver::String;
use bun_semver::string::{ArrayHashContext, Buf as StringBuf, Builder as StringBuilderNs};
use bun_str::strings;

// TODO(port): `Map` uses a context-based ArrayHashMap keyed by `bun_semver::String`
// where hash/eq are computed against an external string buffer (`String.ArrayHashContext`).
// `bun_collections::ArrayHashMap` must expose `*_context` method variants.
pub type Map = ArrayHashMap<String, Dependency>;

#[derive(Default)]
pub struct CatalogMap {
    pub default: Map,
    pub groups: ArrayHashMap<String, Map>,
}

impl CatalogMap {
    pub fn has_any(&self) -> bool {
        self.default.count() > 0 || self.groups.count() > 0
    }

    pub fn get(
        &mut self,
        lockfile: &Lockfile,
        catalog_name: String,
        dep_name: String,
    ) -> Option<Dependency> {
        if catalog_name.is_empty() {
            if self.default.count() == 0 {
                return None;
            }
            return match self
                .default
                .get_context(dep_name, String::array_hash_context(lockfile, None))
            {
                Some(d) => Some(d),
                None => None,
            };
        }

        let Some(group) = self
            .groups
            .get_context(catalog_name, String::array_hash_context(lockfile, None))
        else {
            return None;
        };

        if group.count() == 0 {
            return None;
        }

        match group.get_context(dep_name, String::array_hash_context(lockfile, None)) {
            Some(d) => Some(d),
            None => None,
        }
    }

    pub fn get_or_put_group(
        &mut self,
        lockfile: &mut Lockfile,
        catalog_name: String,
    ) -> Result<&mut Map, AllocError> {
        if catalog_name.is_empty() {
            return Ok(&mut self.default);
        }

        let entry = self.groups.get_or_put_context(
            catalog_name,
            String::array_hash_context(lockfile, None),
        )?;
        if !entry.found_existing {
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

        self.groups.get_ptr_context(
            catalog_name,
            ArrayHashContext {
                arg_buf: catalog_name_buf,
                existing_buf: map_buf,
            },
        )
    }

    pub fn parse_count(
        &mut self,
        lockfile: &mut Lockfile,
        expr: Expr,
        builder: &mut StringBuilder,
    ) {
        let _ = lockfile;
        if let Some(default_catalog) = expr.get(b"catalog") {
            if let ExprData::EObject(obj) = &default_catalog.data {
                for item in obj.properties.slice() {
                    let dep_name = item.key.unwrap().as_string().unwrap();
                    builder.count(dep_name);
                    if let ExprData::EString(version_str) = &item.value.unwrap().data {
                        builder.count(version_str.slice());
                    }
                }
            }
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            if let ExprData::EObject(catalog_names) = &catalogs.data {
                for catalog in catalog_names.properties.slice() {
                    let catalog_name = catalog.key.unwrap().as_string().unwrap();
                    builder.count(catalog_name);
                    if let ExprData::EObject(obj) = &catalog.value.unwrap().data {
                        for item in obj.properties.slice() {
                            let dep_name = item.key.unwrap().as_string().unwrap();
                            builder.count(dep_name);
                            if let ExprData::EString(version_str) = &item.value.unwrap().data {
                                builder.count(version_str.slice());
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
                    let dep_name_str = item.key.unwrap().as_string().unwrap();

                    let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                    let dep_name = builder.append_with_hash::<String>(dep_name_str, dep_name_hash);

                    if let ExprData::EString(version_str) = &item.value.unwrap().data {
                        let version_literal = builder.append::<String>(version_str.slice());

                        let version_sliced =
                            version_literal.sliced(lockfile.buffers.string_bytes.as_slice());

                        let Some(version) = Dependency::parse(
                            dep_name,
                            dep_name_hash,
                            version_sliced.slice,
                            &version_sliced,
                            log,
                            Some(pm),
                        ) else {
                            log.add_error(source, item.value.unwrap().loc, b"Invalid dependency version")?;
                            continue;
                        };

                        let entry = group.get_or_put_context(
                            dep_name,
                            String::array_hash_context(lockfile, None),
                        )?;

                        if entry.found_existing {
                            log.add_error(source, item.key.unwrap().loc, b"Duplicate catalog")?;
                            continue;
                        }

                        let dep = Dependency {
                            name: dep_name,
                            name_hash: dep_name_hash,
                            version,
                            ..Dependency::default()
                        };

                        *entry.value_ptr = dep;
                    }
                }
            }
        }

        if let Some(catalogs) = expr.get(b"catalogs") {
            found_any = true;
            if let ExprData::EObject(catalog_names) = &catalogs.data {
                for catalog in catalog_names.properties.slice() {
                    let catalog_name_str = catalog.key.unwrap().as_string().unwrap();
                    let catalog_name = builder.append::<String>(catalog_name_str);

                    let group = self.get_or_put_group(lockfile, catalog_name)?;

                    if let ExprData::EObject(obj) = &catalog.value.unwrap().data {
                        for item in obj.properties.slice() {
                            let dep_name_str = item.key.unwrap().as_string().unwrap();
                            let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
                            let dep_name =
                                builder.append_with_hash::<String>(dep_name_str, dep_name_hash);
                            if let ExprData::EString(version_str) = &item.value.unwrap().data {
                                let version_literal =
                                    builder.append::<String>(version_str.slice());
                                let version_sliced = version_literal
                                    .sliced(lockfile.buffers.string_bytes.as_slice());

                                let Some(version) = Dependency::parse(
                                    dep_name,
                                    dep_name_hash,
                                    version_sliced.slice,
                                    &version_sliced,
                                    log,
                                    Some(pm),
                                ) else {
                                    log.add_error(
                                        source,
                                        item.value.unwrap().loc,
                                        b"Invalid dependency version",
                                    )?;
                                    continue;
                                };

                                let entry = group.get_or_put_context(
                                    dep_name,
                                    String::array_hash_context(lockfile, None),
                                )?;

                                if entry.found_existing {
                                    log.add_error(
                                        source,
                                        item.key.unwrap().loc,
                                        b"Duplicate catalog",
                                    )?;
                                    continue;
                                }

                                let dep = Dependency {
                                    name: dep_name,
                                    name_hash: dep_name_hash,
                                    version,
                                    ..Dependency::default()
                                };

                                *entry.value_ptr = dep;
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
            let Some(group_name_str) = prop.key.unwrap().as_string() else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };

            if !prop.value.unwrap().is_object() {
                continue;
            }

            // TODO(port): Zig accesses `.data.e_object` directly after `isObject()` check
            let ExprData::EObject(entries_obj) = &prop.value.unwrap().data else {
                unreachable!()
            };

            if group_name_str == b"default" {
                // PORT NOTE: reshaped for borrowck — split borrow of lockfile.catalogs.default
                put_entries_from_pnpm_lockfile(
                    lockfile,
                    log,
                    None,
                    entries_obj,
                    string_buf,
                )?;
            } else {
                let group_name = string_buf.append(group_name_str)?;
                // PORT NOTE: reshaped for borrowck — cannot hold &mut Map across &mut lockfile
                let group = lockfile.catalogs.get_or_put_group(lockfile, group_name)?;
                put_entries_from_pnpm_lockfile(
                    lockfile,
                    log,
                    Some(group),
                    entries_obj,
                    string_buf,
                )?;
                // TODO(port): the above double-borrows `lockfile` (catalogs is a field of lockfile).
                // Phase B: pass `String::array_hash_context` pieces by value or split lockfile borrows.
            }
        }
        Ok(())
    }

    pub fn sort(&mut self, lockfile: &Lockfile) {
        struct DepSortCtx<'a> {
            buf: &'a [u8],
            catalog_deps: &'a [Dependency],
        }

        impl<'a> DepSortCtx<'a> {
            fn less_than(&mut self, l: usize, r: usize) -> bool {
                let deps = self.catalog_deps;
                let l_dep = &deps[l];
                let r_dep = &deps[r];
                let buf = self.buf;

                l_dep.name.order(&r_dep.name, buf, buf) == Ordering::Less
            }
        }

        struct NameSortCtx<'a> {
            buf: &'a [u8],
            catalog_names: &'a [String],
        }

        impl<'a> NameSortCtx<'a> {
            fn less_than(&mut self, l: usize, r: usize) -> bool {
                let buf = self.buf;
                let names = self.catalog_names;
                let l_name = names[l];
                let r_name = names[r];

                l_name.order(&r_name, buf, buf) == Ordering::Less
            }
        }

        let mut dep_sort_ctx = DepSortCtx {
            buf: lockfile.buffers.string_bytes.as_slice(),
            catalog_deps: lockfile.catalogs.default.values(),
        };

        self.default.sort(&mut dep_sort_ctx);

        let mut iter = self.groups.iterator();
        while let Some(catalog) = iter.next() {
            dep_sort_ctx.catalog_deps = catalog.value_ptr.values();
            catalog.value_ptr.sort(&mut dep_sort_ctx);
        }

        let mut name_sort_ctx = NameSortCtx {
            buf: lockfile.buffers.string_bytes.as_slice(),
            catalog_names: self.groups.keys(),
        };

        self.groups.sort(&mut name_sort_ctx);
    }

    // Zig `deinit(allocator)` deleted: `Map` and `ArrayHashMap<String, Map>` are owned
    // collections whose `Drop` recursively frees the nested maps. No explicit `Drop` needed.

    pub fn count(&mut self, lockfile: &mut Lockfile, builder: &mut StringBuilder) {
        let mut deps_iter = self.default.iterator();
        while let Some(entry) = deps_iter.next() {
            let dep_name = entry.key_ptr;
            let dep = entry.value_ptr;
            builder.count(dep_name.slice(lockfile.buffers.string_bytes.as_slice()));
            dep.count(lockfile.buffers.string_bytes.as_slice(), builder);
        }

        let mut groups_iter = self.groups.iterator();
        while let Some(catalog) = groups_iter.next() {
            let catalog_name = catalog.key_ptr;
            builder.count(catalog_name.slice(lockfile.buffers.string_bytes.as_slice()));

            let mut deps_iter = catalog.value_ptr.iterator();
            while let Some(entry) = deps_iter.next() {
                let dep_name = entry.key_ptr;
                let dep = entry.value_ptr;
                builder.count(dep_name.slice(lockfile.buffers.string_bytes.as_slice()));
                dep.count(lockfile.buffers.string_bytes.as_slice(), builder);
            }
        }
    }

    pub fn clone(
        &mut self,
        pm: &mut PackageManager,
        old: &mut Lockfile,
        new: &mut Lockfile,
        builder: &mut StringBuilder,
    ) -> Result<CatalogMap, AllocError> {
        let mut new_catalog = CatalogMap::default();

        new_catalog
            .default
            .ensure_total_capacity(self.default.count())?;

        let mut deps_iter = self.default.iterator();
        while let Some(entry) = deps_iter.next() {
            let dep_name = entry.key_ptr;
            let dep = entry.value_ptr;
            // PERF(port): was assume_capacity
            new_catalog.default.put_assume_capacity_context(
                builder.append::<String>(dep_name.slice(old.buffers.string_bytes.as_slice())),
                dep.clone(pm, old.buffers.string_bytes.as_slice(), builder)?,
                String::array_hash_context(new, None),
            );
        }

        new_catalog
            .groups
            .ensure_total_capacity(self.groups.count())?;

        let mut groups_iter = self.groups.iterator();
        while let Some(group) = groups_iter.next() {
            let catalog_name = group.key_ptr;
            let deps = group.value_ptr;

            let mut new_group = Map::default();
            new_group.ensure_total_capacity(deps.count())?;

            let mut deps_iter = deps.iterator();
            while let Some(entry) = deps_iter.next() {
                let dep_name = entry.key_ptr;
                let dep = entry.value_ptr;
                // PERF(port): was assume_capacity
                new_group.put_assume_capacity_context(
                    builder.append::<String>(dep_name.slice(old.buffers.string_bytes.as_slice())),
                    dep.clone(pm, old.buffers.string_bytes.as_slice(), builder)?,
                    String::array_hash_context(new, None),
                );
            }

            // PERF(port): was assume_capacity
            new_catalog.groups.put_assume_capacity_context(
                builder.append::<String>(catalog_name.slice(old.buffers.string_bytes.as_slice())),
                new_group,
                String::array_hash_context(new, None),
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
    lockfile: &mut Lockfile,
    log: &mut Log,
    // None => use lockfile.catalogs.default
    catalog_map: Option<&mut Map>,
    entries_obj: &E::Object,
    string_buf: &mut StringBuf,
) -> Result<(), FromPnpmLockfileError> {
    // TODO(port): Zig signature took `*Map` directly; reshaped here because the
    // caller cannot hold `&mut lockfile.catalogs.default` while also passing
    // `&mut lockfile`. Phase B should restructure to pass only the hash-context
    // buffer instead of the whole lockfile.
    for entry_prop in entries_obj.properties.slice() {
        let Some(dep_name_str) = entry_prop.key.unwrap().as_string() else {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        };
        let dep_name_hash = StringBuilderNs::string_hash(dep_name_str);
        let dep_name = string_buf.append_with_hash(dep_name_str, dep_name_hash)?;

        let Some((version_str, _)) = entry_prop.value.unwrap().get_string(b"specifier")? else {
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
            log,
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

        let ctx = String::array_hash_context(lockfile, None);
        let map: &mut Map = match catalog_map {
            Some(ref mut m) => *m,
            None => &mut lockfile.catalogs.default,
        };
        let entry = map.get_or_put_context(dep_name, ctx)?;

        if entry.found_existing {
            return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
        }

        *entry.value_ptr = dep;
    }
    Ok(())
}

// `strings` import is used implicitly via `==` on byte slices; kept for parity.
#[allow(unused_imports)]
use strings as _;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/CatalogMap.zig (471 lines)
//   confidence: medium
//   todos:      4
//   notes:      ArrayHashMap *_context API assumed; from_pnpm_lockfile reshaped for borrowck (lockfile self-borrow); allocator params dropped per global-mimalloc rule
// ──────────────────────────────────────────────────────────────────────────
