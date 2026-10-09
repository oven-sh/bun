use bun_lint_oxlint::ast_util::{get_inner_expression, is_specific_id, iter_outer_expressions, static_name};
use crate::oxlint::vue::{
    AfterAwait, call_of_callee, define_component_object, exported_object, is_vue_file, is_vue_setup, setup_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow asynchronously registered `expose`.
pub struct NoExposeAfterAwait;

const NO_EXPOSE_AFTER_AWAIT: Message = Message::new("", "`{{name}}` is forbidden after an `await` expression.");

impl Rule for NoExposeAfterAwait {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-expose-after-await", Kind::Problem);
    /// Made for the first `setup` that can expose something.
    type State<'a> = Option<AfterAwait<'a>>;

    fn new(_: &Options) -> Self {
        NoExposeAfterAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_vue_file(file) || !file.has_exprs([ExprTag::Await]) {
            return None;
        }
        if file.mentions("setup") {
            on.stmts([StmtTag::ExportDefault], |_, stmt, cx| check_setup_in_object(exported_object(stmt), cx));
            if file.mentions("defineComponent") {
                on.exprs([ExprTag::Call], |_, e, cx| check_setup_in_object(e.as_call().and_then(define_component_object), cx));
            }
        }
        if is_vue_setup(file) && file.mentions("defineExpose") {
            on.finish(|_, cx| check_script_setup(cx));
        }
        None
    }
}

fn check_setup_in_object<'a>(properties: Option<List<'a, Prop<'a>>>, cx: &mut Cx<'a, NoExposeAfterAwait>) {
    let Some(function) = properties.and_then(setup_function) else {
        return;
    };
    let Some(second_param) = function.params().get(1).filter(|it| !it.is_rest()).map(Param::pat) else {
        return;
    };
    // `setup(_, { expose })`, `setup(_, ctx)`
    let (binding, is_ctx) = match second_param.kind() {
        PatKind::Object(properties) => {
            let is_expose = |it: &PatProp| !it.is_rest() && it.key().and_then(static_name).is_some_and(|key| key.is("expose"));
            (properties.iter().filter(is_expose).map(PatProp::value).find(|it| it.tag() == PatTag::Ident), false)
        }
        PatKind::Ident(_) => (Some(second_param), true),
        _ => return,
    };
    let Some(symbol) = binding.and_then(Pat::symbol) else {
        return;
    };
    let mut after_await = cx.state.take().unwrap_or_else(|| AfterAwait::new(cx.file()));
    for ident in symbol.references().filter_map(|it| it.expr()) {
        // What is called: `expose`, `ctx.expose`.
        let callee = match iter_outer_expressions(ident).next() {
            _ if !is_ctx => Some(ident),
            Some(Node::Expr(member)) => match member.kind() {
                ExprKind::Dot { obj, name, .. } if name.name().is("expose") && get_inner_expression(obj) == ident => Some(member),
                _ => None,
            },
            _ => None,
        };
        // `(ctx?.expose)()` calls a `ChainExpression`.
        if let Some(call) = callee.filter(|it| !it.is_chain_root()).and_then(call_of_callee)
            && after_await.function_of(Node::Expr(call)) == Some(function)
        {
            cx.report(call, NO_EXPOSE_AFTER_AWAIT).data("name", "expose");
        }
    }
    cx.state = Some(after_await);
}

/// `defineExpose()` as a statement, after a statement with an `await`.
fn check_script_setup<'a>(cx: &Cx<'a, NoExposeAfterAwait>) {
    let file = cx.file();
    let mut in_function = AncestorMemo::default();
    let is_function = |it: Node| matches!(it, Node::Func(func) if func.kind() != FnKind::StaticBlock);
    let awaits = file.exprs_of_kind(ExprTag::Await);
    let at_top_level = awaits.filter(|it| in_function.find(Node::Expr(*it), |_, parent| is_function(parent).then_some(())).is_none());
    let Some(first_await) = at_top_level.map(|it| it.span().start).min() else {
        return;
    };
    for stmt in file.body().iter().filter(|it| it.span().start > first_await) {
        if let StmtKind::Expr(e) = stmt.kind()
            && let Some(call) = get_inner_expression(e).as_call()
            && is_specific_id(call.callee(), "defineExpose")
        {
            cx.report(get_inner_expression(e), NO_EXPOSE_AFTER_AWAIT).data("name", "defineExpose");
        }
    }
}
