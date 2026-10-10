use crate::oxlint::jsdoc::{
    JSDocFinder, JSDocPluginSettings, function_type, is_duplicated_special_tag, is_missing_special_tag,
    should_ignore_as_avoid, should_ignore_as_custom_skip, should_ignore_as_internal, should_ignore_as_private,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_specific_id;

/// Requires that return statements are documented with `@returns`.
pub struct RequireReturns {
    exempted_by: Vec<Box<[u8]>>,
    check_constructors: bool,
    check_getters: bool,
    force_require_return: bool,
    force_returns_with_async: bool,
}

const MISSING_RETURNS: Message = Message::new("", "Missing JSDoc `@returns` declaration for function.");
const DUPLICATE_RETURNS: Message = Message::new("", "Duplicate `@returns` tags.");

impl Rule for RequireReturns {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-returns", Kind::Suggestion);
    const ON: On = On::new().funcs();
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let exempted_by = if options.has("exemptedBy") { options.strings("exemptedBy") } else { vec!["inheritdoc"] };
        RequireReturns {
            exempted_by: exempted_by.iter().map(|it| it.as_bytes().into()).collect(),
            check_constructors: options.bool_or("checkConstructors", false),
            check_getters: options.bool_or("checkGetters", true),
            force_require_return: options.bool_or("forceRequireReturn", false),
            force_returns_with_async: options.bool_or("forceReturnsWithAsync", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check(func, cx);
    }
}

/// Of `new Promise((resolve) => ..)`: whether `resolve` is in a call that has arguments. `None` for everything else.
fn is_promise_resolve_with_value(expr: Expr) -> Option<bool> {
    let ExprKind::New(new_expr) = expr.kind() else {
        return None;
    };
    if expr.is_parenthesized() || !is_specific_id(new_expr.callee(), "Promise") {
        return None;
    }
    let executor = new_expr.args().first().filter(|it| !it.is_parenthesized()).and_then(Expr::as_fn);
    let resolver = executor.and_then(|it| it.params().first()).filter(|it| !it.is_rest()).and_then(|it| it.pat().symbol());
    let is_in_call_with_arguments = |reference: Reference| {
        let call = reference.expr().filter(|it| !it.is_parenthesized()).and_then(|it| it.parent().as_expr()?.as_call());
        call.is_some_and(|it| !it.args().is_empty())
    };
    Some(resolver.is_some_and(|it| it.references().any(is_in_call_with_arguments)))
}

fn return_value(stmt: Stmt<'_>) -> Option<Expr<'_>> {
    match stmt.kind() {
        StmtKind::Return(value) => value,
        _ => None,
    }
}

/// Whether oxlint takes the function for an asynchronous one, and whether it returns a value: what the last `return` says.
fn attributes(func: Func) -> (bool, bool) {
    let after = |(is_async, _): (bool, bool), value: Expr| match is_promise_resolve_with_value(value) {
        Some(has_value) => (true, has_value),
        None => (is_async, true),
    };
    let start = (func.is_async(), false);
    match func.body() {
        FnBody::Expr(value) => after(start, value),
        _ => func.returns().filter_map(return_value).fold(start, after),
    }
}

impl RequireReturns {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if function_type(func).is_none() {
            return;
        }
        let Some(func_def_node) = cx.state.get_function_nearest_jsdoc_node(func) else {
            return;
        };
        let Some(jsdoc) = cx.state.get_all_by_node(func_def_node).next_back() else {
            return;
        };
        let settings = JSDocPluginSettings::new(cx.file());
        let is_checked_kind = func_def_node.method_definition.is_none_or(|it| match it.kind() {
            MemberKind::Getter => self.check_getters,
            _ if it.is_constructor() => self.check_constructors,
            _ => true,
        });
        if !is_checked_kind
            || should_ignore_as_custom_skip(jsdoc)
            || should_ignore_as_avoid(jsdoc, &settings, &self.exempted_by)
            || should_ignore_as_private(jsdoc, &settings)
            || should_ignore_as_internal(jsdoc, &settings)
        {
            return;
        }
        if !self.force_require_return {
            let (is_async, has_return_value) = attributes(func);
            if !has_return_value && !(is_async && self.force_returns_with_async) {
                return;
            }
        }
        let resolved_returns_tag_name = settings.resolve_tag_name("returns");
        if is_missing_special_tag(jsdoc.tags(), resolved_returns_tag_name) {
            cx.report(func.estree_span(), MISSING_RETURNS);
        } else if let Some(span) = is_duplicated_special_tag(jsdoc.tags(), resolved_returns_tag_name) {
            cx.report(span, DUPLICATE_RETURNS);
        }
    }
}
