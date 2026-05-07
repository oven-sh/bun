use core::cmp::Ordering;

use bun_collections::ArrayHashMap;
use bun_core::Error;
use bun_install::{Lockfile, PackageManager, PackageNameHash};
use bun_install::dependency::{self, Behavior, Dependency, DependencyExt as _};
use bun_logger as logger;
use bun_output::{declare_scope, scoped_log};
use bun_semver::string::Builder as SemverBuilder;
use bun_semver::String as SemverString;
use bun_str::strings;

use super::{package::Package, StringBuilder};
// LAYERING NOTE: package.json is parsed by `bun_interchange::json` which
// produces the T2 value-shaped `bun_logger::js_ast::Expr` (aliased as
// `crate::bun_json::Expr`), NOT the full T4 `bun_js_parser::Expr`. JSON parse
// is always UTF-8, so `as_utf8_string_literal()` is the allocator-free port of
// Zig's `asString(lockfile.allocator)`.
use crate::bun_json::{Expr, ExprData};

declare_scope!(OverrideMap, visible);

#[derive(Default)]
pub struct OverrideMap {
    // Zig used ArrayIdentityContext.U64 (identity hash on u64 key); the Rust
    // `ArrayHashMap` defaults to identity hashing for integer keys.
    pub map: ArrayHashMap<PackageNameHash, Dependency>,
}

impl OverrideMap {
    /// In the future, this `get` function should handle multi-level resolutions. This is difficult right
    /// now because given a Dependency ID, there is no fast way to trace it to its package.
    ///
    /// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
    /// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
    /// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
    pub fn get(&self, name_hash: PackageNameHash) -> Option<dependency::Version> {
        scoped_log!(OverrideMap, "looking up override for {:x}", name_hash);
        if self.map.count() == 0 {
            return None;
        }
        self.map.get(&name_hash).map(|dep| dep.version.clone())
    }

    // PORT NOTE: reshaped for borrowck — Zig took `*const Lockfile` but every
    // caller already holds `&mut self` on `lockfile.overrides`, so accept just
    // the string buffer (the only field `sort` reads).
    pub fn sort(&mut self, string_bytes: &[u8]) {
        self.map.sort(|_, deps: &[Dependency], l, r| {
            deps[l].name.order(&deps[r].name, string_bytes, string_bytes) == Ordering::Less
        });
    }

    pub fn count(&self, lockfile: &Lockfile, builder: &mut StringBuilder) {
        for dep in self.map.values() {
            dep.count(lockfile.buffers.string_bytes.as_slice(), builder);
        }
    }

    /// PORT NOTE: Zig also passed `*Lockfile new`, but it was unused —
    /// the new-side buffer lives inside `new_builder`. Dropped to avoid the alias.
    pub fn clone(
        &self,
        pm: &mut PackageManager,
        old_lockfile: &Lockfile,
        new_builder: &mut StringBuilder,
    ) -> Result<OverrideMap, Error> {
        let mut new = OverrideMap::default();
        new.map.ensure_total_capacity(self.map.count())?;

        for (k, v) in self.map.keys().iter().zip(self.map.values()) {
            // PERF(port): was ensureTotalCapacity + putAssumeCapacity — profile in Phase B
            new.map.put_assume_capacity(
                *k,
                v.clone_in(pm, old_lockfile.buffers.string_bytes.as_slice(), new_builder)?,
            );
        }

        Ok(new)
    }

    // the rest of this struct is expression parsing code:

    // PORT NOTE: Zig passed `lockfile: *Lockfile` solely for `lockfile.allocator`
    // (string transcode); JSON strings are already UTF-8 here, so the parameter
    // is dropped — also avoids the `&mut lockfile.overrides` / `&mut lockfile`
    // alias at the only call site.
    pub fn parse_count(&mut self, expr: Expr, builder: &mut StringBuilder) {
        if let Some(overrides) = expr.as_property(b"overrides") {
            let ExprData::EObject(obj) = &overrides.expr.data else { return };

            for entry in obj.properties.slice() {
                builder.count(entry.key.as_ref().unwrap().as_utf8_string_literal().unwrap());
                match &entry.value.as_ref().unwrap().data {
                    ExprData::EString(s) => {
                        builder.count(s.data);
                    }
                    ExprData::EObject(_) => {
                        if let Some(dot) = entry.value.as_ref().unwrap().as_property(b".") {
                            if let Some(s) = dot.expr.as_utf8_string_literal() {
                                builder.count(s);
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            let ExprData::EObject(obj) = &resolutions.expr.data else { return };

            for entry in obj.properties.slice() {
                builder.count(entry.key.as_ref().unwrap().as_utf8_string_literal().unwrap());
                let Some(v) = entry.value.as_ref().unwrap().as_utf8_string_literal() else { continue };
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
        if let Some(overrides) = expr.as_property(b"overrides") {
            self.parse_from_overrides(pm, lockfile, root_package, json_source, log, overrides.expr, builder)?;
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            self.parse_from_resolutions(pm, lockfile, root_package, json_source, log, resolutions.expr, builder)?;
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
            log.add_warning_fmt(Some(source), expr.loc, format_args!("\"overrides\" must be an object"))?;
            return Err(bun_core::err!("Invalid"));
        };

        self.map.ensure_unused_capacity(obj.properties.len as usize)?;

        'props: for prop in obj.properties.slice() {
            let key = prop.key.as_ref().unwrap();
            let k = key.as_utf8_string_literal().unwrap();
            if k.is_empty() {
                log.add_warning_fmt(Some(source), key.loc, format_args!("Missing overridden package name"))?;
                continue;
            }

            let name_hash = SemverBuilder::string_hash(k);

            let value: Expr = 'value: {
                // for one level deep, we will only support a string and  { ".": value }
                let value_expr = prop.value.as_ref().unwrap();
                if value_expr.data.is_e_string() {
                    break 'value *value_expr;
                } else if let ExprData::EObject(value_obj) = &value_expr.data {
                    if let Some(dot) = value_expr.as_property(b".") {
                        if dot.expr.data.is_e_string() {
                            if value_obj.properties.len > 1 {
                                log.add_warning_fmt(Some(source), value_expr.loc, format_args!("Bun currently does not support nested \"overrides\""))?;
                            }
                            break 'value dot.expr;
                        } else {
                            log.add_warning_fmt(Some(source), value_expr.loc, format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)))?;
                            continue 'props;
                        }
                    } else {
                        log.add_warning_fmt(Some(source), value_expr.loc, format_args!("Bun currently does not support nested \"overrides\""))?;
                        continue 'props;
                    }
                }
                log.add_warning_fmt(Some(source), value_expr.loc, format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)))?;
                continue 'props;
            };

            let version_str = value.as_utf8_string_literal().unwrap();
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(Some(source), key.loc, format_args!("Bun currently does not support patched package \"overrides\""))?;
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
            log.add_warning_fmt(Some(source), expr.loc, format_args!("\"resolutions\" must be an object with string values"))?;
            return Ok(());
        };
        self.map.ensure_unused_capacity(obj.properties.len as usize)?;
        for prop in obj.properties.slice() {
            let key = prop.key.as_ref().unwrap();
            let mut k = key.as_utf8_string_literal().unwrap();
            if k.starts_with(b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(Some(source), key.loc, format_args!("Missing resolution package name"))?;
                continue;
            }
            let value = prop.value.as_ref().unwrap();
            let ExprData::EString(value_str) = &value.data else {
                log.add_warning_fmt(Some(source), key.loc, format_args!("Expected string value for resolution \"{}\"", bstr::BStr::new(k)))?;
                continue;
            };
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if k[0] == b'@' {
                let Some(first_slash) = strings::index_of_char(k, b'/') else {
                    log.add_warning_fmt(Some(source), key.loc, format_args!("Invalid package name \"{}\"", bstr::BStr::new(k)))?;
                    continue;
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(Some(source), key.loc, format_args!("Bun currently does not support nested \"resolutions\""))?;
                    continue;
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(Some(source), key.loc, format_args!("Bun currently does not support nested \"resolutions\""))?;
                continue;
            }

            let version_str = value_str.data;
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(Some(source), key.loc, format_args!("Bun currently does not support patched package \"resolutions\""))?;
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
            if dep.name.eql(ref_name_str, lockfile.buffers.string_bytes.as_slice(), ref_name) {
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
        &mut *log,
        package_manager,
    ) {
        Some(v) => v,
        None => {
            log.add_warning_fmt(Some(source), loc, format_args!("Invalid {} value \"{}\"", field, bstr::BStr::new(value)))?;
            return Ok(None);
        }
    };

    Ok(Some(Dependency {
        name,
        name_hash,
        version,
        behavior: Behavior::default(),
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/OverrideMap.zig (360 lines)
//   confidence: high
//   notes:      `Expr` is the T2 `bun_logger::js_ast::Expr` (JSON value tree);
//               `lockfile.allocator` dropped — JSON strings are already UTF-8;
//               `sort` takes `&[u8]` (string_bytes) for borrowck disjointness;
//               comptime `field` param demoted to runtime &'static str.
// ──────────────────────────────────────────────────────────────────────────
