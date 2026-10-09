use crate::a11y::{
    cow_to_ascii_lowercase, is_nullish_value, is_valid_aria_property, is_valid_aria_property_for_role, is_valid_aria_role,
};
use crate::jsx::{
    as_jsx_element, get_element_type, get_jsx_attribute_name, get_prop_value, get_string_literal_prop_value,
    has_jsx_prop_ignore_case,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that elements only contain `aria-*` properties supported by their explicit or implicit role.
pub struct RoleSupportsAriaProps;

const DEFAULT: Message = Message::new("", "The attribute `{{attr_name}}` is not supported by the role `{{role}}`.");
const IS_IMPLICIT: Message = Message::new(
    "",
    "The attribute `{{attr_name}}` is not supported by the role `{{role}}`. This role is implicit on the element `{{el_name}}`.",
);

impl Rule for RoleSupportsAriaProps {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "role-supports-aria-props", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RoleSupportsAriaProps
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let is_aria = |attr: Prop| get_jsx_attribute_name(attr).is_some_and(|it| it.get(4) == Some(&b'-'));
            if !jsx_el.attrs().iter().any(is_aria) {
                return;
            }
            let el_type = get_element_type(cx.file(), jsx_el);
            let role = has_jsx_prop_ignore_case(jsx_el, "role");
            let role_value = match role {
                Some(role) => get_string_literal_prop_value(role),
                None => Some(get_implicit_role(jsx_el, &el_type).as_bytes()),
            };
            let Some(role_value) = role_value.filter(|it| is_valid_aria_role(it)) else {
                return;
            };
            for attr in jsx_el.attrs() {
                let Some(name) = get_jsx_attribute_name(attr).map(cow_to_ascii_lowercase) else {
                    continue;
                };
                if !is_valid_aria_property(&name)
                    || get_prop_value(attr).is_some_and(is_nullish_value)
                    || is_valid_aria_property_for_role(role_value, &name)
                {
                    continue;
                }
                let message = if role.is_none() { IS_IMPLICIT } else { DEFAULT };
                cx.report(attr, message).data("attr_name", name).data("role", role_value).data("el_name", el_type.clone());
            }
        });
    }
}

/// Empty if the element has none.
fn get_implicit_role(node: Jsx, element_type: &[u8]) -> &'static str {
    let string_of = |name: &str| has_jsx_prop_ignore_case(node, name).and_then(get_string_literal_prop_value);
    match element_type {
        b"a" | b"area" | b"link" if has_jsx_prop_ignore_case(node, "href").is_some() => "link",
        b"article" => "article",
        b"aside" => "complementary",
        b"body" => "document",
        b"button" => "button",
        b"datalist" | b"select" => "listbox",
        b"details" => "group",
        b"dialog" => "dialog",
        b"form" => "form",
        [b'h', b'1'..=b'6'] => "heading",
        b"hr" => "separator",
        b"img" if string_of("alt").is_none_or(|it| !it.is_empty()) => "img",
        b"input" => match string_of("type") {
            Some(b"button" | b"image" | b"reset" | b"submit") => "button",
            Some(b"checkbox") => "checkbox",
            Some(b"radio") => "radio",
            Some(b"range") => "slider",
            _ => "textbox",
        },
        b"li" => "listitem",
        b"menu" if string_of("type").is_some_and(|it| it == b"toolbar") => "toolbar",
        b"menuitem" => match string_of("type") {
            Some(b"checkbox") => "menuitemcheckbox",
            Some(b"command") => "menuitem",
            Some(b"radio") => "menuitemradio",
            _ => "",
        },
        b"meter" | b"progress" => "progressbar",
        b"nav" => "navigation",
        b"ol" | b"ul" => "list",
        b"option" => "option",
        b"output" => "status",
        b"section" => "region",
        b"tbody" | b"tfoot" | b"thead" => "rowgroup",
        b"textarea" => "textbox",
        _ => "",
    }
}
