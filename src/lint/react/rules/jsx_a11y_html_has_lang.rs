use crate::jsx::{AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensures that every HTML document has a lang attribute.
pub struct HtmlHasLang;

const MISSING_LANG_PROP: Message = Message::new("", "Missing lang attribute.");
const MISSING_LANG_VALUE: Message = Message::new("", "Missing value for `lang` attribute");

impl Rule for HtmlHasLang {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "html-has-lang", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        HtmlHasLang
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        if *get_element_type(cx.file(), jsx_el) != *b"html" {
            return;
        }
        match has_jsx_prop_ignore_case(jsx_el, "lang") {
            Some(lang_prop) if is_valid_lang_prop(lang_prop) => {}
            Some(_) => {
                cx.report(jsx_el.opening_span(), MISSING_LANG_VALUE);
            }
            None => {
                if let Some(name) = jsx_el.tag() {
                    cx.report(name, MISSING_LANG_PROP);
                }
            }
        }
    }
}

fn is_valid_lang_prop(item: Prop) -> bool {
    match get_prop_value(item) {
        Some(AttributeValue::ExpressionContainer(e)) if !e.is_parenthesized() => match e.kind() {
            ExprKind::Missing | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) => false,
            ExprKind::Ident(name) => !name.is("undefined"),
            ExprKind::String(value) => !value.bytes().is_empty(),
            ExprKind::Template(template) => !template.exprs().is_empty() || !template.raw(0).is_empty(),
            _ => true,
        },
        Some(AttributeValue::StringLiteral(literal)) => !literal.value.is_empty(),
        _ => true,
    }
}
