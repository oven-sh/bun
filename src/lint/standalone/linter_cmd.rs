//! `bun-lint linter ..`
//!
//! - `verify <cases.json>`: ESLint's `Linter.verify` for each `{ code, filename, config, options }`.
//!   Prints an array of `{ messages, suppressedMessages }`.
//! - `comment-parser <cases.json>`: `ConfigCommentParser` for each `{ method, text }`.
//! - `json-parse <cases.json>`: `JSON.parse` for each string.
//! - `globals <cases.json>`: for each `{ code, filename, languageOptions, names }`, what `File::global` says about each name.
//! - `environments`: the tables of the `globals` package.
//! - `minimatch <cases.json>`: for each `{ pattern, path, flipNegate }`, whether it matches.
//! - `config <cases.json>`: for each `{ basePath, config, flavor, files, directories }`, the configuration of each file, and
//!   whether each directory is ignored.
//! - `validate <cases.json>`: for each `{ rule, options }`, the message of ESLint if the options are invalid.
//! - `parse-fixtures <fixtures>`: the test cases that the parser rejects, all of which ESLint parses.
//! - `rules`: the names of the rules that exist.
//! - `conformance <fixtures> [--rule=r] [--verbose]`: the test cases of ESLint and typescript-eslint, each linted as its
//!   `languageOptions`, its `settings` and the comments in its code say.

use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::language::{Global, LanguageOptions, SourceType};
use bun_lint::linter::{
    Config, FileConfig, LintMessage, LintOptions, Linter, RcFlavor, Registry, ResolvedConfig, RuleId, Utf16Offsets, severity_of,
    testing,
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
        if i > 0 {
            out.extend_from_slice(b",\n");
        }
        if let Some(error) = &config.error {
            testing::write_json(&mut out, &Json::Object(vec![(b"error".to_vec(), Json::String(error.clone()))]));
            continue;
        }
        let result = with_file(&filename, code, &config.language, |file| linter().lint(file, &config, &options));
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

fn setting_name(setting: Global) -> Json {
    Json::String(match setting {
        Global::Readonly => b"readonly".to_vec(),
        Global::Writable => b"writable".to_vec(),
        Global::Off => b"off".to_vec(),
    })
}

fn globals(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        let null = Json::Null;
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let filename = case.get(b"filename").and_then(Json::as_str).map(text).unwrap_or_default();
        let language = LanguageOptions::from_json(case.get(b"languageOptions").unwrap_or(&null), &null);
        with_file(&filename, code, &language, |file| {
            let names = case.get(b"names").and_then(Json::as_array).unwrap_or_default().iter().filter_map(Json::as_str);
            let described = names.map(|name| match file.global(name) {
                None => Json::Null,
                Some(global) => Json::Object(vec![
                    (b"writeable".to_vec(), Json::Bool(global.is_writable)),
                    (b"implicit".to_vec(), global.implicit_setting.map_or(Json::Null, setting_name)),
                    (b"comments".to_vec(), Json::Array(global.comments.iter().map(|it| Json::Number(f64::from(it.start))).collect())),
                    (b"names".to_vec(), {
                        let spans = global.comments.iter().map(|it| file.name_in_global_comment(*it, name));
                        Json::Array(spans.map(|it| Json::Array(vec![Json::Number(f64::from(it.start)), Json::Number(f64::from(it.end))])).collect())
                    }),
                    (b"isType".to_vec(), Json::Bool(global.is_type)),
                    (b"isValue".to_vec(), Json::Bool(global.is_value)),
                ]),
            });
            Json::Array(described.collect())
        })
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn environments() {
    let tables = bun_lint::linter::globals::environments().map(|name| {
        let variables = bun_lint::linter::globals::environment(name.as_bytes()).into_iter().flatten();
        let variables = variables.map(|(name, setting)| (name.to_vec(), Json::Bool(setting == Global::Writable)));
        (name.as_bytes().to_vec(), Json::Object(variables.collect()))
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Object(tables.collect()));
    out.push(b'\n');
    print(&out);
}

fn minimatch(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        let part = |key: &[u8]| case.get(key).and_then(Json::as_str).unwrap_or_default();
        let flip_negate = case.get(b"flipNegate").and_then(Json::as_bool) == Some(true);
        Json::Bool(bun_lint::linter::config::testing::minimatch(part(b"pattern"), part(b"path"), flip_negate))
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn describe(config: &ResolvedConfig) -> Vec<(Vec<u8>, Json)> {
    let number = |severity: Severity| Json::Number(f64::from(severity as u8));
    let rules = config.rules.iter().map(|rule| {
        let mut value = vec![number(rule.severity)];
        value.extend(rule.options.iter().cloned());
        Json::Array(vec![Json::String(RuleId::Known(rule.entry.meta).to_vec()), Json::Array(value)])
    });
    let language = &config.language;
    let globals = language.globals.iter().map(|(name, setting)| Json::Array(vec![Json::String(name.to_vec()), setting_name(*setting)]));
    vec![
        (b"rules".to_vec(), Json::Array(rules.collect())),
        (b"ecmaVersion".to_vec(), Json::Number(f64::from(language.ecma_version))),
        (
            b"sourceType".to_vec(),
            Json::String(match language.source_type {
                SourceType::Module => b"module".to_vec(),
                SourceType::Script => b"script".to_vec(),
                SourceType::CommonJs => b"commonjs".to_vec(),
            }),
        ),
        (b"globals".to_vec(), Json::Array(globals.collect())),
        (b"parserOptions".to_vec(), language.parser_options.clone()),
        (b"settings".to_vec(), language.settings.clone()),
        (b"noInlineConfig".to_vec(), Json::Bool(config.linter.no_inline_config)),
        (b"reportUnusedDisableDirectives".to_vec(), number(config.linter.report_unused_disable_directives)),
        (b"reportUnusedInlineConfigs".to_vec(), number(config.linter.report_unused_inline_configs)),
    ]
}

fn config(args: &[String]) {
    let cases = read_cases(args);
    let registry = linter().registry();
    let results = cases.iter().map(|case| {
        let null = Json::Null;
        let base_path = case.get(b"basePath").and_then(Json::as_str).unwrap_or(b"/");
        let json = case.get(b"config").unwrap_or(&null);
        let extended = case.get(b"extended");
        let mut load = |_: &[u8], name: &[u8]| extended.and_then(|it| it.get(name)).cloned();
        let config = match case.get(b"flavor").and_then(Json::as_str) {
            Some(b"oxlint") => Config::from_rc_json(registry, base_path, json, RcFlavor::Oxlint, &mut load),
            Some(b"eslintrc") => Config::from_rc_json(registry, base_path, json, RcFlavor::Eslint, &mut load),
            _ => Config::from_flat_json(registry, base_path, json),
        };
        let config = match config {
            Ok(config) => config,
            Err(error) => return Json::Object(vec![(b"error".to_vec(), Json::String(error.message))]),
        };
        let paths = |key: &[u8]| case.get(key).and_then(Json::as_array).unwrap_or_default().iter().filter_map(Json::as_str);
        let files = paths(b"files").map(|file| {
            let status = |name: &[u8]| (b"status".to_vec(), Json::String(name.to_vec()));
            Json::Object(match config.get(registry, file) {
                FileConfig::External => vec![status(b"external")],
                FileConfig::Ignored => vec![status(b"ignored")],
                FileConfig::Unconfigured => vec![status(b"unconfigured")],
                FileConfig::Matched(resolved) => std::iter::once(status(b"matched")).chain(describe(&resolved)).collect(),
            })
        });
        let strings = |all: &[Box<[u8]>]| Json::Array(all.iter().map(|it| Json::String(it.to_vec())).collect());
        let mut out = vec![
            (b"files".to_vec(), Json::Array(files.collect())),
            (b"directories".to_vec(), Json::Array(paths(b"directories").map(|it| Json::Bool(config.is_directory_ignored(it))).collect())),
        ];
        if case.get(b"flavor").is_some() {
            out.push((b"unknownRules".to_vec(), strings(config.unknown_rules())));
            out.push((b"notes".to_vec(), Json::Array(config.notes().iter().map(|it| Json::String(it.clone())).collect())));
        }
        Json::Object(out)
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn validate(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        let id = case.get(b"rule").and_then(Json::as_str).unwrap_or_default();
        let options = case.get(b"options").and_then(Json::as_array).unwrap_or_default();
        match testing::validate_by_id(id, options) {
            Ok(()) => Json::Null,
            Err(lines) => Json::String([b"Key \"rules\": Key \"", id, b"\":\n", &lines].concat()),
        }
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn parse_fixtures(args: &[String]) {
    let root = args.first().expect("the fixtures directory");
    let (mut parsed, mut rejected) = (0, 0);
    for directory in ["eslint", "typescript-eslint"] {
        let mut paths: Vec<_> = std::fs::read_dir(format!("{root}/{directory}")).expect("the fixtures").flatten().map(|it| it.path()).collect();
        paths.sort();
        for path in paths {
            let Some(fixture) = std::fs::read(&path).ok().and_then(|it| bun_lint::json::parse(&it)) else {
                continue;
            };
            for (index, case) in fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default().iter().enumerate() {
                if !matches!(case.get(b"skip"), None | Some(Json::Null)) {
                    continue;
                }
                let null = Json::Null;
                let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
                let filename = case.get(b"filename").and_then(Json::as_str).map(text).unwrap_or_default();
                let given = case.get(b"languageOptions").unwrap_or(&null);
                let config = ResolvedConfig {
                    language: LanguageOptions::from_json(given, &null),
                    ..ResolvedConfig::default()
                };
                let messages = with_file(&filename, code, &config.language, |file| linter().lint(file, &config, &LintOptions::default()).messages);
                match messages.first().filter(|it| it.is_fatal && it.message.starts_with(b"Parsing error")) {
                    None => parsed += 1,
                    Some(error) => {
                        rejected += 1;
                        let mut written = Vec::new();
                        testing::write_json(&mut written, given);
                        let name = path.file_stem().unwrap_or_default().to_string_lossy();
                        println!("{}\t{directory}/{name}#{index}\t{}\t{:?}", text(&error.message), text(&written), text(code));
                    }
                }
            }
        }
    }
    println!("{parsed} parsed, {rejected} rejected");
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
        Some("globals") => globals(&args[1..]),
        Some("environments") => environments(),
        Some("minimatch") => minimatch(&args[1..]),
        Some("validate") => validate(&args[1..]),
        Some("parse-fixtures") => parse_fixtures(&args[1..]),
        Some("config") => config(&args[1..]),
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
