use crate::jest::{self, Ctx, JestFnKind, JestGeneralFnKind, Runner};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// The rule disallows the use of conditional statements within test cases to ensure that tests are deterministic and clearly
/// readable.
pub struct NoConditionalTests<const RUNNER: u8 = { jest::VITEST }>;

const NO_CONDITIONAL_TESTS: Message = Message::new("", "Avoid having conditionals in tests");

impl<const RUNNER: u8> Rule for NoConditionalTests<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-conditional-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file, RUNNER) && file.has_stmts([StmtTag::If])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        run_once(&Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) });
    }
}

fn run_once(ctx: &Ctx) {
    // The innermost `if` around something.
    let mut if_statements = AncestorMemo::default();
    let kinds = [JestFnKind::General(JestGeneralFnKind::Describe), JestFnKind::General(JestGeneralFnKind::Test)];
    for possible_jest_node in jest::iter_possible_jest_call_node(ctx.file, ctx.runner) {
        if jest::is_type_of_jest_fn_call(ctx.file, possible_jest_node, &kinds)
            && let Some(if_statement) = if_statements.find(Node::Expr(possible_jest_node.node), |_, parent| {
                parent.as_stmt().filter(|it| it.tag() == StmtTag::If)
            })
        {
            ctx.report(if_statement, NO_CONDITIONAL_TESTS);
        }
    }
}
