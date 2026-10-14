use crate::jest::{self, Ctx, JestFnKind, JestGeneralFnKind, Runner};
use bun_lint::prelude::*;
use bun_lint_oxlint::import::is_type_export_declaration;
use bun_lint_oxlint::module_record::{ModuleRecord, in_hash_order};

/// Prevents using exports if a file has one or more tests in it.
pub struct NoExport<const RUNNER: u8 = { jest::JEST }>;

const NO_EXPORT: Message = Message::new("", "Do not export from a test file.");

impl<const RUNNER: u8> Rule for NoExport<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-export", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && jest::mentions_test(file) && jest::is_jest_file(file))
            .then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        run_once(&Ctx {
            file: cx.file(),
            runner: Runner::of(RUNNER),
            report: &|at, message| cx.report(at, message),
        });
    }
}

fn run_once(ctx: &Ctx) {
    let file = ctx.file;
    let may_export = |it: Stmt| {
        it.is_exported()
            || matches!(
                it.tag(),
                StmtTag::ExportStar | StmtTag::ExportDefault | StmtTag::ExportNamed
            )
    };
    if !file.body().iter().any(may_export) {
        return;
    }
    let has_tests = jest::iter_possible_jest_call_node(file, ctx.runner).any(|possible_node| {
        jest::parse_general_jest_fn_call(file, possible_node)
            .is_some_and(|general| general.kind == JestFnKind::General(JestGeneralFnKind::Test))
    });
    if has_tests {
        let module_record = ModuleRecord::new(file);
        // Who imports a type does not run the file. oxlint reports these too.
        let is_type = |at: Span| {
            ctx.runner == Runner::Bun
                && file
                    .body()
                    .iter()
                    .find(|it| it.span().contains(at))
                    .is_some_and(|it| match it.kind() {
                        StmtKind::ExportNamed(export) => {
                            export.is_type_only()
                                || export
                                    .items()
                                    .iter()
                                    .any(|it| it.is_type_only() && it.span().contains(at))
                        }
                        _ => is_type_export_declaration(it),
                    })
        };
        // The parser comes to them in the order of the source. oxlint goes through its hash map of them.
        let bindings = module_record
            .exported_bindings
            .iter()
            .map(|it| (*it.0, *it.1));
        let bindings = in_hash_order(utils::sort::in_order_of(bindings, |it| it.1.start));
        for span in bindings
            .into_iter()
            .map(|it| it.1)
            .chain(module_record.export_default())
        {
            if !is_type(span) {
                ctx.report(span, NO_EXPORT);
            }
        }
    }
}
