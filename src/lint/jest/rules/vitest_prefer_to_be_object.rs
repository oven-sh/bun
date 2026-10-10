use crate::jest::{self, ParsedJestFnCall, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces using `toBeObject()` to check if a value is of type `Object`.
pub struct PreferToBeObject;

const PREFER_TO_BE_OBJECT: Message = Message::new("", "Prefer `toBeObject()` for object assertions");

impl Rule for PreferToBeObject {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-to-be-object", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBeObject
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions("Object")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx));
    }
}

fn is_object(e: Expr) -> bool {
    e.is_ident("Object") && !e.is_parenthesized()
}

fn run<'a>(possible_vitest_node: PossibleJestNode<'a>, cx: &Cx<'a, PreferToBeObject>) {
    let node = possible_vitest_node.node;
    let Some(ParsedJestFnCall::ExpectTypeOf(parsed_expect_call)) = jest::parse_jest_fn_call(cx.file(), possible_vitest_node) else {
        return;
    };
    let Some(matcher) = parsed_expect_call.matcher() else {
        return;
    };
    let is_falsy = match matcher.name() {
        Some(b"toBeInstanceOf") if parsed_expect_call.args.len() == 1 && parsed_expect_call.args.first().is_some_and(is_object) => {
            cx.report(matcher.span, PREFER_TO_BE_OBJECT)
                .fix(|fixer| fixer.replace(Span::new(matcher.span.start, node.span().end), "toBeObject()"));
            return;
        }
        Some(b"toBeTruthy") => false,
        Some(b"toBeFalsy") => true,
        _ => return,
    };
    // `expectTypeOf(a instanceof Object).toBeTruthy()`. There can be one pair of parentheses around the argument.
    if let Some(parent_call_expr) = parsed_expect_call.head.parent
        && let Some(binary_expr) = parent_call_expr.as_call().and_then(|it| it.args().first())
        && let ExprKind::Binary { op: BinOp::Instanceof, left, right } = binary_expr.kind()
        && binary_expr.parens().len() <= 1
        && is_object(right)
    {
        cx.report(matcher.span, PREFER_TO_BE_OBJECT).fix(|fixer| {
            let file = fixer.file();
            let not_modifier = parsed_expect_call.modifiers().any(|it| it.is_name_equal("not"));
            let code = [
                file.slice(Span::new(node.span().start, left.outer_span().end)),
                file.slice(Span::new(binary_expr.span().end, parent_call_expr.span().end)),
                if is_falsy != not_modifier { b".not".as_slice() } else { b"".as_slice() },
                b".toBeObject()".as_slice(),
            ];
            fixer.replace(node, code.concat())
        });
    }
}
