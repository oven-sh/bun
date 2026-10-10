//! What the rules `n/no-unsupported-features/*` share.

pub(crate) mod data;
pub(crate) mod es_syntax;
pub(crate) mod es_syntax_data;
pub(crate) mod object_type;
pub(crate) mod semver;
pub(crate) mod table;

use bun_lint::prelude::*;
use bun_lint::source::mention_bit;
use bun_lint::utils::eslint_utils::{
    Mode, ReferenceKind, ReferenceTracker, Trace, TraceMap, TrackedReference,
    get_string_if_constant,
};
use semver::Range;
use std::fmt::Write;
use std::sync::OnceLock;
use table::{Part, Roots};

/// Since which versions of Node.js something is there: parts of [`data::VERSIONS`], the latest first.
pub(crate) struct Info {
    pub(crate) supported: Part,
    pub(crate) experimental: Part,
}

fn versions(part: Part) -> &'static [[u8; 3]] {
    data::VERSIONS.get(part.range()).unwrap_or_default()
}

/// `versionsToString`
fn versions_to_string(versions: &[[u8; 3]]) -> String {
    let mut text = String::new();
    for (index, [a, b, c]) in versions.iter().enumerate() {
        let before = match index {
            0 => "",
            1 => " (backported: ^",
            _ => ", ^",
        };
        _ = write!(text, "{before}{a}.{b}.{c}");
    }
    if versions.len() > 1 {
        text.push(')');
    }
    text
}

/// With indices into [`data::INFOS`].
type Member = table::Member<data::Builtin>;

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

fn version_text(option: Option<&Json>) -> Option<&[u8]> {
    option?
        .get(b"version")?
        .as_str()
        .filter(|it| !it.is_empty())
}

/// `getVersionRange`
pub(crate) fn version_range(option: Option<&Json>) -> Option<Range> {
    Range::parse(version_text(option)?)
}

/// `getConfiguredNodeVersion`, after the options of the rule.
pub(crate) fn configured_node_version(file: &File) -> Range {
    configured_node_version_as(file, Range::parse).unwrap_or_else(|| Range::at_least([16, 0, 0]))
}

/// The same with `parse` for `new Range(text)`, which is `None` where that throws. `None`: `>=16.0.0`.
pub(crate) fn configured_node_version_as<T>(
    file: &File,
    mut parse: impl FnMut(&[u8]) -> Option<T>,
) -> Option<T> {
    let settings = file.settings();
    for name in [&b"n"[..], b"node"] {
        if let Some(found) = version_text(settings.get(name)).and_then(&mut parse) {
            return Some(found);
        }
    }
    let package = file.modules()?.package_json(file.path())?;
    let engines = package
        .get(b"engines")
        .and_then(|it| it.get(b"node")?.as_str());
    if let Some(found) = engines.and_then(&mut parse) {
        return Some(found);
    }
    let runtime = package.get(b"devEngines")?.get(b"runtime")?;
    let entries = runtime
        .as_array()
        .unwrap_or_else(|| std::slice::from_ref(runtime));
    let node = entries.iter().find(|it| {
        it.get(b"name").and_then(Json::as_str) == Some(b"node")
            && it.get(b"version").and_then(Json::as_str).is_some()
    })?;
    parse(node.get(b"version")?.as_str()?)
}

/// `isInRange`
fn is_in_range(feature: &[[u8; 3]], requested: &Range) -> bool {
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
            let (supported, experimental) = (versions(info.supported), versions(info.experimental));
            if allows_experimental {
                if is_in_range(experimental, &version) {
                    return None;
                }
                if !experimental.is_empty() {
                    return Some(NOT_EXPERIMENTAL_TILL);
                }
            }
            if is_in_range(supported, &version) {
                return None;
            }
            Some(if supported.is_empty() {
                NOT_SUPPORTED_YET
            } else {
                NOT_SUPPORTED_TILL
            })
        });
        Unsupported {
            message: message.collect(),
            version,
        }
    }

    /// What is said about a use with this info.
    fn message_of(&self, info: u16) -> Option<Message> {
        self.message.get(usize::from(info)).copied().flatten()
    }

    fn is_reported(&self, member: &Member) -> bool {
        const KINDS: [ReferenceKind; 3] = [
            ReferenceKind::Read,
            ReferenceKind::Call,
            ReferenceKind::Construct,
        ];
        let mut infos = KINDS.into_iter().filter_map(|kind| member.info(kind));
        infos.any(|info| self.message_of(info).is_some())
    }

    /// Adds the names of the members of `member`, and of theirs, that are reported.
    fn add_reported(
        &self,
        member: &Member,
        seen: &mut Vec<*const Member>,
        names: &mut Vec<&'static str>,
    ) {
        let members = member.members();
        // Some refer to themselves.
        if members.is_empty() || seen.contains(&members.as_ptr()) {
            return;
        }
        seen.push(members.as_ptr());
        for member in members {
            if self.is_reported(member) && !names.contains(&member.name()) {
                names.push(member.name());
            }
            self.add_reported(member, seen, names);
        }
    }

    /// Those of `members` in which something is reported.
    fn filter(&self, members: Part) -> Vec<Entry> {
        let entries = members.members::<data::Builtin>().iter().map(|member| {
            let mut reported = Vec::new();
            self.add_reported(member, &mut Vec::new(), &mut reported);
            Entry {
                member,
                bit: mention_bit(member.name().as_bytes()),
                is_reported: self.is_reported(member),
                reported: reported
                    .iter()
                    .map(|it| mention_bit(it.as_bytes()))
                    .collect(),
            }
        });
        entries
            .filter(|it| it.is_reported || !it.reported.is_empty())
            .collect()
    }
}

/// A global variable or a module.
struct Entry {
    member: &'static Member,
    /// [`mention_bit`] of the name.
    bit: u32,
    /// To refer to it is reported.
    is_reported: bool,
    /// [`mention_bit`] of the names of what is reported in it.
    reported: Vec<u32>,
}

/// Those that the file mentions, with something in them that is reported. References, which cost far more, are only looked at for
/// these.
fn named_in<'a>(file: &'a File<'a>, entries: &[Entry]) -> Roots<data::Builtin> {
    let named = entries.iter().filter(|it| is_named_in(file, it));
    Roots(named.map(|it| it.member).collect())
}

fn is_named_in(file: &File, entry: &Entry) -> bool {
    file.mentions_bit(entry.bit)
        && (entry.is_reported || entry.reported.iter().any(|it| file.mentions_bit(*it)))
}

/// The options of a rule, and what follows from them.
pub(crate) struct Builtins {
    globals: Part,
    modules: Part,
    import_meta: Part,
    version: Option<Range>,
    ignores: Vec<Box<[u8]>>,
    allows_experimental: bool,
    /// For the first range of versions that was asked for: that of the options, or else what the first file has.
    first: OnceLock<Tables>,
}

struct Tables {
    unsupported: Unsupported,
    globals: Vec<Entry>,
    modules: Vec<Entry>,
    import_meta: Vec<Entry>,
}

impl Builtins {
    pub(crate) fn new(
        options: &Options,
        globals: Part,
        modules: Part,
        import_meta: Part,
    ) -> Builtins {
        Builtins {
            globals,
            modules,
            import_meta,
            version: version_range(options.get(0)),
            ignores: options
                .object(0)
                .strings("ignores")
                .iter()
                .map(|it| it.as_bytes().into())
                .collect(),
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
        let version = || {
            self.version
                .clone()
                .unwrap_or_else(|| configured_node_version(file))
        };
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

    /// Whether the file mentions something that can be reported. If not, there is nothing to do for the rule.
    pub(crate) fn has_candidates<'a>(&self, file: &'a File<'a>) -> bool {
        let mut has_candidates = false;
        self.with_tables(file, |tables| {
            let all = tables
                .globals
                .iter()
                .chain(&tables.modules)
                .chain(&tables.import_meta);
            has_candidates = all.into_iter().any(|it| is_named_in(file, it));
        });
        has_candidates
    }

    /// `checkUnsupportedBuiltinReferences`. `prefix`: what comes before the path.
    fn report<'a, 'm, R: Rule>(
        &self,
        tables: &Tables,
        prefix: &[&'m str],
        references: &[TrackedReference<'a, 'm>],
        cx: &Cx<'a, R>,
    ) {
        for reference in references {
            let (Some(message), Some(info)) = (
                tables.unsupported.message_of(reference.info),
                data::INFOS.get(usize::from(reference.info)),
            ) else {
                continue;
            };
            let path: Vec<&str> = prefix.iter().chain(&reference.path).copied().collect();
            let name = path.join(".");
            let name = name.strip_prefix("node:").unwrap_or(&name);
            if self.ignores.iter().any(|it| **it == *name.as_bytes()) {
                continue;
            }
            let mut written_otherwise = data::WRITTEN_OTHERWISE.iter();
            let supported = match written_otherwise.find(|it| it.0 == reference.info) {
                Some(found) => found.1.to_owned(),
                None => versions_to_string(versions(info.supported)),
            };
            cx.report(reference.span, message)
                .data("name", name.to_owned())
                .data(
                    "experimental",
                    versions_to_string(versions(info.experimental)),
                )
                .data("supported", supported)
                .data("version", tables.unsupported.version.raw.clone());
        }
    }

    /// `checkUnsupportedBuiltins`, and what `node-builtins` does about `import.meta`.
    pub(crate) fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>) {
        const GET_BUILTIN_MODULE: TraceMap<'static, ()> = TraceMap::new(&[(
            "process",
            TraceMap::new(&[("getBuiltinModule", TraceMap::EMPTY.call(()))]),
        )]);
        let file = cx.file();
        self.with_tables(file, |tables| {
            let tracker = ReferenceTracker::new(file).with_mode(Mode::Legacy);
            let modules = named_in(file, &tables.modules);
            if !modules.0.is_empty() {
                let modules: &dyn Trace<'_> = &modules;
                if file.mentions("require") {
                    self.report(tables, &[], &tracker.iterate_cjs_references(modules), cx);
                }
                let get_builtin_module = match file.mentions("getBuiltinModule") {
                    true => tracker.iterate_global_references(&GET_BUILTIN_MODULE),
                    false => Vec::new(),
                };
                for found in get_builtin_module {
                    let (Some(node), Some(call)) = (found.expr(), found.call()) else {
                        continue;
                    };
                    let Some(key) = call
                        .args()
                        .first()
                        .and_then(|it| get_string_if_constant(it, None))
                    else {
                        continue;
                    };
                    let Some((key, next)) = modules.get(&key) else {
                        continue;
                    };
                    if let Some(info) = next.info(ReferenceKind::Read) {
                        let read = TrackedReference {
                            node: found.node,
                            span: found.span,
                            path: smallvec::SmallVec::new(),
                            kind: ReferenceKind::Read,
                            info,
                        };
                        self.report(tables, &[key], std::slice::from_ref(&read), cx);
                    }
                    self.report(
                        tables,
                        &[key],
                        &tracker.iterate_property_references(node, next),
                        cx,
                    );
                }
                self.report(tables, &[], &tracker.iterate_esm_references(modules), cx);
            }
            let globals = named_in(file, &tables.globals);
            if !globals.0.is_empty() {
                self.report(
                    tables,
                    &[],
                    &tracker.iterate_global_references(&globals),
                    cx,
                );
            }
            let import_meta = if file.mentions("meta") {
                named_in(file, &tables.import_meta)
            } else {
                Roots(Vec::new())
            };
            if !import_meta.0.is_empty() {
                let tracker = ReferenceTracker::new(file);
                for e in file.exprs_of_kind(ExprTag::ImportMeta) {
                    self.report(
                        tables,
                        &["import.meta"],
                        &tracker.iterate_property_references(e, &import_meta),
                        cx,
                    );
                }
            }
        });
    }
}
