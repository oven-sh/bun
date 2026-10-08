//! `bun-lint format verify <paths..>`, `bun-lint format verify-pairs`: see `bun_format::verify`.

use super::{Args, collect_files, format_text_or_panic, is_other_language};
use crate::host::{self, output_line};
use bun_format::FormatOptions;
use bun_format::verify::{Program, Scratch};
use bun_js_parser::sema::Summary;
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser, SourceType};
use bun_sema::atom::{Intern, Interner};
use bun_sema::bind::{BindOptions, bind_for_format};
use bun_sema::resolve::Dialect;
use bun_sema::session::Session;
use std::io::{BufRead as _, Read as _, Write as _};

/// Parses `code` the way `bun format` does and calls `then` with the tree, and with what its names are of.
fn with_tree<R>(
    dialect: Dialect,
    path: &str,
    code: &[u8],
    then: impl for<'a, 's> FnOnce(
        Summary<'a, 's>,
        &'a dyn Intern,
        &'s Session,
        &'a LanguageOptions,
    ) -> R,
) -> R {
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
    let how = language.parse_options(path.as_bytes());
    bun_js_parser::sema::with_summary_in_place(
        dialect,
        (session.arena(), &session),
        path.as_bytes(),
        how.script_kind,
        code,
        &atoms,
        how.experimental_decorators,
        how.every_file_is_a_module,
        |summary, atoms| then(summary, atoms, &session, &language),
    )
}

/// `None`: `before` does not parse.
fn compare(
    name: &str,
    before: &[u8],
    after: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Option<Result<(), String>> {
    let mut compare_as = |is_script: bool| {
        let dialect = super::dialect_of(options, before, name.as_bytes(), is_script);
        with_tree(
            dialect,
            name,
            before,
            |summary, atoms, session, language| {
                let hir = summary.into_arena((session.arena(), session));
                if hir.has_errors || hir.has_parse_diagnostics {
                    return None;
                }
                let bind_options = BindOptions {
                    emit_standard_class_fields: true,
                    before_es2020: false,
                    before_es2017: false,
                };
                let bound = bind_for_format(&hir, bind_options, atoms, session.arena());
                let file = File::new(name.as_bytes(), &hir, &bound, atoms, language, None)
                    .with_text(before);
                let program = Program::new(&hir, before, atoms);
                let result = with_tree(dialect, name, after, |summary, atoms, _, _| {
                    let program_after = match &summary {
                        Summary::InPlace(hir) => Program::new(&**hir, after, atoms),
                        Summary::InArena(hir) => Program::new(hir, after, atoms),
                    };
                    bun_format::verify::compare(&file, &program, &program_after, options, scratch)
                });
                Some(result.map_err(|difference| {
                    let difference = host::replace(&difference.to_string(), "\n", "\\n");
                    host::replace(&difference, "\t", "\\t")
                }))
            },
        )
    };
    // As `bun format` does.
    match name {
        _ if name.ends_with(".mjs") || name.ends_with(".mts") => compare_as(false),
        _ if name.ends_with(".cjs") || name.ends_with(".cts") => compare_as(true),
        _ => compare_as(false).or_else(|| compare_as(true)),
    }
}

/// Formats the files at the paths and compares each with what has become of it.
pub(super) fn verify(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut scratch = Scratch::default();
    let (mut passed, mut failed, mut errors) = (0, 0, 0);
    for path in collect_files(&args.positional)
        .iter()
        .filter(|it| !is_other_language(it))
    {
        let name = path.to_string_lossy();
        let Ok(code) = host::read(path) else {
            continue;
        };
        let Ok(formatted) = format_text_or_panic(&name, &code, &args.options) else {
            errors += 1;
            continue;
        };
        // As `bun format` does.
        let code = super::without_comment_types(&args.options, &name, name.as_bytes(), code.into());
        match compare(&name, &code, &formatted, &args.options, &mut scratch) {
            Some(Ok(())) => passed += 1,
            Some(Err(difference)) => {
                failed += 1;
                output_line!("{name}: {difference}");
            }
            None => errors += 1,
        }
    }
    output_line!("the same program: {passed}, not: {failed}, not formatted: {errors}");
}

/// Answers what the check says about pairs of texts. A question is a line
/// `<length of the text before> <length of the text after> <name of the file>` and the two texts. The
/// answer is a line: `same`, `different (..)`, or `not compared` if the text before does not parse.
/// test/cli/format/oracle/verify-mutants.ts talks to it.
pub(super) fn verify_pairs(args: &Args) {
    std::panic::set_hook(Box::new(|_| {}));
    let mut scratch = Scratch::default();
    let (mut stdin, mut stdout) = (std::io::stdin().lock(), std::io::stdout().lock());
    let mut line = String::new();
    while stdin.read_line(&mut line).is_ok_and(|read| read > 0) {
        let header = line.trim_end();
        let (before, rest) = host::split_once(header, " ").unwrap_or((header, ""));
        let (after, name) = host::split_once(rest, " ").unwrap_or((rest, ""));
        let length = |it: &str| it.parse::<usize>().unwrap_or(0);
        let (mut before, mut after) = (vec![0; length(before)], vec![0; length(after)]);
        if stdin
            .read_exact(&mut before)
            .and_then(|()| stdin.read_exact(&mut after))
            .is_err()
        {
            return;
        }
        let html_parser = match &args.options.parser {
            Some(parser) => bun_format::html::Parser::from_name(parser),
            None => bun_format::html::parser_for_path(name.as_bytes()),
        };
        let html = html_parser.map(|parser| {
            bun_format::html::has_same_content(&before, &after, parser, &args.options)
        });
        let _ = match html.map_or_else(
            || compare(name, &before, &after, &args.options, &mut scratch),
            |is_same| {
                Some(
                    is_same
                        .then_some(())
                        .ok_or_else(|| "what is in the file".into()),
                )
            },
        ) {
            Some(Ok(())) => writeln!(stdout, "same"),
            Some(Err(difference)) => writeln!(stdout, "different ({difference})"),
            None => writeln!(stdout, "not compared"),
        };
        let _ = stdout.flush();
        line.clear();
    }
}
