use super::support::{TestProgram, check_only, from_bun_check, with_program};
use bstr::BString;
use bun_sema::hir::ResolutionMode;
use bun_sema::program::{CodeAnswer, ComputedTargets, FileId, FileRole, Files, HostModuleId};
use bun_sema::resolve::{CodeFailure, ComputedUnknown, ExternalKind};
use bun_sema::util::SharedSort;

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let absolute = format!("/project/{path}");
    let found = files.by_path.get(absolute.as_bytes());
    found.unwrap_or_else(|| panic!("{absolute} is not in the program"))
}

fn imported_files(files: &Files<'_>, importer: FileId, specifier: &str) -> Vec<FileId> {
    let imports = files.module(importer).imports.iter();
    let named = imports.filter(|(key, _)| files.atoms.bytes(key.0) == specifier.as_bytes());
    let mut found: Vec<FileId> = named.map(|(_, &file)| file).collect();
    found.shared_sort_unstable();
    found.dedup();
    found
}

fn count_files_named(files: &Files<'_>, suffix: &str) -> usize {
    let names = files.modules.iter().map(|module| module.file_name());
    names
        .filter(|name| name.ends_with(suffix.as_bytes()))
        .count()
}

#[derive(PartialEq, Eq, Debug)]
enum AnswerShape {
    File(FileId),
    HostModule(HostModuleId),
    External(BString, ExternalKind),
    Erased,
    Modules(Vec<FileId>, Vec<HostModuleId>),
    All(ComputedUnknown, Vec<HostModuleId>),
    NotFound(CodeFailure),
}

impl AnswerShape {
    fn of(files: &Files<'_>, answer: CodeAnswer<'_>) -> AnswerShape {
        match answer {
            CodeAnswer::File(file) => AnswerShape::File(file),
            CodeAnswer::HostModule(module) => AnswerShape::HostModule(module),
            CodeAnswer::External { specifier, kind } => {
                AnswerShape::External(files.atoms.bytes(specifier).into(), kind)
            }
            CodeAnswer::Erased => AnswerShape::Erased,
            CodeAnswer::Computed(ComputedTargets::Modules {
                files: targets,
                host_modules,
                spellings: _,
            }) => AnswerShape::Modules(targets.to_vec(), host_modules.to_vec()),
            CodeAnswer::Computed(ComputedTargets::All {
                cause,
                host_modules,
            }) => AnswerShape::All(cause, host_modules.to_vec()),
            CodeAnswer::NotFound(failure) => AnswerShape::NotFound(failure),
        }
    }
}

#[derive(PartialEq, Eq, Debug)]
struct FileShape {
    name: BString,
    role: FileRole,
    rank: u32,
    edges: Vec<FileId>,
    imports: Vec<(BString, ResolutionMode, FileId)>,
    code_edges: Vec<FileId>,
    code_answers: Vec<AnswerShape>,
    is_compiled: bool,
    is_in_types_program: bool,
    is_from_external_library: bool,
    is_leaf: bool,
    has_own_options: bool,
}

impl FileShape {
    fn of(files: &Files<'_>, file: FileId) -> FileShape {
        let module = files.module(file);
        let imports = module.imports.iter().map(|(&(specifier, mode), &target)| {
            let specifier = BString::from(files.atoms.bytes(specifier));
            (specifier, mode, target)
        });
        let mut imports: Vec<(BString, ResolutionMode, FileId)> = imports.collect();
        imports.shared_sort_unstable();
        let code_answers = files.code_answers(file).iter();
        FileShape {
            name: module.file_name().into(),
            role: files.role(file),
            rank: files.rank_of_file(file),
            edges: module.edges.to_vec(),
            imports,
            code_edges: module.code_edges.to_vec(),
            code_answers: code_answers.map(|&it| AnswerShape::of(files, it)).collect(),
            is_compiled: files.is_compiled(file),
            is_in_types_program: module.is_in_types_program,
            is_from_external_library: module.is_from_external_library,
            is_leaf: module.is_leaf,
            has_own_options: !std::ptr::eq(files.module_options(file), files.options),
        }
    }
}

#[derive(PartialEq, Eq, Debug)]
struct ProgramShape {
    files: Vec<FileShape>,
    order: Vec<FileId>,
    entry_points: Vec<FileId>,
    compiled_files: Vec<FileId>,
    host_modules: Vec<HostModuleId>,
}

impl ProgramShape {
    fn of(files: &Files<'_>) -> ProgramShape {
        let ids = (0..files.modules.len() as u32).map(FileId);
        ProgramShape {
            files: ids.map(|file| FileShape::of(files, file)).collect(),
            order: files.order.to_vec(),
            entry_points: files.entry_points().to_vec(),
            compiled_files: files.compiled_files().to_vec(),
            host_modules: files.host_modules().to_vec(),
        }
    }
}

const GENERATED_FILE_COUNT: usize = 300;

fn generated_name(index: usize) -> String {
    let extension = if index.is_multiple_of(3) { "js" } else { "ts" };
    format!("f{index}.{extension}")
}

fn generated_files() -> Vec<(String, String)> {
    let files = (0..GENERATED_FILE_COUNT).map(|index| {
        let targets = [7 * index + 1, 13 * index + 5, 29 * index + 11];
        let imports = targets.map(|target| {
            let name = generated_name(target % GENERATED_FILE_COUNT);
            format!("import \"./{name}\";\n")
        });
        let text = format!("{}export const value = {index};\n", imports.concat());
        (generated_name(index), text)
    });
    files.collect()
}

#[test]
fn numbers_do_not_depend_on_threads() {
    let generated = generated_files();
    let files = generated.iter().map(|(name, text)| (&name[..], &text[..]));
    let files: Vec<(&str, &str)> = files.collect();
    let [sequential, parallel] = [1, 8].map(|threads| {
        with_program(&files, &["./f1.ts"], threads, |program| {
            ProgramShape::of(program.files())
        })
    });
    let is_generated = |file: &&FileShape| file.name.starts_with(b"/project/f");
    let generated_count = sequential.files.iter().filter(is_generated).count();
    assert_eq!(generated_count, GENERATED_FILE_COUNT);
    assert_eq!(sequential.compiled_files.len(), GENERATED_FILE_COUNT);
    assert_eq!(sequential, parallel);
}

const TYPED_MANIFEST: &str = r#"{
    "name": "typed",
    "version": "1.0.0",
    "exports": { ".": { "aot": "./index.aot.ts", "default": "./index.js" } }
}"#;

const MISTYPED_MANIFEST: &str = r#"{
    "name": "mistyped",
    "version": "1.0.0",
    "exports": { ".": { "aot": "./index.aot.ts", "default": "./index.js" } }
}"#;

const DEP_MANIFEST: &str = r#"{ "name": "dep", "version": "1.0.0", "main": "./index.js" }"#;
const DEP_CODE: &str = "exports.value = 1;";
const DEP_DECLARATIONS: &str = "export declare const value: number;";

const TWO_COPIES_OF_DEP: [(&str, &str); 6] = [
    (
        "main.ts",
        r#"import { value } from "dep";
        import { inner } from "./sub/inner";
        export const values = [value, inner];"#,
    ),
    (
        "sub/inner.ts",
        r#"import { value } from "dep";
        export const inner = value;"#,
    ),
    ("node_modules/dep/package.json", DEP_MANIFEST),
    ("node_modules/dep/index.js", DEP_CODE),
    ("sub/node_modules/dep/package.json", DEP_MANIFEST),
    ("sub/node_modules/dep/index.js", DEP_CODE),
];

const DECLARATIONS_OF_BOTH_COPIES: [(&str, &str); 2] = [
    ("node_modules/dep/index.d.ts", DEP_DECLARATIONS),
    ("sub/node_modules/dep/index.d.ts", DEP_DECLARATIONS),
];

const EVERY_KIND_OF_IMPORT: [(&str, &str); 17] = [
    (
        "app.tsx",
        r#"import "./main.ts";
        import "./cycle/a.ts";
        import "typed";
        import "mistyped";
        import "https://example.com/x.js";
        import "./missing.js";
        import "./declared.d.ts";
        import "./lib/governed.ts";
        import type { Size } from "./size.ts";
        export const size: Size = 1;
        export const element = <div />;
        export const load = (name: string) => import(`./pages/${name}.js`);
        export const loadAny = (name: string) => import(name);"#,
    ),
    ("cycle/a.ts", r#"import "./b.ts";"#),
    ("cycle/b.ts", r#"import "./a.ts";"#),
    ("node_modules/typed/package.json", TYPED_MANIFEST),
    ("node_modules/typed/index.js", "export const sides = 4;\n"),
    (
        "node_modules/typed/index.aot.ts",
        "export const sides: number = 4;\n",
    ),
    ("node_modules/mistyped/package.json", MISTYPED_MANIFEST),
    (
        "node_modules/mistyped/index.aot.ts",
        "export const sides = 4;\n",
    ),
    (
        "node_modules/mistyped/index.aot.ts",
        "export const sides: number = \"5\";\n",
    ),
    (
        "node_modules/react/package.json",
        r#"{ "name": "react", "version": "19.0.0" }"#,
    ),
    ("node_modules/react/jsx-runtime.js", ""),
    ("declared.d.ts", "export declare const declared: number;"),
    ("lib/tsconfig.json", "{}"),
    ("lib/governed.ts", "export {};"),
    ("size.ts", "export type Size = number;"),
    ("pages/a.js", r#"import "./b.js";"#),
    ("pages/b.js", ""),
];

#[test]
fn every_kind_of_import_does_not_depend_on_threads() {
    let files = [
        &EVERY_KIND_OF_IMPORT[..],
        &TWO_COPIES_OF_DEP[..],
        &DECLARATIONS_OF_BOTH_COPIES[..],
    ]
    .concat();
    let load_with_threads = |threads: usize| {
        with_program(&files, &["./app.tsx", "./cycle/b.ts"], threads, |program| {
            ProgramShape::of(program.files())
        })
    };
    let sequential = load_with_threads(1);
    let names = sequential.files.iter().map(|file| &file.name[..]);
    let names: Vec<&[u8]> = names.collect();
    for path in [
        "pages/a.js",
        "cycle/a.ts",
        "lib/governed.ts",
        "node_modules/mistyped/index.aot.ts",
    ] {
        assert!(
            names.contains(&format!("/project/{path}").as_bytes()),
            "{path}"
        );
    }
    for threads in [2, 8] {
        assert_eq!(load_with_threads(threads), sequential, "{threads} threads");
    }
}

#[test]
fn types_program_comes_first() {
    let files = [
        (
            "main.ts",
            r#"import "./a.ts";
            require("./z.js");"#,
        ),
        ("a.ts", "export {};"),
        ("z.js", r#"require("./y.js");"#),
        ("y.js", "module.exports = 1;"),
    ];
    let typed = ["main.ts", "a.ts", "globals.d.ts"];
    let typed_ids = with_program(&files, &["./main.ts"], 1, |program| {
        let typed_ids = typed.map(|path| program.file(path));
        let (z, y) = (program.file("z.js"), program.file("y.js"));
        assert!(typed_ids.iter().all(|&file| file < y));
        assert!(y < z);
        typed_ids
    });
    let (checked_ids, checked_count) = from_bun_check(&files, |files| {
        let ids = typed.map(|path| file_at(files, path));
        (ids, files.modules.len())
    });
    assert_eq!(checked_ids, typed_ids);
    assert_eq!(checked_count, typed.len());
}

#[test]
fn untyped_package_stays_untyped() {
    let config = r#"{
        "compilerOptions": {
            "strict": true, "noImplicitAny": false, "noLib": true, "types": [], "allowJs": true,
            "module": "preserve", "moduleResolution": "bundler"
        },
        "files": ["main.ts", "globals.d.ts"]
    }"#;
    let files = [
        ("tsconfig.json", config),
        (
            "main.ts",
            r#"import { f } from "dep";
            import { g } from "./own.js";
            f.nope.nope;
            g();"#,
        ),
        ("own.js", "export function g() {}"),
        (
            "node_modules/dep/package.json",
            r#"{ "name": "dep", "version": "1.0.0" }"#,
        ),
        ("node_modules/dep/index.js", "export function f() {}"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let files = program.files();
        let (main, own) = (program.file("main.ts"), program.file("own.js"));
        let dep = program.file("node_modules/dep/index.js");
        assert!(imported_files(files, main, "dep").is_empty());
        assert!(!files.module(main).edges.contains(&dep));
        assert!(files.code_answers(main).contains(&CodeAnswer::File(dep)));
        assert!(files.is_compiled(dep));
        assert!(!files.module(dep).is_in_types_program);

        assert_eq!(imported_files(files, main, "./own.js"), [own]);
        assert!(files.module(main).edges.contains(&own));
        assert!(files.module(own).is_in_types_program);

        assert_eq!(check_only(program).codes(), [0; 0]);
    });
}

#[test]
fn javascript_with_type_task_stays_typed() {
    let config = r#"{
        "compilerOptions": {
            "strict": true, "noLib": true, "types": [], "allowJs": true,
            "module": "preserve", "moduleResolution": "bundler"
        },
        "files": ["globals.d.ts"]
    }"#;
    let files = [
        ("tsconfig.json", config),
        (
            "index.js",
            r#"import "./feature.ts";
            import "./util.js";"#,
        ),
        (
            "feature.ts",
            r#"import { g } from "./util.js";
            g();"#,
        ),
        ("util.js", "export function g() {}"),
    ];
    with_program(&files, &["./index.js"], 1, |program| {
        let files = program.files();
        let (feature, util) = (program.file("feature.ts"), program.file("util.js"));
        assert_eq!(imported_files(files, feature, "./util.js"), [util]);
        assert!(files.module(feature).edges.contains(&util));
        assert!(files.module(util).is_in_types_program);
        assert!(files.is_compiled(util));
        assert_eq!(count_files_named(files, "/util.js"), 1);
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
}

fn assert_separate_code_copies(program: &TestProgram<'_, '_>) {
    let files = program.files();
    let outer = program.file("node_modules/dep/index.js");
    let inner = program.file("sub/node_modules/dep/index.js");
    assert_ne!(outer, inner);
    assert_eq!(count_files_named(files, "/dep/index.js"), 2);
    let (main, sub) = (program.file("main.ts"), program.file("sub/inner.ts"));
    assert!(files.code_answers(main).contains(&CodeAnswer::File(outer)));
    assert!(files.code_answers(sub).contains(&CodeAnswer::File(inner)));
}

#[test]
fn package_copies() {
    let files = [&TWO_COPIES_OF_DEP[..], &DECLARATIONS_OF_BOTH_COPIES[..]].concat();
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_eq!(count_files_named(program.files(), "/dep/index.d.ts"), 1);
        let retained = program.file("node_modules/dep/index.d.ts");
        assert_eq!(
            program.find("sub/node_modules/dep/index.d.ts"),
            Some(retained)
        );
        assert_separate_code_copies(program);
    });
}

#[test]
fn package_copies_loaded_by_type_tasks() {
    let config = r#"{ "compilerOptions": {
        "noLib": true, "types": [], "allowJs": true, "maxNodeModuleJsDepth": 1,
        "module": "preserve", "moduleResolution": "bundler"
    } }"#;
    let files = [&[("tsconfig.json", config)][..], &TWO_COPIES_OF_DEP[..]].concat();
    with_program(&files, &["./main.ts"], 1, |program| {
        assert_separate_code_copies(program);
        let inner = program.file("sub/node_modules/dep/index.js");
        let sub = program.file("sub/inner.ts");
        assert_eq!(imported_files(program.files(), sub, "dep"), [inner]);
    });
    let checked_count = from_bun_check(&files, |files| count_files_named(files, "/dep/index.js"));
    assert_eq!(checked_count, 1);
}

#[test]
fn declaration_file_as_code_target() {
    let config = r#"{
        "compilerOptions": {
            "noLib": true, "types": [], "module": "preserve", "moduleResolution": "bundler"
        },
        "files": ["globals.d.ts"]
    }"#;
    let files = [
        ("tsconfig.json", config),
        ("a.js", r#"import "./t.d.ts";"#),
        ("t.d.ts", "export declare const t: number;"),
        ("unused.d.ts", "export declare const unused: number;"),
    ];
    with_program(&files, &["./a.js"], 1, |program| {
        let files = program.files();
        let (a, t) = (program.file("a.js"), program.file("t.d.ts"));
        assert_eq!(files.role(t), FileRole::TypesOnly);
        assert_eq!(files.code_answers(a), [CodeAnswer::File(t)]);
        assert_eq!(files.module(a).code_edges, [t]);
        assert!(files.compiled(t).is_none());
        assert!(!files.is_compiled(t));
        assert_eq!(files.compiled_files(), [a]);
        assert_eq!(program.find("unused.d.ts"), None);
    });
}

#[test]
fn code_edge_lowers_dependency_depth() {
    let files = [
        (
            "main.js",
            r#"import "dep";
            import "./later.js";"#,
        ),
        ("later.js", r#"import "./node_modules/dep/shared.js";"#),
        ("node_modules/dep/package.json", DEP_MANIFEST),
        (
            "node_modules/dep/index.js",
            r#"import "./shared.js";
            import "./internal.js";"#,
        ),
        ("node_modules/dep/shared.js", ""),
        ("node_modules/dep/internal.js", ""),
    ];
    with_program(&files, &["./main.js"], 1, |program| {
        let is_dependency = |path: &str| {
            let module = program.files().module(program.file(path));
            module.is_from_external_library
        };
        assert!(is_dependency("node_modules/dep/index.js"));
        assert!(is_dependency("node_modules/dep/internal.js"));
        assert!(!is_dependency("node_modules/dep/shared.js"));
        assert!(!is_dependency("later.js"));
        assert!(!is_dependency("main.js"));
    });
}
