//! Probe of a scratch copy of the crate (see build-scratch.sh): never part of the crate.
//! Input (`B4_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`B4_OUT`): one line for each source, tab separated.
//! `B4_MODE=lint` (default): `<id> ok`, or `<id> err` and one field for each message of the log:
//! `<offset>+<length>:<hex of the message of bun>` and, where the table has an entry, `:<code>:<start>:<end>:<hex of the text of the reference>`.
//! `B4_MODE=plain`: the parse pass of `Parser::parse` without a side table: `<id> ok|err` and `<offset>+<length>:<hex>` for each message.
//! `B4_TLA=1` turns `features.top_level_await` on. `B4_COMMENTS=1` makes the lexer keep its comments from the second token on, as the lint parse will.
use crate::defines::Define;
use crate::lexer::T;
use crate::p::P;
use crate::parse::parse_entry::{Options, Parser};
use crate::parse::syntax_errors::SyntaxErrors;
use crate::parser::{ParseStatementOptions, StatementScope};
use bun_alloc::Arena;
use bun_ast::{Loader, Log, Source};
use core::mem::MaybeUninit;
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

fn run(kind: &str, text: &'static [u8], plain: bool) -> String {
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
    options.features.top_level_await = std::env::var_os("B4_TLA").is_some();
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let mut ok = false;
    if let Ok(mut parser) = Parser::init(options, &mut log, &source, &define, &arena) {
        if plain {
            ok = if parser.options.ts {
                parse_pass::<true>(parser)
            } else {
                parse_pass::<false>(parser)
            };
            ok = ok && log.errors == 0;
        } else {
            parser.lexer.track_comments = std::env::var_os("B4_COMMENTS").is_some();
            ok = parser
                .parse_for_lint_with_codes(&mut errors, |_| ())
                .is_ok();
        }
    }
    let mut out = String::from(if ok { "ok" } else { "err" });
    for (index, msg) in log.msgs.iter().enumerate() {
        let (offset, length) = msg
            .data
            .location
            .as_ref()
            .map_or((-1i64, -1i64), |location| {
                (location.offset as i64, location.length as i64)
            });
        out.push_str(&format!("\t{offset}+{length}:{}", hex(&msg.data.text)));
        if let Some(entry) = errors.get(index) {
            out.push_str(&format!(
                ":{}:{}:{}:{}",
                entry.code,
                entry.start,
                entry.end,
                hex(&entry.text)
            ));
        }
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
    let plain = std::env::var("B4_MODE").is_ok_and(|mode| mode == "plain");
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
        let result = std::panic::catch_unwind(move || run(&kind, source, plain))
            .unwrap_or_else(|_| "panic".to_string());
        let _ = writeln!(out, "{id}\t{result}");
    }
    let _ = out.flush();
}
