use crate::a11y::{HTML_TAG, is_interactive_element};
use crate::jsx::{as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case, parse_jsx_value};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce elements with aria-activedescendant are tabbable.
pub struct AriaActivedescendantHasTabindex;

const ARIA_ACTIVEDESCENDANT_HAS_TABINDEX: Message = Message::new("", "Elements with `aria-activedescendant` must be tabbable.");

impl Rule for AriaActivedescendantHasTabindex {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-activedescendant-has-tabindex", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        AriaActivedescendantHasTabindex
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_opening_el) = as_jsx_element(e) else {
            return;
        };
        if has_jsx_prop_ignore_case(jsx_opening_el, "aria-activedescendant").is_none() {
            return;
        }
        let element_type = get_element_type(cx.file(), jsx_opening_el);
        if !contains_name(&HTML_TAG, &element_type) {
            return;
        }
        match has_jsx_prop_ignore_case(jsx_opening_el, "tabIndex") {
            Some(tab_index_attr) if !is_valid_tab_index_attr(tab_index_attr) => return,
            None if is_interactive_element(&element_type, jsx_opening_el) => return,
            _ => {}
        }
        // Not `<a.b>`, `<a:b>`, `<this>`, which the settings can make an element of HTML.
        let name = jsx_opening_el.tag().filter(|it| match it.kind() {
            ExprKind::Ident(_) => true,
            ExprKind::String(name) => !bun_core::strings::contains_char(name.bytes(), b':'),
            _ => false,
        });
        if let Some(name) = name {
            cx.report(name, ARIA_ACTIVEDESCENDANT_HAS_TABINDEX).data("el_name", name.text());
        }
    }
}

fn is_valid_tab_index_attr(attr: Prop) -> bool {
    get_prop_value(attr).and_then(parse_jsx_value).is_some_and(|parsed_value| parsed_value < -1.0)
}
