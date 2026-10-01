//! Scratch probe: every source of the test tables through a lint parse whose lexer keeps its comments, printed as the Go oracles print.
use crate::defines::Define;
use crate::parse::comment_directives::CommentDirectiveKind;
use crate::parse::parse_entry::{Options, Parser};
use crate::parse::pragmas::{ReferenceDirectiveKind, ResolutionMode};
use bun_alloc::Arena;
use bun_ast::{Loader, Log, Source};

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn run(mode: &str, name: &str, text: &'static [u8], out: &mut String) {
    use std::fmt::Write;
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let tsx = name.ends_with(".tsx");
    let path: &'static [u8] = if tsx { b"/a.tsx" } else { b"/a.ts" };
    let source = Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), if tsx { Loader::Tsx } else { Loader::Ts });
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    options.features.minify_identifiers = true;
    let define = Define::default();
    let mut log = Log::init();
    writeln!(out, "--- {name}").unwrap();
    let mut lines = String::new();
    let parsed = match Parser::init(options, &mut log, &source, &define, &arena) {
        Ok(parser) => parser
            .parse_for_lint(|parsed| {
                if mode == "d" {
                    for d in &parsed.sidecar.comment_directives {
                        let kind = if d.kind == CommentDirectiveKind::Ignore { "Ignore" } else { "ExpectError" };
                        writeln!(lines, "directive {kind} {}..{}", d.start, d.end).unwrap();
                    }
                    return;
                }
                let pragmas = &parsed.sidecar.pragmas;
                if let Some(check) = pragmas.check_js_directive {
                    writeln!(lines, "check {} {}..{}", check.enabled as u8, check.start, check.end).unwrap();
                }
                for kind in [ReferenceDirectiveKind::Path, ReferenceDirectiveKind::Types, ReferenceDirectiveKind::Lib] {
                    for r in pragmas.reference_directives.iter().filter(|r| r.kind == kind) {
                        let mode = match r.resolution_mode {
                            ResolutionMode::None => "none",
                            ResolutionMode::CommonJS => "require",
                            ResolutionMode::ESM => "import",
                        };
                        match kind {
                            ReferenceDirectiveKind::Path => writeln!(lines, "path {}..{} preserve={}", r.start, r.end, r.preserve as u8).unwrap(),
                            ReferenceDirectiveKind::Types => writeln!(lines, "types {}..{} mode={mode} preserve={}", r.start, r.end, r.preserve as u8).unwrap(),
                            _ => writeln!(lines, "lib {}..{} preserve={}", r.start, r.end, r.preserve as u8).unwrap(),
                        }
                    }
                }
            })
            .is_ok(),
        Err(_) => false,
    };
    out.push_str(&lines);
    for msg in &log.msgs {
        let (offset, length) = msg.data.location.as_ref().map_or((0, 0), |l| (l.offset, l.length));
        match msg.code() {
            Some(code @ (1084 | 1453)) if mode == "p" => writeln!(out, "diag TS{code} {}..{}", offset, offset + length).unwrap(),
            code if !parsed => writeln!(out, "PARSE-ERROR {code:?} {}..{} {}", offset, offset + length, bstr::BStr::new(&msg.data.text)).unwrap(),
            _ => {}
        }
    }
}

#[test]
fn zz_probe_rows() {
    for mode in ["d", "p", "x"] {
        let file = if mode == "x" { "/tmp/b1dp/parse-d.hex".to_string() } else { format!("/tmp/b1dp/rows-{mode}.hex") };
        let data = std::fs::read_to_string(file).unwrap();
        let mode = if mode == "x" { "d" } else { mode };
        let mut out = String::new();
        for line in data.lines() {
            let (name, hex) = line.split_once('\t').unwrap();
            let text: &'static [u8] = Box::leak(unhex(hex).into_boxed_slice());
            run(mode, name, text, &mut out);
        }
        let name = if data.starts_with("upstream") { "parse-d".to_string() } else { format!("rows-{mode}") };
        std::fs::write(format!("/tmp/b1check/{name}.lint.txt"), out).unwrap();
    }
}
// The list of comments itself was printed by one more line in the scratch copy of parse_entry.rs, before get_comment_directives:
//   eprintln!("COMMENTS {} {:?}", bstr::BStr::new(p.source.path.text), p.lexer.all_comments.iter().map(|c| (c.loc.start, c.loc.start + c.len)).collect::<Vec<_>>());
