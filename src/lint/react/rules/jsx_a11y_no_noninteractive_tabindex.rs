use bun_core::strings;
use crate::a11y::{HTML_TAG, is_interactive_element, is_interactive_role};
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case, parse_jsx_value,
};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule checks that non-interactive elements don't have a tabIndex which would make them interactive via keyboard navigation.
pub struct NoNoninteractiveTabindex {
    tags: Vec<String>,
    roles: Vec<String>,
    allow_expression_values: bool,
}

const NO_NONINTERACTIVE_TABINDEX: Message = Message::new("", "`tabIndex` should only be declared on interactive elements.");

impl Rule for NoNoninteractiveTabindex {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-noninteractive-tabindex", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        NoNoninteractiveTabindex {
            tags: config.strings("tags").into_iter().map(String::from).collect(),
            roles: match config.has("roles") {
                true => config.strings("roles").into_iter().map(String::from).collect(),
                false => vec!["tabpanel".to_owned()],
            },
            allow_expression_values: config.bool_or("allowExpressionValues", true),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(tabindex_attr) = has_jsx_prop_ignore_case(jsx_el, "tabIndex") else {
            return;
        };
        let Some(tabindex_value) = get_prop_value(tabindex_attr) else {
            return;
        };
        let Some(tabindex) = parse_jsx_value(tabindex_value) else {
            if matches!(tabindex_value, AttributeValue::ExpressionContainer(_)) && !self.allow_expression_values {
                cx.report(tabindex_attr, NO_NONINTERACTIVE_TABINDEX);
            }
            return;
        };
        if tabindex < 0.0 || tabindex.fract() != 0.0 {
            return;
        }
        let component = get_element_type(cx.file(), jsx_el);
        if self.tags.iter().any(|tag| *tag.as_bytes() == *component)
            || !contains_name(&HTML_TAG, &component)
            || is_interactive_element(&component, jsx_el)
        {
            return;
        }
        let is_allowed = |role: &[u8]| is_interactive_role(role) || self.roles.iter().any(|it| it.as_bytes() == role);
        let has_allowed_role = match has_jsx_prop_ignore_case(jsx_el, "role").and_then(get_prop_value) {
            Some(AttributeValue::StringLiteral(role)) => {
                strings::split_unicode_whitespace(role.value).next().is_some_and(is_allowed)
            }
            Some(AttributeValue::ExpressionContainer(_)) => self.allow_expression_values,
            _ => false,
        };
        if !has_allowed_role {
            cx.report(tabindex_attr, NO_NONINTERACTIVE_TABINDEX);
        }
    }
}
