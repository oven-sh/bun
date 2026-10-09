//! `bun-lint format ..`: the formatter without the rest of Bun, for developing and testing it.
//!
//! Every command takes Prettier's options as `--name=value`: `--semi=false --printWidth=100`.
//!
//! - `file <path>`: the formatted file.
//! - `ir <path>`: the document that the file is printed from.
//! - `conformance <fixtures> [--languages=js,jsx,..] [--filter=text] [--report=dir] [--table]`:
//!   Prettier's own tests. With `--report`, the expected and the actual output of each failure are
//!   written there. `oxfmt-fixtures <fixtures>`: those of oxfmt.
//! - `check-idempotent <paths..>`: formatting what has been formatted changes nothing.
//! - `verify <paths..>`: what has been formatted is the same program. See `bun_format::verify`.
//! - `letters <paths..>`: see `letters.rs`.
//! - `verify-pairs`: answers whether the second of two texts is the same program as the first.
//!   test/cli/format/oracle/verify-mutants.ts talks to it.
//! - `bench <paths..> [--iterations=n] [--threads=n] [--check] [--only=parse]`: MB/s, with and without parsing.
//! - `serve`: formats the file at each path that is read from stdin, one per line, and answers
//!   `ok <length>\n<bytes>` or `error <message>\n`. test/cli/format/oracle/compare.ts talks to it.

mod bench;
mod conformance;
mod cursor;
mod letters;
mod markdown;
#[cfg(bun_sema_mimalloc)]
mod readers;
mod sort_imports;
mod value;
mod verify;

use crate::host::{self, output, output_line};
use bun_format::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, bind, bind_for_format};
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use std::collections::BTreeMap;
use std::io::{BufRead, Write as _};
use std::path::{Path, PathBuf};

/// Parses `code` the way Prettier's parsers do, as a module or as a script, and calls `then` with
/// the file.
fn with_file_as<R>(
    dialect: Dialect,
    path: &str,
    code: &[u8],
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> R {
    with_bound_file_as(false, dialect, path, code, then)
}

/// `needs_symbols`: with the symbols and scopes of the file, which formatting does not take.
fn with_bound_file_as<R>(
    needs_symbols: bool,
    dialect: Dialect,
    path: &str,
    code: &[u8],
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> R {
    // What typescript-estree refuses while it converts the tree, Prettier refuses too.
    let is_typescript = [".ts", ".tsx", ".mts", ".cts"]
        .iter()
        .any(|it| path.ends_with(it));
    let language = LanguageOptions {
        parser: if is_typescript {
            Parser::TypeScript
        } else {
            Parser::Espree
        },
        source_type: if dialect.script {
            SourceType::Script
        } else {
            SourceType::Module
        },
        ..LanguageOptions::default()
    };
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let how = language.parse_options(path.as_bytes());
    let mut hir = bun_js_parser::sema::summarize_as(
        dialect,
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
    let bound = match needs_symbols {
        true => bind(&hir, bind_options, &atoms, arena),
        false => bind_for_format(&hir, bind_options, &atoms, arena),
    };
    then(&File::new(
        path.as_bytes(),
        &hir,
        &bound,
        &atoms,
        &language,
        None,
    ))
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

/// The formatted text, with `<|>` where the cursor ends up.
fn format_text(path: &str, code: &[u8], options: &FormatOptions) -> Result<Vec<u8>, FormatError> {
    format_text_with_cursor(path, code, options).map(|(mut out, cursor)| {
        show_cursor(&mut out, cursor);
        out
    })
}

type WithCursor = (Vec<u8>, Option<u32>);

/// What `bun format` makes of the text: the driver's own function, so that what is tested here is what ships.
fn format_text_with_cursor(
    path: &str,
    code: &[u8],
    options: &FormatOptions,
) -> Result<WithCursor, FormatError> {
    use bun_lint_driver::fmt::{Refusal, format_for_tests};
    if options.parser.as_deref() == Some(b"markdown-ast") {
        let mut out = Vec::new();
        bun_format::markdown::dump_ast(code, &mut out);
        return Ok((out, None));
    }
    format_for_tests(path.as_bytes(), code, options, false).map_err(|refusal| match refusal {
        Refusal::Syntax => FormatError::SyntaxError,
        Refusal::Bug(_) | Refusal::Loss(_) => FormatError::InvalidDocument,
    })
}

/// `code`, or what `babel-flow` reads in its place: what is in `/*:: */` and `/*: */` is code.
fn without_comment_types<'c>(
    options: &FormatOptions,
    path: &str,
    name: &[u8],
    code: std::borrow::Cow<'c, [u8]>,
) -> std::borrow::Cow<'c, [u8]> {
    let module = dialect_of(options, &code, name, false);
    match module.flow && module.babel && bun_format::flow::may_have_comment_types(&code) {
        true => with_file_as(module, path, &code, bun_format::flow::uncommented)
            .map_or(code, std::borrow::Cow::Owned),
        false => code,
    }
}

/// Whose reading of JavaScript Prettier formats `code`, the text of the file called `name`, by.
fn dialect_of(options: &FormatOptions, code: &[u8], name: &[u8], is_script: bool) -> Dialect {
    // `babel` hands a file of Flow to `babel-flow`.
    let is_flow = match options.parser.as_deref() {
        Some(b"flow" | b"babel-flow") => true,
        Some(b"babel") | None => bun_lint::linter::goes_to_flow(code, name),
        Some(_) => false,
    };
    match is_flow {
        true if bun_format::flow::goes_to_babel(options, name) => Dialect::flow(is_script),
        true => Dialect::flow_parser(is_script),
        false => Dialect::babel(is_script),
    }
}

/// The same, but a panic is an error.
fn format_text_or_panic(
    path: &str,
    code: &[u8],
    options: &FormatOptions,
) -> Result<Vec<u8>, String> {
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
            let (name, value) = host::split_once(flag, "=").unwrap_or((flag, "true"));
            if parsed
                .options
                .set(name.as_bytes(), value.as_bytes())
                .is_err()
            {
                parsed.flags.insert(name.to_owned(), value.to_owned());
            }
        }
        parsed.options.sort_imports = sort_imports::from_flags(&parsed.flags);
        parsed.options.embedded_html = parsed.flags.contains_key("embeddedHtml");
        parsed
    }

    fn flag(&self, name: &str) -> Option<&str> {
        self.flags.get(name).map(String::as_str)
    }
}

// ───────────────────────────── files ─────────────────────────────

const EXTENSIONS: &[&str] = &["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];

/// JSON, a style sheet or GraphQL.
fn is_other_language(path: &Path) -> bool {
    let path = path.as_os_str().as_encoded_bytes();
    bun_format::json::parser_for_path(path).is_some()
        || bun_format::css::parser_for_path(path).is_some()
        || bun_format::graphql::is_graphql_path(path)
        || bun_format::handlebars::is_handlebars_path(path)
        || bun_format::yaml::is_yaml_path(path)
        || bun_format::markdown::is_markdown_path(path)
        || bun_format::markdown::is_mdx_path(path)
}

/// The files at `paths` and in the directories at `paths` that can be formatted.
fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    fn visit(path: &Path, found: &mut Vec<PathBuf>) {
        if path.is_dir() {
            if path
                .file_name()
                .is_some_and(|it| it == "node_modules" || it == ".git")
            {
                return;
            }
            let mut entries = host::list(path);
            entries.sort();
            entries.iter().for_each(|it| visit(it, found));
        } else if path
            .extension()
            .and_then(|it| it.to_str())
            .is_some_and(|it| EXTENSIONS.contains(&it))
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
        let Ok(code) = host::read(&path) else {
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
                output_line!("not idempotent: {name}");
            }
            Err(error) => {
                failed += 1;
                output_line!("{error} in the formatted file: {name}");
            }
        }
    }
    output_line!("idempotent: {passed}, not: {failed}, not formatted: {errors}");
}

fn serve(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut stdout = std::io::stdout().lock();
    for path in std::io::stdin().lock().lines().map_while(Result::ok) {
        let result = match host::read(&path) {
            Ok(code) => format_text_or_panic(&path, &code, &args.options),
            Err(error) => Err(host::describe(&error)),
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
    let raw = args.get(1..).unwrap_or_default();
    let args = Args::parse(raw);
    match command {
        Some("file") => {
            let path = args.positional.first().expect("a path");
            let code = host::read(path).expect("the file");
            match format_text(path, &code, &args.options) {
                Ok(out) => output!("{}", crate::text(&out)),
                Err(error) => output_line!("{error:?}"),
            }
        }
        Some("ir") => {
            let path = args.positional.first().expect("a path");
            let code = host::read(path).expect("the file");
            let document = crate::with_file(path, &code, &LanguageOptions::default(), |file| {
                bun_format::dump_document(file, &args.options, &mut Scratch::default())
            });
            match document {
                Ok(document) => output!("{document}"),
                Err(error) => output_line!("{error:?}"),
            }
        }
        Some("conformance") => {
            conformance::run(&args, raw, bun_format_conformance::run_prettier_tests)
        }
        Some("oxfmt-fixtures") => {
            conformance::run(&args, raw, bun_format_conformance::run_oxfmt_tests)
        }
        Some("check-idempotent") => check_idempotent(&args),
        Some("value") => value::run(&args),
        Some("letters") => letters::run(&args),
        Some("verify") => verify::verify(&args),
        Some("verify-pairs") => verify::verify_pairs(&args),
        Some("bench") => bench::bench(&args),
        Some("serve") => serve(&args),
        Some("cursor") => cursor::run(&args),
        #[cfg(bun_sema_mimalloc)]
        Some("readers") => readers::run(&args),
        Some("markdown") => markdown::run(&args),
        Some("sort-imports") => sort_imports::run(&args),
        _ => output_line!(
            "usage: bun-lint format file|ir|conformance|check-idempotent|verify|bench|serve .."
        ),
    }
}
