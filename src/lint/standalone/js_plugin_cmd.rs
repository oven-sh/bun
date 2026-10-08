//! `bun-lint js_plugin ..`: for the oracles of the JavaScript plugin API.
//!
//! - `lint --plugin=<specifier> [--alias=<name>] [--rules=<{ "rule": [options] }>] [--language=<languageOptions>] <files..>`:
//!   what the rules of a plugin, all of them unless `--rules` says which, report for each file, a line of JSON for each.
//! - `batch --plugin=<specifier> [--alias=<name>] [--rules=..] <cases.jsonl>`: the same for each case, which is
//!   `{ id, filename, code, languageOptions, settings, rules }`, of which only `id` and `code` are required. Prints
//!   `{ id, messages }` or `{ id, failure }`, a line for each.

mod processes;

use bun_lint::js_plugin::{Configured, FileSettings, Host, Plugin, Report, Rule};
use bun_lint::language::LanguageOptions;
use bun_lint::options::Json;
use processes::{BOOTSTRAP, Channel, Processes};
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;

struct Process {
    child: Child,
    input: Option<ChildStdin>,
    output: ChildStdout,
}

impl Channel for Process {
    fn send(&mut self, bytes: &[u8]) -> Result<(), Vec<u8>> {
        let input = self.input.as_mut().ok_or(b"closed".as_slice())?;
        input
            .write_all(bytes)
            .map_err(|error| error.to_string().into_bytes())
    }

    fn receive(&mut self, into: &mut [u8]) -> Result<(), Vec<u8>> {
        self.output
            .read_exact(into)
            .map_err(|error| error.to_string().into_bytes())
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        drop(self.input.take());
        let _ = self.child.wait();
    }
}

/// Starts a worker with the `bun` that is in `PATH`.
fn spawn() -> Result<Box<dyn Channel>, Vec<u8>> {
    let bun = std::env::var("BUN_LINT_BUN").unwrap_or_else(|_| "bun".to_owned());
    let mut command = Command::new("sh");
    command.args([
        "-c",
        "exec \"$0\" \"$@\" 3<&0 4>&1 1>&2 </dev/null",
        &bun,
        "-e",
        BOOTSTRAP,
    ]);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| error.to_string().into_bytes())?;
    let (input, output) = (child.stdin.take(), child.stdout.take());
    Ok(Box::new(Process {
        child,
        input,
        output: output.ok_or(b"no pipe".as_slice())?,
    }))
}

/// With `BUN_LINT_WORKER=<src/lint/js_plugin/worker>` the processes run the program that is there now.
pub(crate) fn new_processes(max: usize) -> Processes<'static> {
    let mut processes = Processes::new(&spawn, max);
    if let Ok(directory) = std::env::var("BUN_LINT_WORKER") {
        let part = |it: &(&str, &str)| {
            std::fs::read(format!("{directory}/{}", it.0)).expect("a part of the program")
        };
        processes.set_program(bun_lint::js_plugin::PROGRAM.iter().flat_map(part).collect());
    }
    processes
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn report_as_json(report: &Report, enabled: &[Arc<Configured>], code: &[u8]) -> Json {
    let string = |text: &[u8]| Json::String(text.to_vec());
    let number = |n: u32| Json::Number(f64::from(n));
    let fix = |fix: &bun_lint::fix::Fix| {
        let mut offsets = bun_lint::linter::Utf16Offsets::new(code);
        let range = [
            offsets.convert(fix.span.start),
            offsets.convert(fix.span.end),
        ];
        Json::Object(vec![
            (
                b"range".to_vec(),
                Json::Array(range.iter().map(|it| Json::Number(*it as f64)).collect()),
            ),
            (b"text".to_vec(), string(&fix.text)),
        ])
    };
    let mut fields = vec![
        (
            b"ruleId".to_vec(),
            enabled
                .get(report.rule as usize)
                .map_or(Json::Null, |it| string(&it.rule.id)),
        ),
        (b"message".to_vec(), string(&report.message)),
        (b"line".to_vec(), number(report.line)),
        (b"column".to_vec(), number(report.column)),
    ];
    if let Some(id) = &report.message_id {
        fields.push((b"messageId".to_vec(), string(id.as_bytes())));
    }
    if let Some((line, column)) = report.end {
        fields.push((b"endLine".to_vec(), number(line)));
        fields.push((b"endColumn".to_vec(), number(column)));
    }
    if let Some(it) = &report.fix {
        fields.push((b"fix".to_vec(), fix(it)));
    }
    if !report.suggestions.is_empty() {
        let suggestions = report.suggestions.iter().map(|it| {
            let mut fields = Vec::new();
            if let Some(id) = &it.message_id {
                fields.push((b"messageId".to_vec(), string(id.as_bytes())));
            }
            if !it.data.is_empty() {
                let data = it
                    .data
                    .iter()
                    .map(|(key, value)| (key.as_bytes().to_vec(), string(value)));
                fields.push((b"data".to_vec(), Json::Object(data.collect())));
            }
            fields.push((b"desc".to_vec(), string(&it.message)));
            fields.push((b"fix".to_vec(), fix(&it.fix)));
            Json::Object(fields)
        });
        fields.push((b"suggestions".to_vec(), Json::Array(suggestions.collect())));
    }
    Json::Object(fields)
}

fn lint(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|it| it.strip_prefix(name));
    let cwd = std::env::current_dir()
        .expect("the working directory")
        .to_string_lossy()
        .into_owned();
    let processes = new_processes(1);
    let host = Host::with_engine(&processes, cwd.as_bytes());
    let specifier = flag("--plugin=").expect("--plugin");
    let plugin = match host.load(
        cwd.as_bytes(),
        specifier.as_bytes(),
        flag("--alias=").map(str::as_bytes),
    ) {
        Ok(plugin) => plugin,
        Err(why) => return println!("cannot load {specifier}: {}", text(&why)),
    };
    let rules =
        flag("--rules=").map(|it| bun_lint::json::parse(it.as_bytes()).expect("--rules is JSON"));
    let enabled = enabled_by(&plugin, rules.as_ref());
    let language = flag("--language=")
        .map(|it| bun_lint::json::parse(it.as_bytes()).expect("--language is JSON"));
    let language =
        LanguageOptions::from_json(language.as_ref().unwrap_or(&Json::Null), &Json::Null);
    let settings = FileSettings::new(&language);
    let references: Vec<&Configured> = enabled.iter().map(|it| &**it).collect();
    for path in args.iter().filter(|it| !it.starts_with("--")) {
        let code = std::fs::read(path).expect("the file");
        let absolute = std::path::Path::new(&cwd)
            .join(path)
            .to_string_lossy()
            .into_owned();
        let result = crate::with_file(&absolute, &code, &language, |file| {
            host.run(file, &settings, &references, true)
        });
        let mut line = Vec::new();
        let json = match result {
            Ok(reports) => Json::Array(
                reports
                    .iter()
                    .map(|it| report_as_json(it, &enabled, &code))
                    .collect(),
            ),
            Err(failure) => {
                Json::Object(vec![(b"failure".to_vec(), Json::String(failure.message))])
            }
        };
        bun_lint::linter::write_json(&mut line, &json);
        println!("{path}\t{}", text(&line));
    }
}

/// With the options that the linter gives the rule: those of its `meta.defaultOptions` and the defaults of its schema filled in.
fn configured(rule: &Arc<Rule>, options: &[Json]) -> Arc<Configured> {
    let options = bun_lint::linter::testing::validate_js(rule, options)
        .unwrap_or_else(|why| panic!("the options of {}: {}", text(&rule.id), text(&why)));
    Configured::new(Arc::clone(rule), &options)
}

fn enabled_by(plugin: &Plugin, rules: Option<&Json>) -> Vec<Arc<Configured>> {
    match rules {
        None | Some(Json::Null) => plugin.rules.iter().map(|it| configured(it, &[])).collect(),
        Some(rules) => (rules.as_object().unwrap_or_default().iter())
            .map(|(name, options)| {
                let rule = plugin
                    .rule(name)
                    .unwrap_or_else(|| panic!("no rule {}", text(name)));
                configured(rule, options.as_array().unwrap_or_default())
            })
            .collect(),
    }
}

fn batch(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|it| it.strip_prefix(name));
    let cwd = std::env::current_dir()
        .expect("the working directory")
        .to_string_lossy()
        .into_owned();
    let processes = new_processes(1);
    let host = Host::with_engine(&processes, cwd.as_bytes());
    let specifier = flag("--plugin=").expect("--plugin");
    let plugin = match host.load(
        cwd.as_bytes(),
        specifier.as_bytes(),
        flag("--alias=").map(str::as_bytes),
    ) {
        Ok(plugin) => plugin,
        Err(why) => return println!("cannot load {specifier}: {}", text(&why)),
    };
    let rules =
        flag("--rules=").map(|it| bun_lint::json::parse(it.as_bytes()).expect("--rules is JSON"));
    let for_all = enabled_by(&plugin, rules.as_ref());
    let cases = std::fs::read(
        args.iter()
            .find(|it| !it.starts_with("--"))
            .expect("the cases"),
    )
    .expect("the cases");
    // By what they are made of.
    let mut known: Vec<(Vec<u8>, Arc<(LanguageOptions, Arc<FileSettings>)>)> = Vec::new();
    std::panic::set_hook(Box::new(|_| {}));
    for line in bun_core::strings::split(&cases, b"\n").filter(|it| !it.is_empty()) {
        let case = bun_lint::json::parse(line).expect("a case");
        let (language, settings) = (
            case.get(b"languageOptions").unwrap_or(&Json::Null),
            case.get(b"settings").unwrap_or(&Json::Null),
        );
        let mut key = Vec::new();
        bun_lint::linter::write_json(
            &mut key,
            &Json::Array(vec![language.clone(), settings.clone()]),
        );
        let configuration = match known.iter().find(|it| it.0 == key) {
            Some(found) => Arc::clone(&found.1),
            None => {
                let language = LanguageOptions::from_json(language, settings);
                let settings = FileSettings::new(&language);
                known.push((key, Arc::new((language, settings))));
                Arc::clone(&known[known.len() - 1].1)
            }
        };
        let own = case.get(b"rules").map(|it| enabled_by(&plugin, Some(it)));
        let enabled = own.as_ref().unwrap_or(&for_all);
        let references: Vec<&Configured> = enabled.iter().map(|it| &**it).collect();
        let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
        let name = case
            .get(b"filename")
            .and_then(Json::as_str)
            .map_or_else(|| "file.js".to_owned(), text);
        let path = std::path::Path::new(&cwd)
            .join(name)
            .to_string_lossy()
            .into_owned();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::with_file(&path, code, &configuration.0, |file| {
                if bun_lint::linter::parse_error(file).is_some() {
                    return Err(bun_lint::js_plugin::Failure::from(
                        b"the parser rejects the code".to_vec(),
                    ));
                }
                // As `Linter::lint` does.
                for name in file.exported_in_comments() {
                    if let Some(symbol) = file.scope().get_bytes(name) {
                        symbol.mark_exported();
                    }
                }
                host.run(file, &configuration.1, &references, true)
            })
        }));
        let outcome = match result {
            Ok(Ok(mut reports)) => {
                reports.sort_by_key(|it| (it.line, it.column));
                (
                    b"messages".to_vec(),
                    Json::Array(
                        reports
                            .iter()
                            .map(|it| report_as_json(it, enabled, code))
                            .collect(),
                    ),
                )
            }
            Ok(Err(failure)) => (b"failure".to_vec(), Json::String(failure.message)),
            Err(_) => (b"failure".to_vec(), Json::String(b"panicked".to_vec())),
        };
        let mut line = Vec::new();
        let id = (
            b"id".to_vec(),
            case.get(b"id").cloned().unwrap_or(Json::Null),
        );
        bun_lint::linter::write_json(&mut line, &Json::Object(vec![id, outcome]));
        println!("{}", text(&line));
    }
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("lint") => lint(&args[1..]),
        Some("batch") => batch(&args[1..]),
        _ => println!("usage: bun-lint js_plugin lint --plugin=<specifier> <files..>"),
    }
}
