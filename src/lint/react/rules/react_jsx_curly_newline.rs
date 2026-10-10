use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent linebreaks in curly braces in JSX attributes and expressions.
pub struct JsxCurlyNewline {
    multiline: Newlines,
    singleline: Newlines,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Newlines {
    Consistent,
    Require,
    Forbid,
}

const EXPECTED_BEFORE: Message = Message::new("expectedBefore", "Expected newline before '}'.");
const EXPECTED_AFTER: Message = Message::new("expectedAfter", "Expected newline after '{'.");
const UNEXPECTED_BEFORE: Message = Message::new("unexpectedBefore", "Unexpected newline before '}'.");
const UNEXPECTED_AFTER: Message = Message::new("unexpectedAfter", "Unexpected newline after '{'.");

impl Rule for JsxCurlyNewline {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-curly-newline", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        if options.str(0) == Some("never") {
            return JsxCurlyNewline { multiline: Newlines::Forbid, singleline: Newlines::Forbid };
        }
        let raw_option = options.object(0);
        let newlines = |key| match raw_option.str(key) {
            Some("require") => Newlines::Require,
            Some("forbid") => Newlines::Forbid,
            _ => Newlines::Consistent,
        };
        JsxCurlyNewline { multiline: newlines("multiline"), singleline: newlines("singleline") }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        for expression in jsx.attrs().iter().filter_map(Prop::value).chain(jsx.children()) {
            // `{...a}` among the children is a `JSXSpreadChild`.
            if expression.tag() != ExprTag::Spread
                && let Some(container) = expression.jsx_container_span()
            {
                self.validate_curlys(container, expression, cx);
            }
        }
    }
}

impl JsxCurlyNewline {
    /// upstream's `validateCurlys`
    fn validate_curlys<'a>(&self, container: Span, expression: Expr<'a>, cx: &Cx<'a, Self>) {
        let file = cx.file();
        if self.singleline != Newlines::Require && ast_utils::is_on_one_line(file, container) {
            return;
        }
        let left_curly = Span::new(container.start, container.start + 1);
        let right_curly = Span::new(container.end.saturating_sub(1), container.end);
        let inside = left_curly.between(right_curly);
        // The tokens between the braces are those of the expression and of the parentheses around it.
        let tokens = (!expression.is_missing()).then(|| expression.outer_span());
        let after_left_curly = tokens.map_or(inside, |it| left_curly.between(it));
        let before_right_curly = tokens.map_or(inside, |it| it.between(right_curly));
        let has_left_newline = !ast_utils::is_on_one_line(file, after_left_curly);
        let has_right_newline = !ast_utils::is_on_one_line(file, before_right_curly);
        // A `JSXEmptyExpression` is all that is between the braces.
        let is_multiline = !ast_utils::is_on_one_line(file, if tokens.is_some() { expression.span() } else { inside });
        let needs_newlines = match if is_multiline { self.multiline } else { self.singleline } {
            Newlines::Forbid => false,
            Newlines::Require => true,
            Newlines::Consistent => has_left_newline,
        };
        // Not if there is a comment.
        let remove = |fixer: Fixer<'a>, space: Span| {
            strings::trim_js_whitespace(file.slice(space)).is_empty().then(|| fixer.remove(space))
        };

        if has_left_newline && !needs_newlines {
            cx.report(left_curly, UNEXPECTED_AFTER).fix(|fixer| remove(fixer, after_left_curly));
        } else if !has_left_newline && needs_newlines {
            cx.report(left_curly, EXPECTED_AFTER).fix(|fixer| fixer.insert_after(left_curly, "\n"));
        }

        if has_right_newline && !needs_newlines {
            cx.report(right_curly, UNEXPECTED_BEFORE).fix(|fixer| remove(fixer, before_right_curly));
        } else if !has_right_newline && needs_newlines {
            cx.report(right_curly, EXPECTED_BEFORE).fix(|fixer| fixer.insert_before(right_curly, "\n"));
        }
    }
}
