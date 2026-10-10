use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use crate::jest::{self, JestFnKind, JestGeneralFnKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// The rule is intended to ensure that concurrent snapshot tests are executed within a properly configured local test context.
pub struct RequireLocalTestContextForConcurrentSnapshots;

const REQUIRE_LOCAL_TEST_CONTEXT_FOR_CONCURRENT_SNAPSHOTS: Message =
    Message::new("", "Require local Test Context for concurrent snapshot tests");

const SNAPSHOT_METHODS: [&str; 5] = [
    "toMatchSnapshot",
    "toMatchInlineSnapshot",
    "toMatchFileSnapshot",
    "toThrowErrorMatchingSnapshot",
    "toThrowErrorMatchingInlineSnapshot",
];

impl Rule for RequireLocalTestContextForConcurrentSnapshots {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-local-test-context-for-concurrent-snapshots", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireLocalTestContextForConcurrentSnapshots
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !jest::is_test(file) || !file.mentions("concurrent") || !file.mentions_any(&SNAPSHOT_METHODS) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // Whether something is in a call of `it.concurrent` or the like.
        let mut in_concurrent = AncestorMemo::default();
        for possible_jest_node in jest::iter_possible_jest_call_node(cx.file()) {
            let node = possible_jest_node.node;
            let is_snapshot = node.callee().filter(|it| !it.is_parenthesized()).and_then(static_property_name);
            if is_snapshot.is_some_and(|it| it.is_any(&SNAPSHOT_METHODS))
                && jest::is_type_of_jest_fn_call(cx.file(), possible_jest_node, &[JestFnKind::Expect])
                && in_concurrent.find(Node::Expr(node), |_, parent| is_test_or_describe_node(parent).then_some(())).is_some()
            {
                cx.report(node, REQUIRE_LOCAL_TEST_CONTEXT_FOR_CONCURRENT_SNAPSHOTS);
            }
        }
    }
}

/// `it.concurrent(..)`, `describe["concurrent"](..)`
fn is_test_or_describe_node(node: Node) -> bool {
    let Some(member_expr) = node.as_expr().and_then(Expr::callee).filter(|it| !it.is_parenthesized()) else {
        return false;
    };
    node.as_expr().is_some_and(|it| it.tag() == ExprTag::Call)
        && static_property_name(member_expr).is_some_and(|it| it.is("concurrent"))
        && (member_expr.object().map(get_inner_expression).and_then(Expr::as_ident)).is_some_and(|id| {
            matches!(
                JestFnKind::from(id.bytes()),
                JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test)
            )
        })
}
