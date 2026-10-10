use bun_lint::prelude::*;

/// Require or disallow spacing around the `*` in `yield*` expressions.
pub struct YieldStarSpacing {
    /// `None`: the option is an object without the property, which no spacing satisfies.
    before: Option<bool>,
    after: Option<bool>,
}

const MISSING_BEFORE: Message = Message::new("missingBefore", "Missing space before *.");
const MISSING_AFTER: Message = Message::new("missingAfter", "Missing space after *.");
const UNEXPECTED_BEFORE: Message = Message::new("unexpectedBefore", "Unexpected space before *.");
const UNEXPECTED_AFTER: Message = Message::new("unexpectedAfter", "Unexpected space after *.");

impl Rule for YieldStarSpacing {
    const META: Meta = Meta::eslint("yield-star-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Yield]);
    no_state!();

    fn new(options: &Options) -> Self {
        let (before, after) = match options.get(0) {
            Some(Json::Object(_)) => {
                let object = options.object(0);
                (object.bool("before"), object.bool("after"))
            }
            _ => match options.str(0) {
                Some("before") => (Some(true), Some(false)),
                Some("both") => (Some(true), Some(true)),
                Some("neither") => (Some(false), Some(false)),
                _ => (Some(false), Some(true)),
            },
        };
        YieldStarSpacing { before, after }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(e.kind(), ExprKind::Yield { star: true, .. }) {
            return;
        }
        let text = cx.text();
        let start = e.span().start;
        let keyword = Span::new(start, start + "yield".len() as u32);
        let star = skip_trivia(text, keyword.end);
        let star = Span::new(star, star + 1);
        let next = Span::empty(skip_trivia(text, star.end));

        let has_space = |left: Span, right: Span| left.end < right.start && cx.file().is_space_between(left, right);
        if Some(has_space(keyword, star)) != self.before {
            let is_required = self.before == Some(true);
            let message = if is_required { MISSING_BEFORE } else { UNEXPECTED_BEFORE };
            cx.report(star, message).fix(|fixer| match is_required {
                true => fixer.insert_before(star, " "),
                false => fixer.remove(keyword.between(star)),
            });
        }
        if Some(has_space(star, next)) != self.after {
            let is_required = self.after == Some(true);
            let message = if is_required { MISSING_AFTER } else { UNEXPECTED_AFTER };
            cx.report(star, message).fix(|fixer| match is_required {
                true => fixer.insert_after(star, " "),
                false => fixer.remove(star.between(next)),
            });
        }
    }
}
