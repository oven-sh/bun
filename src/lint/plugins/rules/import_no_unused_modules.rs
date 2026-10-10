use crate::import_export_map::ExportMaps;
use crate::import_export_record::{ImportedSpecifier, recursive_pattern_capture};
use crate::import_package_path::{is_truthy, read_pkg_up};
use crate::import_settings::Settings;
use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::modules::Modules;
use bun_lint::paths;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;
use std::cell::OnceCell;
use std::sync::{Arc, OnceLock};

/// Forbid modules without exports, or exports without matching import in another module.
pub struct NoUnusedModules {
    /// `None`: the working directory.
    src: Option<Vec<Box<[u8]>>>,
    ignore_exports: Vec<Box<[u8]>>,
    missing_exports: bool,
    unused_exports: bool,
    ignore_unused_type_exports: bool,
    /// What `doPreparation` has found. All files of a run are in one project.
    prepared: OnceLock<Box<Prepared>>,
}

const NO_EXPORTS: Message = Message::new("", "No exports found");
const UNUSED: Message = Message::new("", "exported declaration '{{value}}' not used within other modules");

const EXPORT_ALL_DECLARATION: &[u8] = b"ExportAllDeclaration";
const IMPORT_NAMESPACE_SPECIFIER: &[u8] = b"ImportNamespaceSpecifier";
const IMPORT_DEFAULT_SPECIFIER: &[u8] = b"ImportDefaultSpecifier";
const DEFAULT: &[u8] = b"default";
/// How the `name` of a node that has none is printed.
const UNDEFINED: &[u8] = b"undefined";

const DECLARATIONS: [StmtTag; 7] = [
    StmtTag::Var,
    StmtTag::Fn,
    StmtTag::Class,
    StmtTag::Interface,
    StmtTag::TypeAlias,
    StmtTag::Enum,
    StmtTag::ExportDefault,
];

/// A value of `exportList`: by the name, whether `whereUsed` has something.
type Exports = FxHashMap<Box<[u8]>, bool>;

/// What of the file that asks decides how the other files are found and read.
struct Context {
    settings: Json,
    parser_options: Json,
    parser: Parser,
    source_type: SourceType,
    ecma_version: u32,
    jsx: bool,
    experimental_decorators: bool,
    is_of_eslint_8: bool,
}

/// What upstream keeps between the files. It changes it with every file that it lints, for an editor: not so here.
struct Prepared {
    context: Context,
    /// Otherwise upstream throws: nothing is reported.
    is_listed: bool,
    ignored_files: FxHashSet<Box<[u8]>>,
    export_list: FxHashMap<Box<[u8]>, Arc<Exports>>,
    /// The same for another context.
    next: OnceLock<Box<Prepared>>,
}

/// An entry of a value of `importList`.
struct Used<'a> {
    path: Cow<'a, [u8]>,
    names: SmallVec<[&'a [u8]; 4]>,
}

/// `exportList.get(file)`, once it is asked for. `None`: nothing is reported.
#[derive(Default)]
pub struct Usage(OnceCell<Option<Arc<Exports>>>);

impl Context {
    fn of(language: &LanguageOptions) -> Context {
        Context {
            settings: language.settings.clone(),
            parser_options: language.parser_options.clone(),
            parser: language.parser,
            source_type: language.source_type,
            ecma_version: language.ecma_version,
            jsx: language.jsx,
            experimental_decorators: language.experimental_decorators,
            is_of_eslint_8: language.eslint_8.is_some(),
        }
    }

    fn is_of(&self, language: &LanguageOptions) -> bool {
        self.parser == language.parser
            && self.source_type == language.source_type
            && self.ecma_version == language.ecma_version
            && self.jsx == language.jsx
            && self.experimental_decorators == language.experimental_decorators
            && self.is_of_eslint_8 == language.eslint_8.is_some()
            && self.settings == language.settings
            && self.parser_options == language.parser_options
    }
}

/// `isNodeModule`
fn is_node_module(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

/// The key of `exportList` for a name.
fn key_of(name: &[u8]) -> &[u8] {
    if name == DEFAULT { IMPORT_DEFAULT_SPECIFIER } else { name }
}

/// `pkg[name]`, if it is truthy.
fn field_of<'p>(pkg: &'p Json, name: &[u8]) -> Option<&'p Json> {
    pkg.get(name).filter(|it| is_truthy(it))
}

/// `fileIsInPkg`. Where upstream throws, for lack of a `package.json` or at a value that is no string: no.
fn file_is_in_pkg(modules: &dyn Modules, file: &[u8]) -> bool {
    let Some((pkg, path)) = read_pkg_up(modules, file) else { return false };
    if matches!(pkg.get(b"private"), Some(Json::Bool(true))) {
        return false;
    }
    let base_path = paths::dirname(&path);
    let check_pkg_field_string =
        |pkg_field: &Json| pkg_field.as_str().is_some_and(|it| paths::join_normalized(base_path, it) == file);
    let check_pkg_field = |pkg_field: &Json| match pkg_field {
        Json::Object(values) => values.iter().any(|it| check_pkg_field_string(&it.1)),
        Json::Array(values) => values.iter().any(check_pkg_field_string),
        _ => check_pkg_field_string(pkg_field),
    };
    field_of(&pkg, b"bin").is_some_and(check_pkg_field)
        || field_of(&pkg, b"browser").is_some_and(check_pkg_field)
        || field_of(&pkg, b"main").is_some_and(check_pkg_field_string)
}

/// `forEachDeclarationIdentifier`: the name, which is `None` for `undefined`, and `isTypeDeclaration`.
fn for_each_declaration_identifier<'a>(declaration: Stmt<'a>, cb: &mut dyn FnMut(Option<&'a [u8]>, bool)) {
    let (id, is_type_declaration) = match declaration.kind() {
        StmtKind::Fn(it) if it.has_body() => (it.name(), false),
        StmtKind::Class(it) => (it.name(), false),
        StmtKind::Interface(it) => (Some(it.name()), true),
        StmtKind::TypeAlias(it) => (Some(it.name()), true),
        StmtKind::Enum(it) => (Some(it.name()), true),
        StmtKind::Var(declarations) => {
            for declarator in declarations {
                for_each_identifier_of(declarator.pat(), cb);
            }
            return;
        }
        _ => return,
    };
    if let Some(id) = id {
        cb(Some(id.bytes()), is_type_declaration);
    }
}

/// The same for the `id` of a declarator.
fn for_each_identifier_of<'a>(id: Pat<'a>, cb: &mut dyn FnMut(Option<&'a [u8]>, bool)) {
    match id.kind() {
        PatKind::Object(_) => recursive_pattern_capture(id, &mut |pattern| {
            if let Some(name) = pattern.as_ident() {
                cb(Some(name.bytes()), false);
            }
        }),
        PatKind::Array(elements) => {
            for element in elements {
                // At a hole upstream throws.
                let Some(pattern) = element.pat().filter(|it| !matches!(it.kind(), PatKind::Missing)) else { continue };
                let is_identifier = !element.is_rest() && element.default().is_none();
                let name = pattern.as_ident().filter(|_| is_identifier);
                cb(name.map(Name::bytes), false);
            }
        }
        _ => cb(id.as_ident().map(Name::bytes), false),
    }
}

/// Whether `updateExportUsage` finds a name in a statement of the program.
fn exports_something(stmt: Stmt) -> bool {
    match stmt.kind() {
        StmtKind::ExportDefault(_) => true,
        StmtKind::ExportNamed(export) => !export.items().is_empty(),
        _ if !stmt.is_exported() => false,
        _ if stmt.is_default_export() => true,
        _ => {
            let mut has_name = false;
            for_each_declaration_identifier(stmt, &mut |_, _| has_name = true);
            has_name
        }
    }
}

impl NoUnusedModules {
    /// `doPreparation`. Where `listFilesToProcess` throws nothing is found.
    fn prepare<'a>(&self, file: &'a File<'a>) -> Prepared {
        let mut prepared = Prepared {
            context: Context::of(file.language()),
            is_listed: false,
            ignored_files: FxHashSet::default(),
            export_list: FxHashMap::default(),
            next: OnceLock::new(),
        };
        let (Some(modules), Some(maps)) = (file.modules(), ExportMaps::of(file)) else { return prepared };
        let extensions = Settings::new(file.settings()).file_extensions();
        let list_files_to_process = |src: &[Box<[u8]>]| {
            let src: Vec<&[u8]> = src.iter().map(|it| &**it).collect();
            if src.is_empty() { Ok(Vec::new()) } else { modules.list_files(&src, &extensions) }
        };
        let src_file_list = match &self.src {
            Some(src) => list_files_to_process(src),
            None => modules.list_files(&[modules.cwd()], &extensions),
        };
        let (Ok(src_file_list), Ok(ignored_files_list)) = (src_file_list, list_files_to_process(&self.ignore_exports))
        else {
            return prepared;
        };
        prepared.is_listed = true;
        prepared.ignored_files = ignored_files_list.into_iter().map(|it| it.path.into_boxed_slice()).collect();
        let mut export_list: FxHashMap<Box<[u8]>, Exports> = FxHashMap::default();
        let mut import_list: Vec<Used<'a>> = Vec::new();
        for listed in src_file_list.into_iter().filter(|it| !is_node_module(&it.path)) {
            let mut exports = Exports::default();
            if let Some(current_exports) = maps.at(&listed.path) {
                for dependency in maps.dependencies(current_exports).into_iter().flatten() {
                    let names = smallvec![EXPORT_ALL_DECLARATION];
                    import_list.push(Used { path: Cow::Borrowed(dependency.path()), names });
                }
                for reexported in maps.reexports(current_exports) {
                    if let Some(key) = reexported.name {
                        exports.insert(key_of(key).into(), false);
                    }
                    if let (Some(local), Some(reexport)) = (reexported.local, reexported.import) {
                        let names = smallvec![key_of(local)];
                        import_list.push(Used { path: Cow::Borrowed(reexport.path()), names });
                    }
                }
                for (path, declarations) in maps.imports(current_exports) {
                    if is_node_module(&path) {
                        continue;
                    }
                    let imported_specifiers = declarations.into_iter().flat_map(|it| it.imported_specifiers.iter());
                    let names = imported_specifiers.map(|it| match it {
                        ImportedSpecifier::Default => IMPORT_DEFAULT_SPECIFIER,
                        ImportedSpecifier::Namespace => IMPORT_NAMESPACE_SPECIFIER,
                        ImportedSpecifier::Named(name) => &**name,
                    });
                    import_list.push(Used { path: Cow::Owned(path), names: names.collect() });
                }
                // "build up export list only, if file is not ignored"
                if prepared.ignored_files.contains(&listed.path[..]) {
                    continue;
                }
                for key in maps.namespace_names(current_exports) {
                    exports.insert(key_of(key).into(), false);
                }
            }
            exports.insert(EXPORT_ALL_DECLARATION.into(), false);
            exports.insert(IMPORT_NAMESPACE_SPECIFIER.into(), false);
            export_list.insert(listed.path.into_boxed_slice(), exports);
        }
        // `determineUsage`
        for Used { path, names } in import_list {
            let Some(exports) = export_list.get_mut(&path[..]) else { continue };
            for name in names {
                if let Some(is_used) = exports.get_mut(name) {
                    *is_used = true;
                }
            }
        }
        prepared.export_list = export_list.into_iter().map(|(path, exports)| (path, Arc::new(exports))).collect();
        prepared
    }

    /// As if `file` were the first that is linted.
    fn prepared<'a>(&self, file: &'a File<'a>) -> &Prepared {
        let (mut place, mut is_new) = (&self.prepared, false);
        loop {
            let prepared = place.get_or_init(|| {
                is_new = true;
                Box::new(self.prepare(file))
            });
            if is_new || prepared.context.is_of(file.language()) {
                return prepared;
            }
            place = &prepared.next;
        }
    }

    /// What `checkUsage` looks a name up in.
    fn exports_of<'a>(&self, file: &'a File<'a>) -> Option<Arc<Exports>> {
        let modules = file.modules()?;
        let path = paths::portable(file.path(), file.path());
        let prepared = self.prepared(file);
        // A file that is not in `src` is not in the list.
        let exports = prepared.export_list.get(&path[..])?;
        let is_exempt = prepared.ignored_files.contains(&path[..]) || file_is_in_pkg(modules, &path);
        (!is_exempt).then(|| Arc::clone(exports))
    }

    /// `checkUsage`
    fn check_usage<'a>(&self, node: Span, exported_value: Option<&'a [u8]>, is_type_export: bool, cx: &Cx<'a, Self>) {
        if is_type_export && self.ignore_unused_type_exports {
            return;
        }
        let Some(exports) = cx.state.0.get_or_init(|| self.exports_of(cx.file())) else { return };
        let is_used = |key: &[u8]| exports.get(key).is_some_and(|it| *it);
        // "special case: export * from", "special case: namespace import"
        if is_used(EXPORT_ALL_DECLARATION) && exported_value != Some(IMPORT_DEFAULT_SPECIFIER)
            || is_used(IMPORT_NAMESPACE_SPECIFIER)
            || exported_value.is_some_and(|it| is_used(key_of(it)))
        {
            return;
        }
        let value = match exported_value {
            Some(name) if name == IMPORT_DEFAULT_SPECIFIER => DEFAULT,
            Some(name) => name,
            None => UNDEFINED,
        };
        cx.report(node, UNUSED).data("value", value);
    }
}

impl Rule for NoUnusedModules {
    const META: Meta = Meta::plugin(Plugin::Import, "no-unused-modules", Kind::Suggestion).needs_modules();
    const ON: On = On::new().stmts(&DECLARATIONS).export_specs().finish();
    type State<'a> = Usage;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let strings_of = |key: &str| -> Vec<Box<[u8]>> {
            options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect()
        };
        NoUnusedModules {
            src: options.has("src").then(|| strings_of("src")),
            ignore_exports: strings_of("ignoreExports"),
            missing_exports: options.bool_or("missingExports", false),
            unused_exports: options.bool_or("unusedExports", false),
            ignore_unused_type_exports: options.bool_or("ignoreUnusedTypeExports", false),
            prepared: OnceLock::new(),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = if self.unused_exports { On::new().stmts(&DECLARATIONS).export_specs() } else { On::new() };
        if self.missing_exports { on.finish() } else { on }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Usage> {
        Some(Usage::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if stmt.tag() == StmtTag::ExportDefault {
            self.check_usage(stmt.span(), Some(IMPORT_DEFAULT_SPECIFIER), false, cx);
        } else if stmt.is_exported()
            && let Some(node) = stmt.export_span()
        {
            if stmt.is_default_export() {
                self.check_usage(node, Some(IMPORT_DEFAULT_SPECIFIER), false, cx);
                return;
            }
            for_each_declaration_identifier(stmt, &mut |name, is_type_export| {
                self.check_usage(node, name, is_type_export, cx);
            });
        }
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        self.check_usage(specifier.span(), Some(specifier.exported().bytes()), false, cx);
    }

    /// `checkExportPresence`
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        if file.body().iter().any(exports_something) {
            return;
        }
        if self.unused_exports {
            let (prepared, path) = (self.prepared(file), paths::portable(file.path(), file.path()));
            if !prepared.is_listed || prepared.ignored_files.contains(&path[..]) {
                return;
            }
        }
        let node = match file.body().first() {
            Some(first) => first.export_span().unwrap_or_else(|| first.span()),
            None if file.uses_typescript_parser() => file.program_span(),
            // espree's `Program` without a token is the whole text.
            None => file.span(),
        };
        cx.report(node, NO_EXPORTS).on_exit(true);
    }
}
