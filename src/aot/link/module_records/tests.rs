use super::*;
use crate::builtins::table::{HostReadContext, STARTUP_MODULES, host_reads};
use crate::builtins::{BuiltinId, RuntimeModule};
use crate::ir::generated::{
    ImportPhase, Module, ModuleRequest, ModuleRequestKind, RequiredName, VariableInitialization,
};
use crate::ir::{Program, print_program};
use crate::link::entries::host_reads_of;
use crate::link::testing::{
    Numbered, Projects, SHARED_NAME_IMPORTERS, application_file, find_file, forward, link_sources,
    link_sources_without_bun_modules, link_units, number_units, with_lowered_units,
};
use crate::modules::ModuleFailure;
use crate::modules::testing::with_graph;

const PLUGIN_URL: &str = "https://example.com/plugin.js";

fn link_program(files: &[(&str, &str)]) -> Program {
    link_sources(files).expect("the program links").program
}

fn link_program_without_bun_modules(files: &[(&str, &str)]) -> Program {
    let linked = link_sources_without_bun_modules(files);
    linked.expect("the program links").program
}

fn find_module(program: &Program, path_suffix: &str) -> Option<ModuleId> {
    let has_path = |module: &Module| {
        let path = program.strings.get(module.path);
        path.ends_with(path_suffix.as_bytes())
    };
    program.modules.iter().position(has_path).map(ModuleId::new)
}

fn module_named(program: &Program, path_suffix: &str) -> ModuleId {
    find_module(program, path_suffix).expect("no module has this path")
}

fn record_named<'p>(program: &'p Program, path_suffix: &str) -> &'p Module {
    &program.modules[module_named(program, path_suffix).index()]
}

fn runtime_module_index(program: &Program, runtime_module: RuntimeModule) -> usize {
    let has_runtime_module = |record: &Module| record.runtime_module == Some(runtime_module);
    let module = program.modules.iter().position(has_runtime_module);
    module.expect("the module of Bun has no record")
}

fn runtime_record(program: &Program, runtime_module: RuntimeModule) -> &Module {
    &program.modules[runtime_module_index(program, runtime_module)]
}

fn export_names<'p>(program: &'p Program, record: &Module) -> Vec<&'p [u8]> {
    let exports = record.exports.iter();
    exports
        .map(|export| program.strings.get(export.name))
        .collect()
}

fn blank_record(record: &Module) -> Module {
    Module {
        path: record.path,
        display_path: record.display_path,
        kind: record.kind,
        export_rule: record.export_rule,
        require_result: record.require_result,
        ..Module::default()
    }
}

fn count_namespace_reads(program: &Program, module: usize) -> usize {
    let operand = format!("module=m{module}");
    let text = print_program(program);
    let reads = text
        .lines()
        .filter(|line| line.contains(" = ModuleNamespace "));
    reads
        .filter(|line| line.split_whitespace().any(|word| word == operand))
        .count()
}

fn print_functions_of(program: &Program, module: ModuleId) -> String {
    let owner = format!("module=m{}", module.index());
    let mut printed = String::new();
    let mut is_in_module = false;
    for line in print_program(program).lines() {
        if line.starts_with("function ") {
            is_in_module = line.split_whitespace().any(|word| word == owner);
        }
        if is_in_module {
            printed.push_str(line);
            printed.push('\n');
        }
    }
    printed
}

fn observe(module: &str) -> String {
    format!("import * as observed from './{module}';\nconsole.log(observed);\n")
}

fn build_records(projects: &Projects<'_, '_>, numbered: &mut Numbered) -> ModuleRecords {
    let Numbered {
        prepared,
        numbering,
        strings,
        ..
    } = numbered;
    let input = RecordInput {
        projects,
        atoms: &projects.application.loaded.files().atoms,
        modules: &prepared.modules,
        functions: &prepared.functions,
        variables: &prepared.variables,
        definitions: &prepared.definitions,
        numbering,
    };
    build_module_records(&mut prepared.units, &input, strings)
}

#[test]
fn es_module_record_has_body_and_requests() {
    let main = "
        import './second.js';
        import './first.js';
        import defer * as later from './later.js';
        import 'node:path';
        console.log(later);
    ";
    let program = link_program(&[
        ("main.js", main),
        ("first.js", "export {};\n"),
        ("second.js", "export {};\n"),
        ("later.js", "export {};\n"),
    ]);
    let record = record_named(&program, "main.js");
    assert_eq!(record.kind, ModuleKind::SourceText);
    assert!(record.body.is_some());
    assert!(!record.positions.line_starts.is_empty());
    let path = ModuleId::new(runtime_module_index(&program, RuntimeModule::NodePath));
    let request = |target, phase| ModuleRequest {
        target,
        phase,
        is_dynamic_star_export: false,
        kind: ModuleRequestKind::Import,
        completes: true,
    };
    let expected_requests = [
        request(module_named(&program, "second.js"), ImportPhase::Evaluation),
        request(module_named(&program, "first.js"), ImportPhase::Evaluation),
        request(module_named(&program, "later.js"), ImportPhase::Defer),
        request(path, ImportPhase::Evaluation),
    ];
    assert_eq!(record.requests, expected_requests);
    let expected = Module {
        flags: record.flags & ModuleFlags::KEEPS_ERROR,
        body: record.body,
        requests: record.requests.clone(),
        positions: record.positions.clone(),
        function_text: record.function_text.clone(),
        ..blank_record(record)
    };
    assert_eq!(*record, expected);
}

#[test]
fn commonjs_record_has_body_and_requests_and_no_names_for_the_loader() {
    let program = link_program(&[
        (
            "main.js",
            "import value from './legacy.cjs';\nconsole.log(value);\n",
        ),
        (
            "legacy.cjs",
            "require('./other.cjs');\nmodule.exports = 1;\n",
        ),
        ("other.cjs", "exports.a = 1;\n"),
    ]);
    let record = record_named(&program, "legacy.cjs");
    assert_eq!(record.kind, ModuleKind::CommonJs);
    assert!(record.body.is_some());
    assert!(!record.positions.line_starts.is_empty());
    let [request] = record.requests.as_slice() else {
        panic!("legacy.cjs requires one module");
    };
    assert_eq!(request.target, module_named(&program, "other.cjs"));
    assert_eq!(request.kind, ModuleRequestKind::Require);
    assert_eq!(request.phase, ImportPhase::Evaluation);
    let exports = record
        .exports_variable
        .expect("the exports of legacy.cjs are one value");
    let exports = &program.variables[exports.index()];
    assert_eq!(exports.initialization, VariableInitialization::Undefined);
    let expected = Module {
        flags: record.flags & ModuleFlags::KEEPS_ERROR,
        body: record.body,
        exports_variable: record.exports_variable,
        requests: record.requests.clone(),
        positions: record.positions.clone(),
        function_text: record.function_text.clone(),
        ..blank_record(record)
    };
    assert_eq!(*record, expected);
}

#[test]
fn face_has_a_path_of_its_own_and_the_file_keeps_the_line_table() {
    let legacy = "exports.n = 1;\nexports.set = function () {\n  exports.n = 2;\n};\n";
    let program = link_program_without_bun_modules(&[
        (
            "main.js",
            "import { n, set } from './legacy.cjs';\nset();\nconsole.log(n);\n",
        ),
        ("legacy.cjs", legacy),
    ]);
    let file = module_named(&program, "legacy.cjs");
    let display_path = program.modules[file.index()].display_path;
    let is_face = |record: &Module| {
        record.kind == ModuleKind::SourceText && record.display_path == display_path
    };
    let face = program
        .modules
        .iter()
        .position(is_face)
        .expect("legacy.cjs has no face");
    assert_eq!(face, file.index() + 1);
    let record = &program.modules[face];
    assert_eq!(
        program.strings.get(record.path),
        format!("#{face}").as_bytes()
    );
    assert!(record.positions.line_starts.is_empty());
    assert!(record.function_text.is_empty());
    assert!(record.requests.iter().any(|request| request.target == file));
    let body = record.body.expect("a face has a body");
    assert_eq!(program.functions[body.index()].module, file);

    let requests = &record_named(&program, "main.js").requests;
    assert!(
        requests
            .iter()
            .any(|request| request.target == ModuleId::new(face))
    );
    assert!(requests.iter().all(|request| request.target != file));
    let is_copy = |variable: &&generated::Variable| variable.module == ModuleId::new(face);
    let copies: Vec<&generated::Variable> = program.variables.iter().filter(is_copy).collect();
    let [copy] = copies.as_slice() else {
        panic!("only `n` is stored where a copy can be told from the variable");
    };
    assert_eq!(
        copy.name.map(|name| program.strings.get(name)),
        Some(&b"n"[..])
    );
    assert_eq!(copy.initialization, VariableInitialization::Uninitialized);
}

#[test]
fn data_record_has_data_and_static_exports() {
    let program = link_program(&[
        ("main.js", observe("settings.json").as_str()),
        ("settings.json", "{ \"radius\": 2, \"label\": \"unit\" }\n"),
    ]);
    let record = record_named(&program, "settings.json");
    assert_eq!(record.kind, ModuleKind::Data);
    assert!(record.body.is_some());
    assert!(record.data.is_some());
    let names: [&[u8]; 3] = [b"default", b"label", b"radius"];
    assert_eq!(export_names(&program, record), names);
    assert!(record.synthetic_exports.is_empty());
}

#[test]
fn native_bun_module_record_is_named_by_its_namespace() {
    let main = "import { Buffer } from 'node:buffer';\nconsole.log(Buffer);\n";
    let program = link_program(&[("main.js", main)]);
    let buffer = RuntimeModule::NodeBuffer;
    let record = runtime_record(&program, buffer);
    let namespace_text = table::text_of(table::namespace_of(buffer));
    assert_eq!(program.strings.get(record.path), namespace_text.as_bytes());
    assert_eq!(record.path, record.display_path);
    let expected = Module {
        kind: ModuleKind::Runtime,
        runtime_module: Some(buffer),
        synthetic_exports: record.synthetic_exports.clone(),
        ..blank_record(record)
    };
    assert_eq!(*record, expected);
}

#[test]
fn namespace_import_of_bun_module_reads_the_namespace_of_its_record() {
    let cases = [
        (
            RuntimeModule::NodeBuffer,
            "node:buffer",
            ModuleKind::Runtime,
        ),
        (
            RuntimeModule::NodePath,
            "node:path",
            ModuleKind::RuntimeSource,
        ),
    ];
    for (runtime_module, specifier, kind) in cases {
        let main = format!("import * as all from '{specifier}';\nconsole.log(all);\n");
        let program = link_program(&[("main.js", main.as_str())]);
        let module = runtime_module_index(&program, runtime_module);
        assert_eq!(program.modules[module].kind, kind, "{specifier}");
        assert_eq!(count_namespace_reads(&program, module), 1, "{specifier}");
    }
}

#[test]
fn default_import_of_bun_module_reads_no_namespace() {
    let main = "import buffer from 'node:buffer';\nconsole.log(buffer);\n";
    let program = link_program(&[("main.js", main)]);
    let module = runtime_module_index(&program, RuntimeModule::NodeBuffer);
    assert_eq!(count_namespace_reads(&program, module), 0);
}

#[test]
fn import_call_of_replaced_namespace_resolves_the_object() {
    let print = |specifier: &str| {
        let main = format!("const name = 'bun';\nexport const loaded = import({specifier});\n");
        let program = link_program(&[("main.js", main.as_str())]);
        print_functions_of(&program, module_named(&program, "main.js"))
    };
    let replaced = print("'bun'");
    assert!(!replaced.contains(" = ImportModule "));
    assert!(replaced.contains(" = Builtin builtin=PromiseResolve"));
    for loaded in ["'node:buffer'", "name"] {
        assert!(
            !print(loaded).contains(" = Builtin builtin=PromiseResolve"),
            "{loaded}"
        );
    }
    assert!(print("'node:buffer'").contains(" = ImportModule "));
}

#[test]
fn external_record_has_kind_and_referrer() {
    let kinds = [
        (PLUGIN_URL, generated::ExternalKind::UncompiledCode),
        ("bun:main", generated::ExternalKind::HostValue),
    ];
    for (specifier, external_kind) in kinds {
        let main = format!("export const loaded = import('{specifier}');\n");
        let program = link_program(&[("main.js", main.as_str())]);
        let record = record_named(&program, specifier);
        assert_eq!(program.strings.get(record.path), specifier.as_bytes());
        assert_eq!(record.path, record.display_path);
        let expected = Module {
            kind: ModuleKind::External,
            external_kind,
            referrer: find_module(&program, "main.js"),
            synthetic_exports: record.synthetic_exports.clone(),
            ..blank_record(record)
        };
        assert_eq!(*record, expected, "{specifier}");
    }
}

#[test]
fn two_importers_of_one_specifier_have_two_records() {
    let load = format!("export const loaded = import('{PLUGIN_URL}');\n");
    let main = format!("import './other.js';\n{load}");
    let program = link_program(&[("main.js", main.as_str()), ("other.js", load.as_str())]);
    let externals = program.modules.iter().filter(|record| {
        let path = program.strings.get(record.path);
        record.kind == ModuleKind::External && path == PLUGIN_URL.as_bytes()
    });
    let mut referrers: Vec<Option<ModuleId>> = externals.map(|record| record.referrer).collect();
    referrers.sort_unstable();
    let mut importers = ["main.js", "other.js"].map(|name| find_module(&program, name));
    importers.sort_unstable();
    assert!(importers.iter().all(Option::is_some));
    assert_eq!(referrers, importers);
}

#[test]
fn declaration_file_record_is_a_library() {
    let program = link_program(&[
        ("main.js", "import './types.d.ts';\n"),
        ("types.d.ts", "export declare const x: number;\n"),
    ]);
    let record = record_named(&program, "types.d.ts");
    let expected = Module {
        kind: ModuleKind::SourceText,
        flags: ModuleFlags::IS_LIBRARY,
        ..blank_record(record)
    };
    assert_eq!(*record, expected);
}

#[test]
fn function_files_of_bun_have_only_positions() {
    with_lowered_units(&[("main.js", "console.log(1);\n")], |units, projects| {
        let entry_points = projects.runtime.sources.entry_points().iter();
        let libraries: Vec<ProgramModule> = entry_points
            .filter(|entry_point| entry_point.kind == EntryPointKind::Library)
            .filter(|entry_point| !projects.runtime.unreached_files.contains(&entry_point.file))
            .map(|entry_point| {
                ProgramModule::File(ProgramFile {
                    project: ProjectId::Runtime,
                    file: entry_point.file,
                })
            })
            .collect();
        assert!(!libraries.is_empty());

        let linked = link_units(units, projects, &forward).expect("the program links");

        for library in libraries {
            let index = linked
                .keys
                .modules
                .iter()
                .position(|&module| module == library);
            let record = &linked.program.modules[index.expect("a function file has no record")];
            assert!(!record.positions.line_starts.is_empty());
            let expected = Module {
                kind: ModuleKind::SourceText,
                flags: ModuleFlags::IS_LIBRARY,
                positions: record.positions.clone(),
                function_text: record.function_text.clone(),
                ..blank_record(record)
            };
            assert_eq!(*record, expected);
        }
    });
}

#[test]
fn top_level_await_is_flagged() {
    let program = link_program(&[
        ("main.js", "import './plain.js';\nawait 0;\n"),
        ("plain.js", "export {};\n"),
    ]);
    let has_await = |name| {
        let flags = record_named(&program, name).flags;
        flags.contains(ModuleFlags::HAS_TOP_LEVEL_AWAIT)
    };
    assert!(has_await("main.js"));
    assert!(!has_await("plain.js"));
}

// Each file is imported for nothing.
fn files_left_out(package: &[(&str, &str)]) -> Vec<String> {
    let main = "import 's';\nimport 's/lib/b.js';\nimport 's/lib/c.cjs';\nimport 's/esm/d.js';\nimport './local.js';\n";
    let mut files = vec![
        ("main.js", main),
        ("local.js", "export {};\n"),
        ("node_modules/s/a.js", "export {};\n"),
        ("node_modules/s/lib/b.js", "export {};\n"),
        ("node_modules/s/lib/c.cjs", "exports.c = 1;\n"),
        ("node_modules/s/esm/d.js", "export {};\n"),
    ];
    files.extend_from_slice(package);
    let program = link_program(&files);
    let names = [
        "main.js",
        "local.js",
        "s/a.js",
        "lib/b.js",
        "lib/c.cjs",
        "esm/d.js",
    ];
    let is_left_out = |name: &&str| find_module(&program, name).is_none();
    names
        .into_iter()
        .filter(is_left_out)
        .map(str::to_owned)
        .collect()
}

fn manifest_of_s(side_effects: &str) -> String {
    format!(r#"{{ "name": "s", "main": "./a.js"{side_effects} }}"#)
}

#[test]
fn side_effects_field_decides_which_unused_files_are_left_out() {
    let every_file = &["s/a.js", "lib/b.js", "lib/c.cjs", "esm/d.js"][..];
    let cases: [(&str, &[&str]); 6] = [
        (r#", "sideEffects": false"#, every_file),
        ("", &[]),
        (r#", "sideEffects": true"#, &[]),
        (
            r#", "sideEffects": ["./lib/b.js"]"#,
            &["s/a.js", "lib/c.cjs", "esm/d.js"],
        ),
        // A list that names no file of the program speaks for every file.
        (r#", "sideEffects": ["./other.js"]"#, every_file),
        (r#", "sideEffects": ["./lib/*", "./a.js"]"#, &["esm/d.js"]),
    ];
    for (side_effects, expected) in cases {
        let manifest = manifest_of_s(side_effects);
        let left_out = files_left_out(&[("node_modules/s/package.json", &manifest)]);
        assert_eq!(left_out, expected, "{side_effects}");
    }
}

#[test]
fn nested_manifest_counts_only_with_a_name() {
    let manifest = manifest_of_s(r#", "sideEffects": false"#);
    let outer = ("node_modules/s/package.json", manifest.as_str());
    let unnamed = ("node_modules/s/esm/package.json", r#"{ "type": "module" }"#);
    let left_out = files_left_out(&[outer, unnamed]);
    assert_eq!(left_out, ["s/a.js", "lib/b.js", "lib/c.cjs", "esm/d.js"]);
    let named = ("node_modules/s/esm/package.json", r#"{ "name": "inner" }"#);
    let left_out = files_left_out(&[outer, named]);
    assert_eq!(left_out, ["s/a.js", "lib/b.js", "lib/c.cjs"]);
}

#[test]
fn application_may_declare_its_own_files() {
    let manifest = manifest_of_s("");
    let left_out = files_left_out(&[
        ("node_modules/s/package.json", &manifest),
        (
            "package.json",
            r#"{ "name": "application", "sideEffects": ["./main.js"] }"#,
        ),
    ]);
    assert_eq!(left_out, ["local.js"]);
}

#[test]
fn data_and_modules_of_bun_are_never_flagged() {
    let program = link_program(&[
        (
            "main.js",
            "import 'node:path';\nimport data from 's/data.json';\nconsole.log(data);\n",
        ),
        (
            "node_modules/s/package.json",
            r#"{ "name": "s", "sideEffects": false }"#,
        ),
        ("node_modules/s/data.json", "{}"),
    ]);
    for record in &program.modules {
        let path = bstr::BStr::new(program.strings.get(record.path));
        assert!(
            !record.flags.contains(ModuleFlags::HAS_NO_SIDE_EFFECTS),
            "{path}"
        );
    }
}

#[test]
fn export_has_an_entry_where_the_object_of_the_module_is_asked_for_it() {
    let library = (
        "library.js",
        "export const read = 1;\nexport const unread = 2;\n",
    );
    let main = "import { read } from './library.js';\nconsole.log(read);\n";
    let program = link_program_without_bun_modules(&[("main.js", main), library]);
    assert!(record_named(&program, "library.js").exports.is_empty());
    let main = "import * as library from './library.js';\nconsole.log(library.read);\n";
    let program = link_program_without_bun_modules(&[("main.js", main), library]);
    let record = record_named(&program, "library.js");
    assert_eq!(export_names(&program, record), [b"read"]);
    for export in &record.exports {
        assert_eq!(export.kind, ModuleExportKind::Variable);
        let variable = export.variable.expect("an export keeps its variable");
        assert!(variable.index() < program.variables.len());
        assert_eq!(export.module, None);
    }
}

#[test]
fn exports_are_sorted_by_code_units_not_by_string_id() {
    let names = "
        const x = 1;
        export { x as \"\u{FF5E}\", x as \"\u{1F600}\", x as exportedLower, x as ExportedUpper };
    ";
    let files = [
        ("main.js", "export const names = import('./names.js');\n"),
        ("names.js", names),
    ];
    with_lowered_units(&files, |units, projects| {
        let mut numbered = number_units(units, projects);
        let names_in_order: [&[u8]; 4] = [
            b"ExportedUpper",
            b"exportedLower",
            "\u{1F600}".as_bytes(),
            "\u{FF5E}".as_bytes(),
        ];
        assert!(names_in_order[3] < names_in_order[2]);
        for name in names_in_order.into_iter().rev() {
            assert_eq!(numbered.strings.find(name), None);
            numbered.strings.intern(name);
        }

        let records = build_records(projects, &mut numbered);

        let exporter = ProgramModule::File(application_file(find_file(projects, "names.js")));
        let exporter = numbered.prepared.modules.index_of(exporter) as usize;
        let exporter = numbered.numbering.modules[exporter].expect("the module has no record");
        let record = &records.modules[exporter.index()];
        let ids: Vec<StringId> = record.exports.iter().map(|export| export.name).collect();
        let names: Vec<&[u8]> = ids.iter().map(|&id| numbered.strings.get(id)).collect();
        assert_eq!(names, names_in_order);
        assert!(ids.is_sorted_by(|first, second| first > second));
    });
}

#[test]
fn star_export_copies_are_flagged() {
    let program = link_program(&[
        ("main.js", observe("barrel.js").as_str()),
        (
            "barrel.js",
            "export * from './star.js';\nexport const own = 1;\n",
        ),
        ("star.js", "export const copied = 2;\n"),
    ]);
    let barrel = record_named(&program, "barrel.js");
    let exports = barrel.exports.iter();
    let exports: Vec<(&[u8], bool)> = exports
        .map(|export| (program.strings.get(export.name), export.is_from_star_export))
        .collect();
    let expected: [(&[u8], bool); 2] = [(b"copied", true), (b"own", false)];
    assert_eq!(exports, expected);
}

#[test]
fn namespace_exports_have_import_phase() {
    let barrel = "
        import defer * as deferred from './target.js';
        export { deferred };
        export * as eager from './target.js';
        export const own = 1;
    ";
    let program = link_program(&[
        ("main.js", observe("barrel.js").as_str()),
        ("barrel.js", barrel),
        ("target.js", "export const x = 1;\n"),
    ]);
    let target = find_module(&program, "target.js");
    assert!(target.is_some());
    let exports = record_named(&program, "barrel.js").exports.iter();
    let exports: Vec<_> = exports
        .map(|export| {
            let name = program.strings.get(export.name);
            (name, export.kind, export.module, export.phase)
        })
        .collect();
    let namespace = ModuleExportKind::Namespace;
    let expected: [(&[u8], ModuleExportKind, Option<ModuleId>, ImportPhase); 3] = [
        (b"deferred", namespace, target, ImportPhase::Defer),
        (b"eager", namespace, target, ImportPhase::Evaluation),
        (
            b"own",
            ModuleExportKind::Variable,
            None,
            ImportPhase::Evaluation,
        ),
    ];
    assert_eq!(exports, expected);
}

#[test]
fn re_export_of_uncompiled_code_is_indirect() {
    let barrel = format!("export {{ pad as padded }} from '{PLUGIN_URL}';\n");
    let program = link_program(&[
        ("main.js", observe("barrel.js").as_str()),
        ("barrel.js", barrel.as_str()),
    ]);
    let [export] = record_named(&program, "barrel.js").exports.as_slice() else {
        panic!("barrel.js has one export");
    };
    assert_eq!(program.strings.get(export.name), b"padded");
    assert_eq!(export.kind, ModuleExportKind::Indirect);
    assert_eq!(export.module, find_module(&program, PLUGIN_URL));
    let import_name = export.import_name.map(|name| program.strings.get(name));
    assert_eq!(import_name, Some(&b"pad"[..]));
    assert_eq!(export.variable, None);
}

#[test]
fn names_resolved_at_run_time_are_required() {
    let program = link_program(&[
        (
            "main.js",
            "import { x } from './barrel.js';\nconsole.log(x);\n",
        ),
        (
            "barrel.js",
            "export * from './one.cjs';\nexport * from './two.cjs';\n",
        ),
        ("one.cjs", "exports.x = 1;\n"),
        ("two.cjs", "exports.x = 2;\n"),
    ]);
    let [required] = record_named(&program, "main.js").required_names.as_slice() else {
        panic!("main.js requires one name");
    };
    let RequiredName {
        module,
        name,
        may_be_absent,
    } = *required;
    assert!(!may_be_absent);
    assert_eq!(module, module_named(&program, "barrel.js"));
    assert_eq!(program.strings.get(name), b"x");
    let requests = &record_named(&program, "barrel.js").requests;
    assert!(
        requests
            .iter()
            .all(|request| request.is_dynamic_star_export)
    );
    assert_eq!(requests.len(), 2);
}

#[test]
fn only_name_re_exported_by_typescript_may_be_absent() {
    let re_export = "export { x } from './barrel.js';\n";
    let program = link_program(&[
        ("main.js", "import './typed.ts';\nimport './untyped.js';\n"),
        ("typed.ts", re_export),
        ("untyped.js", re_export),
        (
            "barrel.js",
            "export * from './one.cjs';\nexport * from './two.cjs';\n",
        ),
        ("one.cjs", "exports.x = 1;\n"),
        ("two.cjs", "exports.y = 2;\n"),
    ]);
    for (exporter, expected) in [("typed.ts", true), ("untyped.js", false)] {
        let [required] = record_named(&program, exporter).required_names.as_slice() else {
            panic!("{exporter} requires one name");
        };
        assert_eq!(required.may_be_absent, expected, "{exporter}");
        assert_eq!(required.module, module_named(&program, "barrel.js"));
        assert_eq!(program.strings.get(required.name), b"x");
    }
}

#[test]
fn names_of_a_commonjs_file_are_variables_that_its_body_stores() {
    let main = "import { a } from './legacy.cjs';\nimport * as legacy from './legacy.cjs';\nconsole.log(a, legacy.b);\n";
    let legacy = ("legacy.cjs", "exports.a = 1;\nexports.b = 2;\n");
    let program = link_program_without_bun_modules(&[("main.js", main), legacy]);
    let record = record_named(&program, "legacy.cjs");
    assert!(record.synthetic_exports.is_empty());
    assert!(record.exports.is_empty());
    assert_eq!(record.exports_variable, None);
    let module = module_named(&program, "legacy.cjs");
    let own_variables = program
        .variables
        .iter()
        .filter(|variable| variable.module == module);
    let mut names = Vec::new();
    for variable in own_variables {
        assert_eq!(variable.initialization, VariableInitialization::Undefined);
        names.push(variable.name.map(|name| program.strings.get(name)));
    }
    names.sort_unstable();
    assert_eq!(names, [Some(&b"a"[..]), Some(&b"b"[..])]);
}

#[test]
fn synthetic_exports_of_two_projects_are_sorted_together() {
    let program = link_program(&SHARED_NAME_IMPORTERS);
    let record = runtime_record(&program, RuntimeModule::NodePath);
    assert_eq!(record.kind, ModuleKind::RuntimeSource);
    let [own, shared] = record.synthetic_exports.as_slice() else {
        unreachable!("the record has two names");
    };
    let names = [own, shared].map(|export| program.strings.get(export.name));
    assert_eq!(names, [&b"own"[..], b"shared"]);
    assert!(own.variable.is_some() && shared.variable.is_some());
    assert_ne!(own.variable, shared.variable);
    assert!(!own.is_known_member && !shared.is_known_member);
}

#[test]
fn module_has_a_record_where_reached_code_requires_it() {
    let lazy = ("lazy.cjs", "module.exports = 1;\n");
    let main = "export const loaded = require('./lazy.cjs');\n";
    let program = link_program_without_bun_modules(&[("main.js", main), lazy]);
    assert!(record_named(&program, "lazy.cjs").body.is_some());
    let main = "export {};\nfunction dropped() {\n  return [dropped, require('./lazy.cjs')];\n}\n";
    let program = link_program_without_bun_modules(&[("main.js", main), lazy]);
    assert!(find_module(&program, "lazy.cjs").is_none());
}

#[test]
fn failed_import_call_has_a_failure_record() {
    let main = "export const missing = import('./missing.js');\n";
    let program = link_program_without_bun_modules(&[("main.js", main)]);
    let [failure] = program.module_failures.as_slice() else {
        panic!("{:?}", program.module_failures);
    };
    assert_eq!(failure.importer, module_named(&program, "main.js"));
    assert_eq!(program.strings.get(failure.specifier), b"./missing.js");
}

#[test]
fn failure_in_dropped_function_has_no_record() {
    let main = "export {};\nfunction dropped() {\n  return [dropped, import('./missing.js')];\n}\n";
    let program = link_program_without_bun_modules(&[("main.js", main)]);
    assert!(program.module_failures.is_empty());
}

#[test]
fn statement_failure_never_reaches_the_wire() {
    let main = "import './nope.js';\nexport const missing = import('./missing.js');\n";
    with_graph(&[("main.js", main)], |graph, input| {
        let specifiers_of = |failures: &[ModuleFailure]| -> Vec<Vec<u8>> {
            let specifiers = failures.iter().map(|failure| match failure.kind {
                ModuleFailureKind::Unresolved { specifier, .. } => specifier,
                other => panic!("{other:?}"),
            });
            specifiers
                .map(|specifier| input.files.atoms.bytes(specifier).to_vec())
                .collect()
        };
        assert_eq!(specifiers_of(graph.errors()), [b"./nope.js"]);
        assert_eq!(specifiers_of(graph.failures()), [b"./missing.js"]);
    });
}

#[test]
fn bun_module_only_imported_is_flagged() {
    let is_import_only = |program: &Program, module: RuntimeModule| {
        let record = runtime_record(program, module);
        assert_eq!(record.kind, ModuleKind::RuntimeSource, "{module:?}");
        record.flags.contains(ModuleFlags::IS_LOADED_BY_IMPORT_ONLY)
    };
    let main = "import { join } from 'node:path';\nconsole.log(join('a', 'b'));\n";
    let imported = link_program(&[("main.js", main)]);
    assert!(is_import_only(&imported, RuntimeModule::NodePath));
    for &module in STARTUP_MODULES {
        assert!(!is_import_only(&imported, module), "{module:?}");
    }
    let implied = link_program(&[("main.js", "process.stdout.write('a');\n")]);
    assert!(!is_import_only(&implied, RuntimeModule::NodeTty));
    let main = "import tty from 'node:tty';\nprocess.stdout.write(String(tty.isatty(1)));\n";
    let both = link_program(&[("main.js", main)]);
    assert!(!is_import_only(&both, RuntimeModule::NodeTty));
}

#[test]
fn only_sources_of_bun_modules_are_loaded_by_import_only() {
    let main = format!(
        "import a from './legacy.cjs';
         import d from './settings.json';
         import {{ Buffer }} from 'node:buffer';
         console.log(a, d, Buffer, import('{PLUGIN_URL}'));\n"
    );
    let program = link_program(&[
        ("main.js", main.as_str()),
        ("legacy.cjs", "module.exports = 1;\n"),
        ("settings.json", "{ \"x\": 1 }\n"),
    ]);
    for record in &program.modules {
        let is_import_only = record.flags.contains(ModuleFlags::IS_LOADED_BY_IMPORT_ONLY);
        assert!(!is_import_only || record.kind == ModuleKind::RuntimeSource);
    }
}

#[test]
fn runtime_functions_ascend_by_id() {
    let program = link_program(&[("main.js", "export {};\n")]);
    let entries = &program.runtime_functions;
    assert!(!entries.is_empty());
    assert!(entries.is_sorted_by(|first, second| first.id < second.id));
    let function_count = program.functions.len();
    assert!(
        entries
            .iter()
            .all(|entry| entry.function.index() < function_count)
    );
}

#[test]
fn main_entry_lists_the_default_export_for_serve() {
    let program = link_program(&[("main.js", "export default { port: 1 };\n")]);
    let [entry] = program.entries.as_slice() else {
        panic!("{:?}", program.entries);
    };
    assert_eq!(entry.module, module_named(&program, "main.js"));
    assert_eq!(
        entry.host_reads.len(),
        host_reads(HostReadContext::EntryPoint).count()
    );
    let mut reads = entry.host_reads.iter();
    let default_read = reads.find(|read| program.strings.get(read.export_name) == b"default");
    let default_read = default_read.expect("the host reads the default export");
    assert_eq!(default_read.builtin, Some(BuiltinId::BunServe));
    assert_eq!(default_read.parameter, 0);
}

#[test]
fn host_reads_follow_the_kind_of_entry_point() {
    let count_of = |context| host_reads(context).count();
    let entry_point_count = count_of(HostReadContext::EntryPoint);
    let worker_count = count_of(HostReadContext::Worker);
    assert!(entry_point_count > 0 && worker_count > 0);
    let cases = [
        (EntryPointKind::Main, entry_point_count),
        (EntryPointKind::Additional, entry_point_count + worker_count),
        (EntryPointKind::HostLoadedModule, 0),
        (EntryPointKind::ImportedModule, 0),
        (EntryPointKind::Library, 0),
    ];
    for (kind, expected) in cases {
        assert_eq!(host_reads_of(kind).count(), expected, "{kind:?}");
    }
}
