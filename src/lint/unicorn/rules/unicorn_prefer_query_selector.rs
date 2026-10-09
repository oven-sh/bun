use bun_core::strings;
use bun_lint_oxlint::ast_util::{as_member_expression, plain};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `.querySelector()` over `.getElementById()`, and `.querySelectorAll()` over `.getElementsByClassName()` and
/// `.getElementsByTagName()`.
pub struct PreferQuerySelector;

const PREFER_QUERY_SELECTOR: Message = Message::new("", "Prefer `.{{good_method}}()` over `.{{bad_method}}()`.");

const METHODS: [&str; 4] = ["getElementById", "getElementsByClassName", "getElementsByTagName", "getElementsByName"];

impl Rule for PreferQuerySelector {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-query-selector", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferQuerySelector
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions_any(&METHODS) {
            on.exprs([ExprTag::Call], check);
        }
    }
}

fn check<'a>(_: &PreferQuerySelector, e: Expr<'a>, cx: &mut Cx<'a, PreferQuerySelector>) {
    let Some(call_expr) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
        return;
    };
    let Some(ExprKind::Dot { obj, name: property, chain }) = as_member_expression(call_expr.callee()).map(Expr::kind)
    else {
        return;
    };
    let property_name = property.bytes();
    if !property.name().is_any(&METHODS) || chain == Chain::Start || is_node_value_not_dom_node(obj) {
        return;
    }
    let Some(argument_expr) = call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
        return;
    };
    let preferred_selector = if property_name == b"getElementById" { "querySelector" } else { "querySelectorAll" };
    let report = cx
        .report(property, PREFER_QUERY_SELECTOR)
        .data("good_method", preferred_selector)
        .data("bad_method", property_name);
    let literal_value = match plain(argument_expr).map(Expr::kind) {
        Some(ExprKind::Null) => Some(&b""[..]),
        Some(ExprKind::String(value)) => Some(strings::trim_unicode_whitespace(value.bytes())),
        Some(ExprKind::Template(literal)) => literal.as_static().map(|it| strings::trim_unicode_whitespace(it.bytes())),
        // `getElementById(id)` is `` querySelector(`#${id}`) ``.
        Some(ExprKind::Ident(_)) if property_name == b"getElementById" => {
            report.fix(|fixer| {
                let replacement = [preferred_selector.as_bytes(), b"(`#${", argument_expr.text(), b"}`"].concat();
                fixer.replace(property.span().to(argument_expr.span()), replacement)
            });
            return;
        }
        _ => None,
    };
    let Some(literal_value) = literal_value else {
        return;
    };
    report.fix(|fixer| {
        if literal_value.is_empty() {
            return fixer.replace(property, preferred_selector);
        }
        let quotes_symbol = argument_expr.text().get(..1).unwrap_or_default();
        let argument = match property_name {
            b"getElementById" => [b"#", literal_value].concat(),
            // All of the classes.
            b"getElementsByClassName" => strings::split_unicode_whitespace(literal_value).fold(Vec::new(), |mut all, class| {
                all.push(b'.');
                all.extend_from_slice(class);
                all
            }),
            b"getElementsByName" => {
                let inner_quote: &[u8] = if quotes_symbol == b"'" { b"\"" } else { b"'" };
                [b"[name=", inner_quote, literal_value, inner_quote, b"]"].concat()
            }
            _ => literal_value.to_vec(),
        };
        let replacement = [preferred_selector.as_bytes(), b"(", quotes_symbol, &argument, quotes_symbol].concat();
        fixer.replace(property.span().to(argument_expr.span()), replacement)
    });
}

/// An array, a function, a class, an object, a template, a string.
fn is_node_value_not_dom_node(expr: Expr) -> bool {
    !expr.is_parenthesized()
        && matches!(
            expr.tag(),
            ExprTag::Array | ExprTag::Fn | ExprTag::Class | ExprTag::Object | ExprTag::Template | ExprTag::String
        )
}
