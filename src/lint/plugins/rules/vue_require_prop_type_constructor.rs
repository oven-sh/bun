use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, static_string};
use crate::oxlint::vue::{
    as_inner_object_expression, find_property, is_vue_component_options_object_excluding_instance, is_vue_file,
    is_vue_setup, key_name, object_properties,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require `props` type values to be a constructor function (e.g. `String`, `Number`, `Boolean`) rather than a string, number, or
/// other literal.
pub struct RequirePropTypeConstructor;

const REQUIRE_PROP_TYPE_CONSTRUCTOR: Message = Message::new("", "The \"{{prop_name}}\" property should be a constructor.");

impl Rule for RequirePropTypeConstructor {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-prop-type-constructor", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Object, ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequirePropTypeConstructor
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("props") {
            on = on.exprs(&[ExprTag::Object]);
        }
        if is_vue_setup(file) && file.mentions("defineProps") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Object => {
                if let ExprKind::Object(properties) = e.kind()
                    && is_vue_component_options_object_excluding_instance(e)
                {
                    verify_props(find_property(properties, "props").and_then(Prop::value), cx);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call().filter(|it| is_specific_id(it.callee(), "defineProps")) {
                    verify_props(call.args().first(), cx);
                }
            }
            _ => {}
        }
    }
}

type Context<'c, 'a> = &'c Cx<'a, RequirePropTypeConstructor>;

fn verify_props<'a>(props: Option<Expr<'a>>, cx: Context<'_, 'a>) {
    for prop in props.and_then(as_inner_object_expression).into_iter().flat_map(object_properties) {
        let (Some(prop_name), Some(value)) = (key_name(prop), prop.value().map(get_inner_expression)) else {
            continue;
        };
        // `a: T`, `a: [T, U]`, `a: { type: T }`, `a: { type: [T, U] }`
        let type_value = match value.kind() {
            ExprKind::Object(options) => find_property(options, "type").and_then(Prop::value).map(get_inner_expression),
            _ => Some(value),
        };
        match type_value.map(|it| (it, it.kind())) {
            Some((_, ExprKind::Array(elements))) => elements.iter().for_each(|it| check_and_report(it, prop_name, cx)),
            Some((type_value, _)) => check_and_report(type_value, prop_name, cx),
            None => {}
        }
    }
}

fn check_and_report<'a>(expr: Expr<'a>, prop_name: Name<'a>, cx: Context<'_, 'a>) {
    let expr = get_inner_expression(expr);
    let is_forbidden_type = match expr.kind() {
        ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::Template(_) => true,
        ExprKind::Binary { op, .. } => !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma),
        ExprKind::Unary { op, .. } => matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
        _ => false,
    };
    if is_forbidden_type {
        cx.report(expr, REQUIRE_PROP_TYPE_CONSTRUCTOR).data("prop_name", prop_name).fix(|fixer| {
            static_string(expr).filter(|it| text::is_identifier_name(it.bytes())).map(|it| fixer.replace(expr, it))
        });
    }
}
