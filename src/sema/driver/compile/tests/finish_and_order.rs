use super::support::{from_bun_check, with_program};
use bstr::BString;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::util::SharedSort;

fn names_of(files: &Files<'_>, list: &[FileId]) -> Vec<BString> {
    let names = list.iter().map(|file| files.module(*file).file_name());
    let relative = names.map(|name| name.strip_prefix(b"/project/").unwrap_or(name));
    relative.map(BString::from).collect()
}

fn tsconfig(more_compiler_options: &str, more_members: &str) -> String {
    format!(
        r#"{{ "compilerOptions": {{
            "noLib": true, "types": [], "module": "preserve", "moduleResolution": "bundler"
            {more_compiler_options}
        }}{more_members} }}"#
    )
}

const REQUIRE_IN_TYPESCRIPT: [(&str, &str); 2] = [
    (
        "main.ts",
        r#"export const required = require("./required.ts");"#,
    ),
    ("required.ts", "export const value = 1;"),
];

#[test]
fn code_edge_target_is_not_leaf() {
    with_program(&REQUIRE_IN_TYPESCRIPT, &["./main.ts"], 1, |program| {
        let files = program.files();
        let (main, required) = (program.file("main.ts"), program.file("required.ts"));
        assert!(main != FileId(0) && required != FileId(0));
        assert!(files.module(main).edges.is_empty());
        assert_eq!(files.module(main).code_edges, [required]);
        assert!(files.module(main).is_leaf);
        assert!(!files.module(required).is_leaf);
    });
    let (is_first, is_leaf) = from_bun_check(&REQUIRE_IN_TYPESCRIPT, |files| {
        let required = files.by_path.get(b"/project/required.ts");
        let required = required.expect("a root file under `include`");
        (required == FileId(0), files.module(required).is_leaf)
    });
    assert!(!is_first);
    assert!(is_leaf);
}

#[test]
fn untyped_import_stays_untyped_without_allow_js() {
    for allow_js in [false, true] {
        let options = format!(r#", "noImplicitAny": false, "allowJs": {allow_js}"#);
        let config = tsconfig(&options, "");
        let files = [
            ("tsconfig.json", config.as_str()),
            ("main.ts", r#"export { value } from "./untyped.js";"#),
            ("untyped.js", "export const value = 1;"),
        ];
        with_program(&files, &["./main.ts"], 1, |program| {
            let files = program.files();
            let (main, untyped) = (program.file("main.ts"), program.file("untyped.js"));
            assert_eq!(files.role(untyped), FileRole::Inferred);
            assert!(files.is_compiled(untyped));
            assert_eq!(files.module(main).code_edges, [untyped]);
            let mut imported = files.module(main).imports.values();
            assert_eq!(imported.any(|&file| file == untyped), allow_js);
            assert_eq!(files.module(main).edges.contains(&untyped), allow_js);
            assert_eq!(files.module(untyped).is_in_types_program, allow_js);
            assert!(files.module(main).is_in_types_program);
        });
    }
}

#[test]
fn typed_files_reached_by_code_join_types_program() {
    let config = tsconfig("", r#", "include": ["globals.d.ts"]"#);
    let files = [
        ("tsconfig.json", config.as_str()),
        (
            "main.js",
            r#"import "./typed.ts";
            import "./declared.d.ts";"#,
        ),
        (
            "typed.ts",
            r#"import type { Shape } from "./shape";
            export const shape: Shape = { side: 1 };"#,
        ),
        ("shape.d.ts", "export interface Shape { side: number }"),
        ("declared.d.ts", "export declare const declared: number;"),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let files = program.files();
        for path in ["globals.d.ts", "typed.ts", "shape.d.ts", "declared.d.ts"] {
            let module = files.module(program.file(path));
            assert!(module.is_in_types_program, "{path}");
        }
        assert!(!files.module(program.file("main.js")).is_in_types_program);
        let expected = [
            "globals.d.ts",
            "shape.d.ts",
            "typed.ts",
            "declared.d.ts",
            "main.js",
        ];
        assert_eq!(names_of(files, files.order), expected);
        let compiled_files = names_of(files, files.compiled_files());
        assert_eq!(compiled_files, ["typed.ts", "main.js"]);
    });
}

const IMPORT_CYCLE: [(&str, &str); 6] = [
    (
        "main.ts",
        r#"import "./a.ts";
        import "./b.ts";
        import "./declared.d.ts";
        import type { OnlyType } from "./only_type.ts";
        export type Alias = OnlyType;"#,
    ),
    ("a.ts", r#"import "./b.ts";"#),
    ("b.ts", r#"import "./a.ts";"#),
    ("declared.d.ts", "export declare const declared: number;"),
    ("only_type.ts", "export type OnlyType = number;"),
    ("prelude.ts", "export const prelude = 1;"),
];

#[test]
fn compiled_files_order() {
    for threads in [1, 4] {
        with_program(&IMPORT_CYCLE, &["./main.ts"], threads, |program| {
            let files = program.files();
            let compiled_files = names_of(files, files.compiled_files());
            assert_eq!(
                compiled_files,
                ["b.ts", "a.ts", "main.ts"],
                "{threads} threads"
            );

            let code_edges = names_of(files, files.module(program.file("main.ts")).code_edges);
            assert_eq!(code_edges, ["a.ts", "b.ts", "declared.d.ts"]);
            let declared = program.file("declared.d.ts");
            assert_eq!(files.role(declared), FileRole::TypesOnly);
            for path in ["declared.d.ts", "only_type.ts", "prelude.ts"] {
                assert!(!files.is_compiled(program.file(path)), "{path}");
            }
        });
    }
}

#[test]
fn compiled_files_follow_entry_point_order() {
    with_program(
        &IMPORT_CYCLE,
        &["./prelude.ts", "./main.ts"],
        1,
        |program| {
            let files = program.files();
            let compiled_files = names_of(files, files.compiled_files());
            assert_eq!(compiled_files, ["prelude.ts", "b.ts", "a.ts", "main.ts"]);
        },
    );
    with_program(&IMPORT_CYCLE, &["./b.ts", "./main.ts"], 1, |program| {
        let files = program.files();
        let compiled_files = names_of(files, files.compiled_files());
        assert_eq!(compiled_files, ["a.ts", "b.ts", "main.ts"]);
    });
}

#[test]
fn repeated_entry_point_is_compiled_once() {
    with_program(&IMPORT_CYCLE, &["./main.ts", "./main.ts"], 1, |program| {
        let files = program.files();
        let main = program.file("main.ts");
        assert_eq!(files.entry_points(), [main, main]);
        let compiled_files = names_of(files, files.compiled_files());
        assert_eq!(compiled_files, ["b.ts", "a.ts", "main.ts"]);
    });
}

#[test]
fn every_file_has_rank() {
    let files = [
        (
            "main.ts",
            r#"import "./a.ts";
            export const z = require("./z.js");"#,
        ),
        ("a.ts", "export const a = 1;"),
        ("z.js", r#"module.exports = require("./y.js");"#),
        ("y.js", "module.exports = 1;"),
    ];
    let bun_check_order = from_bun_check(&files, |files| names_of(files, files.order));
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let file_count = files.modules.len() as u32;
        let ranks = (0..file_count).map(|id| files.rank_of_file(FileId(id)));
        let mut ranks: Vec<u32> = ranks.collect();
        ranks.shared_sort_unstable();
        assert!(ranks.into_iter().eq(0..file_count));
        for (rank, &file) in (0..).zip(files.order) {
            assert_eq!(files.rank_of_file(file), rank);
        }

        let is_in_types_program = |file: &&FileId| files.module(**file).is_in_types_program;
        let typed_count = files.order.iter().filter(is_in_types_program).count();
        let (typed, untyped) = files.order.split_at(typed_count);
        assert_eq!(names_of(files, typed), bun_check_order);
        assert_eq!(names_of(files, untyped), ["y.js", "z.js"]);
    });
}
