use crate::a11y::{HTML_TAG, NamesByElement, is_interactive_element, is_non_interactive_role};
use crate::jsx::{as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint_oxlint::text::{contains_name, split_whitespace};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using a non-interactive WAI-ARIA role on an interactive HTML element.
pub struct NoInteractiveElementToNoninteractiveRole {
    allowed_roles: NamesByElement,
}

const NO_INTERACTIVE_ELEMENT_TO_NONINTERACTIVE_ROLE: Message =
    Message::new("", "Interactive elements should not be assigned non-interactive roles.");

impl Rule for NoInteractiveElementToNoninteractiveRole {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-interactive-element-to-noninteractive-role", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoInteractiveElementToNoninteractiveRole {
            allowed_roles: match options.is_empty() {
                true => NamesByElement::new(&[("tr", &["none", "presentation"]), ("canvas", &["img"])]),
                false => NamesByElement::of_option(options.object(0), ""),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let Some(role_attr) = has_jsx_prop_ignore_case(jsx_el, "role") else {
                return;
            };
            let Some(first_role) = get_string_literal_prop_value(role_attr).and_then(|it| split_whitespace(it).next()) else {
                return;
            };
            let element_type = get_element_type(cx.file(), jsx_el);
            if contains_name(&HTML_TAG, &element_type)
                && (*element_type == *b"input" || is_interactive_element(&element_type, jsx_el))
                && !rule.allowed_roles.has(&element_type, first_role)
                && (is_non_interactive_role(first_role) || matches!(first_role, b"presentation" | b"none"))
            {
                cx.report(role_attr, NO_INTERACTIVE_ELEMENT_TO_NONINTERACTIVE_ROLE);
            }
        });
    }
}
