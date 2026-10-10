use crate::a11y::HTML_TAG;
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_jsx_attribute_name, get_prop_value, has_jsx_prop,
};
use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce `onMouseOver`/`onMouseOut` are accompanied by `onFocus`/`onBlur`.
pub struct MouseEventsHaveKeyEvents {
    hover_in_handlers: Vec<String>,
    hover_out_handlers: Vec<String>,
}

const MISS_ON_FOCUS: Message = Message::new("", "`{{attr_name}}` must be accompanied by `onFocus` for accessibility.");
const MISS_ON_BLUR: Message = Message::new("", "`{{attr_name}}` must be accompanied by `onBlur` for accessibility.");

impl Rule for MouseEventsHaveKeyEvents {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "mouse-events-have-key-events", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let handlers = |key: &str, default: &str| match config.has(key) {
            true => config.strings(key).into_iter().map(String::from).collect(),
            false => vec![default.to_owned()],
        };
        MouseEventsHaveKeyEvents {
            hover_in_handlers: handlers("hoverInHandlers", "onMouseOver"),
            hover_out_handlers: handlers("hoverOutHandlers", "onMouseOut"),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_opening_el) = as_jsx_element(e) else {
            return;
        };
        if jsx_opening_el.attrs().is_empty() || !contains_name(&HTML_TAG, &get_element_type(cx.file(), jsx_opening_el)) {
            return;
        }
        check(jsx_opening_el, &self.hover_in_handlers, "onFocus", MISS_ON_FOCUS, cx);
        check(jsx_opening_el, &self.hover_out_handlers, "onBlur", MISS_ON_BLUR, cx);
    }
}

/// It has a value, which is neither `undefined` nor `null`.
fn has_handler_value(attribute: Prop) -> bool {
    match get_prop_value(attribute) {
        Some(AttributeValue::ExpressionContainer(e)) if !e.is_missing() => {
            let expression = get_inner_expression(e);
            !expression.is_ident("undefined") && expression.tag() != ExprTag::Null
        }
        Some(_) => true,
        None => false,
    }
}

/// The first of `handlers` that the element has with a value needs `companion`.
fn check<'a>(
    jsx_opening_el: Jsx<'a>,
    handlers: &[String],
    companion: &str,
    message: Message,
    cx: &Cx<'a, MouseEventsHaveKeyEvents>,
) {
    let has_value = |attr: &Prop<'a>| has_handler_value(*attr);
    let Some(jsx_attr) = handlers.iter().find_map(|handler| has_jsx_prop(jsx_opening_el, handler).filter(has_value)) else {
        return;
    };
    if !has_jsx_prop(jsx_opening_el, companion).is_some_and(has_handler_value) {
        cx.report(jsx_attr, message).data("attr_name", get_jsx_attribute_name(jsx_attr).unwrap_or_default());
    }
}
