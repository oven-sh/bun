use crate::jest::{self, JestFnKind, JestGeneralFnKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// The rule disallows the use of conditional statements within test cases to ensure that tests are deterministic and clearly
/// readable.
pub struct NoConditionalTests;

const NO_CONDITIONAL_TESTS: Message = Message::new("", "Avoid having conditionals in tests");

impl Rule for NoConditionalTests {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-conditional-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !jest::is_test(file) || !file.has_stmts([StmtTag::If]) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // The innermost `if` around something.
        let mut if_statements = AncestorMemo::default();
        let kinds = [JestFnKind::General(JestGeneralFnKind::Describe), JestFnKind::General(JestGeneralFnKind::Test)];
        for possible_jest_node in jest::iter_possible_jest_call_node(cx.file()) {
            if jest::is_type_of_jest_fn_call(cx.file(), possible_jest_node, &kinds)
                && let Some(if_statement) = if_statements.find(Node::Expr(possible_jest_node.node), |_, parent| {
                    parent.as_stmt().filter(|it| it.tag() == StmtTag::If)
                })
            {
                cx.report(if_statement, NO_CONDITIONAL_TESTS);
            }
        }
    }
}
