use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id};
use crate::oxlint::vue::{
    Enclosing, EnclosingFunctions, enclosing_function, is_specific_static_name, is_vue_component_options_object,
    is_vue_file, object_of, object_properties, parent_object_property, property_of_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// Disallow deprecated `this` access in props default function (in Vue.js 3.0.0+).
pub struct NoDeprecatedPropsDefaultThis;

const NO_DEPRECATED_PROPS_DEFAULT_THIS: Message =
    Message::new("", "Props default value factory functions no longer have access to `this`.");

#[derive(Default)]
pub struct State<'a> {
    functions: EnclosingFunctions<'a>,
    /// Whether a function makes the default value of a prop.
    is_default_factory: FxHashMap<Func<'a>, bool>,
}

impl Rule for NoDeprecatedPropsDefaultThis {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-props-default-this", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::This]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDeprecatedPropsDefaultThis
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_vue_file(file) && file.mentions("props")).then(State::default)
    }

    fn expr<'a>(&self, this_expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !this_expr.is_jsx_tag_name()
            && let Some(function) = enclosing_function(Node::Expr(this_expr), Enclosing::Function, &mut cx.state.functions)
            && *cx.state.is_default_factory.entry(function).or_insert_with(|| is_default_factory(function))
        {
            cx.report(this_expr, NO_DEPRECATED_PROPS_DEFAULT_THIS);
        }
    }
}

/// `props: { a: { default() {} } }`
fn is_default_factory(function: Func) -> bool {
    if let Some(default_prop) = property_of_function(function)
        && is_specific_static_name(default_prop, "default")
        && let Some(opts) = object_of(default_prop).filter(|it| !has_function_type(*it))
        && let Some(props_object) = parent_object_property(opts).and_then(object_of)
        && let Some(props_prop) = parent_object_property(props_object)
    {
        return is_specific_static_name(props_prop, "props") && object_of(props_prop).is_some_and(is_vue_component_options_object);
    }
    false
}

/// With `type: Function` the `default` is the value itself.
fn has_function_type(opts: Expr) -> bool {
    let ExprKind::Object(properties) = opts.kind() else {
        return false;
    };
    for value in object_properties(properties).filter(|it| is_specific_static_name(*it, "type")).filter_map(Prop::value) {
        if is_specific_id(value, "Function") {
            return true;
        }
        if let ExprKind::Array(elements) = get_inner_expression(value).kind() {
            return elements.iter().any(|it| is_specific_id(it, "Function"));
        }
    }
    false
}
