use super::*;
use crate::modules::module_set::collect_modules;
use bun_sema::program::FileRole;

fn with_scans(files: &[(&str, &str)], check: impl FnOnce(Scans, &BoundProgram<'_, '_, '_>)) {
    with_program(files, |program| check(scan_files(program.input), program));
}

fn with_module_set(
    files: &[(&str, &str)],
    check: impl FnOnce(&ModuleSet, &BoundProgram<'_, '_, '_>),
) {
    with_scans(files, |scans, program| {
        check(&collect_modules(program.input, &scans), program);
    });
}

fn scan_of(scans: &mut Scans, file: FileId) -> &mut FileScan {
    let scan = scans.by_file[file.idx()].as_mut();
    scan.expect("a file the loader did not compile")
}

#[test]
fn every_compiled_file_has_a_record() {
    let files = [
        (
            "main.js",
            "import './es.js'; import './legacy.cjs'; import './data.json'; import('./lazy.js');",
        ),
        ("es.js", "export {};"),
        (
            "legacy.cjs",
            r#"exports.add = new Function("a", "b", "return a + b");"#,
        ),
        ("data.json", "{}"),
        ("lazy.js", "export {};"),
    ];
    with_module_set(&files, |modules, program| {
        let mut loaded_files = program.input.files.compiled_files().to_vec();
        loaded_files.sort_unstable();
        assert_eq!(loaded_files.len(), files.len() + 1);
        assert_eq!(modules.compiled_files, loaded_files);
        assert_eq!(modules.record_files, loaded_files);
        for &file in &loaded_files {
            let interop = file_interop(program.input.files, program.input.sources, file);
            assert_eq!(modules.interop(ModuleRef::File(file)), interop);
        }
        assert!(modules.other_modules.is_empty());
        assert!(modules.external_kinds.is_empty());
    });
}

#[test]
fn declaration_file_target_gets_a_record() {
    let files = [
        ("main.js", "import './types.d.ts';"),
        ("types.d.ts", "export declare const x: number;"),
    ];
    with_module_set(&files, |modules, program| {
        let (main, types) = (program.file("main.js"), program.file("types.d.ts"));
        assert_eq!(program.input.files.role(types), FileRole::TypesOnly);
        assert_eq!(modules.compiled_files, [main]);
        let mut expected = [main, types];
        expected.sort_unstable();
        assert_eq!(modules.record_files, expected);
        assert_eq!(
            modules.interop(ModuleRef::File(types)).kind,
            ModuleKind::SourceText
        );
    });
}

#[test]
fn candidates_are_modules_of_the_set() {
    let files = [
        ("main.cjs", PATTERN_REQUIRE),
        ("pages/home.js", "exports.x = 1;"),
    ];
    with_scans(&files, |mut scans, program| {
        let (main, home) = (program.file("main.cjs"), program.file("pages/home.js"));
        assert_eq!(scans.of(main).candidates, [ModuleRef::File(home)]);
        let runtime = ModuleRef::Runtime(RuntimeModule::NodeFs);
        scan_of(&mut scans, main)
            .candidates
            .extend([runtime, runtime]);
        let modules = collect_modules(program.input, &scans);
        assert!(modules.record_files.contains(&home));
        assert_eq!(modules.other_modules, [runtime]);
    });
}

#[test]
fn two_kinds_join_to_uncompiled_code() {
    let main = format!("import '{HOST_VALUE_MODULE}';");
    let added_kinds = [
        (ExternalKind::HostValue, ExternalKind::HostValue),
        (ExternalKind::UncompiledCode, ExternalKind::UncompiledCode),
    ];
    for (added, expected) in added_kinds {
        with_scans(&[("main.js", main.as_str())], |mut scans, program| {
            let importer = program.file("main.js");
            let specifier = program.atom(HOST_VALUE_MODULE);
            let externals = &mut scan_of(&mut scans, importer).externals;
            assert_eq!(*externals, [(specifier, ExternalKind::HostValue)]);
            externals.push((specifier, added));
            let modules = collect_modules(program.input, &scans);
            assert_eq!(modules.external_kinds, [((importer, specifier), expected)]);
            let module = ModuleRef::External {
                importer,
                specifier,
            };
            assert_eq!(modules.interop(module), Interop::of_external(expected));
            let is_uncompiled_code = expected == ExternalKind::UncompiledCode;
            assert_eq!(modules.is_uncompiled_code(module), is_uncompiled_code);
        });
    }
}

#[test]
fn kind_belongs_to_importer_and_specifier() {
    let both =
        format!("import '{UNCOMPILED_MODULE}'; import '{HOST_VALUE_MODULE}'; import './a.js';");
    let other = format!("import '{UNCOMPILED_MODULE}';");
    let files = [("main.js", both.as_str()), ("a.js", other.as_str())];
    with_module_set(&files, |modules, program| {
        let external = |importer: &str, specifier: &str| ModuleRef::External {
            importer: program.file(importer),
            specifier: program.atom(specifier),
        };
        assert!(modules.is_uncompiled_code(external("main.js", UNCOMPILED_MODULE)));
        assert!(modules.is_uncompiled_code(external("a.js", UNCOMPILED_MODULE)));
        assert!(!modules.is_uncompiled_code(external("main.js", HOST_VALUE_MODULE)));
        assert_eq!(modules.external_kinds.len(), 3);
        assert_eq!(modules.other_modules.len(), 3);
        assert!(!modules.is_uncompiled_code(program.module("a.js")));
        assert!(!modules.is_uncompiled_code(ModuleRef::Runtime(RuntimeModule::NodeFs)));
    });
}

#[test]
fn only_modules_with_export_table_are_table_files() {
    let files = [
        (
            "main.js",
            "import './legacy.cjs'; import './data.json'; import 'node:buffer';",
        ),
        ("legacy.cjs", "exports.x = 1;"),
        ("data.json", "{}"),
    ];
    with_module_set(&files, |modules, program| {
        for name in ["main.js", "data.json"] {
            let file = program.file(name);
            assert_eq!(
                modules.table_file(ModuleRef::File(file)),
                Some(file),
                "{name}"
            );
        }
        assert_eq!(modules.table_file(program.module("legacy.cjs")), None);
        assert!(!modules.other_modules.is_empty());
        for &module in &modules.other_modules {
            assert_eq!(modules.table_file(module), None);
            assert_eq!(modules.interop(module), Interop::RUNTIME);
        }
    });
}

#[test]
fn other_modules_are_sorted_and_unique() {
    let main = format!(
        "import '{UNCOMPILED_MODULE}'; import 'node:path'; import 'node:fs'; import './a.js';"
    );
    let other =
        format!("import 'node:fs'; import '{UNCOMPILED_MODULE}'; import 'data:text/javascript,';");
    let files = [("main.js", main.as_str()), ("a.js", other.as_str())];
    with_module_set(&files, |modules, program| {
        let atoms = &program.input.files.atoms;
        let is_less = |a: &ModuleRef, b: &ModuleRef| compare_modules(*a, *b, atoms).is_lt();
        assert_eq!(modules.other_modules.len(), 5);
        assert!(modules.other_modules.is_sorted_by(is_less));
    });
}
