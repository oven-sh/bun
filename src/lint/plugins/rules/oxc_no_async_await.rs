use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the use of `async`/`await`.
pub struct NoAsyncAwait;

const NO_ASYNC: Message = Message::new("", "async is not allowed");

impl Rule for NoAsyncAwait {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-async-await", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAsyncAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|_, func, cx| {
            if !func.is_async() {
                return;
            }
            let file = cx.file();
            let whole = func.estree_span();
            // Where the keyword is looked for.
            let async_span = match (func.owner(), func.name()) {
                (Node::Expr(_), _) if func.is_arrow() => Span::new(whole.start, func.params_span().map_or(whole.end, |it| it.start)),
                (_, Some(id)) => whole.to(id.span()),
                (Node::Member(method), None) => Span::new(method.span().start, method.key().map_or(whole.start, |it| it.inner_span(file).start)),
                // Before the key, also for `{ a: async function () {} }`, where there is nothing.
                (Node::Expr(e), None) => match e.parent() {
                    Node::Prop(property) if !e.is_parenthesized() && !property.is_jsx_attribute() => {
                        Span::new(property.span().start, property.key().map_or(whole.start, |it| it.inner_span(file).start))
                    }
                    _ => whole,
                },
                _ => whole,
            };
            if let Some(start) = find_next_token_within(file, async_span, b"async") {
                cx.report(Span::new(start, start + 5), NO_ASYNC);
            }
        });
    }
}

