use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, is_specific_id, static_property_name};
use crate::oxlint::vue::{
    as_inner_object_expression, exported_object, find_property, is_vue_setup, key_name, key_span, object_properties,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces that a props statement contains a type definition.
pub struct RequirePropTypes;

const REQUIRE_TYPE: Message = Message::new("", "Prop \"{{name}}\" should define at least its type.");

type Context<'c, 'a> = &'c Cx<'a, RequirePropTypes>;

/// The outer one first, as oxlint: `defineModel()` in the list of `defineProps` is reported twice at one place.
const CALLS: NodeTags = NodeTags::new().exprs(&[ExprTag::Call]);

impl Rule for RequirePropTypes {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-prop-types", Kind::Suggestion);
    const ON: On = On::new().enter(CALLS).exprs(&[ExprTag::New]).stmts(&[StmtTag::ExportDefault]);
    no_state!();

    fn new(_: &Options) -> Self {
        RequirePropTypes
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if is_vue_setup(file) {
            if file.mentions_any(&["defineProps", "defineModel"]) {
                on = on.enter(CALLS);
            }
        } else if file.mentions("props") {
            on = on.stmts(&[StmtTag::ExportDefault]).exprs(&[ExprTag::New]);
        }
        on
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Expr(e) = node {
            run_on_setup(e, cx);
        }
    }

    // `new Vue({ .. })`
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::New(new_expr) = e.kind()
            && is_specific_id(new_expr.callee(), "Vue")
        {
            check_options_props(new_expr.args().first().and_then(as_inner_object_expression), cx);
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // `export default { .. }`, `export default Vue.extend({ .. })`
        let extended = || match stmt.kind() {
            StmtKind::ExportDefault(e) if !e.is_parenthesized() && !e.is_chain_root() => {
                let call = e.as_call()?;
                let is_extend = get_member_expr(call.callee()).and_then(static_property_name).is_some_and(|it| it.is("extend"));
                call.args().first().filter(|_| is_extend).and_then(as_inner_object_expression)
            }
            _ => None,
        };
        check_options_props(exported_object(stmt).or_else(extended), cx);
    }
}

fn is_plain(e: &Expr) -> bool {
    !e.is_parenthesized()
}

fn run_on_setup<'a>(e: Expr<'a>, cx: Context<'_, 'a>) {
    let Some(call_expr) = e.as_call().filter(|it| it.type_args().angle_brackets_span().is_none()) else {
        return;
    };
    match get_inner_expression(call_expr.callee()).as_ident().map(Name::bytes) {
        Some(b"defineProps") => match call_expr.args().first().filter(is_plain).map(Expr::kind) {
            Some(ExprKind::Object(properties)) => check_props(properties, cx),
            Some(ExprKind::Array(elements)) => check_array_props(elements, cx),
            _ => {}
        },
        Some(b"defineModel") => check_define_model(e, call_expr, cx),
        _ => {}
    }
}

fn check_define_model<'a>(e: Expr<'a>, call_expr: Call<'a>, cx: Context<'_, 'a>) {
    // `defineModel()`, `defineModel({ .. })`, `defineModel("name", { .. })`
    let (name, options) = match call_expr.args().first().map(|it| (it, it.kind())) {
        None => (None, None),
        Some((first, _)) if !is_plain(&first) => return,
        Some((_, ExprKind::String(name))) => (Some(name), call_expr.args().get(1).filter(is_plain)),
        Some((first, ExprKind::Object(_))) => (None, Some(first)),
        Some(_) => return,
    };
    let has_type = options.is_some_and(|it| match it.kind() {
        ExprKind::Ident(_) => true,
        ExprKind::Object(properties) => prop_value_has_type(properties),
        _ => false,
    });
    if !has_type {
        cx.report(e, REQUIRE_TYPE).data("name", name.map_or(&b"modelValue"[..], Name::bytes));
    }
}

fn check_options_props<'a>(properties: Option<List<'a, Prop<'a>>>, cx: Context<'_, 'a>) {
    match properties.and_then(|it| find_property(it, "props")).and_then(Prop::value).map(|it| get_inner_expression(it).kind()) {
        Some(ExprKind::Object(properties)) => check_props(properties, cx),
        Some(ExprKind::Array(elements)) => check_array_props(elements, cx),
        _ => {}
    }
}

fn check_props<'a>(properties: List<'a, Prop<'a>>, cx: Context<'_, 'a>) {
    for prop in object_properties(properties) {
        let Some(key) = key_name(prop) else {
            cx.report(key_span(prop), REQUIRE_TYPE).data("name", "Unknown prop");
            continue;
        };
        let is_invalid = match prop.value().map(|it| get_inner_expression(it).kind()) {
            Some(ExprKind::Object(options)) => !prop_value_has_type(options),
            Some(ExprKind::Array(elements)) => elements.is_empty(),
            Some(ExprKind::Fn(func)) => !func.is_arrow(),
            _ => false,
        };
        if is_invalid {
            cx.report(prop, REQUIRE_TYPE).data("name", key);
        }
    }
}

fn check_array_props<'a>(elements: List<'a, Expr<'a>>, cx: Context<'_, 'a>) {
    for expr in elements.iter().filter(|it| !matches!(it.tag(), ExprTag::Spread | ExprTag::Missing)) {
        let name = match expr.kind() {
            _ if expr.is_parenthesized() => None,
            ExprKind::String(name) | ExprKind::Ident(name) => Some(name),
            ExprKind::Template(template) => template.as_static(),
            _ => None,
        };
        cx.report(expr.outer_span(), REQUIRE_TYPE).data("name", name.map_or(&b"Unknown prop"[..], Name::bytes));
    }
}

/// There is a `type`, which is no empty array, or a `validator`.
fn prop_value_has_type<'a>(properties: List<'a, Prop<'a>>) -> bool {
    object_properties(properties).any(|prop| match key_name(prop).map(Name::bytes) {
        Some(b"type") => !matches!(prop.value().map(|it| get_inner_expression(it).kind()), Some(ExprKind::Array(it)) if it.is_empty()),
        Some(b"validator") => true,
        _ => false,
    })
}
