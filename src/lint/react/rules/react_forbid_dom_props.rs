use bun_lint_oxlint::ast_util::{get_identifier_name, is_react_component_name};
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::context::interpolate_text;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

struct ForbidPropOptions {
    prop_name: Box<[u8]>,
    disallowed_for: Option<Vec<Box<[u8]>>>,
    /// Only oxlint has it.
    disallowed_values: Option<Vec<Box<[u8]>>>,
    message: Option<Box<[u8]>>,
}

/// Disallow certain props on DOM Nodes.
pub struct ForbidDomProps {
    /// The last of a name counts.
    forbid: Vec<ForbidPropOptions>,
}

const PROP_IS_FORBIDDEN: Message = Message::new("propIsForbidden", "Prop \"{{prop}}\" is forbidden on DOM Nodes");
const CUSTOM: Message = Message::new("", "{{message}}");
const FORBIDDEN_VALUE: Message =
    Message::new("", "Prop \"{{property}}\" with value \"{{property_value}}\" is forbidden on DOM Nodes");
const FORBIDDEN: Message = Message::new("", "Prop \"{{property}}\" is forbidden on DOM Nodes");

impl Rule for ForbidDomProps {
    const META: Meta = Meta::plugin(Plugin::React, "forbid-dom-props", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `{ forbid: ["a", { propName: "b", disallowedFor, disallowedValues, message }] }`
    fn new(options: &Options) -> Self {
        let strings =
            |value: &Json| value.as_array().map(|all| all.iter().filter_map(Json::as_str).map(Box::from).collect());
        let item = |item: &Json| {
            Some(ForbidPropOptions {
                prop_name: item.as_str().or_else(|| item.get(b"propName")?.as_str())?.into(),
                disallowed_for: item.get(b"disallowedFor").and_then(strings),
                disallowed_values: item.get(b"disallowedValues").and_then(strings),
                message: item.get(b"message").and_then(Json::as_str).map(Box::from),
            })
        };
        ForbidDomProps { forbid: options.object(0).array("forbid").iter().filter_map(item).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        ((!file.language().is_oxlint || is_jsx(file)) && !self.forbid.is_empty()).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let Some(tag_name) = dom_tag_name(jsx, is_oxlint) else {
            return;
        };
        for attribute in jsx.attrs() {
            let Some((key, prop_name)) = attribute.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            if strings::contains_char(prop_name, b':') {
                continue;
            }
            let Some(options) = self.forbid.iter().rev().find(|it| *it.prop_name == *prop_name) else {
                continue;
            };
            // oxlint takes an empty list for none.
            let disallowed_for = options.disallowed_for.as_deref().filter(|all| !is_oxlint || !all.is_empty());
            if disallowed_for.is_some_and(|all| !all.iter().any(|it| **it == *tag_name)) {
                continue;
            }
            // oxlint points at the name, and has texts of its own.
            if !is_oxlint {
                match options.message.as_deref().filter(|it| !it.is_empty()) {
                    Some(message) => cx.report(attribute, CUSTOM).data("message", custom_message(message, prop_name)),
                    None => cx.report(attribute, PROP_IS_FORBIDDEN).data("prop", prop_name),
                };
                continue;
            }
            let mut prop_value = None;
            if let Some(disallowed_values) = &options.disallowed_values {
                prop_value = get_prop_value(attribute).and_then(static_jsx_string_value);
                if !prop_value.is_some_and(|value| disallowed_values.iter().any(|it| **it == *value)) {
                    continue;
                }
            }
            let span = key.span(cx.file());
            match (&options.message, prop_value) {
                (Some(message), _) => cx.report(span, CUSTOM).data("message", message.to_vec()),
                (None, Some(value)) => {
                    cx.report(span, FORBIDDEN_VALUE).data("property", prop_name).data("property_value", value)
                }
                (None, None) => cx.report(span, FORBIDDEN).data("property", prop_name),
            };
        }
    }
}

/// The name of the element, if that is not a component.
fn dom_tag_name(jsx: Jsx<'_>, is_oxlint: bool) -> Option<&[u8]> {
    let name = match jsx.tag()?.tag() {
        // oxlint has no name for it.
        ExprTag::This if !is_oxlint => b"this".as_slice(),
        _ => get_identifier_name(jsx)?.bytes(),
    };
    // oxlint asks for a capital of ASCII.
    if is_oxlint {
        return (!is_react_component_name(name)).then_some(name);
    }
    // `tag[0] !== tag[0].toUpperCase()`. Half of a surrogate pair has no case.
    let (first, size) = strings::wtf8_codepoint_at(name, 0);
    (first <= 0xFFFF && !text::is_upper_case(name.get(..size)?)).then_some(name)
}

/// ESLint puts `data` into a text of the options as well.
#[cold]
fn custom_message(message: &[u8], prop: &[u8]) -> Vec<u8> {
    match std::str::from_utf8(message) {
        Ok(message) => interpolate_text(message, |name| (name == "prop").then_some(prop)),
        Err(_) => message.to_vec(),
    }
}

fn static_jsx_string_value(value: AttributeValue<'_>) -> Option<&[u8]> {
    match value {
        AttributeValue::StringLiteral(literal) => Some(literal.value),
        AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() => match e.kind() {
            ExprKind::String(value) => Some(value.bytes()),
            ExprKind::Template(template) => template.as_static().map(Name::bytes),
            _ => None,
        },
        _ => None,
    }
}
