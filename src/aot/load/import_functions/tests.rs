use super::*;

use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use std::borrow::Cow;

use bun_sema::session::Session;

fn parse_and_write<T>(
    path: &str,
    text: &str,
    format: ModuleFormat,
    read: impl FnOnce(&File<'_>, &Interner<'_>) -> T,
) -> T {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: true,
        ignores_pure_comments: false,
    };
    let mut hir = parse_for_compile(arena, &options, text.as_bytes(), &atoms);
    hir.text = Cow::Borrowed(text.as_bytes());
    write_import_functions(arena, &atoms, &mut hir, format);
    read(&hir, &atoms)
}

fn count_imports_written(path: &str, text: &str) -> usize {
    parse_and_write(path, text, ModuleFormat::CommonJs, |hir, _| {
        let is_import = |it: &&_| matches!(*it, ExprKind::ImportCall { .. });
        hir.exprs
            .iter()
            .map(|it| &it.kind)
            .filter(is_import)
            .count()
    })
}

fn requires_written(path: &str, text: &str, format: ModuleFormat) -> Vec<String> {
    parse_and_write(path, text, format, |hir, atoms| {
        let requires = hir
            .specifier_uses
            .iter()
            .filter(|it| it.kind == SpecifierKind::RequireCall);
        requires
            .map(|it| String::from_utf8_lossy(atoms.bytes(it.spec)).into_owned())
            .collect()
    })
}

#[test]
fn a_require_in_a_text_of_eval_is_the_files_own() {
    for text in [
        r#"eval("require('./a.cjs')");"#,
        r#"eval('require("./a.cjs")').x;"#,
        r#"const f = () => eval(" require ( './a.cjs' ) ; ");"#,
        r#"function f() { "use strict"; return eval("require('./a.cjs')"); }"#,
    ] {
        assert_eq!(
            requires_written("/a.cjs", text, ModuleFormat::CommonJs),
            ["./a.cjs"],
            "{text}"
        );
        assert!(
            requires_written("/a.mjs", text, ModuleFormat::Esm).is_empty(),
            "{text}"
        );
    }
    for text in [
        r#"(0, eval)("require('./a.cjs')");"#,
        r#"new Function("return require('./a.cjs')")();"#,
        r#"eval("require('./a.cjs').x");"#,
        r#"eval("require(name)");"#,
        r#"eval("require('./a.cjs', 1)");"#,
        r#"function f(require) { return eval("require('./a.cjs')"); }"#,
        r#"const require = f; eval("require('./a.cjs')");"#,
        r#"function eval() {} eval("require('./a.cjs')");"#,
        r#"o.eval("require('./a.cjs')");"#,
        r#"eval("var require = f"); eval("require('./a.cjs')");"#,
        r#"eval(text); eval("require('./a.cjs')");"#,
        r#"with (o) eval("require('./a.cjs')");"#,
    ] {
        assert!(
            requires_written("/a.cjs", text, ModuleFormat::CommonJs).is_empty(),
            "{text}"
        );
    }
}

#[test]
fn importing_functions_are_recognized() {
    let written = [
        r#"var load = new Function("path", "return import(path)");"#,
        r#"const load = Function("path", "return import(path);");"#,
        r#"const load = new Function('$id', 'return import( $id )');"#,
        r#"new Function("return import('node:fs')")();"#,
        r#"const load = new Function("path", "return\timport(path)");"#,
        r#"const load = new Function("path", "return  import(path)");"#,
        r#"const load = new Function("path", "\n  return import ( path ) ;\n");"#,
        r#"const load = new Function("path", "return import(/* webpackIgnore: true */ path)");"#,
        r#"const load = new Function("path", "return /* c */ import(path)");"#,
        r#"new Function("return\timport('node:fs')")();"#,
        r#"eval("\timport('./a.mjs')");"#,
        r#"eval("import(/* c */ './a.mjs')");"#,
        r#"(0, eval)("import('./a.mjs')");"#,
        "const load = new Function('path', `\n  return import(path);\n`);",
        r#"eval("import('./a.mjs')").then(console.log);"#,
        r#"eval('import("pkg");');"#,
    ];
    for text in written {
        for path in ["/a.cjs", "/a.ts"] {
            assert_eq!(count_imports_written(path, text), 1, "{path}: {text}");
        }
    }
}

#[test]
fn other_calls_stay() {
    let left = [
        r#"new Function("path", "return import(other)");"#,
        r#"new Function("path", "returnimport(path)");"#,
        r#"new Function("path", "return /*\n*/ import(path)");"#,
        r#"new Function("path", "return \u2028import(path)");"#,
        r#"new Function("path", "return import(path"); }"#,
        r#"eval("import('a'");"#,
        r#"eval("import('a' + b)");"#,
        r#"(f(), eval)("import('a')");"#,
        r#"new Function("path", "return\nimport(path)");"#,
        r#"new Function("path", "return\rimport(path)");"#,
        "new Function('path', `return\nimport(path)`);",
        r#"new Function("return\nimport('a')");"#,
        r#"new Function("path", "return import(path) + 1");"#,
        r#"new Function("path", "import(path)");"#,
        r#"new Function("a, b", "return import(a)");"#,
        r#"new Function("await", "return import(await)");"#,
        r#"new Function("return", "return import(return)");"#,
        r#"new Function("a", "b", "return import(a)");"#,
        r#"new Function("return import('a' + 'b')");"#,
        r#"new Function("return import('a\\n')");"#,
        r#"class Function {} new Function("path", "return import(path)");"#,
        r#"function f(Function) { return new Function("path", "return import(path)"); }"#,
        r#"let eval_ = 1; new eval("import('a')");"#,
        r#"eval("import('a')", 1);"#,
        r#"o.eval("import('a')");"#,
        r#"const text = 'new Function("path", "return import(path)")';"#,
    ];
    for text in left {
        assert_eq!(count_imports_written("/a.cjs", text), 0, "{text}");
    }
}
