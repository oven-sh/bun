use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::oxlint::vue::{
    as_inner_object_expression, define_component_object, exported_object, find_property, is_specific_static_name, is_vue_setup,
    object_properties,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// This rule disallows using arrow functions when defining a watcher.
pub struct NoArrowFunctionsInWatch;

const NO_ARROW_FUNCTIONS_IN_WATCH: Message = Message::new("", "You should not use an arrow function to define a watcher.");

impl Rule for NoArrowFunctionsInWatch {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-arrow-functions-in-watch", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrowFunctionsInWatch
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("watch") || is_vue_setup(file) {
            return;
        }
        on.stmts([StmtTag::ExportDefault], |_, stmt, cx| {
            for prop in exported_object(stmt).and_then(get_watch_object_expression).into_iter().flat_map(object_properties) {
                handle_watch_value(prop.value(), cx);
            }
        });
        if file.mentions("defineComponent") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                let object = e.as_call().filter(|it| it.args().len() == 1).and_then(define_component_object);
                for prop in object.and_then(get_watch_object_expression).into_iter().flat_map(object_properties) {
                    handle_watch_inner_property(prop, cx);
                }
            });
        }
    }
}

fn get_watch_object_expression<'a>(properties: List<'a, Prop<'a>>) -> Option<List<'a, Prop<'a>>> {
    find_property(properties, "watch")?.value().and_then(as_inner_object_expression)
}

fn is_arrow_function(e: Expr) -> bool {
    e.as_fn().is_some_and(Func::is_arrow)
}

/// `handler: () => {}`
fn handle_watch_inner_property<'a>(prop: Prop<'a>, cx: &Cx<'a, NoArrowFunctionsInWatch>) {
    if is_specific_static_name(prop, "handler")
        && let Some(value) = prop.value().filter(|it| is_arrow_function(get_inner_expression(*it)))
    {
        cx.report(value.outer_span(), NO_ARROW_FUNCTIONS_IN_WATCH);
    }
}

/// `() => {}`, `{ handler: () => {} }`, or an array of these.
fn handle_watch_value<'a>(value: Option<Expr<'a>>, cx: &Cx<'a, NoArrowFunctionsInWatch>) {
    let mut pending: SmallVec<[Expr<'a>; 4]> = value.into_iter().collect();
    while let Some(value) = pending.pop().map(get_inner_expression) {
        match value.kind() {
            ExprKind::Fn(func) if func.is_arrow() => drop(cx.report(value, NO_ARROW_FUNCTIONS_IN_WATCH)),
            ExprKind::Object(properties) => object_properties(properties).for_each(|it| handle_watch_inner_property(it, cx)),
            ExprKind::Array(elements) => pending.extend(elements.iter().filter(|it| it.tag() != ExprTag::Spread)),
            _ => {}
        }
    }
}
