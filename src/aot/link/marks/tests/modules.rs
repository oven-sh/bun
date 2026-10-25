use super::{declared_key, mark_fragments};
use crate::ir::{FunctionKey, VariableKey};
use crate::link::testing::{
    TestUnit, find_file, with_projects_without_bun_modules, with_test_files,
};
use crate::modules::{ExportBinding, ModuleFailureId, ModuleRef};
use bun_sema::hir::FnId;

#[test]
fn bodies_of_the_entry_point_and_of_a_module_no_retained_code_names_are_roots() {
    with_test_files(|projects, [main, first, _]| {
        let mut main_unit = TestUnit::new(main);
        main_unit.define_body(|_| {});
        let mut first_unit = TestUnit::new(first);
        first_unit.define_body(|_| {});
        let marked = mark_fragments(projects, [main_unit.finish(), first_unit.finish()]);
        assert!(marked.errors.is_empty(), "{:?}", marked.errors);
        assert!(marked.has_function(FunctionKey::ModuleBody(main)));
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
fn failure_is_kept_only_where_a_retained_function_throws_it() {
    assert!(mark_failed_require(true));
    assert!(!mark_failed_require(false));
}
