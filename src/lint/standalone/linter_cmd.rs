//! `bun-lint linter ..`
//!
//! - `verify <cases.json>`: ESLint's `Linter.verify` for each `{ code, filename, config, options }`.
//!   Prints an array of `{ messages, suppressedMessages }`.
//! - `comment-parser <cases.json>`: `ConfigCommentParser` for each `{ method, text }`.
//! - `json-parse <cases.json>`: `JSON.parse` for each string.
//! - `globals <cases.json>`: for each `{ code, filename, languageOptions, names }`, what `File::global` says about each name.
//! - `environments`: the tables of the `globals` package.
//! - `minimatch <cases.json>`: for each `{ pattern, path, flipNegate, partial }`, whether it matches.
//! - `config <cases.json>`: for each `{ basePath, config, flavor, files, directories }`, the configuration of each file, and
//!   whether each directory is ignored.
//! - `project <cases.json>`: for each `{ basePath, config, flavor, extended, sources: { path: code } }`, what is reported for
//!   each file with the configuration that it has.
//! - `resolve oxlint|eslintrc|flat <configuration.json> <directory>`: how many files of the directory are linted, with how many
//!   different configurations, and how long it takes to find that out.
//! - `bench <directory>`: how long it takes to find out that the files are not refused.
//! - `validate <cases.json>`: for each `{ rule, options }`, the message of ESLint if the options are invalid.
//! - `parse-fixtures <fixtures>`: the test cases that the parser rejects, all of which ESLint parses.
//! - `rules`: the names of the rules that exist.
//! - `diagnostics <cases.json>`: for each `{ code, filename }`, what the parser has left in the HIR.

use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::js_plugin::Host;
use bun_lint::language::{Global, LanguageOptions, Parser, SourceType};
use bun_lint::linter::{
    Config, FileConfig, LintMessage, LintOptions, Linter, RcFlavor, Registry, ResolvedConfig,
    RuleId, Utf16Offsets, severity_of, testing,
};
use bun_lint::options::Json;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::session::Session;
use std::sync::OnceLock;

pub(crate) fn linter() -> &'static Linter {
    static LINTER: OnceLock<Linter> = OnceLock::new();
    LINTER.get_or_init(|| {
        Linter::new(Registry::new(&[
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
            bun_lint_plugins::RULES,
        ]))
    })
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
    let mut hir = bun_js_parser::sema::summarize_as(
        options.dialect,
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
    let mut recycled = Recycled::of_this_thread();
    let bound = bind_for_lint_in(&hir, bind_options, &atoms, &mut recycled);
    let file = File::new(path.as_bytes(), &hir, bound, &atoms, language, None);
    then(&file)
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
        let filename = case
            .get(b"filename")
            .and_then(Json::as_str)
            .unwrap_or(b"file.js");
        let filename = String::from_utf8_lossy(filename).into_owned();
        let null = Json::Null;
        if i > 0 {
            out.extend_from_slice(b",\n");
        }
        // As the oracle configures ESLint: every file is linted, and the plugin is there.
        let base = br#"{ "files": ["**"], "plugins": { "@typescript-eslint": "@typescript-eslint/eslint-plugin" } }"#;
        let objects = Json::Array(vec![
            bun_lint::json::parse(base).unwrap_or(Json::Null),
            case.get(b"config").cloned().unwrap_or(Json::Null),
        ]);
        let path = format!("/{filename}");
        let config = Config::from_flat_json(linter().registry(), b"/", &objects)
            .map(|config| config.get(linter().registry(), path.as_bytes()));
        let config = match config {
            Ok(FileConfig::Matched(config)) => config,
            Ok(_) => {
                out.extend_from_slice(b"null");
                continue;
            }
            Err(error) => {
                let error = Json::Object(vec![(b"error".to_vec(), Json::String(error.message))]);
                testing::write_json(&mut out, &error);
                continue;
            }
        };
        let given = case.get(b"options").unwrap_or(&null);
        let only_errors = |_: &RuleId, severity: Severity| severity == Severity::Error;
        let options = LintOptions {
            allow_inline_config: given.get(b"allowInlineConfig").and_then(Json::as_bool)
                != Some(false),
            report_unused_disable_directives: match given.get(b"reportUnusedDisableDirectives") {
                Some(Json::Bool(value)) => Some(if *value {
                    Severity::Error
                } else {
                    Severity::Off
                }),
                Some(value) => severity_of(value),
                None => None,
            },
            wants_fixes: given.get(b"disableFixes").and_then(Json::as_bool) != Some(true),
            rule_filter: match given.get(b"quiet").and_then(Json::as_bool) {
                Some(true) => Some(&only_errors),
                _ => None,
            },
            ..LintOptions::default()
        };
        if let Some(error) = &config.error {
            testing::write_json(
                &mut out,
                &Json::Object(vec![(b"error".to_vec(), Json::String(error.clone()))]),
            );
            continue;
        }
        if given.get(b"fix").and_then(Json::as_bool) == Some(true) {
            let mut lint = |text: &[u8]| {
                with_file(&filename, text, &config.language, |file| {
                    linter().lint(file, &config, &options)
                })
            };
            let report = bun_lint::linter::verify_and_fix(code, &|_| true, &mut lint);
            if let Some(thrown) = report.result.thrown {
                let error = Json::Object(vec![(b"error".to_vec(), Json::String(thrown))]);
                testing::write_json(&mut out, &error);
                continue;
            }
            out.extend_from_slice(b"{\"fixed\":");
            out.extend_from_slice(if report.is_fixed { b"true" } else { b"false" });
            out.extend_from_slice(b",\"output\":");
            testing::write_json(&mut out, &Json::String(report.output.clone()));
            out.extend_from_slice(b",\"messages\":");
            write_messages(&mut out, &report.result.messages, &report.output);
            out.extend_from_slice(b",\"suppressedMessages\":");
            write_messages(&mut out, &report.result.suppressed, &report.output);
            out.push(b'}');
            continue;
        }
        let result = with_file(&filename, code, &config.language, |file| {
            linter().lint(file, &config, &options)
        });
        if let Some(thrown) = result.thrown {
            let error = Json::Object(vec![(b"error".to_vec(), Json::String(thrown))]);
            testing::write_json(&mut out, &error);
            continue;
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
        match case
            .get(b"method")
            .and_then(Json::as_str)
            .unwrap_or_default()
        {
            b"parseDirective" => match testing::parse_directive(text) {
                None => Json::Null,
                Some(it) => Json::Object(vec![
                    (b"label".to_vec(), string(it.label)),
                    (b"value".to_vec(), string(it.value)),
                    (b"justification".to_vec(), string(it.justification)),
                ]),
            },
            b"parseListConfig" => Json::Array(
                testing::parse_list_config(text)
                    .into_iter()
                    .map(string)
                    .collect(),
            ),
            b"parseStringConfig" => {
                let items = testing::parse_string_config(text).into_iter();
                Json::Array(
                    items
                        .map(|(key, value)| {
                            Json::Array(vec![
                                Json::String(key),
                                value.map_or(Json::Null, Json::String),
                            ])
                        })
                        .collect(),
                )
            }
            _ => match testing::parse_json_like_config(text) {
                Ok(config) => Json::Object(vec![
                    (b"ok".to_vec(), Json::Bool(true)),
                    (b"config".to_vec(), Json::Object(config)),
                ]),
                Err(message) => Json::Object(vec![
                    (b"ok".to_vec(), Json::Bool(false)),
                    (b"message".to_vec(), Json::String(message)),
                ]),
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
    let results =
        cases.iter().map(
            |case| match testing::json_parse(case.as_str().unwrap_or_default()) {
                Ok(value) => Json::Object(vec![(b"value".to_vec(), value)]),
                Err(message) => Json::Object(vec![(b"error".to_vec(), Json::String(message))]),
            },
        );
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
        let filename = case
            .get(b"filename")
            .and_then(Json::as_str)
            .map(text)
            .unwrap_or_default();
        let language =
            LanguageOptions::from_json(case.get(b"languageOptions").unwrap_or(&null), &null);
        with_file(&filename, code, &language, |file| {
            let names = case
                .get(b"names")
                .and_then(Json::as_array)
                .unwrap_or_default()
                .iter()
                .filter_map(Json::as_str);
            let described = names.map(|name| match file.global(name) {
                None => Json::Null,
                Some(global) => Json::Object(vec![
                    (b"writeable".to_vec(), Json::Bool(global.is_writable)),
                    (
                        b"implicit".to_vec(),
                        global.implicit_setting.map_or(Json::Null, setting_name),
                    ),
                    (
                        b"comments".to_vec(),
                        Json::Array(
                            global
                                .comments
                                .iter()
                                .map(|it| Json::Number(f64::from(it.start)))
                                .collect(),
                        ),
                    ),
                    (b"names".to_vec(), {
                        let spans = global
                            .comments
                            .iter()
                            .map(|it| file.name_in_global_comment(*it, name));
                        Json::Array(
                            spans
                                .map(|it| {
                                    Json::Array(vec![
                                        Json::Number(f64::from(it.start)),
                                        Json::Number(f64::from(it.end)),
                                    ])
                                })
                                .collect(),
                        )
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
        let variables = bun_lint::linter::globals::environment(name.as_bytes())
            .into_iter()
            .flatten();
        let variables = variables
            .map(|(name, setting)| (name.to_vec(), Json::Bool(setting == Global::Writable)));
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
        Json::Bool(bun_lint::linter::config::testing::minimatch(
            part(b"pattern"),
            part(b"path"),
            flip_negate,
            case.get(b"partial").and_then(Json::as_bool) == Some(true),
        ))
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
        Json::Array(vec![
            Json::String(RuleId::Known(rule.entry.meta).to_vec()),
            Json::Array(value),
        ])
    });
    let language = &config.language;
    let globals = language.globals.iter().map(|(name, setting)| {
        Json::Array(vec![Json::String(name.to_vec()), setting_name(*setting)])
    });
    vec![
        (b"rules".to_vec(), Json::Array(rules.collect())),
        (
            b"ecmaVersion".to_vec(),
            Json::Number(f64::from(language.ecma_version)),
        ),
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
        (
            b"language".to_vec(),
            config
                .language_name
                .as_ref()
                .map_or(Json::Null, |it| Json::String(it.to_vec())),
        ),
        (
            b"processor".to_vec(),
            config
                .processor
                .as_ref()
                .map_or(Json::Null, |it| Json::String(it.to_vec())),
        ),
        (
            b"noInlineConfig".to_vec(),
            Json::Bool(config.linter.no_inline_config),
        ),
        (
            b"reportUnusedDisableDirectives".to_vec(),
            number(config.linter.report_unused_disable_directives),
        ),
        (
            b"reportUnusedInlineConfigs".to_vec(),
            number(config.linter.report_unused_inline_configs),
        ),
    ]
}

/// The configuration of a case: `basePath`, `config`, `flavor`, and `extended`, which has the files that `extends` names.
/// `host`: loads what `jsPlugins` names, from the disk.
fn config_of(case: &Json, host: Option<&Host>) -> Result<Config, bun_lint::linter::ConfigError> {
    let null = Json::Null;
    let registry = linter().registry();
    let base_path = case.get(b"basePath").and_then(Json::as_str).unwrap_or(b"/");
    let json = case.get(b"config").unwrap_or(&null);
    let extended = case.get(b"extended");
    let mut load = |_: &[u8], name: &[u8]| extended.and_then(|it| it.get(name)).cloned();
    match case.get(b"flavor").and_then(Json::as_str) {
        Some(b"oxlint") => match host {
            Some(host) => Config::from_rc_json_with_plugins(
                registry,
                base_path,
                json,
                RcFlavor::Oxlint,
                &mut load,
                &mut |directory, specifier, alias| host.load(directory, specifier, alias),
            ),
            None => Config::from_rc_json(registry, base_path, json, RcFlavor::Oxlint, &mut load),
        },
        Some(b"eslintrc") => {
            Config::from_rc_json(registry, base_path, json, RcFlavor::Eslint, &mut load)
        }
        _ => Config::from_flat_json(registry, base_path, json),
    }
}

fn project(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        // `jsPlugins: true`: the case is on the disk, with its plugins.
        let base_path = case.get(b"basePath").and_then(Json::as_str).unwrap_or(b"/");
        let processes = crate::js_plugin_cmd::new_processes(1);
        let host = (case.get(b"jsPlugins").and_then(Json::as_bool) == Some(true))
            .then(|| Host::with_engine(&processes, base_path));
        let options = LintOptions {
            js_plugins: host.as_ref(),
            ..LintOptions::default()
        };
        // `detailed: true`: also the column and the text of each message.
        let is_detailed = case.get(b"detailed").and_then(Json::as_bool) == Some(true);
        let config = match config_of(case, host.as_ref()) {
            Ok(config) => config,
            Err(error) => {
                return Json::Object(vec![(b"error".to_vec(), Json::String(error.message))]);
            }
        };
        let sources = case
            .get(b"sources")
            .and_then(Json::as_object)
            .unwrap_or_default()
            .iter();
        let files = sources.map(|(path, code)| {
            let FileConfig::Matched(resolved) = config.get(linter().registry(), path) else {
                return (path.clone(), Json::Null);
            };
            let code = code.as_str().unwrap_or_default();
            if host.is_some()
                && let Some(error) = &resolved.error
            {
                let error = Json::String(error.clone());
                return (path.clone(), Json::Object(vec![(b"error".to_vec(), error)]));
            }
            let result = with_file(&text(path), code, &resolved.language, |file| {
                linter().lint(file, &resolved, &options)
            });
            if let Some(thrown) = result.thrown {
                let thrown = Json::String(thrown);
                return (
                    path.clone(),
                    Json::Object(vec![(b"thrown".to_vec(), thrown)]),
                );
            }
            let messages = result.messages.iter().map(|it| {
                let mut row = vec![
                    it.rule_id
                        .as_ref()
                        .map_or(Json::Null, |id| Json::String(id.to_vec())),
                    Json::Number(f64::from(it.severity as u8)),
                    Json::Number(f64::from(it.line)),
                ];
                if is_detailed {
                    row.push(Json::Number(f64::from(it.column)));
                    row.push(Json::String(it.message.clone()));
                }
                Json::Array(row)
            });
            (path.clone(), Json::Array(messages.collect()))
        });
        Json::Object(files.collect())
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn config(args: &[String]) {
    let cases = read_cases(args);
    let registry = linter().registry();
    let results = cases.iter().map(|case| {
        let config = match config_of(case, None) {
            Ok(config) => config,
            Err(error) => {
                return Json::Object(vec![(b"error".to_vec(), Json::String(error.message))]);
            }
        };
        let paths = |key: &[u8]| {
            case.get(key)
                .and_then(Json::as_array)
                .unwrap_or_default()
                .iter()
                .filter_map(Json::as_str)
        };
        let files = paths(b"files").map(|file| {
            let status = |name: &[u8]| (b"status".to_vec(), Json::String(name.to_vec()));
            Json::Object(match config.get(registry, file) {
                FileConfig::External => vec![status(b"external")],
                FileConfig::Ignored => vec![status(b"ignored")],
                FileConfig::Unconfigured => vec![status(b"unconfigured")],
                FileConfig::Matched(resolved) => std::iter::once(status(b"matched"))
                    .chain(describe(&resolved))
                    .collect(),
            })
        });
        let strings = |all: &[Box<[u8]>]| {
            Json::Array(all.iter().map(|it| Json::String(it.to_vec())).collect())
        };
        let mut out = vec![
            (b"files".to_vec(), Json::Array(files.collect())),
            (
                b"directories".to_vec(),
                Json::Array(
                    paths(b"directories")
                        .map(|it| Json::Bool(config.is_directory_ignored(it)))
                        .collect(),
                ),
            ),
        ];
        if case.get(b"flavor").is_some() {
            out.push((b"unknownRules".to_vec(), strings(config.unknown_rules())));
            out.push((
                b"notes".to_vec(),
                Json::Array(
                    config
                        .notes()
                        .iter()
                        .map(|it| Json::String(it.clone()))
                        .collect(),
                ),
            ));
        }
        Json::Object(out)
    });
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(results.collect()));
    out.push(b'\n');
    print(&out);
}

fn resolve(args: &[String]) {
    fn walk(directory: &std::path::Path, config: &Config, files: &mut Vec<Vec<u8>>) {
        for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
            let path = entry.path();
            let bytes = path.to_string_lossy().into_owned().into_bytes();
            match path.is_dir() {
                true if config.is_directory_ignored(&bytes) => {}
                true => walk(&path, config, files),
                false => files.push(bytes),
            }
        }
    }
    let [flavor, file, directory] = args else {
        return println!(
            "usage: bun-lint linter resolve oxlint|eslintrc|flat <configuration.json> <directory>"
        );
    };
    let json = std::fs::read(file)
        .ok()
        .and_then(|it| bun_lint::json::parse(&it))
        .expect("the configuration");
    let base_path = std::path::Path::new(file)
        .parent()
        .expect("a directory")
        .to_string_lossy()
        .into_owned();
    let case = Json::Object(vec![
        (b"basePath".to_vec(), Json::String(base_path.into_bytes())),
        (
            b"flavor".to_vec(),
            Json::String(flavor.clone().into_bytes()),
        ),
        (b"config".to_vec(), json),
    ]);
    let config = match config_of(&case, None) {
        Ok(config) => config,
        Err(error) => return println!("{}", text(&error.message)),
    };
    let mut files = Vec::new();
    let start = std::time::Instant::now();
    walk(std::path::Path::new(directory), &config, &mut files);
    println!(
        "{} files found in {:.1} ms",
        files.len(),
        start.elapsed().as_secs_f64() * 1e3
    );
    for (name, is_known_not_ignored) in
        [("get", false), ("get", false), ("get_unless_ignored", true)]
    {
        let start = std::time::Instant::now();
        let mut distinct: Vec<*const ResolvedConfig> = Vec::new();
        let (mut matched, mut rules) = (0, 0);
        for file in &files {
            let found = match is_known_not_ignored {
                true => config.get_unless_ignored(linter().registry(), file),
                false => config.get(linter().registry(), file),
            };
            if let FileConfig::Matched(resolved) = found {
                matched += 1;
                rules += resolved.rules.len();
                let address = std::sync::Arc::as_ptr(&resolved);
                if !distinct.contains(&address) {
                    distinct.push(address);
                }
            }
        }
        let elapsed = start.elapsed().as_secs_f64();
        println!(
            "{name}: {matched} linted, {} configurations, {:.1} rules on average: {:.1} ms, {:.2} us per file",
            distinct.len(),
            rules as f64 / f64::from(matched.max(1)),
            elapsed * 1e3,
            elapsed * 1e6 / files.len().max(1) as f64,
        );
    }
    println!(
        "{} rules are configured and unknown, {} notes",
        config.unknown_rules().len(),
        config.notes().len()
    );
}

fn bench(args: &[String]) {
    fn walk(directory: &std::path::Path, texts: &mut Vec<Vec<u8>>, paths: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if path.is_dir() {
                if name != "node_modules" && name != ".git" {
                    walk(&path, texts, paths);
                }
            } else if path.extension().is_some_and(|it| {
                ["js", "ts", "tsx", "jsx", "mjs", "cjs", "mts", "cts"]
                    .iter()
                    .any(|ext| it == *ext)
            }) {
                if let Ok(text) = std::fs::read(&path) {
                    texts.push(text);
                    paths.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }
    let (mut texts, mut paths) = (Vec::new(), Vec::new());
    walk(
        std::path::Path::new(args.first().expect("a directory")),
        &mut texts,
        &mut paths,
    );
    // What it costs to find out that a file is not refused, beside what it costs to parse and bind it.
    for parser in [Parser::TypeScript, Parser::Espree] {
        let language = LanguageOptions {
            parser,
            ..LanguageOptions::default()
        };
        let zero = std::time::Duration::ZERO;
        let (mut whole, mut check, mut again, mut refused) = (zero, zero, zero, 0);
        for (text, path) in texts.iter().zip(&paths) {
            let start = std::time::Instant::now();
            let (first, second) = with_file(path, text, &language, |file| {
                let start = std::time::Instant::now();
                refused += usize::from(bun_lint::linter::parse_error(file).is_some());
                let first = start.elapsed();
                // Once more, with what is computed once for a file and shared with the rules.
                let start = std::time::Instant::now();
                let _ = bun_lint::linter::parse_error(file);
                (first, start.elapsed())
            });
            whole += start.elapsed() - first - second;
            check += first;
            again += second;
        }
        println!(
            "{parser:?}: {refused} refused; parsing and binding {:.0} ms, parse_error {:.1} ms ({:.2} %), of its own {:.1} ms ({:.2} %)",
            whole.as_secs_f64() * 1e3,
            check.as_secs_f64() * 1e3,
            check.as_secs_f64() * 100.0 / whole.as_secs_f64(),
            again.as_secs_f64() * 1e3,
            again.as_secs_f64() * 100.0 / whole.as_secs_f64(),
        );
    }
}

fn validate(args: &[String]) {
    let cases = read_cases(args);
    let results = cases.iter().map(|case| {
        let id = case.get(b"rule").and_then(Json::as_str).unwrap_or_default();
        let options = case
            .get(b"options")
            .and_then(Json::as_array)
            .unwrap_or_default();
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
        let mut paths: Vec<_> = std::fs::read_dir(format!("{root}/{directory}"))
            .expect("the fixtures")
            .flatten()
            .map(|it| it.path())
            .collect();
        paths.sort();
        for path in paths {
            let Some(fixture) = std::fs::read(&path)
                .ok()
                .and_then(|it| bun_lint::json::parse(&it))
            else {
                continue;
            };
            for (index, case) in fixture
                .get(b"cases")
                .and_then(Json::as_array)
                .unwrap_or_default()
                .iter()
                .enumerate()
            {
                if !matches!(case.get(b"skip"), None | Some(Json::Null)) {
                    continue;
                }
                let null = Json::Null;
                let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
                let filename = case
                    .get(b"filename")
                    .and_then(Json::as_str)
                    .map(text)
                    .unwrap_or_default();
                let given = case.get(b"languageOptions").unwrap_or(&null);
                let config = ResolvedConfig {
                    language: LanguageOptions::from_json(given, &null),
                    ..ResolvedConfig::default()
                };
                let messages = with_file(&filename, code, &config.language, |file| {
                    linter()
                        .lint(file, &config, &LintOptions::default())
                        .messages
                });
                match messages
                    .first()
                    .filter(|it| it.is_fatal && it.message.starts_with(b"Parsing error"))
                {
                    None => parsed += 1,
                    Some(error) => {
                        rejected += 1;
                        let mut written = Vec::new();
                        testing::write_json(&mut written, given);
                        let name = path.file_stem().unwrap_or_default().to_string_lossy();
                        println!(
                            "{}\t{directory}/{name}#{index}\t{}\t{:?}",
                            text(&error.message),
                            text(&written),
                            text(code)
                        );
                    }
                }
            }
        }
    }
    println!("{parsed} parsed, {rejected} rejected");
}

fn diagnostics(args: &[String]) {
    let mut all = Vec::new();
    for case in &read_cases(args) {
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let filename = case
            .get(b"filename")
            .and_then(Json::as_str)
            .unwrap_or(b"file.js");
        let filename = String::from_utf8_lossy(filename).into_owned();
        all.push(with_file(
            &filename,
            code,
            &LanguageOptions::default(),
            |file| Json::Array(testing::diagnostics(file)),
        ));
    }
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(all));
    out.push(b'\n');
    print(&out);
}

/// `prettier <cases.json>`: for each `{ code, filename }`, whether Prettier refuses it, whether the parser has reported
/// something, and what it has left in the HIR. The file is parsed and bound as for formatting: in the dialect of Babel, as a module, without symbols.
fn prettier(args: &[String]) {
    let mut all = Vec::new();
    for case in &read_cases(args) {
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let path = (case.get(b"filename").and_then(Json::as_str)).unwrap_or(b"file.js");
        let language = LanguageOptions::default();
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let arena = session.arena();
        let options = language.parse_options(path);
        let mut hir = bun_js_parser::sema::summarize_as(
            bun_sema::resolve::Dialect::babel(false),
            arena,
            path,
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
        let bound = bun_sema::bind::bind_for_format(&hir, bind_options, &atoms, arena);
        let file = File::new(path, &hir, &bound, &atoms, &language, None);
        all.push(Json::Array(vec![
            Json::Bool(bun_lint::linter::refused_by_prettier(&file)),
            Json::Bool(file.has_parse_errors()),
            Json::Array(testing::diagnostics(&file)),
        ]));
    }
    let mut out = Vec::new();
    testing::write_json(&mut out, &Json::Array(all));
    out.push(b'\n');
    print(&out);
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("verify") => verify(&args[1..]),
        Some("prettier") => prettier(&args[1..]),
        Some("comment-parser") => comment_parser(&args[1..]),
        Some("json-parse") => json_parse(&args[1..]),
        Some("globals") => globals(&args[1..]),
        Some("environments") => environments(),
        Some("minimatch") => minimatch(&args[1..]),
        Some("validate") => validate(&args[1..]),
        Some("bench") => bench(&args[1..]),
        Some("resolve") => resolve(&args[1..]),
        Some("parse-fixtures") => parse_fixtures(&args[1..]),
        Some("config") => config(&args[1..]),
        Some("project") => project(&args[1..]),
        Some("diagnostics") => diagnostics(&args[1..]),
        Some("rules") => {
            let ids = linter()
                .registry()
                .all()
                .iter()
                .map(|it| Json::String(RuleId::Known(it.meta).to_vec()));
            let mut out = Vec::new();
            testing::write_json(&mut out, &Json::Array(ids.collect()));
            out.push(b'\n');
            print(&out);
        }
        _ => println!("usage: bun-lint linter verify|comment-parser|json-parse <cases.json>"),
    }
}
