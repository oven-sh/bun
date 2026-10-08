//! `bun-lint format ..`: the formatter without the rest of Bun, for developing and testing it.
//!
//! Every command takes Prettier's options as `--name=value`: `--semi=false --printWidth=100`.
//!
//! - `file <path>`: the formatted file.
//! - `ir <path>`: the document that the file is printed from.
//! - `conformance <prettier>/tests/format [--languages=js,jsx,..] [--filter=text] [--report=dir]
//!   [--verbose]`: Prettier's own tests. With `--report`, `summary.md` and the expected and the
//!   actual output of each failure are written there.
//! - `check-idempotent <paths..>`: formatting what has been formatted changes nothing.
//! - `verify <paths..>`: what has been formatted has the same tokens. See `bun_format::verify`.
//! - `bench <paths..> [--iterations=n] [--threads=n] [--check] [--only=parse]`: MB/s, with and without parsing.
//! - `serve`: formats the file at each path that is read from stdin, one per line, and answers
//!   `ok <length>\n<bytes>` or `error <message>\n`. test/cli/format/oracle/compare.ts talks to it.

mod bench;
mod conformance;
mod cursor;
mod sort_imports;

use bun_format::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, bind};
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use std::collections::BTreeMap;
use std::io::{BufRead, Write as _};
use std::path::{Path, PathBuf};

/// Parses `code` the way Prettier's parsers do, as a module or as a script, and calls `then` with
/// the file.
fn with_file_as<R>(is_script: bool, path: &str, code: &[u8], then: impl for<'a> FnOnce(&'a File<'a>) -> R) -> R {
    // What typescript-estree refuses while it converts the tree, Prettier refuses too.
    let is_typescript = [".ts", ".tsx", ".mts", ".cts"].iter().any(|it| path.ends_with(it));
    let language = LanguageOptions {
        parser: if is_typescript { Parser::TypeScript } else { Parser::Espree },
        source_type: if is_script { SourceType::Script } else { SourceType::Module },
        ..LanguageOptions::default()
    };
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let how = language.parse_options(path.as_bytes());
    let mut hir = bun_js_parser::sema::summarize_as(
        Dialect::babel(is_script),
        arena,
        path.as_bytes(),
        how.script_kind,
        code,
        &atoms,
        how.experimental_decorators,
        how.every_file_is_a_module,
    )
    .0;
    hir.text = std::borrow::Cow::Borrowed(code);
    let bind_options = BindOptions {
        emit_standard_class_fields: true,
        before_es2020: false,
        before_es2017: false,
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    then(&File::new(path.as_bytes(), &hir, &bound, &atoms, &language, None))
}

/// Puts `<|>` where the cursor is, which is counted in UTF-16 code units.
fn show_cursor(out: &mut Vec<u8>, cursor: Option<u32>) {
    let Some(cursor) = cursor else {
        return;
    };
    let mut units = 0;
    let at = crate::text(out).char_indices().find_map(|(at, c)| {
        let is_there = units >= cursor as usize;
        units += c.len_utf16();
        is_there.then_some(at)
    });
    let at = at.unwrap_or(out.len());
    out.splice(at..at, *b"<|>");
}

fn format_text(path: &str, code: &[u8], options: &FormatOptions) -> Result<Vec<u8>, FormatError> {
    fn format<'a>(file: &'a File<'a>, is_script: bool, options: &FormatOptions) -> Result<Vec<u8>, FormatError> {
        if file.language().parser == Parser::TypeScript && bun_lint::linter::parse_error(file).is_some() {
            return Err(FormatError::SyntaxError);
        }
        let (mut scratch, mut out) = (Scratch::default(), Vec::new());
        // Where the cursor ends up is shown the way Prettier's snapshots show it.
        if options.cursor_offset.is_some() && options.range_start.is_none() && options.range_end.is_none() {
            let cursor = bun_format::cursor::format_with_cursor(file, options, &mut scratch, &mut out)?;
            show_cursor(&mut out, cursor);
            return Ok(out);
        }
        let path = crate::text(file.path());
        let parse = |slice: &[u8], then: &mut dyn for<'b> FnMut(&'b File<'b>)| with_file_as(is_script, &path, slice, |file| then(file));
        bun_format::range::format(file, options, &mut scratch, &mut out, parse).map(|()| out)
    }
    let name = options.filepath.as_deref().filter(|it| !it.is_empty()).unwrap_or(path.as_bytes());
    let json_parser = match &options.parser {
        Some(parser) => bun_format::json::Parser::from_name(parser),
        None => bun_format::json::parser_for_path(name),
    };
    if let Some(parser) = json_parser {
        let mut sorted = Vec::new();
        let is_package_json = name == b"package.json" || name.ends_with(b"/package.json");
        let code = match options.sort_package_json.filter(|_| is_package_json) {
            Some(sort) if bun_format::json::sort_package_json(code, sort, &mut sorted) => &sorted[..],
            _ => code,
        };
        let mut out = Vec::new();
        return bun_format::json::format(code, parser, options, &mut Default::default(), &mut out).map(|()| out);
    }
    let css_parser = match &options.parser {
        Some(parser) => bun_format::css::Parser::from_name(parser),
        None => bun_format::css::parser_for_path(name),
    };
    if let Some(parser) = css_parser {
        let mut out = Vec::new();
        return bun_format::css::format(code, parser, options, &mut Default::default(), &mut out).map(|()| out);
    }
    let code = match bun_format::pragma::before_parsing(code, options) {
        bun_format::pragma::BeforeParsing::LeaveAsItIs => {
            let mut out = code.to_vec();
            show_cursor(&mut out, options.cursor_offset);
            return Ok(out);
        }
        bun_format::pragma::BeforeParsing::Format(code) => code,
    };
    let format_as = |is_script: bool| {
        with_file_as(is_script, path, &code, |file| {
            // A file whose imports move is parsed again.
            let how = options.sort_imports.as_deref();
            match how.and_then(|how| bun_format::sort_imports::sorted_text(file, how)) {
                Some(sorted) => with_file_as(is_script, path, &sorted, |file| format(file, is_script, options)),
                None => format(file, is_script, options),
            }
        })
    };
    // What is not a module may be a script.
    match name.rsplit(|&byte| byte == b'.').next() {
        Some(b"cjs" | b"cts") => format_as(true),
        Some(b"mjs" | b"mts") => format_as(false),
        _ => format_as(false).or_else(|_| format_as(true)),
    }
}

/// The same, but a panic is an error.
fn format_text_or_panic(path: &str, code: &[u8], options: &FormatOptions) -> Result<Vec<u8>, String> {
    match std::panic::catch_unwind(|| format_text(path, code, options)) {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(error)) => Err(format!("{error:?}")),
        Err(_) => Err("panic".to_owned()),
    }
}

struct Args {
    options: FormatOptions,
    /// `--name=value` that is not an option of Prettier.
    flags: BTreeMap<String, String>,
    positional: Vec<String>,
}

impl Args {
    fn parse(args: &[String]) -> Args {
        let mut parsed = Args {
            options: FormatOptions::default(),
            flags: BTreeMap::new(),
            positional: Vec::new(),
        };
        for arg in args {
            let Some(flag) = arg.strip_prefix("--") else {
                parsed.positional.push(arg.clone());
                continue;
            };
            let (name, value) = flag.split_once('=').unwrap_or((flag, "true"));
            if parsed.options.set(name.as_bytes(), value.as_bytes()).is_err() {
                parsed.flags.insert(name.to_owned(), value.to_owned());
            }
        }
        parsed.options.sort_imports = sort_imports::from_flags(&parsed.flags);
        parsed
    }

    fn flag(&self, name: &str) -> Option<&str> {
        self.flags.get(name).map(String::as_str)
    }
}

// ───────────────────────────── files ─────────────────────────────

const EXTENSIONS: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];

/// JSON or a style sheet.
fn is_other_language(path: &Path) -> bool {
    let path = path.as_os_str().as_encoded_bytes();
    bun_format::json::parser_for_path(path).is_some() || bun_format::css::parser_for_path(path).is_some()
}

/// The files at `paths` and in the directories at `paths` that can be formatted.
fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    fn visit(path: &Path, found: &mut Vec<PathBuf>) {
        if path.is_dir() {
            if path.file_name().is_some_and(|it| it == "node_modules" || it == ".git") {
                return;
            }
            let mut entries: Vec<_> = std::fs::read_dir(path).into_iter().flatten().flatten().map(|it| it.path()).collect();
            entries.sort();
            entries.iter().for_each(|it| visit(it, found));
        } else if path.extension().and_then(|it| it.to_str()).is_some_and(|it| EXTENSIONS.contains(&it))
            || is_other_language(path)
        {
            found.push(path.to_owned());
        }
    }
    let mut found = Vec::new();
    paths.iter().for_each(|it| visit(Path::new(it), &mut found));
    found
}

fn check_idempotent(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let (mut passed, mut failed, mut errors) = (0, 0, 0);
    for path in collect_files(&args.positional) {
        let name = path.to_string_lossy();
        let Ok(code) = std::fs::read(&path) else {
            continue;
        };
        let Ok(once) = format_text_or_panic(&name, &code, &args.options) else {
            errors += 1;
            continue;
        };
        match format_text_or_panic(&name, &once, &args.options) {
            Ok(twice) if twice == once => passed += 1,
            Ok(_) => {
                failed += 1;
                println!("not idempotent: {name}");
            }
            Err(error) => {
                failed += 1;
                println!("{error} in the formatted file: {name}");
            }
        }
    }
    println!("idempotent: {passed}, not: {failed}, not formatted: {errors}");
}

fn verify(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let (mut passed, mut failed, mut errors) = (0, 0, 0);
    for path in collect_files(&args.positional) {
        let name = path.to_string_lossy();
        let Ok(code) = std::fs::read(&path) else {
            continue;
        };
        let Ok(formatted) = format_text_or_panic(&name, &code, &args.options) else {
            errors += 1;
            continue;
        };
        let language = LanguageOptions::default();
        let difference = crate::with_file(&name, &code, &language, |before| {
            crate::with_file(&name, &formatted, &language, |after| bun_format::verify::compare(before, after))
        });
        match difference {
            Ok(()) => passed += 1,
            Err(difference) => {
                failed += 1;
                println!("{name}: {difference}");
            }
        }
    }
    println!("the same tokens: {passed}, not: {failed}, not formatted: {errors}");
}

fn serve(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdout = std::io::stdout().lock();
    for path in std::io::stdin().lock().lines().map_while(Result::ok) {
        let result = match std::fs::read(&path) {
            Ok(code) => format_text_or_panic(&path, &code, &args.options),
            Err(error) => Err(error.to_string()),
        };
        let _ = match result {
            Ok(out) => writeln!(stdout, "ok {}", out.len()).and_then(|()| stdout.write_all(&out)),
            Err(error) => writeln!(stdout, "error {error}"),
        };
        let _ = stdout.flush();
    }
}

pub(crate) fn run(args: &[String]) {
    let command = args.first().map(String::as_str);
    let args = Args::parse(args.get(1..).unwrap_or_default());
    match command {
        Some("file") => {
            let path = args.positional.first().expect("a path");
            let code = std::fs::read(path).expect("the file");
            match format_text(path, &code, &args.options) {
                Ok(out) => print!("{}", crate::text(&out)),
                Err(error) => println!("{error:?}"),
            }
        }
        Some("ir") => {
            let path = args.positional.first().expect("a path");
            let code = std::fs::read(path).expect("the file");
            let document = crate::with_file(path, &code, &LanguageOptions::default(), |file| {
                bun_format::dump_document(file, &args.options, &mut Scratch::default())
            });
            match document {
                Ok(document) => print!("{document}"),
                Err(error) => println!("{error:?}"),
            }
        }
        Some("conformance") => conformance::run(&args),
        Some("check-idempotent") => check_idempotent(&args),
        Some("verify") => verify(&args),
        Some("bench") => bench::bench(&args),
        Some("serve") => serve(&args),
        Some("cursor") => cursor::run(&args),
        Some("sort-imports") => sort_imports::run(&args),
        _ => println!("usage: bun-lint format file|ir|conformance|check-idempotent|verify|bench|serve .."),
    }
}
