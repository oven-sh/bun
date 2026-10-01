mod comment_directives;
mod pragmas;
mod vectors;

use comment_directives::{CommentDirectiveKind, comment_directives};
use pragmas::*;

fn describe(text: &[u8]) -> String {
    let mut diags: Vec<String> = Vec::new();
    let header = Header::read(text, &mut |start, end, message: Message| {
        diags.push(format!("TS{}@{}-{}", message.code, start, end));
    });
    let file = |r: &FileReference| {
        let mode = match r.resolution_mode {
            ResolutionMode::None => "",
            ResolutionMode::ESM => " mode=import",
            ResolutionMode::CommonJS => " mode=require",
        };
        format!("{}-{}{}{}", r.start, r.end, mode, if r.preserve { " preserve" } else { "" })
    };
    let list = |l: &[FileReference]| l.iter().map(file).collect::<Vec<_>>().join(" ");
    let check = match header.check_js_directive {
        None => "none".to_string(),
        Some(d) => format!("enabled={}@{}-{}", d.enabled, d.range.start, d.range.end),
    };
    let pragma = |p: &Pragma| {
        let name = match p.name {
            PragmaName::Reference => "reference",
            PragmaName::TsCheck => "ts-check",
            PragmaName::TsNocheck => "ts-nocheck",
            PragmaName::Jsx => "jsx",
            PragmaName::Jsxfrag => "jsxfrag",
            PragmaName::Jsximportsource => "jsximportsource",
            PragmaName::Jsxruntime => "jsxruntime",
        };
        let a = p.arguments;
        let args: Vec<String> = [
            ("factory", a.factory),
            ("lib", a.lib),
            ("no-default-lib", a.no_default_lib),
            ("path", a.path),
            ("preserve", a.preserve),
            ("resolution-mode", a.resolution_mode),
            ("types", a.types),
        ]
        .into_iter()
        .filter_map(|(n, v)| v.map(|v| format!("{}@{}-{}", n, v.start, v.end)))
        .collect();
        let kind = if p.comment.kind == CommentRangeKind::SingleLine { 1 } else { 2 };
        format!("{}[{}-{} kind={} nl={}]{{{}}}", name, p.comment.start, p.comment.end, kind, p.comment.has_trailing_new_line, args.join(","))
    };
    format!(
        "ref=[{}] types=[{}] lib=[{}] checkJs={} diags=[{}] pragmas=[{}]",
        list(&header.referenced_files),
        list(&header.type_reference_directives),
        list(&header.lib_reference_directives),
        check,
        diags.join(" "),
        header.pragmas.iter().map(pragma).collect::<Vec<_>>().join(" ")
    )
}

fn unhex(h: &str) -> Vec<u8> {
    (0..h.len() / 2)
        .map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

/// `proto pragmas-hex <file.hex>`: the header of each `name<TAB>hex` line, as the oracle prints it.
/// `proto directives-hex <file.hex> <oracle output>`: the directives of each line for the comments that the oracle found.
fn hex_mode(args: &[String]) {
    use std::io::Write;
    let input = std::fs::read_to_string(&args[2]).unwrap();
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    if args[1] == "pragmas-hex" {
        for line in input.lines() {
            let Some((_, h)) = line.split_once('\t') else { continue };
            writeln!(out, "{}", describe(&unhex(h))).unwrap();
        }
        return;
    }
    let oracle = std::fs::read_to_string(&args[3]).unwrap();
    for (line, found) in input.lines().zip(oracle.lines()) {
        let Some((name, h)) = line.split_once('\t') else { continue };
        let text = unhex(h);
        let comments = found.split('\t').nth(1).unwrap_or("");
        let list: Vec<(u32, u32)> = comments
            .split(' ')
            .filter_map(|c| c.split_once(".."))
            .map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap()))
            .collect();
        let got = comment_directives(&text, list.iter().copied())
            .iter()
            .map(|d| format!("{} {}..{}", if d.kind == CommentDirectiveKind::Ignore { "Ignore" } else { "ExpectError" }, d.start, d.end))
            .collect::<Vec<_>>()
            .join(", ");
        writeln!(out, "{}\t{}\t{}", name, comments, got).unwrap();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 2 {
        hex_mode(&args);
        return;
    }
    let (mut same, mut diff) = (0, 0);
    for (i, (text, want)) in vectors::PRAGMA_VECTORS.iter().enumerate() {
        let got = describe(text);
        if got == *want {
            same += 1;
        } else {
            diff += 1;
            println!("PRAGMA DIFF #{} {:?}\n  go  : {}\n  rust: {}", i, String::from_utf8_lossy(text), want, got);
        }
    }
    println!("pragmas: same={} diff={} of {}", same, diff, vectors::PRAGMA_VECTORS.len());
    let (mut same, mut diff) = (0, 0);
    for (name, text, comments, want) in vectors::DIRECTIVE_VECTORS {
        let got = comment_directives(text, comments.iter().copied())
            .iter()
            .map(|d| format!("{} {}..{}", if d.kind == CommentDirectiveKind::Ignore { "Ignore" } else { "ExpectError" }, d.start, d.end))
            .collect::<Vec<_>>()
            .join(", ");
        if got == *want { same += 1; } else { diff += 1; println!("DIRECTIVE DIFF {}\n  go  : {}\n  rust: {}", name, want, got); }
    }
    println!("directives: same={} diff={} of {}", same, diff, vectors::DIRECTIVE_VECTORS.len());
    context();
    let leading = get_leading_comment_ranges(b"#!x\n// a\n/* b */ let x;");
    println!("leading: {:?}", leading.iter().map(|c| (c.start, c.end)).collect::<Vec<_>>());
    let header = Header::read(b"/* @jsx a */\n/* @jsx b.c */\n", &mut |_, _, _| {});
    let source: &[u8] = b"/* @jsx a */\n/* @jsx b.c */\n";
    println!("last jsx: {:?}", header.get_pragma(PragmaName::Jsx).and_then(|p| p.arguments.factory).map(|f| String::from_utf8_lossy(f.text(source)).into_owned()));
    let header = Header::read(b"/// <reference path=\"a.ts\" />\n", &mut |_, _, _| {});
    println!("file name: {:?}", header.referenced_files.first().map(|f| String::from_utf8_lossy(f.file_name(b"/// <reference path=\"a.ts\" />\n")).into_owned()));
}

#[allow(dead_code)]
pub fn context() {
    let (mut same, mut diff) = (0, 0);
    for (name, _loader, text, comments, want) in vectors::CONTEXT_VECTORS {
        let got = comment_directives(text, comments.iter().copied())
            .iter()
            .map(|d| format!("{} {}..{}", if d.kind == CommentDirectiveKind::Ignore { "Ignore" } else { "ExpectError" }, d.start, d.end))
            .collect::<Vec<_>>()
            .join(", ");
        if got == *want { same += 1; } else { diff += 1; println!("CONTEXT DIFF {}\n  tsc : {}\n  rust: {}\n  comments: {:?}", name, want, got, comments); }
    }
    println!("context directives (comment list of tsc's token stream): same={} diff={} of {}", same, diff, vectors::CONTEXT_VECTORS.len());
}
