use bun_collections::ArrayHashMap;
use bun_core::Error;
use bun_js_parser::{Expr, ExprData};
use bun_logger as logger;
use bun_output::{declare_scope, scoped_log};
use bun_semver::string::Builder as SemverBuilder;
use bun_semver::String as SemverString;
use bun_str::strings;

use super::{Lockfile, StringBuilder};
use super::package::Package;
use crate::bun_json::ExprAccessors;
use crate::dependency::{self, Dependency, Version as DependencyVersion};
use crate::{PackageManager, PackageNameHash};

declare_scope!(OverrideMap, visible);

#[derive(Default)]
pub struct OverrideMap {
    // Zig used `ArrayIdentityContext.U64` (identity hash on the u64 key);
    // `bun_collections::ArrayHashMap<u64, _>`'s default context already hashes
    // the raw `u64` bytes, which is functionally equivalent for lookup.
    pub map: ArrayHashMap<PackageNameHash, Dependency>,
}

impl OverrideMap {
    /// In the future, this `get` function should handle multi-level resolutions. This is difficult right
    /// now because given a Dependency ID, there is no fast way to trace it to its package.
    ///
    /// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
    /// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
    /// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
    pub fn get(&self, name_hash: PackageNameHash) -> Option<DependencyVersion> {
        scoped_log!(OverrideMap, "looking up override for {:x}", name_hash);
        if self.map.count() == 0 {
            return None;
        }
        self.map.get(&name_hash).map(|dep| dep.version.clone())
    }

    /// PORT NOTE: reshaped for borrowck — Zig took `*const Lockfile` and read
    /// `lockfile.buffers.string_bytes.items`; callers cannot pass `&Lockfile`
    /// while also holding `&mut lockfile.overrides`, so accept the string
    /// buffer slice directly.
    pub fn sort(&mut self, string_buf: &[u8]) {
        self.map.sort(|_keys, values, l, r| {
            let l_dep = &values[l];
            let r_dep = &values[r];
            l_dep.name.order(&r_dep.name, string_buf, string_buf) == core::cmp::Ordering::Less
        });
    }

    // Zig `deinit(allocator)` dropped — `ArrayHashMap` owns its storage and
    // frees on `Drop`.

    /// PORT NOTE: reshaped for borrowck — see `sort`.
    pub fn count(&self, string_buf: &[u8], builder: &mut StringBuilder) {
        for dep in self.map.values() {
            dep.count(string_buf, builder);
        }
    }

    /// PORT NOTE: reshaped for borrowck — Zig took `*Lockfile old, *Lockfile new`
    /// but only read `old.buffers.string_bytes` and `new.allocator`; the latter
    /// is implicit in Rust (global mimalloc), so only the old string buffer is
    /// needed.
    pub fn clone(
        &self,
        pm: &mut PackageManager,
        old_string_buf: &[u8],
        new_builder: &mut StringBuilder,
    ) -> Result<OverrideMap, Error> {
        let mut new = OverrideMap::default();
        new.map.ensure_total_capacity(self.map.count())?;

        for (k, v) in self.map.keys().iter().zip(self.map.values()) {
            // PERF(port): was ensureTotalCapacity + putAssumeCapacity — profile in Phase B
            new.map
                .put_assume_capacity(*k, v.clone_in(pm, old_string_buf, new_builder)?);
        }

        Ok(new)
    }

    // the rest of this struct is expression parsing code:

    /// PORT NOTE: Zig passed `*Lockfile` solely for its `allocator` (forwarded
    /// to `Expr.asString` / `E.String.slice`). The Rust JSON-parse path always
    /// yields UTF-8 `E.String`s whose bytes are read directly via
    /// `ExprAccessors::as_string`, so no allocator (and thus no lockfile) is
    /// needed here.
    pub fn parse_count(&mut self, expr: Expr, builder: &mut StringBuilder) {
        if let Some(overrides) = ExprAccessors::as_property(&expr, b"overrides") {
            let ExprData::EObject(obj) = &overrides.expr.data else {
                return;
            };

            for entry in obj.properties.slice() {
                let key = entry.key.unwrap();
                builder.count(ExprAccessors::as_string(&key).unwrap());
                let value = entry.value.unwrap();
                match &value.data {
                    ExprData::EString(s) => {
                        builder.count(s.data);
                    }
                    ExprData::EObject(_) => {
                        if let Some(dot) = ExprAccessors::as_property(&value, b".") {
                            if let Some(s) = ExprAccessors::as_string(&dot.expr) {
                                builder.count(s);
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if let Some(resolutions) = ExprAccessors::as_property(&expr, b"resolutions") {
            let ExprData::EObject(obj) = &resolutions.expr.data else {
                return;
            };

            for entry in obj.properties.slice() {
                let key = entry.key.unwrap();
                builder.count(ExprAccessors::as_string(&key).unwrap());
                let Some(v) = ExprAccessors::as_string(&entry.value.unwrap()) else {
                    continue;
                };
                builder.count(v);
            }
        }
    }

    /// Given a package json expression, detect and parse override configuration into the given override map.
    /// It is assumed the input map is uninitialized (zero entries)
    pub fn parse_append(
        &mut self,
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        root_package: &Package,
        log: &mut logger::Log,
        json_source: &logger::Source,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        debug_assert!(self.map.count() == 0); // only call parse once
        if let Some(overrides) = ExprAccessors::as_property(&expr, b"overrides") {
            self.parse_from_overrides(
                pm,
                lockfile,
                root_package,
                json_source,
                log,
                overrides.expr,
                builder,
            )?;
        } else if let Some(resolutions) = ExprAccessors::as_property(&expr, b"resolutions") {
            self.parse_from_resolutions(
                pm,
                lockfile,
                root_package,
                json_source,
                log,
                resolutions.expr,
                builder,
            )?;
        }
        scoped_log!(OverrideMap, "parsed {} overrides", self.map.count());
        Ok(())
    }

    /// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    pub fn parse_from_overrides(
        &mut self,
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        root_package: &Package,
        source: &logger::Source,
        log: &mut logger::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        let ExprData::EObject(obj) = &expr.data else {
            log.add_warning_fmt(
                Some(source),
                expr.loc,
                format_args!("\"overrides\" must be an object"),
            )?;
            return Err(bun_core::err!(Invalid));
        };

        self.map.ensure_unused_capacity(obj.properties.len as usize)?;

        for prop in obj.properties.slice() {
            let key = prop.key.unwrap();
            let k = ExprAccessors::as_string(&key).unwrap();
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Missing overridden package name"),
                )?;
                continue;
            }

            let name_hash = SemverBuilder::string_hash(k);

            let value = 'value: {
                // for one level deep, we will only support a string and  { ".": value }
                let value_expr = prop.value.unwrap();
                if value_expr.data.is_e_string() {
                    break 'value value_expr;
                } else if let ExprData::EObject(value_obj) = &value_expr.data {
                    if let Some(dot) = ExprAccessors::as_property(&value_expr, b".") {
                        if dot.expr.data.is_e_string() {
                            if value_obj.properties.len > 1 {
                                log.add_warning_fmt(
                                    Some(source),
                                    value_expr.loc,
                                    format_args!(
                                        "Bun currently does not support nested \"overrides\""
                                    ),
                                )?;
                            }
                            break 'value dot.expr;
                        } else {
                            log.add_warning_fmt(
                                Some(source),
                                value_expr.loc,
                                format_args!(
                                    "Invalid override value for \"{}\"",
                                    bstr::BStr::new(k)
                                ),
                            )?;
                            continue;
                        }
                    } else {
                        log.add_warning_fmt(
                            Some(source),
                            value_expr.loc,
                            format_args!("Bun currently does not support nested \"overrides\""),
                        )?;
                        continue;
                    }
                }
                log.add_warning_fmt(
                    Some(source),
                    value_expr.loc,
                    format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)),
                )?;
                continue;
            };

            let version_str = match &value.data {
                ExprData::EString(s) => s.data,
                _ => unreachable!(),
            };
            if strings::has_prefix_comptime(version_str, b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support patched package \"overrides\""),
                )?;
                continue;
            }

            if let Some(version) = parse_override_value(
                "override",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                k,
                version_str,
                builder,
            )? {
                // PERF(port): was assume_capacity
                self.map.put_assume_capacity(name_hash, version);
            }
        }
        Ok(())
    }

    /// yarn classic: https://classic.yarnpkg.com/lang/en/docs/selective-version-resolutions/
    /// yarn berry: https://yarnpkg.com/configuration/manifest#resolutions
    pub fn parse_from_resolutions(
        &mut self,
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        root_package: &Package,
        source: &logger::Source,
        log: &mut logger::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        let ExprData::EObject(obj) = &expr.data else {
            log.add_warning_fmt(
                Some(source),
                expr.loc,
                format_args!("\"resolutions\" must be an object with string values"),
            )?;
            return Ok(());
        };
        self.map.ensure_unused_capacity(obj.properties.len as usize)?;
        for prop in obj.properties.slice() {
            let key = prop.key.unwrap();
            let mut k = ExprAccessors::as_string(&key).unwrap();
            if strings::has_prefix_comptime(k, b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Missing resolution package name"),
                )?;
                continue;
            }
            let value = prop.value.unwrap();
            let ExprData::EString(value_str) = &value.data else {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!(
                        "Expected string value for resolution \"{}\"",
                        bstr::BStr::new(k)
                    ),
                )?;
                continue;
            };
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if k[0] == b'@' {
                let Some(first_slash) = strings::index_of_char(k, b'/') else {
                    log.add_warning_fmt(
                        Some(source),
                        key.loc,
                        format_args!("Invalid package name \"{}\"", bstr::BStr::new(k)),
                    )?;
                    continue;
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(
                        Some(source),
                        key.loc,
                        format_args!("Bun currently does not support nested \"resolutions\""),
                    )?;
                    continue;
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support nested \"resolutions\""),
                )?;
                continue;
            }

            let version_str = value_str.data;
            if strings::has_prefix_comptime(version_str, b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support patched package \"resolutions\""),
                )?;
                continue;
            }

            if let Some(version) = parse_override_value(
                "resolution",
                lockfile,
                pm,
                root_package,
                source,
                value.loc,
                log,
                k,
                version_str,
                builder,
            )? {
                let name_hash = SemverBuilder::string_hash(k);
                // PERF(port): was assume_capacity
                self.map.put_assume_capacity(name_hash, version);
            }
        }
        Ok(())
    }
}

// PERF(port): was comptime monomorphization (`comptime field: []const u8`) — profile in Phase B.
// Only used in warning-message formatting, so runtime &'static str is fine.
pub fn parse_override_value(
    field: &'static str,
    lockfile: &mut Lockfile,
    package_manager: &mut PackageManager,
    root_package: &Package,
    source: &logger::Source,
    loc: logger::Loc,
    log: &mut logger::Log,
    key: &[u8],
    value: &[u8],
    builder: &mut StringBuilder,
) -> Result<Option<Dependency>, Error> {
    if value.is_empty() {
        log.add_warning_fmt(Some(source), loc, format_args!("Missing {} value", field))?;
        return Ok(None);
    }

    // "Overrides may also be defined as a reference to a spec for a direct dependency
    // by prefixing the name of the package you wish the version to match with a `$`"
    // https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    // This is why a `*Lockfile.Package` is needed here.
    if value[0] == b'$' {
        let ref_name = &value[1..];
        // This is fine for this string to not share the string pool, because it's only used for .eql()
        let ref_name_str = SemverString::init(ref_name, ref_name);
        let pkg_deps: &[Dependency] = root_package
            .dependencies
            .get(lockfile.buffers.dependencies.as_slice());
        for dep in pkg_deps {
            if dep.name.eql(
                ref_name_str,
                lockfile.buffers.string_bytes.as_slice(),
                ref_name,
            ) {
                return Ok(Some(dep.clone()));
            }
        }
        log.add_warning_fmt(
            Some(source),
            loc,
            format_args!(
                "Could not resolve {} \"{}\" (you need \"{}\" in your dependencies)",
                field,
                bstr::BStr::new(value),
                bstr::BStr::new(ref_name),
            ),
        )?;
        return Ok(None);
    }

    let literal_string = builder.append::<SemverString>(value);
    let literal_sliced = literal_string.sliced(lockfile.buffers.string_bytes.as_slice());

    let name_hash = SemverBuilder::string_hash(key);
    let name = builder.append_with_hash::<SemverString>(key, name_hash);

    let version = match dependency::parse(
        name,
        name_hash,
        literal_sliced.slice,
        &literal_sliced,
        log,
        package_manager,
    ) {
        Some(v) => v,
        None => {
            log.add_warning_fmt(
                Some(source),
                loc,
                format_args!("Invalid {} value \"{}\"", field, bstr::BStr::new(value)),
            )?;
            return Ok(None);
        }
    };

    Ok(Some(Dependency {
        name,
        name_hash,
        version,
        ..Dependency::default()
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/OverrideMap.zig (360 lines)
//   confidence: high
//   notes:      `*Lockfile` params on sort/count/clone/parse_count narrowed to
//               `&[u8]` (or dropped) for borrowck — Zig only read
//               `buffers.string_bytes` / `allocator`. comptime `field` demoted
//               to runtime &'static str.
// ──────────────────────────────────────────────────────────────────────────
