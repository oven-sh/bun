use bun_lint_oxlint::ast_util::as_object_expression;
use crate::jest::{self, Arguments, Ctx, JestFnKind, JestGeneralFnKind, Runner};
use bun_lint::prelude::*;

/// Requires every test to have a timeout specified, either as a numeric third argument, a `{ timeout }` option, or via
/// `vi.setConfig({ testTimeout: ... })`.
pub struct RequireTestTimeout<const RUNNER: u8 = { jest::VITEST }>;

const TEST_MISSING_TIMEOUT: Message = Message::new("", "Test is missing a timeout.");
const CONFIG_MISSING_TIMEOUT_OBJECT: Message = Message::new("", "`vi.setConfig()` is missing a `testTimeout` property.");
const TEST_OPTIONS_MISSING_TIMEOUT_PROPERTY: Message = Message::new("", "Test options object is missing a `timeout` property.");
const TIMEOUT_MUST_BE_A_NUMBER: Message = Message::new("", "Timeout must be a number.");
const TIMEOUT_MUST_BE_NON_NEGATIVE: Message = Message::new("", "Timeout must not be negative.");

impl<const RUNNER: u8> Rule for RequireTestTimeout<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "require-test-timeout", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireTestTimeout
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && (jest::mentions_test(file) || jest::mentions_any(file, &const { jest::mention_bits(["vi", "vitest"]) }))).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        run_once(&Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) })
    }
}

fn value_of<'a>(properties: List<'a, Prop<'a>>, name: &str) -> Option<Expr<'a>> {
    let is_named = |it: &Prop| it.kind() != PropKind::Spread && it.key().is_some_and(|key| !key.is_private() && key.is(name));
    properties.iter().find(is_named)?.value()
}

fn run_once(ctx: &Ctx) {
    let is_bun = ctx.runner == Runner::Bun;
    // Where the `vi.setConfig({ testTimeout: .. })` that ends first ends. With Bun `setDefaultTimeout(..)` or `jest.setTimeout(..)`.
    let mut config_position: Option<u32> = None;
    for possible_jest_node in jest::iter_possible_jest_call_node(ctx.file, ctx.runner) {
        let node = possible_jest_node.node;
        let Some(arguments) = node.as_call().map(Call::args) else {
            continue;
        };
        let mut is_configured_by = |value: Expr| {
            let end = node.span().end;
            config_position = Some(config_position.map_or(end, |it| it.min(end)));
            parse_timeout_value(value, ctx);
        };
        if is_bun && possible_jest_node.original == Some(b"setDefaultTimeout") && node.callee().is_some_and(|it| it.tag() == ExprTag::Ident) {
            arguments.first().into_iter().for_each(&mut is_configured_by);
            continue;
        }
        let Some(vi_node) = jest::parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
            continue;
        };
        match vi_node.kind {
            JestFnKind::General(JestGeneralFnKind::Jest) if is_bun => {
                if vi_node.members.first().is_some_and(|member| member.is_name_equal("setTimeout")) {
                    arguments.first().into_iter().for_each(&mut is_configured_by);
                }
            }
            JestFnKind::General(JestGeneralFnKind::Vitest) if !is_bun => {
                if !vi_node.members.first().is_some_and(|member| member.is_name_equal("setConfig")) {
                    continue;
                }
                let Some(test_config) = arguments.first().and_then(as_object_expression) else {
                    ctx.report(node, CONFIG_MISSING_TIMEOUT_OBJECT);
                    continue;
                };
                if let Some(value) = value_of(test_config, "testTimeout") {
                    is_configured_by(value);
                }
            }
            JestFnKind::General(JestGeneralFnKind::Test) => {
                if vi_node.members.iter().any(|member| member.is_name_equal("todo") || member.is_name_equal("skip"))
                    || vi_node.name.starts_with(b"x")
                    || !arguments.iter().any(|it| it.tag() == ExprTag::Fn && !it.is_parenthesized())
                {
                    continue;
                }
                // The options are the second argument, or the timeout is the third. With Bun either is what is no function.
                let [options, timeout] = match is_bun {
                    true => [Arguments::of(arguments, ctx.runner).options; 2],
                    false => [arguments.get(1), arguments.get(2)],
                };
                if let Some(options) = options
                    && let Some(test_config) = as_object_expression(options)
                {
                    match value_of(test_config, "timeout") {
                        Some(value) => parse_timeout_value(value, ctx),
                        None => drop(ctx.report(options, TEST_OPTIONS_MISSING_TIMEOUT_PROPERTY)),
                    }
                } else if let Some(last_argument) = timeout {
                    if last_argument.tag() != ExprTag::Spread {
                        parse_timeout_value(last_argument, ctx);
                    }
                } else if !config_position.is_some_and(|end| end < node.span().start) {
                    let report = ctx.report(node, TEST_MISSING_TIMEOUT);
                    if is_bun {
                        report.help("Add a numeric third argument, a `{ timeout }` option object, or call `setDefaultTimeout(..)` before this test.");
                    }
                }
            }
            _ => {}
        }
    }
}

fn parse_timeout_value(expression: Expr, ctx: &Ctx) {
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
    ctx.report(method.map_or_else(|| expression.outer_span(), Func::span_from_params), message);
}
