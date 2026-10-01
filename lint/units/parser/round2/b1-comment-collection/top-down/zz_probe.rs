//! Probe of the comment list of a lint parse: never part of the crate, only of a scratch copy of it.
//! Input (`B1_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`B1_OUT`): one line for each source, tab separated: `<id> ok <leading> <start>-<end>:<kind>,...`, `<id> err`, `<id> init` or `<id> panic`.
//! `B1_PRIMED=1`: `minify_identifiers` is on, so that `Parser::init` reads the first token with comments tracked and nothing is read again.
use crate::defines::Define;
use crate::parse::comments::CommentKind;
use crate::parse::parse_entry::{Options, Parser};
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
    options.features.minify_identifiers = std::env::var_os("B1_PRIMED").is_some();
    let define = Define::default();
    let mut log = Log::init();
    let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena) else {
        return "init".to_string();
    };
    let parsed = parser.parse_for_lint(|parsed| {
        let comments = &parsed.sidecar.comments;
        let mut line = format!("ok\t{}\t", comments.leading().len());
        for (index, comment) in comments.list.iter().enumerate() {
            if index > 0 {
                line.push(',');
            }
            let kind = match comment.kind {
                CommentKind::Line => "line",
                CommentKind::Block => "block",
                CommentKind::JSDoc => "jsdoc",
            };
            line.push_str(&format!("{}-{}:{kind}", comment.start, comment.end));
        }
        line
    });
    match parsed {
        Ok(line) => line,
        Err(_) => {
            let first = log
                .msgs
                .iter()
                .find(|msg| msg.kind == bun_ast::Kind::Err)
                .map(|msg| String::from_utf8_lossy(&msg.data.text).into_owned())
                .unwrap_or_default();
            format!("err\t{first}")
        }
    }
}

#[test]
fn zz_probe_reads_the_sources_of_a_file() {
    let Ok(inputs) = std::env::var("B1_INPUTS") else {
        return;
    };
    let Ok(out_path) = std::env::var("B1_OUT") else {
        return;
    };
    if let Ok(bits) = std::env::var("B1_DISABLE") {
        crate::lexer::B1_DISABLE.store(
            bits.parse().unwrap_or(0),
            core::sync::atomic::Ordering::Relaxed,
        );
    }
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
