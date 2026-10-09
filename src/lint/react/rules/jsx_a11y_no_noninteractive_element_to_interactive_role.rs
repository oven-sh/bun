use crate::a11y::{HTML_TAG, NamesByElement, is_interactive_role, is_non_interactive_element};
use crate::jsx::{as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint_oxlint::text::{contains_name, split_whitespace};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using an interactive WAI-ARIA role on a non-interactive HTML element.
pub struct NoNoninteractiveElementToInteractiveRole {
    allowed_roles: NamesByElement,
}

const NO_NONINTERACTIVE_ELEMENT_TO_INTERACTIVE_ROLE: Message =
    Message::new("", "Non-interactive elements should not be assigned interactive roles.");

impl Rule for NoNoninteractiveElementToInteractiveRole {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-noninteractive-element-to-interactive-role", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let of_lists: &[&str] = &["menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"];
        NoNoninteractiveElementToInteractiveRole {
            allowed_roles: match options.is_empty() {
                true => NamesByElement::new(&[
                    ("ul", of_lists),
                    ("ol", of_lists),
                    ("li", &["menuitem", "menuitemcheckbox", "menuitemradio", "row", "tab", "treeitem"]),
                    ("fieldset", &["radiogroup", "presentation"]),
                ]),
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
                && !rule.allowed_roles.has(&element_type, first_role)
                && is_non_interactive_element(&element_type, jsx_el)
                && is_interactive_role(first_role)
            {
                cx.report(role_attr, NO_NONINTERACTIVE_ELEMENT_TO_INTERACTIVE_ROLE);
            }
        });
    }
}
