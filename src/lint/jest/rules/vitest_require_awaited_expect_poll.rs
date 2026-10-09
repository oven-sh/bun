use crate::jest::{self, AstKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule ensures that promises returned by `expect.poll` and `expect.element` calls are handled properly.
pub struct RequireAwaitedExpectPoll;

const REQUIRE_AWAITED_EXPECT_POLL: Message = Message::new("", "`expect.{{member_name}}` must be awaited or returned");

impl Rule for RequireAwaitedExpectPoll {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-awaited-expect-poll", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireAwaitedExpectPoll
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&["poll", "element"]) {
            on.finish(|_, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx)));
        }
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, RequireAwaitedExpectPoll>) {
    let node = possible_jest_node.node;
    let Some(expect) = jest::parse_expect_and_typeof_vitest_fn_call(cx.file(), possible_jest_node) else {
        return;
    };
    let member_name = expect.members.first().and_then(|it| it.name());
    let Some(member_name) = member_name.filter(|it| matches!(*it, b"poll" | b"element")) else {
        return;
    };
    let is_returned_or_awaited = match skip_sequence_expressions(skip_matchers_and_modifiers(node)).parent() {
        AstKind::Stmt(statement) => statement.tag() == StmtTag::Return,
        AstKind::Expr(e) => e.tag() == ExprTag::Await,
        _ => false,
    };
    if !is_returned_or_awaited {
        cx.report(node, REQUIRE_AWAITED_EXPECT_POLL).data("member_name", member_name);
    }
}

/// With the parentheses around it, and the sequences that it is the last of.
fn skip_sequence_expressions(node: AstKind<'_>) -> AstKind<'_> {
    let mut current_node = node;
    loop {
        let parent = current_node.parent();
        let is_skipped = match parent {
            AstKind::ParenthesizedExpression(..) => true,
            AstKind::Expr(sequence) => {
                sequence.binary_op() == Some(BinOp::Comma) && sequence.right() == current_node.innermost_expr()
            }
            _ => false,
        };
        if !is_skipped {
            return current_node;
        }
        current_node = parent;
    }
}

fn skip_matchers_and_modifiers(node: Expr<'_>) -> AstKind<'_> {
    let mut current_node = AstKind::Expr(node);
    loop {
        let parent = current_node.parent();
        if !parent.is_member_expression_kind() && parent.as_call().is_none() {
            return current_node;
        }
        current_node = parent;
    }
}
