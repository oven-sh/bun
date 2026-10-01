mod comment_directives;
mod pragmas;

use comment_directives::{Comment, CommentKind};
use pragmas::{CommentRangeKind, ResolutionMode};

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

// Every `//` and `/*` of the text is a comment: the inputs hold none inside a string, a template or a regular expression.
fn comments_of(text: &[u8]) -> Vec<Comment> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        if text[pos] == b'/' && text.get(pos + 1) == Some(&b'/') {
            let start = pos;
            pos += 2;
            while pos < text.len() && comment_directives::line_break_len(text, pos) == 0 {
                pos += 1;
            }
            out.push(Comment { start: start as u32, end: pos as u32, kind: CommentKind::Line });
        } else if text[pos] == b'/' && text.get(pos + 1) == Some(&b'*') {
            let start = pos;
            pos += 2;
            let is_jsdoc = text.get(pos) == Some(&b'*') && text.get(pos + 1) != Some(&b'/');
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
            out.push(Comment { start: start as u32, end: pos as u32, kind: if is_jsdoc { CommentKind::JsDoc } else { CommentKind::Block } });
        } else {
            pos += 1;
        }
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = &args[1];
    let data = std::fs::read_to_string(&args[2]).unwrap();
    for line in data.lines() {
        let (name, hex) = line.split_once('\t').unwrap();
        let text = unhex(hex);
        println!("--- {name}");
        if mode == "directives" {
            for d in comment_directives::get_comment_directives(&text, &comments_of(&text)) {
                println!("directive {:?} {}..{}", d.kind, d.start, d.end);
            }
            continue;
        }
        let mut header = pragmas::get_comment_pragmas(&text);
        let mut diags = Vec::new();
        pragmas::process_pragmas_into_fields(&mut header, &text, &mut |d| diags.push(d));
        for pragma in &header.list {
            let first = pragma.arguments_start as usize;
            let mut arguments: Vec<String> = header.arguments[first..first + pragma.arguments_len as usize]
                .iter()
                .map(|a| {
                    let name = if a.name_start == a.name_end {
                        "factory".to_string()
                    } else {
                        String::from_utf8_lossy(&text[a.name_start as usize..a.name_end as usize]).to_ascii_lowercase()
                    };
                    format!("{name}={}..{}", a.value_start, a.value_end)
                })
                .collect();
            arguments.sort();
            println!(
                "pragma {} {}..{} {} nl={} [{}]",
                String::from_utf8_lossy(pragma.name.text()),
                pragma.comment.start,
                pragma.comment.end,
                if pragma.comment.kind == CommentRangeKind::SingleLine { "S" } else { "M" },
                pragma.comment.has_trailing_new_line as u8,
                arguments.join(" ")
            );
        }
        if let Some(check) = header.check_js_directive {
            println!("check {} {}..{}", check.enabled as u8, check.range.start, check.range.end);
        }
        let mode_of = |m: ResolutionMode| match m {
            ResolutionMode::None => "none",
            ResolutionMode::CommonJs => "require",
            ResolutionMode::EsNext => "import",
        };
        for r in &header.referenced_files {
            println!("path {}..{} preserve={}", r.start, r.end, r.preserve as u8);
        }
        for r in &header.type_reference_directives {
            println!("types {}..{} mode={} preserve={}", r.start, r.end, mode_of(r.resolution_mode), r.preserve as u8);
        }
        for r in &header.lib_reference_directives {
            println!("lib {}..{} preserve={}", r.start, r.end, r.preserve as u8);
        }
        for d in &diags {
            println!("diag TS{} {}..{}", d.code, d.start, d.end);
        }
    }
}
