use bun_lint::prelude::*;
use bun_lint::utils::text::{has_line_break, trim_end, trim_start};

/// Require or disallow spacing around embedded expressions of template strings.
pub struct TemplateCurlySpacing {
    always: bool,
}

const EXPECTED_BEFORE: Message = Message::new("expectedBefore", "Expected space(s) before '}'.");
const EXPECTED_AFTER: Message = Message::new("expectedAfter", "Expected space(s) after '${'.");
const UNEXPECTED_BEFORE: Message =
    Message::new("unexpectedBefore", "Unexpected space(s) before '}'.");
const UNEXPECTED_AFTER: Message =
    Message::new("unexpectedAfter", "Unexpected space(s) after '${'.");

impl TemplateCurlySpacing {
    /// `open`: the end of a `${`. `inner`: what is between it and its `}`, without whitespace and
    /// comments.
    fn check<'a>(&self, open: u32, inner: Span, cx: &mut Cx<'a, Self>) {
        let next = inner.start - trim_start(cx.slice(Span::before(open, inner))).len() as u32;
        self.check_gap(
            Span::new(open, next),
            Span::new(open.saturating_sub(2), open),
            EXPECTED_AFTER,
            UNEXPECTED_AFTER,
            cx,
        );

        let close = skip_trivia(cx.text(), inner.end);
        let previous = inner.end + trim_end(cx.slice(Span::after(inner, close))).len() as u32;
        self.check_gap(
            Span::new(previous, close),
            Span::new(close, close + 1),
            EXPECTED_BEFORE,
            UNEXPECTED_BEFORE,
            cx,
        );
    }

    /// `gap`: the whitespace between `delimiter` and the token or the comment next to it.
    fn check_gap<'a>(
        &self,
        gap: Span,
        delimiter: Span,
        expected: Message,
        unexpected: Message,
        cx: &mut Cx<'a, Self>,
    ) {
        if self.always && gap.is_empty() {
            cx.report(delimiter, expected).fix(|fixer| fixer.insert_before(gap, " "));
        } else if !self.always && !gap.is_empty() && !has_line_break(cx.slice(gap)) {
            cx.report(gap, unexpected).fix(|fixer| fixer.remove(gap));
        }
    }
}

impl Rule for TemplateCurlySpacing {
    const META: Meta = Meta::eslint("template-curly-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        TemplateCurlySpacing {
            always: options.str(0) == Some("always"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Template], |rule, e, cx| {
            let ExprKind::Template(template) = e.kind() else {
                return;
            };
            for (i, inner) in template.exprs().iter().enumerate() {
                rule.check(template.quasi_span(i).end, inner.outer_span(), cx);
            }
        });
        on.types([TypeTag::Template], |rule, ty, cx| {
            let Some(template) = ty.as_template() else {
                return;
            };
            for (i, inner) in template.types().iter().enumerate() {
                rule.check(template.quasi_span(i).end, inner.outer_span(), cx);
            }
        });
    }
}
