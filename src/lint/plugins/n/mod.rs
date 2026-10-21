//! Code shared by the `n/no-unsupported-features/*` rules.

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

/// The Node.js versions that added something, as parts of [`data::VERSIONS`], latest first.
pub(crate) struct Info {
    pub(crate) supported: Part,
    pub(crate) experimental: Part,
}

fn versions(part: Part) -> &'static [[u8; 3]] {
    data::VERSIONS.get(part.range()).unwrap_or_default()
}

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

/// Its infos are indices into [`data::INFOS`].
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

/// `getConfiguredNodeVersion`'s result if nothing is configured.
pub(crate) const DEFAULT_NODE_VERSION: &[u8] = b">=16.0.0";

/// `getConfiguredNodeVersion`, without the part that reads the rule's options. `parse` is `new Range(text)` and returns
/// `None` where that throws. Returns `None` where upstream falls back to [`DEFAULT_NODE_VERSION`].
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

fn is_in_range(feature: &[[u8; 3]], requested: &Range) -> bool {
    Range::since(feature).is_some_and(|range| requested.is_subset_of(&range))
}

/// The messages to report for a given range of versions.
pub(crate) struct Unsupported {
    version: Range,
    /// The message for each entry of [`data::INFOS`], if it's reported.
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

    /// The message for a reference with this info.
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

    /// Adds the names of `member`'s direct and nested members that are reported.
    fn add_reported(
        &self,
        member: &Member,
        seen: &mut Vec<*const Member>,
        names: &mut Vec<&'static str>,
    ) {
        let members = member.members();
        // Some members contain themselves.
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

    /// The entries of `members` that are reported or have a reported member.
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
    /// True if a reference to it is reported.
    is_reported: bool,
    /// [`mention_bit`] of the names of its reported members.
    reported: Vec<u32>,
}

/// The entries that the file mentions together with one of their reported members. Tracking references costs far more,
/// so it's only done for these.
fn mentioned_in<'a>(file: &'a File<'a>, entries: &[Entry]) -> Roots<data::Builtin> {
    let named = entries.iter().filter(|it| is_mentioned_in(file, it));
    Roots(named.map(|it| it.member).collect())
}

fn is_mentioned_in(file: &File, entry: &Entry) -> bool {
    // `export * from "os"` uses all of `os`.
    file.mentions_bit(entry.bit)
        && (entry.is_reported
            || file.has_stmts([StmtTag::ExportStar])
            || entry.reported.iter().any(|it| file.mentions_bit(*it)))
}

/// A rule's options, and the tables derived from them.
pub(crate) struct Builtins {
    globals: Part,
    modules: Part,
    import_meta: Part,
    /// The `version` option, verbatim.
    version: Option<Vec<u8>>,
    ignores: Vec<Box<[u8]>>,
    allows_experimental: bool,
    /// A cache of the tables per version range, keyed by the range's text. `None` if the text isn't a valid range.
    known: [OnceLock<(Box<[u8]>, Option<Tables>)>; 8],
}

/// The tables for a file, either from [`Builtins::known`] or built just for it.
enum Found<'s> {
    Known(&'s Tables),
    Own(Box<Tables>),
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
            version: version_range(options.get(0)).map(|it| it.raw),
            ignores: options
                .object(0)
                .strings("ignores")
                .iter()
                .map(|it| it.as_bytes().into())
                .collect(),
            allows_experimental: options.object(0).bool_or("allowExperimental", false),
            known: Default::default(),
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

    /// The tables for the version range `text`, if it's a valid range.
    fn tables_for(&self, text: &[u8]) -> Option<Found<'_>> {
        let tables = || Range::parse(text).map(|it| self.tables(it));
        for known in &self.known {
            let (range, found) = known.get_or_init(|| (text.into(), tables()));
            if **range == *text {
                return found.as_ref().map(Found::Known);
            }
        }
        tables().map(|it| Found::Own(Box::new(it)))
    }

    /// Calls `then` with the tables for the file.
    fn with_tables<'a>(&self, file: &'a File<'a>, then: impl FnOnce(&Tables)) {
        let found = match &self.version {
            Some(version) => self.tables_for(version),
            None => configured_node_version_as(file, |text| self.tables_for(text))
                .or_else(|| self.tables_for(DEFAULT_NODE_VERSION)),
        };
        match found {
            Some(Found::Known(tables)) => then(tables),
            Some(Found::Own(tables)) => then(&tables),
            None => {}
        }
    }

    /// True if the file mentions something that can be reported. If not, the rule has nothing to do.
    pub(crate) fn has_candidates<'a>(&self, file: &'a File<'a>) -> bool {
        let mut has_candidates = false;
        self.with_tables(file, |tables| {
            let all = tables
                .globals
                .iter()
                .chain(&tables.modules)
                .chain(&tables.import_meta);
            has_candidates = all.into_iter().any(|it| is_mentioned_in(file, it));
        });
        has_candidates
    }

    /// `checkUnsupportedBuiltinReferences`. `prefix` is prepended to each path.
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
            let mut irregular_texts = data::WRITTEN_OTHERWISE.iter();
            let supported = match irregular_texts.find(|it| it.0 == reference.info) {
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
            let modules = mentioned_in(file, &tables.modules);
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
            let globals = mentioned_in(file, &tables.globals);
            if !globals.0.is_empty() {
                self.report(
                    tables,
                    &[],
                    &tracker.iterate_global_references(&globals),
                    cx,
                );
            }
            let import_meta = if file.mentions("meta") {
                mentioned_in(file, &tables.import_meta)
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
