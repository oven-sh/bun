use core::cmp::Ordering;

use crate::Error;
use bun_collections::ArrayHashMap;
use bun_core::strings;
use bun_install::dependency::{self, Behavior, Dependency, DependencyExt as _};
use bun_install::{PackageManager, PackageNameHash};
use bun_output::{declare_scope, scoped_log};
use bun_semver::String as SemverString;
use bun_semver::string::Builder as SemverBuilder;

use super::package::value_loc_of;
use super::{StringBuilder, package::Package};
// LAYERING NOTE: package.json is parsed by `bun_parsers::json` which
// produces the T2 value-shaped `bun_ast::Expr` (aliased as
// `crate::bun_json::Expr`), NOT the full T4 `bun_ast::Expr`. JSON parse
// is always UTF-8, so `as_utf8_string_literal()` needs no allocator.
use crate::bun_json::Expr;

declare_scope!(OverrideMap, visible);

#[derive(Default)]
pub struct OverrideMap {
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
    pub(crate) fn get(&self, name_hash: PackageNameHash) -> Option<dependency::Version> {
        scoped_log!(OverrideMap, "looking up override for {:x}", name_hash);
        if self.map.count() == 0 {
            return None;
        }
        self.map.get(&name_hash).map(|dep| dep.version.clone())
    }

    /// Like `get().is_some()` but also compares the stored name so a hash
    /// collision cannot produce a false positive.
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

    // Every caller already holds `&mut self` on `lockfile.overrides`, so
    // accept just the string buffer (the only lockfile field `sort` reads)
    // rather than the whole `Lockfile`.
    pub(crate) fn sort(&mut self, string_bytes: &[u8]) {
        self.map.sort(|_, deps: &[Dependency], l, r| {
            deps[l].name.order(deps[r].name, string_bytes, string_bytes) == Ordering::Less
        });
    }

    /// Accepts `lockfile.buffers.string_bytes` directly (rather than the whole
    /// `Lockfile`) so callers can split-borrow the lockfile alongside a live
    /// `StringBuilder`.
    pub(crate) fn count(&self, string_bytes: &[u8], builder: &mut StringBuilder) {
        for dep in self.map.values() {
            dep.count(string_bytes, builder);
        }
    }

    /// The new-side buffer lives inside `new_builder`, so no separate
    /// `new: &mut Lockfile` param is taken — that would alias the borrow.
    /// `pm` is generic over `NpmAliasRegistry` (not `&mut PackageManager`) so a
    /// caller already holding `&mut manager.lockfile` can pass
    /// `&mut manager.known_npm_aliases` instead of the whole manager.
    pub(crate) fn clone<PM: crate::dependency::NpmAliasRegistry>(
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

        Ok(new)
    }

    // the rest of this struct is expression parsing code:

    // No `lockfile` param: JSON strings are already UTF-8 here, and omitting
    // it avoids the `&mut lockfile.overrides` / `&mut lockfile` alias at the
    // only call site.
    pub(crate) fn parse_count(&mut self, expr: Expr, builder: &mut StringBuilder) {
        if let Some(overrides) = expr.as_property(b"overrides") {
            overrides.expr.for_each_property(|key, _key_loc, value| {
                builder.count(key);
                if let Some(s) = value.as_utf8_string_literal() {
                    builder.count(s);
                } else if let Some(dot) = value.as_property(b".") {
                    if let Some(s) = dot.expr.as_utf8_string_literal() {
                        builder.count(s);
                    }
                }
            });
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            resolutions.expr.for_each_property(|key, _key_loc, value| {
                builder.count(key);
                if let Some(v) = value.as_utf8_string_literal() {
                    builder.count(v);
                }
            });
        }
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
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        debug_assert!(self.map.count() == 0); // only call parse once
        if let Some(overrides) = expr.as_property(b"overrides") {
            self.parse_from_overrides(
                pm,
                lockfile_dependencies,
                root_package,
                json_source,
                log,
                overrides.expr,
                builder,
            )?;
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            self.parse_from_resolutions(
                pm,
                lockfile_dependencies,
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
    pub(crate) fn parse_from_overrides(
        &mut self,
        pm: &mut PackageManager,
        lockfile_dependencies: &[Dependency],
        root_package: &Package,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        if !expr.is_object() {
            log.add_warning_fmt(
                Some(source),
                value_loc_of(source, expr.loc),
                format_args!("\"overrides\" must be an object"),
            );
            return Err(crate::Error::Invalid);
        }

        self.map.ensure_unused_capacity(expr.property_count())?;

        expr.try_for_each_property(|k, key_loc, value_expr| {
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!("Missing overridden package name"),
                );
                return Ok(());
            }

            let name_hash = SemverBuilder::string_hash(k);

            let value_expr_loc =
                crate::bun_json::value_loc_of_property(&source.contents, key_loc, &value_expr);
            let (value, value_loc): (Expr, _) = 'value: {
                // for one level deep, we will only support a string and  { ".": value }
                if value_expr.data.is_e_string() {
                    break 'value (value_expr, value_expr_loc);
                } else if value_expr.is_object() {
                    if let Some(dot) = value_expr.as_property(b".") {
                        if dot.expr.data.is_e_string() {
                            if value_expr.property_count() > 1 {
                                log.add_warning_fmt(
                                    Some(source),
                                    value_expr_loc,
                                    format_args!(
                                        "Bun currently does not support nested \"overrides\""
                                    ),
                                );
                            }
                            break 'value (
                                dot.expr,
                                crate::bun_json::value_loc_of_property(
                                    &source.contents,
                                    dot.loc,
                                    &dot.expr,
                                ),
                            );
                        } else {
                            log.add_warning_fmt(
                                Some(source),
                                value_expr_loc,
                                format_args!(
                                    "Invalid override value for \"{}\"",
                                    bstr::BStr::new(k)
                                ),
                            );
                            return Ok(());
                        }
                    } else {
                        log.add_warning_fmt(
                            Some(source),
                            value_expr_loc,
                            format_args!("Bun currently does not support nested \"overrides\""),
                        );
                        return Ok(());
                    }
                }
                log.add_warning_fmt(
                    Some(source),
                    value_expr_loc,
                    format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)),
                );
                return Ok(());
            };

            let version_str = value
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!("Bun currently does not support patched package \"overrides\""),
                );
                return Ok(());
            }

            if let Some(version) = parse_override_value(
                "override",
                lockfile_dependencies,
                pm,
                root_package,
                source,
                value_loc,
                log,
                k,
                version_str,
                builder,
            )? {
                self.map.put_assume_capacity(name_hash, version);
            }
            Ok(())
        })
    }

    /// yarn classic: https://classic.yarnpkg.com/lang/en/docs/selective-version-resolutions/
    /// yarn berry: https://yarnpkg.com/configuration/manifest#resolutions
    pub(crate) fn parse_from_resolutions(
        &mut self,
        pm: &mut PackageManager,
        lockfile_dependencies: &[Dependency],
        root_package: &Package,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        if !expr.is_object() {
            log.add_warning_fmt(
                Some(source),
                value_loc_of(source, expr.loc),
                format_args!("\"resolutions\" must be an object with string values"),
            );
            return Ok(());
        }
        self.map.ensure_unused_capacity(expr.property_count())?;
        expr.try_for_each_property(|key, key_loc, value| {
            let mut k = key;
            if k.starts_with(b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!("Missing resolution package name"),
                );
                return Ok(());
            }
            let Some(version_str) = value.as_utf8_string_literal() else {
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!(
                        "Expected string value for resolution \"{}\"",
                        bstr::BStr::new(k)
                    ),
                );
                return Ok(());
            };
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if k[0] == b'@' {
                let Some(first_slash) = strings::index_of_char(k, b'/') else {
                    log.add_warning_fmt(
                        Some(source),
                        key_loc,
                        format_args!("Invalid package name \"{}\"", bstr::BStr::new(k)),
                    );
                    return Ok(());
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(
                        Some(source),
                        key_loc,
                        format_args!("Bun currently does not support nested \"resolutions\""),
                    );
                    return Ok(());
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!("Bun currently does not support nested \"resolutions\""),
                );
                return Ok(());
            }

            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key_loc,
                    format_args!("Bun currently does not support patched package \"resolutions\""),
                );
                return Ok(());
            }

            if let Some(version) = parse_override_value(
                "resolution",
                lockfile_dependencies,
                pm,
                root_package,
                source,
                crate::bun_json::value_loc_of_property(&source.contents, key_loc, &value),
                log,
                k,
                version_str,
                builder,
            )? {
                let name_hash = SemverBuilder::string_hash(k);
                self.map.put_assume_capacity(name_hash, version);
            }
            Ok(())
        })
    }
}

// `field` is only used in warning-message
// formatting, so a runtime `&'static str` is fine.
pub fn parse_override_value(
    field: &'static str,
    // Callers hold a live `StringBuilder` (which owns `&mut string_bytes`), so
    // accept the dependency slice directly and read string-bytes through
    // `builder.string_bytes` instead of taking the whole `Lockfile`.
    lockfile_dependencies: &[Dependency],
    package_manager: &mut PackageManager,
    root_package: &Package,
    source: &bun_ast::Source,
    loc: bun_ast::Loc,
    log: &mut bun_ast::Log,
    key: &[u8],
    value: &[u8],
    builder: &mut StringBuilder,
) -> Result<Option<Dependency>, Error> {
    if value.is_empty() {
        log.add_warning_fmt(Some(source), loc, format_args!("Missing {} value", field));
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
        let pkg_deps: &[Dependency] = root_package.dependencies.get(lockfile_dependencies);
        for dep in pkg_deps {
            if dep
                .name
                .eql(ref_name_str, builder.string_bytes.as_slice(), ref_name)
            {
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
        );
        return Ok(None);
    }

    let literal_string = builder.append::<SemverString>(value);
    // SAFETY: `string_bytes` was pre-reserved by `allocate()`; subsequent
    // `append` calls don't realloc, so a detached view is sound here while we
    // still need `&mut builder` for the next `append`.
    let string_bytes = unsafe { bun_ptr::detach_lifetime(builder.string_bytes.as_slice()) };
    let literal_sliced = literal_string.sliced(string_bytes);

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
            log.add_warning_fmt(
                Some(source),
                loc,
                format_args!("Invalid {} value \"{}\"", field, bstr::BStr::new(value)),
            );
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
