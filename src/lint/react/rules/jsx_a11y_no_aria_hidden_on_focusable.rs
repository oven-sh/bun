use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case, parse_jsx_value,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that `aria-hidden="true"` is not set on focusable elements.
pub struct NoAriaHiddenOnFocusable;

const NO_ARIA_HIDDEN_ON_FOCUSABLE: Message = Message::new("", "`aria-hidden` must not be true on focusable elements.");

impl Rule for NoAriaHiddenOnFocusable {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-aria-hidden-on-focusable", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAriaHiddenOnFocusable
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(jsx_el) = as_jsx_element(e)
            && let Some(aria_hidden_prop) = has_jsx_prop_ignore_case(jsx_el, "aria-hidden")
            && is_aria_hidden_true(aria_hidden_prop)
            && is_focusable(cx.file(), jsx_el)
        {
            cx.report(aria_hidden_prop, NO_ARIA_HIDDEN_ON_FOCUSABLE).fix(|fixer| fixer.remove(aria_hidden_prop));
        }
    }
}

fn is_aria_hidden_true(attr: Prop) -> bool {
    match get_prop_value(attr) {
        Some(AttributeValue::StringLiteral(literal)) => literal.value == b"true",
        Some(_) => false,
        None => true,
    }
}

fn is_focusable<'a>(file: &'a File<'a>, element: Jsx<'a>) -> bool {
    if let Some(attr_value) = has_jsx_prop_ignore_case(element, "tabIndex").and_then(get_prop_value) {
        return parse_jsx_value(attr_value).is_some_and(|num| num >= 0.0);
    }
    match &*get_element_type(file, element) {
        b"a" | b"area" => has_jsx_prop_ignore_case(element, "href").is_some(),
        b"button" | b"input" | b"select" | b"textarea" => has_jsx_prop_ignore_case(element, "disabled").is_none(),
        _ => false,
    }
}
