use super::{Marked, declared_key, mark_fragments};
use crate::ir::{FunctionKey, Program, VariableKey};
use crate::link::testing::{
    Projects, TestUnit, find_file, link_sources_without_bun_modules,
    with_projects_without_bun_modules, with_test_files,
};
use crate::modules::{ExportBinding, ModuleFailureId, ModuleRef};
use bun_sema::hir::FnId;
use bun_sema::program::FileId;

fn mark_main_and_first(projects: &Projects<'_, '_>, [main, first]: [FileId; 2]) -> Marked {
    let mut main_unit = TestUnit::new(main);
    main_unit.define_body(|_| {});
    let mut first_unit = TestUnit::new(first);
    first_unit.define_body(|_| {});
    let marked = mark_fragments(projects, [main_unit.finish(), first_unit.finish()]);
    assert!(marked.errors.is_empty(), "{:?}", marked.errors);
    marked
}

#[test]
fn entry_point_body_is_a_root() {
    with_test_files(|projects, [main, first, _]| {
        let marked = mark_main_and_first(projects, [main, first]);
        assert!(marked.has_function(FunctionKey::ModuleBody(main)));
    });
}

#[test]
fn module_no_retained_code_names_is_kept() {
    with_test_files(|projects, [main, first, _]| {
        let marked = mark_main_and_first(projects, [main, first]);
        assert!(marked.has_function(FunctionKey::ModuleBody(first)));
    });
}

#[test]
fn body_of_a_further_record_is_a_root() {
    with_test_files(|projects, [main, first, _]| {
        let mut main_unit = TestUnit::new(main);
        main_unit.define_body(|_| {});
        let mut first_unit = TestUnit::new(first);
        first_unit.define_body(|_| {});
        first_unit.define_function(3, |_| {});
        first_unit.define_function(4, |_| {});
        first_unit.fragment.declare_module(ModuleRef::Inner {
            file: first,
            callback: FnId(3),
        });
        first_unit.fragment.declare_module(ModuleRef::Check(first));

        let marked = mark_fragments(projects, [main_unit.finish(), first_unit.finish()]);

        assert!(marked.has_source_function(first, 3));
        assert!(!marked.has_source_function(first, 4));
        assert_eq!(
            marked.undefined_functions(),
            [(FunctionKey::CheckBody(first), first)]
        );
    });
}

#[test]
fn reports_undefined_exported_variable() {
    let files = [
        ("main.js", "export {};\nimport('./library.js');\n"),
        ("library.js", "export const value = 1;\n"),
    ];
    with_projects_without_bun_modules(&files, |projects| {
        let [main, library] = ["main.js", "library.js"].map(|name| find_file(projects, name));
        let [export] = projects.application.graph.exports(library) else {
            panic!("library.js has one export");
        };
        let ExportBinding::Variable(symbol) = export.binding else {
            panic!("{:?}", export.binding);
        };
        let mut unit = TestUnit::new(main);
        let (referrer, target) = (
            unit.module,
            unit.fragment.declare_module(ModuleRef::File(library)),
        );
        unit.define_body(|builder| {
            builder.import_module(target, referrer);
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        let expected = [(declared_key(VariableKey::Symbol(symbol)), library)];
        assert_eq!(marked.undefined_variables(), expected);
    });
}

fn mark_failed_require(throws_in_body: bool) -> bool {
    let files = [
        ("main.js", "export {};\nimport('./loader.js');\n"),
        (
            "loader.js",
            "export {};\ntry {\n  require('./missing.js');\n} catch {}\n",
        ),
    ];
    with_projects_without_bun_modules(&files, |projects| {
        let [main, loader] = ["main.js", "loader.js"].map(|name| find_file(projects, name));
        let [failure] = projects.application.graph.failures() else {
            panic!("the program has one failed require");
        };
        assert_eq!(failure.importer, loader);
        let mut unit = TestUnit::new(main);
        let failure = unit.fragment.declare_module_failure(ModuleFailureId(0));
        let thrower = unit.define_function(1, |builder| {
            builder.throw_module_failure(failure, false);
        });
        unit.define_body(|builder| {
            if throws_in_body {
                builder.call_direct(thrower, &[]);
            }
        });

        let marked = mark_fragments(projects, [unit.finish()]);

        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        marked.retained.module_failures.application[0]
    })
}

#[test]
fn failure_in_retained_function_is_kept() {
    assert!(mark_failed_require(true));
}

#[test]
fn failure_in_dropped_function_is_dropped() {
    assert!(!mark_failed_require(false));
}

fn link_program(files: &[(&str, &str)]) -> Program {
    let linked = link_sources_without_bun_modules(files);
    linked.expect("the program links").program
}

fn has_function_named(program: &Program, name: &[u8]) -> bool {
    let mut names = program
        .functions
        .iter()
        .filter_map(|function| function.name);
    names.any(|id| program.strings.get(id) == name)
}

fn export_names<'p>(program: &'p Program, path_suffix: &str) -> Vec<&'p [u8]> {
    let mut records = program.modules.iter();
    let record = records.find(|record| {
        let path = program.strings.get(record.path);
        path.ends_with(path_suffix.as_bytes())
    });
    let exports = record.expect("no module has this path").exports.iter();
    exports
        .map(|export| program.strings.get(export.name))
        .collect()
}

const LIBRARY: (&str, &str) = (
    "library.js",
    "export function libraryFirst() {}\nexport function librarySecond() {}\n",
);

#[test]
fn export_nobody_reads_is_no_export() {
    let program = link_program(&[("main.js", "import './library.js';\n"), LIBRARY]);
    assert!(export_names(&program, "library.js").is_empty());
}

#[test]
fn function_only_dropped_code_names_is_dropped() {
    let library = "export function exported() {}\nfunction internal() {\n  return internal;\n}\n";
    let files = [
        ("main.js", "import './library.js';\n"),
        ("library.js", library),
    ];
    let program = link_program(&files);
    assert!(has_function_named(&program, b"exported"));
    assert!(!has_function_named(&program, b"internal"));
}

#[test]
fn namespace_object_keeps_every_export() {
    let main = "import * as library from './library.js';\nconsole.log(library);\n";
    let program = link_program(&[("main.js", main), LIBRARY]);
    assert!(has_function_named(&program, b"libraryFirst"));
    assert!(has_function_named(&program, b"librarySecond"));
}

const ENTRY_POINT_WITH_EXPORTS: [(&str, &str); 2] = [
    (
        "main.js",
        "import './library.js';\nexport function entryUnread() {}\nexport default { port: 1 };\n",
    ),
    LIBRARY,
];

#[test]
fn entry_point_export_the_host_does_not_read_is_kept() {
    let program = link_program(&ENTRY_POINT_WITH_EXPORTS);
    assert!(has_function_named(&program, b"entryUnread"));
    let names: [&[u8]; 2] = [b"default", b"entryUnread"];
    assert_eq!(export_names(&program, "main.js"), names);
}
