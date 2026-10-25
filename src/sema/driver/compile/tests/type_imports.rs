#[cfg(unix)]
use super::support::{TemporaryDirectory, disk, with_host};
use super::support::{TestProgram, check_only, from_bun_check, with_conditions, with_program};
use bun_sema::program::{CodeAnswer, FileId, FileRole, Files};
use bun_sema::util::SharedSort;

fn imported_files(files: &Files<'_>, importer: FileId, specifier: &str) -> Vec<FileId> {
    let imports = files.module(importer).imports.iter();
    let named = imports.filter(|(key, _)| files.atoms.bytes(key.0) == specifier.as_bytes());
    let mut found: Vec<FileId> = named.map(|(_, &file)| file).collect();
    found.shared_sort_unstable();
    found.dedup();
    found
}

fn files_with_unresolved_import(program: &TestProgram<'_, '_>) -> Vec<FileId> {
    let build = check_only(program);
    let unresolved = build.diagnostics().filter(|it| it.diagnostic.code == 2307);
    unresolved.filter_map(|it| it.diagnostic.file).collect()
}

fn with_aliased_library(main_text: &str, then: impl FnOnce(&TestProgram<'_, '_>)) {
    let files = [
        ("main.ts", main_text),
        (
            "lib/tsconfig.json",
            r#"{ "compilerOptions": {
                "module": "preserve", "moduleResolution": "bundler", "paths": { "@/*": ["./src/*"] }
            } }"#,
        ),
        ("lib/index.ts", r#"export { a } from "@/a";"#),
        ("lib/src/a.ts", "export const a = 1;"),
    ];
    with_program(&files, &["./main.ts"], 1, then);
}

#[test]
fn program_files_ignore_governing_paths() {
    let main_text = r#"export { a } from "./lib/index.ts";
        export { a as own } from "@/a";"#;
    with_aliased_library(main_text, |program| {
        let main = program.file("main.ts");
        assert!(imported_files(program.files(), main, "@/a").is_empty());
        assert_eq!(files_with_unresolved_import(program), [main]);
    });
}

const PROGRAM_WITH_ALIAS: (&str, &str) = (
    "tsconfig.json",
    r#"{ "compilerOptions": {
        "module": "preserve", "moduleResolution": "bundler",
        "paths": { "shared": ["./shared/index.ts"], "@/*": ["./shared/*"] }
    } }"#,
);

#[test]
fn program_resolves_what_governing_project_cannot() {
    let files = [
        PROGRAM_WITH_ALIAS,
        ("main.ts", r#"export { read } from "./tools/read.ts";"#),
        ("shared/index.ts", "export interface Shared { id: number }"),
        ("shared/a.ts", "export interface A { program: true }"),
        (
            "tools/tsconfig.json",
            r#"{ "compilerOptions": {
                "module": "preserve", "moduleResolution": "bundler", "paths": { "@/*": ["./own/*"] }
            } }"#,
        ),
        ("tools/own/a.ts", "export interface A { own: true }"),
        (
            "tools/read.ts",
            r#"import type { Shared } from "shared";
            import type { A } from "@/a";
            import type { Missing } from "nowhere";
            export function read(shared: Shared, a: A, missing: Missing) {
                return [shared, a, missing];
            }"#,
        ),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let read = program.file("tools/read.ts");
        assert!(!std::ptr::eq(files.module_options(read), files.options));
        assert_eq!(
            imported_files(files, read, "shared"),
            [program.file("shared/index.ts")]
        );
        assert_eq!(
            imported_files(files, read, "@/a"),
            [program.file("tools/own/a.ts")]
        );
        assert!(imported_files(files, read, "nowhere").is_empty());
        assert_eq!(files_with_unresolved_import(program), [read]);
    });
}

#[test]
fn unresolved_import_in_dependency_is_dropped() {
    let files = [
        ("main.ts", r#"export { value } from "dep";"#),
        (
            "node_modules/dep/package.json",
            r#"{ "name": "dep", "main": "./index.ts", "types": "./index.ts" }"#,
        ),
        (
            "node_modules/dep/index.ts",
            r#"import missing from "@/a";
            export const value = missing;"#,
        ),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        assert!(files_with_unresolved_import(program).is_empty());
    });
}

#[test]
fn inferred_file_sees_code_answers() {
    let files = [
        ("a.js", r#"module.exports = require("./b.js");"#),
        ("b.js", "module.exports = 1;"),
    ];
    with_program(&files, &["./a.js"], 1, |program| {
        let files = program.files();
        let (a, b) = (program.file("a.js"), program.file("b.js"));
        assert_eq!(files.role(a), FileRole::Inferred);
        assert_eq!(imported_files(files, a, "./b.js"), [b]);
        assert!(files.module(a).edges.is_empty());
        assert_eq!(files.module(a).code_edges, [b]);
    });
}

#[test]
fn uncompiled_javascript_root_resolves_like_bun_check() {
    let files = [
        (
            "tsconfig.json",
            r#"{
                "compilerOptions": {
                    "strict": true, "noLib": true, "types": [], "allowJs": true,
                    "module": "preserve", "moduleResolution": "bundler"
                },
                "include": ["*.ts", "root.js"]
            }"#,
        ),
        ("main.ts", "export {};"),
        ("root.js", r#"import "./imported.js";"#),
        ("imported.js", "export {};"),
    ];
    let file_count = with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let (root, imported) = (program.file("root.js"), program.file("imported.js"));
        assert_eq!(imported_files(files, root, "./imported.js"), [imported]);
        assert_eq!(files.module(root).edges, [imported]);
        for file in [root, imported] {
            assert_eq!(files.role(file), FileRole::Inferred);
            assert!(files.module(file).is_in_types_program);
            assert!(files.compiled(file).is_none());
            assert!(!files.is_compiled(file));
        }
        assert_eq!(files.compiled_files(), [program.file("main.ts")]);
        files.modules.len()
    });
    assert_eq!(
        file_count,
        from_bun_check(&files, |files| files.modules.len())
    );
}

#[test]
fn types_and_code_answers_differ() {
    let files = [
        ("main.ts", r#"export { value } from "dep";"#),
        (
            "node_modules/dep/package.json",
            r#"{ "name": "dep", "main": "./index.js", "types": "./index.d.ts" }"#,
        ),
        (
            "node_modules/dep/index.d.ts",
            "export declare const value: number;",
        ),
        ("node_modules/dep/index.js", "exports.value = 1;"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let main = program.file("main.ts");
        let declarations = program.file("node_modules/dep/index.d.ts");
        let code = program.file("node_modules/dep/index.js");
        assert_eq!(imported_files(files, main, "dep"), [declarations]);
        assert_eq!(files.module(main).edges, [declarations]);
        assert_eq!(files.code_answers(main), [CodeAnswer::File(code)]);
        assert_eq!(files.module(main).code_edges, [code]);
        assert!(files.module(main).redirected_imports.is_empty());
    });
}

const TYPED_IN_JSDOC: &str = r#"import "./other.js";
    /** @import { Size } from "./shapes" */
    /** @param {import("./shapes").Point} point @param {Size} size */
    export function scale(point, size) { return point.x * size.width; }"#;
const SHAPES: &str = "export interface Point { x: number } export interface Size { width: number }";
const JAVASCRIPT_DEPENDENCY: (&str, &str) = (
    "node_modules/dep/package.json",
    r#"{ "name": "dep", "version": "1.0.0", "type": "module", "main": "index.js" }"#,
);

fn assert_sees_shapes(program: &TestProgram<'_, '_>, typed: &str, other: &str, shapes: &str) {
    let files = program.files();
    let (typed, other, shapes) = (
        program.file(typed),
        program.file(other),
        program.file(shapes),
    );
    assert_eq!(files.role(typed), FileRole::Inferred);
    assert_eq!(files.role(shapes), FileRole::TypesOnly);
    assert_eq!(imported_files(files, typed, "./shapes"), [shapes]);
    assert_eq!(imported_files(files, typed, "./other.js"), [other]);
    assert_eq!(files.module(typed).code_edges, [other]);
}

#[test]
fn inferred_file_imports_what_only_jsdoc_names() {
    let files = [
        ("main.js", r#"import "dep";"#),
        JAVASCRIPT_DEPENDENCY,
        ("node_modules/dep/index.js", TYPED_IN_JSDOC),
        ("node_modules/dep/other.js", "export {};"),
        ("node_modules/dep/shapes.d.ts", SHAPES),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        assert_sees_shapes(
            program,
            "node_modules/dep/index.js",
            "node_modules/dep/other.js",
            "node_modules/dep/shapes.d.ts",
        );
    });
}

#[test]
fn inferred_file_in_types_program_imports_what_only_jsdoc_names() {
    let config = r#"{ "compilerOptions": {
        "module": "preserve", "moduleResolution": "bundler", "allowJs": true
    } }"#;
    let files = [
        ("tsconfig.json", config),
        ("main.ts", r#"export { scale } from "./typed.js";"#),
        ("typed.js", TYPED_IN_JSDOC),
        ("other.js", "export {};"),
        ("shapes.d.ts", SHAPES),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_sees_shapes(program, "typed.js", "other.js", "shapes.d.ts");
    });
}

#[test]
fn name_that_runs_keeps_code_answer_in_jsdoc() {
    let files = [
        ("main.js", r#"import "dep";"#),
        JAVASCRIPT_DEPENDENCY,
        (
            "node_modules/dep/index.js",
            r#"import "./lib";
            /** @param {import("./lib").Options} options */
            export function run(options) { return options; }"#,
        ),
        ("node_modules/dep/lib.js", "export {};"),
        (
            "node_modules/dep/lib.d.ts",
            "export interface Options { depth: number }",
        ),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let index = program.file("node_modules/dep/index.js");
        let lib = program.file("node_modules/dep/lib.js");
        assert_eq!(imported_files(program.files(), index, "./lib"), [lib]);
        // The declaration file is in the program for what it says of `lib.js` alone.
        let declarations = program.file("node_modules/dep/lib.d.ts");
        let own_declaration = imported_files(program.files(), lib, "declaration=");
        assert_eq!(own_declaration, [declarations]);
    });
}

#[test]
fn import_found_only_under_condition_of_build_is_resolved() {
    let files = [
        ("main.ts", r#"export { value } from "only";"#),
        (
            "node_modules/@types/bun/package.json",
            r#"{ "name": "@types/bun", "version": "1.0.0" }"#,
        ),
        (
            "node_modules/only/package.json",
            r#"{ "name": "only", "version": "1.0.0", "exports": { ".": { "source": "./index.ts" } } }"#,
        ),
        (
            "node_modules/only/index.ts",
            "export const value: number = 1;",
        ),
    ];
    with_conditions(&files, &["./main.ts"], &["source"], |program| {
        assert!(files_with_unresolved_import(program).is_empty());
    });
}

#[cfg(unix)]
#[test]
fn one_file_for_two_answers() {
    let directory = TemporaryDirectory::new("one_file_for_two_answers");
    let config = r#"{
        "compilerOptions": {
            "noLib": true, "types": [], "module": "preserve", "moduleResolution": "bundler"
        },
        "files": ["main.ts"]
    }"#;
    directory.write("tsconfig.json", config);
    directory.write("main.ts", r#"export { x } from "./linked/x.ts";"#);
    directory.write("real/x.ts", "export const x = 1;");
    directory.link("linked", "real");

    let root = directory.root();
    let disk = disk(1, Default::default(), &root);
    with_host(&disk, &root, "./main.ts", |program| {
        let files = program.files();
        let file_at = |name: &str| files.by_path.get(&directory.path_of(name));
        let main = file_at("main.ts").expect("the entry point");
        let x = file_at("real/x.ts").expect("named by its real path");
        assert_eq!(file_at("linked/x.ts"), None);
        let modules = files.modules.iter();
        let named_x = modules.filter(|it| it.file_name().ends_with(b"/x.ts"));
        assert_eq!(named_x.count(), 1);
        assert_eq!(imported_files(files, main, "./linked/x.ts"), [x]);
        assert_eq!(files.code_answers(main), [CodeAnswer::File(x)]);
        let quoted = files.module(main).redirected_imports.iter();
        let quoted: Vec<&[u8]> = quoted.map(|it| files.atoms.bytes(it.2)).collect();
        assert_eq!(quoted, [directory.path_of("linked/x.ts")]);
    });
}
