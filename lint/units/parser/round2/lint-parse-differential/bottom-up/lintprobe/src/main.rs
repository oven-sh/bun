//! A lint parse of every source of a file, in one process.
//! Input: one line for each parse, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output: one line for each parse, tab separated: `<id> ok`, or
//! `<id> err <offset> <length> <code, 0 for none> <start> <end> <messages> <hex of the message of bun> <hex of the text of the reference>`,
//! or `<id> init ...` with the same fields where `Parser::init` failed (an error in the first token), or `<id> panic <hex of the panic>`.
//! The third argument names the options: `lint` (default) sets what `bun --lint` sets (src/runtime/cli/lint_command.rs:226-231),
//! `plain` what the tests of the crate set (`no_macros`, `dont_bundle_twice`).
#![allow(non_snake_case)]

// The stand-ins of the test binary of bun_js_parser for the C and C++ symbols that a parse links to.
#[path = "/workspace/wt/parser/src/js_parser/native_test_shims.rs"]
mod native_test_shims;

// `native_test_shims.rs` names `crate::Macro::MacroRemapEntry`.
pub mod Macro {
    pub use bun_js_parser::Macro::MacroRemapEntry;
}

use bun_alloc::Arena;
use bun_ast::{Kind, Loader, Log, Source};
use bun_js_parser::parse::syntax_errors::SyntaxErrors;
use bun_js_parser::{Define, Parser, ParserOptions};
use std::cell::RefCell;
use std::io::Write;

thread_local! {
    static LAST_PANIC: RefCell<String> = const { RefCell::new(String::new()) };
}

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

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn run(kind: &str, text: &'static [u8], lint_options: bool) -> String {
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
    let mut options = ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    if lint_options {
        options.features.is_macro_runtime = true;
        options.features.top_level_await = true;
        options.features.standard_decorators = true;
    } else {
        options.features.dont_bundle_twice = true;
    }
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let mut stage = "err";
    match Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => {
            if parser
                .parse_for_lint_with_codes(&mut errors, |_| ())
                .is_ok()
            {
                return "ok".to_string();
            }
        }
        Err(_) => stage = "init",
    }
    let Some(first) = log.msgs.iter().position(|msg| msg.kind == Kind::Err) else {
        return format!("{stage}\t-1\t-1\t0\t0\t0\t{}\t\t", log.msgs.len());
    };
    let msg = &log.msgs[first];
    let (offset, length) = msg
        .data
        .location
        .as_ref()
        .map_or((-1i64, -1i64), |location| {
            (location.offset as i64, location.length as i64)
        });
    let text_of_bun = hex(&msg.data.text);
    match errors.get(first) {
        Some(entry) => format!(
            "{stage}\t{offset}\t{length}\t{}\t{}\t{}\t{}\t{text_of_bun}\t{}",
            entry.code,
            entry.start,
            entry.end,
            log.msgs.len(),
            hex(&entry.text)
        ),
        None => format!(
            "{stage}\t{offset}\t{length}\t0\t0\t0\t{}\t{text_of_bun}\t",
            log.msgs.len()
        ),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(inputs), Some(out_path)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: lintprobe <inputs.hex> <out.tsv> [lint|plain]");
        std::process::exit(2);
    };
    let lint_options = args.get(3).is_none_or(|name| name != "plain");
    std::panic::set_hook(Box::new(|info| {
        LAST_PANIC.with(|last| *last.borrow_mut() = info.to_string());
    }));
    let text = std::fs::read_to_string(inputs).expect("inputs");
    let mut out = std::io::BufWriter::new(std::fs::File::create(out_path).expect("out"));
    let mut count = 0usize;
    for line in text.lines() {
        let mut parts = line.split(' ');
        let (Some(id), Some(kind), Some(source)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let source: &'static [u8] = Box::leak(unhex(source).into_boxed_slice());
        let kind = kind.to_string();
        let result = std::panic::catch_unwind(move || run(&kind, source, lint_options))
            .unwrap_or_else(|_| {
                let message = LAST_PANIC.with(|last| last.borrow().clone());
                format!("panic\t{}", hex(message.as_bytes()))
            });
        let _ = writeln!(out, "{id}\t{result}");
        count += 1;
        if count % 50000 == 0 {
            eprintln!("{count}");
        }
    }
    let _ = out.flush();
    eprintln!("{count} parses, options {}", if lint_options { "lint" } else { "plain" });
}
