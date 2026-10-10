use bun_lint_oxlint::ast_util::{get_identifier_name, is_react_component_name};
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

struct ForbidPropOptions {
    prop_name: Box<[u8]>,
    /// Empty: for all.
    disallowed_for: Vec<Box<[u8]>>,
    disallowed_values: Option<Vec<Box<[u8]>>>,
    message: Option<Box<[u8]>>,
}

/// Disallow certain props on DOM Nodes.
pub struct ForbidDomProps {
    /// The last of a name counts.
    forbid: Vec<ForbidPropOptions>,
}

const CUSTOM: Message = Message::new("", "{{message}}");
const FORBIDDEN_VALUE: Message =
    Message::new("", "Prop \"{{property}}\" with value \"{{property_value}}\" is forbidden on DOM Nodes");
const FORBIDDEN: Message = Message::new("", "Prop \"{{property}}\" is forbidden on DOM Nodes");

impl Rule for ForbidDomProps {
    const META: Meta = Meta::oxlint(Plugin::React, "forbid-dom-props", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `{ forbid: ["a", { propName: "b", disallowedFor, disallowedValues, message }] }`
    fn new(options: &Options) -> Self {
        let strings =
            |value: &Json| value.as_array().map(|all| all.iter().filter_map(Json::as_str).map(Box::from).collect());
        let item = |item: &Json| {
            Some(ForbidPropOptions {
                prop_name: item.as_str().or_else(|| item.get(b"propName")?.as_str())?.into(),
                disallowed_for: item.get(b"disallowedFor").and_then(strings).unwrap_or_default(),
                disallowed_values: item.get(b"disallowedValues").and_then(strings),
                message: item.get(b"message").and_then(Json::as_str).map(Box::from),
            })
        };
        ForbidDomProps { forbid: options.object(0).array("forbid").iter().filter_map(item).collect() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (is_jsx(file) && !self.forbid.is_empty()).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(tag_name) = get_identifier_name(jsx).map(Name::bytes).filter(|it| !is_react_component_name(it)) else {
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
            if !options.disallowed_for.is_empty() && !options.disallowed_for.iter().any(|it| **it == *tag_name) {
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
