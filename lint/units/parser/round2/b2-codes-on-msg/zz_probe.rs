//! Probe of a lint parse over many sources, for the prototype of "the code on the message": never part of the crate, only of a scratch copy of it (see build-scratch.sh).
//! Input (`SMPH_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`SMPH_OUT`): one line for each source, tab separated: `<id> ok`, or
//! `<id> err <offset> <length> <code, 0 for none> <start> <end> <messages> <hex of the message of bun> <hex of the text of the reference>`,
//! or `<id> init ...` with the same fields where the first token failed, or `<id> panic`. The code is `Msg::code` of the first error.
//! `SMPH_INIT=plain` reads the first token with `Parser::init`, as the probe of the tree before the prototype did; otherwise `Parser::init_for_lint_with_codes` reads it.
//! `SMPH_TLA=1` turns `features.top_level_await` on and `SMPH_STANDARD_DECORATORS=1` `features.standard_decorators`, as `bun --lint` has them.
use crate::defines::Define;
use crate::parse::parse_entry::{Options, Parser};
use crate::parse::syntax_errors::SyntaxErrors;
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
    options.features.top_level_await = std::env::var_os("SMPH_TLA").is_some();
    options.features.standard_decorators = std::env::var_os("SMPH_STANDARD_DECORATORS").is_some();
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let mut stage = "err";
    let parser = if std::env::var_os("SMPH_INIT").is_some_and(|value| value == "plain") {
        Parser::init(options, &mut log, &source, &define, &arena)
    } else {
        Parser::init_for_lint_with_codes(options, &mut log, &source, &define, &arena, &mut errors)
    };
    match parser {
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
    let code = msg.code().unwrap_or(0);
    // Every message with a code has an entry, and no other has one.
    for (index, msg) in log.msgs.iter().enumerate() {
        if msg.code().is_some() != errors.get(index).is_some() {
            return format!("{stage}\tMISMATCH\t{index}");
        }
    }
    match errors.get(first) {
        Some(entry) => format!(
            "{stage}\t{offset}\t{length}\t{}\t{}\t{}\t{}\t{text_of_bun}\t{}",
            code,
            entry.start,
            entry.end,
            log.msgs.len(),
            hex(&entry.text)
        ),
        None => format!(
            "{stage}\t{offset}\t{length}\t{code}\t0\t0\t{}\t{text_of_bun}\t",
            log.msgs.len()
        ),
    }
}

#[test]
fn zz_probe_reads_the_sources_of_a_file() {
    let Ok(inputs) = std::env::var("SMPH_INPUTS") else {
        return;
    };
    let Ok(out_path) = std::env::var("SMPH_OUT") else {
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
        let source: &'static [u8] = Box::leak(unhex(source).into_boxed_slice());
        let kind = kind.to_string();
        let result = std::panic::catch_unwind(move || run(&kind, source))
            .unwrap_or_else(|_| "panic".to_string());
        let _ = writeln!(out, "{id}\t{result}");
    }
    let _ = out.flush();
}
