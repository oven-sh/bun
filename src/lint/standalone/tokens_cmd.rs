//! `bun-lint tokens ..`
//!
//! - `dump <file>`: the tokens and the comments of a file, one per line.
//! - `batch <cases.jsonl>`: for each line `{ path, code, parser?, ecmaVersion?, sourceType? }`, a line
//!   `{ "errors": bool, "tokens": [type, start, end, ..], "comments": [..], "values": [index, value, ..],
//!   "delimiters": [at the start, at the end, ..] }`. A type is a `TokenKind`, positions are in UTF-16 code units.
//! - `query <cases.jsonl>`: the same with `queries: [[method, a.start, a.end, b.start, b.end, includeComments], ..]`.
//!   A line of answers for each: the ranges of the tokens, or 0 or 1. The code has to be ASCII.
//! - `bench <files..>`: the speed of the scan.
//! - `fuzz <rounds> <files..>`: scans damaged copies of the files, and checks that the tokens are in order and in bounds.

use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_lint::options::Json;
use bun_lint::span::Span;
use bun_lint::tokens::{Token, TokenKind, Tokens};
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
    if case.get(b"parser").and_then(Json::as_str) == Some(b"typescript") {
        language.parser = Parser::TypeScript;
    }
    language.source_type = match case.get(b"sourceType").and_then(Json::as_str) {
        Some(b"script") => SourceType::Script,
        Some(b"commonjs") => SourceType::CommonJs,
        _ => SourceType::Module,
    };
    language
}

fn batch(path: &str) {
    let cases = std::fs::read(path).expect("the cases");
    let stdout = std::io::stdout();
    let mut stdout = std::io::BufWriter::new(stdout.lock());
    for line in bun_core::strings::split(&cases, b"\n").filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("a case");
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let path = String::from_utf8_lossy(path);
        let line = crate::with_file(&path, code, &language_of(&case), |file| {
            // Before the tokens are asked for, this is the scan that only finds comments.
            let mut comments = String::new();
            write_tokens(&mut comments, code, file.comments());
            assert!(bun_lint::tokens::scan_comments_again(file).is_some(), "the scans disagree on the comments");
            let mut out = format!("{{\"errors\":{},\"tokens\":", file.has_parse_errors());
            write_tokens(&mut out, code, file.tokens());
            // Where `token.value` is not the text: the index of the token, and the value.
            let different = file.tokens().enumerate().filter(|(_, token)| *token.decoded_value() != *token.text());
            let values = different.flat_map(|(i, token)| [Json::Number(i as f64), Json::String(token.decoded_value().into_owned())]);
            let mut written = Vec::new();
            Json::Array(values.collect()).stringify(&mut written);
            // How much of each comment is not its value: at the start, at the end.
            let delimiters = file.comments().flat_map(|comment| {
                let start = if comment.kind() == TokenKind::Block { 2 } else { comment.text().len() - comment.value().len() };
                [start, comment.text().len() - comment.value().len() - start]
            });
            let delimiters: Vec<usize> = delimiters.collect();
            let written = bstr::BStr::new(&written);
            let _ = write!(out, ",\"comments\":{comments},\"values\":{written},\"delimiters\":{delimiters:?}}}");
            out
        });
        let _ = writeln!(stdout, "{line}");
    }
}

fn answer<'a>(file: &'a File<'a>, query: &[Json]) -> Vec<u32> {
    let number = |i: usize| match query.get(i) {
        Some(Json::Number(n)) => *n as u32,
        _ => 0,
    };
    let (a, b) = (Span::new(number(1), number(2)), Span::new(number(3), number(4)));
    let includes_comments = number(5) != 0;
    let with = |tokens: Tokens<'a>| if includes_comments { tokens.with_comments() } else { tokens };
    let ranges = |tokens: &mut dyn Iterator<Item = Token<'a>>| tokens.flat_map(|t| [t.start(), t.end()]).collect();
    let one = |plain: Option<Token<'a>>, with_comments: &mut dyn FnMut() -> Option<Token<'a>>| {
        let token = if includes_comments { with_comments() } else { plain };
        ranges(&mut token.into_iter())
    };
    match query.first().and_then(Json::as_str).unwrap_or_default() {
        b"in" => ranges(&mut with(file.tokens_in(a))),
        b"before" => ranges(&mut with(file.tokens_before(a)).take(4)),
        b"after" => ranges(&mut with(file.tokens_after(a)).take(4)),
        b"between" => ranges(&mut with(file.tokens_between(a, b))),
        b"betweenBackwards" => ranges(&mut with(file.tokens_between(a, b)).rev()),
        b"padded" => ranges(&mut file.tokens_in(a).padded(b.start as usize, b.end as usize)),
        b"paddedBetween" => ranges(&mut file.tokens_between(a, b).padded(1, 1)),
        b"first" => one(file.first_token(a), &mut || file.tokens_in(a).with_comments().next()),
        b"last" => one(file.last_token(a), &mut || file.tokens_in(a).with_comments().next_back()),
        b"secondLast" => ranges(&mut with(file.tokens_in(a)).nth_back(1).into_iter()),
        b"tokenBefore" => one(file.token_before(a), &mut || file.tokens_before(a).with_comments().next()),
        b"tokenAfter" => one(file.token_after(a), &mut || file.tokens_after(a).with_comments().next()),
        b"secondBefore" => ranges(&mut with(file.tokens_before(a)).nth(1).into_iter()),
        b"at" => one(file.token_at(a.start), &mut || file.token_or_comment_at(a.start)),
        b"around" => one(file.token_around(a.start), &mut || file.token_or_comment_around(a.start)),
        b"commentsBefore" => ranges(&mut file.comments_before(a)),
        b"commentsAfter" => ranges(&mut file.comments_after(a)),
        b"commentsIn" => ranges(&mut file.comments_in(a)),
        b"commentsExist" => {
            assert_eq!(file.comments_exist_between(a, b), file.comments_between(a, b).next().is_some());
            vec![u32::from(file.comments_exist_between(a, b))]
        }
        b"space" => vec![u32::from(file.is_space_between(a, b))],
        b"sameValue" => match (file.token_at(a.start), file.token_at(b.start)) {
            (Some(a), Some(b)) => {
                assert_eq!(a.has_same_value(b), a.decoded_value() == b.decoded_value());
                vec![u32::from(a.has_same_value(b))]
            }
            _ => vec![u32::MAX],
        },
        _ => vec![u32::MAX],
    }
}

fn query(path: &str) {
    let cases = std::fs::read(path).expect("the cases");
    let stdout = std::io::stdout();
    let mut stdout = std::io::BufWriter::new(stdout.lock());
    for line in bun_core::strings::split(&cases, b"\n").filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("a case");
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let queries = case.get(b"queries").and_then(Json::as_array).unwrap_or_default();
        let answers = crate::with_file(&String::from_utf8_lossy(path), code, &language_of(&case), |file| {
            let answers = queries.iter().map(|it| answer(file, it.as_array().unwrap_or_default()));
            format!("{:?}", answers.collect::<Vec<_>>())
        });
        let _ = writeln!(stdout, "{answers}");
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
    let mut comments_seconds = 0f64;
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
            let mut best = f64::MAX;
            for _ in 0..ROUNDS {
                let started = std::time::Instant::now();
                std::hint::black_box(bun_lint::tokens::comments_again(file));
                best = best.min(started.elapsed().as_secs_f64());
            }
            comments_seconds += best;
        });
    }
    println!(
        "{} files, {:.1} MB, {} tokens: {:.1} ms, {:.0} MB/s, {:.1} ns per token. Only comments: {:.1} ms, {:.0} MB/s. Parse and bind: {:.1} ms",
        paths.len(),
        bytes as f64 / 1e6,
        tokens / ROUNDS,
        seconds * 1e3,
        bytes as f64 / 1e6 / seconds,
        seconds * 1e9 / (tokens / ROUNDS).max(1) as f64,
        comments_seconds * 1e3,
        bytes as f64 / 1e6 / comments_seconds,
        parse_seconds * 1e3,
    );
}

/// What is wrong with the tokens and comments of `file`, if anything.
fn check<'a>(file: &'a File<'a>) -> Option<String> {
    let mut end = 0;
    for token in file.tokens().with_comments() {
        if token.start() < end || token.end() <= token.start() || token.end() as usize > file.text().len() {
            return Some(format!("{token:?} at {}..{} after {end}", token.start(), token.end()));
        }
        end = token.end();
    }
    if !file.has_parse_errors() && bun_lint::tokens::scan_comments_again(file).is_none() {
        return Some("the scans disagree on the comments".to_owned());
    }
    None
}

fn fuzz(rounds: usize, paths: &[String]) {
    const BYTES: &[u8] = b"<>/{}()[]`'\"$\\#*=!-.?:;,@ \n\rax0e_\xE2\x80\xA8\xC2\xA0\xFF\xF0";
    let mut seed = 0x2545_F491_4F6C_DD1Du64;
    let mut random = |below: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % below.max(1) as u64) as usize
    };
    std::panic::set_hook(Box::new(|_| {}));
    let (mut scanned, mut panics) = (0, 0);
    for path in paths {
        let Ok(original) = std::fs::read(path) else {
            continue;
        };
        for _ in 0..rounds {
            let mut code = original.clone();
            for _ in 0..1 + random(4) {
                let at = random(code.len());
                let len = random(12).min(code.len() - at);
                match random(5) {
                    0 => drop(code.drain(at..at + len)),
                    1 => code.truncate(at),
                    2 => {
                        let copy = code[at..at + len].to_vec();
                        let to = random(code.len());
                        code.splice(to..to, copy);
                    }
                    _ => {
                        let inserted: Vec<u8> = (0..1 + random(3)).map(|_| BYTES[random(BYTES.len())]).collect();
                        code.splice(at..at, inserted);
                    }
                }
            }
            let problem = std::panic::catch_unwind(|| crate::with_file(path, &code, &LanguageOptions::default(), check));
            scanned += 1;
            let problem = match problem {
                Ok(None) => continue,
                Ok(Some(problem)) => problem,
                Err(_) => "panic".to_owned(),
            };
            panics += 1;
            let saved = format!("fuzz-{panics}-{}", path.rsplit('/').next().unwrap_or_default());
            let _ = std::fs::write(&saved, &code);
            println!("{saved}: {problem}");
        }
    }
    println!("{scanned} texts, {panics} problems");
}

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "dump" => dump(path),
        [command, path] if command == "batch" => batch(path),
        [command, path] if command == "query" => query(path),
        [command, paths @ ..] if command == "bench" => bench(paths),
        [command, rounds, paths @ ..] if command == "fuzz" => fuzz(rounds.parse().unwrap_or(1), paths),
        _ => println!("usage: bun-lint tokens dump <file> | batch <cases.jsonl> | query <cases.jsonl> | bench <files..> | fuzz <rounds> <files..>"),
    }
}
