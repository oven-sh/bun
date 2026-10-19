use bun_core::strings;
use crate::jsx::{as_jsx_element, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that elements with ARIA roles must have all required attributes for that role.
pub struct RoleHasRequiredAriaProps;

const ROLE_HAS_REQUIRED_ARIA_PROPS: Message = Message::new("", "`{{role}}` role is missing required aria props {{props}}.");

fn required_aria_props(role: &[u8]) -> &'static [&'static str] {
    match role {
        b"checkbox" | b"menuitemcheckbox" | b"menuitemradio" | b"radio" | b"switch" => &["aria-checked"],
        b"combobox" => &["aria-controls", "aria-expanded"],
        b"heading" => &["aria-level"],
        b"meter" | b"slider" => &["aria-valuenow"],
        b"option" => &["aria-selected"],
        b"scrollbar" => &["aria-controls", "aria-valuenow"],
        _ => &[],
    }
}

impl Rule for RoleHasRequiredAriaProps {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "role-has-required-aria-props", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        RoleHasRequiredAriaProps
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(attr) = has_jsx_prop_ignore_case(jsx_el, "role") else {
            return;
        };
        for role in get_string_literal_prop_value(attr).into_iter().flat_map(strings::split_unicode_whitespace) {
            let mut formatted_missing = Vec::new();
            for prop in required_aria_props(role).iter().filter(|prop| has_jsx_prop_ignore_case(jsx_el, prop).is_none()) {
                let separator = if formatted_missing.is_empty() { "`" } else { ", `" };
                formatted_missing.extend_from_slice(separator.as_bytes());
                formatted_missing.extend_from_slice(prop.as_bytes());
                formatted_missing.push(b'`');
            }
            if !formatted_missing.is_empty() {
                cx.report(attr, ROLE_HAS_REQUIRED_ARIA_PROPS).data("role", role).data("props", formatted_missing);
            }
        }
    }
}
