use crate::a11y::{RESERVED_HTML_TAG, cow_to_ascii_lowercase, is_valid_aria_property};
use crate::jsx::{as_jsx_element, get_element_type, get_jsx_attribute_name};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that reserved DOM elements do not contain ARIA roles, states, or properties.
pub struct AriaUnsupportedElements;

const ARIA_UNSUPPORTED_ELEMENTS: Message = Message::new("", "This element does not support ARIA roles, states, or properties.");

impl Rule for AriaUnsupportedElements {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-unsupported-elements", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AriaUnsupportedElements
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            if !contains_name(&RESERVED_HTML_TAG, &get_element_type(cx.file(), jsx_el)) {
                return;
            }
            for attr in jsx_el.attrs() {
                let Some(attr_name) = get_jsx_attribute_name(attr).map(cow_to_ascii_lowercase) else {
                    continue;
                };
                if *attr_name == *b"role" || is_valid_aria_property(&attr_name) {
                    cx.report(attr, ARIA_UNSUPPORTED_ELEMENTS).data("attr_name", attr_name).fix(|fixer| fixer.remove(attr));
                }
            }
        });
    }
}
