use bun_core::strings;
use crate::a11y::{
    HTML_TAG, is_abstract_role, is_hidden_from_screen_reader, is_interactive_element, is_interactive_role,
    is_non_interactive_element, is_non_interactive_role, is_null_literal, is_presentation_role,
};
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop, has_jsx_prop_ignore_case,
};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that static HTML elements with event handlers must have appropriate ARIA roles.
pub struct NoStaticElementInteractions {
    handlers: Vec<String>,
    allow_expression_values: bool,
}

const NO_STATIC_ELEMENT_INTERACTIONS: Message = Message::new("", "Static HTML elements with event handlers require a role.");

impl Rule for NoStaticElementInteractions {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-static-element-interactions", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let handlers = match config.get("handlers").and_then(Json::as_array) {
            Some(_) => config.strings("handlers"),
            None => vec!["onClick", "onMouseDown", "onMouseUp", "onKeyPress", "onKeyDown", "onKeyUp"],
        };
        NoStaticElementInteractions {
            handlers: handlers.into_iter().map(String::from).collect(),
            allow_expression_values: config.bool_or("allowExpressionValues", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        // `onClick={null}` is no handler, and neither is `onClick` alone.
        let is_handler = |value: AttributeValue| !matches!(value, AttributeValue::ExpressionContainer(e) if is_null_literal(e));
        let has_handler = |handler: &String| has_jsx_prop(jsx_el, handler).and_then(get_prop_value).is_some_and(is_handler);
        if jsx_el.attrs().is_empty() || !self.handlers.iter().any(has_handler) {
            return;
        }
        let element_type = get_element_type(cx.file(), jsx_el);
        if !contains_name(&HTML_TAG, &element_type)
            || is_hidden_from_screen_reader(cx.file(), jsx_el)
            || is_presentation_role(jsx_el)
            || is_interactive_element(&element_type, jsx_el)
            || is_non_interactive_element(&element_type, jsx_el)
            || is_abstract_role(cx.file(), jsx_el)
        {
            return;
        }
        let has_role = match has_jsx_prop_ignore_case(jsx_el, "role").and_then(get_prop_value) {
            Some(AttributeValue::StringLiteral(role)) => {
                (strings::split_unicode_whitespace(&text::to_lower_case(role.value)).next())
                    .is_some_and(|first_role| is_interactive_role(first_role) || is_non_interactive_role(first_role))
            }
            Some(AttributeValue::ExpressionContainer(_)) => self.allow_expression_values,
            _ => false,
        };
        if !has_role && let Some(name) = jsx_el.tag() {
            cx.report(name, NO_STATIC_ELEMENT_INTERACTIONS);
        }
    }
}
