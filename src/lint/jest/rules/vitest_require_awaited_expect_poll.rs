use crate::jest::{self, AstKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule ensures that promises returned by `expect.poll` and `expect.element` calls are handled properly.
pub struct RequireAwaitedExpectPoll;

const REQUIRE_AWAITED_EXPECT_POLL: Message = Message::new("", "`expect.{{member_name}}` must be awaited or returned");

impl Rule for RequireAwaitedExpectPoll {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-awaited-expect-poll", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireAwaitedExpectPoll
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions_any(&["poll", "element"])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let mut found: Vec<_> = jest::iter_possible_jest_call_node(file).filter_map(|it| unhandled(it, file)).collect();
        // The calls of one chain begin at one place. oxlint comes to them from the inside.
        utils::sort::sort_unstable_by_key(&mut found, |it| (it.0.span().start, it.0.span().end));
        for (node, member_name) in found {
            cx.report(node, REQUIRE_AWAITED_EXPECT_POLL).data("member_name", member_name);
        }
    }
}

/// The call, and the `poll` or the `element` of it, if what it returns is neither awaited nor returned.
fn unhandled<'a>(possible_jest_node: PossibleJestNode<'a>, file: &'a File<'a>) -> Option<(Expr<'a>, &'a [u8])> {
    let node = possible_jest_node.node;
    let expect = jest::parse_expect_and_typeof_vitest_fn_call(file, possible_jest_node)?;
    let member_name = expect.members.first().and_then(|it| it.name());
    let member_name = member_name.filter(|it| matches!(*it, b"poll" | b"element"))?;
    let is_returned_or_awaited = match skip_sequence_expressions(skip_matchers_and_modifiers(node)).parent() {
        AstKind::Stmt(statement) => statement.tag() == StmtTag::Return,
        AstKind::Expr(e) => e.tag() == ExprTag::Await,
        _ => false,
    };
    (!is_returned_or_awaited).then_some((node, member_name))
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
