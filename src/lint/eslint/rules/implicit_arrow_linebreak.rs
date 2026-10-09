use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce the location of arrow function bodies.
pub struct ImplicitArrowLinebreak {
    is_below: bool,
}

const EXPECTED: Message = Message::new("expected", "Expected a linebreak before this expression.");
const UNEXPECTED: Message =
    Message::new("unexpected", "Expected no linebreak before this expression.");

impl ImplicitArrowLinebreak {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let Some(arrow) = func.arrow_span() else {
            return;
        };
        if !matches!(func.body(), FnBody::Expr(_)) {
            return;
        }
        let body_start = skip_trivia(cx.text(), arrow.end);
        let has_linebreak = strings::contains_js_line_break(cx.slice(Span::after(arrow, body_start)));
        if has_linebreak == self.is_below {
            return;
        }
        let Some(first) = cx.file().token_after(arrow) else {
            return;
        };
        if self.is_below {
            cx.report(first, EXPECTED).fix(|fixer| fixer.insert_before(first, "\n"));
        } else {
            cx.report(first, UNEXPECTED).fix(|fixer| {
                (!fixer.file().comments_exist_between(arrow, first))
                    .then(|| fixer.replace(arrow.between(first.span()), " "))
            });
        }
    }
}

impl Rule for ImplicitArrowLinebreak {
    const META: Meta = Meta::eslint("implicit-arrow-linebreak", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ImplicitArrowLinebreak {
            is_below: options.str(0) == Some("below"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
