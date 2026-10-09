use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, parent_node, static_name};
use crate::oxlint::vue::{
    DestructuredDefaults, NamedTypeBudget, as_inner_object_expression, find_property, first_type_argument,
    for_each_define_props_type_signature, is_optional_signature, is_specific_static_name,
    is_vue_component_options_object_excluding_instance, is_vue_setup, key_name, key_span, object_properties,
    signature_key,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use std::rc::Rc;

/// Requires a default value to be set for props that are not marked as `required`.
pub struct RequireDefaultProp;

const REQUIRE_DEFAULT_PROP: Message = Message::new("", "Prop '{{prop_name}}' requires default value to be set.");

const NATIVE_TYPES: [&str; 7] = ["String", "Number", "Boolean", "Function", "Object", "Array", "Symbol"];

type Context<'c, 'a> = &'c Cx<'a, RequireDefaultProp>;

#[derive(Default)]
pub struct State<'a> {
    defaults: DestructuredDefaults<'a>,
    budget: NamedTypeBudget,
}

/// Where the props of a `defineProps()` can have default values.
#[derive(Default)]
struct PropsContext<'a> {
    /// `const { a = 1 } = defineProps()`: the `a`.
    destructure: Option<Rc<FxHashSet<Name<'a>>>>,
    has_with_defaults: bool,
    /// `withDefaults(defineProps(), { a: 1 })`: the `a`.
    with_defaults: Option<FxHashSet<Name<'a>>>,
}

impl Rule for RequireDefaultProp {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-default-prop", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireDefaultProp
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.mentions("props") {
            on.exprs([ExprTag::Object], |_, e, cx| {
                if let ExprKind::Object(properties) = e.kind()
                    && is_vue_component_options_object_excluding_instance(e)
                    && let Some(props) = find_property(properties, "props").and_then(Prop::value).and_then(as_inner_object_expression)
                {
                    check_object_props(props, cx, &PropsContext::default());
                }
            });
        }
        if is_vue_setup(file) && file.mentions("defineProps") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                let Some(call) = e.as_call() else {
                    return;
                };
                let is_call_of = |node: Option<Expr>, name: &str| {
                    node.and_then(Expr::as_call).is_some_and(|it| is_specific_id(it.callee(), name))
                };
                if is_call_of(Some(e), "defineProps") {
                    // With a `withDefaults` around it, that is looked at.
                    if !is_call_of(parent_node(e).and_then(Node::as_expr), "withDefaults") {
                        let pc = destructure_context(e, false, None, cx);
                        handle_define_props(call, cx, &pc);
                    }
                } else if is_call_of(Some(e), "withDefaults")
                    && call.args().len() == 2
                    && let (Some(first), Some(second)) = (call.args().first(), call.args().get(1))
                    && second.tag() != ExprTag::Spread
                    && !get_inner_expression(first).is_chain_root()
                    && is_call_of(Some(get_inner_expression(first)), "defineProps")
                    && let Some(define_props) = get_inner_expression(first).as_call()
                {
                    let pc = destructure_context(e, true, as_inner_object_expression(second), cx);
                    handle_define_props(define_props, cx, &pc);
                }
            });
        }
        State::default()
    }
}

fn destructure_context<'a>(
    node: Expr<'a>,
    has_with_defaults: bool,
    with_defaults: Option<List<'a, Prop<'a>>>,
    cx: &mut Cx<'a, RequireDefaultProp>,
) -> PropsContext<'a> {
    PropsContext {
        destructure: cx.state.defaults.around(node),
        has_with_defaults,
        with_defaults: with_defaults.map(|it| object_properties(it).filter_map(key_name).collect()),
    }
}

fn handle_define_props<'a>(call: Call<'a>, cx: Context<'_, 'a>, pc: &PropsContext<'a>) {
    if let Some(arg) = call.args().first().filter(|it| it.tag() != ExprTag::Spread) {
        if let Some(props) = as_inner_object_expression(arg) {
            check_object_props(props, cx, pc);
        }
    } else if let Some(first) = first_type_argument(call) {
        for_each_define_props_type_signature(first, &cx.state.budget, &mut |signature| check_type_signature(signature, cx, pc));
    }
}

fn check_object_props<'a>(props: List<'a, Prop<'a>>, cx: Context<'_, 'a>, pc: &PropsContext<'a>) {
    for prop in object_properties(props).filter(|it| it.kind() != PropKind::Shorthand) {
        let Some(value) = prop.value().map(get_inner_expression) else {
            continue;
        };
        if !is_without_default_value(value) || is_boolean_prop(value) {
            continue;
        }
        let name = key_name(prop);
        // Under a destructuring a key whose name is not known is ignored.
        if pc.destructure.as_ref().is_some_and(|it| name.is_none_or(|name| it.contains(&name))) {
            continue;
        }
        let report = cx.report(prop, REQUIRE_DEFAULT_PROP);
        match name {
            Some(name) => report.data("prop_name", name),
            None => report.data("prop_name", [&b"["[..], cx.file().slice(key_span(prop)), &b"]"[..]].concat()),
        };
    }
}

fn check_type_signature<'a>(signature: Member<'a>, cx: Context<'_, 'a>, pc: &PropsContext<'a>) {
    let Some(name) = signature_key(signature).filter(|_| is_optional_signature(signature)).and_then(static_name) else {
        return;
    };
    let is_single_boolean_type = signature.kind() == MemberKind::Property
        && signature.ty().is_some_and(|it| matches!(it.kind(), TypeKind::Keyword(Keyword::Boolean)) && !it.is_parenthesized());
    // Without `withDefaults` and a destructuring there is no place for a default value.
    if is_single_boolean_type
        || !pc.has_with_defaults && pc.destructure.is_none()
        || pc.with_defaults.as_ref().is_some_and(|it| it.contains(&name))
        || pc.destructure.as_ref().is_some_and(|it| it.contains(&name))
    {
        return;
    }
    cx.report(signature, REQUIRE_DEFAULT_PROP).data("prop_name", name);
}

/// `value`: without `as T` and the like.
fn is_without_default_value(value: Expr) -> bool {
    match value.kind() {
        ExprKind::Object(options) => {
            let is_true = |it: Prop| it.value().is_some_and(|it| get_inner_expression(it).tag() == ExprTag::True);
            !object_properties(options)
                .any(|it| is_specific_static_name(it, "default") || is_specific_static_name(it, "required") && is_true(it))
        }
        ExprKind::Ident(name) => name.is_any(&NATIVE_TYPES),
        // What is called or read is taken to make the default value. A `ChainExpression` is neither.
        ExprKind::Call(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => value.is_chain_root(),
        _ => true,
    }
}

fn is_boolean_prop(value: Expr) -> bool {
    is_value_node_of_boolean_type(value)
        || matches!(value.kind(), ExprKind::Object(options) if object_properties(options).any(|it| {
            matches!(it.key().map(Key::kind), Some(KeyKind::Ident(key)) if key.is("type"))
                && it.value().is_some_and(|it| is_value_node_of_boolean_type(get_inner_expression(it)))
        }))
}

/// `Boolean`, `[Boolean]`
fn is_value_node_of_boolean_type(value: Expr) -> bool {
    match value.kind() {
        ExprKind::Ident(name) => name.is("Boolean"),
        ExprKind::Array(elements) => {
            let mut elements = elements.iter().filter(|it| it.tag() != ExprTag::Missing);
            matches!((elements.next(), elements.next()), (Some(first), None) if is_specific_id(first, "Boolean"))
        }
        _ => false,
    }
}
