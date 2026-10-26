use crate::a11y::{
    HTML_TAG, MOUSE_AND_KEYBOARD_EVENT_HANDLERS, is_disabled_element, is_hidden_from_screen_reader,
    is_interactive_element, is_interactive_role, is_non_interactive_element, is_non_interactive_role,
    is_presentation_role,
};
use crate::jsx::{
    as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop, has_jsx_prop_ignore_case,
};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that elements with interactive roles and interaction handlers (mouse or key press) must be focusable.
pub struct InteractiveSupportsFocus {
    tabbable: Vec<String>,
}

const MUST_BE_TABBABLE: Message = Message::new("", "Elements with the '{{role}}' interactive role must be tabbable.");
const MUST_BE_FOCUSABLE: Message = Message::new("", "Elements with the '{{role}}' interactive role must be focusable.");
const ADD_TAB_INDEX: Message =
    Message::new("", "Add `tabIndex={0}` to make the element reachable via sequential keyboard navigation.");
const ADD_EITHER_TAB_INDEX: Message = Message::new("", "Add `tabIndex={0}` or `tabIndex={-1}` to make the element focusable.");

impl Rule for InteractiveSupportsFocus {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "interactive-supports-focus", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let tabbable = match config.has("tabbable") {
            true => config.strings("tabbable"),
            false => vec!["button", "checkbox", "link", "searchbox", "spinbutton", "switch", "textbox"],
        };
        InteractiveSupportsFocus { tabbable: tabbable.into_iter().map(String::from).collect() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(role) = has_jsx_prop_ignore_case(jsx_el, "role").and_then(get_string_literal_prop_value) else {
            return;
        };
        if !is_interactive_role(role)
            || is_non_interactive_role(role)
            || !MOUSE_AND_KEYBOARD_EVENT_HANDLERS.iter().any(|handler| has_jsx_prop(jsx_el, handler).is_some())
            || is_disabled_element(jsx_el)
            || is_hidden_from_screen_reader(cx.file(), jsx_el)
            || is_presentation_role(jsx_el)
            || has_jsx_prop_ignore_case(jsx_el, "tabIndex").is_some()
        {
            return;
        }
        let element_type = get_element_type(cx.file(), jsx_el);
        if !contains_name(&HTML_TAG, &element_type)
            || is_interactive_element(&element_type, jsx_el)
            || is_non_interactive_element(&element_type, jsx_el)
        {
            return;
        }
        let Some(name) = jsx_el.tag() else {
            return;
        };
        if self.tabbable.iter().any(|it| it.as_bytes() == role) {
            cx.report(jsx_el.opening_span(), MUST_BE_TABBABLE)
                .data("role", role)
                .suggest(ADD_TAB_INDEX, |fixer| fixer.insert_after(name, " tabIndex={0}"));
        } else {
            cx.report(jsx_el.opening_span(), MUST_BE_FOCUSABLE)
                .data("role", role)
                .suggest(ADD_EITHER_TAB_INDEX, |fixer| fixer.insert_after(name, " tabIndex={0}"))
                .suggest(ADD_EITHER_TAB_INDEX, |fixer| fixer.insert_after(name, " tabIndex={-1}"));
        }
    }
}
