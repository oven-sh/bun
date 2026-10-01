//! The harness of the probe: not part of the proposed crate.

use std::io::Write;

fn line_column(text: &[u8], offset: usize) -> (usize, usize) {
    let (mut line, mut column) = (1, 1);
    let head = String::from_utf8_lossy(&text[..offset.min(text.len())]).into_owned();
    let mut chars = head.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                line += 1;
                column = 1;
            }
            '\n' | '\u{2028}' | '\u{2029}' => {
                line += 1;
                column = 1;
            }
            _ => column += c.len_utf16(),
        }
    }
    (line, column)
}

fn run(paths: Vec<String>) {
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    for path in paths {
        let text = match std::fs::read(&path) {
            Ok(text) => text,
            Err(_) => {
                writeln!(out, "{path}\tUNREADABLE").unwrap();
                continue;
            }
        };
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(&b"probe.js"[..], &text[..]);
        // Bun reads `.js` with JSX on (bundler/options.rs): so does the probe.
        let loader = bun_ast::Loader::Jsx;
        let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
        options.features.top_level_await = true;
        let define = bun_js_parser::Define::default();
        let mut log = bun_ast::Log::init();
        let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena)
        else {
            writeln!(out, "{path}\tPARSE").unwrap();
            continue;
        };
        let started = std::time::Instant::now();
        let no_lint = std::env::var_os("PROBE_PARSE_ONLY").is_some();
        let result = parser.parse_only(|parsed| {
            let parsed_at = started.elapsed();
            let diagnostics = if no_lint {
                Vec::new()
            } else {
                crate::lint::lint(parsed, &source, &arena)
            };
            (diagnostics, parsed_at, started.elapsed())
        });
        match result {
            Ok((diagnostics, parse_time, both)) => {
                if std::env::var_os("PROBE_TIMES").is_some() {
                    eprintln!(
                        "{path}: parse {:?}, walk and rules {:?}, {} reports",
                        parse_time,
                        both - parse_time,
                        diagnostics.len()
                    );
                }
                writeln!(out, "{path}\tOK").unwrap();
                for d in diagnostics {
                    let (line, column) = line_column(&text, d.start as usize);
                    let crate::lint::Severity::Error = d.severity;
                    writeln!(
                        out,
                        "{path}\t{}\t{}\t{line}:{column}\t{}\t{}",
                        d.start,
                        d.len,
                        d.code,
                        String::from_utf8_lossy(&d.text).replace('\n', "\\n")
                    )
                    .unwrap();
                }
            }
            Err(_) => writeln!(out, "{path}\tPARSE").unwrap(),
        }
    }
}

pub(crate) fn main() {
    let mut paths = Vec::new();
    for arg in std::env::args().skip(1) {
        match arg.strip_prefix('@') {
            Some(list) => paths.extend(
                std::fs::read_to_string(list)
                    .unwrap()
                    .lines()
                    .map(str::to_owned),
            ),
            None => paths.push(arg),
        }
    }
    // A thread with a stack of a known size, as Bun's main thread has one.
    const STACK: usize = 16 * 1024 * 1024;
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let probe = 0u8;
            crate::shims::STACK_TOP.store(
                (&raw const probe) as usize,
                core::sync::atomic::Ordering::Relaxed,
            );
            crate::shims::STACK_SIZE.store(STACK, core::sync::atomic::Ordering::Relaxed);
            bun_core::StackCheck::configure_thread();
            run(paths);
        })
        .unwrap()
        .join()
        .unwrap();
}
