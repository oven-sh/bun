use bun_lint_oxlint::ast_util::{get_member_expr, is_specific_id, parent_node};
use bun_lint_oxlint::import::{AssignmentTargets, is_assignment_target};
use crate::oxlint::vue::{
    EnclosingFunctions, is_in_vue_component_instance_method, is_vue_file, next_tick_imports, next_tick_property,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce valid `nextTick` function calls.
pub struct ValidNextTick;

const SHOULD_BE_FUNCTION: Message = Message::new("", "`nextTick` is a function.");
const MISSING_CALLBACK_OR_AWAIT: Message =
    Message::new("", "Await the Promise returned by `nextTick` or pass a callback function.");
const TOO_MANY_PARAMETERS: Message = Message::new("", "`nextTick` expects zero or one parameters.");
const EITHER_AWAIT_OR_CALLBACK: Message = Message::new("", "Either await the Promise or pass a callback function to `nextTick`.");

#[derive(Default)]
pub struct State<'a> {
    functions: EnclosingFunctions<'a>,
    assignment_targets: AssignmentTargets<'a>,
}

impl Rule for ValidNextTick {
    const META: Meta = Meta::oxlint(Plugin::Vue, "valid-next-tick", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        ValidNextTick
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        (is_vue_file(file) && file.mentions_any(&["nextTick", "$nextTick"])).then(State::default)
    }

    fn expr<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(report_span) = next_tick_property(member) {
            check(member, report_span, cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        next_tick_imports(cx.file()).for_each(|it| check(it, it.span(), cx));
    }
}

fn check<'a>(next_tick_node: Expr<'a>, report_span: Span, cx: &mut Cx<'a, ValidNextTick>) {
    if !is_in_vue_component_instance_method(next_tick_node, &mut cx.state.functions) {
        return;
    }
    // `bar ? nextTick : undefined`
    let parent = match parent_node(next_tick_node) {
        Some(Node::Expr(conditional)) if conditional.tag() == ExprTag::Cond => parent_node(conditional),
        parent => parent,
    };
    match parent {
        Some(Node::Expr(e)) if e.callee() == Some(next_tick_node) && e.tag() == ExprTag::Call => check_call(e, report_span, cx),
        // `foo.then(nextTick)`, `let foo = nextTick`, `foo = nextTick`
        Some(Node::Expr(e))
            if matches!(e.tag(), ExprTag::Call | ExprTag::Assign) && !is_assignment_target(e, &mut cx.state.assignment_targets) => {}
        Some(Node::VarDecl(_)) => {}
        _ => drop(cx.report(report_span, SHOULD_BE_FUNCTION).fix(|fixer| fixer.insert_after(next_tick_node, "()"))),
    }
}

fn check_call<'a>(call: Expr<'a>, report_span: Span, cx: &mut Cx<'a, ValidNextTick>) {
    let is_awaited_promise = is_awaited_promise(call, &mut cx.state.assignment_targets);
    let message = match (call.as_call().map_or(0, |it| it.args().len()), is_awaited_promise) {
        (0, false) => MISSING_CALLBACK_OR_AWAIT,
        (2.., _) => TOO_MANY_PARAMETERS,
        (1, true) => EITHER_AWAIT_OR_CALLBACK,
        _ => return,
    };
    cx.report(report_span, message);
}

fn is_awaited_promise<'a>(call: Expr<'a>, assignment_targets: &mut AssignmentTargets<'a>) -> bool {
    match parent_node(call) {
        Some(Node::Expr(parent)) => match parent.kind() {
            ExprKind::Await(_) => true,
            ExprKind::Assign { .. } => !is_assignment_target(parent, assignment_targets),
            // `nextTick().then(..)`
            ExprKind::Dot { name, .. } => name.name().is("then"),
            // `Promise.all([nextTick()])`
            ExprKind::Array(_) => {
                let callee = parent_node(parent).and_then(Node::as_expr).and_then(Expr::as_call).map(|it| it.callee());
                callee.and_then(get_member_expr).and_then(Expr::object).is_some_and(|it| is_specific_id(it, "Promise"))
            }
            _ => false,
        },
        Some(Node::Stmt(stmt)) => stmt.tag() == StmtTag::Return,
        Some(Node::VarDecl(_)) => true,
        // `() => nextTick()`
        Some(Node::Func(func)) => matches!(func.body(), FnBody::Expr(body) if body == call),
        _ => false,
    }
}
