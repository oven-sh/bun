use bun_lint_oxlint::ast_util::plain;
use crate::unicorn::is_expression_statement;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer modern DOM APIs like `replaceWith` and `before` over older methods like `replaceChild` and `insertBefore`.
pub struct PreferModernDomApis;

const PREFER_MODERN_DOM_APIS: Message = Message::new("", "Prefer using `{{good_method}}` over `{{bad_method}}`.");

impl Rule for PreferModernDomApis {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-modern-dom-apis", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferModernDomApis
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["replaceChild", "insertBefore", "insertAdjacentText", "insertAdjacentElement"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| it.args().len() == 2) else {
                return;
            };
            let Some(ExprKind::Dot { obj, name: property, .. }) = plain(call_expr.callee()).map(Expr::kind) else {
                return;
            };
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
                    let is_safe =
                        |it: Expr| plain(it).and_then(Expr::as_ident).is_some_and(|name| !name.is("undefined"));
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
        });
    }
}
