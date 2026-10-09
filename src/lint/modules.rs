//! What a rule that is about several files sees of the others: which module imports which.
//!
//! A file is parsed, linted and freed before the next, so no rule can look into another file. What it can ask is in [`Modules`],
//! which whoever lints the files provides: [`File::modules`]. It is made in two steps, so that no file is parsed twice for it:
//! 1. While the files are linted, [`Modules::is_complete`] is false. The rule has nothing to report yet. It
//!    [records](Modules::record) what the file imports, which is resolved there and then, on the thread that lints the file.
//! 2. When all files are linted, the files that they import and that are not linted themselves are read, and the strongly
//!    connected components are computed. Then the files that the rule may have something to say about, which are few, are linted
//!    again with only such rules, and [`Modules::is_complete`] is true.
//!
//! The model is `ExportMap.imports` of eslint-plugin-import, or the module records of oxlint: [`Flavor`].

use crate::ast::{ExprKind, ExprTag, File, Name, StmtKind, StmtTag};
use crate::options::Json;
use crate::span::Span;
use bun_core::strings;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Whose notion of what a module imports. All files of a run have the same.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Flavor {
    EslintPluginImport,
    Oxlint,
}

impl Flavor {
    /// oxlint does not take `import("m")` for an import.
    pub fn ignores_dynamic_imports(self) -> bool {
        self == Flavor::Oxlint
    }

    /// oxlint resolves as Node.js does, with the extensions of JavaScript before those of TypeScript. For `./a.js` it also finds
    /// `./a.ts`, but not `./a.tsx`, and it finds no `./a.d.ts` for `./a`.
    pub fn resolves_as_node(self) -> bool {
        self == Flavor::Oxlint
    }

    /// For oxlint a module that imports itself is a cycle.
    pub fn counts_self_imports(self) -> bool {
        self == Flavor::Oxlint
    }
}

/// A file, among those that the files which are linted import, directly or not.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ModuleId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RequestKind {
    /// `import .. from "m"`, `export .. from "m"`
    Static,
    /// `import("m")`
    Dynamic,
    /// Anything else that a rule wants resolved and read, like `require("m")`. The module does not count as imported.
    Other,
}

/// A place where a file names a module.
#[derive(Copy, Clone, Debug)]
pub struct Request<'a> {
    pub specifier: &'a [u8],
    /// Where the specifier is.
    pub span: Span,
    /// The line that the specifier starts in, from 1. Not with [`Flavor::Oxlint`].
    pub line: u32,
    pub kind: RequestKind,
    /// `import type`, `import { type A, type B }`, `export type * from`. What else counts depends on the [`Flavor`].
    pub is_only_importing_types: bool,
    /// With [`Flavor::Oxlint`]: a statement with this specifier exports names, `export { a } from "m"` or `export * as a from "m"`.
    /// A module may do that with itself: that is no import then.
    pub may_be_itself: bool,
}

/// A [`Request`] of a module that is known.
#[derive(Clone, Debug)]
pub struct Declaration {
    pub specifier: Box<[u8]>,
    pub line: u32,
    pub is_dynamic: bool,
    pub is_only_importing_types: bool,
}

/// All the places where a module imports another.
#[derive(Clone, Debug)]
pub struct Import {
    pub module: ModuleId,
    pub declarations: SmallVec<[Declaration; 1]>,
}

#[derive(Copy, Clone, Debug)]
pub struct Resolved {
    pub module: ModuleId,
    /// It was found in a `node_modules`, where it can be a symbolic link to somewhere else.
    pub is_external: bool,
}

/// What the rules of oxlint read of the module record of another file: what it imports and exports at its top level, without the
/// places.
#[derive(Clone, Debug, Default)]
pub struct Record {
    /// It has an `import`, an `export` or an `import.meta`.
    pub has_module_syntax: bool,
    pub has_export_default: bool,
    /// The names that it exports itself. Sorted, each once.
    pub exported_bindings: Box<[Box<[u8]>]>,
    pub import_entries: Box<[ImportEntry]>,
    /// `export { a } from "m"`, `export * as a from "m"`, and `export { a }` of what is imported.
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
    /// `None`: `export * as a from "m"`.
    pub import_name: Option<Box<[u8]>>,
    pub export_name: Box<[u8]>,
}

/// Makes the [`Record`] of a file.
pub type MakeRecord = for<'a> fn(&'a File<'a>) -> Record;

/// A resolver of eslint-plugin-import.
#[derive(Clone, Debug)]
pub enum Lookup<'e> {
    /// eslint-import-resolver-typescript: as [`Modules::resolve`].
    TypeScript,
    /// eslint-import-resolver-node, with its `extensions`.
    Node(SmallVec<[&'e [u8]; 4]>),
}

pub trait Modules: Sync {
    /// Everything is known. Until then only [`Modules::record`] does something.
    fn is_complete(&self) -> bool;

    /// Takes note of what the file at `path` imports. The last time counts.
    ///
    /// `is_always_checked`: it is linted again whatever it imports. Otherwise only if it is in a cycle of modules that import
    /// values from each other. Once is enough.
    fn record(&self, path: &[u8], requests: &[Request], is_always_checked: bool, flavor: Flavor);

    /// Takes note of the [`Record`] of `file`, which is linted: `make(file)`, unless it is known. The records of the files that are
    /// not linted are made by `make` too, also of those in a `node_modules`.
    fn record_exports<'a>(&self, file: &'a File<'a>, make: MakeRecord);

    /// From now on what the files in a `node_modules` import is followed too, as in oxlint. Otherwise only what they export again.
    fn follow_packages(&self);

    /// `None` if it is not JavaScript or TypeScript, if it cannot be read or parsed, or if nothing has called
    /// [`Modules::record_exports`].
    fn record_of(&self, module: ModuleId) -> Option<&Record>;

    /// The file at `path`.
    fn find(&self, path: &[u8]) -> Option<ModuleId>;

    /// What `specifier` means in the file at `from`, as TypeScript resolves it, or else as the [`Flavor`] has it. `None` if there is
    /// no such file.
    fn resolve(&self, from: &[u8], specifier: &[u8], is_require: bool) -> Option<Resolved>;

    /// Absolute, with symbolic links followed.
    fn path(&self, module: ModuleId) -> &[u8];

    /// What it imports, in the order of eslint-plugin-import: what is imported dynamically first. Nothing if it is not JavaScript or
    /// TypeScript, if it is in a `node_modules`, or if it cannot be read.
    fn imports(&self, module: ModuleId) -> &[Import];

    /// The same number for two modules of which each imports values from the other, directly or not.
    fn component(&self, module: ModuleId) -> u32;

    /// The file that `specifier` means in the file at `from`: absolute, separated by `/`. It can be asked at any time.
    fn resolve_file(
        &self,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
        lookup: &Lookup,
    ) -> Option<Vec<u8>>;

    /// The working directory, in the same form.
    fn cwd(&self) -> &[u8];

    /// Whether there is a file or a directory at `path`. It can be asked at any time.
    fn exists(&self, path: &[u8]) -> bool;

    /// The `package.json` that is closest to the file at `path`, of those that are an object. It can be asked at any time.
    fn package_json(&self, path: &[u8]) -> Option<&Json>;
}

impl<'a> File<'a> {
    /// The other files. `None` where a file is linted alone: a rule that needs them has nothing to say.
    #[inline]
    pub fn modules(&self) -> Option<&'a dyn Modules> {
        self.modules.get()
    }

    pub fn set_modules(&self, modules: &'a dyn Modules) {
        self.modules.set(Some(modules));
    }
}

/// The imports of a module: every `import("m")`, then the `import`s and the `export .. from`s at the top level, which is the order
/// of eslint-plugin-import.
pub fn requests_of<'a>(file: &'a File<'a>, flavor: Flavor) -> Vec<Request<'a>> {
    // With the offset in place of the line.
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
                may_be_itself: false,
            });
        }
    }
    crate::utils::sort::sort_unstable_by_key(&mut requests, |it| it.line);
    match flavor {
        Flavor::EslintPluginImport => {
            add_static_requests(file, &mut requests);
            set_lines(file.text(), &mut requests);
        }
        // Nobody asks for the lines.
        Flavor::Oxlint => add_static_requests_of_oxlint(file, &mut requests),
    }
    requests
}

/// Whether an `import` in `text` is followed by something other than a name, a string, a `{` or a `*`. To look at the text costs far
/// less than to look for the expressions of a kind, which few files have.
fn may_have_import_call(text: &[u8]) -> bool {
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
            // eslint-plugin-import does not look at `exportKind` here.
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
                may_be_itself: false,
            });
        }
    }
}

/// oxlint's `requested_modules`, in the order of the source. Whether only types are imported it decides for all the statements
/// with the same specifier at once: there are names that are imported or exported again, and all of them are types. `import "m"`,
/// `import {} from "m"` and `export * from "m"` have no names.
fn add_static_requests_of_oxlint<'a>(file: &'a File<'a>, requests: &mut Vec<Request<'a>>) {
    let first = requests.len();
    // For each request: the specifier, whether the statement has names, whether one of them is a value, and whether it exports them.
    let mut names: SmallVec<[(Name<'a>, bool, bool, bool); 32]> = SmallVec::new();
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
                types + values > 0 && stmt.tag() != StmtTag::Import,
            ));
            requests.push(Request {
                specifier: specifier.bytes(),
                span,
                line: span.start,
                kind: RequestKind::Static,
                is_only_importing_types: false,
                may_be_itself: false,
            });
        }
    }
    if !names.spilled() {
        for (request, &(specifier, ..)) in requests[first..].iter_mut().zip(&names) {
            let mut same = names.iter().filter(|it| it.0 == specifier);
            request.is_only_importing_types =
                same.clone().any(|it| it.1) && !same.clone().any(|it| it.2);
            request.may_be_itself = same.any(|it| it.3);
        }
        return;
    }
    // The same for all the statements with a specifier.
    let mut by_specifier: FxHashMap<Name<'a>, (bool, bool, bool)> = FxHashMap::default();
    for &(specifier, has_names, has_values, exports_names) in &names {
        let all = by_specifier.entry(specifier).or_default();
        *all = (all.0 | has_names, all.1 | has_values, all.2 | exports_names);
    }
    for (request, (specifier, ..)) in requests[first..].iter_mut().zip(&names) {
        let (has_names, has_values, exports_names) =
            by_specifier.get(specifier).copied().unwrap_or_default();
        request.is_only_importing_types = has_names && !has_values;
        request.may_be_itself = exports_names;
    }
}

/// Replaces the offset that is in [`Request::line`] by the line. It reads the text up to the last of them, which for most files is
/// a small part.
pub fn set_lines(text: &[u8], requests: &mut [Request]) {
    let mut order: SmallVec<[u32; 32]> = (0..requests.len() as u32).collect();
    crate::utils::sort::sort_indices_unstable(&mut order, &mut |a, b| {
        requests[a as usize].line.cmp(&requests[b as usize].line)
    });
    let (mut line, mut line_end) = (1, 0);
    for at in order {
        let offset = requests[at as usize].line as usize;
        // `line_end`: where the line break after `line` ends, once it is found.
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
