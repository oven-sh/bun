use super::*;
use crate::builtins::RuntimeModule;
use crate::load::EntryPointKind;
use crate::modules::testing::{file_named, with_graph, with_runtime_graph};
use crate::modules::{BindInput, ExportBinding, ImportBinding, ModuleGraph, ModuleRef, SiteAnswer};
use bun_sema::bind::Decl;
use bun_sema::hir::ImportId;
use bun_sema::import_sites::ImportSiteKind;

const COMMONJS_FILE: (&str, &str) = ("legacy.js", "module.exports = { x: 1 };");
const COMMONJS: Interop = Interop::new(
    ModuleKind::CommonJs,
    SyntheticExportRule::CommonJs,
    RequireResult::ModuleExports,
);
const DATA_WITH_DEFAULT: Interop = Interop::new(
    ModuleKind::Data,
    SyntheticExportRule::None,
    RequireResult::DefaultExport,
);

fn check_interop(files: &[(&str, &str)], name: &str, expected: Interop) {
    with_graph(files, |graph, input| {
        let file = file_named(input, name);
        assert_eq!(file_interop(input.files, input.sources, file), expected);
        assert_eq!(graph.interop(ModuleRef::File(file)), expected);
        assert_eq!(graph.kind(file), expected.kind);
    });
}

fn first_import_target(graph: &ModuleGraph, input: &BindInput<'_, '_>) -> ModuleRef {
    let main = file_named(input, "main.js");
    match graph.site_answer(main, ImportSiteKind::Import(ImportId(0))) {
        SiteAnswer::Module(module) => module,
        answer => panic!("the first import has the answer {answer:?}"),
    }
}

fn first_named_import(graph: &ModuleGraph, input: &BindInput<'_, '_>) -> ImportBinding {
    let main = file_named(input, "main.js");
    let mut specifiers = input.files.hir(main)[ImportId(0)].named.iter();
    let specifier = specifiers.next();
    let specifier = specifier.expect("the first import has no named specifier");
    let bound = input.files.bound(main);
    let symbol = bound.declared_symbol(Decl::ImportSpec(specifier));
    graph.import_binding(main, symbol)
}

fn export_names(graph: &ModuleGraph, input: &BindInput<'_, '_>, name: &str) -> Vec<Vec<u8>> {
    let exports = graph.exports(file_named(input, name)).iter();
    exports
        .map(|export| input.files.atoms.bytes(export.name).to_vec())
        .collect()
}

#[test]
fn only_source_text_and_data_have_export_table() {
    for kind in ModuleKind::ALL {
        let interop = Interop::new(kind, SyntheticExportRule::None, RequireResult::Namespace);
        let expected = kind == ModuleKind::SourceText || kind == ModuleKind::Data;
        assert_eq!(interop.has_export_table(), expected, "{kind:?}");
    }
}

#[test]
fn text_of_a_file_decides_its_interop_and_its_extension_does_not() {
    let declaration = "export declare const x: number;";
    let cases = [
        ("main.js", "types.d.ts", declaration, Interop::ES_MODULE),
        ("main.mjs", COMMONJS_FILE.0, COMMONJS_FILE.1, COMMONJS),
        (
            "main.js",
            "module.mjs",
            "globalThis.x = 1;",
            Interop::ES_MODULE,
        ),
        (
            "main.js",
            "module.cjs",
            "export const x = 1;",
            Interop::ES_MODULE,
        ),
    ];
    for (main, name, text, expected) in cases {
        let import = format!("import './{name}';");
        check_interop(&[(main, import.as_str()), (name, text)], name, expected);
    }
}

#[test]
fn library_files_are_es_modules() {
    with_runtime_graph(&[("main.js", "")], |graph, input| {
        let entry_points = input.sources.entry_points().iter();
        let library_entries = entry_points.filter(|entry| entry.kind == EntryPointKind::Library);
        let mut library_entries = library_entries.peekable();
        assert!(library_entries.peek().is_some());
        for entry in library_entries {
            let interop = file_interop(input.files, input.sources, entry.file);
            assert_eq!(interop, Interop::ES_MODULE);
            assert_eq!(graph.interop(ModuleRef::File(entry.file)), interop);
        }
    });
}

#[test]
fn runtime_module_with_source_exports_own_keys() {
    let files = [("main.js", "import 'node:path';")];
    with_graph(&files, |graph, input| {
        let module = first_import_target(graph, input);
        assert_eq!(module, ModuleRef::Runtime(RuntimeModule::NodePath));
        assert_eq!(graph.interop(module), Interop::RUNTIME);
    });
    with_runtime_graph(&files, |graph, input| {
        let source = file_named(input, "/$bun/js/node/path.ts");
        let interop = file_interop(input.files, input.sources, source);
        assert_eq!(interop, Interop::RUNTIME_SOURCE);
        assert_eq!(graph.interop(ModuleRef::File(source)), interop);
        assert_eq!(graph.runtime_module(source), Some(RuntimeModule::NodePath));
    });
}

#[test]
fn es_module_of_the_runtime_has_export_table() {
    let files = [(
        "main.js",
        "import { __toESM, __using } from 'bun:wrap'; __toESM; __using;",
    )];
    with_graph(&files, |graph, input| {
        let module = first_import_target(graph, input);
        assert_eq!(module, ModuleRef::Runtime(RuntimeModule::BunWrap));
        let name = input.files.atoms.intern(b"__toESM");
        let expected = ImportBinding::NamespaceRead { module, name };
        assert_eq!(first_named_import(graph, input), expected);
        let main = file_named(input, "main.js");
        let required = graph.required_names(main).iter();
        assert!(required.clone().all(|required| required.module == module));
        assert_eq!(required.count(), 2);
    });
    with_runtime_graph(&files, |graph, input| {
        let source = file_named(input, "/$bun/js/runtime.bun.js");
        let interop = file_interop(input.files, input.sources, source);
        assert_eq!(interop, Interop::ES_MODULE);
        assert_eq!(graph.interop(ModuleRef::File(source)), interop);
        assert_eq!(graph.runtime_module(source), None);
        let names = export_names(graph, input, "/$bun/js/runtime.bun.js");
        for name in [&b"__toESM"[..], b"__using"] {
            assert!(names.iter().any(|exported| exported == name));
        }
    });
}

#[test]
fn this_of_the_file_makes_it_commonjs() {
    let commonjs = [
        "this.f = 1;",
        "const self = () => this;",
        "class A { [this.key]() {} }",
    ];
    for text in commonjs {
        let files = [("main.js", "import './other.js';"), ("other.js", text)];
        check_interop(&files, "other.js", COMMONJS);
    }
    let es_modules = [
        "function f() { return this; }",
        "class A { field = this; static { this.x = 1; } }",
        "if (false) this.f = 1;",
        "this.f = import.meta.url;",
    ];
    for text in es_modules {
        let files = [("main.js", "import './other.js';"), ("other.js", text)];
        check_interop(&files, "other.js", Interop::ES_MODULE);
    }
}

#[test]
fn json_file_exports_keys() {
    let files = [
        (
            "main.js",
            "import * as data from './data.json'; console.log(data);",
        ),
        ("data.json", r#"{ "x": 1, "a": 2 }"#),
    ];
    check_interop(&files, "data.json", DATA_WITH_DEFAULT);
    with_graph(&files, |graph, input| {
        let data = file_named(input, "data.json");
        assert_eq!(
            export_names(graph, input, "data.json"),
            [&b"a"[..], b"default", b"x"]
        );
        for export in graph.exports(data) {
            assert!(matches!(
                export.binding,
                ExportBinding::Variable(symbol) if symbol.file == data
            ));
        }
        assert!(!graph.has_dynamic_names(data));
        assert!(graph.requests(data).is_empty());
    });
}

fn json_export_names(main: &str) -> Vec<Vec<u8>> {
    let files = [
        ("main.js", main),
        ("middle.js", "export { x as renamed } from './data.json';"),
        ("data.json", r#"{ "x": 1, "a": 2, "b-c": 3 }"#),
    ];
    with_graph(&files, |graph, input| {
        export_names(graph, input, "data.json")
    })
}

#[test]
fn json_file_exports_only_keys_that_can_be_read() {
    let only_default = [&b"default"[..]];
    assert_eq!(json_export_names("import './data.json';"), only_default);
    assert_eq!(
        json_export_names("import data from './data.json'; data.a;"),
        only_default
    );
    assert_eq!(json_export_names("require('./data.json').a;"), only_default);
    let names = json_export_names("import { a } from './data.json'; a;");
    assert_eq!(names, [&b"a"[..], b"default"]);
    let names = json_export_names("import { 'b-c' as c } from './data.json'; c;");
    assert_eq!(names, [&b"b-c"[..], b"default"]);
    let names = json_export_names("import * as data from './data.json'; data.a;");
    assert_eq!(names, [&b"a"[..], b"default"]);
    let names = json_export_names("import { renamed } from './middle.js'; renamed;");
    assert_eq!(names, [&b"default"[..], b"x"]);
}

#[test]
fn json_file_whose_namespace_can_be_reached_exports_every_key() {
    let every_key = [&b"a"[..], b"b-c", b"default", b"x"];
    for main in [
        "import * as data from './data.json'; console.log(data);",
        "import * as data from './data.json'; data[String('a')];",
        "import * as data from './data.json'; eval('data');",
        "export * as data from './data.json';",
        "import('./data.json');",
    ] {
        assert_eq!(json_export_names(main), every_key, "{main}");
    }
}

#[test]
fn text_file_exports_default_only() {
    let files = [("main.js", "import './notes.txt';"), ("notes.txt", "text")];
    check_interop(&files, "notes.txt", DATA_WITH_DEFAULT);
    with_graph(&files, |graph, input| {
        assert_eq!(export_names(graph, input, "notes.txt"), [b"default"]);
    });
}

#[test]
fn data_module_without_default_requires_as_namespace() {
    let files = [
        ("main.js", "import './named.js'; import './default.js';"),
        ("named.js", "export const x = 1;"),
        ("default.js", "export default 1;"),
    ];
    with_graph(&files, |_, input| {
        let interop_of = |name: &str| {
            let bound = input.files.bound(file_named(input, name));
            data_module_interop(bound)
        };
        let without_default = Interop::new(
            ModuleKind::Data,
            SyntheticExportRule::None,
            RequireResult::Namespace,
        );
        assert_eq!(interop_of("named.js"), without_default);
        assert_eq!(interop_of("default.js"), DATA_WITH_DEFAULT);
    });
}

#[test]
fn package_type_module_ignores_es_module_annotation() {
    let files = [
        ("main.mjs", "import './legacy.js';"),
        COMMONJS_FILE,
        ("package.json", r#"{ "type": "module" }"#),
    ];
    let expected = Interop {
        export_rule: SyntheticExportRule::CommonJsIgnoringAnnotation,
        ..COMMONJS
    };
    check_interop(&files, "legacy.js", expected);
}

#[test]
fn evaluated_text_is_commonjs() {
    let files = [("main.js", r#"new Function("a", "b", "return a + b");"#)];
    with_graph(&files, |graph, input| {
        let main = file_named(input, "main.js");
        let [(_, function)] = input.sources.evaluated_functions_of(main) else {
            panic!("the constant text is one function of the program");
        };
        assert_eq!(input.sources.kind(function.file), SourceKind::EvaluatedText);
        let interop = file_interop(input.files, input.sources, function.file);
        assert_eq!(interop, COMMONJS);
        assert_eq!(graph.interop(ModuleRef::File(function.file)), interop);
    });
}

#[test]
fn native_runtime_module_is_captured() {
    let expected = Interop::new(
        ModuleKind::Runtime,
        SyntheticExportRule::RuntimeModule,
        RequireResult::DefaultExport,
    );
    assert_eq!(Interop::RUNTIME, expected);
    with_graph(&[("main.js", "import 'node:buffer';")], |graph, input| {
        let module = first_import_target(graph, input);
        assert_eq!(module, ModuleRef::Runtime(RuntimeModule::NodeBuffer));
        assert_eq!(graph.interop(module), expected);
    });
}

#[test]
fn host_value_is_captured() {
    let expected = Interop::new(
        ModuleKind::External,
        SyntheticExportRule::RuntimeModule,
        RequireResult::DefaultExport,
    );
    assert_eq!(Interop::of_external(ExternalKind::HostValue), expected);
    let files = [("main.js", "import { x } from 'bun:main'; console.log(x);")];
    with_graph(&files, |graph, input| {
        let module = first_import_target(graph, input);
        assert!(matches!(module, ModuleRef::External { .. }));
        assert_eq!(graph.interop(module), expected);
        let ImportBinding::Synthetic(id) = first_named_import(graph, input) else {
            panic!("a name of a host value is a synthetic export");
        };
        assert_eq!(graph.synthetic_export(id).module, module);
    });
}

#[test]
fn uncompiled_code_is_not_captured() {
    let expected = Interop::new(
        ModuleKind::External,
        SyntheticExportRule::None,
        RequireResult::Namespace,
    );
    assert_eq!(Interop::of_external(ExternalKind::UncompiledCode), expected);
    let main = "import { x } from 'https://example.com/x.js'; console.log(x);";
    with_graph(&[("main.js", main)], |graph, input| {
        let module = first_import_target(graph, input);
        assert!(matches!(module, ModuleRef::External { .. }));
        assert_eq!(graph.interop(module), expected);
        let name = input.files.atoms.intern(b"x");
        let live_read = ImportBinding::NamespaceRead { module, name };
        assert_eq!(first_named_import(graph, input), live_read);
        assert!(graph.synthetic_exports().is_empty());
    });
}
