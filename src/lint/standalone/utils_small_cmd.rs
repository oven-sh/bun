//! `bun-lint utils-small ..`
//!
//! - `call <file>`: runs the helpers of `bun_lint::utils` that take text on the lines of `<file>`,
//!   and prints one line of results for each. A line is the name of a helper and its arguments in
//!   hexadecimal, separated by tabs. `test/cli/lint/oracle/utils-small/compare.ts` writes the file
//!   and compares.
//! - `fix-tracker <cases.jsonl>`: for each line `{ path, code }`, a line
//!   `[[method, node.start, node.end, fix.start, fix.end, fix.text], ..]` with what a `FixTracker`
//!   makes for every statement, expression and function. `null` if the code does not parse. See
//!   `test/cli/lint/oracle/utils-small/fix-tracker.ts`.

use bun_lint::context::Severity;
use bun_lint::prelude::*;
use bun_lint::runner::{Enabled, RuleEntry};
use bun_lint::utils::char_source::{CharInfo, parse_string_literal, parse_template_token};
use bun_lint::utils::estree_compat::estree_span;
use bun_lint::utils::fix_tracker::FixTracker;
use bun_lint::utils::regular_expressions::{UnicodeFlag, is_valid_with_unicode_flag};
use bun_lint::utils::{ast_utils, directives, keywords, naming, string_utils, unicode};
use std::fmt::Write as _;
use std::io::Write as _;

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

fn units(all: &[CharInfo]) -> String {
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

struct Probe;

const ENCLOSING: Message = Message::new("retainEnclosingFunction", "");
const SURROUNDING: Message = Message::new("retainSurroundingTokens", "");

impl Rule for Probe {
    const META: Meta = Meta::eslint("probe", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Probe
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.enter(NodeTags::ALL, |_, node, cx| {
            if !matches!(node, Node::Stmt(_) | Node::Expr(_) | Node::Func(_)) {
                return;
            }
            let span = estree_span(node);
            cx.report(span, ENCLOSING).fix(|fixer| {
                FixTracker::new(fixer)
                    .retain_enclosing_function(node)
                    .remove(span)
            });
            cx.report(span, SURROUNDING).fix(|fixer| {
                FixTracker::new(fixer)
                    .retain_surrounding_tokens(span)
                    .replace_text_range(span, "X")
            });
        });
    }
}

fn fix_tracker(cases: &[u8]) {
    let rule = (RuleEntry::of::<Probe>().build)(&Options::new(&[]));
    let rules = [Enabled {
        rule: &*rule,
        severity: Severity::Error,
    }];
    let mut out = Vec::new();
    for line in cases.split(|&b| b == b'\n').filter(|line| !line.is_empty()) {
        let case = bun_lint::json::parse(line).expect("a case");
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = case.get(b"path").and_then(Json::as_str).unwrap_or_default();
        let path = String::from_utf8_lossy(path);
        let all = crate::with_file(&path, code, &LanguageOptions::default(), |file| {
            if file.has_parse_errors() {
                return Json::Null;
            }
            let number = |n: u32| Json::Number(n.into());
            let each = bun_lint::runner::run(file, &rules, true)
                .into_iter()
                .filter_map(|it| {
                    let fix = it.fix?;
                    Some(Json::Array(vec![
                        Json::String(it.message_id.as_bytes().into()),
                        number(it.span.start),
                        number(it.span.end),
                        number(fix.span.start),
                        number(fix.span.end),
                        Json::String(fix.text.into()),
                    ]))
                });
            Json::Array(each.collect())
        });
        all.stringify(&mut out);
        out.push(b'\n');
    }
    _ = std::io::stdout().write_all(&out);
}

pub(crate) fn run(args: &[String]) {
    let input = args.get(1).and_then(|path| std::fs::read(path).ok());
    match (args.first().map(String::as_str), input) {
        (Some("call"), Some(input)) => call(&String::from_utf8_lossy(&input)),
        (Some("fix-tracker"), Some(input)) => fix_tracker(&input),
        _ => {
            eprintln!("usage: bun-lint utils-small call|fix-tracker <file>");
            std::process::exit(2);
        }
    }
}

fn call(input: &str) {
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
            "shebangPattern" => ast_utils::match_shebang(&a).map_or_else(|| "null".to_owned(), hex),
            "parseStringLiteral" => units(&parse_string_literal(&a)),
            "parseTemplateToken" => units(&parse_template_token(&a)),
            "normalizePackageName" => hex(&naming::normalize_package_name(&a, &b)),
            "getShorthandName" => hex(&naming::get_shorthand_name(&a, &b)),
            "getNamespaceFromTerm" => hex(naming::get_namespace_from_term(&a)),
            "directivesPattern" => directives::match_directives_pattern(&a)
                .unwrap_or("null")
                .to_owned(),
            "keywords" => keywords::is_keyword(&a).to_string(),
            "isValidWithUnicodeFlag" => {
                let (flag, version) = match b.split_first() {
                    Some((b'v', version)) => (UnicodeFlag::V, version),
                    Some((_, version)) => (UnicodeFlag::U, version),
                    None => (UnicodeFlag::U, &[][..]),
                };
                let version = String::from_utf8_lossy(version).parse().unwrap_or(0);
                is_valid_with_unicode_flag(version, &a, flag).to_string()
            }
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
