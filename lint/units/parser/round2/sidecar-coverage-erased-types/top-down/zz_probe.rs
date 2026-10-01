//! Probe of a lint parse over many sources, for the prototype of the payloads of erased interfaces, type aliases and index signatures: never part of the crate, only of a scratch copy of it (see build-scratch.sh).
//! Input (`ZZ_INPUTS`): one line for each source, `<id> <ts|tsx|js|jsx|dts> <hex of the source>`.
//! Output (`ZZ_OUT`): one line for each source, tab separated: `<id> ok <records> <hex of the payload lines, joined by a line feed>`, or
//! `<id> err <offset> <length> <code, 0 for none> <start> <end> <hex of the message of bun> <hex of the text of the reference>`, or `<id> panic`.
//! `ZZ_PAYLOADS=0` leaves the payload lines out (a tree before the prototype has none).
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
    let define = Define::default();
    let mut log = Log::init();
    let mut errors = SyntaxErrors::default();
    let with_payloads = std::env::var_os("ZZ_PAYLOADS").is_none_or(|value| value != "0");
    let mut stage = "err";
    match Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => {
            let parsed = parser.parse_for_lint_with_codes(&mut errors, |parsed| {
                let erased = &parsed.sidecar.erased;
                let records = erased.statements.len() + erased.members.len();
                let lines = if with_payloads {
                    crate::parse::erased_tests::payloads(parsed).join("\n")
                } else {
                    String::new()
                };
                format!("ok\t{records}\t{}", hex(lines.as_bytes()))
            });
            if let Ok(line) = parsed {
                return line;
            }
        }
        Err(_) => stage = "init",
    }
    let Some(first) = log.msgs.iter().position(|msg| msg.kind == Kind::Err) else {
        return format!("{stage}\t-1\t-1\t0\t0\t0\t\t");
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
            "{stage}\t{offset}\t{length}\t{}\t{}\t{}\t{text_of_bun}\t{}",
            entry.code,
            entry.start,
            entry.end,
            hex(&entry.text)
        ),
        None => format!("{stage}\t{offset}\t{length}\t0\t0\t0\t{text_of_bun}\t"),
    }
}

#[test]
fn zz_probe_reads_the_sources_of_a_file() {
    let Ok(inputs) = std::env::var("ZZ_INPUTS") else {
        return;
    };
    let Ok(out_path) = std::env::var("ZZ_OUT") else {
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
