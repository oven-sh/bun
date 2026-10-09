use bun_lint_oxlint::ast_util::as_object_expression;
use crate::jest::{self, JestFnKind, JestGeneralFnKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires every test to have a timeout specified, either as a numeric third argument, a `{ timeout }` option, or via
/// `vi.setConfig({ testTimeout: ... })`.
pub struct RequireTestTimeout;

const TEST_MISSING_TIMEOUT: Message = Message::new("", "Test is missing a timeout.");
const CONFIG_MISSING_TIMEOUT_OBJECT: Message = Message::new("", "`vi.setConfig()` is missing a `testTimeout` property.");
const TEST_OPTIONS_MISSING_TIMEOUT_PROPERTY: Message = Message::new("", "Test options object is missing a `timeout` property.");
const TIMEOUT_MUST_BE_A_NUMBER: Message = Message::new("", "Timeout must be a number.");
const TIMEOUT_MUST_BE_NON_NEGATIVE: Message = Message::new("", "Timeout must not be negative.");

impl Rule for RequireTestTimeout {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-test-timeout", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireTestTimeout
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|_, cx| run_once(cx));
        }
    }
}

fn value_of<'a>(properties: List<'a, Prop<'a>>, name: &str) -> Option<Expr<'a>> {
    let is_named = |it: &Prop| it.kind() != PropKind::Spread && it.key().is_some_and(|key| !key.is_private() && key.is(name));
    properties.iter().find(is_named)?.value()
}

fn run_once<'a>(cx: &Cx<'a, RequireTestTimeout>) {
    // Where the `vi.setConfig({ testTimeout: .. })` that ends first ends.
    let mut config_position: Option<u32> = None;
    for possible_jest_node in jest::iter_possible_jest_call_node(cx.file()) {
        let node = possible_jest_node.node;
        let Some(arguments) = node.as_call().map(Call::args) else {
            continue;
        };
        let Some(vi_node) = jest::parse_general_jest_fn_call(cx.file(), possible_jest_node) else {
            continue;
        };
        match vi_node.kind {
            JestFnKind::General(JestGeneralFnKind::Vitest) => {
                if !vi_node.members.first().is_some_and(|member| member.is_name_equal("setConfig")) {
                    continue;
                }
                let Some(test_config) = arguments.first().and_then(as_object_expression) else {
                    cx.report(node, CONFIG_MISSING_TIMEOUT_OBJECT);
                    continue;
                };
                if let Some(value) = value_of(test_config, "testTimeout") {
                    let end = node.span().end;
                    config_position = Some(config_position.map_or(end, |it| it.min(end)));
                    parse_timeout_value(value, cx);
                }
            }
            JestFnKind::General(JestGeneralFnKind::Test) => {
                if vi_node.members.iter().any(|member| member.is_name_equal("todo") || member.is_name_equal("skip"))
                    || vi_node.name.starts_with(b"x")
                    || !arguments.iter().any(|it| it.tag() == ExprTag::Fn && !it.is_parenthesized())
                {
                    continue;
                }
                // The options are the second argument, or the timeout is the third.
                if let Some(options) = arguments.get(1)
                    && let Some(test_config) = as_object_expression(options)
                {
                    match value_of(test_config, "timeout") {
                        Some(value) => parse_timeout_value(value, cx),
                        None => drop(cx.report(options, TEST_OPTIONS_MISSING_TIMEOUT_PROPERTY)),
                    }
                } else if let Some(last_argument) = arguments.get(2) {
                    if last_argument.tag() != ExprTag::Spread {
                        parse_timeout_value(last_argument, cx);
                    }
                } else if !config_position.is_some_and(|end| end < node.span().start) {
                    cx.report(node, TEST_MISSING_TIMEOUT);
                }
            }
            _ => {}
        }
    }
}

fn parse_timeout_value<'a>(expression: Expr<'a>, cx: &Cx<'a, RequireTestTimeout>) {
    let is_number = |it: Expr| it.tag() == ExprTag::Number && !it.is_parenthesized();
    let message = match expression.kind() {
        _ if is_number(expression) => return,
        ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => TIMEOUT_MUST_BE_A_NUMBER,
        ExprKind::Unary { op, operand } if !expression.is_parenthesized() && is_number(operand) => match op {
            UnOp::Plus => return,
            _ => TIMEOUT_MUST_BE_NON_NEGATIVE,
        },
        _ => TIMEOUT_MUST_BE_A_NUMBER,
    };
    // The function of a method starts with its parameters.
    let method = expression.as_fn().filter(|it| matches!(it.kind(), FnKind::Method | FnKind::Getter | FnKind::Setter));
    cx.report(method.map_or_else(|| expression.outer_span(), Func::span_from_params), message);
}
