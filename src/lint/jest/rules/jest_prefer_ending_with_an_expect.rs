use crate::jest::{self, Arguments, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner};
use bun_core::strings;
use bun_lint::prelude::*;

/// Enforces that test blocks end with an assertion.
pub struct PreferEndingWithAnExpect<const RUNNER: u8 = { jest::JEST }>(Config);

struct Config {
    additional_test_block_functions: Vec<String>,
    /// `None`: what has `expect` in its name.
    assert_function_names: Option<Vec<Regex>>,
}

const PREFER_ENDING_WITH_AN_EXPECT: Message = Message::new("", "Test must end with an assertion");

impl<const RUNNER: u8> Rule for PreferEndingWithAnExpect<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-ending-with-an-expect", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        PreferEndingWithAnExpect(Config {
            additional_test_block_functions: (config.strings("additionalTestBlockFunctions").into_iter())
                .map(String::from)
                .collect(),
            assert_function_names: (config.has("assertFunctionNames"))
                .then(|| config.strings("assertFunctionNames").into_iter().filter_map(|it| jest::convert_pattern(it, Runner::of(RUNNER))).collect()),
        })
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
        jest::calls_of_own_test_blocks(&ctx, &self.0.additional_test_block_functions).for_each(|it| self.0.run(it, &ctx));
    }
}

impl Config {
    fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(call_expr) = possible_jest_node.node.as_call() else {
            return;
        };
        let Some(func) = Arguments::of(call_expr.args(), ctx.runner).callback.and_then(|it| it.as_fn().filter(|func| !it.is_parenthesized() && func.has_body()))
        else {
            return;
        };
        let is_additional = || {
            let name = jest::get_node_name(call_expr.callee());
            self.additional_test_block_functions.iter().any(|it| it.as_bytes() == name)
        };
        // Other functions take a function as the second argument too: `vi.mock(.., factory)`.
        let is_test_block = match jest::parse_general_jest_fn_call(ctx.file, possible_jest_node) {
            Some(parsed_jest_fn) => parsed_jest_fn.kind == JestFnKind::General(JestGeneralFnKind::Test) || is_additional(),
            None => ctx.runner == Runner::Bun && is_additional(),
        };
        if is_test_block && !self.is_valid_last_statement(func, ctx) {
            ctx.report(call_expr.callee(), PREFER_ENDING_WITH_AN_EXPECT);
        }
    }

    fn is_valid_last_statement<'a>(&self, func: Func<'a>, ctx: &Ctx<'a, '_>) -> bool {
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
        if jest::parse_expect_jest_fn_call(ctx.file, PossibleJestNode::new(call_expression, ctx.runner)).is_some() {
            return true;
        }
        let names = call_expression.callee().map(jest::get_node_name_vec).unwrap_or_default();
        match &self.assert_function_names {
            Some(patterns) => {
                let node_name = names.join(&b"."[..]);
                patterns.iter().any(|pattern| pattern.test(&node_name))
            }
            None => names.iter().any(|it| strings::contains(it, b"expect")),
        }
    }
}
