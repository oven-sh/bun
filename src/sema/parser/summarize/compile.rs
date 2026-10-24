use super::{JsDoc, ParseSettings, SCRATCH, parse_into_arena};
use bun_alloc::Arena;
use bun_sema::atom::Interner;
use bun_sema::hir::{DiagnosticClass, File, FileBuilder};
use bun_sema::resolve::{Dialect, ScriptKind};

#[derive(Copy, Clone)]
pub struct CompileParseOptions<'a> {
    pub path: &'a [u8],
    pub script_kind: Option<ScriptKind>,
    pub experimental_decorators: bool,
    pub every_file_is_a_module: bool,
    pub reads_jsdoc: bool,
    pub keeps_function_directives: bool,
}

pub(super) fn has_reported_error(file: &FileBuilder, compiles: bool) -> bool {
    match compiles {
        true => (file.diagnostics.iter()).any(|it| it.class == DiagnosticClass::EarlyError),
        false => !file.diagnostics.is_empty(),
    }
}

pub fn parse_for_compile<'s>(
    arena: &'s Arena,
    options: &CompileParseOptions<'_>,
    text: &[u8],
    atoms: &Interner<'s>,
) -> File<'s> {
    let script_kind = (options.script_kind).or_else(|| ScriptKind::from_file_name(options.path));
    let dialect = match script_kind.is_some_and(ScriptKind::is_javascript) {
        true => Dialect {
            ecmascript: true,
            ..Dialect::default()
        },
        false => Dialect::default(),
    };
    let how = ParseSettings {
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
        keeps_function_directives: options.keeps_function_directives,
        skips_function_blocks: false,
    };
    SCRATCH.with_borrow_mut(|all| {
        let scratch = all[0].get_or_insert_default();
        parse_into_arena(scratch, how, (arena, atoms.session()), text, atoms)
    })
}
