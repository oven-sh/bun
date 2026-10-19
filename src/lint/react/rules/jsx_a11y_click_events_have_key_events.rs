use crate::a11y::{HTML_TAG, is_hidden_from_screen_reader, is_interactive_element, is_presentation_role};
use crate::jsx::{as_jsx_element, get_element_type, has_jsx_prop};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce onClick is accompanied by at least one of the following: onKeyUp, onKeyDown, onKeyPress.
pub struct ClickEventsHaveKeyEvents;

const CLICK_EVENTS_HAVE_KEY_EVENTS: Message =
    Message::new("", "Enforce a clickable non-interactive element has at least one keyboard event listener.");

impl Rule for ClickEventsHaveKeyEvents {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "click-events-have-key-events", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ClickEventsHaveKeyEvents
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("onClick").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_opening_el) = as_jsx_element(e) else {
            return;
        };
        if has_jsx_prop(jsx_opening_el, "onClick").is_none() {
            return;
        }
        let element_type = get_element_type(cx.file(), jsx_opening_el);
        if contains_name(&HTML_TAG, &element_type)
            && !is_hidden_from_screen_reader(cx.file(), jsx_opening_el)
            && !is_presentation_role(jsx_opening_el)
            && !is_interactive_element(&element_type, jsx_opening_el)
            && !["onKeyUp", "onKeyDown", "onKeyPress"].iter().any(|prop| has_jsx_prop(jsx_opening_el, prop).is_some())
        {
            cx.report(jsx_opening_el.opening_span(), CLICK_EVENTS_HAVE_KEY_EVENTS);
        }
    }
}
