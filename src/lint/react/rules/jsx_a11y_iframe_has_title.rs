use crate::jsx::{AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce iframe elements have a title attribute.
pub struct IframeHasTitle;

const IFRAME_HAS_TITLE: Message = Message::new("", "Missing `title` attribute for the `iframe` element.");

impl Rule for IframeHasTitle {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "iframe-has-title", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        IframeHasTitle
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        if *get_element_type(cx.file(), jsx_el) == *b"iframe"
            && !has_jsx_prop_ignore_case(jsx_el, "title").and_then(get_prop_value).is_some_and(is_title)
            && let Some(name) = jsx_el.tag()
        {
            cx.report(name, IFRAME_HAS_TITLE);
        }
    }
}

fn is_title(value: AttributeValue) -> bool {
    match value {
        AttributeValue::StringLiteral(literal) => !literal.value.is_empty(),
        // What is in parentheses, and an optional chain, is none of these for oxlint.
        AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() && !e.is_chain_root() => match e.kind() {
            ExprKind::String(value) => !value.bytes().is_empty(),
            ExprKind::Template(template) => !template.exprs().is_empty() || !template.raw(0).is_empty(),
            ExprKind::Ident(name) => !name.is("undefined"),
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
            ExprKind::Call(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Cond { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::New(_) => true,
            _ => false,
        },
        _ => false,
    }
}
