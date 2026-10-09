use bun_lint_oxlint::ast_util::{as_member_expression, static_property_info};
use crate::jest::{self, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers a warning if `mock()` or `doMock()` is used without a generic type parameter or return type.
pub struct NoUntypedMockFactory;

const ADD_TYPE_PARAMETER_TO_MODULE_MOCK: Message =
    Message::new("", "`jest.mock()` factories should not be used without an explicit type parameter.");

impl Rule for NoUntypedMockFactory {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-untyped-mock-factory", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUntypedMockFactory
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.is_javascript() && file.mentions_any(&["mock", "doMock"]) && jest::is_test(file) {
            on.finish(|_, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx)));
        }
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, NoUntypedMockFactory>) {
    if let Some(call_expr) = possible_jest_node.node.as_call()
        && let Some((property_span, property_name)) = as_member_expression(call_expr.callee()).and_then(static_property_info)
        && property_name.is_any(&["mock", "doMock"])
        && call_expr.args().len() == 2
        && call_expr.type_args().is_empty()
        && let (Some(name_node), Some(factory_node)) = (call_expr.args().first(), call_expr.args().get(1))
        && !(factory_node.as_fn()).is_some_and(|it| !factory_node.is_parenthesized() && it.return_type().is_some())
        && !name_node.is_parenthesized()
    {
        match name_node.kind() {
            ExprKind::String(value) => {
                cx.report(property_span, ADD_TYPE_PARAMETER_TO_MODULE_MOCK).fix(|fixer| {
                    let code = [b"<typeof import('".as_slice(), value.bytes(), b"')>".as_slice()].concat();
                    fixer.insert_after(call_expr.callee(), code)
                });
            }
            ExprKind::Ident(_) => {
                cx.report(property_span, ADD_TYPE_PARAMETER_TO_MODULE_MOCK);
            }
            _ => {}
        }
    }
}
