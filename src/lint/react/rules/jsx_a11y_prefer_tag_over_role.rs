use bun_core::strings;
use crate::a11y::get_tags_for_role;
use crate::jsx::{as_jsx_element, get_element_type, get_string_literal_prop_value, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces using semantic HTML tags over `role` attribute.
pub struct PreferTagOverRole;

const PREFER_TAG_OVER_ROLE: Message = Message::new("", "Prefer `{{tag}}` over `role` attribute `{{role}}`.");

impl Rule for PreferTagOverRole {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "prefer-tag-over-role", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferTagOverRole
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(attr) = has_jsx_prop_ignore_case(jsx_el, "role") else {
            return;
        };
        let Some(role_values) = get_string_literal_prop_value(attr) else {
            return;
        };
        let jsx_name = get_element_type(cx.file(), jsx_el);
        for role in strings::split_unicode_whitespace(role_values) {
            if get_tags_for_role(role).next().is_none() || get_tags_for_role(role).any(|tag| *tag.as_bytes() == *jsx_name) {
                continue;
            }
            let tags: Vec<&str> = get_tags_for_role(role).collect();
            cx.report(attr, PREFER_TAG_OVER_ROLE).data("tag", tags.join(", ")).data("role", role);
        }
    }
}
