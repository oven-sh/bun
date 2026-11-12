use super::*;

use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use std::borrow::Cow;

use bun_sema::session::Session;

fn count_imports_written(path: &str, text: &str) -> usize {
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
    write_import_functions(arena, &atoms, &mut hir);
    let is_import = |it: &&_| matches!(*it, ExprKind::ImportCall { .. });
    hir.exprs
        .iter()
        .map(|it| &it.kind)
        .filter(is_import)
        .count()
}

#[test]
fn importing_functions_are_recognized() {
    let written = [
        r#"var load = new Function("path", "return import(path)");"#,
        r#"const load = Function("path", "return import(path);");"#,
        r#"const load = new Function('$id', 'return import( $id )');"#,
        r#"new Function("return import('node:fs')")();"#,
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
        r#"new Function("path", "return  import(path)");"#,
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
