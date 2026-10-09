use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::get_jsx_element_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow JSX prop spreading.
pub struct JsxPropsNoSpreading {
    ignore_html_tags: bool,
    ignore_custom_tags: bool,
    ignore_explicit_spread: bool,
    exceptions: Vec<Box<[u8]>>,
}

const JSX_PROPS_NO_SPREADING: Message = Message::new("", "Prop spreading is forbidden");

impl Rule for JsxPropsNoSpreading {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-props-no-spreading", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxPropsNoSpreading {
            ignore_html_tags: options.str("html") == Some("ignore"),
            ignore_custom_tags: options.str("custom") == Some("ignore"),
            ignore_explicit_spread: options.str("explicitSpread") == Some("ignore"),
            exceptions: options.strings("exceptions").into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let mut spread_attrs = jsx.attrs().iter().filter(|it| it.kind() == PropKind::Spread).peekable();
            if spread_attrs.peek().is_none() {
                return;
            }
            let tag_name = get_jsx_element_name(jsx);
            let is_html_tag = !is_react_component_name(&tag_name);
            // `a.b` is both.
            let is_custom_tag = !is_html_tag || strings::contains_char(&tag_name, b'.');
            let is_exception = rule.exceptions.iter().any(|exception| **exception == *tag_name);
            if is_html_tag && rule.ignore_html_tags != is_exception
                || is_custom_tag && rule.ignore_custom_tags != is_exception
            {
                return;
            }
            for spread_attr in spread_attrs {
                // `{...{ a, b }}`
                if rule.ignore_explicit_spread
                    && let Some(argument) = spread_attr.value().filter(|it| !it.is_parenthesized())
                    && let ExprKind::Object(properties) = argument.kind()
                    && properties.iter().all(|it| it.kind() != PropKind::Spread)
                {
                    continue;
                }
                cx.report(spread_attr, JSX_PROPS_NO_SPREADING);
            }
        });
    }
}
