//! `bun-lint glob <cases.json>`: `src/glob` on an array of cases. Prints the array of the answers. `-`: the cases are read from
//! the standard input.
//!
//! | Case | Answer |
//! |---|---|
//! | `{ mode: "bun" \| "oxc" \| "minimatch" \| "minimatch-nodot" \| "micromatch" \| "micromatch-nodot" \| "fast-glob", pattern, path, flipNegate?, partial? }` | `true`, `false` |
//! | the same with `ask: "heads"` | an array, `null` |
//! | `{ mode: "git" \| "globset" \| "npm5" \| "npm705" \| "npm7012", lines or text, ignoreCase?, path, directory?, ask: "verdict" \| "parents" }` | `"ignored"`, `"kept"`, `"none"` |
//! | the same with `ask: "ignores" \| "inside"` | `true`, `false` |
//! | the same with `ask: "refused"` | an array of `{ line, why }` |
//! | `{ mode: "is-glob", text }` | `true`, `false` |
//! | `{ mode: "glob-parent", text }` | a string |
//! | `{ mode: "braces", text }` | an array, `null` beyond the limit |
//! | `{ mode: "unclosed", text }` | `null`, `{ kind: "class" \| "braces" \| "backslash", at }` |
//!
//! A pattern, a path, a line or a text that is not UTF-8 is `{ hex: ".." }`.

use crate::host::{self, output_line};
use bun_glob::ignore::{IgnoreOptions, IgnoreRules, IgnoreSyntax, Verdict};
use bun_glob::pattern::{UnclosedKind, unclosed};
use bun_glob::{How, Options, Pattern, scan};
use bun_lint::linter::testing;
use bun_lint::options::Json;

fn bytes_of(value: Option<&Json>) -> Vec<u8> {
    let hex = match value {
        Some(Json::String(text)) => return text.clone(),
        Some(object) => object.get(b"hex").and_then(Json::as_str),
        None => None,
    };
    let byte = |pair: &[u8; 2]| u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok();
    let (pairs, _) = hex.unwrap_or_default().as_chunks::<2>();
    pairs.iter().filter_map(byte).collect()
}

fn string(text: &[u8]) -> Json {
    Json::String(text.to_vec())
}

fn options_of(mode: &[u8]) -> Option<Options> {
    Some(match mode {
        b"bun" => Options::BUN,
        b"minimatch" => Options::MINIMATCH_DOT,
        b"minimatch-nodot" => Options::MINIMATCH,
        b"minimatch3-makere" => Options::MINIMATCH_3_MAKE_RE,
        b"minimatch3-makere-dot" => Options {
            dot: true,
            ..Options::MINIMATCH_3_MAKE_RE
        },
        b"micromatch" => Options::MICROMATCH_DOT,
        b"micromatch-nodot" => Options {
            dot: false,
            ..Options::MICROMATCH_DOT
        },
        b"fast-glob" => Options::FAST_GLOB_DOT,
        _ => return None,
    })
}

fn syntax_of(mode: &[u8]) -> Option<IgnoreSyntax> {
    Some(match mode {
        b"git" => IgnoreSyntax::Git,
        b"globset" => IgnoreSyntax::Globset,
        b"npm5" => IgnoreSyntax::Npm5,
        b"npm705" => IgnoreSyntax::Npm705,
        b"npm7012" => IgnoreSyntax::Npm7012,
        _ => return None,
    })
}

/// What has been read is kept, as a caller keeps it: what it was read from, and what it is.
#[derive(Default)]
struct Kept {
    pattern: Option<(Vec<u8>, Pattern)>,
    rules: Option<(Vec<u8>, IgnoreRules)>,
}

fn kept<T>(slot: &mut Option<(Vec<u8>, T)>, key: Vec<u8>, read: impl FnOnce() -> T) -> &T {
    if slot.as_ref().is_none_or(|it| it.0 != key) {
        *slot = None;
    }
    &slot.get_or_insert_with(|| (key, read())).1
}

/// `mode` and these parts of the case, as text.
fn key_of(mode: &[u8], parts: &[Option<&Json>]) -> Vec<u8> {
    let mut key = mode.to_vec();
    for part in parts {
        key.push(0);
        testing::write_json(&mut key, part.unwrap_or(&Json::Null));
    }
    key
}

fn answer(case: &Json, memory: &mut Kept) -> Json {
    let mode = case.get(b"mode").and_then(Json::as_str).unwrap_or_default();
    let ask = case.get(b"ask").and_then(Json::as_str).unwrap_or_default();
    let is_set = |key: &[u8]| case.get(key).and_then(Json::as_bool) == Some(true);
    let path = bytes_of(case.get(b"path"));
    let text = bytes_of(case.get(b"text"));
    if mode == b"oxc" || options_of(mode).is_some() {
        let written = case.get(b"pattern");
        let pattern = kept(
            &mut memory.pattern,
            key_of(mode, &[written]),
            || match options_of(mode) {
                Some(options) => Pattern::new(&bytes_of(written), options),
                None => Pattern::of_oxc_glob_set(&bytes_of(written)),
            },
        );
        if ask == b"heads" {
            let heads = |all: Vec<&[u8]>| Json::Array(all.into_iter().map(string).collect());
            return pattern.heads().map_or(Json::Null, heads);
        }
        let how = How {
            flip_negate: is_set(b"flipNegate"),
            partial: is_set(b"partial"),
        };
        return Json::Bool(pattern.matches_with(&path, how));
    }
    if let Some(syntax) = syntax_of(mode) {
        let options = IgnoreOptions {
            syntax,
            ignores_case: is_set(b"ignoreCase"),
        };
        let (lines, case_option) = (case.get(b"lines"), case.get(b"ignoreCase"));
        let key = key_of(mode, &[case_option, lines, case.get(b"text")]);
        let rules = kept(&mut memory.rules, key, || {
            match lines.and_then(Json::as_array) {
                Some(lines) => {
                    let lines: Vec<Vec<u8>> = lines.iter().map(|it| bytes_of(Some(it))).collect();
                    IgnoreRules::from_lines(lines.iter().map(|it| &it[..]), options)
                }
                None => IgnoreRules::from_text(&text, options),
            }
        });
        let verdict = |it: Verdict| {
            string(match it {
                Verdict::Unmentioned => b"none",
                Verdict::Ignored => b"ignored",
                Verdict::Kept => b"kept",
            })
        };
        let is_directory = is_set(b"directory");
        return match ask {
            b"verdict" => verdict(rules.verdict(&path, is_directory)),
            b"parents" => verdict(rules.verdict_or_of_parents(&path, is_directory)),
            b"ignores" => Json::Bool(rules.ignores(&path)),
            b"inside" => Json::Bool(rules.may_keep_inside(&path)),
            b"refused" => {
                let refused = rules.refused().iter().map(|it| {
                    Json::Object(vec![
                        (b"line".to_vec(), string(&it.line)),
                        (b"why".to_vec(), string(&it.why)),
                    ])
                });
                Json::Array(refused.collect())
            }
            _ => Json::Null,
        };
    }
    match mode {
        b"is-glob" => Json::Bool(scan::is_glob(&text)),
        b"glob-parent" => Json::String(scan::glob_parent(&text)),
        b"braces" => bun_glob::testing::expand_braces(&text).map_or(Json::Null, |expanded| {
            Json::Array(expanded.into_iter().map(Json::String).collect())
        }),
        b"unclosed" => unclosed(&text).map_or(Json::Null, |found| {
            let kind: &[u8] = match found.kind {
                UnclosedKind::Class => b"class",
                UnclosedKind::Braces => b"braces",
                UnclosedKind::Escape => b"backslash",
            };
            Json::Object(vec![
                (b"kind".to_vec(), string(kind)),
                (b"at".to_vec(), Json::Number(found.at as f64)),
            ])
        }),
        _ => Json::Null,
    }
}

pub(crate) fn run(args: &[String]) {
    let path = match args.first().map(String::as_str) {
        Some("-") => "/dev/stdin",
        Some(path) => path,
        None => return output_line!("usage: bun-lint glob <cases.json>"),
    };
    let text = host::read(path).expect("the file of cases");
    let Some(Json::Array(cases)) = bun_lint::json::parse(&text) else {
        panic!("the file of cases is not an array");
    };
    let mut memory = Kept::default();
    let answers = cases.iter().map(|case| answer(case, &mut memory));
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(answers.collect()));
    out.push(b'\n');
    {
        use std::io::Write;
        let _ = std::io::stdout().write_all(&out);
    }
}
