// Scratch driver: the two modules against the Go oracles. `proto2 directives x.hex`, `proto2 pragmas x.hex`, `proto2 table-d x.hex`, `proto2 table-p x.hex`.
mod comment_directives;
mod pragmas;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Loc {
    pub start: i32,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Range {
    pub loc: Loc,
    pub len: i32,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Message {
    pub code: u32,
    pub text: &'static [u8],
}
pub const INVALID_REFERENCE_DIRECTIVE_SYNTAX: Message = Message { code: 1084, text: b"Invalid 'reference' directive syntax." };
pub const X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT: Message =
    Message { code: 1453, text: b"`resolution-mode` should be either `require` or `import`." };

use pragmas::{ReferenceDirectiveKind, ResolutionMode};

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

// Every `//` and `/*` after a `#!` line is a comment: the inputs hold none inside a string, a template or a regular expression.
fn comments_of(text: &[u8], skip_shebang: bool) -> Vec<Range> {
    let mut out = Vec::new();
    let mut pos = 0;
    if skip_shebang && text.starts_with(b"#!") {
        pos = 2;
        while pos < text.len() && comment_directives::line_break_len(text, pos) == 0 {
            pos += 1;
        }
    }
    while pos < text.len() {
        if text[pos] == b'/' && text.get(pos + 1) == Some(&b'/') {
            let start = pos;
            pos += 2;
            while pos < text.len() && comment_directives::line_break_len(text, pos) == 0 {
                pos += 1;
            }
            out.push(Range { loc: Loc { start: start as i32 }, len: (pos - start) as i32 });
        } else if text[pos] == b'/' && text.get(pos + 1) == Some(&b'*') {
            let start = pos;
            pos += 2;
            loop {
                if pos >= text.len() {
                    break;
                }
                if text[pos] == b'*' && text.get(pos + 1) == Some(&b'/') {
                    pos += 2;
                    break;
                }
                pos += 1;
            }
            out.push(Range { loc: Loc { start: start as i32 }, len: (pos - start) as i32 });
        } else {
            pos += 1;
        }
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args[1].as_str();
    let data = std::fs::read_to_string(&args[2]).unwrap();
    for line in data.lines() {
        let (name, hex) = line.split_once('\t').unwrap();
        let text = unhex(hex);
        if mode == "directives" || mode == "table-d" {
            // The oracle of the directives steps over every rune, a `#!` line too.
            let comments = comments_of(&text, false);
            let directives = comment_directives::get_comment_directives(&text, &comments);
            if mode == "table-d" {
                let c: Vec<String> = comments.iter().map(|c| format!("({}, {})", c.loc.start, c.loc.start + c.len)).collect();
                let d: Vec<String> = directives.iter().map(|d| format!("({:?}, {}, {})", d.kind, d.start, d.end)).collect();
                println!("{name}\t&[{}]\t&[{}]", c.join(", "), d.join(", "));
                continue;
            }
            println!("--- {name}");
            for d in directives {
                println!("directive {:?} {}..{}", d.kind, d.start, d.end);
            }
            continue;
        }
        let comments = comments_of(&text, true);
        let list = pragmas::get_comment_pragmas(&text, &comments);
        let mut context = pragmas::Pragmas::default();
        let mut diags: Vec<(u32, u32, u32)> = Vec::new();
        pragmas::process_pragmas_into_fields(&text, &list, &mut context, &mut |message, start, end| diags.push((message.code, start, end)));
        let mode_of = |m: ResolutionMode| match m {
            ResolutionMode::None => "none",
            ResolutionMode::CommonJS => "require",
            ResolutionMode::ESM => "import",
        };
        if mode == "table-p" {
            let c: Vec<String> = comments.iter().map(|c| format!("({}, {})", c.loc.start, c.loc.start + c.len)).collect();
            let r: Vec<String> = context
                .reference_directives
                .iter()
                .map(|r| format!("({:?}, {}, {}, {:?}, {}, {}, {})", r.kind, r.start, r.end, r.resolution_mode, r.preserve, r.comment_start, r.comment_end))
                .collect();
            let k = context.check_js_directive.map_or("None".to_string(), |c| format!("Some(({}, {}, {}))", c.enabled, c.start, c.end));
            let d: Vec<String> = diags.iter().map(|d| format!("({}, {}, {})", d.0, d.1, d.2)).collect();
            println!("{name}\t&[{}]\t&[{}]\t{k}\t&[{}]", c.join(", "), r.join(", "), d.join(", "));
            continue;
        }
        println!("--- {name}");
        if let Some(check) = context.check_js_directive {
            println!("check {} {}..{}", check.enabled as u8, check.start, check.end);
        }
        for kind in [ReferenceDirectiveKind::Path, ReferenceDirectiveKind::Types, ReferenceDirectiveKind::Lib] {
            for r in context.reference_directives.iter().filter(|r| r.kind == kind) {
                match kind {
                    ReferenceDirectiveKind::Path => println!("path {}..{} preserve={}", r.start, r.end, r.preserve as u8),
                    ReferenceDirectiveKind::Types => {
                        println!("types {}..{} mode={} preserve={}", r.start, r.end, mode_of(r.resolution_mode), r.preserve as u8)
                    }
                    ReferenceDirectiveKind::Lib => println!("lib {}..{} preserve={}", r.start, r.end, r.preserve as u8),
                    ReferenceDirectiveKind::NoDefaultLib => {}
                }
            }
        }
        for d in &diags {
            println!("diag TS{} {}..{}", d.0, d.1, d.2);
        }
    }
}
