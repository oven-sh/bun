use bun_lint_oxlint::ast_util::plain;
use crate::unicorn::is_expression_statement;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer modern DOM APIs like `replaceWith` and `before` over older methods like `replaceChild` and `insertBefore`.
pub struct PreferModernDomApis;

const PREFER_MODERN_DOM_APIS: Message = Message::new("", "Prefer using `{{good_method}}` over `{{bad_method}}`.");

impl Rule for PreferModernDomApis {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-modern-dom-apis", Kind::Suggestion).has_suggestions();
    const ON: On =
        On::new().method_calls(&["replaceChild", "insertBefore", "insertAdjacentText", "insertAdjacentElement"]);
    /// The names of the methods.
    type State<'a> = [Name<'a>; 4];

    fn new(_: &Options) -> Self {
        PreferModernDomApis
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        const METHODS: [&str; 4] = ["replaceChild", "insertBefore", "insertAdjacentText", "insertAdjacentElement"];
        METHODS.iter().any(|it| file.find_name(it).is_some()).then(|| METHODS.map(|it| file.name_of(it)))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let callee = call_expr.callee();
        let Some((obj, property, _)) = callee.as_dot().filter(|it| cx.state.contains(&it.1.name())) else {
            return;
        };
        if call_expr.args().len() != 2 || plain(callee).is_none() {
            return;
        }
        let (Some(first), Some(second)) = (call_expr.args().first(), call_expr.args().get(1)) else {
            return;
        };
        let method = property.bytes();
        // What the new method is called on, and with.
        let (preferred_method, reference, content, can_fix) = match method {
            b"replaceChild" | b"insertBefore" => {
                if plain(obj).is_none_or(|it| it.tag() != ExprTag::Ident) || call_expr.is_optional() {
                    return;
                }
                // Another order could change what complex arguments do.
                let is_safe = |it: Expr| plain(it).and_then(Expr::as_ident).is_some_and(|name| !name.is("undefined"));
                let preferred_method = if method == b"replaceChild" { "replaceWith" } else { "before" };
                (preferred_method, second, first, is_safe(first) && is_safe(second) && is_expression_statement(e))
            }
            b"insertAdjacentText" | b"insertAdjacentElement" => {
                let preferred_method = match plain(first).and_then(Expr::as_string).map(Name::bytes) {
                    Some(b"beforebegin") => "before",
                    Some(b"afterbegin") => "prepend",
                    Some(b"beforeend") => "append",
                    Some(b"afterend") => "after",
                    _ => return,
                };
                (preferred_method, obj, second, method == b"insertAdjacentText" || is_expression_statement(e))
            }
            _ => return,
        };
        let report = cx
            .report(property, PREFER_MODERN_DOM_APIS)
            .data("good_method", preferred_method)
            .data("bad_method", method);
        if can_fix {
            let data = [("good_method", preferred_method.as_bytes()), ("bad_method", method)];
            report.suggest_with(PREFER_MODERN_DOM_APIS, &data, |fixer| {
                let source = |it: Expr<'a>| fixer.file().slice(it.outer_span());
                fixer.replace(
                    e,
                    [source(reference), b".", preferred_method.as_bytes(), b"(", source(content), b")"].concat(),
                )
            });
        }
    }
}
