mod code_unit_order;

use super::testing::{
    bind_whole_program, describe_module, file_named, with_graph, with_graph_of_test_files,
    with_runtime_graph,
};
use super::*;
use crate::builtins::RuntimeModule;
use bstr::BStr;
use bun_sema::atom::Atom;
use bun_sema::hir::ImportId;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::resolve::ExternalKind;
use bun_sema::session::Session;

const PROGRAM: [(&str, &str); 12] = [
    (
        "main.ts",
        "import { a, shared } from './a';\n\
         import * as barrel from './barrel';\n\
         import legacy, { named } from './legacy.cjs';\n\
         import data from './data.json';\n\
         import { missing } from './b';\n\
         import './nope';\n\
         import { late } from './late';\n\
         import dynamic from './plain.js';\n\
         import { deep } from './deep';\n\
         console.log(a, shared, barrel, legacy, named, data, missing, late, dynamic, deep);\n\
         import('./lazy');\n\
         import('./gone');\n",
    ),
    (
        "a.ts",
        "import { b } from './b';\n\
         export const a = () => b;\n\
         export { shared } from './shared';\n",
    ),
    (
        "b.ts",
        "import { a } from './a';\nexport const b = () => a;\n",
    ),
    ("shared.ts", "export const shared = 1;\n"),
    (
        "barrel.ts",
        "export * from './shared';\n\
         export * from './legacy.cjs';\n\
         export * from './other.cjs';\n\
         export * as nested from './a';\n",
    ),
    ("legacy.cjs", "exports.named = require('./other.cjs');\n"),
    ("other.cjs", "exports.other = 2;\n"),
    ("data.json", "{ \"x\": 1 }\n"),
    ("late.ts", "export const late = await 1;\n"),
    (
        "plain.js",
        "import { dynamic } from './barrel';\nexport default dynamic;\n",
    ),
    (
        "deep.ts",
        "export * from './barrel';\nexport const deep = 1;\n",
    ),
    ("lazy.ts", "export default 1;\n"),
];

type FailureKey = (FileId, ImportSiteKind, u32, u32, Option<ModuleRef>, Atom);

fn failure_key(failure: &ModuleFailure) -> FailureKey {
    let (exporter, name) = match failure.kind {
        ModuleFailureKind::Unresolved { specifier, .. }
        | ModuleFailureKind::UnresolvedAtLoad { specifier, .. } => (None, specifier),
        ModuleFailureKind::NotAProgram { .. } => (None, bun_sema::atom::known::default),
        ModuleFailureKind::ExportNotFound { exporter, name }
        | ModuleFailureKind::ExportAmbiguous { exporter, name }
        | ModuleFailureKind::ExportMayBeAbsent { exporter, name, .. } => (Some(exporter), name),
    };
    let ModuleFailure {
        importer,
        site,
        start,
        end,
        ..
    } = *failure;
    (importer, site, start, end, exporter, name)
}

fn failure_keys(failures: &[ModuleFailure]) -> Vec<FailureKey> {
    failures.iter().map(failure_key).collect()
}

fn only<T: core::fmt::Debug>(list: &[T]) -> &T {
    let [item] = list else {
        panic!("the list is {list:?}");
    };
    item
}

fn check_entry_points(graph: &ModuleGraph, input: &BindInput<'_, '_>) {
    assert!(!input.sources.entry_points().is_empty());
    for entry_point in input.sources.entry_points() {
        let is_library = entry_point.kind == EntryPointKind::Library;
        assert_eq!(graph.is_library(entry_point.file), is_library);
        assert!(!is_library || graph.exports(entry_point.file).is_empty());
    }
    for &file in graph.record_files() {
        let module = match input.sources.kind(file) {
            SourceKind::RuntimeModule(module) => Some(module),
            _ => None,
        };
        assert_eq!(graph.runtime_module(file), module);
        let is_runtime_source = graph.kind(file) == ModuleKind::RuntimeSource;
        assert_eq!(is_runtime_source, module.is_some());
    }
}

#[test]
fn variant_decides_module_order() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let ascending = [
        ModuleRef::File(FileId(7)),
        ModuleRef::Runtime(RuntimeModule::NodeFs),
        ModuleRef::External {
            importer: FileId(0),
            specifier: atoms.intern(b"a"),
            type_attribute: None,
        },
    ];
    for (a_position, &a) in ascending.iter().enumerate() {
        for (b_position, &b) in ascending.iter().enumerate() {
            let expected = a_position.cmp(&b_position);
            assert_eq!(compare_modules(a, b, &atoms), expected, "{a:?} {b:?}");
        }
    }
}

#[test]
fn files_and_runtime_modules_ascend_by_number() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let (low, high) = (ModuleRef::File(FileId(1)), ModuleRef::File(FileId(2)));
    assert_eq!(compare_modules(low, high, &atoms), Ordering::Less);
    assert_eq!(compare_modules(high, low, &atoms), Ordering::Greater);
    let (fs, path) = (RuntimeModule::NodeFs, RuntimeModule::NodePath);
    let order = compare_modules(ModuleRef::Runtime(fs), ModuleRef::Runtime(path), &atoms);
    assert_eq!(order, fs.cmp(&path));
}

#[test]
fn externals_ascend_by_importer_then_specifier_bytes() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let external = |importer, specifier| ModuleRef::External {
        importer: FileId(importer),
        specifier,
        type_attribute: None,
    };
    let (b_specifier, a_specifier) = (atoms.intern(b"./b"), atoms.intern(b"./a"));
    assert!(b_specifier.0 < a_specifier.0);
    let (a, b) = (external(1, a_specifier), external(1, b_specifier));
    let ab = external(1, atoms.intern(b"./ab"));
    let later_importer = external(2, a_specifier);
    assert_eq!(compare_modules(a, b, &atoms), Ordering::Less);
    assert_eq!(compare_modules(b, a, &atoms), Ordering::Greater);
    assert_eq!(compare_modules(a, a, &atoms), Ordering::Equal);
    assert_eq!(compare_modules(a, ab, &atoms), Ordering::Less);
    assert_eq!(compare_modules(b, later_importer, &atoms), Ordering::Less);
}

#[test]
fn task_order_does_not_change_graph() {
    with_graph(&PROGRAM, |graph, input| {
        let in_reverse =
            |count: usize, work: &(dyn Fn(usize) + Sync)| (0..count).rev().for_each(work);
        let reversed_input = BindInput {
            in_parallel: &in_reverse,
            ..*input
        };
        let reversed = bind_whole_program(&reversed_input);
        for (name, _) in PROGRAM {
            assert_eq!(
                describe_module(&reversed, input, name),
                describe_module(graph, input, name),
                "{name}"
            );
        }
        assert!(!graph.errors().is_empty());
        assert_eq!(
            failure_keys(reversed.errors()),
            failure_keys(graph.errors())
        );
        assert!(!graph.failures().is_empty());
        assert_eq!(
            failure_keys(reversed.failures()),
            failure_keys(graph.failures())
        );
        assert!(!graph.synthetic_exports().is_empty());
        assert_eq!(reversed.synthetic_exports(), graph.synthetic_exports());
        assert_eq!(reversed.record_files(), graph.record_files());
        assert_eq!(reversed.other_modules(), graph.other_modules());
    });
}

#[test]
fn failed_statements_are_errors_and_failed_calls_are_failures() {
    with_graph(&PROGRAM, |graph, input| {
        let main = file_named(input, "main.ts");
        let atom = |text: &str| input.files.atoms.intern(text.as_bytes());
        let error_names: Vec<_> = failure_keys(graph.errors())
            .into_iter()
            .map(|(importer, site, _, _, exporter, name)| (importer, site, exporter, name))
            .collect();
        let exporter = ModuleRef::File(file_named(input, "b.ts"));
        let import = |id| ImportSiteKind::Import(ImportId(id));
        let expected = [
            (main, import(4), Some(exporter), atom("missing")),
            (main, import(5), None, atom("./nope")),
        ];
        assert_eq!(error_names, expected);
        for error in graph.errors() {
            assert_eq!(error.effect(), FailureEffect::StopsBuild);
        }
        let failure = only(graph.failures());
        assert_eq!(failure.effect(), FailureEffect::ThrowsAtSite);
        assert_eq!(failure.importer, main);
        assert!(matches!(failure.site, ImportSiteKind::ImportCall(_)));
        assert!(matches!(
            failure.kind,
            ModuleFailureKind::Unresolved { specifier, .. } if specifier == atom("./gone")
        ));
        let answer = graph.site_answer(main, failure.site);
        assert_eq!(answer, SiteAnswer::Failed(ModuleFailureId(0)));
    });
}

#[test]
fn import_that_names_nothing_fails_the_load_of_what_only_a_late_site_loads() {
    let files = [
        (
            "main.js",
            "import('./above.js').catch(() => {}); import('./fine.js');",
        ),
        (
            "above.js",
            "import './sibling.js'; import './broken.js'; console.log(1);",
        ),
        ("sibling.js", "console.log(2);"),
        (
            "broken.js",
            "import './fine.js'; import x from './gone.js'; console.log(x);",
        ),
        ("fine.js", "export {};"),
    ];
    with_graph(&files, |graph, input| {
        let file = |name: &str| file_named(input, name);
        assert!(graph.errors().is_empty(), "{:?}", graph.errors());
        let failure = only(graph.failures());
        assert!(matches!(
            failure.kind,
            ModuleFailureKind::UnresolvedAtLoad { .. }
        ));
        assert_eq!(failure.effect(), FailureEffect::ThrowsAtSite);
        assert_eq!(failure.importer, file("broken.js"));
        let names = ["main.js", "above.js", "sibling.js", "broken.js", "fine.js"];
        let thrown = Some(ModuleFailureId(0));
        let load_failures = names.map(|name| graph.load_failure(file(name)));
        assert_eq!(load_failures, [None, thrown, None, thrown, None]);
        let targets = |name: &str| -> Vec<ModuleRef> {
            let requests = graph.requests(file(name)).iter();
            requests.map(|request| request.target).collect()
        };
        assert_eq!(targets("above.js"), [ModuleRef::File(file("broken.js"))]);
        assert!(targets("broken.js").is_empty());
        for name in ["above.js", "broken.js"] {
            let hir = input.files.hir(file(name));
            let is_erased = |statement| graph.erased(file(name), statement);
            assert!(hir.ids(hir.body).all(is_erased), "{name}");
        }
    });
}

#[test]
fn typescript_module_is_bound_without_the_exports_that_find_nothing_where_the_run_drops_them() {
    let files = [
        (
            "main.js",
            "import './again.ts'; import './imported.ts'; import './file.ts'; import './again.js';",
        ),
        ("esm.js", "export const one = 1;"),
        ("file.cjs", "exports[name()] = 1;"),
        ("again.ts", "export { absent, one } from './esm.js';"),
        (
            "imported.ts",
            "import { absent, one } from './esm.js'; export { absent, one };",
        ),
        ("file.ts", "export { perhaps } from './file.cjs';"),
        ("again.js", "export { absent } from './esm.js';"),
    ];
    with_graph(&files, |graph, input| {
        let file = |name: &str| file_named(input, name);
        let importers = |graph: &ModuleGraph| -> Vec<FileId> {
            let failures = graph.errors().iter().chain(graph.failures());
            failures.map(|failure| failure.importer).collect()
        };
        let every_importer = ["again.ts", "imported.ts", "file.ts", "again.js"].map(file);
        let mut failing = importers(graph);
        failing.sort_unstable();
        let mut expected = every_importer.to_vec();
        expected.sort_unstable();
        assert_eq!(failing, expected);

        let graph = bind_whole_program(&BindInput {
            typescript_drops_absent_exports: true,
            ..*input
        });
        assert_eq!(importers(&graph), [file("again.js")]);
        let names_of = |name: &str| -> Vec<&BStr> {
            let exports = graph.exports(file(name)).iter();
            exports
                .map(|export| BStr::new(input.files.atoms.bytes(export.name)))
                .collect()
        };
        assert_eq!(names_of("again.ts"), ["one"]);
        assert_eq!(names_of("imported.ts"), ["one"]);
        let [perhaps] = graph.exports(file("file.ts")) else {
            panic!("file.ts does not have exactly one export");
        };
        let ExportBinding::Synthetic(copy) = perhaps.binding else {
            panic!("{:?}", perhaps.binding);
        };
        assert!(graph.commonjs().may_stay_empty(copy));
    });
}

#[test]
fn import_that_names_nothing_stops_the_build_where_an_entry_point_reaches_it() {
    let files = [
        (
            "main.js",
            "import './above.js'; import('./broken.js').catch(() => {});",
        ),
        ("above.js", "import './broken.js';"),
        ("broken.js", "import x from './gone.js'; console.log(x);"),
    ];
    with_graph(&files, |graph, input| {
        let error = only(graph.errors());
        assert!(matches!(error.kind, ModuleFailureKind::Unresolved { .. }));
        assert_eq!(error.effect(), FailureEffect::StopsBuild);
        assert_eq!(error.importer, file_named(input, "broken.js"));
        assert_eq!(graph.unloadable_files().count(), 0);
    });
}

#[test]
fn import_that_names_nothing_stops_the_build_though_late_modules_reach_it_too() {
    let files = [
        (
            "main.js",
            "import './broken.js'; import('./above.js').catch(() => {});",
        ),
        ("above.js", "import './late.js';"),
        ("late.js", "import './broken.js';"),
        ("broken.js", "import x from './gone.js'; console.log(x);"),
    ];
    with_graph(&files, |graph, input| {
        let error = only(graph.errors());
        assert!(matches!(error.kind, ModuleFailureKind::Unresolved { .. }));
        assert_eq!(error.importer, file_named(input, "broken.js"));
        assert!(graph.failures().is_empty(), "{:?}", graph.failures());
        assert_eq!(graph.unloadable_files().count(), 0);
    });
}

#[test]
fn name_that_a_module_lacks_is_no_error_in_a_module_whose_load_fails() {
    let files = [
        (
            "main.js",
            "import('./broken.js').catch(() => {}); import('./whole.js').catch(() => {});",
        ),
        (
            "broken.js",
            "import { absent } from './fine.js'; import './gone.js'; console.log(absent);",
        ),
        (
            "whole.js",
            "import { absent } from './fine.js'; console.log(absent);",
        ),
        ("fine.js", "export {};"),
    ];
    with_graph(&files, |graph, input| {
        let error = only(graph.errors());
        assert!(matches!(
            error.kind,
            ModuleFailureKind::ExportNotFound { .. }
        ));
        assert_eq!(error.importer, file_named(input, "whole.js"));
    });
}

#[test]
fn link_that_fails_behind_a_computed_name_is_left_to_the_run() {
    let files = [
        (
            "main.js",
            "for (const name of ['lacks.js', 'hands-on.js', 'torn.js']) await import('./' + name);",
        ),
        (
            "lacks.js",
            "import { absent } from './fine.js'; console.log(absent);",
        ),
        ("hands-on.js", "export { absent } from './fine.js';"),
        (
            "torn.js",
            "import { twice } from './stars.js'; console.log(twice);",
        ),
        (
            "stars.js",
            "export * from './fine.js'; export * from './other.js';",
        ),
        ("fine.js", "export const twice = 1;"),
        ("other.js", "export const twice = 2;"),
    ];
    with_graph(&files, |graph, input| {
        assert!(graph.errors().is_empty(), "{:?}", graph.errors());
        for (importer, exporter) in [
            ("lacks.js", "fine.js"),
            ("hands-on.js", "fine.js"),
            ("torn.js", "stars.js"),
        ] {
            let required = only(graph.required_names(file_named(input, importer)));
            assert_eq!(
                required.module,
                ModuleRef::File(file_named(input, exporter))
            );
            assert_eq!(required.asked_by.is_some(), importer == "hands-on.js");
        }
    });
}

#[test]
fn only_es_modules_with_live_await_have_top_level_await() {
    let files = [
        (
            "main.js",
            "import './late.js'; import './dead.js'; import './nested.js'; import './legacy.cjs';",
        ),
        ("late.js", "export const late = await 1;"),
        ("dead.js", "if (false) await 1; export {};"),
        ("nested.js", "export const nested = async () => await 1;"),
        ("legacy.cjs", "exports.x = 1;"),
    ];
    with_graph(&files, |graph, input| {
        let expected = [
            ("main.js", false),
            ("late.js", true),
            ("dead.js", false),
            ("nested.js", false),
            ("legacy.cjs", false),
        ];
        for (name, has_await) in expected {
            let file = file_named(input, name);
            assert_eq!(graph.has_top_level_await(file), has_await, "{name}");
        }
    });
}

#[test]
fn entry_point_kind_and_source_kind_reach_graph() {
    let files = [("main.ts", "import 'node:path';\nexport {};\n")];
    with_graph(&files, |graph, input| {
        check_entry_points(graph, input);
        let main = file_named(input, "main.ts");
        let entry_points = input.sources.entry_points();
        assert_eq!(entry_points.len(), 1);
        assert_eq!(entry_points[0].file, main);
        assert_eq!(entry_points[0].kind, EntryPointKind::Main);
    });
    with_runtime_graph(&files, |graph, input| {
        check_entry_points(graph, input);
        let has_kind = |kind| {
            let mut entry_points = input.sources.entry_points().iter();
            entry_points.any(|entry_point| entry_point.kind == kind)
        };
        assert!(has_kind(EntryPointKind::Library));
        assert!(has_kind(EntryPointKind::ImportedModule));
        let path_source = file_named(input, "/$bun/js/node/path.ts");
        let path = Some(RuntimeModule::NodePath);
        assert_eq!(graph.runtime_module(path_source), path);
    });
}

#[test]
fn external_package_no_site_names_has_a_module() {
    with_graph(&[("main.js", "export {};\n")], |graph, input| {
        assert!(graph.other_modules().is_empty());
        let packages = [b"outside".to_vec()];
        let input_with_package = BindInput {
            external_packages: &packages,
            ..*input
        };
        let graph = bind_whole_program(&input_with_package);
        let outside = ModuleRef::External {
            importer: file_named(input, "main.js"),
            specifier: input.files.atoms.intern(b"outside"),
            type_attribute: None,
        };
        assert_eq!(graph.other_modules(), [outside]);
        let uncompiled_code = Some(ExternalKind::UncompiledCode);
        assert_eq!(graph.external_kind(outside), uncompiled_code);
    });
}

#[test]
fn declared_side_effects_can_be_ignored() {
    let files = [
        ("main.mjs", "import 'lib';\n"),
        (
            "node_modules/lib/package.json",
            r#"{ "name": "lib", "version": "1.0.0", "main": "index.js", "sideEffects": false }"#,
        ),
        ("node_modules/lib/index.js", "console.log(1);\n"),
    ];
    with_graph(&files, |graph, input| {
        let lib = file_named(input, "node_modules/lib/index.js");
        assert!(graph.has_no_side_effects(lib));
        let ignoring = BindInput {
            ignores_declared_side_effects: true,
            ..*input
        };
        assert!(!bind_whole_program(&ignoring).has_no_side_effects(lib));
    });
}

#[test]
fn computed_import_lists_all_the_files_that_it_means() {
    let main = "export const load = (name) => import(`./pages/${name}.js`);\n";
    let page_names: Vec<String> = (0..1500).map(|page| format!("pages/{page}.js")).collect();
    let mut files = vec![("main.js", main)];
    let pages = page_names.iter();
    files.extend(pages.map(|name| (name.as_str(), "export {};\n")));
    with_graph(&files, |graph, input| {
        let main = file_named(input, "main.js");
        let site = only(input.files.analysis(main).import_sites);
        let answer = graph.site_answer(main, site.kind);
        let SiteAnswer::Computed(Candidates::Modules(listed)) = answer else {
            panic!("{answer:?}");
        };
        assert_eq!(listed.len(), page_names.len());
    });
}

fn library_names_required_by(
    graph: &ModuleGraph,
    input: &BindInput<'_, '_>,
    file: &str,
) -> Vec<String> {
    let required_names = graph.required_names(file_named(input, file)).iter();
    let mut names: Vec<String> = required_names
        .map(|required| {
            assert!(matches!(required.module, ModuleRef::Runtime(_)));
            BStr::new(input.files.atoms.bytes(required.name)).to_string()
        })
        .collect();
    names.sort();
    names
}

#[test]
fn a_module_says_which_names_it_binds_that_the_table_of_a_library_module_does_not_list() {
    let program = [
        (
            "main.js",
            "import { existsSync } from \"node:fs\";\nexistsSync(\"/\");\nimport(\"./binds.js\");\nimport(\"./barrel.js\");\nimport(\"./through.js\");\nimport(\"./members.js\");\nimport(\"./required.cjs\");\n",
        ),
        (
            "binds.js",
            "import { unlisted, statSync } from \"node:fs\";\nconsole.log(unlisted, statSync);\n",
        ),
        (
            "barrel.js",
            "export { handedOn, statSync } from \"node:fs\";\n",
        ),
        (
            "through.js",
            "import { handedOn } from \"./barrel.js\";\nconsole.log(handedOn);\n",
        ),
        (
            "members.js",
            "import * as fs from \"node:fs\";\nconsole.log(fs.unlisted);\n",
        ),
        (
            "required.cjs",
            "const { unlisted } = require(\"node:fs\");\nconsole.log(unlisted);\n",
        ),
    ];
    with_graph(&program, |graph, input| {
        let names_bound_by = |file| library_names_required_by(graph, input, file);
        assert_eq!(names_bound_by("main.js"), [""; 0]);
        assert_eq!(names_bound_by("binds.js"), ["unlisted"]);
        assert_eq!(names_bound_by("barrel.js"), ["handedOn"]);
        assert_eq!(names_bound_by("through.js"), ["handedOn"]);
        assert_eq!(names_bound_by("members.js"), [""; 0]);
        assert_eq!(names_bound_by("required.cjs"), [""; 0]);
    });
}

#[test]
fn a_module_says_which_deferred_exports_of_the_library_it_binds() {
    let program = [
        (
            "main.js",
            "import { existsSync } from \"node:fs\";\nexistsSync(\"/\");\nimport(\"./rest.js\");\nimport(\"./barrel.js\");\nimport(\"./through.js\");\nimport(\"./members.js\");\nimport(\"./required.cjs\");\nimport(\"./defined.js\");\n",
        ),
        (
            "rest.js",
            "import { promises, WriteStream, readFileSync } from \"node:fs\";\nconsole.log(promises, WriteStream, readFileSync);\n",
        ),
        (
            "barrel.js",
            "export { ReadStream, statSync } from \"node:fs\";\n",
        ),
        (
            "through.js",
            "import { ReadStream } from \"./barrel.js\";\nconsole.log(ReadStream);\n",
        ),
        (
            "members.js",
            "import * as fs from \"node:fs\";\nconsole.log(fs.WriteStream, fs.statSync);\n",
        ),
        (
            "required.cjs",
            "const { WriteStream } = require(\"node:fs\");\nconsole.log(WriteStream);\n",
        ),
        (
            "defined.js",
            "import { AssertionError, ok } from \"node:assert\";\nconsole.log(AssertionError, ok);\n",
        ),
    ];
    with_graph(&program, |graph, input| {
        let deferred = [
            (RuntimeModule::NodeFs, "promises", true),
            (RuntimeModule::NodeFs, "WriteStream", true),
            (RuntimeModule::NodeFs, "existsSync", false),
            (RuntimeModule::NodePath, "promises", false),
            (RuntimeModule::NodeAssert, "AssertionError", true),
            (RuntimeModule::NodeAssert, "ok", false),
        ];
        for (module, name, expected) in deferred {
            let is_deferred = input.deferred_exports.contains(module, name.as_bytes());
            assert_eq!(is_deferred, expected, "{module:?} {name}");
        }
        let names_bound_by = |file| library_names_required_by(graph, input, file);
        assert_eq!(names_bound_by("main.js"), [""; 0]);
        assert_eq!(names_bound_by("rest.js"), ["WriteStream", "promises"]);
        assert_eq!(names_bound_by("barrel.js"), ["ReadStream"]);
        assert_eq!(names_bound_by("through.js"), ["ReadStream"]);
        assert_eq!(names_bound_by("members.js"), [""; 0]);
        assert_eq!(names_bound_by("required.cjs"), [""; 0]);
        assert_eq!(names_bound_by("defined.js"), ["AssertionError"]);
    });
}

#[test]
fn every_export_of_a_native_module_that_mirrors_an_object_may_be_deferred() {
    let list = include_str!("../../jsc/modules/NativeModuleList.h");
    let (_, list) = list
        .split_once("#define BUN_FOREACH_LAZY_ESM_NATIVE_MODULE(macro)")
        .expect("the host lists its lazy native modules");
    let entries = list
        .lines()
        .skip(1)
        .map_while(|line| line.trim().strip_prefix("macro(\""));
    let specifiers: Vec<&str> = entries
        .filter_map(|entry| Some(entry.split_once('"')?.0))
        .collect();
    assert_eq!(specifiers, ["node:module", "node:process", "bun"]);
    let deferred_exports = DeferredExports::default();
    for specifier in specifiers {
        let module = crate::builtins::table::module_by_specifier(specifier.as_bytes());
        let module = module.expect("the table has every native module");
        assert!(deferred_exports.contains(module, b"stdout"), "{specifier}");
    }
    assert!(!deferred_exports.contains(RuntimeModule::NodeFs, b"stdout"));
}

#[test]
fn each_test_file_with_a_loader_of_its_own_says_which_type_comes_first() {
    let files = [
        (
            "a.test.js",
            "import near from './conf.txt' with { type: 'jsonc' };\nimport { held } from './below.js';\nconsole.log(near, held);\n",
        ),
        (
            "b.test.js",
            "import { held } from './below.js';\nconsole.log(held);\n",
        ),
        (
            "c.test.js",
            "import alone from './alone.txt' with { type: 'jsonc' };\nconsole.log(alone);\n",
        ),
        (
            "below.js",
            "import held from './conf.txt' with { type: 'text' };\nexport { held };\n",
        ),
        ("conf.txt", "{ \"port\": 21 }\n"),
        ("alone.txt", "{ \"port\": 21 }\n"),
    ];
    with_graph_of_test_files(&files, 3, 0, |graph, input| {
        let types_left_to_loader = |graph: &ModuleGraph, name: &str| -> Vec<_> {
            let requests = graph.requests(file_named(input, name)).iter();
            let left = requests.filter_map(|request| match request.target {
                ModuleRef::External { type_attribute, .. } => Some(type_attribute),
                _ => None,
            });
            left.collect()
        };
        let is_loaded_by_loader = |graph: &ModuleGraph, name: &str| {
            graph.is_loaded_by_loader(ModuleRef::File(file_named(input, name)))
        };
        for name in ["a.test.js", "b.test.js", "c.test.js", "below.js"] {
            assert!(types_left_to_loader(graph, name).is_empty(), "{name}");
            assert!(!is_loaded_by_loader(graph, name), "{name}");
        }
        let graph = bind_whole_program(&BindInput {
            runs_in_several_realms: true,
            ..*input
        });
        let (jsonc, text) = (Some(bun_ast::Loader::Jsonc), Some(bun_ast::Loader::Text));
        assert_eq!(types_left_to_loader(&graph, "a.test.js"), [jsonc]);
        assert_eq!(types_left_to_loader(&graph, "below.js"), [text]);
        for name in ["a.test.js", "b.test.js", "below.js"] {
            assert!(is_loaded_by_loader(&graph, name), "{name}");
        }
        assert!(types_left_to_loader(&graph, "c.test.js").is_empty());
        assert!(!is_loaded_by_loader(&graph, "c.test.js"));
    });
}

#[test]
fn a_preload_says_in_front_of_the_test_files_which_type_comes_first() {
    let files = [
        (
            "a.test.js",
            "import near from './conf.txt' with { type: 'jsonc' };\nconsole.log(near);\n",
        ),
        (
            "first.js",
            "import conf from './conf.txt' with { type: 'text' };\nconsole.log(conf);\n",
        ),
        ("conf.txt", "{ \"port\": 21 }\n"),
    ];
    with_graph_of_test_files(&files, 1, 1, |graph, input| {
        for name in ["a.test.js", "first.js"] {
            let requests = graph.requests(file_named(input, name)).iter();
            let forms = requests.filter_map(|request| match request.target {
                ModuleRef::File(form) => Some(input.sources.public_path(form)),
                _ => None,
            });
            let forms: Vec<&[u8]> = forms.collect();
            assert!(
                matches!(forms[..], [form] if !form.ends_with(b"?jsonc")),
                "{name}"
            );
        }
    });
}

#[test]
fn a_module_says_which_exports_of_the_process_object_it_binds() {
    let program = [
        (
            "main.js",
            "import process, { platform } from \"node:process\";\nconsole.log(process, platform);\nimport(\"./rest.js\");\n",
        ),
        (
            "rest.js",
            "import { stdout, stderr } from \"process\";\nconsole.log(stdout, stderr);\n",
        ),
    ];
    with_graph(&program, |graph, input| {
        let required_names = graph.required_names(file_named(input, "rest.js")).iter();
        let mut names: Vec<String> = required_names
            .map(|required| {
                assert_eq!(
                    required.module,
                    ModuleRef::Runtime(RuntimeModule::NodeProcess)
                );
                BStr::new(input.files.atoms.bytes(required.name)).to_string()
            })
            .collect();
        names.sort();
        assert_eq!(names, ["stderr", "stdout"]);
    });
}
