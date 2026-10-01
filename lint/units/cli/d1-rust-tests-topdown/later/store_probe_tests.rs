use bun_ast::{Loader, Log, Source};
use bun_js_parser::{Define, Parser, ParserOptions};

use crate::diagnostic::{Code, FileId};

#[test]
fn store_parse_only_runs_the_rules() {
    let path: &'static [u8] = b"a.js";
    let text: &'static [u8] =
        b"debugger;\nx === NaN;\nvar o = { 1: 0, 1: 0 };\nclass C { m() {} m() {} }\n";
    bun_ast::initialize_store();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let source = Source::init_path_string(path, text);
    let mut options = ParserOptions::init(Default::default(), Loader::Js);
    options.features.no_macros = true;
    let define = Define::default();
    let mut log = Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).expect("init");
    let found = parser
        .parse_only(|tree| crate::lint(FileId(0), tree, &source, &arena))
        .expect("parse");
    let mut names: Vec<&str> = found
        .iter()
        .map(|d| match d.code {
            Code::Name(name) => name,
            Code::Ts(_) => "ts",
        })
        .collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "no-debugger",
            "no-dupe-class-members",
            "no-dupe-keys",
            "use-isnan"
        ]
    );
}

#[test]
fn store_parse_for_lint_reads_typescript() {
    let path: &'static [u8] = b"a.ts";
    let text: &'static [u8] =
        b"let x: number = (y as any)!;\nenum E { A }\nfunction f<T>(a: T): T { return a; }\n";
    bun_ast::initialize_store();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let source = Source::init_path_string(path, text);
    let mut options = ParserOptions::init(Default::default(), Loader::Ts);
    options.features.no_macros = true;
    let define = Define::default();
    let mut log = Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).expect("init");
    let counts = parser
        .parse_for_lint(|parsed| {
            (
                parsed.stmts.len(),
                parsed.symbols.is_empty(),
                parsed.scopes_in_order.is_empty(),
            )
        })
        .expect("parse");
    assert_eq!(counts, (3, false, false));
}
