use bun_collections::VecExt;
use core::cmp::Ordering;

use bun_collections::ArrayHashMap;
use bun_core::Error;
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
// The root `expr` may be either the classic `EObject` tree (yarn import,
// cached workspace package.json) or the immutable `EObjectJSON` document
// produced by `parse_package_json_utf8_immutable`; both are handled below.
use crate::bun_json::{E, Expr, ExprData};

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
            match &overrides.expr.data {
                ExprData::EObject(obj) => {
                    for entry in obj.properties.slice() {
                        builder.count(
                            entry
                                .key
                                .as_ref()
                                .expect("infallible: prop has key")
                                .as_utf8_string_literal()
                                .expect("infallible: is_string checked"),
                        );
                        match &entry
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .data
                        {
                            ExprData::EString(s) => {
                                builder.count(&s.data);
                            }
                            ExprData::EObject(_) => {
                                if let Some(dot) = entry
                                    .value
                                    .as_ref()
                                    .expect("infallible: prop has value")
                                    .as_property(b".")
                                {
                                    if let Some(s) = dot.expr.as_utf8_string_literal() {
                                        builder.count(s);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                ExprData::EObjectJSON(obj) => {
                    for row in obj.get().properties() {
                        builder.count(row.key.slice());
                        match &row.value {
                            E::JsonValue::String(s) => builder.count(s.slice()),
                            E::JsonValue::Object(nested) => {
                                if let Some(E::JsonValue::String(s)) = nested.get().get(b".") {
                                    builder.count(s.slice());
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            match &resolutions.expr.data {
                ExprData::EObject(obj) => {
                    for entry in obj.properties.slice() {
                        builder.count(
                            entry
                                .key
                                .as_ref()
                                .expect("infallible: prop has key")
                                .as_utf8_string_literal()
                                .expect("infallible: is_string checked"),
                        );
                        let Some(v) = entry
                            .value
                            .as_ref()
                            .expect("infallible: prop has value")
                            .as_utf8_string_literal()
                        else {
                            continue;
                        };
                        builder.count(v);
                    }
                }
                ExprData::EObjectJSON(obj) => {
                    for row in obj.get().properties() {
                        builder.count(row.key.slice());
                        if let Some(v) = row.value.as_str() {
                            builder.count(v);
                        }
                    }
                }
                _ => {}
            }
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
        if let ExprData::EObjectJSON(obj) = &expr.data {
            return self.parse_from_overrides_immutable(
                pm,
                lockfile_dependencies,
                root_package,
                source,
                log,
                obj.get(),
                builder,
            );
        }
        let ExprData::EObject(obj) = &expr.data else {
            // A immutable-AST lookup locates the value at its key; point the
            // diagnostic at the value itself.
            log.add_warning_fmt(
                Some(source),
                value_loc_of(source, expr.loc),
                format_args!("\"overrides\" must be an object"),
            );
            return Err(bun_core::err!("Invalid"));
        };

        self.map
            .ensure_unused_capacity(obj.properties.len_u32() as usize)?;

        'props: for prop in obj.properties.slice() {
            let key = prop.key.as_ref().expect("infallible: prop has key");
            let k = key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Missing overridden package name"),
                );
                continue;
            }

            let name_hash = SemverBuilder::string_hash(k);

            let value: Expr = 'value: {
                // for one level deep, we will only support a string and  { ".": value }
                let value_expr = prop.value.as_ref().expect("infallible: prop has value");
                if value_expr.data.is_e_string() {
                    break 'value *value_expr;
                } else if let ExprData::EObject(value_obj) = &value_expr.data {
                    if let Some(dot) = value_expr.as_property(b".") {
                        if dot.expr.data.is_e_string() {
                            if value_obj.properties.len_u32() > 1 {
                                log.add_warning_fmt(
                                    Some(source),
                                    value_expr.loc,
                                    format_args!(
                                        "Bun currently does not support nested \"overrides\""
                                    ),
                                );
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
                            );
                            continue 'props;
                        }
                    } else {
                        log.add_warning_fmt(
                            Some(source),
                            value_expr.loc,
                            format_args!("Bun currently does not support nested \"overrides\""),
                        );
                        continue 'props;
                    }
                }
                log.add_warning_fmt(
                    Some(source),
                    value_expr.loc,
                    format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)),
                );
                continue 'props;
            };

            let version_str = value
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support patched package \"overrides\""),
                );
                continue;
            }

            if let Some(version) = parse_override_value(
                "override",
                lockfile_dependencies,
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

    /// [`Self::parse_from_overrides`] over the immutable JSON representation.
    /// Per-value locations are recovered from the source on the (cold)
    /// diagnostic paths; the key's location is used where the classic path
    /// used it.
    fn parse_from_overrides_immutable(
        &mut self,
        pm: &mut PackageManager,
        lockfile_dependencies: &[Dependency],
        root_package: &Package,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        obj: &E::ObjectJSON,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        let props = obj.properties();
        self.map.ensure_unused_capacity(props.len())?;

        for row in props {
            let k = row.key.slice();
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!("Missing overridden package name"),
                );
                continue;
            }

            let name_hash = SemverBuilder::string_hash(k);

            // for one level deep, we will only support a string and  { ".": value }
            let (version_str, version_key_loc): (&[u8], bun_ast::Loc) = match &row.value {
                E::JsonValue::String(s) => (s.slice(), row.key_loc),
                E::JsonValue::Object(nested) => {
                    let nested = nested.get();
                    let dot = nested.properties().iter().find(|p| p.key.slice() == b".");
                    match dot {
                        Some(dot_row) => match dot_row.value.as_str() {
                            Some(s) => {
                                if nested.properties().len() > 1 {
                                    log.add_warning_fmt(
                                        Some(source),
                                        value_loc_of(source, row.key_loc),
                                        format_args!(
                                            "Bun currently does not support nested \"overrides\""
                                        ),
                                    );
                                }
                                (s, dot_row.key_loc)
                            }
                            None => {
                                log.add_warning_fmt(
                                    Some(source),
                                    value_loc_of(source, row.key_loc),
                                    format_args!(
                                        "Invalid override value for \"{}\"",
                                        bstr::BStr::new(k)
                                    ),
                                );
                                continue;
                            }
                        },
                        None => {
                            log.add_warning_fmt(
                                Some(source),
                                value_loc_of(source, row.key_loc),
                                format_args!("Bun currently does not support nested \"overrides\""),
                            );
                            continue;
                        }
                    }
                }
                _ => {
                    log.add_warning_fmt(
                        Some(source),
                        value_loc_of(source, row.key_loc),
                        format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)),
                    );
                    continue;
                }
            };

            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!("Bun currently does not support patched package \"overrides\""),
                );
                continue;
            }

            if let Some(version) = parse_override_value(
                "override",
                lockfile_dependencies,
                pm,
                root_package,
                source,
                value_loc_of(source, version_key_loc),
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
        if let ExprData::EObjectJSON(obj) = &expr.data {
            return self.parse_from_resolutions_immutable(
                pm,
                lockfile_dependencies,
                root_package,
                source,
                log,
                obj.get(),
                builder,
            );
        }
        let ExprData::EObject(obj) = &expr.data else {
            // A immutable-AST lookup locates the value at its key; point the
            // diagnostic at the value itself.
            log.add_warning_fmt(
                Some(source),
                value_loc_of(source, expr.loc),
                format_args!("\"resolutions\" must be an object with string values"),
            );
            return Ok(());
        };
        self.map
            .ensure_unused_capacity(obj.properties.len_u32() as usize)?;
        for prop in obj.properties.slice() {
            let key = prop.key.as_ref().expect("infallible: prop has key");
            let mut k = key
                .as_utf8_string_literal()
                .expect("infallible: is_string checked");
            if k.starts_with(b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Missing resolution package name"),
                );
                continue;
            }
            let value = prop.value.as_ref().expect("infallible: prop has value");
            let ExprData::EString(value_str) = &value.data else {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!(
                        "Expected string value for resolution \"{}\"",
                        bstr::BStr::new(k)
                    ),
                );
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
                    );
                    continue;
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(
                        Some(source),
                        key.loc,
                        format_args!("Bun currently does not support nested \"resolutions\""),
                    );
                    continue;
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support nested \"resolutions\""),
                );
                continue;
            }

            let version_str = value_str.data.slice();
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    key.loc,
                    format_args!("Bun currently does not support patched package \"resolutions\""),
                );
                continue;
            }

            if let Some(version) = parse_override_value(
                "resolution",
                lockfile_dependencies,
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

    /// [`Self::parse_from_resolutions`] over the immutable JSON representation.
    /// Per-value locations are recovered from the source on the (cold)
    /// diagnostic paths; the key's location is used where the classic path
    /// used it.
    fn parse_from_resolutions_immutable(
        &mut self,
        pm: &mut PackageManager,
        lockfile_dependencies: &[Dependency],
        root_package: &Package,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        obj: &E::ObjectJSON,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        let props = obj.properties();
        self.map.ensure_unused_capacity(props.len())?;
        for row in props {
            let mut k = row.key.slice();
            if k.starts_with(b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!("Missing resolution package name"),
                );
                continue;
            }
            let Some(version_str) = row.value.as_str() else {
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!(
                        "Expected string value for resolution \"{}\"",
                        bstr::BStr::new(k)
                    ),
                );
                continue;
            };
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if k[0] == b'@' {
                let Some(first_slash) = strings::index_of_char(k, b'/') else {
                    log.add_warning_fmt(
                        Some(source),
                        row.key_loc,
                        format_args!("Invalid package name \"{}\"", bstr::BStr::new(k)),
                    );
                    continue;
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(
                        Some(source),
                        row.key_loc,
                        format_args!("Bun currently does not support nested \"resolutions\""),
                    );
                    continue;
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!("Bun currently does not support nested \"resolutions\""),
                );
                continue;
            }

            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(
                    Some(source),
                    row.key_loc,
                    format_args!("Bun currently does not support patched package \"resolutions\""),
                );
                continue;
            }

            if let Some(version) = parse_override_value(
                "resolution",
                lockfile_dependencies,
                pm,
                root_package,
                source,
                value_loc_of(source, row.key_loc),
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
