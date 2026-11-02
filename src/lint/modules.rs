//! The module graph, for rules that need to know about other files.
//!
//! Each file is parsed, linted and freed before the next one, so a rule can't look into another file. Everything it can
//! query is in [`Modules`], which the driver provides through [`File::modules`]. The graph is built in two steps so
//! that no file is parsed twice for it:
//! 1. While the files are linted, [`Modules::is_complete`] is false. The rule can't report anything yet. It
//!    [records](Modules::record) the file's imports, which are resolved immediately on the thread that lints the file.
//! 2. Once all files are linted, the imported files that aren't linted themselves are read, and the strongly connected
//!    components are computed. Then the few files that the rule may report something in are linted again with only such
//!    rules, and [`Modules::is_complete`] is true.
//!
//! The graph is modeled on eslint-plugin-import's `ExportMap.imports` or on oxlint's module records, depending on the
//! [`Flavor`].

use crate::ast::{ExprKind, ExprTag, File, Name, StmtKind};
use crate::language::LanguageOptions;
use crate::options::Json;
use crate::span::Span;
use bun_core::strings;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::any::Any;
use std::borrow::Cow;

/// The tool whose definition of a module's imports is followed. It's the same for every file of a run.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Flavor {
    EslintPluginImport,
    Oxlint,
}

impl Flavor {
    /// oxlint doesn't count `import("m")` as an import.
    pub fn ignores_dynamic_imports(self) -> bool {
        self == Flavor::Oxlint
    }

    /// oxlint resolves like Node.js, and tries JavaScript extensions before TypeScript ones. For `./a.js` it also finds
    /// `./a.ts` but not `./a.tsx`, and for `./a` it doesn't find `./a.d.ts`.
    pub fn resolves_as_node(self) -> bool {
        self == Flavor::Oxlint
    }

    /// For oxlint a module that imports itself is a cycle.
    pub fn counts_self_imports(self) -> bool {
        self == Flavor::Oxlint
    }
}

/// A file in the graph: a linted file, or one that a linted file imports directly or transitively.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ModuleId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RequestKind {
    /// `import .. from "m"`, `export .. from "m"`
    Static,
    /// `import("m")`
    Dynamic,
    /// Anything else that a rule needs resolved and read, like `require("m")`. The module doesn't count as imported.
    Other,
}

/// One module specifier in a file.
#[derive(Copy, Clone, Debug)]
pub struct Request<'a> {
    pub specifier: &'a [u8],
    /// The specifier's span.
    pub span: Span,
    /// The 1-based line the specifier starts on. Not set with [`Flavor::Oxlint`].
    pub line: u32,
    pub kind: RequestKind,
    /// `import type`, `import { type A, type B }`, `export type * from`. What else counts depends on the [`Flavor`].
    pub is_only_importing_types: bool,
    /// With [`Flavor::Oxlint`]: true if a statement with this specifier re-exports names, as in `export { a } from
    /// "m"`, `export * as a from "m"`, or `import { a } from "m"` together with `export { a }`. If `"m"` is the module
    /// itself, that doesn't count as a self-import.
    pub may_reexport_itself: bool,
}

/// A [`Request`] whose module has been resolved.
#[derive(Clone, Debug)]
pub struct Declaration {
    pub specifier: Box<[u8]>,
    pub line: u32,
    pub is_dynamic: bool,
    pub is_only_importing_types: bool,
}

/// All of a module's imports of one other module.
#[derive(Clone, Debug)]
pub struct Import {
    pub module: ModuleId,
    pub declarations: SmallVec<[Declaration; 1]>,
}

#[derive(Copy, Clone, Debug)]
pub struct Resolved {
    pub module: ModuleId,
    /// True if it was found in a `node_modules`, even if that entry is a symbolic link to somewhere else.
    pub is_external: bool,
}

/// The parts of another file's module record that oxlint's rules read: its top-level imports and exports, without
/// spans.
#[derive(Clone, Debug, Default)]
pub struct Record {
    /// True if it has an `import`, an `export` or an `import.meta`.
    pub has_module_syntax: bool,
    pub has_export_default: bool,
    /// The names of its own exports. Sorted, without duplicates.
    pub exported_bindings: Box<[Box<[u8]>]>,
    pub import_entries: Box<[ImportEntry]>,
    /// `export { a } from "m"`, `export * as a from "m"`, and `export { a }` where `a` is imported.
    pub indirect_export_entries: Box<[IndirectExportEntry]>,
    /// The specifier of each `export * from "m"`.
    pub star_export_entries: Box<[Box<[u8]>]>,
}

#[derive(Clone, Debug)]
pub struct ImportEntry {
    pub module_request: Box<[u8]>,
    pub import_name: ImportName,
    pub local_name: Box<[u8]>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ImportName {
    Name(Box<[u8]>),
    NamespaceObject,
    Default,
}

#[derive(Clone, Debug)]
pub struct IndirectExportEntry {
    pub module_request: Box<[u8]>,
    /// `None` for `export * as a from "m"`.
    pub import_name: Option<Box<[u8]>>,
    pub export_name: Box<[u8]>,
}

/// Builds a file's [`Record`].
pub type MakeRecord = for<'a> fn(&'a File<'a>) -> Record;

/// One of eslint-plugin-import's resolvers.
#[derive(Clone, Debug)]
pub enum Lookup<'e> {
    /// eslint-import-resolver-typescript, with its `project` option verbatim.
    TypeScript(SmallVec<[&'e [u8]; 1]>),
    /// eslint-import-resolver-node, with its `extensions`.
    Node(SmallVec<[&'e [u8]; 4]>),
    /// The same, with `paths` (verbatim) and `moduleDirectory`.
    NodeWith {
        extensions: SmallVec<[&'e [u8]; 4]>,
        paths: SmallVec<[&'e [u8]; 2]>,
        module_directories: SmallVec<[&'e [u8]; 1]>,
    },
}

/// A file found by [`Modules::list_files`].
pub struct Listed {
    /// Absolute.
    pub path: Vec<u8>,
    pub is_ignored: bool,
}

/// [`Modules::list_files`]
pub type ListFiles<'h> =
    Box<dyn Fn(&[&[u8]], &[&[u8]]) -> Result<Vec<Listed>, Vec<u8>> + Send + Sync + 'h>;

/// Takes the importing file's path, the specifier, and whether it's in a `require`. Returns the resolved path.
pub type Resolve = Box<dyn Fn(&dyn Modules, &[u8], &[u8], bool) -> Option<Vec<u8>> + Send + Sync>;

/// [`Modules::resolve_by`]
pub struct ResolveBy {
    pub resolve: Resolve,
    /// Takes a path and that file's text. Returns false if the file's imports are unknown, in which case it's treated
    /// as importing nothing.
    pub is_known: Box<dyn Fn(&[u8], &[u8]) -> bool + Send + Sync>,
}

/// How a plugin reads a file other than the one being linted.
#[derive(Copy, Clone)]
pub struct Reader {
    /// Returns true if a file with this text should be parsed at all.
    pub should_parse: fn(&[u8]) -> bool,
    pub read: for<'a> fn(&'a File<'a>) -> Box<dyn Any + Send + Sync>,
}

pub trait Modules: Sync {
    /// True once the graph is complete. Until then only [`Modules::record`] has an effect.
    fn is_complete(&self) -> bool;

    /// Records the imports of the file at `path`. A later call for the same path overwrites an earlier one.
    ///
    /// With `is_always_checked`, the file is linted again whatever it imports. Otherwise it's linted again only if it's
    /// in a cycle of modules that import values from each other. Passing true in any one call is enough.
    fn record(&self, path: &[u8], requests: &[Request], is_always_checked: bool, flavor: Flavor);

    /// With [`Flavor::EslintPluginImport`]: sets how specifiers are resolved, both in the linted files and in the files
    /// they import, according to the resolvers in the settings. Call it before [`Modules::record`]. `make` is only
    /// called if no resolver has been set yet.
    fn resolve_by(&self, make: &dyn Fn() -> ResolveBy);

    /// Stores `make(file)` as the [`Record`] of the linted file `file`, unless it's already stored. `make` also builds
    /// the records of files that aren't linted, including those in a `node_modules`.
    fn record_exports<'a>(&self, file: &'a File<'a>, make: MakeRecord);

    /// From now on, also follow the imports of files in a `node_modules`, as oxlint does. Otherwise only their
    /// re-exports are followed.
    fn follow_packages(&self);

    /// `None` if the module isn't JavaScript or TypeScript, if it can't be read or parsed, or if nothing has called
    /// [`Modules::record_exports`].
    fn record_of(&self, module: ModuleId) -> Option<&Record>;

    /// Looks up the file at `path`.
    fn find(&self, path: &[u8]) -> Option<ModuleId>;

    /// Resolves `specifier` from the file at `from` the way TypeScript does, or else the way the [`Flavor`] does.
    /// `None` if there's no such file.
    fn resolve(&self, from: &[u8], specifier: &[u8], is_require: bool) -> Option<Resolved>;

    /// The module's absolute path. With [`Flavor::Oxlint`], symbolic links are resolved.
    fn path(&self, module: ModuleId) -> &[u8];

    /// True if `path`, the path a file is linted under, is `module`'s real path and not a link to it.
    fn is_path_of(&self, module: ModuleId, path: &[u8]) -> bool;

    /// The module's imports in eslint-plugin-import's order, which puts dynamic imports first. Empty if the module
    /// isn't JavaScript or TypeScript, is in a `node_modules`, or can't be read.
    fn imports(&self, module: ModuleId) -> &[Import];

    /// The module's strongly connected component. Two modules get the same number if each imports values from the
    /// other, directly or transitively.
    fn component(&self, module: ModuleId) -> u32;

    /// Resolves `specifier` from the file at `from` to an absolute path with `/` separators. Can be called at any time.
    /// As in eslint-import-resolver-node, a file found through a relative entry of [`Lookup::NodeWith`]'s `paths` is
    /// returned relative to the working directory.
    fn resolve_file(
        &self,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
        lookup: &Lookup,
    ) -> Option<Vec<u8>>;

    /// The working directory, in the same form.
    fn cwd(&self) -> &[u8];

    /// True if there's a file or directory at `path`. Can be called at any time.
    fn exists(&self, path: &[u8]) -> bool;

    /// The text of the file at `path`, decoded according to its byte order mark. UTF-16 is converted to UTF-8, and the
    /// mark itself is dropped. Can be called at any time.
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>>;

    /// `Array.from(new FileEnumerator({ extensions }).iterateFiles(patterns))` in ESLint 8 and 9, run from the working
    /// directory. It always uses ESLint 8's config files, whatever config the run itself uses. Returns `Err` with the
    /// message of the error it throws. Can be called at any time.
    fn list_files(&self, patterns: &[&[u8]], extensions: &[&[u8]]) -> Result<Vec<Listed>, Vec<u8>>;

    /// The result of `reader.read` on the file at `path`, which is read like [`Modules::read`] and parsed according to
    /// `language`. It's computed on first use and cached by the path and the parts of `language` that affect parsing.
    /// Every caller must pass the same `reader`. `None` if the file can't be read, `reader.should_parse` returns false,
    /// or the code is nested too deeply. Can be called at any time.
    fn facts(
        &self,
        path: &[u8],
        language: &LanguageOptions,
        reader: &Reader,
    ) -> Option<&(dyn Any + Send + Sync)>;

    /// The literal `esModuleInterop` value in the `tsconfig.json` closest to `directory`, or in one that it extends.
    /// Can be called at any time.
    fn es_module_interop(&self, directory: &[u8]) -> bool;

    /// The closest `package.json` to the file at `path` whose content is an object. Can be called at any time.
    fn package_json(&self, path: &[u8]) -> Option<&Json>;
}

impl<'a> File<'a> {
    /// The module graph. `None` if the file is linted on its own, in which case a rule that needs the graph reports
    /// nothing.
    #[inline]
    pub fn modules(&self) -> Option<&'a dyn Modules> {
        self.sink.has_requested_modules.set(true);
        self.modules.get()
    }

    pub fn set_modules(&self, modules: &'a dyn Modules) {
        self.modules.set(Some(modules));
    }
}

/// A module's imports: every `import("m")`, then the top-level `import`s and `export .. from`s. That's
/// eslint-plugin-import's order.
pub fn requests_of<'a>(file: &'a File<'a>, flavor: Flavor) -> Vec<Request<'a>> {
    // `line` holds the offset until `set_lines` replaces it.
    let mut requests = Vec::new();
    let has_dynamic_imports =
        !flavor.ignores_dynamic_imports() && may_have_import_call(file.text());
    for e in has_dynamic_imports
        .then(|| file.exprs_of_kind(ExprTag::ImportCall))
        .into_iter()
        .flatten()
    {
        if let ExprKind::ImportCall { args } = e.kind()
            && let Some(source) = args.first()
            && let Some(specifier) = source.as_string()
        {
            requests.push(Request {
                specifier: specifier.bytes(),
                span: source.span(),
                line: source.span().start,
                kind: RequestKind::Dynamic,
                is_only_importing_types: false,
                may_reexport_itself: false,
            });
        }
    }
    crate::utils::sort::sort_unstable_by_key(&mut requests, |it| it.line);
    match flavor {
        Flavor::EslintPluginImport => {
            add_static_requests(file, &mut requests);
            set_lines(file.text(), &mut requests);
        }
        // Nothing reads the lines with this flavor.
        Flavor::Oxlint => add_oxlint_static_requests(file, &mut requests),
    }
    requests
}

/// True if some `import` in `text` is followed by something other than a name, a string, a `{` or a `*`. Scanning the
/// text is far cheaper than building the index of expressions by kind, and few files have an `import()`.
pub fn may_have_import_call(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = strings::index_of(rest, b"import") {
        rest = &rest[at + 6..];
        if matches!(rest.trim_ascii_start().first(), Some(b'(' | b'.' | b'/')) {
            return true;
        }
    }
    false
}

fn add_static_requests<'a>(file: &'a File<'a>, requests: &mut Vec<Request<'a>>) {
    for stmt in file.body() {
        let (specifier, is_only_importing_types) = match stmt.kind() {
            StmtKind::Import(import) => {
                let has_values = import.default().is_some() || import.namespace().is_some();
                let named = import.named();
                let are_all_types =
                    !has_values && !named.is_empty() && named.iter().all(|it| it.is_type_only());
                (Some(import.spec()), import.is_type_only() || are_all_types)
            }
            // eslint-plugin-import doesn't check `exportKind` here.
            StmtKind::ExportNamed(export) => (export.spec(), false),
            StmtKind::ExportStar {
                spec, type_only, ..
            } => (spec, type_only),
            _ => continue,
        };
        if let (Some(specifier), Some(span)) = (specifier, stmt.module_specifier_span()) {
            requests.push(Request {
                specifier: specifier.bytes(),
                span,
                line: span.start,
                kind: RequestKind::Static,
                is_only_importing_types,
                may_reexport_itself: false,
            });
        }
    }
}

/// oxlint's `requested_modules`, in source order. oxlint decides whether only types are imported for all statements
/// with the same specifier together: they must import or re-export at least one name, and all of those names must be
/// types. `import "m"`, `import {} from "m"` and `export * from "m"` have no names.
fn add_oxlint_static_requests<'a>(file: &'a File<'a>, requests: &mut Vec<Request<'a>>) {
    let first = requests.len();
    // For each request: the specifier, whether the statement has names, whether any of them is a value, and whether it
    // exports them.
    let mut names: SmallVec<[(Name<'a>, bool, bool, bool); 32]> = SmallVec::new();
    let mut exported: Option<FxHashSet<Name<'a>>> = None;
    let mut is_exported = |local: Name<'a>| {
        let exported = exported.get_or_insert_with(|| {
            let exports = file.body().iter().filter_map(|stmt| match stmt.kind() {
                StmtKind::ExportNamed(export) if export.spec().is_none() => Some(export.items()),
                _ => None,
            });
            exports.flatten().map(|it| it.local().name()).collect()
        });
        exported.contains(&local)
    };
    for stmt in file.body() {
        let (specifier, types, values) = match stmt.kind() {
            StmtKind::Import(import) => {
                let whole = usize::from(import.default().is_some())
                    + usize::from(import.namespace().is_some());
                let types = import.named().iter().filter(|it| it.is_type_only()).count();
                let all = whole + import.named().len();
                (
                    Some(import.spec()),
                    if import.is_type_only() { all } else { types },
                    if import.is_type_only() {
                        0
                    } else {
                        all - types
                    },
                )
            }
            StmtKind::ExportNamed(export) => {
                let types = export.items().iter().filter(|it| it.is_type_only()).count();
                let all = export.items().len();
                (
                    export.spec(),
                    if export.is_type_only() { all } else { types },
                    if export.is_type_only() {
                        0
                    } else {
                        all - types
                    },
                )
            }
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
            } => {
                let names = usize::from(alias.is_some());
                (
                    spec,
                    if type_only { names } else { 0 },
                    if type_only { 0 } else { names },
                )
            }
            _ => continue,
        };
        if let (Some(specifier), Some(span)) = (specifier, stmt.module_specifier_span()) {
            names.push((
                specifier,
                types + values > 0,
                values > 0,
                match stmt.kind() {
                    StmtKind::Import(import) => {
                        import.default().is_some_and(|it| is_exported(it.name()))
                            || (import.named().iter()).any(|it| is_exported(it.local().name()))
                    }
                    _ => types + values > 0,
                },
            ));
            requests.push(Request {
                specifier: specifier.bytes(),
                span,
                line: span.start,
                kind: RequestKind::Static,
                is_only_importing_types: false,
                may_reexport_itself: false,
            });
        }
    }
    if !names.spilled() {
        for (request, &(specifier, ..)) in requests[first..].iter_mut().zip(&names) {
            let mut same = names.iter().filter(|it| it.0 == specifier);
            request.is_only_importing_types =
                same.clone().any(|it| it.1) && !same.clone().any(|it| it.2);
            request.may_reexport_itself = same.any(|it| it.3);
        }
        return;
    }
    // The same as above with a hash map, for a file with many requests.
    let mut by_specifier: FxHashMap<Name<'a>, (bool, bool, bool)> = FxHashMap::default();
    for &(specifier, has_names, has_values, exports_names) in &names {
        let all = by_specifier.entry(specifier).or_default();
        *all = (all.0 | has_names, all.1 | has_values, all.2 | exports_names);
    }
    for (request, (specifier, ..)) in requests[first..].iter_mut().zip(&names) {
        let (has_names, has_values, exports_names) =
            by_specifier.get(specifier).copied().unwrap_or_default();
        request.is_only_importing_types = has_names && !has_values;
        request.may_reexport_itself = exports_names;
    }
}

/// Replaces the offset stored in each [`Request::line`] with the line number. It only scans the text up to the last
/// offset, which is a small part of most files.
pub fn set_lines(text: &[u8], requests: &mut [Request]) {
    let mut order: SmallVec<[u32; 32]> = (0..requests.len() as u32).collect();
    crate::utils::sort::sort_indices_unstable(&mut order, &mut |a, b| {
        requests[a as usize].line.cmp(&requests[b as usize].line)
    });
    let (mut line, mut line_end) = (1, 0);
    for at in order {
        let offset = requests[at as usize].line as usize;
        // `line_end` is the end of the last line break found so far.
        while let Some((start, len)) = text
            .get(line_end..offset)
            .and_then(strings::find_js_line_break)
        {
            line += 1;
            line_end += start + len;
        }
        requests[at as usize].line = line;
    }
}
