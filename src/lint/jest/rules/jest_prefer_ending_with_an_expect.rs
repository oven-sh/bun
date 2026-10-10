use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that test blocks end with an assertion.
pub struct PreferEndingWithAnExpect {
    additional_test_block_functions: Vec<String>,
    /// `None`: what has `expect` in its name.
    assert_function_names: Option<Vec<Regex>>,
}

const PREFER_ENDING_WITH_AN_EXPECT: Message = Message::new("", "Test must end with an assertion");

impl Rule for PreferEndingWithAnExpect {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-ending-with-an-expect", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        PreferEndingWithAnExpect {
            additional_test_block_functions: (config.strings("additionalTestBlockFunctions").into_iter())
                .map(String::from)
                .collect(),
            assert_function_names: (config.has("assertFunctionNames"))
                .then(|| config.strings("assertFunctionNames").into_iter().filter_map(jest::convert_pattern).collect()),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        jest::iter_possible_jest_call_node(cx.file()).for_each(|node| self.run(node, cx));
    }
}

impl PreferEndingWithAnExpect {
    fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, cx: &Cx<'a, Self>) {
        let Some(call_expr) = possible_jest_node.node.as_call() else {
            return;
        };
        let Some(func) = call_expr.args().get(1).and_then(|it| it.as_fn().filter(|func| !it.is_parenthesized() && func.has_body()))
        else {
            return;
        };
        let Some(parsed_jest_fn) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
            return;
        };
        // Other functions take a function as the second argument too: `vi.mock(.., factory)`.
        let is_test_block = parsed_jest_fn.kind == JestFnKind::General(JestGeneralFnKind::Test) || {
            let name = jest::get_node_name(call_expr.callee());
            self.additional_test_block_functions.iter().any(|it| it.as_bytes() == name)
        };
        if is_test_block && !self.is_valid_last_statement(func, cx.file()) {
            cx.report(call_expr.callee(), PREFER_ENDING_WITH_AN_EXPECT);
        }
    }

    fn is_valid_last_statement<'a>(&self, func: Func<'a>, file: &'a File<'a>) -> bool {
        let statement_expression = match func.body() {
            FnBody::Expr(expression) => Some(expression),
            _ => match func.body_statements().and_then(List::last).filter(|it| it.directive().is_none()).map(Stmt::kind) {
                Some(StmtKind::Expr(expression)) => Some(expression),
                _ => None,
            },
        };
        let is_plain = |it: &Expr| !it.is_parenthesized() && !it.is_chain_root();
        let Some(call_expression) = (statement_expression.filter(is_plain))
            .map(|it| match it.kind() {
                ExprKind::Await(awaited) => awaited,
                _ => it,
            })
            .filter(|it| is_plain(it) && it.tag() == ExprTag::Call)
        else {
            return false;
        };
        if jest::parse_expect_jest_fn_call(file, PossibleJestNode::new(call_expression)).is_some() {
            return true;
        }
        let node_name = call_expression.callee().map(jest::get_node_name).unwrap_or_default();
        match &self.assert_function_names {
            Some(patterns) => patterns.iter().any(|pattern| pattern.test(&node_name)),
            None => strings::contains(&node_name, b"expect"),
        }
    }
}
