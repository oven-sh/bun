use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule disallows IIFEs with a parenthesized arrow function body.
pub struct NoUnreadableIife;

const NO_UNREADABLE_IIFE: Message = Message::new("", "IIFE with parenthesized arrow function body is considered unreadable.");
const USE_BLOCK_STATEMENT_BODY: Message = Message::new("", "Use a block statement body.");

impl Rule for NoUnreadableIife {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-unreadable-iife", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnreadableIife
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let FnBody::Expr(expression) = func.body()
            && expression.is_parenthesized()
            && let Node::Expr(callee) = func.owner()
            && matches!(callee.parent(), Node::Expr(e) if e.tag() == ExprTag::Call && e.callee() == Some(callee))
        {
            let (parenthesized_span, body_span) = (expression.outer_span(), expression.span());
            cx.report(parenthesized_span, NO_UNREADABLE_IIFE).suggest(USE_BLOCK_STATEMENT_BODY, |fixer| {
                let file = fixer.file();
                let has_comments_around_body = file.comments_in(Span::new(parenthesized_span.start, body_span.start)).next().is_some()
                    || file.comments_in(Span::new(body_span.end, parenthesized_span.end)).next().is_some();
                if has_comments_around_body {
                    return None;
                }
                Some(fixer.replace(parenthesized_span, [b"{ return ", expression.text(), b"; }"].concat()))
            });
        }
    }
}
