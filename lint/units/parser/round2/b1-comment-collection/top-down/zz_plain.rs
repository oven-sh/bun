//! Probe of what a parse WITHOUT lint records in `Lexer::all_comments` under `minify_identifiers`: never part of the crate.
//! Input (`B1_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`B1_PLAIN_OUT`): one line for each source, tab separated: `<id> ok <start>-<end>,...`, `<id> err`, `<id> init` or `<id> panic`.
use core::mem::MaybeUninit;

use crate::defines::Define;
use crate::lexer::T;
use crate::p::P;
use crate::parse::parse_entry::{Options, Parser};
use crate::parser::{ParseStatementOptions, StatementScope};
use bun_alloc::Arena;
use bun_ast::{Loader, Log, Source};
use std::io::Write;

fn unhex(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let digit = |byte: u8| match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => 0,
    };
    for pair in bytes.chunks(2) {
        if let [high, low] = pair {
            out.push(digit(*high) * 16 + digit(*low));
        }
    }
    out
}

fn parse<const TS: bool>(parser: Parser<'_>, errors_before: u32) -> String {
    let mut slot = MaybeUninit::<P<'_, TS, false>>::uninit();
    if P::init(
        &mut slot,
        parser.bump,
        parser.log,
        parser.source,
        parser.define,
        parser.lexer,
        parser.options,
    )
    .is_err()
    {
        return "init".to_string();
    }
    // SAFETY: `init` returned `Ok`, so the slot holds a parser.
    let p = unsafe { slot.assume_init_mut() };
    let mut line = String::new();
    let mut failed = false;
    if p.lexer.token == T::THashbang && p.lexer.next().is_err() {
        failed = true;
    }
    if !failed {
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            ..Default::default()
        };
        failed = p.parse_stmts_up_to(T::TEndOfFile, &mut opts).is_err()
            || p.log().errors > errors_before;
    }
    if failed {
        line.push_str("err");
    } else {
        line.push_str("ok\t");
        for (index, range) in p.lexer.all_comments.iter().enumerate() {
            if index > 0 {
                line.push(',');
            }
            line.push_str(&format!("{}-{}", range.loc.start, range.loc.start + range.len));
        }
    }
    // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
    unsafe { slot.assume_init_drop() };
    line
}

fn run(kind: &str, text: &'static [u8]) -> String {
    let (path, loader): (&'static [u8], Loader) = match kind {
        "tsx" => (b"/a.tsx", Loader::Tsx),
        "js" => (b"/a.js", Loader::Js),
        "jsx" => (b"/a.jsx", Loader::Jsx),
        "dts" => (b"/a.d.ts", Loader::Ts),
        _ => (b"/a.ts", Loader::Ts),
    };
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.top_level_await = true;
    options.features.minify_identifiers = true;
    let is_typescript = options.ts;
    let define = Define::default();
    let mut log = Log::init();
    let errors_before = log.errors;
    let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena) else {
        return "init".to_string();
    };
    if is_typescript {
        parse::<true>(parser, errors_before)
    } else {
        parse::<false>(parser, errors_before)
    }
}

#[test]
fn zz_plain_reads_the_sources_of_a_file() {
    let Ok(inputs) = std::env::var("B1_INPUTS") else {
        return;
    };
    let Ok(out_path) = std::env::var("B1_PLAIN_OUT") else {
        return;
    };
    let text = std::fs::read_to_string(inputs).unwrap_or_default();
    let mut out = std::io::BufWriter::new(std::fs::File::create(out_path).expect("out"));
    for line in text.lines() {
        let mut parts = line.split(' ');
        let (Some(id), Some(kind), Some(source)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let bytes = match source.strip_prefix('@') {
            Some(path) => std::fs::read(path).unwrap_or_default(),
            None => unhex(source),
        };
        let source: &'static [u8] = Box::leak(bytes.into_boxed_slice());
        let kind = kind.to_string();
        let result = std::panic::catch_unwind(move || run(&kind, source))
            .unwrap_or_else(|_| "panic".to_string());
        let _ = writeln!(out, "{id}\t{result}");
    }
    let _ = out.flush();
}
