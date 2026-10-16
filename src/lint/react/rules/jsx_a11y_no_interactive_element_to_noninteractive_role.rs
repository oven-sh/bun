use bun_core::strings;
use crate::a11y::{
    HTML_TAG, NamesByElement, is_interactive_element, is_interactive_role, is_non_interactive_element,
    is_non_interactive_role,
};
use crate::jsx::{as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using a non-interactive WAI-ARIA role on an interactive HTML element. `REVERSED`: an interactive role on a
/// non-interactive element.
pub struct NoElementToOtherRole<const REVERSED: bool = false> {
    allowed_roles: NamesByElement,
}

const OF_LISTS: &[&str] = &["menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"];

impl<const REVERSED: bool> Rule for NoElementToOtherRole<REVERSED> {
    const META: Meta = Meta::oxlint(
        Plugin::JsxA11y,
        if REVERSED { "no-noninteractive-element-to-interactive-role" } else { "no-interactive-element-to-noninteractive-role" },
        Kind::Problem,
    );
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoElementToOtherRole {
            allowed_roles: match (options.is_empty(), REVERSED) {
                (true, false) => NamesByElement::new(&[("tr", &["none", "presentation"]), ("canvas", &["img"])]),
                (true, true) => NamesByElement::new(&[
                    ("ul", OF_LISTS),
                    ("ol", OF_LISTS),
                    ("li", &["menuitem", "menuitemcheckbox", "menuitemradio", "row", "tab", "treeitem"]),
                    ("fieldset", &["radiogroup", "presentation"]),
                ]),
                (false, _) => NamesByElement::of_option(options.object(0), ""),
            },
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(role_attr) = has_jsx_prop_ignore_case(jsx_el, "role") else {
            return;
        };
        let Some(first_role) =
            get_string_literal_prop_value(role_attr).and_then(|it| strings::split_unicode_whitespace(it).next())
        else {
            return;
        };
        let element_type = get_element_type(cx.file(), jsx_el);
        let is_other = || match REVERSED {
            true => is_non_interactive_element(&element_type, jsx_el) && is_interactive_role(first_role),
            false => {
                (*element_type == *b"input" || is_interactive_element(&element_type, jsx_el))
                    && (is_non_interactive_role(first_role) || matches!(first_role, b"presentation" | b"none"))
            }
        };
        if contains_name(&HTML_TAG, &element_type) && !self.allowed_roles.has(&element_type, first_role) && is_other() {
            let message = match REVERSED {
                true => Message::new("", "Non-interactive elements should not be assigned interactive roles."),
                false => Message::new("", "Interactive elements should not be assigned non-interactive roles."),
            };
            cx.report(role_attr, message);
        }
    }
}
