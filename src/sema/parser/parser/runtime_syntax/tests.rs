use crate::{FileAtoms, Options, Scratch};
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;
use bun_sema::resolve::Dialect;
use bun_sema_standalone as _;

mod expressions;
mod functions;
mod names;
mod statements;

fn parsed(text: &str, options: Options) -> (Box<FileBuilder>, Scratch) {
    let mut scratch = Scratch::default();
    let result = crate::parse_with_own_atoms(text.as_bytes(), options, &mut scratch);
    let file = result.unwrap().file;
    assert_eq!(file.exprs.len(), file.expr_flags.len(), "{text}");
    (file, scratch)
}

fn typescript() -> Options {
    Options::default()
}

fn compiled_javascript() -> Options {
    Options {
        is_javascript: true,
        is_jsx: true,
        compiles: true,
        dialect: Dialect {
            ecmascript: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn atom_text<'a>(atoms: &'a FileAtoms<'_>, atom: Atom) -> &'a str {
    std::str::from_utf8(atoms.bytes(atom)).unwrap()
}

fn classes_of(text: &str, options: Options, code: u32) -> Vec<DiagnosticClass> {
    let (file, _) = parsed(text, options);
    let found = file.diagnostics.iter().filter(|it| it.code == code);
    found.map(|it| it.class).collect()
}

#[track_caller]
fn expect_compiled(code: u32, expected: &[DiagnosticClass], texts: &[&str]) {
    for text in texts {
        let found = classes_of(text, compiled_javascript(), code);
        assert_eq!(found, expected, "{text}");
    }
}

fn function_strictness(text: &str, keeps_function_directives: bool) -> Vec<bool> {
    let options = Options {
        compiles: true,
        keeps_function_directives,
        ..typescript()
    };
    let (file, _) = parsed(text, options);
    for function in &file.fns {
        assert_eq!(function.is_strict, function.is_strict_by_syntax, "{text}");
    }
    file.fns.iter().map(|it| it.is_strict).collect()
}
