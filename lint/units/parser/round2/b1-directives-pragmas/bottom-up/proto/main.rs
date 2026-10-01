// The scratch crate around the two modules: stand-ins for what `bun_js_parser` gives them, and the checks against the oracles.
mod comment_directives;
mod pragmas;

/// Stands in for `bun_core::strings`.
mod strings {
    pub(super) fn index_of(text: &[u8], s: &[u8]) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at..).is_some_and(|rest| rest.starts_with(s)))
    }
    pub(super) fn index_of_char_usize(text: &[u8], char: u8) -> Option<usize> {
        (0..text.len()).find(|&at| text.get(at) == Some(&char))
    }
}

/// Stands in for `crate::parse::syntax_errors`.
mod syntax_errors {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct Message {
        pub code: u32,
        pub text: &'static [u8],
    }
    pub const INVALID_REFERENCE_DIRECTIVE_SYNTAX: Message = Message {
        code: 1084,
        text: b"Invalid 'reference' directive syntax.",
    };
    pub const X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT: Message = Message {
        code: 1453,
        text: b"`resolution-mode` should be either `require` or `import`.",
    };
}

use comment_directives::{CommentDirectiveKind, scan_comment_directives};
use pragmas::*;

fn lossy(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

fn read(text: &[u8]) -> (Pragmas, Vec<(u32, u32, u32)>) {
    let mut diags = Vec::new();
    let header = Pragmas::read(text, &mut |start, end, message| diags.push((message.code, start, end)));
    (header, diags)
}

fn pragma_name(name: PragmaName) -> &'static str {
    match name {
        PragmaName::Reference => "reference",
        PragmaName::TsCheck => "ts-check",
        PragmaName::TsNocheck => "ts-nocheck",
        PragmaName::Jsx => "jsx",
        PragmaName::Jsxfrag => "jsxfrag",
        PragmaName::Jsximportsource => "jsximportsource",
        PragmaName::Jsxruntime => "jsxruntime",
    }
}

/// The format of the oracle of this directory (expected-go.txt), without the line of the pragmas.
fn describe(text: &[u8]) -> Vec<String> {
    let (header, diags) = read(text);
    let refs = |kind: ReferenceDirectiveKind| {
        header
            .references_of(kind)
            .map(|r| {
                let mut s = format!("{}..{} {:?}", r.start, r.end, lossy(r.file_name(text)));
                match r.resolution_mode {
                    ResolutionMode::None => {}
                    ResolutionMode::ESM => s += " mode=import",
                    ResolutionMode::CommonJS => s += " mode=require",
                }
                if r.preserve {
                    s += " preserve";
                }
                s
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    vec![
        format!("  referencedFiles=[{}]", refs(ReferenceDirectiveKind::Path)),
        format!("  typeReferenceDirectives=[{}]", refs(ReferenceDirectiveKind::Types)),
        format!("  libReferenceDirectives=[{}]", refs(ReferenceDirectiveKind::Lib)),
        match header.check_js_directive {
            None => "  checkJsDirective=none".to_string(),
            Some(d) => format!("  checkJsDirective=enabled:{} {}..{}", d.enabled, d.range.start, d.range.end),
        },
        format!(
            "  diagnostics=[{}]",
            diags.iter().map(|(c, s, e)| format!("TS{c} {s}..{e}")).collect::<Vec<_>>().join(", ")
        ),
    ]
}

/// The rows of a Rust table for the tests of the crate.
fn table_row(name: &str, text: &[u8]) -> String {
    let (header, diags) = read(text);
    let refs = header
        .reference_directives
        .iter()
        .map(|r| format!("({:?}, {}, {}, {:?}, {}, {}, {})", r.kind, r.start, r.end, r.resolution_mode, r.preserve, r.comment_range.start, r.comment_range.end))
        .collect::<Vec<_>>()
        .join(", ");
    let check = match header.check_js_directive {
        None => "None".to_string(),
        Some(d) => format!("Some(({}, {}, {}))", d.enabled, d.range.start, d.range.end),
    };
    let ds = diags.iter().map(|(c, s, e)| format!("({c}, {s}, {e})")).collect::<Vec<_>>().join(", ");
    let ps = header
        .pragmas
        .iter()
        .filter(|p| !matches!(p.name, PragmaName::Reference | PragmaName::TsCheck | PragmaName::TsNocheck))
        .map(|p| format!("({}, {:?})", pragma_name(p.name), p.args.factory.map(|f| lossy(f.value(text)))))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{name}: refs=[{refs}] check={check} diags=[{ds}] jsx=[{ps}]")
}

/// The format of ../../comment-directives-pragmas/bottom-up/pragmas/expected-go-reduced.txt.
fn describe_reduced(text: &[u8]) -> String {
    let (header, diags) = read(text);
    let list = |kind: ReferenceDirectiveKind| {
        header
            .references_of(kind)
            .map(|r| {
                let mode = match r.resolution_mode {
                    ResolutionMode::None => "",
                    ResolutionMode::ESM => " mode=import",
                    ResolutionMode::CommonJS => " mode=require",
                };
                format!("{}-{}{}{}", r.start, r.end, mode, if r.preserve { " preserve" } else { "" })
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    let check = match header.check_js_directive {
        None => "none".to_string(),
        Some(d) => format!("enabled={}@{}-{}", d.enabled, d.range.start, d.range.end),
    };
    let pragma = |p: &Pragma| {
        let a = p.args;
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
        let kind = if p.comment_range.kind == CommentRangeKind::SingleLine { 1 } else { 2 };
        format!(
            "{}[{}-{} kind={} nl={}]{{{}}}",
            pragma_name(p.name),
            p.comment_range.start,
            p.comment_range.end,
            kind,
            p.comment_range.has_trailing_new_line,
            args.join(",")
        )
    };
    format!(
        "ref=[{}] types=[{}] lib=[{}] checkJs={} diags=[{}] pragmas=[{}]",
        list(ReferenceDirectiveKind::Path),
        list(ReferenceDirectiveKind::Types),
        list(ReferenceDirectiveKind::Lib),
        check,
        diags.iter().map(|(c, s, e)| format!("TS{c}@{s}-{e}")).collect::<Vec<_>>().join(" "),
        header.pragmas.iter().map(pragma).collect::<Vec<_>>().join(" ")
    )
}


/// `text` as a Rust byte string literal.
fn lit(text: &[u8]) -> String {
    let mut o = String::from("b\"");
    for &b in text {
        match b {
            b'\\' => o += "\\\\",
            b'"' => o += "\\\"",
            b'\n' => o += "\\n",
            b'\r' => o += "\\r",
            b'\t' => o += "\\t",
            0x20..=0x7e => o.push(b as char),
            _ => o += &format!("\\x{b:02x}"),
        }
    }
    o + "\""
}

/// One row of the table of the header tests.
fn rust_header_row(name: &str, text: &[u8]) -> String {
    let (header, diags) = read(text);
    let refs = header
        .reference_directives
        .iter()
        .map(|r| format!("({:?}, {}, {}, {:?}, {}, {}, {})", r.kind, r.start, r.end, r.resolution_mode, r.preserve, r.comment_range.start, r.comment_range.end))
        .collect::<Vec<_>>()
        .join(", ");
    let check = match header.check_js_directive {
        None => "None".to_string(),
        Some(d) => format!("Some(({}, {}, {}))", d.enabled, d.range.start, d.range.end),
    };
    let ds = diags.iter().map(|(c, s, e)| format!("({c}, {s}, {e})")).collect::<Vec<_>>().join(", ");
    let ps = header
        .pragmas
        .iter()
        .filter(|p| !matches!(p.name, PragmaName::Reference | PragmaName::TsCheck | PragmaName::TsNocheck))
        .map(|p| format!("({:?}, {})", p.name, p.args.factory.map_or("b\"\"".to_string(), |f| lit(f.value(text)))))
        .collect::<Vec<_>>()
        .join(", ");
    format!("    ({name:?}, {}, &[{refs}], {check}, &[{ds}], &[{ps}]),", lit(text))
}

fn unhex(h: &str) -> Vec<u8> {
    (0..h.len() / 2).map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap()).collect()
}

fn directives_of(text: &[u8], comments: &str) -> String {
    let list: Vec<(u32, u32)> = comments
        .split(' ')
        .filter_map(|c| c.split_once(".."))
        .map(|(a, b)| (a.parse().unwrap(), b.parse().unwrap()))
        .collect();
    scan_comment_directives(text, list.iter().copied())
        .iter()
        .map(|d| format!("{} {}..{}", if d.kind == CommentDirectiveKind::Ignore { "Ignore" } else { "ExpectError" }, d.start, d.end))
        .collect::<Vec<_>>()
        .join(", ")
}

// Minimal reader of the JSON that the inputs are: an array of [name, text] pairs of strings.
fn json_pairs(s: &str) -> Vec<(String, Vec<u8>)> {
    let b: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut strings: Vec<String> = Vec::new();
    while i < b.len() {
        if b[i] == '"' {
            i += 1;
            let mut units: Vec<u16> = Vec::new();
            while b[i] != '"' {
                if b[i] == '\\' {
                    i += 1;
                    match b[i] {
                        'n' => units.push(10),
                        'r' => units.push(13),
                        't' => units.push(9),
                        'b' => units.push(8),
                        'f' => units.push(12),
                        'u' => {
                            let h: String = b[i + 1..i + 5].iter().collect();
                            units.push(u16::from_str_radix(&h, 16).unwrap());
                            i += 4;
                        }
                        c => units.push(c as u16),
                    }
                } else {
                    let mut buf = [0u16; 2];
                    units.extend_from_slice(b[i].encode_utf16(&mut buf));
                }
                i += 1;
            }
            strings.push(String::from_utf16(&units).unwrap());
        }
        i += 1;
    }
    strings.chunks(2).map(|c| (c[0].clone(), c[1].clone().into_bytes())).collect()
}

fn main() {
    use std::io::Write;
    let args: Vec<String> = std::env::args().collect();
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    match args[1].as_str() {
        // proto pragmas <inputs.json>: the field lines of expected-go.txt
        "pragmas" => {
            for (name, text) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()) {
                writeln!(out, "--- {name}").unwrap();
                for line in describe(&text) {
                    writeln!(out, "{line}").unwrap();
                }
            }
        }
        // proto table <inputs.json>: one line of records per input
        "table" => {
            for (name, text) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()) {
                writeln!(out, "{}", table_row(&name, &text)).unwrap();
            }
        }
        // proto rust-headers <inputs.json>: the rows of the table of the header tests
        "rust-headers" => {
            for (name, text) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()) {
                writeln!(out, "{}", rust_header_row(&name, &text)).unwrap();
            }
        }
        // proto rust-directives <inputs.json> <expected-go.txt> <expected-tsc.txt>: the rows of the table of the directive tests
        "rust-directives" => {
            let expected = std::fs::read_to_string(&args[3]).unwrap();
            let lines: Vec<&str> = expected.lines().collect();
            let tsc = std::fs::read_to_string(&args[4]).unwrap();
            let tsc_lines: Vec<&str> = tsc.lines().collect();
            let rows = |s: &str| {
                s.split(", ")
                    .filter_map(|d| d.split_once(' '))
                    .map(|(k, r)| format!("({k}, {})", r.replace("..", ", ")))
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            for (i, (name, text)) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()).iter().enumerate() {
                let comments = lines[i * 3 + 1].split("comments=[").nth(1).unwrap().split(']').next().unwrap();
                let list = comments.split(' ').filter(|c| !c.is_empty()).map(|c| format!("({})", c.replace("..", ", "))).collect::<Vec<_>>().join(", ");
                let got = directives_of(text, comments);
                let of_tsc = tsc_lines[i * 2 + 1].split("directives=[").nth(1).unwrap().split(']').next().unwrap();
                let tsc_column = if of_tsc == got { "None".to_string() } else { format!("Some(&[{}])", rows(of_tsc)) };
                writeln!(out, "    ({name:?}, {}, &[{list}], &[{}], {tsc_column}),", lit(text), rows(&got)).unwrap();
            }
        }
        // proto pragmas-reduced <inputs.json>: one line per input, as expected-go-reduced.txt
        "pragmas-reduced" => {
            for (_, text) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()) {
                writeln!(out, "{}", describe_reduced(&text)).unwrap();
            }
        }
        // proto pragmas-hex <file.hex>: one line per `name<TAB>hex` line
        "pragmas-hex" => {
            for line in std::fs::read_to_string(&args[2]).unwrap().lines() {
                let Some((_, h)) = line.split_once('\t') else { continue };
                writeln!(out, "{}", describe_reduced(&unhex(h))).unwrap();
            }
        }
        // proto directives-hex <file.hex> <oracle output>: the directives of each line for the comments that the oracle found
        "directives-hex" => {
            let input = std::fs::read_to_string(&args[2]).unwrap();
            let oracle = std::fs::read_to_string(&args[3]).unwrap();
            for (line, found) in input.lines().zip(oracle.lines()) {
                let Some((name, h)) = line.split_once('\t') else { continue };
                let comments = found.split('\t').nth(1).unwrap_or("");
                writeln!(out, "{}\t{}\t{}", name, comments, directives_of(&unhex(h), comments)).unwrap();
            }
        }
        // proto directives <inputs.json> <expected-go.txt>: the directives of each input for the comments of the oracle
        "directives" => {
            let expected = std::fs::read_to_string(&args[3]).unwrap();
            let lines: Vec<&str> = expected.lines().collect();
            for (i, (name, text)) in json_pairs(&std::fs::read_to_string(&args[2]).unwrap()).iter().enumerate() {
                let comments = lines[i * 3 + 1].split("comments=[").nth(1).unwrap().split(']').next().unwrap();
                writeln!(out, "--- {name}\n  directives=[{}]", directives_of(text, comments)).unwrap();
            }
        }
        _ => {}
    }
}
