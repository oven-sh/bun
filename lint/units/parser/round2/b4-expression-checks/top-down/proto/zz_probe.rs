//! Probe of a parse over many sources: never part of the crate, only of a scratch copy of it (see build-scratch.sh).
//! Input (`B4_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`B4_OUT`): one line for each source, tab separated. With `B4_MODE=lint` (the default): `<id> ok`, or
//! `<id> err <offset> <length> <code, 0 for none> <start> <end> <messages> <hex of the message of bun> <hex of the text of the reference>`
//! for the first error of `Parser::parse_for_lint_with_codes`. With `B4_MODE=nolint`: `<id> <ok|err> <errors>` and then
//! `<offset>:<length>:<hex of the text>` for every message that the parse pass left, run as `Parser::parse` runs it, with no side table.
use core::mem::MaybeUninit;

use crate::defines::Define;
use crate::lexer::T;
use crate::p::P;
use crate::parse::parse_entry::{Options, Parser};
use crate::parse::syntax_errors::SyntaxErrors;
use crate::parser::{ParseStatementOptions, StatementScope};
use bun_alloc::Arena;
use bun_ast::{Kind, Loader, Log, Source};
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

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn options(kind: &str) -> (&'static [u8], Options<'static>) {
    let (path, loader): (&'static [u8], Loader) = match kind {
        "tsx" => (b"/a.tsx", Loader::Tsx),
        "js" => (b"/a.js", Loader::Js),
        "jsx" => (b"/a.jsx", Loader::Jsx),
        "dts" => (b"/a.d.ts", Loader::Ts),
        _ => (b"/a.ts", Loader::Ts),
    };
    let mut options = Options::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.top_level_await = std::env::var_os("B4_TLA").is_some();
    (path, options)
}

fn run_lint(kind: &str, text: &'static [u8]) -> String {
    let (path, options) = options(kind);
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
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

fn parse_pass<const TS: bool>(parser: Parser<'_>) -> bool {
    let mut slot = MaybeUninit::<P<'_, TS, false>>::uninit();
    let made = P::init(
        &mut slot,
        parser.bump,
        parser.log,
        parser.source,
        parser.define,
        parser.lexer,
        parser.options,
    );
    if made.is_err() {
        return false;
    }
    // SAFETY: `init` returned `Ok`, so the slot holds a parser.
    let p = unsafe { slot.assume_init_mut() };
    let mut opts = ParseStatementOptions {
        scope: StatementScope::Module,
        ..Default::default()
    };
    let ok = p.parse_stmts_up_to(T::TEndOfFile, &mut opts).is_ok();
    // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
    unsafe { slot.assume_init_drop() };
    ok
}

fn run_nolint(kind: &str, text: &'static [u8]) -> String {
    let (path, options) = options(kind);
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = Source::init_path_string(path, text);
    let define = Define::default();
    let mut log = Log::init();
    let mut ok = false;
    if let Ok(parser) = Parser::init(options, &mut log, &source, &define, &arena) {
        ok = if parser.options.ts {
            parse_pass::<true>(parser)
        } else {
            parse_pass::<false>(parser)
        };
    }
    let mut out = format!("{}\t{}", if ok && log.errors == 0 { "ok" } else { "err" }, log.errors);
    for msg in log.msgs.iter() {
        let (offset, length) = msg
            .data
            .location
            .as_ref()
            .map_or((-1i64, -1i64), |location| {
                (location.offset as i64, location.length as i64)
            });
        out.push_str(&format!("\t{offset}:{length}:{}:{}", msg.code().unwrap_or(0), hex(&msg.data.text)));
    }
    out
}

#[test]
fn zz_probe_reads_the_sources_of_a_file() {
    let Ok(inputs) = std::env::var("B4_INPUTS") else {
        return;
    };
    let Ok(out_path) = std::env::var("B4_OUT") else {
        return;
    };
    let nolint = std::env::var("B4_MODE").is_ok_and(|mode| mode == "nolint");
    let text = std::fs::read_to_string(inputs).unwrap_or_default();
    let mut out = std::io::BufWriter::new(std::fs::File::create(out_path).expect("out"));
    for line in text.lines() {
        let mut parts = line.split(' ');
        let (Some(id), Some(kind), Some(source)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let source: &'static [u8] = Box::leak(unhex(source).into_boxed_slice());
        let kind = kind.to_string();
        let result = std::panic::catch_unwind(move || {
            if nolint {
                run_nolint(&kind, source)
            } else {
                run_lint(&kind, source)
            }
        })
        .unwrap_or_else(|_| "panic".to_string());
        let _ = writeln!(out, "{id}\t{result}");
    }
    let _ = out.flush();
}
