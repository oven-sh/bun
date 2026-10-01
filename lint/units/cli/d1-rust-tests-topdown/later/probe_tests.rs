use bun_ast::{Loader, Log, Source};
use bun_js_parser::parse::syntax_errors::SyntaxErrors;
use bun_js_parser::{Define, Parser, ParserOptions};

use crate::diagnostic::{Code, FileId};

#[test]
#[cfg_attr(miri, ignore = "a parse reads the stack pointer with inline assembly")]
fn probe_parse_only_runs_the_rules() {
    let path: &'static [u8] = b"a.js";
    let text: &'static [u8] = b"debugger;\nx === NaN;\n";
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
    let mut options = ParserOptions::init(Default::default(), Loader::Js);
    options.features.no_macros = true;
    let define = Define::default();
    let mut log = Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).expect("init");
    let found = parser
        .parse_only(|tree| crate::lint(FileId(0), tree, &source, &arena))
        .expect("parse");
    let codes: Vec<(Code, u32, u32)> = found.iter().map(|d| (d.code, d.start, d.length)).collect();
    assert_eq!(
        codes,
        [
            (Code::Name("no-debugger"), 0, 9),
            (Code::Name("use-isnan"), 10, 9),
        ]
    );
}

#[test]
#[cfg_attr(miri, ignore = "a parse reads the stack pointer with inline assembly")]
fn probe_parse_for_lint_reads_typescript() {
    let path: &'static [u8] = b"a.ts";
    let text: &'static [u8] =
        b"let x: number = (y as any)!;\nenum E { A }\nfunction f<T>(a: T): T { return a; }\n";
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
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

#[test]
#[cfg_attr(miri, ignore = "a parse reads the stack pointer with inline assembly")]
fn probe_a_syntax_error_of_typescript_has_a_code() {
    let path: &'static [u8] = b"a.ts";
    let text: &'static [u8] = b"let x: = 1;\n";
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
    let mut options = ParserOptions::init(Default::default(), Loader::Ts);
    options.features.no_macros = true;
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).expect("init");
    let parsed = parser.parse_for_lint_with_codes(&mut errors, |_| ());
    assert!(parsed.is_err());
    let first = errors
        .get(0)
        .map(|entry| (entry.code, entry.start, entry.end));
    assert_eq!(first, Some((1110, 7, 8)));
}
