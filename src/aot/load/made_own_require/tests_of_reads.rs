use bun_sema::bind::{Binding, CommonJsVariable};
use bun_sema::hir::{ExprId, ExprKind, StmtKind};

use crate::compile::testing::{default_settings, with_loaded_build};
use crate::load::ProjectId;

/// By text: whether `require = ..` is still a statement of the file when the program is loaded. Each text is a file of one program.
fn keep_their_stores(texts: &[String]) -> Vec<bool> {
    let names: Vec<String> = (0..texts.len())
        .map(|row| format!("row{row}.cjs"))
        .collect();
    let main: String = names
        .iter()
        .map(|name| format!("require('./{name}');"))
        .collect();
    let mut files = vec![
        ("main.cjs", &main[..]),
        ("which.cjs", "module.exports = 1;"),
    ];
    files.extend(
        names
            .iter()
            .zip(texts)
            .map(|(name, text)| (&name[..], &text[..])),
    );
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let keeps_store = |name: &String| {
            let file = files.by_path.get(format!("/project/{name}").as_bytes());
            let file = file.expect("the file is in the program");
            let (hir, bound) = (files.hir(file), files.bound(file));
            let is_require =
                |e: ExprId| bound.binding(e) == Binding::CommonJs(CommonJsVariable::Require);
            hir.ids(hir.body)
                .any(|statement| match hir[statement].kind {
                    StmtKind::Expr(e) => {
                        matches!(hir[e].kind, ExprKind::Assign { target, .. } if is_require(target))
                    }
                    _ => false,
                })
        };
        names.iter().map(keeps_store).collect()
    })
}

#[test]
fn the_store_goes_only_where_nobody_holds_the_function() {
    // What stands in front of the store, what stands behind it, and whether the store stays.
    let rows = [
        ("", "module.exports = require('./which.cjs');", false),
        (
            "",
            "function late() { return require('./which.cjs'); }",
            false,
        ),
        (
            "",
            "module.exports = require.resolve('./which.cjs');",
            false,
        ),
        ("", "module.exports = require.main === module;", false),
        ("function late() { return arguments[1]; }", "", false),
        ("const own = require;", "", true),
        ("", "module.exports = require;", true),
        ("const tools = { require };", "", true),
        ("const listed = [require];", "", true),
        ("keep(require); function keep(loader) {}", "", true),
        ("function current() { return require; }", "", true),
        ("require.mark = 1;", "", true),
        ("const resolve = require.resolve;", "", true),
        ("require.resolve = () => '';", "", true),
        ("require.main = null;", "", true),
        ("delete require.main;", "", true),
        ("const own = arguments[1];", "", true),
    ];
    let texts = rows.map(|(before, after, _)| {
        format!("const {{ createRequire }} = require('node:module'); {before} require = createRequire(__filename); {after}")
    });
    for ((text, kept), (.., expected)) in texts.iter().zip(keep_their_stores(&texts)).zip(rows) {
        assert_eq!(kept, expected, "{text}");
    }
}
