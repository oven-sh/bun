use crate::jest::{self, MemberExpressionElement, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using `toBeTypeOf` instead of `expect(typeof ...).toBe(...)`.
pub struct PreferExpectTypeOf;

const PREFER_EXPECT_TYPE_OF: Message = Message::new("", "Type assertions should be done using `toBeTypeOf`.");

impl Rule for PreferExpectTypeOf {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-expect-type-of", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExpectTypeOf
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.has_exprs([ExprTag::Unary]) {
            on.finish(|_, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx)));
        }
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, PreferExpectTypeOf>) {
    let Some(expect_call) = jest::parse_expect_jest_fn_call(cx.file(), possible_jest_node) else {
        return;
    };
    if let Some(typeof_expression) = expect_call.expect_arguments.and_then(List::first)
        && let ExprKind::Unary { op: UnOp::Typeof, operand } = typeof_expression.kind()
        && !typeof_expression.is_parenthesized()
        && expect_call.matcher().is_some_and(|it| it.is_name_equal("toBe") || it.is_name_equal("toEqual"))
        && let Some(type_expected) = expect_call.matcher_arguments.and_then(List::first)
        && type_expected.tag() != ExprTag::Spread
    {
        let file = cx.file();
        let mut code = [b"expect(".as_slice(), file.slice(operand.outer_span()), b")".as_slice()].concat();
        for modifier in expect_call.modifiers() {
            let (open, close) = match modifier.element {
                MemberExpressionElement::IdentName(_) => (".", ""),
                MemberExpressionElement::Expression(_) => ("[", "]"),
            };
            code.extend_from_slice(open.as_bytes());
            code.extend_from_slice(file.slice(modifier.span));
            code.extend_from_slice(close.as_bytes());
        }
        code.extend_from_slice(b".toBeTypeOf(");
        code.extend_from_slice(file.slice(type_expected.outer_span()));
        code.push(b')');
        cx.report(possible_jest_node.node, PREFER_EXPECT_TYPE_OF)
            .data("code", code.clone())
            .fix(|fixer| fixer.replace(possible_jest_node.node, code));
    }
}
