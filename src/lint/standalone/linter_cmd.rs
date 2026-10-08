//! `bun-lint linter ..`
//!
//! - `verify <cases.json>`: ESLint's `Linter.verify` for each `{ code, filename, config, options }`.
//!   Prints an array of `{ messages, suppressedMessages }`.
//! - `comment-parser <cases.json>`: `ConfigCommentParser` for each `{ method, text }`.
//! - `json-parse <cases.json>`: `JSON.parse` for each string.
//! - `rules`: the names of the rules that exist.
//! - `conformance <fixtures> [--rule=r] [--verbose]`: the test cases of ESLint and typescript-eslint, each linted as its
//!   `languageOptions`, its `settings` and the comments in its code say.

use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::linter::{
    LintMessage, LintOptions, Linter, Registry, ResolvedConfig, RuleId, Utf16Offsets, severity_of, testing,
};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, bind};
use bun_sema::session::Session;
use std::sync::OnceLock;

pub(crate) fn linter() -> &'static Linter {
    static LINTER: OnceLock<Linter> = OnceLock::new();
    LINTER.get_or_init(|| Linter::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES])))
}

/// Parses `code` as `language` says, binds it, without types, and calls `then` with the file.
pub(crate) fn with_file<R>(
    path: &str,
    code: &[u8],
    language: &LanguageOptions,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let options = language.parse_options(path.as_bytes());
    let mut hir = bun_js_parser::sema::summarize(
        arena,
        path.as_bytes(),
        options.script_kind,
        code,
        &atoms,
        options.experimental_decorators,
        options.every_file_is_a_module,
    )
    .0;
    hir.text = code.to_vec().into();
    let bind_options = BindOptions {
        emit_standard_class_fields: true,
        before_es2020: false,
        before_es2017: false,
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    let file = File::new(path.as_bytes(), &hir, &bound, &atoms, language, None);
    then(&file)
}

/// What the linter reports for a test case of a rule.
pub(crate) struct CaseOutcome {
    pub(crate) messages: Vec<LintMessage>,
    /// The code after one pass of fixes. `None` if there is nothing to fix.
    pub(crate) output: Option<Vec<u8>>,
}

/// Lints `code` as the `RuleTester` of the plugin of the rule does: with only that rule enabled, as
/// an error, and with everything that comments in the code do.
pub(crate) fn lint_case(
    entry: &'static RuleEntry,
    code: &[u8],
    filename: &str,
    options: &[Json],
    language_options: &Json,
    settings: &Json,
) -> CaseOutcome {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(options);
    let id = RuleId::Known(entry.meta).to_vec();
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
        (b"rules".to_vec(), Json::Object(vec![(id, Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    // The `RuleTester` of typescript-eslint sets it, that of ESLint does not.
    config.linter.report_unused_disable_directives = match entry.meta.plugin {
        Plugin::TypeScript => Severity::Warn,
        Plugin::Eslint => Severity::Off,
    };
    with_file(filename, code, &config.language, |file| {
        let messages = linter().lint(file, &config, &LintOptions::default()).messages;
        let mut fixes: Vec<_> = messages.iter().filter_map(|it| it.fix.as_ref()).collect();
        let output = bun_lint::fix::apply_fixes(code, &mut fixes);
        CaseOutcome { messages, output }
    })
}

fn read_cases(args: &[String]) -> Vec<Json> {
    let path = args.first().expect("a file of cases");
    let text = std::fs::read(path).expect("the file of cases");
    match bun_lint::json::parse(&text) {
        Some(Json::Array(cases)) => cases,
        _ => panic!("the file of cases is not an array"),
    }
}

fn print(out: &[u8]) {
    use std::io::Write;
    let _ = std::io::stdout().write_all(out);
}

fn write_messages(out: &mut Vec<u8>, messages: &[LintMessage], code: &[u8]) {
    let mut offsets = Utf16Offsets::new(code);
    out.push(b'[');
    for (i, message) in messages.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        message.write_json(out, &mut offsets);
    }
    out.push(b']');
}

fn verify(args: &[String]) {
    let mut out = vec![b'['];
    for (i, case) in read_cases(args).iter().enumerate() {
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let filename = case.get(b"filename").and_then(Json::as_str).unwrap_or(b"file.js");
        let filename = String::from_utf8_lossy(filename).into_owned();
        let null = Json::Null;
        let mut unknown = Vec::new();
        let config = ResolvedConfig::from_json(linter().registry(), case.get(b"config").unwrap_or(&null), &mut unknown);
        let given = case.get(b"options").unwrap_or(&null);
        let only_errors = |_: &RuleId, severity: Severity| severity == Severity::Error;
        let options = LintOptions {
            allow_inline_config: given.get(b"allowInlineConfig").and_then(Json::as_bool) != Some(false),
            report_unused_disable_directives: match given.get(b"reportUnusedDisableDirectives") {
                Some(Json::Bool(value)) => Some(if *value { Severity::Error } else { Severity::Off }),
                Some(value) => severity_of(value),
                None => None,
            },
            wants_fixes: given.get(b"disableFixes").and_then(Json::as_bool) != Some(true),
            rule_filter: match given.get(b"quiet").and_then(Json::as_bool) {
                Some(true) => Some(&only_errors),
                _ => None,
            },
        };
        let result = with_file(&filename, code, &config.language, |file| linter().lint(file, &config, &options));
        if i > 0 {
            out.extend_from_slice(b",\n");
        }
        out.extend_from_slice(b"{\"messages\":");
        write_messages(&mut out, &result.messages, code);
        out.extend_from_slice(b",\"suppressedMessages\":");
        write_messages(&mut out, &result.suppressed, code);
        out.push(b'}');
    }
    out.extend_from_slice(b"]\n");
    print(&out);
}

fn comment_parser(args: &[String]) {
    let string = |text: &[u8]| Json::String(text.to_vec());
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        let text = case.get(b"text").and_then(Json::as_str).unwrap_or_default();
        match case.get(b"method").and_then(Json::as_str).unwrap_or_default() {
            b"parseDirective" => match testing::parse_directive(text) {
                None => Json::Null,
                Some(it) => Json::Object(vec![
                    (b"label".to_vec(), string(it.label)),
                    (b"value".to_vec(), string(it.value)),
                    (b"justification".to_vec(), string(it.justification)),
                ]),
            },
            b"parseListConfig" => Json::Array(testing::parse_list_config(text).into_iter().map(string).collect()),
            b"parseStringConfig" => {
                let items = testing::parse_string_config(text).into_iter();
                Json::Array(items.map(|(key, value)| Json::Array(vec![Json::String(key), value.map_or(Json::Null, Json::String)])).collect())
            }
            _ => match testing::parse_json_like_config(text) {
                Ok(config) => Json::Object(vec![(b"ok".to_vec(), Json::Bool(true)), (b"config".to_vec(), Json::Object(config))]),
                Err(message) => Json::Object(vec![(b"ok".to_vec(), Json::Bool(false)), (b"message".to_vec(), Json::String(message))]),
            },
        }
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn json_parse(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| match testing::json_parse(case.as_str().unwrap_or_default()) {
        Ok(value) => Json::Object(vec![(b"value".to_vec(), value)]),
        Err(message) => Json::Object(vec![(b"error".to_vec(), Json::String(message))]),
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

/// A message as a fixture has it, for comparing.
#[derive(PartialEq, Eq, Debug)]
struct Reported {
    /// `None`: the rule that is tested. Empty: the linter itself.
    rule_id: Option<String>,
    message_id: String,
    message: String,
    start: (u32, u32),
    end: Option<(u32, u32)>,
    /// The code after each suggestion.
    suggestions: Vec<(String, String)>,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn reported(message: &LintMessage, entry: &RuleEntry, code: &[u8]) -> Reported {
    let apply = |fix: &bun_lint::fix::Fix| bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec());
    Reported {
        rule_id: match &message.rule_id {
            Some(id) if *id == RuleId::Known(entry.meta) => None,
            Some(id) => Some(text(&id.to_vec())),
            None => Some(String::new()),
        },
        message_id: message.message_id.unwrap_or_default().to_owned(),
        message: text(&message.message),
        start: (message.line, message.column),
        end: message.end,
        suggestions: (message.suggestions.iter()).map(|it| (it.message_id.to_owned(), text(&apply(&it.fix)))).collect(),
    }
}

fn expected(message: &Json) -> Reported {
    let string = |json: &Json, key: &str| json.get(key.as_bytes()).and_then(Json::as_str).map(text).unwrap_or_default();
    let number = |key: &str| match message.get(key.as_bytes()) {
        Some(Json::Number(n)) => Some(*n as u32),
        _ => None,
    };
    Reported {
        rule_id: message.get(b"ruleId").map(|id| id.as_str().map(text).unwrap_or_default()),
        message_id: string(message, "messageId"),
        message: string(message, "message"),
        start: (number("line").unwrap_or(0), number("column").unwrap_or(0)),
        end: number("endLine").zip(number("endColumn")),
        suggestions: (message.get(b"suggestions").and_then(Json::as_array).unwrap_or_default().iter())
            .map(|it| (string(it, "messageId"), string(it, "output")))
            .collect(),
    }
}

fn conformance(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let root = args.iter().find(|a| !a.starts_with("--")).expect("the fixtures directory");
    let is_verbose = args.iter().any(|a| a == "--verbose");
    std::panic::set_hook(Box::new(|_| {}));
    let (mut passed, mut failed, mut rejected, mut skipped) = (0, 0, 0, 0);
    for entry in linter().registry().all() {
        let directory = match entry.meta.plugin {
            Plugin::Eslint => "eslint",
            Plugin::TypeScript => "typescript-eslint",
        };
        let name = entry.meta.name;
        if flag("--rule=").is_some_and(|only| only != name) {
            continue;
        }
        let Some(fixture) = std::fs::read(format!("{root}/{directory}/{name}.json")).ok().and_then(|it| bun_lint::json::parse(&it)) else {
            continue;
        };
        let before = (passed, failed, rejected);
        for (index, case) in fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default().iter().enumerate() {
            if !matches!(case.get(b"skip"), None | Some(Json::Null)) || case.get(b"typeAware").and_then(Json::as_bool) == Some(true) {
                skipped += 1;
                continue;
            }
            let null = Json::Null;
            let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
            let filename = case.get(b"filename").and_then(Json::as_str).map(text).unwrap_or_default();
            let options = case.get(b"options").and_then(Json::as_array).unwrap_or_default();
            let language = case.get(b"languageOptions").unwrap_or(&null);
            let settings = case.get(b"settings").unwrap_or(&null);
            let outcome = std::panic::catch_unwind(|| lint_case(entry, code, &filename, options, language, settings));
            let wanted: Vec<_> = case.get(b"messages").and_then(Json::as_array).unwrap_or_default().iter().map(expected).collect();
            let problem = match &outcome {
                Err(_) => "panicked".to_owned(),
                Ok(outcome) if outcome.messages.iter().any(|it| it.is_fatal && it.message.starts_with(b"Parsing error")) => {
                    rejected += 1;
                    let mut written = Vec::new();
                    testing::write_json(&mut written, language);
                    println!("REJECTED {directory}/{name}#{index} {} {} {:?}", text(&outcome.messages[0].message), text(&written), text(code));
                    continue;
                }
                Ok(outcome) => {
                    let actual: Vec<_> = outcome.messages.iter().map(|it| reported(it, entry, code)).collect();
                    if actual == wanted && outcome.output.as_deref() == case.get(b"output").and_then(Json::as_str) {
                        passed += 1;
                        continue;
                    }
                    format!("expected: {wanted:#?}\nactual: {actual:#?}\noutput: {:?}", outcome.output.as_deref().map(text))
                }
            };
            failed += 1;
            if is_verbose {
                println!("──── {directory}/{name}#{index} {filename}\n{}\n{problem}\n", text(code));
            }
        }
        println!("{directory}/{name}: {} passed, {} failed, {} rejected by the parser", passed - before.0, failed - before.1, rejected - before.2);
    }
    println!("{passed} passed, {failed} failed, {rejected} rejected by the parser, {skipped} skipped");
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("verify") => verify(&args[1..]),
        Some("comment-parser") => comment_parser(&args[1..]),
        Some("json-parse") => json_parse(&args[1..]),
        Some("conformance") => conformance(&args[1..]),
        Some("rules") => {
            let ids = linter().registry().all().iter().map(|it| Json::String(RuleId::Known(it.meta).to_vec()));
            let mut out = Vec::new();
            testing::write_json(&mut out, &Json::Array(ids.collect()));
            out.push(b'\n');
            print(&out);
        }
        _ => println!("usage: bun-lint linter verify|comment-parser|json-parse <cases.json>"),
    }
}
