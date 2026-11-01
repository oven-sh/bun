//! A test run that is compiled in several builds has to know, before the first of them, which members of built-in objects its files replace.
//! This reads one file by itself. What it imports from Bun names something. What it imports from another file does where the caller has read that file
//! and says which built-ins it exports: `BuiltinsOfModule`.

use std::borrow::Cow;
use std::cell::Cell;

use bun_core::strings;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, Binding, Decl, Parent, RuntimeBindOptions, SymbolId};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{Constant, FoldInputs, FoldOptions, FoldedValue};
use bun_sema::hir::{
    ArenaFew, CallId, ExportSpecId, ExprId, ExprKind, FileKind, ImportId, ImportedFileChanger,
    PatId, PatKind, StmtKind, TextOfOtherFile,
};
use bun_sema::import_sites::{
    ImportSiteKind, ImportSpecifier, JsxMode, find_texts_of_exports, write_from_other_folder,
    write_start_from_other_folder,
};
use bun_sema::module_format::{DeclaredModuleType, ModuleFormat};
use bun_sema::resolve::{JsxSettings, TransformRequest, TranspileSettings, TreeChange};
use bun_sema::session::Session;
use bun_sema::util::SharedSort;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::builtins::{
    BuiltinExported, BuiltinId, BuiltinNames, BuiltinsOfLoadedFile, ImportTargets,
    ReplacedMembersSought, ResolveInput, RuntimeModule, SourceDialect, resolve_file,
};
use crate::load::replaced_modules::find_replaced_modules;
use crate::load::runtime_modules::find_module_named;
use crate::load::test_runner_names::{FileOfTestRun, import_used_names};
use crate::load::{host_platform, is_in_node_modules};
use crate::modules::evicted::PathChangedOnDisk;
use crate::options::OpenedName;

// A name of a member is short.
const MAX_FOLDED_STRING_BYTES: usize = 256;

/// An object beside a name is a guess at what a test means. A file that takes nothing from bun:test and lies in no folder of test files is the program's own:
/// it is read as a package is, and the members that it only names stay locked, as they are in an executable. BUN_AOT_TESTS_NAME_WHAT_THEY_USE.
pub(crate) fn members_sought_in_file_outside_packages(
    targets: &[(ImportSiteKind, Option<RuntimeModule>)],
    is_beside_test_files: bool,
    product: ProductFiles,
) -> ReplacedMembersSought {
    let takes_from_tests = (targets.iter()).any(|it| it.1 == Some(RuntimeModule::BunTest));
    if product == ProductFiles::ReplaceNothing && !takes_from_tests && !is_beside_test_files {
        return ReplacedMembersSought::NamesAddedByProduct;
    }
    match takes_from_tests
        || is_beside_test_files
        || bun_core::env_var::BUN_AOT_TESTS_NAME_WHAT_THEY_USE.get() != Some(true)
    {
        true => ReplacedMembersSought::WrittenOrNamed,
        false => ReplacedMembersSought::Written,
    }
}

/// The files of a test run that an executable holds too: those that lie beside no test file and take nothing from the test runner.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ProductFiles {
    /// `AotOptions::only_tests_load_code_from_disk`: they do what they do in the executable, where built-in objects are read-only.
    ReplaceNothing,
    AreReadAsTestsAre,
}

#[derive(Default)]
pub struct FoundInFile {
    /// `LoadOptions::replaced_builtins` as far as the file spells them.
    pub members: Vec<u32>,
    /// `LoadOptions::opened_names` as far as the file spells them.
    pub names_added: Vec<OpenedName>,
    /// The files beside it that it names, as it writes them: `import "./helper"`, `require("../stubs.js")`, `new URL("./worker.ts", import.meta.url)`.
    pub files_named: Vec<Vec<u8>>,
    /// What else it imports, as it writes it: packages, and modules of Bun.
    pub other_modules_named: Vec<Vec<u8>>,
    /// `ReplacedByTests::modules`, `exports` and `any_module`, each module as the file writes it.
    pub modules: Vec<Vec<u8>>,
    /// Those of `modules` that the `build.module(..)` of a plugin names.
    pub modules_named_by_plugins: Vec<Vec<u8>>,
    pub exports: Vec<(Vec<u8>, Vec<u8>)>,
    pub any_module: bool,
    /// The modules whose objects it hands on, each as the file writes it, and whether it hands on one that it does not spell.
    /// A spy that takes an object from somewhere may get one: `ReplacedByTests::handed_on_modules`.
    pub handed_on: Vec<Vec<u8>>,
    pub hands_on_any: bool,
    /// `ReplacedByTests::spies_on_unknown_objects` and `names_spied_on_unknown_objects`
    pub spies_on_unknown_objects: bool,
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
    /// `LoadOptions::names_spied_in_text`
    pub names_spied_in_text: Vec<Vec<u8>>,
    /// `LoadOptions::modules_replaced_in_text`
    pub modules_replaced_in_text: Vec<Vec<u8>>,
    /// The file holds code as text that spies on what it is told: `"export const spy = (object, name) => spyOn(object, name)"`.
    pub text_spies_under_any_name: bool,
    /// The parser reported an error and went on.
    pub has_syntax_error: bool,
    /// `export function watch(object, name) { return spyOn(object, name); }`: the texts that other files pass to this one may be the name.
    pub spies_under_names_from_outside: bool,
    /// `ReplacedByTests::evicted_modules` and `evicts_any_module`, each file as this one writes it.
    pub evicted: Vec<Vec<u8>>,
    pub evicts_any: bool,
    /// `find_paths_changed_on_disk`
    pub changed_on_disk: Vec<PathChangedOnDisk<Vec<u8>>>,
    /// `ReplacedByTests::files_required_where_throws_are_caught`, each file as this one writes it.
    pub required_where_throws_are_caught: Vec<Vec<u8>>,
    /// `ReplacedByTests::data_files_imported_with_types`, each file as this one writes it.
    pub imported_with_types: Vec<Vec<u8>>,
    /// `ReplacedByTests::names_file_with_query`
    pub names_file_with_query: bool,
    /// `ReplacedByTests::files_imported_by_statements`, `files_imported_by_calls` and `files_required`, each file as this one writes it.
    pub imported_by_statements: Vec<Vec<u8>>,
    pub imported_by_calls: Vec<Vec<u8>>,
    pub required: Vec<Vec<u8>>,
    /// `ResolvedBuiltins::holders_named_from_outside`, by their numbers.
    pub holders_named_from_outside: Vec<u32>,
    /// The texts that it passes to what it imports from another file: the file as it writes it, and the text. `plant("polluted")`.
    pub texts_passed: Vec<(Vec<u8>, Vec<u8>)>,
    /// `ResolvedBuiltins::builtins_handed_out`, by their numbers.
    pub builtins_handed_out: Vec<u32>,
    /// `ResolvedBuiltins::writes_on_parameters_under_any_name`
    pub writes_on_parameters_under_any_name: bool,
    /// The built-in objects that it passes to what it imports from another file: the file as it writes it, and the number. `silence(console, names)`.
    pub builtins_passed: Vec<(Vec<u8>, u32)>,
    /// `ResolvedBuiltins::writes_on_imports`: the file as this one writes it, the path and the key.
    pub writes_on_imports: Vec<(Vec<u8>, Vec<Vec<u8>>, Vec<u8>)>,
    /// `export { a as b } from "./c"`, `import { a } from "./c"; export { a as b }`: b, "./c", a.
    pub names_exported_again: Vec<(Vec<u8>, Vec<u8>, Vec<u8>)>,
    /// `export * from "./c"`
    pub modules_exported_again: Vec<Vec<u8>>,
    /// `ResolvedBuiltins::builtins_exported`, and whether it is a CommonJS file.
    pub builtins_exported: BuiltinsOfModule,
    /// What it takes from the modules that it loads: the module as it writes it, and the name. No name: the whole module, as `import * as`, `require()` and `import()` give it.
    pub names_loaded: Vec<(Vec<u8>, Option<Vec<u8>>)>,
    /// `FileAnalysis::asked_of_other_files`
    pub asked_of_other_files: Vec<(Vec<u8>, Vec<u8>)>,
}

/// `ExportedFileChanger`. A `start` that is written from the folder of the file is here as a whole path.
#[derive(Clone, PartialEq, Eq)]
pub struct FileChangerOfModule {
    pub export: Vec<u8>,
    pub place: u32,
    pub reaches_below: bool,
    pub start: Vec<u8>,
    pub end: Vec<u8>,
    pub is_start_whole_path: bool,
}

/// The built-ins that a file exports, each by its number and with the names that lead to it: `BuiltinExported`.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct BuiltinsOfModule {
    pub exported: Vec<(Vec<Vec<u8>>, u32)>,
    /// `BuiltinsOfLoadedFile::object_is_default`
    pub object_is_default: bool,
    pub file_changers: Vec<FileChangerOfModule>,
    /// `find_texts_of_exports`: the export, the text, and whether it is written from `folder`, in which the file lies.
    pub texts: Vec<(Vec<u8>, Vec<u8>, bool)>,
    pub folder: Vec<u8>,
}

/// What the file with this path gets where it loads a module that it writes like this. `None`: no built-in, as far as anybody knows.
pub type FindBuiltinsOfModule<'a> = dyn Fn(&[u8], &[u8]) -> Option<BuiltinsOfModule> + Sync + 'a;

pub(super) fn is_relative(specifier: &[u8]) -> bool {
    specifier.starts_with(b"./") || specifier.starts_with(b"../")
}

/// `look_at_files` for one file.
#[cfg(test)]
fn look_at_file(path: &[u8], text: &[u8]) -> FoundInFile {
    let mut found = FoundInFile::default();
    look_at_files(&mut |look_at| found = look_at(path, text));
    found
}

/// Nothing for a file with a syntax error: its build says so. Nothing for a file that holds no code: `import data from "./data.json"`, `./types.d.ts`.
/// Several files, one after another. The table of the names of built-ins takes longer to make than a test file to read: it is made once for all of them.
pub fn look_at_files(look_at_each: &mut dyn FnMut(&dyn Fn(&[u8], &[u8]) -> FoundInFile)) {
    let product = ProductFiles::AreReadAsTestsAre;
    look_at_files_of_run(&|_| false, product, &|_, _| None, look_at_each);
}

/// `is_beside_test_files`: whether the file lies in the folder of a test file or below it. A helper does, whatever it imports, and so does the code that it holds as a string.
pub fn look_at_files_of_run(
    is_beside_test_files: &(dyn Fn(&[u8]) -> bool + Sync),
    product: ProductFiles,
    find_builtins_of_module: &FindBuiltinsOfModule<'_>,
    look_at_each: &mut dyn FnMut(&dyn Fn(&[u8], &[u8]) -> FoundInFile),
) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let look = Look {
        session: &session,
        names: BuiltinNames::new(&atoms),
        atoms,
        is_beside_test_files: Cell::new(false),
        product: Cell::new(product),
        find_builtins_of_module,
    };
    look_at_each(&|path, text| {
        look.is_beside_test_files.set(is_beside_test_files(path));
        // A package may be there to help the tests.
        look.product.set(match is_in_node_modules(path) {
            true => ProductFiles::AreReadAsTestsAre,
            false => product,
        });
        let mut found = FoundInFile::default();
        look.look_at_text(path, text, &mut found);
        found
    });
}

struct Look<'s> {
    session: &'s Session,
    atoms: Interner<'s>,
    names: BuiltinNames,
    is_beside_test_files: Cell<bool>,
    product: Cell<ProductFiles>,
    find_builtins_of_module: &'s FindBuiltinsOfModule<'s>,
}

const IMPORT_OF_NAMES_OF_TEST_RUNNER: &[u8] = b"import { jest, spyOn, vi } from \"bun:test\";\n";

// Without one of each no text writes a property, or takes a spy from the test runner.
fn may_hold_code(text: &[u8]) -> bool {
    let holds = |byte: u8| strings::contains_char(text, byte);
    (holds(b'.') || holds(b'[') || strings::contains(text, b"bun:test"))
        && (holds(b'=') || holds(b'(') || strings::contains(text, b"delete "))
}

fn folder_of(path: &[u8]) -> &[u8] {
    bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Auto>(path)
}

impl<'s> Look<'s> {
    /// Whether the text is a program.
    fn look_at_text(&self, path: &[u8], text: &[u8], found: &mut FoundInFile) -> bool {
        let (arena, atoms, names) = (self.session.arena(), &self.atoms, &self.names);
        let parse_options = CompileParseOptions {
            path,
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            keeps_function_directives: false,
        };
        let mut hir = parse_for_compile(arena, &parse_options, text, atoms);
        if hir.has_errors || matches!(hir.kind, FileKind::Json | FileKind::Declaration) {
            return false;
        }
        found.has_syntax_error |= hir.has_parse_diagnostics;
        hir.text = Cow::Borrowed(text);
        // The look through the test files knows neither the defines nor the features of the run: what stands under `if (feature("X"))` may run.
        let fold_options = FoldOptions {
            features_are_unknown: true,
            max_string_bytes: MAX_FOLDED_STRING_BYTES,
            ..FoldOptions::default()
        };
        let fold = FoldInputs::new(fold_options, arena);
        let bind_options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        let file = FileInputs {
            declared_module_type: match path.ends_with(b".cjs") || path.ends_with(b".cts") {
                true => DeclaredModuleType::CommonJs,
                false => DeclaredModuleType::Unknown,
            },
            import_meta_main: None,
            is_library: false,
            host_values: &[],
            jsx: JsxMode::Classic,
            own_name: arena.alloc_slice_copy(bun_paths::resolve_path::basename(path)),
        };
        let (mut bound, mut analysis) =
            analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        // `bun test` hands every file the names of the test runner: `jest.mock("./a", ..)` and `vi.spyOn(..)` need no import. A build gives the file the import, and so does the look.
        let mut request = TransformRequest {
            path,
            hir: &mut hir,
            bound: &bound,
            analysis: &analysis,
            settings: &TranspileSettings {
                jsx: JsxSettings::default(),
                experimental_decorators: false,
                emits_decorator_metadata: false,
                use_define_for_class_fields: None,
            },
            import_meta_main: None,
        };
        let file_of_run = FileOfTestRun::default();
        if import_used_names(arena, atoms, &mut request, file_of_run) == TreeChange::Changed {
            (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        }
        // `put(join(import.meta.dir, "state.js"), text)`, where the file that exports `put` has been looked at.
        let mut file_changers: Vec<ImportedFileChanger> = Vec::new();
        for site in analysis.import_sites {
            let ImportSpecifier::Constant(specifier) = site.specifier else {
                continue;
            };
            let module = (self.find_builtins_of_module)(path, atoms.bytes(specifier));
            let exported = module.map_or(Vec::new(), |module| module.file_changers);
            file_changers.extend(exported.iter().filter_map(|it| {
                let start = match it.is_start_whole_path {
                    true => write_start_from_other_folder(&it.start, b"", folder_of(path))?,
                    false => it.start.clone(),
                };
                Some(ImportedFileChanger {
                    specifier,
                    export: atoms.intern(&it.export),
                    place: it.place,
                    reaches_below: it.reaches_below,
                    start: atoms.intern(&start),
                    end: atoms.intern(&it.end),
                    starts_at_own_directory: it.is_start_whole_path,
                })
            }));
        }
        // `writeFileSync(join(folder, "state.js"), text)`, where the file that exports `folder` has been looked at.
        let mut texts: Vec<TextOfOtherFile> = Vec::new();
        for &(specifier, export) in analysis.asked_of_other_files {
            let Some(module) = (self.find_builtins_of_module)(path, atoms.bytes(specifier)) else {
                continue;
            };
            let own_folder =
                bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Auto>(path);
            for (_, text, starts_at_folder) in
                (module.texts.iter()).filter(|it| it.0 == atoms.bytes(export))
            {
                let written = match starts_at_folder {
                    true => write_from_other_folder(text, &module.folder, own_folder),
                    false => Some(text.clone()),
                };
                texts.extend(written.map(|written| TextOfOtherFile {
                    specifier,
                    export,
                    text: atoms.intern(&written),
                    starts_at_own_directory: *starts_at_folder,
                }));
            }
        }
        if !file_changers.is_empty() || !texts.is_empty() {
            hir.imported_file_changers = ArenaFew::from_iter_in(file_changers.into_iter(), arena);
            hir.texts_of_other_files = ArenaFew::from_iter_in(texts.into_iter(), arena);
            (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, atoms, arena);
        }
        let module_of = |specifier: ImportSpecifier| match specifier {
            ImportSpecifier::Constant(text) => match atoms.bytes(text) {
                b"@jest/globals" | b"vitest" => Some(RuntimeModule::BunTest),
                text => find_module_named(text),
            },
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => None,
        };
        let sites = analysis.import_sites.iter();
        let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
            .map(|site| (site.kind, module_of(site.specifier)))
            .collect();
        targets.shared_sort_unstable_by_key(|target| target.0);
        let loaded_files = analysis.import_sites.iter().filter_map(|site| {
            let ImportSpecifier::Constant(specifier) = site.specifier else {
                return None;
            };
            let module = (self.find_builtins_of_module)(path, atoms.bytes(specifier))?;
            let exported = module.exported.iter().filter_map(|(names, builtin)| {
                Some(BuiltinExported {
                    path: names.iter().map(|name| atoms.intern(name)).collect(),
                    builtin: BuiltinId::from_wire(*builtin)?,
                })
            });
            Some(BuiltinsOfLoadedFile {
                site: site.kind,
                object_is_default: module.object_is_default,
                exported: exported.collect(),
            })
        });
        let loaded_files: Vec<BuiltinsOfLoadedFile> = loaded_files.collect();
        let resolved = resolve_file(&ResolveInput {
            hir: &hir,
            bound: &bound,
            decisions: &analysis.decisions,
            module_format: analysis.module_format,
            targets: &ImportTargets::new(&targets).with_loaded_files(loaded_files),
            names,
            platform: host_platform(),
            dialect: SourceDialect::Program,
            replaced: &[],
            replaced_members_sought: members_sought_in_file_outside_packages(
                &targets,
                self.is_beside_test_files.get(),
                self.product.get(),
            ),
        });
        let imported = analysis
            .import_sites
            .iter()
            .filter_map(|site| match site.specifier {
                ImportSpecifier::Constant(text) => Some(text),
                _ => None,
            });
        let urls = (0..hir.exprs.len() as u32).map(ExprId).filter_map(|expr| {
            let ExprKind::New(call) = hir[expr].kind else {
                return None;
            };
            let call = hir[call];
            // `new URL("./worker.ts", import.meta.url)`, `new Worker("./worker.ts")`, of the realm or of node:worker_threads. A text that names no file costs a look at the disk.
            match hir[hir.ids(call.args).next()?].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            }
        });
        // A tree that the parser has mended holds names that are none, and so does a tagged template with an escape that has no value.
        let text_of = |text: Atom| match text.is_none() {
            true => &b""[..],
            false => atoms.bytes(text),
        };
        let files_named = imported.chain(urls).map(text_of);
        let modules = find_replaced_modules(&hir, &bound, &analysis, &resolved, &module_of, atoms);
        let bytes_of = |text: Atom| text_of(text).to_vec();
        found
            .modules
            .extend(modules.whole.iter().map(|&it| bytes_of(it)));
        let named_by_plugins = modules.named_by_plugins.iter();
        (found.modules_named_by_plugins).extend(named_by_plugins.map(|&it| bytes_of(it)));
        let exports = modules.exports.iter();
        (found.exports).extend(exports.map(|&(module, name)| (bytes_of(module), bytes_of(name))));
        found.any_module |= modules.any;
        (found.handed_on).extend(modules.handed_on.iter().map(|&it| bytes_of(it)));
        found.hands_on_any |= modules.hands_on_any;
        found.spies_on_unknown_objects |= modules.spies_on_unknown_objects.is_any_name;
        found.spies_under_names_from_outside |=
            modules.spies_on_unknown_objects.takes_names_from_outside;
        let spied = modules.spies_on_unknown_objects.names.iter();
        found
            .names_spied_on_unknown_objects
            .extend(spied.map(|&it| bytes_of(it)));
        (found.evicted).extend(modules.evicted.iter().map(|&it| bytes_of(it)));
        found.evicts_any |= modules.evicts_any;
        let changed = modules.changed_on_disk.iter();
        (found.changed_on_disk).extend(changed.map(|changed| PathChangedOnDisk {
            path: bytes_of(changed.path),
            starts_at_own_directory: changed.starts_at_own_directory,
            reaches_below: changed.reaches_below,
        }));
        let throwers = modules.required_where_throws_are_caught.iter();
        (found.required_where_throws_are_caught).extend(throwers.map(|&it| bytes_of(it)));
        let typed = modules.imported_with_types.iter();
        found
            .imported_with_types
            .extend(typed.map(|&it| bytes_of(it)));
        found.names_file_with_query |= modules.names_file_with_query;
        for (written, texts) in [
            (
                &modules.imported_by_statements,
                &mut found.imported_by_statements,
            ),
            (&modules.imported_by_calls, &mut found.imported_by_calls),
            (&modules.required, &mut found.required),
        ] {
            texts.extend(written.iter().map(|&it| bytes_of(it)));
        }
        let members = resolved.replaced_members().iter();
        found.members.extend(members.map(|&member| member as u32));
        let names_added = resolved.names_added().iter();
        (found.names_added).extend(names_added.map(|&(holder, name)| OpenedName {
            holder: holder as u32,
            name: bytes_of(name),
        }));
        for text in files_named {
            match is_relative(text) {
                true => found.files_named.push(text.to_vec()),
                false => found.other_modules_named.push(text.to_vec()),
            }
        }
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            let (item, export) = (hir[spec], hir[hir[spec].export]);
            if item.type_only || export.type_only {
                continue;
            }
            let from = match (export.has_module_specifier, bound.exported_binding(spec)) {
                (true, _) => Some((export.spec, item.local)),
                (false, Binding::Symbol(symbol)) => match *bound.symbol(symbol).decls {
                    [Decl::ImportSpec(import)] => {
                        Some((hir[hir[import].import].spec, hir[import].imported))
                    }
                    _ => None,
                },
                _ => None,
            };
            if let Some((module, name)) = from.filter(|from| from.0.is_some()) {
                let again = (bytes_of(item.exported), bytes_of(module), bytes_of(name));
                found.names_exported_again.push(again);
            }
        }
        for site in analysis.import_sites.iter() {
            let ImportSpecifier::Constant(module) = site.specifier else {
                continue;
            };
            match site.kind {
                ImportSiteKind::Import(import) => {
                    let import = hir[import];
                    let named = import.named.iter().map(|spec| hir[spec]);
                    let named = named.filter(|spec| !spec.type_only && !import.type_only);
                    let named = named.map(|spec| Some(bytes_of(spec.imported)));
                    let default = import.default.is_some().then(|| Some(b"default".to_vec()));
                    let whole = import.namespace.is_some().then_some(None);
                    let names = named.chain(default).chain(whole);
                    (found.names_loaded).extend(names.map(|name| (bytes_of(module), name)));
                }
                ImportSiteKind::ImportCall(_)
                | ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::GetBuiltinModule(_) => {
                    found.names_loaded.push((bytes_of(module), None));
                }
                _ => {}
            }
        }
        for site in analysis.import_sites {
            if let (ImportSiteKind::ExportStar(statement), ImportSpecifier::Constant(module)) =
                (site.kind, site.specifier)
                && matches!(hir[statement].kind, StmtKind::ExportStar { alias, type_only: false, .. } if alias.is_none())
            {
                found.modules_exported_again.push(bytes_of(module));
            }
        }
        found.builtins_exported = BuiltinsOfModule {
            exported: (resolved.builtins_exported().iter())
                .map(|it| {
                    let names = it.path.iter().map(|&name| bytes_of(name)).collect();
                    (names, it.builtin as u32)
                })
                .collect(),
            object_is_default: analysis.module_format == ModuleFormat::CommonJs,
            file_changers: (analysis.exported_file_changers.iter())
                .map(|it| FileChangerOfModule {
                    export: bytes_of(it.export),
                    place: it.place,
                    reaches_below: it.reaches_below,
                    start: match it.starts_at_own_directory {
                        // `./lib/`
                        true => [folder_of(path), &atoms.bytes(it.start)[1..]].concat(),
                        false => bytes_of(it.start),
                    },
                    end: bytes_of(it.end),
                    is_start_whole_path: it.starts_at_own_directory,
                })
                .collect(),
            texts: find_texts_of_exports(&hir, &bound, &analysis.decisions, &fold, &file, atoms)
                .iter()
                .map(|it| {
                    (
                        bytes_of(it.export),
                        bytes_of(it.text),
                        it.starts_at_own_directory,
                    )
                })
                .collect(),
            folder: bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Auto>(
                path,
            )
            .to_vec(),
        };
        let asked = analysis.asked_of_other_files.iter();
        (found.asked_of_other_files).extend(asked.map(|&it| (bytes_of(it.0), bytes_of(it.1))));
        let holders = resolved.holders_named_from_outside().iter();
        (found.holders_named_from_outside).extend(holders.map(|&holder| holder as u32));
        let holders = resolved.builtins_handed_out().iter();
        (found.builtins_handed_out).extend(holders.map(|&holder| holder as u32));
        found.writes_on_parameters_under_any_name |= resolved.writes_on_parameters_under_any_name();
        for write in resolved.writes_on_imports() {
            let file = hir[write.import].spec;
            if file.is_some() && find_module_named(atoms.bytes(file)).is_none() {
                let path = write.path.iter().map(|&name| bytes_of(name)).collect();
                (found.writes_on_imports).push((bytes_of(file), path, bytes_of(write.key)));
            }
        }
        let import_of = |symbol: SymbolId| match *bound.symbol(symbol).decls {
            [Decl::ImportSpec(spec)] => Some(hir[spec].import),
            [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => Some(import),
            _ => None,
        };
        let root_of = |call: CallId| {
            let callee = hir.skip_type_assertions(hir[call].callee);
            let name = hir.member_key(callee).map_or(callee, |(object, _)| object);
            match bound.binding(hir.skip_type_assertions(name)) {
                Binding::Symbol(symbol) => Some(symbol),
                _ => None,
            }
        };
        // `const tracker = createTracker(); tracker.watch(holder, "read")`, `const { watch } = createTracker()`, `tracker = createTracker()` in a hook:
        // what a function of another file returns takes its texts there too.
        let mut made_by: Vec<(SymbolId, ImportId)> = Vec::new();
        for made in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[made].kind else {
                continue;
            };
            let Some(import) = root_of(call).and_then(import_of) else {
                continue;
            };
            let mut value = made;
            while let Parent::Expr(parent) = bound.parent_of_expr(value)
                && (hir.type_assertion_operand(parent) == Some(value)
                    || matches!(hir[parent].kind, ExprKind::Await(_)))
            {
                value = parent;
            }
            match bound.parent_of_expr(value) {
                Parent::VarInit(declaration) => {
                    let pattern = hir[declaration].pat;
                    let parts: Vec<PatId> = match hir[pattern].kind {
                        PatKind::Object(properties) => {
                            properties.iter().map(|it| hir[it].value).collect()
                        }
                        _ => vec![pattern],
                    };
                    let holders =
                        (parts.into_iter()).map(|part| bound.declared_symbol(Decl::Var(part)));
                    made_by.extend(holders.filter(|it| it.is_some()).map(|it| (it, import)));
                }
                Parent::Expr(user) => {
                    if let ExprKind::Assign {
                        op: None,
                        target,
                        value: stored,
                    } = hir[user].kind
                        && stored == value
                        && let Binding::Symbol(holder) =
                            bound.binding(hir.skip_type_assertions(target))
                    {
                        made_by.push((holder, import));
                    }
                }
                _ => {}
            }
        }
        let source_of = |symbol: SymbolId| {
            let made = made_by.iter().find(|it| it.0 == symbol).map(|it| it.1);
            import_of(symbol).or(made)
        };
        // `function start(watch: Tracker["watch"]) { watch(holder, "read"); }`, `start(tracker.watch)`: what goes into a call may be what a parameter of this file holds.
        let is_parameter =
            |symbol: SymbolId| matches!(*bound.symbol(symbol).decls, [Decl::Param(_)]);
        let mut handed_to_calls: Vec<ImportId> = Vec::new();
        for call in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[call].kind else {
                continue;
            };
            for operand in hir.ids(hir[call].args) {
                let operand: ExprId = hir.skip_type_assertions(operand);
                let name = hir
                    .member_key(operand)
                    .map_or(operand, |(object, _)| object);
                if let Binding::Symbol(symbol) = bound.binding(hir.skip_type_assertions(name))
                    && let Some(import) = source_of(symbol)
                    && !handed_to_calls.contains(&import)
                {
                    handed_to_calls.push(import);
                }
            }
        }
        for call in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Call(call) = hir[call].kind else {
                continue;
            };
            let Some(symbol) = root_of(call) else {
                continue;
            };
            let import = source_of(symbol);
            let imports = match import {
                Some(ref import) => core::slice::from_ref(import),
                None if is_parameter(symbol) => &handed_to_calls[..],
                None => continue,
            };
            for &import in imports {
                // `import a from ;` in a text whose substitution stood for the name: the parser goes on without one.
                if hir[import].spec.is_none() {
                    continue;
                }
                let file = atoms.bytes(hir[import].spec);
                // "@/test/tracker" may be a file of the project: its tsconfig.json says.
                if find_module_named(file).is_some() {
                    continue;
                }
                for operand in hir.ids(hir[call].args) {
                    let operand = hir.skip_type_assertions(operand);
                    if let FoldedValue::Constant(Constant::String(text)) =
                        analysis.decisions.constant(&hir, operand)
                    {
                        found.texts_passed.push((file.to_vec(), bytes_of(text)));
                    }
                    if let Some(holder) = resolved.builtin_of_expression(operand) {
                        found.builtins_passed.push((file.to_vec(), holder as u32));
                    }
                }
            }
        }
        for expr in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[expr].kind {
                ExprKind::String(text) => self.look_at_code_in_texts(&[text_of(text)], found),
                ExprKind::Template { exprs } => {
                    let texts = hir.ids(hir.template_texts(exprs));
                    let texts: Vec<&[u8]> = texts.map(text_of).collect();
                    self.look_at_code_in_texts(&texts, found);
                }
                _ => {}
            }
        }
        true
    }

    /// A test hands code over as text, to a Worker, another realm or a file that it writes: `run("Set.prototype.add = () => {}")`. No build sees it run, and it writes
    /// in a realm that the image has locked. `texts`: a string, or what stands between the substitutions of a template.
    fn look_at_code_in_texts(&self, texts: &[&[u8]], found: &mut FoundInFile) {
        if !texts.iter().any(|text| may_hold_code(text)) {
            return;
        }
        // What a substitution stands for is not known: nothing, as where it adds statements, or a value.
        let fillers: &[&[u8]] = match texts.len() {
            1 => &[b""],
            _ => &[b"", b"0"],
        };
        // "Write `using spy = spyOn(...)`": the parser goes on behind a syntax error, and nothing runs such a text. What it writes on built-ins is kept all the same: it costs
        // little, and a message often spells what the code beside it does under a name that is made.
        let mut read_with_syntax_error: Vec<FoundInFile> = Vec::new();
        for filler in fillers {
            let text = texts.join(*filler);
            // The body of a function, which may return.
            let body = [b"async function body() {\n", &text[..], b"\n}"].concat();
            // `bun test` hands every file the names of the test runner, so `jest.spyOn(..)` needs no import. A text that declares such a name itself fails to parse this way.
            let with_names = [IMPORT_OF_NAMES_OF_TEST_RUNNER, &text[..]].concat();
            let takes_spy_from_nowhere =
                strings::contains(&text, b"spyOn") && !strings::contains(&text, b"bun:test");
            let ways = [
                takes_spy_from_nowhere.then_some(&with_names[..]),
                Some(&text[..]),
                Some(&body[..]),
            ];
            for way in ways.into_iter().flatten() {
                let mut inner = FoundInFile::default();
                if !self.look_at_text(b"/text.ts", way, &mut inner) {
                    continue;
                }
                if inner.has_syntax_error {
                    read_with_syntax_error.push(inner);
                    continue;
                }
                return found.take_what_code_in_text_does(inner);
            }
        }
        // A substitution may stand for what no filler is, a name or a keyword: `lib.${method}()`. Then no way parses, and the text that is made may run: each
        // way is read as far as the parser gets behind its errors.
        if texts.len() > 1 {
            for inner in read_with_syntax_error {
                found.take_what_code_in_text_does(inner);
            }
        } else if let Some(inner) = read_with_syntax_error.into_iter().next() {
            found.members.extend(inner.members);
            found.names_added.extend(inner.names_added);
        }
    }
}

impl FoundInFile {
    fn take_what_code_in_text_does(&mut self, inner: FoundInFile) {
        self.members.extend(inner.members);
        self.names_added.extend(inner.names_added);
        // Where that code runs says nothing about the folder it is in: of a module that it imports, the name is what is known.
        let names = inner.exports.into_iter().map(|(_, name)| name);
        self.names_spied_in_text.extend(names);
        (self.names_spied_in_text).extend(inner.names_spied_on_unknown_objects);
        self.names_spied_in_text.extend(inner.names_spied_in_text);
        self.text_spies_under_any_name |= inner.spies_on_unknown_objects
            || inner.spies_under_names_from_outside
            || inner.any_module
            || inner.text_spies_under_any_name;
        self.modules_replaced_in_text.extend(inner.modules);
        (self.modules_replaced_in_text).extend(inner.modules_replaced_in_text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::BuiltinId;

    fn find(text: &str) -> Vec<BuiltinId> {
        let numbers = look_at_file(b"/project/a.test.ts", text.as_bytes()).members;
        numbers
            .into_iter()
            .map(|number| BuiltinId::from_wire(number).expect("it is in the table"))
            .collect()
    }

    fn find_modules(text: &str) -> (Vec<String>, Vec<(String, String)>, bool) {
        let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
        let text_of = |bytes: &Vec<u8>| String::from_utf8(bytes.clone()).expect("it is text");
        let modules = found.modules.iter().chain(&found.handed_on);
        let mut modules: Vec<String> = modules.map(text_of).collect();
        modules.sort_unstable();
        modules.dedup();
        let exports = found.exports.iter();
        let mut exports: Vec<(String, String)> = exports
            .map(|(module, name)| (text_of(module), text_of(name)))
            .collect();
        exports.sort_unstable();
        (modules, exports, found.any_module || found.hands_on_any)
    }

    fn find_names_that_entries_may_stand_under(text: &str) -> Vec<String> {
        let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
        let text_of = |bytes: &Vec<u8>| String::from_utf8(bytes.clone()).expect("it is text");
        let mut names: Vec<String> = found.evicted.iter().map(text_of).collect();
        names.sort_unstable();
        names.dedup();
        names
    }

    #[test]
    fn a_spy_in_a_template_that_parses_under_no_filler_is_found() {
        let spied = |text: &str| {
            let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
            found.names_spied_in_text.contains(&b"total".to_vec())
        };
        let head = r#"import { spyOn } from "bun:test"; import * as lib from "./lib"; spyOn(lib, "total");"#;
        for tail in [
            "lib.other();",
            "lib.other(${value});",
            "lib.${method}();",
            "function ${name}() {}",
            "${keyword} held = 1;",
        ] {
            assert!(spied(&format!("write(`{head} {tail}`);")), "{tail}");
        }
        // Nothing runs a text that is no code, and it has no part that the run fills in.
        assert!(!spied(&format!("write('{head} lib.();');")));
    }

    #[test]
    fn a_key_of_require_cache_that_is_not_spelled_names_the_modules_that_it_may_be() {
        let find = find_names_that_entries_may_stand_under;
        let entry = "{ exports: { parse: 1 } }";
        let whole = [
            r#"const key = ["u", "r", "l"].join(""); require.cache[key] = ENTRY;"#,
            r#"export {}; let key; key = ["u", "rl"].join(""); require.cache[key] = ENTRY; key = undefined;"#,
            r#"function store() { let key; key = ["u", "rl"].join(""); require.cache[key] = ENTRY; key = undefined; }"#,
            r#"const key = "ur" + tail(); require.cache[key] = ENTRY;"#,
            r#"const key = head() + "rl"; require.cache[key] = ENTRY;"#,
            r#"import Module from "node:module"; Module._cache[`ur${middle()}l`] = ENTRY;"#,
            r#"function stub(name) { require.cache[require.resolve(name)] = ENTRY; } stub("url");"#,
        ];
        for text in whole {
            assert_eq!(find(&text.replace("ENTRY", entry)), ["url"], "{text}");
        }
        let none = [
            r#"import path from "node:path"; const key = path.join(folder(), process.platform, "addon.node"); require.cache[key] = ENTRY;"#,
            r#"import { resolve } from "path"; let key: string | undefined; key = resolve(folder(), "addon.node"); require.cache[key] = ENTRY; key = undefined;"#,
            r#"import { afterEach } from "bun:test"; import * as path from "path";
               let key: string | undefined;
               function put(folder: string) { key = path.join(folder, process.platform, "addon.node"); require.cache[key] = ENTRY; }
               afterEach(() => { if (key) { delete require.cache[key]; key = undefined; } });"#,
            r#"const key = folder() + "/addon.node"; require.cache[key] = ENTRY;"#,
            r#"require.cache["node:" + name()] = ENTRY;"#,
            r#"delete require.cache[name()];"#,
            r#"console.log(Object.keys(require.cache), name() in require.cache, require.cache[name()]);"#,
        ];
        for text in none {
            assert_eq!(find(&text.replace("ENTRY", entry)), [""; 0], "{text}");
        }
        let both = find(&r#"require.cache[`u${middle()}l`] = ENTRY;"#.replace("ENTRY", entry));
        assert_eq!(both, ["url", "util"]);
        let ends = find(&r#"require.cache[name() + "/promises"] = ENTRY;"#.replace("ENTRY", entry));
        assert!(ends.contains(&"fs/promises".to_owned()), "{ends:?}");
        assert!(
            ends.iter().all(|name| name.ends_with("/promises")),
            "{ends:?}"
        );
        let any = [
            r#"require.cache[name()] = ENTRY;"#,
            r#"export function stub(name) { require.cache[require.resolve(name)] = ENTRY; }"#,
            r#"import path from "node:path"; require.cache[path.join(folder(), name())] = ENTRY;"#,
            r#"import path from "node:path"; require.cache[path.join(folder(), "..")] = ENTRY;"#,
            r#"const table = require.cache; table[name()] = ENTRY;"#,
            r#"put(require.cache, name(), ENTRY);"#,
            r#"Reflect.set(require.cache, name(), ENTRY);"#,
            r#"Object.assign(require.cache, entries());"#,
        ];
        for text in any {
            let names = find(&text.replace("ENTRY", entry));
            for name in ["fs", "url", "events", "fs/promises"] {
                assert!(names.contains(&name.to_owned()), "{text}: {names:?}");
            }
            assert!(
                !names.iter().any(|name| name.starts_with("node:")),
                "{text}: {names:?}"
            );
        }
    }

    #[test]
    fn tells_what_is_mocked_from_what_is_handed_on() {
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            import { mock, spyOn } from "bun:test";
            import * as passed from "./passed";
            import * as unnamed from "./unnamed";
            export * as again from "./again";
            mock.module("./mocked", () => ({}));
            use(passed, await import(name()));
            spyOn(unnamed, pick());
            "#,
        );
        assert_eq!(found.modules, [&b"./mocked"[..], b"./unnamed"]);
        assert_eq!(found.handed_on, [&b"./again"[..], b"./passed"]);
        assert!(found.hands_on_any && !found.any_module);
        assert!(!found.spies_on_unknown_objects && found.names_spied_on_unknown_objects.is_empty());
        let spelled = br#"import { spyOn } from "bun:test"; import * as a from "./a"; spyOn(a, "b"); spyOn(console, "log");"#;
        assert!(!look_at_file(b"/project/a.test.ts", spelled).spies_on_unknown_objects);
        let unknown = br#"import { spyOn } from "bun:test"; spyOn(holder.it, "b");"#;
        let found = look_at_file(b"/project/a.test.ts", unknown);
        assert_eq!(found.names_spied_on_unknown_objects, [b"b"]);
        assert!(!found.spies_on_unknown_objects);
        let unnamed = br#"import { spyOn } from "bun:test"; spyOn(holder.it, pick());"#;
        let found = look_at_file(b"/project/a.test.ts", unnamed);
        assert!(found.spies_under_names_from_outside && !found.spies_on_unknown_objects);
        let listed = br#"import { spyOn } from "bun:test"; for (const name of ["a", "b"]) spyOn(holder.it, name);"#;
        let found = look_at_file(b"/project/a.test.ts", listed);
        assert_eq!(found.names_spied_on_unknown_objects, [b"a", b"b"]);
        assert!(!found.spies_under_names_from_outside);
        let handed_on = br#"import { spyOn } from "bun:test"; use(spyOn);"#;
        assert!(look_at_file(b"/project/a.test.ts", handed_on).spies_on_unknown_objects);
        for (spelled, names) in [
            (
                &br#"import { spyOn } from "bun:test"; spyOn(holder.it, flag ? "a" : "b");"#[..],
                [b"a", b"b"],
            ),
            (
                br#"import { spyOn, test } from "bun:test"; test.each([{ step: "a" }, { step: "b" }])("%o", row => { spyOn(holder.it, row.step); });"#,
                [b"a", b"b"],
            ),
            (
                br#"import { spyOn } from "bun:test"; const A = ["a"] as const; const B = ["b"] as const; [...A, ...B].filter(name => holder.it[name]).map(name => spyOn(holder.it, name));"#,
                [b"a", b"b"],
            ),
        ] {
            let found = look_at_file(b"/project/a.test.ts", spelled);
            assert_eq!(found.names_spied_on_unknown_objects, names);
            assert!(!found.spies_under_names_from_outside && !found.spies_on_unknown_objects);
        }
        for taken_by_name in [
            &br#"const { spyOn: spy } = await import("bun:test"); spy(holder.it, "b");"#[..],
            br#"const spy = (await import("bun:test")).spyOn(holder.it, "b");"#,
        ] {
            let found = look_at_file(b"/project/a.test.ts", taken_by_name);
            assert_eq!(found.names_spied_on_unknown_objects, [b"b"]);
            assert!(!found.spies_on_unknown_objects && !found.any_module);
        }
        for taken_whole in [
            &br#"const runner = await import("bun:test"); use(runner);"#[..],
            br#"const { spyOn, ...rest } = await import("bun:test");"#,
            br#"const promise = import("bun:test");"#,
            br#"const spy = (await import("bun:test"))[pick()];"#,
        ] {
            let found = look_at_file(b"/project/a.test.ts", taken_whole);
            assert!(found.spies_on_unknown_objects && found.any_module);
        }
    }

    #[test]
    fn finds_mocked_modules_and_exports_that_spies_name() {
        let (modules, exports, any) = find_modules(
            r#"
            import { mock, spyOn, jest, vi } from "bun:test";
            import * as a from "./a";
            import * as b from "./b";
            import * as read from "./read";
            import { named } from "./named";
            import whole from "./default";
            mock.module("./mocked", () => ({}));
            jest.mock("../jest-mocked", () => ({}));
            vi.mock("package", () => ({}));
            spyOn(a, "first");
            jest.spyOn(a as any, "second");
            vi.spyOn(b, "third");
            spyOn(named, "method");
            spyOn(whole, "method");
            read.value; read.call(); const { one, two: other } = read;
            "#,
        );
        assert_eq!(modules, ["../jest-mocked", "./mocked", "package"]);
        let expected = [("./a", "first"), ("./a", "second"), ("./b", "third")];
        assert_eq!(
            exports,
            expected.map(|(module, name)| (module.to_owned(), name.to_owned()))
        );
        assert!(!any);
    }

    #[test]
    fn a_module_object_that_goes_somewhere_is_replaced_whole() {
        let (modules, exports, any) = find_modules(
            r#"
            import { spyOn } from "bun:test";
            import * as passed from "./passed";
            import * as stored from "./stored";
            import * as exported from "./exported";
            import * as unnamed from "./unnamed";
            import * as spread from "./spread";
            export * as again from "./again";
            export * from "./star";
            use(passed);
            const list = [stored];
            export { exported };
            spyOn(unnamed, pick());
            const { ...rest } = spread;
            const promise = import("./promise");
            const awaited = await import("./awaited");
            use(awaited);
            const kept = await import("./kept");
            spyOn(kept, "name"); kept.other();
            const required = require("./required");
            required.written = () => 1;
            delete require("./deleted").gone;
            const { taken } = await import("./taken");
            (await import("./member")).read();
            import("./for-effect");
            export const shown = require("./shown");
            let again2 = require("./stored-twice"); again2 = 1;
            "#,
        );
        assert_eq!(
            modules,
            [
                "./again",
                "./awaited",
                "./exported",
                "./passed",
                "./promise",
                "./shown",
                "./spread",
                "./stored",
                "./stored-twice",
                "./unnamed"
            ]
        );
        let expected = [
            ("./deleted", "gone"),
            ("./kept", "name"),
            ("./required", "written"),
        ];
        assert_eq!(
            exports,
            expected.map(|(module, name)| (module.to_owned(), name.to_owned()))
        );
        assert!(!any);
    }

    #[test]
    fn a_module_that_the_file_does_not_spell_is_any_module() {
        let mocks = r#"import { mock } from "bun:test"; mock.module(name(), () => ({}));"#;
        assert!(find_modules(mocks).2);
        assert!(find_modules("use(await import(name()));").2);
        assert!(find_modules("use(require(name()));").2);
        assert!(!find_modules("(await import(name())).read();").2);
        assert!(!find_modules("const { a } = require(name());").2);
        let dead =
            r#"import { mock } from "bun:test"; if (false) mock.module(name(), () => ({}));"#;
        assert!(!find_modules(dead).2);
    }

    #[test]
    fn reads_code_that_a_file_holds_as_text() {
        let mut found = find(
            r#"
            run("Set.prototype.add = function () { return this }");
            run(`delete Map.prototype.get`, 'a sentence (with a dot.) = no code');
            run(`
              const before = ${JSON.stringify(1)};
              Array.from = () => before;
              return ${what}`);
            run(`String.prototype.at = 0${more}${andMore}`);
            run("run('Promise.race = 1')");
            "#,
        );
        found.sort_unstable();
        let mut expected = vec![
            BuiltinId::SetPrototypeAdd,
            BuiltinId::MapPrototypeGet,
            BuiltinId::ArrayFrom,
            BuiltinId::StringPrototypeAt,
            BuiltinId::PromiseRace,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
        let names = look_at_file(
            b"/project/a.test.ts",
            br#"run("Object.prototype.planted = () => 1");"#,
        );
        assert_eq!(
            names.names_added,
            [OpenedName {
                holder: BuiltinId::ObjectPrototype as u32,
                name: b"planted".to_vec()
            }]
        );
    }

    #[test]
    fn an_import_in_a_text_may_lack_the_name_of_its_file() {
        assert!(find("const text = `import a from ${p}; a.run(1.5);`;").is_empty());
        assert!(find("const text = `import * as a from ${p}\na.run(1.5);`;").is_empty());
        assert!(find(r#"const text = "import a, { b } from; b(1.5);";"#).is_empty());
    }

    #[test]
    fn a_key_that_is_a_symbol_of_the_language_names_one_member() {
        let only = [BuiltinId::MapPrototypeSymbolIterator];
        let spy = r#"import { spyOn } from "bun:test"; spyOn(Map.prototype, Symbol.iterator);"#;
        assert_eq!(find(spy), only);
        assert_eq!(find("Map.prototype[Symbol.iterator] = () => 0;"), only);
        let defined = "Object.defineProperty(Map.prototype, Symbol.iterator, { value: 0 });";
        assert_eq!(find(defined), only);
        let held = "const key = Symbol.iterator; delete Map.prototype[key];";
        assert_eq!(find(held), only);
        let of_host = r#"import { spyOn } from "bun:test"; spyOn(Headers.prototype, Symbol.iterator); URLSearchParams.prototype[Symbol.iterator] = 0; delete Set.prototype[Symbol.iterator];"#;
        assert_eq!(
            find(of_host),
            [
                BuiltinId::HeadersPrototypeSymbolIterator,
                BuiltinId::SetPrototypeSymbolIterator,
                BuiltinId::URLSearchParamsPrototypeSymbolIterator
            ]
        );
        // A key that nobody can read opens the whole object.
        assert!(find("Map.prototype[pick()] = () => 0;").len() > 1);
    }

    #[test]
    fn opens_keys_on_prototypes_that_a_file_reaches_without_their_names() {
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            function plant(way: string, field: string) {
                const inherited: object = Reflect.get({}, way);
                Reflect.defineProperty(inherited, field, { value: 1, configurable: true });
            }
            plant("__proto__", "first");
            plant("__proto__", "second");
            "#,
        );
        let mut names: Vec<(u32, &[u8])> = (found.names_added.iter())
            .map(|added| (added.holder, &added.name[..]))
            .collect();
        names.sort_unstable();
        names.dedup();
        let (object, function) = (
            BuiltinId::ObjectPrototype as u32,
            BuiltinId::FunctionPrototype as u32,
        );
        let mut expected: Vec<(u32, &[u8])> = vec![
            (object, b"first"),
            (object, b"second"),
            (function, b"first"),
            (function, b"second"),
        ];
        expected.sort_unstable();
        assert_eq!(names, expected);
        let told =
            br#"const own: any = {}; Reflect.defineProperty(own, "name", {}); other[KEY] = 1;"#;
        assert!(
            look_at_file(b"/project/a.test.ts", told)
                .names_added
                .is_empty()
        );
        // A prototype that is asked for somewhere in the file says nothing of an object that is written elsewhere in it.
        let apart = br#"const kind = Object.getPrototypeOf(value); const made: any = {}; for (const key of ["a", "b"]) made[key] = kind;"#;
        assert!(look_at_file(b"/project/a.ts", apart).names_added.is_empty());
        let direct =
            br#"Object.getPrototypeOf({}).planted = 1; ({} as any).__proto__["other"] = 2;"#;
        assert_eq!(look_at_file(b"/project/a.ts", direct).names_added.len(), 4);
    }

    #[test]
    fn finds_names_in_a_list_that_is_passed_beside_the_object() {
        let mut found = find(
            r#"
            function wrapAll(prototype: object, methods: string[], note: () => void) {
                for (const method of methods) {
                    const original = Reflect.get(prototype, method);
                    Object.defineProperty(prototype, method, { value() { note(); return original; } });
                }
            }
            function install() {
                const inserters = ["set", "getOrInsert"];
                wrapAll(Map.prototype, inserters, () => {});
                wrapAll(Set.prototype, ["add"], () => {});
                wrapAll(WeakMap.prototype, inserters, () => {});
            }
            install();
            "#,
        );
        found.sort_unstable();
        found.dedup();
        let mut expected = vec![
            BuiltinId::MapPrototypeSet,
            BuiltinId::MapPrototypeGetOrInsert,
            BuiltinId::SetPrototypeAdd,
            BuiltinId::WeakMapPrototypeSet,
            BuiltinId::WeakMapPrototypeGetOrInsert,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn follows_the_object_and_the_name_to_what_the_file_spells_for_them() {
        let mut found = find(
            r#"
            import { spyOn, test } from "bun:test";
            for (const name of ["ceil", "round"]) spyOn(Math, name);
            ((holder) => spyOn(holder, "sqrt"))(Math);
            ((name) => spyOn(Math, name))("cbrt");
            for (const holder of [Math, Number]) spyOn(holder, "hypot");
            for (const name of ["sin", "cos"] as const) { (Math as any)[name] = () => 0; }
            test.each(["exp", "pow"])("%s", name => { spyOn(Math, name); });
            test.each([[Date, "UTC"], [Object, "keys"]])("%s", (holder, name) => { spyOn(holder, name); });
            ["tan"].forEach(name => { delete (Math as any)[name]; });
            const check = (holder: any, name: string, ask: () => void) => { spyOn(holder, name); ask(); };
            check(Promise, "all", () => {});
            check(Array.prototype, "push", () => {});
            class Patch {
                install() {
                    const con = console;
                    for (const m of LIST) { con[m] = () => {}; }
                }
            }
            const LIST = ["log", "info"];
            const more = ["acos"];
            if (globalThis.wide) more.push("asin", "atan");
            for (const name of more) spyOn(Math, name);
            for (const name of ["setTimeout", "setInterval"] as const) {
                spyOn(globalThis as unknown as Record<string, () => void>, name);
            }
            "#,
        );
        found.sort_unstable();
        found.dedup();
        let mut expected = vec![
            BuiltinId::MathCeil,
            BuiltinId::MathRound,
            BuiltinId::MathSqrt,
            BuiltinId::MathCbrt,
            BuiltinId::MathHypot,
            BuiltinId::MathSin,
            BuiltinId::MathCos,
            BuiltinId::MathExp,
            BuiltinId::MathPow,
            BuiltinId::DateUTC,
            BuiltinId::ObjectKeys,
            BuiltinId::MathTan,
            BuiltinId::PromiseAll,
            BuiltinId::ArrayPrototypePush,
            BuiltinId::ConsoleLog,
            BuiltinId::ConsoleInfo,
            BuiltinId::MathAcos,
            BuiltinId::MathAsin,
            BuiltinId::MathAtan,
            BuiltinId::SetTimeout,
            BuiltinId::SetInterval,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn a_name_that_nobody_can_read_opens_every_member_of_the_object() {
        let found = find(
            r#"import { spyOn } from "bun:test"; for (const name of Object.keys(Atomics)) spyOn(Atomics, name);"#,
        );
        assert!(
            found.contains(&BuiltinId::AtomicsStore) && found.contains(&BuiltinId::AtomicsLoad)
        );
        assert!(!found.contains(&BuiltinId::MathMax));
        let globals = find("for (const name of names()) globalThis[name] = 1;");
        assert!(globals.contains(&BuiltinId::SetTimeout) && globals.contains(&BuiltinId::Fetch));
        assert!(!globals.contains(&BuiltinId::Map) && !globals.contains(&BuiltinId::Array));
    }

    #[test]
    fn a_store_that_happens_only_where_the_member_is_missing_writes_nothing() {
        let found = find(
            r#"
            (Symbol as any).dispose ??= Symbol("dispose");
            (Object as any).create ||= () => ({});
            (Array as any).from &&= () => [];
            "#,
        );
        assert_eq!(found, [BuiltinId::ArrayFrom]);
    }

    #[test]
    fn reads_a_text_whose_import_has_lost_its_name() {
        for text in [
            "const text = `import a from ${p}; a.run(1.5);`;",
            "const text = `import * as a from ${p}\\na.run(1.5)`;",
            r#"const text = "import a, { b } from; a.run(1.5); b('x');";"#,
            r"const text = String.raw`C:\unicode\xylophone ${p}.a = (1)`;",
            r#"const text = "export { a as } from './b'; export { } from; export * from;";"#,
        ] {
            assert!(find(text).is_empty());
        }
    }

    #[test]
    fn finds_holders_that_are_reached_without_their_names() {
        let found = find(
            r#"
            import { spyOn } from "bun:test";
            const ofLists = Object.getPrototypeOf([]);
            ofLists.flat = () => 1;
            [].__proto__.fill = () => 1;
            [].constructor.prototype.reverse = () => 1;
            (1).constructor.prototype.toFixed = () => 1;
            Object.getPrototypeOf(new Map()).get = () => 1;
            Reflect.getPrototypeOf(new Set()).has = () => 1;
            Object.getPrototypeOf(Promise.resolve()).finally = () => 1;
            /a/.constructor.prototype.test = () => 1;
            new Date().constructor.parse = () => 1;
            globalThis["Ma" + "th"].acos = () => 1;
            Reflect.get(globalThis, "Math").cosh = () => 1;
            (0, eval)("this").Math.tanh = () => 1;
            Function("return this")().Math.expm1 = () => 1;
            const held = { m: Math };
            held.m.log10 = () => 1;
            spyOn(Object.getPrototypeOf([]), "concat");
            "#,
        );
        for member in [
            BuiltinId::ArrayPrototypeFlat,
            BuiltinId::ArrayPrototypeFill,
            BuiltinId::ArrayPrototypeReverse,
            BuiltinId::NumberPrototypeToFixed,
            BuiltinId::MapPrototypeGet,
            BuiltinId::SetPrototypeHas,
            BuiltinId::PromisePrototypeFinally,
            BuiltinId::RegExpPrototypeTest,
            BuiltinId::DateParse,
            BuiltinId::MathAcos,
            BuiltinId::MathCosh,
            BuiltinId::MathTanh,
            BuiltinId::MathExpm1,
            BuiltinId::MathLog10,
            BuiltinId::ArrayPrototypeConcat,
        ] {
            assert!(found.contains(&member), "{member:?} in {found:?}");
        }
        // The prototype of an instance of the program's own class is none of them.
        let own = find(
            r#"
            class Own {}
            Object.getPrototypeOf(new Own()).flat = () => 1;
            new Own().constructor.prototype.get = () => 1;
            "#,
        );
        assert!(!own.contains(&BuiltinId::ArrayPrototypeFlat), "{own:?}");
        assert!(!own.contains(&BuiltinId::MapPrototypeGet), "{own:?}");
    }

    // Each function hands its parameter on twice, so there are 2^60 ways from the last to the first, and a ring beside them. An expression is looked at once.
    #[test]
    fn follows_parameters_that_many_ways_lead_to() {
        let mut text = String::from(
            "function f0(a) { a.held.flat = () => 1; a.held.inner.get = () => 1; ring(a); }\n",
        );
        for level in 1..=60 {
            let below = level - 1;
            text += &format!(
                "function f{level}(a) {{ f{below}(a); f{below}(a); f{below}({{ held: a.held }}); a.held.at = () => {level}; }}\n"
            );
        }
        text += "function ring(a) { other(a.held); }\nfunction other(b) { ring({ held: b }); b.held.has = () => 1; }\n";
        text += "f60({ held: Object.getPrototypeOf([]) });\n";
        let found = find(&text);
        assert!(found.contains(&BuiltinId::ArrayPrototypeFlat), "{found:?}");
        assert!(found.contains(&BuiltinId::ArrayPrototypeAt), "{found:?}");
    }

    // `Reflect.get({}, name)` is Object, a function and Object.prototype here. The first of them is not the answer.
    #[test]
    fn finds_every_holder_that_names_out_of_a_list_lead_to() {
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            import { describe, it } from "bun:test";
            function plant(name: string, field: "autoUpdate" | "source") {
                const inherited: object = Reflect.get({}, name);
                Reflect.defineProperty(inherited, field, { value: 1, configurable: true });
            }
            describe.each(["constructor", "toString", "__proto__"])("%s", name => {
                it("one", () => { plant(name, "autoUpdate"); });
                it("other", () => { plant(name, "source"); });
            });
            for (const way of ["constructor", "__proto__"]) Reflect.get([], way).at = () => 1;
            "#,
        );
        let object = BuiltinId::ObjectPrototype as u32;
        for name in [&b"autoUpdate"[..], b"source"] {
            let is_opened = |it: &OpenedName| it.holder == object && it.name == name;
            assert!(
                found.names_added.iter().any(is_opened),
                "{}",
                bstr::BStr::new(name)
            );
        }
        assert!(
            found
                .members
                .contains(&(BuiltinId::ArrayPrototypeAt as u32))
        );
    }

    #[test]
    fn finds_spies_stores_definitions_and_deletions() {
        let found = find(
            r#"
            import { spyOn, jest } from "bun:test";
            import { vi } from "vitest";
            spyOn(String.prototype, "indexOf");
            jest.spyOn(Map.prototype, "get");
            vi.spyOn(Promise, "race");
            Array.from = () => [];
            Object.defineProperty(Array.prototype, "includes", { value() {} });
            Reflect.set(Buffer, "concat", () => {});
            delete (Atomics as any).store;
            "#,
        );
        let mut expected = vec![
            BuiltinId::StringPrototypeIndexOf,
            BuiltinId::MapPrototypeGet,
            BuiltinId::PromiseRace,
            BuiltinId::ArrayFrom,
            BuiltinId::ArrayPrototypeIncludes,
            BuiltinId::BufferConcat,
            BuiltinId::AtomicsStore,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn reflect_set_writes_on_the_receiver_that_it_is_given() {
        let found = find(
            r#"
            Reflect.set({}, "max", () => 1, Math);
            Reflect.set(Array, "from", () => [], Array);
            Reflect.set(Object, "keys", () => [], ...rest);
            Reflect.set(Atomics, "store", () => 1, {});
            "#,
        );
        let mut expected = vec![
            BuiltinId::MathMax,
            BuiltinId::ArrayFrom,
            BuiltinId::ObjectKeys,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
        let unread = find("Reflect.set({}, name(), () => 1, Atomics);");
        assert!(unread.contains(&BuiltinId::AtomicsStore), "{unread:?}");
    }

    #[test]
    fn a_write_on_a_proxy_of_a_built_in_object_is_a_write_on_the_object() {
        let found = find(
            r#"
            const proxy = new Proxy(Math, {});
            proxy.max = () => 1;
            delete proxy.min;
            Object.defineProperty(proxy, "abs", { value() {} });
            Reflect.set(Math, "cos", () => 1, proxy);
            new Proxy(Array, {}).prototype.push = () => 1;
            "#,
        );
        let mut expected = vec![
            BuiltinId::MathMax,
            BuiltinId::MathMin,
            BuiltinId::MathAbs,
            BuiltinId::MathCos,
            BuiltinId::ArrayPrototypePush,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
        let own = find("class Proxy { constructor(target) {} } new Proxy(Math).max = () => 1;");
        assert!(own.is_empty(), "{own:?}");
    }

    #[test]
    fn a_write_on_what_a_helper_answers_is_a_write_on_what_the_helper_was_handed_or_returns() {
        let found = find(
            r#"
            import { spyOn, beforeEach } from "bun:test";
            import { wrapElsewhere } from "./helper";
            const wrap = object => new Proxy(object, {});
            function wrapDeclared(object) {
                if (!object) return null;
                const proxy = new Proxy(object, {});
                return proxy;
            }
            const tools = { wrap(object) { return new Proxy(object, {}); }, ofJSON: () => new Proxy(JSON, {}) };
            class Tools { static wrap(object) { return new Proxy(object, {}); } }
            const twice = object => wrap(wrap(object));
            const ofIntl = () => new Proxy(Intl, {});
            const inObject = () => ({ proxy: new Proxy(performance, {}) });
            const inList = object => [new Proxy(object, {})];
            const later = async object => new Proxy(object, {});
            wrap(Math).max = () => 1;
            delete wrapDeclared(Atomics).load;
            const kept = wrap(Date);
            kept.now = () => 1;
            wrapElsewhere(String).raw = () => 1;
            tools.wrap(Object).keys = () => 1;
            tools.ofJSON().parse = () => 1;
            Tools.wrap(Reflect).has = () => 1;
            twice(ArrayBuffer).isView = () => 1;
            ofIntl().getCanonicalLocales = () => 1;
            inObject().proxy.now = () => 1;
            inList(URL)[0].canParse = () => 1;
            (await later(Buffer)).isBuffer = () => 1;
            Proxy.revocable(Error, {}).proxy.captureStackTrace = () => 1;
            Object.defineProperty(wrap(Map), "groupBy", { value() {} });
            Reflect.set({}, "cwd", () => 1, wrap(process));
            spyOn(wrap(console), "table");
            wrap(Array.prototype).at = () => 1;
            const { proxy } = wrapElsewhere(Number);
            proxy.isNaN = () => 1;
            const [first] = inList(Symbol);
            first.keyFor = () => 1;
            let made;
            beforeEach(() => { made = wrap(BigInt); });
            made.asIntN = () => 1;
            "#,
        );
        for member in [
            BuiltinId::MathMax,
            BuiltinId::AtomicsLoad,
            BuiltinId::DateNow,
            BuiltinId::StringRaw,
            BuiltinId::ObjectKeys,
            BuiltinId::JSONParse,
            BuiltinId::ReflectHas,
            BuiltinId::ArrayBufferIsView,
            BuiltinId::IntlGetCanonicalLocales,
            BuiltinId::PerformanceNow,
            BuiltinId::URLCanParse,
            BuiltinId::BufferIsBuffer,
            BuiltinId::ErrorCaptureStackTrace,
            BuiltinId::MapGroupBy,
            BuiltinId::ProcessCwd,
            BuiltinId::ConsoleTable,
            BuiltinId::ArrayPrototypeAt,
            BuiltinId::NumberIsNaN,
            BuiltinId::SymbolKeyFor,
            BuiltinId::BigIntAsIntN,
        ] {
            assert!(found.contains(&member), "{member:?} in {found:?}");
        }
        // A `return` of a function inside the helper is not the helper's, and what a function of the table answers is known.
        let other = find(
            r#"
            function makes() { const inner = () => { return new Proxy(Math, {}); }; return {}; }
            makes().max = () => 1;
            Object.keys(Atomics).load = () => 1;
            "#,
        );
        assert!(other.is_empty(), "{other:?}");
    }

    #[test]
    fn follows_constructors_callbacks_getters_and_functions_that_helpers_answer() {
        let found = find(
            r#"
            import { ObservedElsewhere, withProxyElsewhere } from "./helper";
            const wrap = object => new Proxy(object, {});
            class Observed { constructor(target) { return new Proxy(target, {}); } }
            class ObservedBelow extends Observed {}
            function ObservedOld(target) { return new Proxy(target, {}); }
            class Keeps { constructor(target) { this.proxy = new Proxy(target, {}); } }
            class Holds { proxy = new Proxy(Intl, {}); }
            class Tools {
                static ofSet() { return new Proxy(Set.prototype, {}); }
                ofWeakSet() { return new Proxy(WeakSet.prototype, {}); }
            }
            function withProxy(object, use) { return use(new Proxy(object, {})); }
            const holder = { get proxy() { return new Proxy(DataView.prototype, {}); } };
            const makeWrap = target => () => new Proxy(target, {});
            new Observed(Atomics).load = () => 1;
            new ObservedBelow(Reflect).has = () => 1;
            new ObservedOld(Number).isNaN = () => 1;
            new ObservedElsewhere(Object).keys = () => 1;
            new Keeps(BigInt).proxy.asIntN = () => 1;
            new Holds().proxy.getCanonicalLocales = () => 1;
            Tools.ofSet().has = () => 1;
            new Tools().ofWeakSet().has = () => 1;
            withProxy(Symbol, it => { it.for = () => 1; });
            withProxyElsewhere(String, ({ proxy }) => { proxy.raw = () => 1; });
            holder.proxy.getInt8 = () => 1;
            makeWrap(Array)().of = () => 1;
            wrap.bind(null, JSON)().parse = () => 1;
            Promise.resolve(wrap(Promise)).then(it => { it.any = () => 1; });
            const list = [performance].map(wrap);
            list[0].now = () => 1;
            for (const it of [URL].map(each => wrap(each))) it.canParse = () => 1;
            "#,
        );
        for member in [
            BuiltinId::AtomicsLoad,
            BuiltinId::ReflectHas,
            BuiltinId::NumberIsNaN,
            BuiltinId::ObjectKeys,
            BuiltinId::BigIntAsIntN,
            BuiltinId::IntlGetCanonicalLocales,
            BuiltinId::SetPrototypeHas,
            BuiltinId::WeakSetPrototypeHas,
            BuiltinId::SymbolFor,
            BuiltinId::StringRaw,
            BuiltinId::DataViewPrototypeGetInt8,
            BuiltinId::ArrayOf,
            BuiltinId::JSONParse,
            BuiltinId::PromiseAny,
            BuiltinId::PerformanceNow,
            BuiltinId::URLCanParse,
        ] {
            assert!(found.contains(&member), "{member:?} in {found:?}");
        }
        // A constructor that does nothing with what it is handed makes an object of the program's own, and so does one that extends a class of the table.
        let own = find(
            r#"
            class Counts { constructor(target) { this.count = 1; } }
            class List extends Array {}
            new Counts(Math).max = () => 1;
            new List(Atomics).load = () => 1;
            "#,
        );
        assert!(own.is_empty(), "{own:?}");
    }

    #[test]
    fn tells_what_a_file_hands_out_and_where_it_writes_on_what_it_imports() {
        let helper = look_at_file(
            b"/project/helper.ts",
            br#"
            export const ofMath = () => new Proxy(Math, {});
            export const proxy = new Proxy(JSON, {});
            export function ofAtomics() { return { proxy: new Proxy(Atomics, {}) }; }
            const kept = new Proxy(Reflect, {});
            export { kept as other };
            export default new Proxy(Intl, {});
            export const tools = { ofSymbol() { return new Proxy(Symbol, {}); } };
            const own = new Proxy(Date, {});
            "#,
        );
        let mut handed_out = helper.builtins_handed_out;
        handed_out.sort_unstable();
        let mut expected = [
            BuiltinId::Math,
            BuiltinId::JSON,
            BuiltinId::Atomics,
            BuiltinId::Reflect,
            BuiltinId::Intl,
            BuiltinId::Symbol,
        ]
        .map(|it| it as u32);
        expected.sort_unstable();
        assert_eq!(handed_out, expected);
        let found = look_at_file(
            b"/project/a.test.ts",
            br#"
            import made, { ofMath, proxy, withProxy } from "./helper";
            import * as tools from "./tools";
            import * as fs from "node:fs";
            ofMath().max = () => 1;
            proxy.parse = () => 1;
            tools.ofWeakRef().prototype.deref = () => 1;
            const kept = await made;
            delete kept.getCanonicalLocales;
            withProxy(it => { it.load = () => 1; });
            ofMath().nameOfTheProgram = 1;
            fs.readFileSync = () => 1;
            "#,
        );
        let text_of = |bytes: &Vec<u8>| String::from_utf8(bytes.clone()).expect("it is text");
        let writes: Vec<(String, Vec<String>, String)> = (found.writes_on_imports.iter())
            .map(|(file, path, key)| {
                (
                    text_of(file),
                    path.iter().map(text_of).collect(),
                    text_of(key),
                )
            })
            .collect();
        let write = |file: &str, path: &[&str], key: &str| {
            let path = path.iter().map(|&name| name.to_owned()).collect();
            (file.to_owned(), path, key.to_owned())
        };
        assert_eq!(
            writes,
            [
                write("./helper", &[], "max"),
                write("./helper", &[], "parse"),
                write("./tools", &["prototype", "ofWeakRef"], "deref"),
                write("./helper", &[], "getCanonicalLocales"),
                write("./helper", &[], "load"),
            ]
        );
    }

    // Each helper returns two calls of the one below, so there are 2^60 ways from the first to the last, and two that return each other's calls beside them.
    #[test]
    fn follows_helpers_that_many_ways_lead_through() {
        let mut text = String::from("function f0(a) { return new Proxy(a, {}); }\n");
        for level in 1..=60 {
            let below = level - 1;
            text += &format!(
                "function f{level}(a) {{ if (a) return f{below}(a); return f{below}(f{below}(a)); }}\n"
            );
        }
        text += "function ring(a) { return other(a); }\nfunction other(b) { return ring(b); }\n";
        text += "f60(Math).max = () => 1;\nring().min = () => 1;\n";
        let found = find(&text);
        assert_eq!(found, [BuiltinId::MathMax]);
    }

    #[test]
    fn finds_the_keys_of_literals_that_are_assigned_or_defined_together() {
        let found = find(
            r#"
            Object.assign(Date, { now: () => 0 });
            Object.assign(Array.prototype, {}, { includes() {}, ["join"]() {} } as any);
            Object.defineProperties(Math, { random: { value: () => 0.5 } });
            "#,
        );
        let mut expected = vec![
            BuiltinId::DateNow,
            BuiltinId::ArrayPrototypeIncludes,
            BuiltinId::ArrayPrototypeJoin,
            BuiltinId::MathRandom,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
        // The first operand is what is written.
        assert_eq!(find("Object.assign({}, { now: () => 0 }, Date);"), []);
    }

    #[test]
    fn decides_by_binding() {
        let shadowed = r#"
            import { spyOn } from "bun:test";
            const String = { prototype: { indexOf() {} } };
            spyOn(String.prototype, "indexOf");
            String.prototype.indexOf = () => {};
            "#;
        assert_eq!(find(shadowed), []);
        let renamed = r#"
            import { spyOn as watch } from "bun:test";
            const texts = String.prototype;
            const name = "normalize";
            watch(texts, name);
            "#;
        assert_eq!(find(renamed), [BuiltinId::StringPrototypeNormalize]);
    }

    #[test]
    fn takes_an_object_beside_the_name_of_its_member() {
        let text = r#"
            import { stub } from "./my-stubs";
            stub(Array.prototype, "join");
            const rows = [[Map.prototype, "get"], ["keys", Object]];
            const row = { holder: Reflect, key: "has", other: "join" };
            stub(Array.prototype, "mine", "get");
            Object.getOwnPropertyDescriptor(String.prototype, "indexOf");
            console.log(Promise, "race");
            "#;
        let mut expected = vec![
            BuiltinId::ArrayPrototypeJoin,
            BuiltinId::MapPrototypeGet,
            // Every object of a table meets every name of it.
            BuiltinId::MapPrototypeKeys,
            BuiltinId::ObjectKeys,
            BuiltinId::ReflectHas,
        ];
        expected.sort_unstable();
        assert_eq!(find(text), expected);
    }

    #[test]
    fn lets_objects_that_are_handed_on_meet_keys_written_on_some_object() {
        let text = r#"
            const MARK = "__planted";
            const places = () => [["Object.prototype", Object.prototype], ["Array.prototype", Array.prototype], ["Function.prototype", Function.prototype]];
            for (const [, place] of places()) Reflect.set(place, MARK, "here");
            (Object.prototype as any).spelled = 1;
            "#;
        let mut found = look_at_file(b"/project/a.test.ts", text.as_bytes()).names_added;
        found.sort_unstable();
        let name = |holder: BuiltinId, name: &str| OpenedName {
            holder: holder as u32,
            name: name.as_bytes().to_vec(),
        };
        let mut expected = vec![
            name(BuiltinId::ObjectPrototype, "__planted"),
            name(BuiltinId::ObjectPrototype, "spelled"),
            name(BuiltinId::FunctionPrototype, "__planted"),
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn follows_a_key_to_what_the_calls_of_a_function_pass_for_it() {
        let text = r#"
            function plant(name: string, value: string) {
                Object.defineProperty(Object.prototype, name, { value, configurable: true });
                return () => Reflect.deleteProperty(Object.prototype, name);
            }
            function replace(name: string) { (String.prototype as any)[name] = () => 0; }
            plant("HTTPS_PROXY", "http://a.invalid")();
            replace("indexOf");
            replace("split");
            "#;
        let found = look_at_file(b"/project/a.test.ts", text.as_bytes());
        let mut expected = vec![
            BuiltinId::StringPrototypeIndexOf as u32,
            BuiltinId::StringPrototypeSplit as u32,
        ];
        expected.sort_unstable();
        assert_eq!(found.members, expected);
        let mut names = found.names_added;
        names.dedup();
        let planted = OpenedName {
            holder: BuiltinId::ObjectPrototype as u32,
            name: b"HTTPS_PROXY".to_vec(),
        };
        assert_eq!(names, [planted]);
    }

    #[test]
    fn finds_nothing_in_a_file_that_holds_no_code() {
        for (path, text) in [
            (&b"/project/data.json"[..], &br#"{ "a": "orig" }"#[..]),
            (b"/project/types.d.ts", b"export declare const a: number;"),
        ] {
            let found = look_at_file(path, text);
            assert!(found.members.is_empty() && found.files_named.is_empty());
        }
    }

    #[test]
    fn lists_the_files_beside_it_that_it_names() {
        let text = r#"
            import "./a";
            import { b } from "../b.js";
            import "bun:test";
            import "package";
            const c = require("./c.cjs")(b);
            const d = await import("./d.ts");
            new Worker(new URL("./worker.ts", import.meta.url));
            "#;
        let mut found = look_at_file(b"/project/a.test.ts", text.as_bytes()).files_named;
        found.sort_unstable();
        let expected: [&[u8]; 5] = [b"../b.js", b"./a", b"./c.cjs", b"./d.ts", b"./worker.ts"];
        assert_eq!(found, expected);
    }

    #[test]
    fn takes_members_that_are_constant_unless_written_and_passes_by_new_names() {
        let text = r#"
            import { spyOn } from "bun:test";
            Array.prototype.last = function () {};
            Date.now = () => 0;
            spyOn(console, "log");
            "#;
        let mut expected = vec![BuiltinId::DateNow, BuiltinId::ConsoleLog];
        expected.sort_unstable();
        assert_eq!(find(text), expected);
    }
}
