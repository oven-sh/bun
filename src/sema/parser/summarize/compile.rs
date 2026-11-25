use super::{JsDoc, ParseSettings, SCRATCH, parse_into_arena, take_scratch, with_own_atoms};
use crate::{AppendedExpression, AppendedExpressionFilter};
use bun_alloc::Arena;
use bun_sema::atom::{Intern, Interner};
use bun_sema::hir::{DiagnosticClass, ExprId, File, FileBuilder};
use bun_sema::resolve::{Dialect, ScriptKind};
use bun_sema::session::Session;

#[derive(Copy, Clone)]
pub struct CompileParseOptions<'a> {
    pub path: &'a [u8],
    pub script_kind: Option<ScriptKind>,
    pub experimental_decorators: bool,
    pub every_file_is_a_module: bool,
    pub reads_jsdoc: bool,
    pub ignores_pure_comments: bool,
}

pub(super) fn has_reported_error(file: &FileBuilder, compiles: bool) -> bool {
    match compiles {
        true => (file.diagnostics.iter()).any(|it| it.class == DiagnosticClass::EarlyError),
        false => !file.diagnostics.is_empty(),
    }
}

/// Parses `expressions`, which are in the text of `file`, and adds their nodes to `file`. Returns the first
/// node of each and the expression, and `None` for what isn't a single expression of JavaScript that `accepts` takes.
pub fn parse_appended_expressions(
    file: FileBuilder,
    expressions: &[AppendedExpression],
    atoms: &Interner<'_>,
    accepts: &AppendedExpressionFilter<'_>,
) -> (FileBuilder, Vec<Option<(ExprId, ExprId)>>) {
    let text = file.text.clone();
    SCRATCH.with_borrow_mut(|all| {
        let scratch = all[0].get_or_insert_default();
        crate::parser::run_appended(&text, file, expressions, atoms, scratch, accepts)
    })
}

pub fn parse_for_compile<'s>(
    arena: &'s Arena,
    options: &CompileParseOptions<'_>,
    text: &[u8],
    atoms: &Interner<'s>,
) -> File<'s> {
    parse_for_compile_in((arena, atoms.session()), options, text, atoms)
}

pub fn parse_for_compile_in<'s>(
    memory: (&'s Arena, &'s Session),
    options: &CompileParseOptions<'_>,
    text: &[u8],
    atoms: &Interner<'_>,
) -> File<'s> {
    let how = settings_for_compile(options);
    SCRATCH.with_borrow_mut(|all| {
        let scratch = all[0].get_or_insert_default();
        parse_into_arena(scratch, how, memory, text, atoms)
    })
}

/// Accepts what `bun run` accepts. The tree depends on nothing but `script_kind` and `text`.
pub fn with_file_as_written<R>(
    script_kind: ScriptKind,
    text: &[u8],
    then: impl FnOnce(&mut FileBuilder, &dyn Intern) -> R,
) -> R {
    let mut how = settings_for_compile(&CompileParseOptions {
        path: b"",
        script_kind: Some(script_kind),
        experimental_decorators: false,
        every_file_is_a_module: true,
        reads_jsdoc: false,
        ignores_pure_comments: true,
    });
    how.dialect.module_or_script = true;
    how.keeps_comma_statements = true;
    with_own_atoms(take_scratch(), how, text, then)
}

fn settings_for_compile<'a>(options: &CompileParseOptions<'a>) -> ParseSettings<'a> {
    let script_kind = (options.script_kind).or_else(|| ScriptKind::from_file_name(options.path));
    let dialect = match script_kind.is_some_and(ScriptKind::is_javascript) {
        true => Dialect {
            ecmascript: true,
            ..Dialect::default()
        },
        false => Dialect::default(),
    };
    ParseSettings {
        dialect,
        path: options.path,
        script_kind: options.script_kind,
        experimental_decorators: options.experimental_decorators,
        every_file_is_a_module: options.every_file_is_a_module,
        jsdoc: match options.reads_jsdoc {
            true => JsDoc::Read,
            false => JsDoc::Ignored,
        },
        attach_comments: false,
        compiles: true,
        reads_as_bun_run: true,
        ignores_pure_comments: options.ignores_pure_comments,
        keeps_comma_statements: false,
        skips_function_blocks: false,
        reads_module_statements_alone: false,
        drops_comments: false,
        may_use_helpers: false,
    }
}
