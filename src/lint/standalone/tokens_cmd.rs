//! `bun-lint tokens ..`
//!
//! - `dump <file>`: the tokens and the comments of a file, one per line.
//! - `batch <cases.jsonl>`: for each line `{ path, code, ecmaVersion? }`, a line
//!   `{ "errors": bool, "tokens": [type, start, end, ..], "comments": [..] }`. A type is an index
//!   into `TYPES`, positions are in UTF-16 code units.
//! - `bench <files..>`: the speed of the scan.

use bun_lint::ast::File;
use bun_lint::language::LanguageOptions;
use bun_lint::options::Json;
use bun_lint::tokens::{Token, TokenKind};
use std::fmt::Write as _;
use std::io::Write as _;

/// Converts ascending offsets in bytes to offsets in UTF-16 code units.
struct Utf16<'a> {
    text: &'a [u8],
    bytes: usize,
    units: usize,
}

impl Utf16<'_> {
    fn at(&mut self, offset: u32) -> usize {
        if (offset as usize) < self.bytes {
            (self.bytes, self.units) = (0, 0);
        }
        while self.bytes < offset as usize {
            let (c, size) = bun_core::lexer::char_and_size(self.text, self.bytes);
            self.units += if c > 0xFFFF { 2 } else { 1 };
            self.bytes += size.max(1);
        }
        self.units
    }
}

fn write_tokens<'a>(out: &mut String, text: &[u8], tokens: impl Iterator<Item = Token<'a>>) {
    let mut utf16 = Utf16 {
        text,
        bytes: 0,
        units: 0,
    };
    out.push('[');
    for (i, token) in tokens.enumerate() {
        let (start, end) = (utf16.at(token.start()), utf16.at(token.end()));
        let _ = write!(out, "{}{},{start},{end}", if i == 0 { "" } else { "," }, token.kind() as u8);
    }
    out.push(']');
}

fn language_of(case: &Json) -> LanguageOptions {
    let mut language = LanguageOptions::default();
    if let Some(Json::Number(version)) = case.get(b"ecmaVersion") {
        language.ecma_version = *version as u32;
    }
    language
}

fn batch(path: &str) {
    let cases = std::fs::read(path).expect("the cases");
    let stdout = std::io::stdout();
    let mut stdout = std::io::BufWriter::new(stdout.lock());
    for line in cases.split(|&b| b == b'\n').filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("a case");
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let path = String::from_utf8_lossy(path);
        let line = crate::with_file(&path, code, &language_of(&case), |file| {
            let mut out = format!("{{\"errors\":{},\"tokens\":", file.has_parse_errors());
            write_tokens(&mut out, code, file.tokens());
            out.push_str(",\"comments\":");
            write_tokens(&mut out, code, file.comments());
            out.push('}');
            out
        });
        let _ = writeln!(stdout, "{line}");
    }
}

fn dump(path: &str) {
    let code = std::fs::read(path).expect("the file");
    crate::with_file(path, &code, &LanguageOptions::default(), |file| {
        if file.has_parse_errors() {
            println!("the parser rejects the code");
        }
        for token in file.tokens().with_comments() {
            let kind: TokenKind = token.kind();
            println!("{kind:?} {}..{} {:?}", token.start(), token.end(), bstr::BStr::new(token.text()));
        }
    });
}

fn bench(paths: &[String]) {
    let (mut bytes, mut tokens, mut seconds, mut parse_seconds) = (0usize, 0usize, 0f64, 0f64);
    const ROUNDS: usize = 20;
    for path in paths {
        let Ok(code) = std::fs::read(path) else {
            continue;
        };
        let started = std::time::Instant::now();
        crate::with_file(path, &code, &LanguageOptions::default(), |file: &File| {
            parse_seconds += started.elapsed().as_secs_f64();
            let mut best = f64::MAX;
            for _ in 0..ROUNDS {
                let started = std::time::Instant::now();
                let count = bun_lint::tokens::scan_again(file);
                best = best.min(started.elapsed().as_secs_f64());
                tokens += count;
            }
            seconds += best;
            bytes += code.len();
        });
    }
    println!(
        "{} files, {:.1} MB, {} tokens: {:.1} ms, {:.0} MB/s, {:.1} ns per token (parse and bind: {:.1} ms)",
        paths.len(),
        bytes as f64 / 1e6,
        tokens / ROUNDS,
        seconds * 1e3,
        bytes as f64 / 1e6 / seconds,
        seconds * 1e9 / (tokens / ROUNDS).max(1) as f64,
        parse_seconds * 1e3,
    );
}

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "dump" => dump(path),
        [command, path] if command == "batch" => batch(path),
        [command, paths @ ..] if command == "bench" => bench(paths),
        _ => println!("usage: bun-lint tokens dump <file> | batch <cases.jsonl> | bench <files..>"),
    }
}
