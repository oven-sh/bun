use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, parent_node, static_property_name};
use bun_lint_oxlint::import::{AssignmentTargets, is_assignment_target};
use crate::oxlint::vue::{
    ComputedContext, EnclosingFunctions, find_computed_context, is_specific_static_name, is_this_object,
    is_vue_component_options_object, is_vue_setup, object_of, property_of_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow side effects in computed properties.
pub struct NoSideEffectsInComputedProperties;

const UNEXPECTED_SIDE_EFFECT_IN_PROPERTY: Message = Message::new("", "Unexpected side effect in \"{{key}}\" computed property.");
const UNEXPECTED_SIDE_EFFECT_IN_FUNCTION: Message = Message::new("", "Unexpected side effect in computed function.");

const MUTATING_METHODS: [&str; 9] = ["push", "pop", "shift", "unshift", "reverse", "splice", "sort", "copyWithin", "fill"];

#[derive(Default)]
pub struct State<'a> {
    functions: EnclosingFunctions<'a>,
    assignment_targets: AssignmentTargets<'a>,
    /// That something is in the body of the `setup` of a component.
    in_setup: AncestorMemo<'a, ()>,
}

impl Rule for NoSideEffectsInComputedProperties {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-side-effects-in-computed-properties", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoSideEffectsInComputedProperties
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.mentions("computed") {
            on.exprs([ExprTag::Dot, ExprTag::Index], check);
        }
        State::default()
    }
}

type Context<'c, 'a> = &'c mut Cx<'a, NoSideEffectsInComputedProperties>;

fn report_in_property<'a>(at: Span, member: Expr<'a>, cx: Context<'_, 'a>) {
    if let Some(ComputedContext::OptionsApi(key)) = find_computed_context(member, &mut cx.state.functions) {
        cx.report(at, UNEXPECTED_SIDE_EFFECT_IN_PROPERTY).data("key", key.map_or(&b"Unknown"[..], Name::bytes));
    }
}

fn check<'a>(_: &NoSideEffectsInComputedProperties, member: Expr<'a>, cx: Context<'_, 'a>) {
    let Some(object) = member.object().filter(|_| !member.is_private_member() && !member.is_jsx_tag_name()) else {
        return;
    };
    let is_call = |node: Option<Node>| node.and_then(Node::as_expr).is_some_and(|it| it.tag() == ExprTag::Call);
    if let ExprKind::Dot { name, .. } = member.kind() {
        // `this.$set(..)`, `(this.$set)(..)`
        if name.name().is("$set") && is_this_object(object) && !member.is_chain_root() && is_call(Some(member.parent())) {
            return report_in_property(name.span(), member, cx);
        }
        // `Vue.set(..)`
        if name.name().is("set") && object.is_ident("Vue") && !object.is_parenthesized() {
            if is_call(parent_node(member)) {
                report_in_property(name.span(), member, cx);
            }
            return;
        }
    }
    if !matches!(object.tag(), ExprTag::This | ExprTag::Ident) || object.is_parenthesized() {
        return;
    }
    let Some(mutation_span) = find_mutation_span(member, true, &mut cx.state.assignment_targets) else {
        return;
    };
    match find_computed_context(member, &mut cx.state.functions) {
        Some(ComputedContext::OptionsApi(key)) => {
            if is_this_object(object)
                && let Some(mutation_span) = find_mutation_span(member, false, &mut cx.state.assignment_targets)
            {
                cx.report(mutation_span, UNEXPECTED_SIDE_EFFECT_IN_PROPERTY).data("key", key.map_or(&b"Unknown"[..], Name::bytes));
            }
        }
        Some(ComputedContext::CompositionApi(getter)) if is_setup_variable(object, getter, &mut cx.state.in_setup) => {
            cx.report(mutation_span, UNEXPECTED_SIDE_EFFECT_IN_FUNCTION);
        }
        _ => {}
    }
}

/// What changes `start`, or a property of it. `seed_start`: `start` itself can be the `a.push` of `a.push()`.
fn find_mutation_span<'a>(start: Expr<'a>, seed_start: bool, assignment_targets: &mut AssignmentTargets<'a>) -> Option<Span> {
    let mut current = start;
    let mut last_static_name = static_property_name(start).filter(|_| seed_start);
    loop {
        let parent = current.parent().as_expr()?;
        match parent.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == current && !parent.is_private_member() => {
                last_static_name = static_property_name(parent);
                current = parent;
            }
            ExprKind::Assign { target, .. } if target == current && !is_assignment_target(parent, assignment_targets) => {
                return Some(parent.span());
            }
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete, .. } => {
                return Some(parent.span());
            }
            ExprKind::Call(call) if call.callee() == current => {
                return last_static_name.filter(|it| it.is_any(&MUTATING_METHODS)).map(|_| parent.span());
            }
            ExprKind::Call(call) if call.args().first() == Some(current) && is_object_assign(call) => return Some(parent.span()),
            _ => return None,
        }
    }
}

/// `Object.assign(..)`
fn is_object_assign(call: Call) -> bool {
    matches!(get_inner_expression(call.callee()).kind(), ExprKind::Dot { obj, name, .. }
        if name.name().is("assign") && is_specific_id(obj, "Object"))
}

/// What `ident` refers to is declared outside of the getter: in a `<script setup>` and not imported, or in a `setup()`.
fn is_setup_variable<'a>(ident: Expr<'a>, getter: Func<'a>, in_setup: &mut AncestorMemo<'a, ()>) -> bool {
    let Some(declaration) = ident.symbol().and_then(|it| it.declarations().next()) else {
        return false;
    };
    if !declaration.name_span().is_some_and(|it| !getter.estree_span().contains(it)) {
        return false;
    }
    if is_vue_setup(ident.file()) {
        return declaration.kind() != Some(DeclarationKind::ImportBinding);
    }
    let node = match declaration {
        Declaration::Var(id) | Declaration::Param(id) => Node::Pat(id),
        Declaration::Fn(function) => Node::Func(function),
        Declaration::Class(class) => Node::Class(class),
        _ => return false,
    };
    // `child`: what of the function the declaration is in.
    let is_body_of_setup = |child: Node<'a>, function: Func<'a>| {
        let body_span = match function.body() {
            FnBody::Expr(e) => Some(e.outer_span()),
            _ => function.body_span(),
        };
        body_span.is_some_and(|it| it.contains(child.span()))
            && property_of_function(function).is_some_and(|prop| {
                is_specific_static_name(prop, "setup") && object_of(prop).is_some_and(is_vue_component_options_object)
            })
    };
    in_setup.find(node, |child, parent| parent.as_func().filter(|it| is_body_of_setup(child, *it)).map(|_| ())).is_some()
}
