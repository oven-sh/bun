// SCRATCH PROBE of the research unit "ts-entry-codes-harness", not part of the change: make.py compiles it with a copy of src/lint.
// `check_file` and `parse` below are the planned text of src/runtime/cli/lint_command.rs for D2: every loader goes through
// `Parser::parse_for_lint_with_codes`, and a message of the log takes the code, the range and the text of its entry.
// usage: tsentry [--lint] <files>      writes the plain format to stderr, exit code 2 with an error, else 0
// PROBE_CODES=all   a JavaScript file gets the codes too (default: only a file of a TypeScript loader, assumption A1)
// PROBE_CODES=none  no file gets a code
// PROBE_FRAMES=1    code frames without colour in the place of the plain lines
// PROBE_RAW=1       also prints to stdout, per file: the result of the parse and every message with its entry
// PROBE_COMPARE=1   prints to stdout, per JavaScript file, how `Parser::parse_only` and the lint parse differ (result and messages)
#![allow(warnings, clippy::all)]

use bun_ast::{Kind, Level, Loader, Log, Msg, Range, Source};
use bun_js_parser::parse::syntax_errors::{SyntaxError, SyntaxErrors};

use crate::code_frame::write_code_frames;
use crate::diagnostic::{Category, Code, Diagnostic, FileId, SourceFile};
use crate::diagnosticwriter::{FormattingOptions, write_format_diagnostics};
use crate::program::sort_and_deduplicate_diagnostics;
use crate::tspath::{self, ComparePathsOptions};

fn loader_of(operand: &[u8]) -> Option<Loader> {
    let name = operand.rsplit(|&b| b == b'/').next().unwrap_or(operand);
    let dot = name.iter().rposition(|&b| b == b'.')?;
    match &name[dot..] {
        b".js" | b".jsx" => Some(Loader::Jsx),
        b".mjs" | b".cjs" => Some(Loader::Js),
        b".ts" | b".mts" | b".cts" => Some(Loader::Ts),
        b".tsx" => Some(Loader::Tsx),
        _ => None,
    }
}

fn options(loader: Loader) -> bun_js_parser::ParserOptions<'static> {
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    options
}

/// The planned `Diagnostic::from_msg` with the entry of the parser: the code, the range and the text of the reference.
fn from_syntax_error(file: FileId, msg: Msg, entry: Option<&SyntaxError>) -> Option<Diagnostic> {
    let mut diagnostic = Diagnostic::from_msg(file, msg)?;
    if let Some(entry) = entry
        && diagnostic.category == Category::Error
    {
        diagnostic.file = Some(file);
        diagnostic.code = Code::Ts(entry.code);
        diagnostic.start = entry.start;
        diagnostic.length = entry.end.saturating_sub(entry.start);
        diagnostic.text = entry.text.clone();
    }
    Some(diagnostic)
}

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Err => "err",
        Kind::Warn => "warn",
        Kind::Note => "note",
        Kind::Debug => "debug",
        Kind::Verbose => "verbose",
    }
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace('\n', "\\n")
}

fn describe(msg: &Msg) -> String {
    let place = match &msg.data.location {
        Some(location) => format!("{}+{} line {}", location.offset, location.length, location.line),
        None => "nowhere".to_string(),
    };
    format!(
        "{} [{}] {:?} code={:?} notes={}",
        kind_name(msg.kind),
        place,
        lossy(&msg.data.text),
        msg.code(),
        msg.notes.len()
    )
}

/// What the planned `parse` of lint_command.rs finds in one file.
fn parse(file: FileId, loader: Loader, source: &Source, name: &str) -> Vec<Diagnostic> {
    bun_ast::initialize_store();
    let _reset = bun_ast::StoreResetGuard::new();
    let arena = bun_alloc::Arena::new();
    let define = bun_js_parser::Define::default();
    let mut log = Log::init();
    log.level = Level::Warn;
    let mut errors = SyntaxErrors::default();
    let mut counts = (0usize, 0usize, false);
    let parsed = bun_js_parser::Parser::init(options(loader), &mut log, source, &define, &arena)
        .and_then(|parser| {
            parser.parse_for_lint_with_codes(&mut errors, |parsed| {
                counts = (
                    parsed.stmts.len(),
                    parsed.sidecar.erased.statements.len(),
                    parsed.is_declaration_file,
                );
                crate::lint(file, parsed, source)
            })
        });
    let raw = std::env::var("PROBE_RAW").is_ok();
    if raw {
        match &parsed {
            Ok(reports) => println!(
                "== {name}: Ok, {} statements, {} erased, declaration file {}, {} reports, {} messages",
                counts.0,
                counts.1,
                counts.2,
                reports.len(),
                log.msgs.len()
            ),
            Err(err) => println!(
                "== {name}: Err({}), log.errors {}, {} messages, {} entries",
                err.name(),
                log.errors,
                log.msgs.len(),
                errors.entries().len()
            ),
        }
        for (index, msg) in log.msgs.iter().enumerate() {
            let entry = match errors.get(index) {
                Some(entry) => format!(
                    "TS{} {}..{} {:?}",
                    entry.code,
                    entry.start,
                    entry.end,
                    lossy(&entry.text)
                ),
                None => "no entry".to_string(),
            };
            println!("   {index}: {} => {entry}", describe(msg));
        }
    }
    let reports = match parsed {
        Ok(reports) => reports,
        Err(err) => {
            if log.errors == 0 {
                log.add_range_error(Some(source), Range::None, err.name().as_bytes());
            }
            Vec::new()
        }
    };
    let coded = match std::env::var("PROBE_CODES").as_deref() {
        Ok("all") => true,
        Ok("none") => false,
        _ => loader.is_typescript(),
    };
    core::mem::take(&mut log.msgs)
        .into_iter()
        .enumerate()
        .filter_map(|(index, msg)| {
            from_syntax_error(file, msg, if coded { errors.get(index) } else { None })
        })
        .chain(reports)
        .collect()
}

/// How `Parser::parse_only` and the lint parse differ on one JavaScript file: nothing is printed when they do not.
fn compare(loader: Loader, source: &Source, name: &str) {
    let run = |lint: bool| -> (String, Vec<String>) {
        bun_ast::initialize_store();
        let _reset = bun_ast::StoreResetGuard::new();
        let arena = bun_alloc::Arena::new();
        let define = bun_js_parser::Define::default();
        let mut log = Log::init();
        log.level = Level::Warn;
        let parsed = bun_js_parser::Parser::init(options(loader), &mut log, source, &define, &arena)
            .and_then(|parser| {
                if lint {
                    parser.parse_for_lint(|parsed| parsed.stmts.len())
                } else {
                    parser.parse_only(|parsed| parsed.stmts.len())
                }
            });
        let result = match parsed {
            Ok(count) => format!("Ok({count})"),
            Err(err) => format!("Err({})", err.name()),
        };
        (result, log.msgs.iter().map(describe).collect())
    };
    let only = run(false);
    let lint = run(true);
    if only != lint {
        println!("DIFFERENT {name}\n   parse_only: {} {:?}\n   lint parse: {} {:?}", only.0, only.1, lint.0, lint.1);
    }
}

pub fn main() {
    let mut operands: Vec<String> = std::env::args().skip(1).collect();
    if operands.first().map(String::as_str) == Some("--lint") {
        operands.remove(0);
    }
    let cwd = std::env::current_dir().unwrap();
    let current_directory =
        tspath::get_normalized_absolute_path(cwd.to_str().unwrap().as_bytes(), b"");
    let mut files: Vec<SourceFile> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let comparing = std::env::var("PROBE_COMPARE").is_ok();
    for name in &operands {
        let operand = name.as_bytes();
        let Some(loader) = loader_of(operand) else {
            eprintln!("error unsupported-extension: {name}");
            continue;
        };
        let Ok(mut text) = std::fs::read(name) else {
            eprintln!("error cannot-read-file: File '{name}' not found.");
            continue;
        };
        if text.starts_with(b"\xEF\xBB\xBF") {
            text.drain(..3);
        }
        let text: &'static [u8] = Box::leak(text.into_boxed_slice());
        let path: &'static [u8] = Box::leak(name.clone().into_bytes().into_boxed_slice());
        let source = Source::init_path_string(path, text);
        if comparing {
            if !loader.is_typescript() {
                compare(loader, &source, name);
            }
            continue;
        }
        let file = FileId(u32::try_from(files.len()).unwrap_or(u32::MAX));
        let found = parse(file, loader, &source, name);
        if found.is_empty() {
            continue;
        }
        let file_name = tspath::get_normalized_absolute_path(operand, &current_directory);
        files.push(SourceFile::new(file_name.into_boxed_slice(), source));
        diagnostics.extend(found);
    }
    let diagnostics = sort_and_deduplicate_diagnostics(&files, diagnostics);
    let format_opts = FormattingOptions {
        compare_paths_options: ComparePathsOptions {
            use_case_sensitive_file_names: tspath::USE_CASE_SENSITIVE_FILE_NAMES,
            current_directory: &current_directory,
        },
        new_line: b"\n",
    };
    let mut output: Vec<u8> = Vec::new();
    if std::env::var("PROBE_FRAMES").is_ok() {
        write_code_frames::<false>(&mut output, &files, &diagnostics, &format_opts);
    } else {
        write_format_diagnostics(&mut output, &files, &diagnostics, &format_opts);
    }
    use std::io::Write;
    let _ = std::io::stderr().write_all(&output);
    let failed = diagnostics.iter().any(|d| d.category == Category::Error);
    std::process::exit(if failed { 2 } else { 0 });
}
