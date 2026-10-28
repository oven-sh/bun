use super::support::{TestProgram, check_only, disk, with_program};
use crate::{Diagnostic, host};
use bstr::ByteSlice;
use bun_core::strings;
use bun_sema::atom::Interner;
use bun_sema::config::{self, ConfigError, Project};
use bun_sema::hir;
use bun_sema::json::Json;
use bun_sema::resolve::{Host, JsxEmit, ModuleKind, Options, ParseOptions, ScriptKind};
use bun_sema::session::{Arena, Session};
use std::borrow::Cow;
use std::sync::atomic::{AtomicUsize, Ordering};

type TestFile = (&'static str, &'static str);

const ENTRY_POINTS: &[&str] = &["./main.ts"];
const MAIN: TestFile = (
    "main.ts",
    "import { a } from './lib/a.ts'; export const main = a;",
);
const A: TestFile = ("lib/a.ts", "export const a = 1;");
const LIB_CONFIG: TestFile = ("lib/tsconfig.json", "{}");
const CONFIG: &str = "tsconfig.json";

fn project_path(path: &str) -> Vec<u8> {
    [b"/project/", path.as_bytes()].concat()
}

fn governing_options<'s>(program: &TestProgram<'_, 's>, path: &str) -> Option<&'s Options> {
    let files = program.files();
    let options = files.module_options(program.file(path));
    (!std::ptr::eq(options, files.options)).then_some(options)
}

fn is_governed(files: &[TestFile], path: &str) -> bool {
    with_program(files, ENTRY_POINTS, 1, |program| {
        governing_options(program, path).is_some()
    })
}

fn diagnostics_of(program: &TestProgram<'_, '_>) -> Vec<Diagnostic> {
    let build = check_only(program);
    let all = program.loaded.diagnostics.iter().chain(build.diagnostics());
    all.map(|it| it.diagnostic.clone()).collect()
}

fn mentions(diagnostic: &Diagnostic, name: &str) -> bool {
    strings::contains(&diagnostic.path, name.as_bytes())
        || strings::contains(&diagnostic.text, name.as_bytes())
        || diagnostic.related.iter().any(|it| mentions(it, name))
}

#[test]
fn nearest_configuration_governs() {
    let lib_config = r#"{ "compilerOptions": { "module": "nodenext" } }"#;
    let files = [MAIN, A, ("lib/tsconfig.json", lib_config)];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let options = program.files().options;
        let governing = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        assert_eq!(governing.module, ModuleKind::NodeNext);
        assert_eq!(governing.config_path, project_path("lib/tsconfig.json"));
        assert_eq!(governing.current_directory, options.current_directory);
        assert_eq!(governing.lib_dir, options.lib_dir);
        assert_eq!(options.module, ModuleKind::Preserve);
        assert!(governing_options(program, "main.ts").is_none());
    });
}

// What `npm create vite` writes: the tsconfig.json lists projects and has no file and no option of its own.
const SOLUTION: [TestFile; 7] = [
    (
        CONFIG,
        r#"{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tools" }] }"#,
    ),
    (
        "tsconfig.app.json",
        r#"{ "compilerOptions": { "noImplicitAny": false }, "include": ["main.ts", "lib"] }"#,
    ),
    (
        "tools/tsconfig.json",
        r#"{ "files": [], "references": [{ "path": "../tsconfig.test.json" }] }"#,
    ),
    (
        "tsconfig.test.json",
        r#"{ "compilerOptions": { "noUnusedLocals": true }, "include": ["test"] }"#,
    ),
    (
        "main.ts",
        "import './lib/a.ts'; import './test/t.ts'; import './other/o.ts'; export function main(loose) {}",
    ),
    ("test/t.ts", "export const t = 1;"),
    ("other/o.ts", "export const o = 1;"),
];

#[test]
fn referenced_project_that_has_a_file_governs_it_under_references_alone() {
    let files: Vec<TestFile> = SOLUTION.into_iter().chain([A]).collect();
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let options = program.files().options;
        assert_eq!(options.config_path, project_path("tsconfig.app.json"));
        assert!(!options.no_implicit_any);
        assert!(governing_options(program, "main.ts").is_none());
        assert!(governing_options(program, "lib/a.ts").is_none());
        let of_test = governing_options(program, "test/t.ts").expect("test/t.ts is governed");
        assert_eq!(of_test.config_path, project_path("tsconfig.test.json"));
        assert!(of_test.no_unused_locals);
        assert!(governing_options(program, "other/o.ts").is_none());
        assert!(diagnostics_of(program).iter().all(|it| it.code != 7006));
    });
}

#[test]
fn types_of_governing_project_are_declared() {
    let files: [TestFile; 6] = [
        (CONFIG, r#"{ "compilerOptions": { "types": [] } }"#),
        (
            "main.ts",
            "import { known } from './lib/a.ts'; export const main = known;",
        ),
        (
            "lib/tsconfig.json",
            r#"{ "compilerOptions": { "types": ["widget"] } }"#,
        ),
        (
            "lib/a.ts",
            "import type { Size } from 'widget-kit'; export const known: Size = WIDGET_VERSION;",
        ),
        (
            "node_modules/@types/widget/package.json",
            r#"{ "name": "@types/widget", "types": "index.d.ts" }"#,
        ),
        (
            "node_modules/@types/widget/index.d.ts",
            "declare const WIDGET_VERSION: number; declare module 'widget-kit' { export type Size = number; }",
        ),
    ];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let is_missing = |it: &Diagnostic| it.code == 2304 || it.code == 2307;
        assert!(!diagnostics_of(program).iter().any(is_missing));
    });
}

#[test]
fn two_files_share_one_options() {
    let paths: Vec<String> = (0..32)
        .map(|index| format!("lib/deep/d{index}/b.ts"))
        .collect();
    let mut main = String::from("import './lib/a.ts';");
    for path in &paths {
        main += &format!("import './{path}';");
    }
    let mut files = vec![("main.ts", main.as_str()), A, LIB_CONFIG];
    files.extend(paths.iter().map(|path| (path.as_str(), "export {};")));
    with_program(&files, ENTRY_POINTS, 8, |program| {
        let shared = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        for path in &paths {
            let governing = governing_options(program, path);
            let is_shared = governing.is_some_and(|it| std::ptr::eq(it, shared));
            assert!(is_shared, "{path}");
        }
    });
}

#[test]
fn broken_configuration_falls_back() {
    let broken = ("lib/tsconfig.json", r#"{ "extends": "./missing.json" }"#);
    with_program(&[MAIN, A, broken], ENTRY_POINTS, 1, |program| {
        assert!(governing_options(program, "lib/a.ts").is_none());
        for diagnostic in diagnostics_of(program) {
            let names_configuration = mentions(&diagnostic, "lib/tsconfig.json");
            let names_extended = mentions(&diagnostic, "missing.json");
            let text = diagnostic.text.as_bstr();
            assert!(!names_configuration && !names_extended, "{text}");
        }
    });
    assert!(is_governed(&[MAIN, A, LIB_CONFIG], "lib/a.ts"));
}

const CONFLICTING_OPTIONS_CONFIG: &str = r#"{
    "compilerOptions": { "jsxFactory": "h", "reactNamespace": "R", "paths": { "@util": ["./util.ts"] } }
}"#;

#[test]
fn configuration_with_option_errors_governs() {
    let files = [
        MAIN,
        ("lib/a.ts", "export { util as a } from '@util';"),
        ("lib/util.ts", "export const util = 1;"),
        ("lib/tsconfig.json", CONFLICTING_OPTIONS_CONFIG),
    ];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let governing = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        assert_eq!(governing.errors, [5053]);
        let (a, util) = (program.file("lib/a.ts"), program.file("lib/util.ts"));
        assert_eq!(program.files().module(a).edges, [util]);
        for diagnostic in diagnostics_of(program) {
            let text = diagnostic.text.as_bstr();
            assert!(diagnostic.code != 2307 && diagnostic.code != 5053, "{text}");
            assert!(!mentions(&diagnostic, "lib/tsconfig.json"), "{text}");
        }
    });
}

const INVALID_VALUES_CONFIG: &str = r#"{
    "compilerOptions": {
        "module": "unknown",
        "notAnOption": "remove",
        "strict": "yes",
        "paths": { "@util": ["./util.ts"] }
    }
}"#;

#[test]
fn configuration_with_invalid_values_governs() {
    let files = [
        MAIN,
        ("lib/a.ts", "export { util as a } from '@util';"),
        ("lib/util.ts", "export const util = 1;"),
        ("lib/tsconfig.json", INVALID_VALUES_CONFIG),
    ];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let governing = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        assert_eq!(governing.paths.len(), 1);
        let (a, util) = (program.file("lib/a.ts"), program.file("lib/util.ts"));
        assert_eq!(program.files().module(a).edges, [util]);
        for diagnostic in diagnostics_of(program) {
            let text = diagnostic.text.as_bstr();
            assert!(diagnostic.code != 2307, "{text}");
            assert!(!mentions(&diagnostic, "lib/tsconfig.json"), "{text}");
        }
    });
}

#[test]
fn jsconfig_counts() {
    let files = [MAIN, A, ("lib/jsconfig.json", "{}")];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let governing = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        assert_eq!(governing.config_path, project_path("lib/jsconfig.json"));
    });
}

#[test]
fn inferred_files_are_governed() {
    let main = ("main.ts", "import './lib/a.ts'; import './lib/c.js';");
    let files = [main, A, ("lib/c.js", "export const c = 3;"), LIB_CONFIG];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let of_typescript = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        let of_javascript = governing_options(program, "lib/c.js").expect("lib/c.js is governed");
        assert!(std::ptr::eq(of_typescript, of_javascript));
    });
}

#[test]
fn declaration_files_are_not_governed() {
    let main_text = "import './lib/a.ts';
import type { Size } from './lib/size';
export type Copy = Size;";
    let size = ("lib/size.d.ts", "export type Size = number;");
    with_program(
        &[("main.ts", main_text), A, size, LIB_CONFIG],
        ENTRY_POINTS,
        1,
        |program| {
            assert!(governing_options(program, "lib/a.ts").is_some());
            assert!(governing_options(program, "lib/size.d.ts").is_none());
        },
    );
}

const PACKAGE_WITHOUT_CONFIGURATION: [TestFile; 6] = [
    (
        "main.ts",
        "export { dep } from 'dep'; export { inner } from 'dep/inner.ts'; import 'other';",
    ),
    (
        "node_modules/dep/package.json",
        r#"{ "name": "dep", "main": "./index.ts", "types": "./index.ts" }"#,
    ),
    ("node_modules/dep/index.ts", "export const dep = 1;"),
    ("node_modules/dep/inner.ts", "export const inner = 1;"),
    (
        "node_modules/other/package.json",
        r#"{ "name": "other", "main": "./index.ts", "types": "./index.ts" }"#,
    ),
    ("node_modules/other/index.ts", "export {};"),
];

fn assert_lenient(lenient: &Options, program_options: &Options, package: &str) {
    assert!(program_options.strict_null_checks && program_options.no_implicit_any);
    assert!(!lenient.strict_null_checks && !lenient.no_implicit_any);
    assert!(lenient.config_path.is_empty());
    assert_eq!(lenient.base_dir, project_path(package));
    assert_eq!(lenient.module, program_options.module);
    assert_eq!(lenient.jsx, program_options.jsx);
    assert_eq!(lenient.lib_dir, program_options.lib_dir);
}

#[test]
fn package_without_configuration() {
    with_program(&PACKAGE_WITHOUT_CONFIGURATION, ENTRY_POINTS, 1, |program| {
        let options_of = |path: &str| {
            let options = governing_options(program, path);
            options.unwrap_or_else(|| panic!("{path} has the options of the program"))
        };
        let of_dep = options_of("node_modules/dep/index.ts");
        assert_lenient(of_dep, program.files().options, "node_modules/dep");
        assert!(std::ptr::eq(
            of_dep,
            options_of("node_modules/dep/inner.ts")
        ));
        let of_other = options_of("node_modules/other/index.ts");
        assert_lenient(of_other, program.files().options, "node_modules/other");
    });

    let mut with_configuration = PACKAGE_WITHOUT_CONFIGURATION.to_vec();
    with_configuration.push(("node_modules/dep/tsconfig.json", "{}"));
    with_program(&with_configuration, ENTRY_POINTS, 1, |program| {
        let governing = governing_options(program, "node_modules/dep/index.ts");
        let governing = governing.expect("the package has a configuration file");
        assert_eq!(
            governing.config_path,
            project_path("node_modules/dep/tsconfig.json")
        );
    });
}

#[test]
fn package_with_broken_configuration_gets_lenient_options() {
    let mut files = PACKAGE_WITHOUT_CONFIGURATION.to_vec();
    files.push((
        "node_modules/dep/tsconfig.json",
        r#"{ "extends": "not-installed/tsconfig.json" }"#,
    ));
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let lenient = governing_options(program, "node_modules/dep/index.ts");
        let lenient = lenient.expect("a dependency never has the options of the program");
        assert_lenient(lenient, program.files().options, "node_modules/dep");
        let mut diagnostics = diagnostics_of(program).into_iter();
        assert!(!diagnostics.any(|it| mentions(&it, "node_modules/dep/tsconfig.json")));
    });
}

#[test]
fn overrides_apply() {
    let files = [
        MAIN,
        ("lib/a.ts", "export { b as a } from './b.ts';"),
        ("lib/b.ts", "export const b = 1;"),
        LIB_CONFIG,
    ];
    with_program(&files, ENTRY_POINTS, 1, |program| {
        let governing = governing_options(program, "lib/a.ts").expect("lib/a.ts is governed");
        assert!(governing.allow_importing_ts_extensions && governing.no_emit);
        assert!(diagnostics_of(program).iter().all(|it| it.code != 5097));
        let (session, path) = (Session::new(), project_path("lib/tsconfig.json"));
        let as_written = config::load_overriding(program.host, &session, &path, &|_| Vec::new());
        let as_written = as_written.expect("the file can be read").options;
        assert!(!as_written.allow_importing_ts_extensions && !as_written.no_emit);
    });
}

const TYPES_OF_X: &str = "lib/types/x/index.d.ts";

const TYPE_REFERENCE: [TestFile; 4] = [
    MAIN,
    (
        "lib/a.ts",
        "/// <reference types=\"x\" />\nexport const a = 1;",
    ),
    (TYPES_OF_X, "declare const x: number;"),
    (
        CONFIG,
        r#"{ "compilerOptions": { "noLib": true }, "files": ["./main.ts"] }"#,
    ),
];

const LIB_CONFIG_WITH_TYPE_ROOTS: TestFile = (
    "lib/tsconfig.json",
    r#"{ "compilerOptions": { "typeRoots": ["./types"] } }"#,
);

#[test]
fn type_reference_uses_governing_type_roots() {
    with_program(&TYPE_REFERENCE, ENTRY_POINTS, 1, |program| {
        assert!(program.find(TYPES_OF_X).is_none());
    });
    let mut governed = TYPE_REFERENCE.to_vec();
    governed.push(LIB_CONFIG_WITH_TYPE_ROOTS);
    with_program(&governed, ENTRY_POINTS, 1, |program| {
        let (a, types) = (program.file("lib/a.ts"), program.file(TYPES_OF_X));
        assert_eq!(program.files().module(a).edges, [types]);
    });
}

fn include_reasons(program: &TestProgram<'_, '_>, path: &str) -> Vec<Vec<u8>> {
    let to_file_name = |name: &[u8]| name.to_vec();
    let lines = program
        .files()
        .explain_files(program.host, false, &to_file_name);
    let name = project_path(path);
    let below_name = lines.into_iter().skip_while(|line| *line != name).skip(1);
    below_name
        .take_while(|line| line.starts_with(b"   "))
        .collect()
}

#[test]
fn include_reason_uses_governing_options() {
    let mut governed = TYPE_REFERENCE.to_vec();
    governed.push(LIB_CONFIG_WITH_TYPE_ROOTS);
    with_program(&governed, ENTRY_POINTS, 1, |program| {
        let reasons = include_reasons(program, TYPES_OF_X);
        let names_reference = reasons
            .iter()
            .any(|line| strings::contains(line, b"lib/a.ts"));
        assert!(names_reference, "{:?}", reasons.concat().as_bstr());
    });
}

fn disk_of(files: &[TestFile]) -> host::Disk {
    let in_memory = |&(path, text): &TestFile| (project_path(path), text.as_bytes().to_vec());
    disk(1, files.iter().map(in_memory).collect(), b"/project")
}

fn load_options(host: &dyn Host, path: &str) -> Result<Project, Vec<ConfigError>> {
    config::load_options_for_build(host, &Session::new(), &project_path(path))
}

fn load_project(host: &dyn Host) -> Project {
    let project = config::load_for_build(host, &Session::new(), &project_path(CONFIG));
    project.expect("the file can be read")
}

struct ListingCounter {
    disk: host::Disk,
    listings: AtomicUsize,
}

impl Host for ListingCounter {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        self.disk.read(path)
    }
    fn is_file(&self, path: &[u8]) -> bool {
        self.disk.is_file(path)
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        self.disk.is_dir(path)
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        self.disk.realpath(path)
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        self.listings.fetch_add(1, Ordering::Relaxed);
        self.disk.list_dir(path)
    }
    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        self.listings.fetch_add(1, Ordering::Relaxed);
        self.disk.entries(path)
    }
    fn is_case_sensitive(&self) -> bool {
        self.disk.is_case_sensitive()
    }
    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        self.disk.script_kind(path)
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        self.disk.extra_file_extensions()
    }
    fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
        self.disk.scripts_of_page(page)
    }
    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        self.disk.parse(arena, path, text, atoms, options)
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        self.disk.parse_package_json(arena, text)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        self.disk.parallel(count, work);
    }
}

#[test]
fn load_options_lists_no_directory() {
    let text = r#"{
        "compilerOptions": {
            "module": "nodenext",
            "jsx": "react-jsx",
            "strictNullChecks": false,
            "paths": { "@/*": ["./src/*"] }
        }
    }"#;
    let host = ListingCounter {
        disk: disk_of(&[(CONFIG, text), ("src/a.ts", "export {};")]),
        listings: AtomicUsize::new(0),
    };
    let without_files = load_options(&host, CONFIG).expect("the file can be read");
    assert_eq!(host.listings.load(Ordering::Relaxed), 0);
    assert!(without_files.files.is_empty());
    let options = without_files.options;
    let Project {
        options: expected,
        files,
        ..
    } = load_project(&host);
    assert!(host.listings.load(Ordering::Relaxed) > 0);
    assert!(options.files.is_empty() && !files.is_empty());

    assert_eq!(options.paths, expected.paths);
    assert_eq!(options.module, expected.module);
    assert_eq!(options.jsx, expected.jsx);
    assert_eq!(options.strict_null_checks, expected.strict_null_checks);
    assert_eq!(options.paths.len(), 1);
    assert_eq!(options.module, ModuleKind::NodeNext);
    assert_eq!(options.jsx, JsxEmit::ReactJsx);
    assert!(!options.strict_null_checks);
}

#[test]
fn emitted_files_are_no_root_files() {
    let sources: [TestFile; 4] = [
        ("src/a.ts", "export {};"),
        ("dist/src/a.d.ts", "export {};"),
        ("types/src/a.d.ts", "export {};"),
        ("out/src/a.d.ts", "export {};"),
    ];
    let root_files = |config: &'static str| {
        let files: Vec<TestFile> = [(CONFIG, config)].into_iter().chain(sources).collect();
        let mut root_files = load_project(&disk_of(&files)).files;
        root_files.sort();
        root_files
    };
    let written = r#"{ "compilerOptions": {
        "declaration": true, "outDir": "dist", "declarationDir": "${configDir}/types"
    } }"#;
    assert_eq!(
        root_files(written),
        ["out/src/a.d.ts", "src/a.ts"].map(project_path)
    );
    let with_own_exclude = r#"{ "compilerOptions": { "outDir": "dist" }, "exclude": ["out"] }"#;
    let expected = ["dist/src/a.d.ts", "src/a.ts", "types/src/a.d.ts"];
    assert_eq!(root_files(with_own_exclude), expected.map(project_path));
}

const EXTENDS_BASE: &str = r#"{ "extends": "./base.json" }"#;

#[test]
fn load_options_fails_on_unreadable_files() {
    let extends_missing = r#"{ "extends": "./missing.json" }"#;
    let extends_missing_package = r#"{ "extends": "missing/tsconfig.json" }"#;
    let extends_itself = r#"{ "extends": "./tsconfig.json" }"#;
    let unclosed = r#"{ "compilerOptions": { "#;
    let broken: [&[TestFile]; 6] = [
        &[],
        &[(CONFIG, extends_missing)],
        &[(CONFIG, extends_missing_package)],
        &[(CONFIG, extends_itself)],
        &[(CONFIG, unclosed)],
        &[(CONFIG, EXTENDS_BASE), ("base.json", unclosed)],
    ];
    for files in broken {
        let errors = match load_options(&disk_of(files), CONFIG) {
            Ok(project) => project.errors,
            Err(errors) => errors,
        };
        assert!(errors.iter().any(|error| error.is_unreadable), "{files:?}");
    }
    assert!(load_options(&disk_of(&[]), CONFIG).is_err());

    let disk = disk_of(&[(CONFIG, r#"{ "files": [] }"#)]);
    let without_files = load_options(&disk, CONFIG).expect("the file can be read");
    assert!(without_files.errors.iter().all(|error| error.code != 18002));
    assert!(
        load_project(&disk)
            .errors
            .iter()
            .any(|error| error.code == 18002)
    );
}

fn error_codes(project: &Project, is_counted: impl Fn(&ConfigError) -> bool) -> Vec<u32> {
    let counted = project.errors.iter().filter(|error| is_counted(error));
    counted.map(|error| error.code).collect()
}

#[test]
fn load_options_accepts_option_errors() {
    let disk = disk_of(&[(CONFIG, CONFLICTING_OPTIONS_CONFIG)]);
    let project = load_options(&disk, CONFIG).expect("only the options have an error");
    assert_eq!(project.options.errors, [5053]);
    assert_eq!(project.options.paths.len(), 1);
    assert_eq!(
        error_codes(&project, |error| error.is_about_options),
        [5053]
    );
    assert_eq!(error_codes(&project, |error| error.is_unreadable), [0; 0]);
}

#[test]
fn removed_options_that_mean_nothing_to_a_build_are_no_errors() {
    let written = r#"{ "compilerOptions": {
        "moduleResolution": "Node", "target": "ES5", "downlevelIteration": true, "alwaysStrict": false,
        "esModuleInterop": false, "allowSyntheticDefaultImports": false
    } }"#;
    let defaults = load_project(&disk_of(&[(CONFIG, "{}"), A])).options;
    let project = load_project(&disk_of(&[(CONFIG, written), A]));
    assert_eq!(error_codes(&project, |_| true), [0; 0]);
    assert_eq!(project.options.target, defaults.target);
    assert!(!project.options.specifies_module_resolution);
    for written in [
        r#"{ "compilerOptions": { "module": "AMD" } }"#,
        r#"{ "compilerOptions": { "module": "umd" } }"#,
        r#"{ "compilerOptions": { "module": "System" } }"#,
    ] {
        let project = load_project(&disk_of(&[(CONFIG, written), A]));
        assert_eq!(error_codes(&project, |_| true), [0; 0], "{written}");
        assert_eq!(project.options.module, defaults.module, "{written}");
    }

    let kept = r#"{ "compilerOptions": { "moduleResolution": "bundler", "target": "es2020", "alwaysStrict": true } }"#;
    let project = load_project(&disk_of(&[(CONFIG, kept), A]));
    assert_eq!(error_codes(&project, |_| true), [0; 0]);
    assert_ne!(project.options.target, defaults.target);
}

#[test]
fn helpers_that_tsc_would_import_are_not_asked_for_in_a_build() {
    let written = r#"{ "compilerOptions": { "importHelpers": true } }"#;
    let project = load_project(&disk_of(&[(CONFIG, written), A]));
    assert_eq!(error_codes(&project, |_| true), [0; 0]);
    assert!(!project.options.import_helpers);
}

#[test]
fn class_fields_stay_where_they_are_written_whatever_the_target() {
    let options_of =
        |written: &'static str| load_project(&disk_of(&[(CONFIG, written), A])).options;
    let old_target = options_of(r#"{ "compilerOptions": { "target": "es2017" } }"#);
    assert!(old_target.use_define_for_class_fields);
    assert!(old_target.emit_standard_class_fields);
    let assigned =
        r#"{ "compilerOptions": { "target": "esnext", "useDefineForClassFields": false } }"#;
    let assigned = options_of(assigned);
    assert!(!assigned.use_define_for_class_fields);
    assert!(!assigned.emit_standard_class_fields);
}

#[test]
fn load_options_accepts_invalid_values() {
    let defaults = load_options(&disk_of(&[(CONFIG, "{}")]), CONFIG);
    let defaults = defaults.expect("the file has no error").options;
    let source = ("util.ts", "export {};");
    let own = disk_of(&[(CONFIG, INVALID_VALUES_CONFIG), source]);
    let base = ("base.json", INVALID_VALUES_CONFIG);
    let inherited = disk_of(&[(CONFIG, EXTENDS_BASE), base, source]);
    for disk in [own, inherited] {
        let project = load_options(&disk, CONFIG).expect("the file can be read");
        assert_eq!(project.options.paths.len(), 1);
        assert_eq!(project.options.module, defaults.module);
        assert_eq!(
            project.options.strict_null_checks,
            defaults.strict_null_checks
        );
        let invalid_values = error_codes(&project, |error| !error.is_about_options);
        assert_eq!(invalid_values, [6046, 5023, 5024]);
        assert_eq!(error_codes(&project, |error| error.is_unreadable), [0; 0]);
    }
}
