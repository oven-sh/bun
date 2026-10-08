//! `bun-lint utils-small <file>`: runs the small helpers of `bun_lint::utils` on the lines of
//! `<file>` and prints one line of results for each. A line is the name of a helper and its
//! arguments in hexadecimal, separated by tabs. `test/cli/lint/oracle/utils-small/compare.ts`
//! writes the file and compares.

use bun_lint::utils::char_source::{CharInfo, parse_string_literal, parse_template_token};
use bun_lint::utils::{ast_utils, directives, keywords, naming, string_utils, unicode};
use std::fmt::Write as _;

fn unhex(text: &str) -> Vec<u8> {
    let digit = |c: u8| (c as char).to_digit(16).unwrap_or(0) as u8;
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| digit(pair[0]) << 4 | digit(pair[1]))
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        _ = write!(out, "{byte:02x}");
        out
    })
}

fn units(all: Vec<CharInfo>) -> String {
    let each = all
        .iter()
        .map(|it| format!("{:x}:{}:{}", it.code_unit, it.start, it.end));
    each.collect::<Vec<_>>().join(" ")
}

/// The code points that `is` holds for, as `first-last` in hexadecimal.
fn members(is: impl Fn(u32) -> bool) -> String {
    let mut out = String::new();
    let mut start = None;
    for c in 0..=0x110000 {
        match (start, c <= 0x10FFFF && is(c)) {
            (None, true) => start = Some(c),
            (Some(first), false) => {
                _ = write!(out, "{first:x}-{:x} ", c - 1);
                start = None;
            }
            _ => {}
        }
    }
    out
}

pub(crate) fn run(args: &[String]) {
    let Some(input) = args
        .first()
        .and_then(|path| std::fs::read_to_string(path).ok())
    else {
        eprintln!("usage: bun-lint utils-small <file>");
        std::process::exit(2);
    };
    let mut out = String::new();
    for line in input.lines() {
        let mut fields = line.split('\t');
        let name = fields.next().unwrap_or_default();
        let a = unhex(fields.next().unwrap_or_default());
        let b = unhex(fields.next().unwrap_or_default());
        let ranges = |all: &mut dyn Iterator<Item = std::ops::Range<usize>>| {
            all.map(|it| format!("{}:{}", it.start, it.end))
                .collect::<Vec<_>>()
                .join(" ")
        };
        let result = match name {
            "graphemes" => {
                let lengths = string_utils::graphemes(&a).map(|it| it.len().to_string());
                lengths.collect::<Vec<_>>().join(" ")
            }
            "getGraphemeCount" => string_utils::get_grapheme_count(&a).to_string(),
            "upperCaseFirst" => hex(&string_utils::upper_case_first(&a)),
            "containsLetter" => string_utils::contains_letter(&a).to_string(),
            "LETTER_PATTERN" => ranges(&mut string_utils::find_letter(&a).into_iter()),
            "createGlobalLinebreakMatcher" => {
                let all = ast_utils::create_global_linebreak_matcher(&a);
                ranges(&mut all.map(|(at, len)| at..at + len))
            }
            "shebangPattern" => ast_utils::match_shebang(&a).map_or("null".into(), hex),
            "parseStringLiteral" => units(parse_string_literal(&a)),
            "parseTemplateToken" => units(parse_template_token(&a)),
            "normalizePackageName" => hex(&naming::normalize_package_name(&a, &b)),
            "getShorthandName" => hex(&naming::get_shorthand_name(&a, &b)),
            "getNamespaceFromTerm" => hex(naming::get_namespace_from_term(&a)),
            "directivesPattern" => directives::match_directives_pattern(&a)
                .unwrap_or("null")
                .to_owned(),
            "keywords" => keywords::is_keyword(&a).to_string(),
            "allKeywords" => keywords::KEYWORDS.join(" "),
            "isCombiningCharacter" => members(unicode::is_combining_character),
            "isEmojiModifier" => members(unicode::is_emoji_modifier),
            "isRegionalIndicatorSymbol" => members(unicode::is_regional_indicator_symbol),
            "isLetter" => members(string_utils::is_letter),
            _ => "?".to_owned(),
        };
        out.push_str(&result);
        out.push('\n');
    }
    print!("{out}");
}
