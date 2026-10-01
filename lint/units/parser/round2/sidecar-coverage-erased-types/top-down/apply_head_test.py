#!/usr/bin/env python3
"""Adds ONLY the test of the rejections to a COPY of src/js_parser at be1ebe5295, with nothing of the prototype: the test that must fail first.

usage: apply_head_test.py <copy of src/js_parser> rejection-rows.rs
"""
import sys
from pathlib import Path

root = Path(sys.argv[1])
rejections = Path(sys.argv[2]).read_text()
path = root / "parse/erased_tests.rs"
text = path.read_text()
old_use = "use super::parse_entry::{Options, ParsedForLint, Parser};\n"
assert text.count(old_use) == 1
text = text.replace(old_use, old_use + "use super::syntax_errors::SyntaxErrors;\n")
test = '''
/// The entry of the first error that the lint parse of `text` logs, as code, start, end and text. `None`: it parses.
fn first_error(text: &'static [u8]) -> Option<(u32, u32, u32, Vec<u8>)> {
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(&b"/a.ts"[..], text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let mut errors = SyntaxErrors::default();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    if parser
        .parse_for_lint_with_codes(&mut errors, |_| ())
        .is_ok()
    {
        return None;
    }
    let first = log
        .msgs
        .iter()
        .position(|msg| msg.kind == bun_ast::Kind::Err)?;
    let Some(entry) = errors.get(first) else {
        return Some((0, 0, 0, Vec::new()));
    };
    Some((entry.code, entry.start, entry.end, entry.text.to_vec()))
}

#[test]
fn an_erased_statement_is_read_as_the_reference_reads_it() {
    let cases: [(&'static [u8], u32, u32, u32, &str); COUNT] = [
ROWS    ];
    let mut failed = Vec::new();
    for (text, code, start, end, message) in cases {
        let found = first_error(text);
        if found != Some((code, start, end, message.as_bytes().to_vec())) {
            failed.push(format!("{}: {found:?}", bstr::BStr::new(text)));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\\n"));
}
'''.replace("COUNT", str(rejections.count("\n"))).replace("ROWS", rejections)
path.write_text(text + test)
print("applied the head test")
