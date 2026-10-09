use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::import::{AssignmentTargets, is_assignment_target};
use crate::oxlint::vue::{is_vue_file, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::cell::OnceCell;

/// Disallow passing multiple arguments to scoped slots.
pub struct NoMultipleSlotArgs;

const MULTIPLE_ARGUMENTS: Message = Message::new("", "Unexpected multiple arguments.");
const SPREAD_ARGUMENT: Message = Message::new("", "Unexpected spread argument.");

/// By name, where something is assigned to an identifier, and what. In the order of the source.
pub struct State<'a>(OnceCell<FxHashMap<Name<'a>, Vec<(u32, Expr<'a>)>>>);

impl Rule for NoMultipleSlotArgs {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-multiple-slot-args", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoMultipleSlotArgs
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if is_vue_file(file) && !is_vue_setup(file) && file.mentions_any(&["$slots", "$scopedSlots"]) {
            on.exprs([ExprTag::Call], check);
        }
        State(OnceCell::new())
    }
}

fn check<'a>(_: &NoMultipleSlotArgs, e: Expr<'a>, cx: &mut Cx<'a, NoMultipleSlotArgs>) {
    let Some(call_expr) = e.as_call().filter(|it| !it.args().is_empty()) else {
        return;
    };
    // `this.$slots.name(..)`, where `this.$slots.name` and `this` can be variables.
    let callee = get_inner_expression(call_expr.callee());
    let member_expr = match callee.tag() {
        ExprTag::Ident => get_identifier_resolved_reference(callee, cx).filter(|it| !it.is_chain_root()),
        _ => Some(callee),
    };
    let Some(ExprKind::Dot { obj, .. }) = member_expr.filter(|it| !it.is_private_member()).map(Expr::kind) else {
        return;
    };
    let ExprKind::Dot { obj: this, name, .. } = get_inner_expression(obj).kind() else {
        return;
    };
    let this = get_inner_expression(this);
    let is_this = match this.tag() {
        ExprTag::This => true,
        ExprTag::Ident => get_identifier_resolved_reference(this, cx).is_some_and(|it| it.tag() == ExprTag::This),
        _ => false,
    };
    if !is_this || !name.name().is_any(&["$slots", "$scopedSlots"]) {
        return;
    }
    match (call_expr.args().first(), call_expr.args().get(1)) {
        (_, Some(second)) => drop(cx.report(second.outer_span(), MULTIPLE_ARGUMENTS)),
        (Some(first), None) if first.tag() == ExprTag::Spread => drop(cx.report(first, SPREAD_ARGUMENT)),
        _ => {}
    }
}

/// What a `const` is initialized with. For another variable, what was assigned to its name the last time before `identifier`. Not
/// what is in parentheses.
fn get_identifier_resolved_reference<'a>(identifier: Expr<'a>, cx: &Cx<'a, NoMultipleSlotArgs>) -> Option<Expr<'a>> {
    let Some(Node::VarDecl(declarator)) = identifier.symbol()?.declarations().next()?.node() else {
        return None;
    };
    let value = match declarator.var_kind() {
        VarKind::Const => declarator.init(),
        _ => {
            let assignments = cx.state.0.get_or_init(|| {
                let mut by_name: FxHashMap<Name<'a>, Vec<(u32, Expr<'a>)>> = FxHashMap::default();
                let mut assignment_targets = AssignmentTargets::default();
                for assignment in cx.file().exprs_of_kind(ExprTag::Assign) {
                    if let ExprKind::Assign { target, value, .. } = assignment.kind()
                        && let Some(name) = target.as_ident()
                        && !is_assignment_target(assignment, &mut assignment_targets)
                    {
                        by_name.entry(name).or_default().push((assignment.span().start, value));
                    }
                }
                by_name.values_mut().for_each(|it| utils::sort::sort_unstable_by_key(it, |it| it.0));
                by_name
            });
            let of_name = assignments.get(&identifier.as_ident()?)?;
            let before = of_name.get(..of_name.partition_point(|it| it.0 <= identifier.span().start))?;
            before.last().filter(|it| it.0 > declarator.span().end).map(|it| it.1)
        }
    };
    value.filter(|it| !it.is_parenthesized())
}
