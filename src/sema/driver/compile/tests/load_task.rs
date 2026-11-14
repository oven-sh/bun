use super::support::{
    HostScript, PROJECT, ScriptedHost, from_bun_check, project_disk, with_host, with_program,
};
use bstr::BString;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::{FileId, FileRole, Files};

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let absolute = format!("/project/{path}");
    let found = files.by_path.get(absolute.as_bytes());
    found.unwrap_or_else(|| panic!("{absolute} is not in the program"))
}

fn declares_global(files: &Files<'_>, name: &str) -> bool {
    let atom = files.atoms.lookup(name.as_bytes());
    atom.is_some_and(|atom| files.globals.contains_key(atom))
}

const FILES_OF_EVERY_ROLE: [(&str, &str); 6] = [
    (
        "tsconfig.json",
        r#"{ "compilerOptions": {
            "strict": true, "noLib": true, "types": [],
            "module": "preserve", "moduleResolution": "bundler",
            "allowJs": true, "resolveJsonModule": true
        } }"#,
    ),
    (
        "main.ts",
        r#"import "./a.js";
        import "./b.mjs";
        import data from "./data.json";
        import type { Size } from "./size";
        export const size: Size = data.size;"#,
    ),
    ("a.js", "export const a = 1;"),
    ("b.mjs", "export const b = 2;"),
    ("data.json", r#"{ "size": 1 }"#),
    ("size.d.ts", "export type Size = number;"),
];

const ROLES: [(&str, FileRole); 5] = [
    ("main.ts", FileRole::Checked),
    ("a.js", FileRole::Inferred),
    ("b.mjs", FileRole::Inferred),
    ("data.json", FileRole::Inferred),
    ("size.d.ts", FileRole::TypesOnly),
];

#[test]
fn role_follows_tree() {
    with_program(&FILES_OF_EVERY_ROLE, &["./main.ts"], 1, |program| {
        let files = program.files();
        assert!(files.is_compile_build());
        for (path, role) in ROLES {
            let file = file_at(files, path);
            assert_eq!(files.role(file), role, "{path}");
            let has_code = role != FileRole::TypesOnly;
            assert_eq!(files.compiled(file).is_some(), has_code, "{path}");
        }
    });
}

#[test]
fn bun_check_sets_role_only() {
    let is_compile_build = from_bun_check(&FILES_OF_EVERY_ROLE, |files| {
        for (path, role) in ROLES {
            let file = file_at(files, path);
            assert_eq!(files.role(file), role, "{path}");
            assert!(files.compiled(file).is_none(), "{path}");
            assert!(files.module(file).code_edges.is_empty(), "{path}");
        }
        assert!(files.entry_points().is_empty());
        assert!(files.compiled_files().is_empty());
        files.is_compile_build()
    });
    assert!(!is_compile_build);
}

const INSTALLED_SHAPES: &str = "export function area(side) {\n  return side * side;\n}\n";
const TYPED_SHAPES: &str =
    "export function area(side: number): number {\n  return side * side;\n}\n";

fn with_shapes_package(
    installed_text: &str,
    typed_text: &str,
    then: impl FnOnce(&Files<'_>, FileId),
) {
    let files = [
        ("main.ts", r#"import "shapes";"#),
        (
            "node_modules/shapes/package.json",
            r#"{
                "name": "shapes",
                "version": "1.0.0",
                "exports": { ".": { "aot": "./index.aot.ts", "default": "./index.js" } }
            }"#,
        ),
        ("node_modules/shapes/index.js", installed_text),
        ("node_modules/shapes/index.aot.ts", typed_text),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        assert!(
            files
                .by_path
                .get(b"/project/node_modules/shapes/index.js")
                .is_none()
        );
        then(files, file_at(files, "node_modules/shapes/index.aot.ts"));
    });
}

#[test]
fn file_under_the_aot_condition_is_compiled() {
    with_shapes_package(INSTALLED_SHAPES, TYPED_SHAPES, |files, shapes| {
        assert_eq!(files.role(shapes), FileRole::Checked);
        assert!(!files.hir(shapes).is_js);
        assert_eq!(&*files.hir(shapes).text, TYPED_SHAPES.as_bytes());
        let compiled = files.compiled(shapes).expect("a file with code");
        assert!(compiled.is_aot_source);
    });
}

#[test]
fn file_under_the_aot_condition_is_module() {
    let installed_text = "var sides = 4;\n";
    let typed_text = "var sides: number = 4;\n";
    with_shapes_package(installed_text, typed_text, |files, shapes| {
        assert_eq!(files.role(shapes), FileRole::Checked);
        assert!(files.module(shapes).is_module());
        assert!(!declares_global(files, "sides"));
    });
}

#[test]
fn file_without_module_syntax_is_module() {
    let files = [("a.js", "var x = 1;"), ("script.ts", "var y = 1;")];
    with_program(&files, &["./a.js", "./script.ts"], 1, |program| {
        let files = program.files();
        for (path, name) in [("a.js", "x"), ("script.ts", "y")] {
            assert!(files.module(file_at(files, path)).is_module(), "{path}");
            assert!(!declares_global(files, name), "{path}");
        }
    });
}

fn unused_imports(main_text: &str) -> Vec<BString> {
    let files = [
        ("main.tsx", main_text),
        (
            "node_modules/react/package.json",
            r#"{ "name": "react", "version": "19.0.0", "main": "index.js" }"#,
        ),
        (
            "node_modules/react/index.js",
            "exports.createElement = function () {};",
        ),
    ];
    with_program(&files, &["./main.tsx"], 1, |program| {
        let files = program.files();
        let main = file_at(files, "main.tsx");
        let unused = files.analysis(main).unused_import_symbols.iter();
        let names = unused.map(|&symbol| files.bound(main).symbol(symbol).name);
        names
            .map(|name| BString::from(files.atoms.bytes(name)))
            .collect()
    })
}

#[test]
fn classic_pragma_binds_factory() {
    let text = "import React from \"react\";\nexport const element = <div />;\n";
    let with_pragma = format!("/* @jsxRuntime classic */\n{text}");
    assert!(unused_imports(&with_pragma).is_empty());
    assert_eq!(unused_imports(text), ["React"]);
}

#[test]
fn source_text_is_stored() {
    let text = "export const answer = 42;\n";
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let files = program.files();
        assert_eq!(&*files.hir(file_at(files, "main.ts")).text, text.as_bytes());
    });
}

const TWO_MACRO_CALLS: &str = r#"import { m } from "./m.ts" with { type: "macro" };
export const first = m();
export const second = m();
"#;

#[test]
fn macro_rounds_end_when_no_call_is_pending() {
    let disk = project_disk(&[("main.js", TWO_MACRO_CALLS)], 1);
    let script = HostScript {
        answers_macros: true,
        ..HostScript::default()
    };
    let host = ScriptedHost(&disk, script);
    with_host(&host, PROJECT, "./main.js", |program| {
        let files = program.files();
        let main = file_at(files, "main.js");
        assert!(files.analysis(main).pending_macro_calls.is_empty());
    });
    assert_eq!(host.1.macro_rounds(), 2);
}

#[test]
fn macro_rounds_end_without_new_result() {
    let disk = project_disk(&[("main.js", TWO_MACRO_CALLS)], 1);
    let host = ScriptedHost(&disk, HostScript::default());
    with_host(&host, PROJECT, "./main.js", |program| {
        let files = program.files();
        let main = file_at(files, "main.js");
        assert_eq!(files.analysis(main).pending_macro_calls.len(), 2);
    });
    assert_eq!(host.1.macro_rounds(), 1);
}

#[test]
fn package_type_applies_to_typescript() {
    let module_package = [
        ("package.json", r#"{ "type": "module" }"#),
        ("main.ts", "export {};"),
    ];
    with_program(&module_package, &["./main.ts"], 1, |program| {
        let files = program.files();
        let compiled = files
            .compiled(file_at(files, "main.ts"))
            .expect("a file with code");
        assert!(compiled.is_package_type_module);
        assert_eq!(compiled.declared_module_type, DeclaredModuleType::Esm);
    });
    with_program(&[("main.ts", "export {};")], &["./main.ts"], 1, |program| {
        let files = program.files();
        let compiled = files
            .compiled(file_at(files, "main.ts"))
            .expect("a file with code");
        assert!(!compiled.is_package_type_module);
        assert_eq!(compiled.declared_module_type, DeclaredModuleType::Unknown);
    });
}
