use crate::a11y::{
    HTML_TAG, MOUSE_AND_KEYBOARD_EVENT_HANDLERS, NamesByElement, get_static_string_prop_value, is_abstract_role_name,
    is_hidden_from_screen_reader, is_interactive_element, is_interactive_role, is_non_interactive_element,
    is_non_interactive_role, is_nullish_value,
};
use crate::jsx::{
    as_jsx_element, get_element_type, get_prop_value, get_string_literal_prop_value, has_jsx_prop, has_jsx_prop_ignore_case,
    parse_jsx_value,
};
use bun_lint_oxlint::text::{contains_name, split_whitespace};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Prevents non-interactive HTML elements and elements with non-interactive ARIA roles from being assigned mouse or keyboard event
/// handlers.
pub struct NoNoninteractiveElementInteractions {
    /// `None`: the recommended ones.
    handlers: Option<Vec<String>>,
    handler_exceptions: NamesByElement,
}

const NO_NONINTERACTIVE_ELEMENT_INTERACTIONS: Message =
    Message::new("", "Non-interactive elements should not be assigned mouse or keyboard event listeners.");

impl Rule for NoNoninteractiveElementInteractions {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-noninteractive-element-interactions", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let (keyboard, load_error): (&[&str], &[&str]) = (&["onKeyUp", "onKeyDown", "onKeyPress"], &["onError", "onLoad"]);
        NoNoninteractiveElementInteractions {
            handlers: (config.get("handlers").and_then(Json::as_array))
                .map(|_| config.strings("handlers").into_iter().map(String::from).collect()),
            handler_exceptions: match options.is_empty() {
                true => NamesByElement::new(&[
                    ("alert", keyboard),
                    ("body", load_error),
                    ("dialog", keyboard),
                    ("iframe", load_error),
                    ("img", load_error),
                ]),
                false => NamesByElement::of_option(config, "handlers"),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            if jsx_el.attrs().is_empty() {
                return;
            }
            let element_type = get_element_type(cx.file(), jsx_el);
            if !contains_name(&HTML_TAG, &element_type) || !rule.has_interactive_handler(jsx_el, &element_type) {
                return;
            }
            let role_value = has_jsx_prop_ignore_case(jsx_el, "role").and_then(get_static_string_prop_value);
            if is_content_editable(jsx_el)
                || is_hidden_from_screen_reader(cx.file(), jsx_el)
                || role_value.map(text::to_lower_case).is_some_and(|role| {
                    matches!(&*role, b"presentation" | b"none") || is_abstract_role_name(&role)
                })
            {
                return;
            }
            let role = role_value.and_then(first_recognized_role);
            let role = role.as_deref();
            if role.is_some_and(|role| is_interactive_role_for_rule(role, jsx_el, &element_type)) {
                return;
            }
            // Of these elements some are also interactive content for HTML: `<iframe>`, `<label>`, `<details>`.
            if (is_non_interactive_element(&element_type, jsx_el)
                || !is_interactive_element(&element_type, jsx_el)
                    && role.is_some_and(|role| is_non_interactive_role_for_rule(role, jsx_el, &element_type)))
                && let Some(name) = jsx_el.tag()
            {
                cx.report(name, NO_NONINTERACTIVE_ELEMENT_INTERACTIONS);
            }
        });
    }
}

impl NoNoninteractiveElementInteractions {
    fn has_interactive_handler(&self, jsx_el: Jsx, element_type: &[u8]) -> bool {
        let is_active = |handler: &str| {
            !self.handler_exceptions.has(element_type, handler.as_bytes())
                && has_jsx_prop(jsx_el, handler).is_some_and(|prop| !get_prop_value(prop).is_some_and(is_nullish_value))
        };
        match &self.handlers {
            Some(handlers) => handlers.iter().any(|it| is_active(it)),
            None => (MOUSE_AND_KEYBOARD_EVENT_HANDLERS.iter().chain(&["onError", "onLoad", "onFocus", "onBlur"]))
                .any(|it| is_active(it)),
        }
    }
}

fn is_content_editable(jsx_el: Jsx) -> bool {
    has_jsx_prop(jsx_el, "contentEditable").and_then(get_string_literal_prop_value).is_some_and(|value| value == b"true")
}

/// A `separator` is a widget if it can have the focus.
fn is_interactive_role_for_rule(role: &[u8], jsx_el: Jsx, element_type: &[u8]) -> bool {
    match role {
        b"separator" => is_focusable(jsx_el, element_type),
        _ => is_interactive_role(role),
    }
}

fn is_non_interactive_role_for_rule(role: &[u8], jsx_el: Jsx, element_type: &[u8]) -> bool {
    match role {
        b"separator" => !is_focusable(jsx_el, element_type),
        _ => is_non_interactive_role(role),
    }
}

fn is_focusable(jsx_el: Jsx, element_type: &[u8]) -> bool {
    let tab_index = has_jsx_prop_ignore_case(jsx_el, "tabIndex").and_then(get_prop_value).and_then(parse_jsx_value);
    if tab_index.is_some_and(f64::is_finite) {
        return true;
    }
    let is_enabled = || has_jsx_prop_ignore_case(jsx_el, "disabled").is_none();
    match element_type {
        b"a" | b"area" => has_jsx_prop_ignore_case(jsx_el, "href").is_some(),
        b"button" | b"select" | b"textarea" => is_enabled(),
        b"input" => {
            let input_type = has_jsx_prop_ignore_case(jsx_el, "type").and_then(get_string_literal_prop_value);
            is_enabled() && !input_type.is_some_and(|value| value.eq_ignore_ascii_case(b"hidden"))
        }
        _ => false,
    }
}

/// In lower case.
fn first_recognized_role(role_value: &[u8]) -> Option<Cow<'_, [u8]>> {
    split_whitespace(role_value).map(text::to_lower_case).find(|role| is_recognized_role(role))
}

fn is_recognized_role(role: &[u8]) -> bool {
    matches!(role, b"presentation" | b"none")
        || is_abstract_role_name(role)
        || is_interactive_role(role)
        || is_non_interactive_role(role)
}
