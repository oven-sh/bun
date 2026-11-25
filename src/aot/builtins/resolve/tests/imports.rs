use super::super::{ModuleExport, find_module_export};
use super::*;
use crate::builtins::table::{ModuleFlags, RuntimeFunction};
use std::fmt::Write;

case_tests! {
    named_import_without_source: PROGRAM, "import { heapStats as h } from \"bun:jsc\"; h();", |case| {
        assert_eq!(case.symbol_id("h"), Some(jsc_heap_stats()));
        assert_builtin(case, "h", jsc_heap_stats());
        assert!(case.mentions(jsc_namespace()));
    };
    namespace_and_default: PROGRAM, "import * as jsc from \"bun:jsc\"; import d from \"bun:jsc\"; jsc.heapStats; d;", |case| {
        assert_builtin(case, "jsc.heapStats", jsc_heap_stats());
        assert_builtin(case, "d", jsc_namespace());
    };
    module_with_source: PROGRAM, "import { readFileSync } from \"node:fs\"; readFileSync;", |case| {
        assert_eq!(case.symbol("readFileSync"), None);
        assert_unresolved(case, "readFileSync");
        assert!(case.mentions(table::namespace_of(RuntimeModule::NodeFs)));
    };
    unknown_export_of_open_namespace: PROGRAM, "import { nothing } from \"bun\"; nothing;", |case| {
        assert_eq!(case.symbol("nothing"), None);
        assert_unresolved(case, "nothing");
        assert!(case.mentions(table::namespace_of(RuntimeModule::Bun)));
    };
    type_only_import: PROGRAM, "import type { HeapStats } from \"bun:jsc\";", |case|
        assert!(!case.mentions(jsc_namespace()));
    other_module: PROGRAM, "import { a } from \"./b\"; a;", |case| {
        assert_eq!(case.symbol("a"), None);
        assert_unresolved(case, "a");
    };
    reexport_mentions: PROGRAM, "export { heapStats } from \"bun:jsc\";", |case| {
        assert!(case.mentions(jsc_heap_stats()));
        assert!(!case.exposes(jsc_namespace()));
    };
    type_only_reexport: PROGRAM, "export { type heapStats, fullGC } from \"bun:jsc\";", |case|
        assert!(!case.mentions(jsc_heap_stats()));
    default_specifier: PROGRAM, "import { default as d } from \"bun:jsc\"; d.heapStats;", |case| {
        assert_eq!(case.symbol_id("d"), Some(jsc_namespace()));
        assert_builtin(case, "d.heapStats", jsc_heap_stats());
        assert!(!case.exposes(jsc_namespace()));
    };
    default_specifier_exposes: PROGRAM, "import { default as d } from \"bun:jsc\"; f(d);", |case|
        assert!(case.exposes(jsc_namespace()));
    default_member: PROGRAM, "import * as jsc from \"bun:jsc\"; jsc.default.heapStats;", |case|
        assert_builtin(case, "jsc.default.heapStats", jsc_heap_stats());
    default_of_open_namespace: PROGRAM, "import a from \"bun\"; import { default as b } from \"bun\"; a.serve; b.serve;", |case| {
        assert_builtin(case, "a.serve", BuiltinId::BunServe);
        assert_builtin(case, "b.serve", BuiltinId::BunServe);
        assert!(!case.exposes(BuiltinId::Bun));
    };
    default_reexport_exposes: PROGRAM, "export { default } from \"bun:jsc\";", |case|
        assert!(case.exposes(jsc_namespace()));
    default_reexport_of_module_with_source: PROGRAM, "export { default } from \"node:fs\";", |case|
        assert!(!case.exposes(table::namespace_of(RuntimeModule::NodeFs)));
    import_equals: PROGRAM, "import jsc = require(\"bun:jsc\"); jsc.heapStats;", |case| {
        assert_builtin(case, "jsc", jsc_namespace());
        assert_builtin(case, "jsc.heapStats", jsc_heap_stats());
        assert!(!case.exposes(jsc_namespace()));
    };
    exported_import_equals_exposes: PROGRAM, "export import jsc = require(\"bun:jsc\");", |case|
        assert!(case.exposes(jsc_namespace()));
    bundle_import: PROGRAM, "import { feature } from \"bun:bundle\"; feature(x);", |case|
        assert_eq!(case.symbol_id("feature"), Some(BuiltinId::BunBundleFeature));
    bundle_namespace_import: PROGRAM, "import * as b from \"bun:bundle\"; b.feature(x);", |case| {
        assert_builtin(case, "b.feature", BuiltinId::BunBundleFeature);
        assert_mutability(case, "b.feature", Mutability::AlwaysLocked);
    };
    type_only_bundle_import: PROGRAM, "import { type feature } from \"bun:bundle\";", |case| {
        assert_eq!(case.symbol("feature"), None);
        assert!(!case.mentions(BuiltinId::BunBundleFeature));
    };
    macro_import_is_not_bundle_import: PROGRAM, "import { feature } from \"./m\" with { type: \"macro\" }; feature(x);", |case| {
        assert_eq!(case.symbol("feature"), None);
        assert_unresolved(case, "feature");
    };
    property_naming_own_holder: PROGRAM, "Function.constructor; globalThis.globalThis;", |case| {
        assert_builtin(case, "Function.constructor", BuiltinId::Function);
        assert_builtin(case, "globalThis.globalThis", BuiltinId::GlobalThis);
    };
    open_namespace_import_is_the_object: PROGRAM, "import * as b from \"bun\"; b; b.serve;", |case| {
        assert_eq!(case.symbol_id("b"), Some(BuiltinId::Bun));
        assert_builtin(case, "b", BuiltinId::Bun);
        assert_builtin(case, "b.serve", BuiltinId::BunServe);
    };
    namespace_object_is_not_published: PROGRAM, "import * as jsc from \"bun:jsc\"; jsc; jsc.heapStats;", |case| {
        for jsc in case.exprs("jsc") {
            assert!(case.resolved_at(jsc).is_none());
            assert_eq!(case.resolved.builtin_of_expression(jsc), None);
        }
        assert_eq!(case.symbol("jsc"), None);
        assert_builtin(case, "jsc.heapStats", jsc_heap_stats());
        assert!(case.mentions(jsc_namespace()));
    };
}

#[test]
fn object_has_no_default_member() {
    let call = "process.getBuiltinModule(\"bun:jsc\")";
    let built_in_module_member = format!("{call}.default");
    for (setup, head, member) in [
        (PROGRAM, "", "process.default"),
        (PROGRAM, "", "Bun.default"),
        (PROGRAM, "", "process[\"default\"]"),
        (PROGRAM, "", built_in_module_member.as_str()),
        (SCRIPT, "", "require(\"bun:jsc\").default"),
        (SCRIPT, "const j = require(\"bun:jsc\");", "j.default"),
        (PROGRAM, "import d from \"bun:jsc\";", "d.default"),
        (
            PROGRAM,
            "import { default as d } from \"bun:jsc\";",
            "d.default",
        ),
        (PROGRAM, "import j = require(\"bun:jsc\");", "j.default"),
        (
            PROGRAM,
            "import * as jsc from \"bun:jsc\";",
            "jsc.default.default",
        ),
        (PROGRAM, "import * as b from \"bun\";", "b.default"),
    ] {
        with_case(setup, &format!("{head} {member};"), |case| {
            assert_unresolved(case, member);
        });
    }
}

#[test]
fn module_namespace_has_default_member() {
    for (head, member, id) in [
        (
            "import * as jsc from \"bun:jsc\";",
            "jsc.default",
            jsc_namespace(),
        ),
        (
            "import * as jsc from \"bun:jsc\";",
            "(jsc as any).default",
            jsc_namespace(),
        ),
        (
            "import * as p from \"node:process\";",
            "p.default",
            BuiltinId::Process,
        ),
    ] {
        with_case(PROGRAM, &format!("{head} {member};"), |case| {
            assert_builtin(case, member, id);
        });
    }
}

#[test]
fn destructured_default() {
    for (setup, source) in [
        (SCRIPT, "const { default: x } = require(\"bun:jsc\"); x;"),
        (PROGRAM, "const { default: x } = process; x;"),
        (
            PROGRAM,
            "import d from \"bun:jsc\"; const { default: x } = d; x;",
        ),
        (
            PROGRAM,
            "import * as jsc from \"bun:jsc\"; const { default: { default: x } } = jsc; x;",
        ),
    ] {
        with_case(setup, source, |case| {
            assert_eq!(case.symbol("x"), None, "{source}");
            assert_unresolved(case, "x");
        });
    }
    let source = "import * as jsc from \"bun:jsc\"; const { default: x } = jsc; x.heapStats;";
    with_case(PROGRAM, source, |case| {
        assert_eq!(case.symbol_id("x"), Some(jsc_namespace()));
        assert_builtin(case, "x.heapStats", jsc_heap_stats());
    });
}

#[test]
fn defined_path_has_no_default_member() {
    let setup = Setup {
        defines: &[(&["MY"], &["process", "default"])],
        ..PROGRAM
    };
    with_case(setup, "MY;", |case| assert_unresolved(case, "MY"));
}

#[test]
fn require_call() {
    with_case(SCRIPT, "require(\"bun:jsc\").heapStats;", |case| {
        assert_builtin(case, "require(\"bun:jsc\")", jsc_namespace());
        assert_builtin(case, "require(\"bun:jsc\").heapStats", jsc_heap_stats());
    });
    let source = "const { heapStats } = require(\"bun:jsc\");";
    with_case(SCRIPT, source, |case| {
        assert_eq!(case.symbol_id("heapStats"), Some(jsc_heap_stats()));
    });
    let source = "require(\"node:fs\"); require(\"./b\"); require(name);";
    with_case(SCRIPT, source, |case| {
        assert_unresolved(case, "require(\"node:fs\")");
        assert_unresolved(case, "require(\"./b\")");
        assert_unresolved(case, "require(name)");
        assert!(case.mentions(table::namespace_of(RuntimeModule::NodeFs)));
    });
}

#[test]
fn get_builtin_module_call() {
    let call = "process.getBuiltinModule(\"bun:jsc\")";
    with_case(PROGRAM, &format!("{call}.heapStats;"), |case| {
        assert_builtin(case, call, jsc_namespace());
        assert_builtin(case, &format!("{call}.heapStats"), jsc_heap_stats());
        assert!(!case.exposes(jsc_namespace()));
        assert!(!case.exposes(BuiltinId::Process));
    });
    let source = format!("const {{ heapStats }} = {call};");
    with_case(PROGRAM, &source, |case| {
        assert_eq!(case.symbol_id("heapStats"), Some(jsc_heap_stats()));
    });
    with_case(PROGRAM, &format!("f({call});"), |case| {
        assert!(case.exposes(jsc_namespace()));
    });
    with_case(PROGRAM, "process.getBuiltinModule(\"node:fs\");", |case| {
        assert_unresolved(case, "process.getBuiltinModule(\"node:fs\")");
        assert!(case.mentions(table::namespace_of(RuntimeModule::NodeFs)));
    });
    let source = "process.getBuiltinModule(name).heapStats;";
    with_case(PROGRAM, source, |case| {
        assert_unresolved(case, "process.getBuiltinModule(name)");
        assert!(!case.mentions(jsc_namespace()));
    });
}

#[test]
fn namespace_object_exposes() {
    for source in [
        "import(\"bun:jsc\");",
        "export * from \"bun:jsc\";",
        "export * as jsc from \"bun:jsc\";",
        "import * as jsc from \"bun:jsc\"; export { jsc };",
        "import jsc from \"bun:jsc\"; export { jsc };",
        "import * as jsc from \"bun:jsc\"; f(jsc);",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(jsc_namespace()), "{source}");
        });
    }
    let source = "import(\"node:fs\"); export * from \"node:fs\";";
    with_case(PROGRAM, source, |case| {
        assert!(case.mentions(table::namespace_of(RuntimeModule::NodeFs)));
        assert!(case.resolved.exposed().is_empty());
    });
}

fn is_loaded(case: &Case<'_, '_>, module: RuntimeModule) -> bool {
    case.resolved
        .loaded_modules()
        .any(|loaded| loaded == module)
}

fn is_called(case: &Case<'_, '_>, function: RuntimeFunction) -> bool {
    case.resolved
        .called_functions()
        .any(|called| called == function)
}

#[test]
fn loads_and_calls() {
    let loads = table::entry(BuiltinId::ProcessStdout).loads();
    assert!(!loads.is_empty());
    for source in [
        "process.stdout;",
        "f(process);",
        "process[k];",
        "global.process.stdout;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                loads.iter().all(|load| is_loaded(case, load.module)),
                "{source}"
            );
        });
    }
    with_case(PROGRAM, "process.pid;", |case| {
        assert!(!loads.iter().any(|load| is_loaded(case, load.module)));
    });
    let calls = table::entry(BuiltinId::ProcessStdout).calls();
    assert!(!calls.is_empty());
    let exists_on_linux = |function: RuntimeFunction| {
        let data = table::runtime_function(function).expect("the table lists the function");
        data.platforms.contains(Platforms::LINUX)
    };
    with_case(PROGRAM, "process.stdout;", |case| {
        let mut expected = calls
            .iter()
            .copied()
            .filter(|&called| exists_on_linux(called));
        assert!(expected.all(|called| is_called(case, called)));
    });
    with_case(PROGRAM, "1;", |case| {
        assert_eq!(case.resolved.loaded_modules().count(), 0);
        assert_eq!(case.resolved.called_functions().count(), 0);
    });
}

#[test]
fn import_mutability() {
    with_case(PROGRAM, "import d from \"bun:jsc\"; d;", |case| {
        assert_mutability(case, "d", Mutability::AlwaysLocked);
    });
    let source = "import { heapStats } from \"bun:jsc\"; heapStats;";
    with_case(PROGRAM, source, |case| {
        let export = table::own_member(jsc_namespace(), find_name("heapStats")).unwrap();
        assert_mutability(case, "heapStats", table::entry(export).mutability);
    });
    with_case(SCRIPT, "require(\"bun:jsc\");", |case| {
        let predicted = Mutability::ConstantUnlessWritten;
        assert_mutability(case, "require(\"bun:jsc\")", predicted);
    });
    let source = "import p from \"node:process\"; p; process;";
    with_case(PROGRAM, source, |case| {
        assert_builtin(case, "p", BuiltinId::Process);
        assert_mutability(case, "p", Mutability::AlwaysLocked);
        assert_mutability(case, "process", Mutability::AlwaysLocked);
    });
}

fn module_export(case: &Case<'_, '_>, module: RuntimeModule, name: &str) -> ModuleExport {
    let name = case.atoms.intern(name.as_bytes());
    find_module_export(case.names, module, name, Platforms::LINUX)
}

fn module_flags(module: RuntimeModule) -> ModuleFlags {
    table::module_data(module).flags
}

#[test]
fn module_exports() {
    with_case(PROGRAM, "1;", |case| {
        let find = |module, name| module_export(case, module, name);
        let jsc = RuntimeModule::BunJsc;
        let found = find(jsc, "default");
        assert_eq!(found, ModuleExport::Found(jsc_namespace()));
        let found = find(jsc, "heapStats");
        assert_eq!(found, ModuleExport::Found(jsc_heap_stats()));

        assert!(module_flags(jsc).contains(ModuleFlags::LISTS_ALL_EXPORTS));
        assert_eq!(find(jsc, "nothing"), ModuleExport::Absent);
        assert_eq!(find(jsc, "push"), ModuleExport::Absent);

        let bun = RuntimeModule::Bun;
        assert!(module_flags(bun).contains(ModuleFlags::HAS_OPEN_NAMESPACE));
        let found = find(bun, "serve");
        assert_eq!(found, ModuleExport::Found(BuiltinId::BunServe));
        let open = ModuleExport::PropertyOfNamespace(BuiltinId::Bun);
        assert_eq!(find(bun, "nothing"), open);

        let process = RuntimeModule::NodeProcess;
        assert!(
            !module_flags(process)
                .intersects(ModuleFlags::LISTS_ALL_EXPORTS | ModuleFlags::HAS_OPEN_NAMESPACE)
        );
        let found = find(process, "pid");
        assert_eq!(found, ModuleExport::Found(BuiltinId::ProcessPid));
        assert_eq!(find(process, "nothing"), ModuleExport::Unknown);
    });
}

#[test]
fn default_export_of_module_with_source() {
    with_case(PROGRAM, "1;", |case| {
        let find = |module, name| module_export(case, module, name);
        let fs = RuntimeModule::NodeFs;
        assert_eq!(find(fs, "default"), ModuleExport::Found(BuiltinId::NodeFs));

        let sqlite = RuntimeModule::BunSqlite;
        let found = find(sqlite, "default");
        assert_eq!(found, ModuleExport::Found(BuiltinId::BunSqliteDefault));
        let found = find(sqlite, "Database");
        assert_eq!(found, ModuleExport::Found(BuiltinId::BunSqliteDatabase));

        let found = find(RuntimeModule::NodeFetch, "default");
        assert_eq!(found, ModuleExport::Unknown);
    });
}

#[test]
fn export_that_only_the_namespace_holds() {
    with_case(PROGRAM, "1;", |case| {
        let find = |module, name| module_export(case, module, name);
        let held = ModuleExport::HeldByNamespace;
        assert_eq!(find(RuntimeModule::Utf8Validate, "default"), held);
        assert_eq!(find(RuntimeModule::NodeModule, "wrapper"), held);
        let abort_controller = RuntimeModule::AbortController;
        assert_eq!(find(abort_controller, "__esModule"), held);
        assert_eq!(find(abort_controller, "nothing"), ModuleExport::Absent);
        let module_object = table::namespace_of(abort_controller);
        assert_eq!(
            find(abort_controller, "default"),
            ModuleExport::Found(module_object)
        );
    });
    with_case(
        PROGRAM,
        "import validate from \"utf-8-validate\"; validate;",
        |case| {
            assert_eq!(case.symbol_id("validate"), None);
        },
    );
    let source = "import * as m from \"node:module\"; import { wrapper } from \"node:module\"; m.wrapper; m.createRequire;";
    with_case(PROGRAM, source, |case| {
        assert_eq!(case.symbol_id("wrapper"), None);
        assert_eq!(case.builtin("m.wrapper"), None);
        let create_require = find_member(BuiltinId::NodeModule, "createRequire");
        assert_eq!(case.builtin("m.createRequire"), create_require);
    });
}

#[test]
fn module_export_of_other_platform_is_not_found() {
    with_case(PROGRAM, "1;", |case| {
        let getuid = case.atoms.intern(b"getuid");
        let find =
            |platform| find_module_export(case.names, RuntimeModule::NodeProcess, getuid, platform);
        let found = ModuleExport::Found(BuiltinId::ProcessGetuid);
        assert_eq!(find(Platforms::LINUX), found);
        assert_eq!(find(Platforms::WINDOWS), ModuleExport::Unknown);
    });
}

#[test]
fn module_export_is_location_of_module() {
    with_case(PROGRAM, "1;", |case| {
        let postgres = case.atoms.intern(b"postgres");
        let found = find_module_export(case.names, RuntimeModule::Bun, postgres, Platforms::LINUX);
        assert_eq!(found, ModuleExport::Found(BuiltinId::BunPostgres));
        assert_eq!(
            table::canonical_id(BuiltinId::BunPostgres),
            BuiltinId::Bun_sql
        );
    });
}

#[test]
fn exports_agree_with_aliases() {
    let exports = table::members(jsc_namespace()).iter().copied();
    let exports: Vec<BuiltinId> = exports
        .filter(|&export| table::exists_on(export, Platforms::LINUX))
        .collect();
    let export_name = |export: BuiltinId| {
        std::str::from_utf8(table::text_of_name(table::entry(export).name)).unwrap()
    };
    let mut source = String::from("import {");
    for (index, &export) in exports.iter().enumerate() {
        write!(source, " {} as e{index},", export_name(export)).unwrap();
    }
    source.push_str(" } from \"bun:jsc\";");
    for index in 0..exports.len() {
        write!(source, " e{index};").unwrap();
    }
    with_case(PROGRAM, &source, |case| {
        for (index, &export) in exports.iter().enumerate() {
            let found = module_export(case, RuntimeModule::BunJsc, export_name(export));
            let ModuleExport::Found(found) = found else {
                panic!("{} is {found:?}", export_name(export));
            };
            let alias = case.symbol_id(&format!("e{index}"));
            assert_eq!(
                alias,
                Some(table::canonical_id(found)),
                "{}",
                export_name(export)
            );
        }
    });
}
