use bun_core::strings;
use crate::a11y::cow_to_ascii_lowercase;
use crate::jsx::{AttributeValue, get_jsx_attribute_name, get_prop_value, to_boolean};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Enforces that elements do not use invalid ARIA state and property values.
pub struct AriaProptypes;

const ARIA_PROPTYPES: Message = Message::new("", "This is not a valid ARIA state and property value for '{{prop_name}}'.");

impl Rule for AriaProptypes {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-proptypes", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AriaProptypes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // Elements are far fewer than properties.
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            for attr in jsx.attrs() {
                let Some(name) = get_jsx_attribute_name(attr) else {
                    continue;
                };
                if !name.get(..5).is_some_and(|it| it.eq_ignore_ascii_case(b"aria-")) {
                    continue;
                }
                let name = cow_to_ascii_lowercase(name);
                let Some(aria_prop_type) = name.get(5..).and_then(get_aria_prop_type) else {
                    continue;
                };
                let is_valid = match get_prop_value(attr) {
                    Some(value) => is_valid_value_for_aria_prop_type(aria_prop_type, value),
                    None => allow_none_value(aria_prop_type),
                };
                if !is_valid {
                    cx.report(attr, ARIA_PROPTYPES).help_with(|| help(aria_prop_type, &name)).data("prop_name", name);
                }
            }
        });
    }
}

#[derive(Copy, Clone)]
enum AriaPropType {
    Id,
    /// Also what can be undefined.
    Boolean,
    String,
    Tristate,
    /// Also an integer.
    Number,
    IdList,
    Token(&'static [&'static str]),
    TokenList(&'static [&'static str]),
}

fn help(aria_prop_type: AriaPropType, prop_name: &[u8]) -> String {
    let (valid_prop_message, tokens): (&str, &[&str]) = match aria_prop_type {
        AriaPropType::Boolean => ("'true' or 'false'", &[]),
        AriaPropType::Tristate => ("'true', 'false', or 'mixed'", &[]),
        AriaPropType::String => ("a string value", &[]),
        AriaPropType::Number if prop_name.starts_with(b"aria-value") => ("a number value", &[]),
        AriaPropType::Number => ("an integer value", &[]),
        AriaPropType::Id => ("a single element ID", &[]),
        AriaPropType::IdList => ("a space-separated list of element IDs", &[]),
        AriaPropType::Token(tokens) => ("one of the following tokens: ", tokens),
        AriaPropType::TokenList(tokens) => ("a space-separated list of the following tokens: ", tokens),
    };
    format!(
        "The valid value for '{}' is: {valid_prop_message}{}.\nYou can find a list of valid ARIA state and property values at https://www.w3.org/TR/wai-aria/#x6-7-definitions-of-states-and-properties-all-aria-attributes",
        bstr::BStr::new(prop_name),
        tokens.join(", "),
    )
}

/// Whether there can be no value: `<button aria-expanded>`.
fn allow_none_value(aria_prop_type: AriaPropType) -> bool {
    match aria_prop_type {
        AriaPropType::Boolean | AriaPropType::Tristate | AriaPropType::String => true,
        AriaPropType::Token(tokens) | AriaPropType::TokenList(tokens) => tokens.contains(&"true"),
        _ => false,
    }
}

fn is_valid_value_for_aria_prop_type(aria_prop_type: AriaPropType, value: AttributeValue) -> bool {
    if !is_target_literal_value(value) {
        return true;
    }
    // It always makes a string.
    let is_template_with_expressions = || {
        (value.as_expression().filter(|it| !it.is_parenthesized()))
            .is_some_and(|it| matches!(it.kind(), ExprKind::Template(template) if template.as_static().is_none()))
    };
    let is_one_of = |tokens: &[&str], token: &[u8]| tokens.iter().any(|it| it.as_bytes() == token);
    match aria_prop_type {
        AriaPropType::Boolean => {
            parse_aria_prop_value_as_string(value, true).is_some_and(|it| matches!(&*it, b"true" | b"false"))
        }
        AriaPropType::Tristate => {
            parse_aria_prop_value_as_string(value, true).is_some_and(|it| matches!(&*it, b"true" | b"false" | b"mixed"))
        }
        AriaPropType::String | AriaPropType::Id => {
            is_template_with_expressions() || parse_aria_prop_value_as_string(value, false).is_some()
        }
        AriaPropType::Number => match parse_aria_prop_value_as_string(value, false) {
            Some(text) => std::str::from_utf8(&text).is_ok_and(|it| it.parse::<f64>().is_ok()),
            None => value.as_expression().is_some_and(|it| it.tag() == ExprTag::Number),
        },
        AriaPropType::IdList => {
            is_template_with_expressions()
                || parse_aria_prop_value_as_string(value, false)
                    .is_some_and(|it| strings::split_unicode_whitespace(&it).next().is_some())
        }
        AriaPropType::Token(valid_tokens) => {
            parse_aria_prop_value_as_string(value, true).is_some_and(|it| is_one_of(valid_tokens, &it))
        }
        AriaPropType::TokenList(valid_tokens) => parse_aria_prop_value_as_string(value, true).is_some_and(|it| {
            let mut tokens = strings::split_unicode_whitespace(&it).peekable();
            tokens.peek().is_some() && tokens.all(|token| is_one_of(valid_tokens, token))
        }),
    }
}

/// In lower case. `boolean_as_string`: `{true}` is `true`, and so is `{!0}`.
fn parse_aria_prop_value_as_string(value: AttributeValue<'_>, boolean_as_string: bool) -> Option<Cow<'_, [u8]>> {
    let of_boolean = |value: bool| Cow::Borrowed(if value { b"true".as_slice() } else { b"false".as_slice() });
    let e = match value {
        AttributeValue::StringLiteral(literal) => return Some(text::to_lower_case(literal.value)),
        _ => value.as_expression().filter(|it| !it.is_parenthesized())?,
    };
    match e.kind() {
        ExprKind::String(value) => Some(text::to_lower_case(value.bytes())),
        ExprKind::Template(template) => Some(text::to_lower_case(template.as_static()?.bytes())),
        ExprKind::True if boolean_as_string => Some(of_boolean(true)),
        ExprKind::False if boolean_as_string => Some(of_boolean(false)),
        ExprKind::Unary { op: UnOp::Not, operand } if boolean_as_string => Some(of_boolean(!to_boolean(operand)?)),
        _ => None,
    }
}

/// Anything else is not looked at, `{null}` neither.
fn is_target_literal_value(value: AttributeValue) -> bool {
    match value {
        AttributeValue::StringLiteral(_) => true,
        AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() => match e.kind() {
            ExprKind::String(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Template(_) => true,
            ExprKind::Unary { op: UnOp::Not, operand } => to_boolean(operand).is_some(),
            _ => false,
        },
        _ => false,
    }
}

/// `prop_name`: without its `aria-`.
fn get_aria_prop_type(prop_name: &[u8]) -> Option<AriaPropType> {
    Some(match prop_name {
        b"activedescendant" | b"details" | b"errormessage" => AriaPropType::Id,
        b"atomic" | b"busy" | b"disabled" | b"modal" | b"multiline" | b"multiselectable" | b"readonly" | b"required"
        | b"expanded" | b"grabbed" | b"hidden" | b"selected" => AriaPropType::Boolean,
        b"braillelabel" | b"brailleroledescription" | b"description" | b"keyshortcuts" | b"label" | b"placeholder"
        | b"roledescription" | b"valuetext" => AriaPropType::String,
        b"checked" | b"pressed" => AriaPropType::Tristate,
        b"colcount" | b"colindex" | b"colspan" | b"level" | b"posinset" | b"rowcount" | b"rowindex" | b"rowspan" | b"setsize"
        | b"valuemax" | b"valuemin" | b"valuenow" => AriaPropType::Number,
        b"controls" | b"describedby" | b"flowto" | b"labelledby" | b"owns" => AriaPropType::IdList,
        b"autocomplete" => AriaPropType::Token(&["none", "inline", "list", "both"]),
        b"current" => AriaPropType::Token(&["page", "step", "location", "date", "time", "true", "false"]),
        b"haspopup" => AriaPropType::Token(&["false", "true", "menu", "listbox", "tree", "grid", "dialog"]),
        b"invalid" => AriaPropType::Token(&["grammar", "false", "spelling", "true"]),
        b"live" => AriaPropType::Token(&["assertive", "off", "polite"]),
        b"orientation" => AriaPropType::Token(&["horizontal", "undefined", "vertical"]),
        b"sort" => AriaPropType::Token(&["ascending", "descending", "none", "other"]),
        b"dropeffect" => AriaPropType::TokenList(&["copy", "execute", "link", "move", "none", "popup"]),
        b"relevant" => AriaPropType::TokenList(&["additions", "all", "removals", "text"]),
        _ => return None,
    })
}
