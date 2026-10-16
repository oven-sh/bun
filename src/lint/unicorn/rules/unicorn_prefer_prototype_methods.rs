use bun_lint_oxlint::ast_util::{get_member_expr, is_method_call, static_property_name_or_regex};
use crate::unicorn::pad_fix_with_token_boundary;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prefers borrowing methods from the prototype instead of the instance.
pub struct PreferPrototypeMethods;

const KNOWN_METHOD: Message = Message::new("", "Prefer using `{{obj_name}}.prototype.{{method_name}}`.");
const UNKNOWN_METHOD: Message = Message::new("", "Prefer using method from `{{obj_name}}.prototype`.");

impl Rule for PreferPrototypeMethods {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-prototype-methods", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["apply", "bind", "call"]);
    /// `apply`, `bind`, `call`
    type State<'a> = [Name<'a>; 3];

    fn new(_: &Options) -> Self {
        PreferPrototypeMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        const METHODS: [&str; 3] = ["apply", "bind", "call"];
        METHODS.iter().any(|it| file.find_name(it).is_some()).then(|| METHODS.map(|it| file.name_of(it)))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        // `a.b`, `a.#b`. The whole of an optional chain, which here is in parentheses, is something else for oxlint.
        let callee = call_expr.callee();
        if !callee.member_name().is_some_and(|it| cx.state.contains(&it.name()))
            || call_expr.is_optional()
            || callee.is_optional()
            || callee.is_chain_root()
        {
            return;
        }
        let method_expr = if is_method_call(call_expr, Some(&["Reflect"]), Some(&["apply"]), Some(1), None) {
            // `Reflect.apply([].foo, …)`, `Reflect.apply({}.foo, …)`
            call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread)
        } else if is_method_call(call_expr, None, Some(&["apply", "bind", "call"]), None, None) {
            // `[].foo.{apply,bind,call}(…)`, `({}).foo.{apply,bind,call}(…)`
            get_member_expr(callee).and_then(Expr::object)
        } else {
            None
        };
        let Some(method_expr) = method_expr.filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_chain_root())
        else {
            return;
        };
        let Some(object_expr) = method_expr.object() else {
            return;
        };
        let constructor_name = match object_expr.kind() {
            ExprKind::Array(elements) if elements.is_empty() => "Array",
            ExprKind::Object(properties) if properties.is_empty() => "Object",
            _ => return,
        };
        let report = match static_property_name_or_regex(method_expr) {
            Some(method_name) => cx.report(method_expr, KNOWN_METHOD).data("method_name", method_name),
            None => cx.report(method_expr, UNKNOWN_METHOD),
        };
        report.data("obj_name", constructor_name).fix(|fixer| {
            let mut replacement = [constructor_name, ".prototype"].concat().into_bytes();
            pad_fix_with_token_boundary(fixer.file().text(), object_expr.span(), &mut replacement);
            fixer.replace(object_expr, replacement)
        });
    }
}
