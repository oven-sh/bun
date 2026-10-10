use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce or disallow spaces inside of curly braces in JSX attributes and expressions
pub struct JsxChildElementSpacing;

const SPACING_AFTER_PREV: Message =
    Message::new("spacingAfterPrev", "Ambiguous spacing after previous element {{element}}");
const SPACING_BEFORE_NEXT: Message =
    Message::new("spacingBeforeNext", "Ambiguous spacing before next element {{element}}");

/// Without `br`: the white space around it does not show.
const INLINE_ELEMENTS: [&str; 30] = [
    "a", "abbr", "acronym", "b", "bdo", "big", "button", "cite", "code", "dfn", "em", "i", "img", "input", "kbd",
    "label", "map", "object", "q", "samp", "script", "select", "small", "span", "strong", "sub", "sup", "textarea",
    "tt", "var",
];

impl Rule for JsxChildElementSpacing {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-child-element-spacing", Kind::Layout);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        JsxChildElementSpacing
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        // Nothing is said but beside an inline element, and few elements have one.
        if !jsx.children().iter().any(|it| inline_element(JsxChild::Expr(it)).is_some()) {
            return;
        }
        let (mut last_child, mut child): (Option<JsxChild<'a>>, Option<JsxChild<'a>>) = (None, None);
        for next_child in jsx.children_with_whitespace().map(Some).chain([None]) {
            if let Some(value) = child.and_then(|it| it.text_value(cx.file())) {
                let around = (last_child.map(inline_element), next_child.map(inline_element));
                if let (Some(Some((element, name))), None | Some(Some(_))) = around
                    && is_text_following_element(&value)
                {
                    cx.report_at(element.span().end, SPACING_AFTER_PREV).data("element", name);
                } else if let (None | Some(Some(_)), Some(Some((element, name)))) = around
                    && is_text_preceding_element(&value)
                {
                    cx.report_at(element.span().start, SPACING_BEFORE_NEXT).data("element", name);
                }
            }
            (last_child, child) = (child, next_child);
        }
    }
}

/// The element and its `elementName`, if `isInlineElement`.
fn inline_element(child: JsxChild<'_>) -> Option<(Expr<'_>, Name<'_>)> {
    let JsxChild::Expr(e) = child else {
        return None;
    };
    let ExprKind::Jsx(jsx) = (e.tag() == ExprTag::Jsx).then(|| e.kind())? else {
        return None;
    };
    let name = jsx.tag()?.as_ident()?;
    (name.is_any(&INLINE_ELEMENTS) && e.jsx_container_span().is_none()).then_some((e, name))
}

/// `/^\s*\n\s*\S/`
fn is_text_following_element(value: &[u8]) -> bool {
    let rest = strings::trim_js_whitespace_start(value);
    let blanks = value.get(..value.len() - rest.len()).unwrap_or_default();
    !rest.is_empty() && strings::contains_char(blanks, b'\n')
}

/// `/\S\s*\n\s*$/`
fn is_text_preceding_element(value: &[u8]) -> bool {
    let rest = strings::trim_js_whitespace_end(value);
    !rest.is_empty() && strings::contains_char(value.get(rest.len()..).unwrap_or_default(), b'\n')
}
