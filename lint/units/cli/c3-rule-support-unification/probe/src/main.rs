//! Probe: the support layer and the eleven first rules of bun_lint over `Parser::parse_only` trees.
//! usage: probe tokens <file>            every token of the file: `start end kind`
//!        probe lint <cases>             cases: one per line, `id<TAB>js|jsx<TAB>hex of the source`
//!        probe file <path>...           lints files, prints `path(line,col): rule: message`
mod context;
mod linter;
mod names;
mod rules;
mod shims;
mod tokens;

use bun_js_parser::parse::parse_entry::ParsedOnly;

fn with_parsed<R>(
    text: &[u8],
    jsx: bool,
    f: impl FnOnce(&ParsedOnly<'_, '_>, &bun_ast::Source, &bun_alloc::Arena) -> R,
) -> Option<R> {
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let name: &[u8] = if jsx { b"case.jsx" } else { b"case.js" };
    let source = bun_ast::Source::init_path_string(name, text);
    let loader = if jsx { bun_ast::Loader::Jsx } else { bun_ast::Loader::Js };
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.top_level_await = true;
    options.suppress_warnings_about_weird_code = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let parser = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    parser.parse_only(|parsed| f(parsed, &source, &arena)).ok()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("tokens") => {
            let text = std::fs::read(&args[2]).unwrap();
            let jsx = args[2].ends_with("x");
            let done = with_parsed(&text, jsx, |parsed, source, arena| {
                let stmts: Vec<&bun_ast::Stmt> = parsed.stmts.iter().collect();
                let spans = tokens::Spans::under(source.contents(), &[], &stmts);
                let mut log = bun_ast::Log::init();
                let mut tokens = tokens::Tokens::new(&mut log, source, arena, &spans, 0);
                while let Some(token) = tokens.next() {
                    println!("{} {} {:?}", token.start, token.end, token.kind);
                }
                if tokens.failed() {
                    println!("FAILED");
                }
            });
            if done.is_none() {
                println!("PARSE_ERROR");
            }
        }
        Some("tokens-batch") => {
            for path in std::fs::read_to_string(&args[2]).unwrap().lines() {
                let Ok(text) = std::fs::read(path) else { continue };
                let done = with_parsed(&text, path.ends_with("x"), |parsed, source, arena| {
                    let stmts: Vec<&bun_ast::Stmt> = parsed.stmts.iter().collect();
                    let spans = tokens::Spans::under(source.contents(), &[], &stmts);
                    let mut log = bun_ast::Log::init();
                    let mut tokens = tokens::Tokens::new(&mut log, source, arena, &spans, 0);
                    let mut line = String::new();
                    while let Some(token) = tokens.next() {
                        let tag = match token.kind {
                            tokens::Kind::Jsx => "J",
                            tokens::Kind::RegExp => "R",
                            _ => "",
                        };
                        line.push_str(&format!("{}-{}{} ", token.start, token.end, tag));
                    }
                    if tokens.failed() {
                        line.push_str("FAILED");
                    }
                    line
                });
                println!("{path}\t{}", done.unwrap_or_else(|| "PARSE_ERROR".into()));
            }
        }
        Some("lint") => {
            let cases = std::fs::read_to_string(&args[2]).unwrap();
            for line in cases.lines() {
                let mut parts = line.split('\t');
                let (Some(id), Some(kind), Some(code)) = (parts.next(), parts.next(), parts.next()) else { continue };
                let text = unhex(code);
                let reports = with_parsed(&text, kind == "jsx", |parsed, source, arena| linter::lint(parsed, source, arena));
                match reports {
                    None => println!("{id}\tPARSE_ERROR"),
                    Some(reports) => {
                        println!("{id}\tOK");
                        for report in reports {
                            println!("{id}\tR\t{}\t{}\t{}\t{}", report.rule, report.start, report.len, hex(&report.message));
                        }
                    }
                }
            }
        }
        Some("file") => {
            for path in &args[2..] {
                let text = std::fs::read(path).unwrap();
                let started = std::time::Instant::now();
                let reports = with_parsed(&text, path.ends_with("x"), |parsed, source, arena| linter::lint(parsed, source, arena));
                match reports {
                    None => println!("{path}: PARSE_ERROR"),
                    Some(reports) => {
                        eprintln!("{path}: {} reports in {:?}", reports.len(), started.elapsed());
                        for report in reports {
                            let before = &text[..report.start as usize];
                            let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                            let col = before.len() - before.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1) + 1;
                            println!("{path}({line},{col}): {}: {}", report.rule, String::from_utf8_lossy(&report.message));
                        }
                    }
                }
            }
        }
        _ => eprintln!("usage: probe tokens <file> | lint <cases> | file <path>..."),
    }
}
