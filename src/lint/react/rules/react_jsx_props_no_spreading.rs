use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::get_jsx_element_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Disallow JSX prop spreading
pub struct JsxPropsNoSpreading {
    ignore_html_tags: bool,
    ignore_custom_tags: bool,
    ignore_explicit_spread: bool,
    exceptions: Vec<Box<[u8]>>,
}

const NO_SPREADING: Message = Message::new("noSpreading", "Prop spreading is forbidden");
const JSX_PROPS_NO_SPREADING: Message = Message::new("", "Prop spreading is forbidden");

impl Rule for JsxPropsNoSpreading {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-props-no-spreading", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxPropsNoSpreading {
            ignore_html_tags: options.str("html") == Some("ignore"),
            ignore_custom_tags: options.str("custom") == Some("ignore"),
            ignore_explicit_spread: options.str("explicitSpread") == Some("ignore"),
            exceptions: options.strings("exceptions").into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let mut spread_attrs = jsx.attrs().iter().filter(|it| it.kind() == PropKind::Spread).peekable();
        if spread_attrs.peek().is_none() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let tag_name = match jsx.tag().map(Expr::kind) {
            // oxlint has `a.b.c`. The original asks for the name of the object, and `a.b` has none.
            Some(ExprKind::Dot { obj, name, .. }) if !is_oxlint && obj.tag() == ExprTag::Dot => {
                Cow::Owned([&b"undefined."[..], name.bytes()].concat())
            }
            _ => get_jsx_element_name(jsx),
        };
        // oxlint asks for a capital letter of ASCII.
        let is_html_tag = if is_oxlint {
            !is_react_component_name(&tag_name)
        } else {
            // `tagName[0]` of a character outside the BMP is half of a surrogate pair, which has no case.
            let (first, size) = strings::wtf8_codepoint_at(&tag_name, 0);
            first <= 0xFFFF && !tag_name.get(..size).is_some_and(text::is_upper_case)
        };
        // `a.b` is both.
        let is_custom_tag = !is_html_tag || strings::contains_char(&tag_name, b'.');
        // oxlint takes `a:b` for a name like others. For the original it is neither.
        let has_name = is_oxlint || !strings::contains_char(&tag_name, b':');
        let is_exception = self.exceptions.iter().any(|exception| **exception == *tag_name);
        if has_name
            && (is_html_tag && self.ignore_html_tags != is_exception
                || is_custom_tag && self.ignore_custom_tags != is_exception)
        {
            return;
        }
        for spread_attr in spread_attrs {
            // `{...{ a, b }}`
            if self.ignore_explicit_spread
                // oxlint sees the parentheses of `{...({ a })}`.
                && let Some(argument) = spread_attr.value().filter(|it| !is_oxlint || !it.is_parenthesized())
                && let ExprKind::Object(properties) = argument.kind()
                && properties.iter().all(|it| it.kind() != PropKind::Spread)
            {
                continue;
            }
            cx.report(spread_attr, if is_oxlint { JSX_PROPS_NO_SPREADING } else { NO_SPREADING });
        }
    }
}
