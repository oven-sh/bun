use std::borrow::Cow;

use bun_ast::Loader;
use bun_paths::fs::FileSystem;
use bun_sema::bind::Parent;
use bun_sema::module_format::ModuleFormat;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::*;
use crate::compile::testing::{
    BUNDLED_LIBS, TemporaryDirectory, TestProject, default_settings, run_build, set_up_output,
};
use crate::load::ProjectId;
use crate::load::host::tests::take_messages;
use crate::load::source_provider::WithoutServices;

const PAGES: [(&str, &str); 2] = [
    ("pages/a.ts", "export const name = \"a\";"),
    ("pages/b.ts", "export const name = \"b\";"),
];

/// The parser looks for the files on the disk.
fn write_project(test: &str, main: (&str, &str)) -> TemporaryDirectory {
    set_up_output();
    let directory = TemporaryDirectory::new(test);
    for (path, text) in PAGES.into_iter().chain([main]) {
        directory.write(path, text);
    }
    // Where a pattern that starts with "/" is read from. The first test decides it, and no pattern here starts so.
    FileSystem::init(directory.path());
    directory
}

fn with_expanded<R>(
    test: &str,
    (name, text): (&str, &str),
    module_format: ModuleFormat,
    then: impl for<'s> FnOnce(&File<'s>, &Interner<'s>, &[Vec<u8>]) -> R,
) -> R {
    let directory = write_project(test, (name, text));
    let path = [directory.path(), b"/", name.as_bytes()].concat();
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let parse_options = CompileParseOptions {
        path: &path,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: true,
        ignores_pure_comments: false,
    };
    let mut tree = parse_for_compile(arena, &parse_options, text.as_bytes(), &atoms);
    tree.text = Cow::Borrowed(text.as_bytes());
    let loader = match tree.is_js {
        true => Loader::Js,
        false => Loader::Ts,
    };
    let (messages, settings) = (LoadMessages::default(), default_settings());
    let mut request = EarlyTransformRequest {
        path: &path,
        hir: &mut tree,
        module_format,
        takes_import_statements: module_format == ModuleFormat::Esm,
        settings: &settings,
        import_meta_main: None,
    };
    let source = ParsedSource::new(SourceKind::Program, loader);
    let provider = &WithoutServices;
    let change = expand_calls(
        provider,
        &messages,
        false,
        arena,
        &atoms,
        &mut request,
        &source,
        &|_, _| {},
    );
    assert_eq!(change, TreeChange::Changed);
    then(&tree, &atoms, &take_messages(&messages))
}

fn count_expressions(tree: &File<'_>, is_counted: impl Fn(ExprKind) -> bool) -> usize {
    tree.exprs.iter().filter(|it| is_counted(it.kind)).count()
}

fn count_calls_of_glob(tree: &File<'_>, atoms: &Interner<'_>) -> usize {
    find_calls(tree, atoms.intern(b"glob")).len()
}

#[test]
fn lazy_and_eager() {
    let text = "export const lazy = import.meta.glob(\"./pages/*.ts\");\n\
        export const eager = (import.meta as any).glob(\"./pages/a.ts\", { eager: true, import: \"name\" });\n\
        export const all = import.meta.glob<object>(\"./pages/b.ts\", { eager: true });\n\
        export const keys = Object.keys(import.meta.glob(\"./pages/*.ts\", { eager: true }));\n\
        if (false) import.meta.glob(\"./pages/*.ts\");";
    let main = ("main.ts", text);
    with_expanded(
        "glob_lazy_and_eager",
        main,
        ModuleFormat::Esm,
        |tree, atoms, warnings| {
            assert!(warnings.is_empty(), "{warnings:?}");
            // The parser leaves dead code as written.
            assert_eq!(count_calls_of_glob(tree, atoms), 1);
            let is_load = |kind| matches!(kind, ExprKind::ImportCall { .. });
            assert_eq!(count_expressions(tree, is_load), 2);
            let imports = tree.imports.iter();
            let imports: Vec<(&[u8], bool)> = imports
                .map(|it| (atoms.bytes(it.spec), it.namespace != Atom::NONE))
                .collect();
            let expected: [(&[u8], bool); 2] = [(b"./pages/a.ts", false), (b"./pages/b.ts", true)];
            assert_eq!(imports, expected);
            let head: Vec<StmtKind> = tree.ids(tree.body).map(|it| tree[it].kind).collect();
            assert!(matches!(
                head[..2],
                [StmtKind::Import(_), StmtKind::Import(_)]
            ));
        },
    );
}

#[test]
fn commonjs() {
    let text = "const eager = import.meta.glob(\"./pages/*.ts\", { eager: true, import: \"name\" });\n\
        module.exports = eager;";
    let main = ("main.js", text);
    with_expanded(
        "glob_commonjs",
        main,
        ModuleFormat::CommonJs,
        |tree, atoms, warnings| {
            assert!(warnings.is_empty(), "{warnings:?}");
            assert_eq!(count_calls_of_glob(tree, atoms), 0);
            assert!(tree.imports.is_empty());
            let is_require = |kind| matches!(kind, ExprKind::Ident(name) if name == known::require);
            assert_eq!(count_expressions(tree, is_require), 2);
            for specifier in ["%glob::./pages/a.ts", "%glob::./pages/b.ts"] {
                let specifier = atoms.intern(specifier.as_bytes());
                let is_named = |kind| matches!(kind, ExprKind::String(text) if text == specifier);
                assert_eq!(count_expressions(tree, is_named), 1);
            }
            let head: Vec<StmtKind> = tree.ids(tree.body).map(|it| tree[it].kind).collect();
            assert!(matches!(head[..2], [StmtKind::Var(_), StmtKind::Var(_)]));
        },
    );
}

#[test]
fn invalid() {
    let text = "const pattern = \"./pages/\" + process.argv.length + \".ts\";\n\
        export const pages = import.meta.glob(pattern);";
    let main = ("main.ts", text);
    with_expanded(
        "glob_invalid",
        main,
        ModuleFormat::Esm,
        |tree, atoms, warnings| {
            let expected = b"Expected a glob pattern to be a string literal, but got identifier";
            assert_eq!(warnings, [expected.to_vec()]);
            assert_eq!(count_calls_of_glob(tree, atoms), 0);
            let throws = tree.stmts.iter();
            let throws = throws.filter(|it| matches!(it.kind, StmtKind::Throw(_)));
            assert_eq!(throws.count(), 1);
            // The argument is still evaluated.
            let pattern = atoms.intern(b"pattern");
            let is_pattern = |kind| matches!(kind, ExprKind::Ident(name) if name == pattern);
            assert_eq!(count_expressions(tree, is_pattern), 1);
        },
    );
}

/// `export {}` shows the format of a file before its names are bound.
fn assert_pages_are_loaded(test: &str, last_line: &str) {
    let text = format!(
        "const lazy = import.meta.glob(\"./pages/a.ts\");\n\
         const eager = import.meta.glob(\"./pages/b.ts\", {{ eager: true }});\n\
         console.log(lazy, eager);\n{last_line}"
    );
    let directory = write_project(test, ("main.ts", text.as_str()));
    let project = TestProject::on_disk(directory.path(), &["main.ts"]);
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let find = |name: &str| {
                let mut compiled = files.compiled_files().iter().copied();
                let is_named =
                    |&file: &_| files.module(file).file_name().ends_with(name.as_bytes());
                compiled.find(is_named)
            };
            assert!(find("/pages/a.ts").is_some() && find("/pages/b.ts").is_some());
            let main = find("/main.ts").expect("the entry point is compiled");
            let (tree, bound) = (files.hir(main), files.bound(main));
            let calls = find_calls(tree, files.atoms.intern(b"glob"));
            let is_reached =
                |call: &WrittenCall| bound.parent_of_expr(call.expression) != Parent::None;
            assert_eq!(calls.iter().filter(|&call| is_reached(call)).count(), 0);
            Ok(())
        })
    });
}

#[test]
fn loads_files() {
    assert_pages_are_loaded("glob_loads_files", "");
}

#[test]
fn loads_files_before_binding() {
    assert_pages_are_loaded("glob_loads_files_before_binding", "export {};");
}

/// What the load makes of a `main.js` that begins with `require`: its format, and how many import statements it holds.
fn load_beside_require(test: &str, rest: &str) -> (ModuleFormat, usize) {
    let text = format!(
        "const {{ basename }} = require(\"node:path\");\nconsole.log(basename(\"/x\"), {rest});"
    );
    let directory = write_project(test, ("main.js", text.as_str()));
    let project = TestProject::on_disk(directory.path(), &["main.js"]);
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let mut compiled = files.compiled_files().iter().copied();
            let main = compiled.find(|&file| files.module(file).file_name().ends_with(b"/main.js"));
            let main = main.expect("the entry point is compiled");
            let format = files.analysis(main).module_format;
            Ok((format, files.hir(main).imports.len()))
        })
    })
}

#[test]
fn eager_entries_make_an_es_module_of_a_file_that_only_requires() {
    let eager = "import.meta.glob(\"./pages/*.ts\", { eager: true })";
    let loaded = load_beside_require("glob_eager_beside_require", eager);
    assert_eq!(loaded, (ModuleFormat::Esm, 2));
}

#[test]
fn what_writes_no_import_statement_leaves_a_commonjs_file() {
    let cases = [
        (
            "glob_lazy_beside_require",
            "import.meta.glob(\"./pages/*.ts\")",
        ),
        (
            "glob_without_entries_beside_require",
            "import.meta.glob(\"./pages/*.none\", { eager: true })",
        ),
        (
            "glob_keys_beside_require",
            "Object.keys(import.meta.glob(\"./pages/*.ts\", { eager: true }))",
        ),
    ];
    for (test, call) in cases {
        assert_eq!(
            load_beside_require(test, call),
            (ModuleFormat::CommonJs, 0),
            "{call}"
        );
    }
}

#[test]
fn text_that_stores_its_exports_stays_a_commonjs_file() {
    let rest = "(module.exports = import.meta.glob(\"./pages/*.ts\", { eager: true }))";
    let loaded = load_beside_require("glob_eager_beside_exports", rest);
    assert_eq!(loaded, (ModuleFormat::CommonJs, 0));
}

#[test]
fn module_of_eager_entry() {
    let whole = b"export * as entry from \"./pages/a.cjs\";\n";
    assert_eq!(write_module_of_eager_entry(b"", b"./pages/a.cjs"), whole);
    let raw = b"export * as entry from \"./a:b \\\"c\\\".txt\" with { type: \"text\" };\n";
    assert_eq!(
        write_module_of_eager_entry(b"text", b"./a:b \"c\".txt"),
        raw
    );
}

#[test]
fn eager_entries_of_a_commonjs_file_stand_in_es_modules_beside_it() {
    let text = "module.exports = import.meta.glob(\"./pages/*.ts\", { eager: true });";
    let found = find_modules_of_eager_entries("glob_modules_of_eager_entries", text);
    assert_eq!(found, [true, true]);
}

#[test]
fn a_specifier_that_the_program_writes_finds_no_module_of_the_build() {
    let text = "module.exports = import.meta.glob(\"./pages/a.ts\", { eager: true });\n\
        try {\n  require(\"%glob::./pages/b.ts\");\n} catch {}";
    let found = find_modules_of_eager_entries("glob_written_specifier", text);
    assert_eq!(found, [true, false]);
}

// Whether the ES module that the build makes for `./pages/a.ts`, and the one for `./pages/b.ts`, is compiled.
fn find_modules_of_eager_entries(test: &str, text: &str) -> [bool; 2] {
    let directory = write_project(test, ("main.js", text));
    let project = TestProject::on_disk(directory.path(), &["main.js"]);
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            Ok(["a", "b"].map(|page| {
                let name = format!("/main%3f%25glob%3a%3a%2e%2fpages%2f{page}%2ets.js.mjs");
                let is_named =
                    |&file: &_| files.module(file).file_name().ends_with(name.as_bytes());
                let entry = files.compiled_files().iter().copied().find(is_named);
                entry.is_some_and(|it| files.analysis(it).module_format == ModuleFormat::Esm)
            }))
        })
    })
}
