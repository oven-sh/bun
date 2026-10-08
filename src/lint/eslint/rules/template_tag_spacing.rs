use bun_lint::prelude::*;

/// Require or disallow spacing between template tags and their literals.
pub struct TemplateTagSpacing {
    is_never: bool,
}

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected space between template tag and template literal.",
);
const MISSING: Message = Message::new(
    "missing",
    "Missing space between template tag and template literal.",
);

/// Whether there is whitespace in `between`, which has nothing but whitespace and comments.
fn has_whitespace<'a>(file: &'a File<'a>, between: Span) -> bool {
    if between.is_empty() {
        return false;
    }
    if file.text().get(between.start as usize) != Some(&b'/') {
        return true;
    }
    let mut at = between.start;
    for comment in file.comments_in(between) {
        if comment.start() > at {
            return true;
        }
        at = comment.end();
    }
    between.end > at
}

impl TemplateTagSpacing {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::TaggedTemplate(call) = e.kind() else {
            return;
        };
        let Some(literal) = call.template() else {
            return;
        };
        let tag_end = match call.type_args().angle_brackets_span() {
            Some(type_args) => type_args.end,
            None => call.callee().outer_span().end,
        };
        let between = Span::new(tag_end, literal.span().start);
        let has_whitespace = has_whitespace(cx.file(), between);
        if self.is_never && has_whitespace {
            cx.report(between, UNEXPECTED).fix(|fixer| {
                let mut text = Vec::new();
                for comment in fixer.file().comments_in(between) {
                    if comment.kind() == TokenKind::Line {
                        return None;
                    }
                    text.extend_from_slice(comment.text());
                }
                Some(fixer.replace(between, text))
            });
        } else if !self.is_never && !has_whitespace {
            cx.report(Span::new(e.span().start, between.end), MISSING)
                .fix(|fixer| fixer.insert_after(Span::empty(tag_end), " "));
        }
    }
}

impl Rule for TemplateTagSpacing {
    const META: Meta = Meta::eslint("template-tag-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        TemplateTagSpacing {
            is_never: options.str(0) != Some("always"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::TaggedTemplate], Self::check);
    }
}
