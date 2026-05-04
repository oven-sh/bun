use bun_collections::ArrayHashMap;
use bun_core::Error;
use bun_install::{Dependency, Lockfile, PackageManager, PackageNameHash};
use bun_install::lockfile::{Package, StringBuilder};
use bun_js_parser::Expr;
use bun_logger as logger;
use bun_output::{declare_scope, scoped_log};
use bun_semver::String as SemverString;
use bun_str::strings;

declare_scope!(OverrideMap, visible);

#[derive(Default)]
pub struct OverrideMap {
    // TODO(port): Zig used ArrayIdentityContext.U64 (identity hash on u64 key); ensure
    // bun_collections::ArrayHashMap<u64, _> uses identity hashing for u64 keys.
    pub map: ArrayHashMap<PackageNameHash, Dependency>,
}

impl OverrideMap {
    /// In the future, this `get` function should handle multi-level resolutions. This is difficult right
    /// now because given a Dependency ID, there is no fast way to trace it to its package.
    ///
    /// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
    /// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
    /// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
    pub fn get(&self, name_hash: PackageNameHash) -> Option<Dependency::Version> {
        scoped_log!(OverrideMap, "looking up override for {:x}", name_hash);
        if self.map.count() == 0 {
            return None;
        }
        if let Some(dep) = self.map.get(name_hash) {
            Some(dep.version)
        } else {
            None
        }
    }

    pub fn sort(&mut self, lockfile: &Lockfile) {
        struct Ctx<'a> {
            buf: &'a [u8],
            override_deps: &'a [Dependency],
        }

        impl<'a> Ctx<'a> {
            pub fn less_than(&self, l: usize, r: usize) -> bool {
                let deps = self.override_deps;
                let l_dep = deps[l];
                let r_dep = deps[r];

                let buf = self.buf;
                l_dep.name.order(&r_dep.name, buf, buf) == core::cmp::Ordering::Less
            }
        }

        let ctx = Ctx {
            buf: lockfile.buffers.string_bytes.as_slice(),
            override_deps: self.map.values(),
        };

        // TODO(port): bun_collections::ArrayHashMap::sort signature — Zig takes a context
        // with lessThan(ctx, a_index, b_index); adapt to whatever the Rust API exposes.
        self.map.sort(&ctx);
    }

    pub fn count(&self, lockfile: &mut Lockfile, builder: &mut StringBuilder) {
        for dep in self.map.values() {
            dep.count(lockfile.buffers.string_bytes.as_slice(), builder);
        }
    }

    pub fn clone(
        &self,
        pm: &mut PackageManager,
        old_lockfile: &mut Lockfile,
        new_lockfile: &mut Lockfile,
        new_builder: &mut StringBuilder,
    ) -> Result<OverrideMap, Error> {
        // TODO(port): narrow error set
        let mut new = OverrideMap::default();
        new.map.ensure_total_capacity(self.map.entries_len())?;
        // PERF(port): was ensureTotalCapacity + putAssumeCapacity — profile in Phase B

        for (k, v) in self.map.keys().iter().zip(self.map.values()) {
            new.map.put_assume_capacity(
                *k,
                v.clone(pm, old_lockfile.buffers.string_bytes.as_slice(), new_builder)?,
            );
        }

        Ok(new)
    }

    // the rest of this struct is expression parsing code:

    pub fn parse_count(
        &mut self,
        lockfile: &mut Lockfile,
        expr: Expr,
        builder: &mut StringBuilder,
    ) {
        let _ = lockfile;
        if let Some(overrides) = expr.as_property(b"overrides") {
            if !overrides.expr.data.is_e_object() {
                return;
            }

            for entry in overrides.expr.data.e_object().properties.slice() {
                builder.count(entry.key.unwrap().as_string().unwrap());
                match &entry.value.unwrap().data {
                    bun_js_parser::ExprData::EString(s) => {
                        builder.count(s.slice());
                    }
                    bun_js_parser::ExprData::EObject(_) => {
                        if let Some(dot) = entry.value.unwrap().as_property(b".") {
                            if let Some(s) = dot.expr.as_string() {
                                builder.count(s);
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            if !resolutions.expr.data.is_e_object() {
                return;
            }

            for entry in resolutions.expr.data.e_object().properties.slice() {
                builder.count(entry.key.unwrap().as_string().unwrap());
                let Some(v) = entry.value.unwrap().as_string() else { continue };
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
        root_package: &mut Package,
        log: &mut logger::Log,
        json_source: &logger::Source,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        if cfg!(debug_assertions) {
            debug_assert!(self.map.entries_len() == 0); // only call parse once
        }
        if let Some(overrides) = expr.as_property(b"overrides") {
            self.parse_from_overrides(pm, lockfile, root_package, json_source, log, overrides.expr, builder)?;
        } else if let Some(resolutions) = expr.as_property(b"resolutions") {
            self.parse_from_resolutions(pm, lockfile, root_package, json_source, log, resolutions.expr, builder)?;
        }
        scoped_log!(OverrideMap, "parsed {} overrides", self.map.entries_len());
        Ok(())
    }

    /// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    pub fn parse_from_overrides(
        &mut self,
        pm: &mut PackageManager,
        lockfile: &mut Lockfile,
        root_package: &mut Package,
        source: &logger::Source,
        log: &mut logger::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        if !expr.data.is_e_object() {
            log.add_warning_fmt(source, expr.loc, format_args!("\"overrides\" must be an object"))?;
            return Err(bun_core::err!("Invalid"));
        }

        self.map.ensure_unused_capacity(expr.data.e_object().properties.len())?;

        for prop in expr.data.e_object().properties.slice() {
            let key = prop.key.unwrap();
            let k = key.as_string().unwrap();
            if k.is_empty() {
                log.add_warning_fmt(source, key.loc, format_args!("Missing overridden package name"))?;
                continue;
            }

            let name_hash = SemverString::Builder::string_hash(k);

            let value = 'value: {
                // for one level deep, we will only support a string and  { ".": value }
                let value_expr = prop.value.unwrap();
                if value_expr.data.is_e_string() {
                    break 'value Some(value_expr);
                } else if value_expr.data.is_e_object() {
                    if let Some(dot) = value_expr.as_property(b".") {
                        if dot.expr.data.is_e_string() {
                            if value_expr.data.e_object().properties.len() > 1 {
                                log.add_warning_fmt(source, value_expr.loc, format_args!("Bun currently does not support nested \"overrides\""))?;
                            }
                            break 'value Some(dot.expr);
                        } else {
                            log.add_warning_fmt(source, value_expr.loc, format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)))?;
                            break 'value None;
                        }
                    } else {
                        log.add_warning_fmt(source, value_expr.loc, format_args!("Bun currently does not support nested \"overrides\""))?;
                        break 'value None;
                    }
                }
                log.add_warning_fmt(source, value_expr.loc, format_args!("Invalid override value for \"{}\"", bstr::BStr::new(k)))?;
                None
            };
            let Some(value) = value else { continue };

            let version_str = value.data.e_string().slice();
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(source, key.loc, format_args!("Bun currently does not support patched package \"overrides\""))?;
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
        root_package: &mut Package,
        source: &logger::Source,
        log: &mut logger::Log,
        expr: Expr,
        builder: &mut StringBuilder,
    ) -> Result<(), Error> {
        // TODO(port): narrow error set
        if !expr.data.is_e_object() {
            log.add_warning_fmt(source, expr.loc, format_args!("\"resolutions\" must be an object with string values"))?;
            return Ok(());
        }
        self.map.ensure_unused_capacity(expr.data.e_object().properties.len())?;
        for prop in expr.data.e_object().properties.slice() {
            let key = prop.key.unwrap();
            let mut k = key.as_string().unwrap();
            if k.starts_with(b"**/") {
                k = &k[3..];
            }
            if k.is_empty() {
                log.add_warning_fmt(source, key.loc, format_args!("Missing resolution package name"))?;
                continue;
            }
            let value = prop.value.unwrap();
            if !value.data.is_e_string() {
                log.add_warning_fmt(source, key.loc, format_args!("Expected string value for resolution \"{}\"", bstr::BStr::new(k)))?;
                continue;
            }
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if k[0] == b'@' {
                let Some(first_slash) = strings::index_of_char(k, b'/') else {
                    log.add_warning_fmt(source, key.loc, format_args!("Invalid package name \"{}\"", bstr::BStr::new(k)))?;
                    continue;
                };
                if strings::index_of_char(&k[first_slash as usize + 1..], b'/').is_some() {
                    log.add_warning_fmt(source, key.loc, format_args!("Bun currently does not support nested \"resolutions\""))?;
                    continue;
                }
            } else if strings::index_of_char(k, b'/').is_some() {
                log.add_warning_fmt(source, key.loc, format_args!("Bun currently does not support nested \"resolutions\""))?;
                continue;
            }

            let version_str = value.data.e_string().data();
            if version_str.starts_with(b"patch:") {
                // TODO(dylan-conway): apply .patch files to packages
                log.add_warning_fmt(source, key.loc, format_args!("Bun currently does not support patched package \"resolutions\""))?;
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
                let name_hash = SemverString::Builder::string_hash(k);
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
    root_package: &mut Package,
    source: &logger::Source,
    loc: logger::Loc,
    log: &mut logger::Log,
    key: &[u8],
    value: &[u8],
    builder: &mut StringBuilder,
) -> Result<Option<Dependency>, Error> {
    // TODO(port): narrow error set
    if value.is_empty() {
        log.add_warning_fmt(source, loc, format_args!("Missing {} value", field))?;
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
        let pkg_deps: &[Dependency] = root_package.dependencies.get(lockfile.buffers.dependencies.as_slice());
        for dep in pkg_deps {
            if dep.name.eql(&ref_name_str, lockfile.buffers.string_bytes.as_slice(), ref_name) {
                return Ok(Some(*dep));
            }
        }
        log.add_warning_fmt(
            source,
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

    let name_hash = SemverString::Builder::string_hash(key);
    let name = builder.append_with_hash::<SemverString>(key, name_hash);

    let version = match Dependency::parse(
        name,
        name_hash,
        literal_sliced.slice,
        &literal_sliced,
        log,
        package_manager,
    ) {
        Some(v) => v,
        None => {
            log.add_warning_fmt(source, loc, format_args!("Invalid {} value \"{}\"", field, bstr::BStr::new(value)))?;
            return Ok(None);
        }
    };

    Ok(Some(Dependency {
        name,
        name_hash,
        version,
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/OverrideMap.zig (360 lines)
//   confidence: medium
//   todos:      6
//   notes:      Expr.data tag checks ported as is_e_*/e_*() accessors; ArrayHashMap sort/identity-hash API needs Phase B alignment; comptime `field` param demoted to runtime &'static str.
// ──────────────────────────────────────────────────────────────────────────
