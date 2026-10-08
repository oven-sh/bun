//! What the rules `n/no-unsupported-features/*` share.

pub(crate) mod data;
pub(crate) mod es_syntax;
pub(crate) mod es_syntax_data;
pub(crate) mod object_type;
pub(crate) mod semver;

use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{Mode, ReferenceKind, ReferenceTracker, TraceMap, TrackedReference, get_string_if_constant};
use semver::Range;
use std::sync::OnceLock;

/// Since which versions of Node.js something is there, the latest first.
pub(crate) struct Info {
    pub(crate) supported: &'static [[u16; 3]],
    /// `versionsToString(supported)`
    pub(crate) supported_text: &'static str,
    pub(crate) experimental: &'static [[u16; 3]],
    pub(crate) experimental_text: &'static str,
}

/// With indices into [`data::INFOS`].
pub(crate) type Map = TraceMap<'static, u16>;
type Members = &'static [(&'static str, Map)];

pub(crate) const NOT_EXPERIMENTAL_TILL: Message = Message::new(
    "not-experimental-till",
    "The '{{name}}' is not an experimental feature until Node.js {{experimental}}. The configured version range is '{{version}}'.",
);
pub(crate) const NOT_SUPPORTED_TILL: Message = Message::new(
    "not-supported-till",
    "The '{{name}}' is still an experimental feature and is not supported until Node.js {{supported}}. The configured version range is '{{version}}'.",
);
pub(crate) const NOT_SUPPORTED_YET: Message = Message::new(
    "not-supported-yet",
    "The '{{name}}' is still an experimental feature The configured version range is '{{version}}'.",
);

/// `getVersionRange`
pub(crate) fn version_range(option: Option<&Json>) -> Option<Range> {
    Range::parse(option?.get(b"version")?.as_str().filter(|it| !it.is_empty())?)
}

/// `getConfiguredNodeVersion`, after the options of the rule.
pub(crate) fn configured_node_version(file: &File) -> Range {
    let settings = file.settings();
    let of_package = || {
        let package = file.modules()?.package_json(file.path())?;
        let engines = || Range::parse(package.get(b"engines")?.get(b"node")?.as_str()?);
        let dev_engines = || {
            let runtime = package.get(b"devEngines")?.get(b"runtime")?;
            let entries = runtime.as_array().unwrap_or(std::slice::from_ref(runtime));
            let node = entries.iter().find(|it| {
                it.get(b"name").and_then(Json::as_str) == Some(b"node") && it.get(b"version").and_then(Json::as_str).is_some()
            })?;
            Range::parse(node.get(b"version")?.as_str()?)
        };
        engines().or_else(dev_engines)
    };
    version_range(settings.get(b"n"))
        .or_else(|| version_range(settings.get(b"node")))
        .or_else(of_package)
        .unwrap_or_else(|| Range::at_least([16, 0, 0]))
}

/// `isInRange`
fn is_in_range(feature: &[[u16; 3]], requested: &Range) -> bool {
    Range::since(feature).is_some_and(|range| requested.is_subset_of(&range))
}

/// What is reported with a range of versions.
pub(crate) struct Unsupported {
    version: Range,
    /// For each of [`data::INFOS`].
    message: Vec<Option<Message>>,
}

impl Unsupported {
    fn new(version: Range, allows_experimental: bool) -> Unsupported {
        let message = data::INFOS.iter().map(|info| {
            if allows_experimental {
                if is_in_range(info.experimental, &version) {
                    return None;
                }
                if !info.experimental.is_empty() {
                    return Some(NOT_EXPERIMENTAL_TILL);
                }
            }
            if is_in_range(info.supported, &version) {
                return None;
            }
            Some(if info.supported.is_empty() { NOT_SUPPORTED_YET } else { NOT_SUPPORTED_TILL })
        });
        Unsupported {
            message: message.collect(),
            version,
        }
    }

    fn has(&self, map: &Map, seen: &mut Vec<*const (&'static str, Map)>) -> bool {
        if [map.read, map.call, map.construct].into_iter().flatten().any(|info| self.message[info as usize].is_some()) {
            return true;
        }
        // Some refer to themselves.
        if map.members.is_empty() || seen.contains(&map.members.as_ptr()) {
            return false;
        }
        seen.push(map.members.as_ptr());
        map.members.iter().any(|it| self.has(&it.1, seen))
    }

    /// Those of `members` in which something is reported.
    fn filter(&self, members: Members) -> Vec<(&'static str, Map)> {
        members.iter().filter(|it| self.has(&it.1, &mut Vec::new())).copied().collect()
    }
}

/// The options of a rule, and what follows from them.
pub(crate) struct Builtins {
    globals: Members,
    modules: Members,
    import_meta: Members,
    version: Option<Range>,
    ignores: Vec<Box<[u8]>>,
    allows_experimental: bool,
    /// For the first range of versions that was asked for: that of the options, or else what the first file has.
    first: OnceLock<Tables>,
}

struct Tables {
    unsupported: Unsupported,
    globals: Vec<(&'static str, Map)>,
    modules: Vec<(&'static str, Map)>,
    import_meta: Vec<(&'static str, Map)>,
}

impl Builtins {
    pub(crate) fn new(options: &Options, globals: Members, modules: Members, import_meta: Members) -> Builtins {
        Builtins {
            globals,
            modules,
            import_meta,
            version: version_range(options.get(0)),
            ignores: options.object(0).strings("ignores").iter().map(|it| it.as_bytes().into()).collect(),
            allows_experimental: options.object(0).bool_or("allowExperimental", false),
            first: OnceLock::new(),
        }
    }

    fn tables(&self, version: Range) -> Tables {
        let unsupported = Unsupported::new(version, self.allows_experimental);
        Tables {
            globals: unsupported.filter(self.globals),
            modules: unsupported.filter(self.modules),
            import_meta: unsupported.filter(self.import_meta),
            unsupported,
        }
    }

    /// Calls `then` with the tables for the file.
    fn with_tables<'a>(&self, file: &'a File<'a>, then: impl FnOnce(&Tables)) {
        let version = || self.version.clone().unwrap_or_else(|| configured_node_version(file));
        let first = self.first.get_or_init(|| self.tables(version()));
        if self.version.is_some() {
            return then(first);
        }
        let version = version();
        match version.raw == first.unsupported.version.raw {
            true => then(first),
            false => then(&self.tables(version)),
        }
    }

    /// `checkUnsupportedBuiltinReferences`. `prefix`: what comes before the path.
    fn report<'a, 'm, R: Rule>(&self, tables: &Tables, prefix: &[&'m str], references: &[TrackedReference<'a, 'm, u16>], cx: &Cx<'a, R>) {
        for reference in references {
            let Some(message) = tables.unsupported.message.get(reference.info as usize).copied().flatten() else {
                continue;
            };
            let path: Vec<&str> = prefix.iter().chain(&reference.path).copied().collect();
            let name = path.join(".");
            let name = name.strip_prefix("node:").unwrap_or(&name);
            if self.ignores.iter().any(|it| **it == *name.as_bytes()) {
                continue;
            }
            let info = &data::INFOS[reference.info as usize];
            cx.report(reference.span, message)
                .data("name", name.to_owned())
                .data("experimental", info.experimental_text)
                .data("supported", info.supported_text)
                .data("version", tables.unsupported.version.raw.clone());
        }
    }

    /// `checkUnsupportedBuiltins`, and what `node-builtins` does about `import.meta`.
    pub(crate) fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>) {
        const GET_BUILTIN_MODULE: TraceMap<'static, ()> =
            TraceMap::new(&[("process", TraceMap::new(&[("getBuiltinModule", TraceMap::EMPTY.call(()))]))]);
        let file = cx.file();
        self.with_tables(file, |tables| {
            let tracker = ReferenceTracker::new(file).with_mode(Mode::Legacy);
            if !tables.modules.is_empty() {
                let modules = TraceMap::new(&tables.modules);
                if file.mentions("require") {
                    self.report(tables, &[], &tracker.iterate_cjs_references(&modules), cx);
                }
                let get_builtin_module = match file.mentions("getBuiltinModule") {
                    true => tracker.iterate_global_references(&GET_BUILTIN_MODULE),
                    false => Vec::new(),
                };
                for found in get_builtin_module {
                    let (Some(node), Some(call)) = (found.expr(), found.call()) else {
                        continue;
                    };
                    let Some(key) = call.args().first().and_then(|it| get_string_if_constant(it, None)) else {
                        continue;
                    };
                    let Some((key, next)) = tables.modules.iter().find(|it| it.0.as_bytes() == &key[..]) else {
                        continue;
                    };
                    if let Some(info) = next.read {
                        let read = TrackedReference {
                            node: found.node,
                            span: found.span,
                            path: smallvec::SmallVec::new(),
                            kind: ReferenceKind::Read,
                            info,
                        };
                        self.report(tables, &[key], std::slice::from_ref(&read), cx);
                    }
                    self.report(tables, &[key], &tracker.iterate_property_references(node, next), cx);
                }
                self.report(tables, &[], &tracker.iterate_esm_references(&modules), cx);
            }
            let globals: Vec<(&'static str, Map)> = tables.globals.iter().filter(|it| file.mentions(it.0)).copied().collect();
            if !globals.is_empty() {
                self.report(tables, &[], &tracker.iterate_global_references(&TraceMap::new(&globals)), cx);
            }
            if !tables.import_meta.is_empty() {
                let (tracker, map) = (ReferenceTracker::new(file), TraceMap::new(&tables.import_meta));
                for e in file.exprs_of_kind(ExprTag::ImportMeta) {
                    self.report(tables, &["import.meta"], &tracker.iterate_property_references(e, &map), cx);
                }
            }
        });
    }
}
