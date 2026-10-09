use crate::a11y::{HTML_TAG, is_null_literal, is_valid_aria_role};
use crate::jsx::{AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop, is_undefined};
use bun_lint_oxlint::text::{contains_name, split_whitespace};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that elements with ARIA roles use a valid, non-abstract ARIA role.
pub struct AriaRole {
    ignore_non_dom: bool,
    allowed_invalid_roles: Vec<String>,
}

const ARIA_ROLE: Message = Message::new("", "Elements with ARIA roles must use a valid, non-abstract ARIA role.");

impl Rule for AriaRole {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "aria-role", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        AriaRole {
            ignore_non_dom: config.bool_or("ignoreNonDOM", false),
            allowed_invalid_roles: config.strings("allowedInvalidRoles").into_iter().map(String::from).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("role") {
            return;
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let Some(attr) = has_jsx_prop(jsx_el, "role") else {
                return;
            };
            if rule.ignore_non_dom && !contains_name(&HTML_TAG, &get_element_type(cx.file(), jsx_el)) {
                return;
            }
            match get_prop_value(attr) {
                Some(AttributeValue::ExpressionContainer(jsexp)) => {
                    if is_null_literal(jsexp) || is_undefined(jsexp) {
                        cx.report(attr, ARIA_ROLE);
                    }
                }
                Some(AttributeValue::StringLiteral(literal)) => {
                    let is_valid = |word: &[u8]| {
                        is_valid_aria_role(word) || rule.allowed_invalid_roles.iter().any(|it| it.as_bytes() == word)
                    };
                    let mut words = split_whitespace(literal.value).peekable();
                    if words.peek().is_none() || !words.all(is_valid) {
                        cx.report(literal.span, ARIA_ROLE);
                    }
                }
                _ => {
                    cx.report(attr, ARIA_ROLE);
                }
            }
        });
    }
}
