use bun_core::strings;
use crate::a11y::{
    NamesByElement, cow_to_ascii_lowercase, get_element_implicit_roles, get_static_string_prop_value,
};
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, get_string_literal_prop_value, has_jsx_prop_ignore_case,
    parse_jsx_value,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that code does not include a redundant `role` property, in the case that it's identical to the implicit `role` property
/// of the element type.
pub struct NoRedundantRoles {
    allowed_redundant_roles: NamesByElement,
}

const NO_REDUNDANT_ROLES: Message = Message::new(
    "",
    "The `{{element}}` element has an implicit role of `{{role}}`. Defining this explicitly is redundant and should be avoided.",
);

impl Rule for NoRedundantRoles {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-redundant-roles", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoRedundantRoles { allowed_redundant_roles: NamesByElement::of_option(options.object(0), "") }
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
        let component = get_element_type(cx.file(), jsx_el);
        for role in strings::split_unicode_whitespace(role_values) {
            if let Some(implicit_role) = get_redundant_implicit_role(&component, jsx_el, role)
                && !self.is_allowed_redundant_role(&component, implicit_role)
            {
                cx.report(attr, NO_REDUNDANT_ROLES)
                    .data("element", component.clone())
                    .data("role", implicit_role)
                    .fix(|fixer| fixer.remove(attr));
            }
        }
    }
}

impl NoRedundantRoles {
    fn is_allowed_redundant_role(&self, element: &[u8], role: &str) -> bool {
        (self.allowed_redundant_roles.has_if_named(element, role.as_bytes()))
            .unwrap_or_else(|| element == b"nav" && role == "navigation")
    }
}

fn get_redundant_implicit_role(element: &[u8], jsx_el: Jsx, explicit_role: &[u8]) -> Option<&'static str> {
    let is_explicit = |implicit_role: &&str| explicit_role.eq_ignore_ascii_case(implicit_role.as_bytes());
    match element {
        // Their roles depend on what they are in.
        b"header" | b"footer" | b"main" | b"address" => None,
        b"body" => Some("document").filter(is_explicit),
        b"img" => get_img_implicit_role(jsx_el).filter(is_explicit),
        b"input" => get_input_implicit_role(jsx_el, explicit_role),
        b"select" => Some(get_select_implicit_role(jsx_el)).filter(is_explicit),
        _ => get_element_implicit_roles(element).find(is_explicit),
    }
}

fn get_img_implicit_role(jsx_el: Jsx) -> Option<&'static str> {
    let alt = has_jsx_prop_ignore_case(jsx_el, "alt").and_then(get_string_literal_prop_value);
    let src = has_jsx_prop_ignore_case(jsx_el, "src").and_then(get_static_string_prop_value);
    (!alt.is_some_and(<[u8]>::is_empty) && !src.is_some_and(|src| strings::contains(src, b".svg"))).then_some("img")
}

fn get_select_implicit_role(jsx_el: Jsx) -> &'static str {
    let size = has_jsx_prop_ignore_case(jsx_el, "size").and_then(get_prop_value).and_then(parse_jsx_value);
    let is_multiple = has_jsx_prop_ignore_case(jsx_el, "multiple").is_some_and(jsx_prop_value_is_truthy);
    if is_multiple || size.is_some_and(|size| size > 1.0) {
        "listbox"
    } else {
        "combobox"
    }
}

fn jsx_prop_value_is_truthy(item: Prop) -> bool {
    match get_prop_value(item) {
        None => true,
        Some(AttributeValue::StringLiteral(literal)) => !literal.value.is_empty(),
        Some(AttributeValue::ExpressionContainer(e)) if !e.is_parenthesized() => match e.kind() {
            ExprKind::True => true,
            ExprKind::String(value) => !value.bytes().is_empty(),
            ExprKind::Number(value) => value != 0.0,
            _ => false,
        },
        _ => false,
    }
}

fn get_input_implicit_role(jsx_el: Jsx, explicit_role: &[u8]) -> Option<&'static str> {
    let input_type = has_jsx_prop_ignore_case(jsx_el, "type").and_then(get_static_string_prop_value).unwrap_or(b"text".as_slice());
    let (implicit_role, is_combobox_with_list) = match &*cow_to_ascii_lowercase(input_type) {
        b"button" | b"image" | b"reset" | b"submit" => ("button", false),
        b"checkbox" => ("checkbox", false),
        b"radio" => ("radio", false),
        b"range" => ("slider", false),
        b"number" => ("spinbutton", false),
        b"search" => ("searchbox", true),
        b"email" | b"tel" | b"url" | b"text" | b"" => ("textbox", true),
        _ => return None,
    };
    if explicit_role.eq_ignore_ascii_case(implicit_role.as_bytes()) {
        Some(implicit_role)
    } else {
        let is_combobox = is_combobox_with_list
            && explicit_role.eq_ignore_ascii_case(b"combobox")
            && has_jsx_prop_ignore_case(jsx_el, "list").is_some();
        is_combobox.then_some("combobox")
    }
}
