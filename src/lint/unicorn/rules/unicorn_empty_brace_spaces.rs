use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce no spaces between braces.
pub struct EmptyBraceSpaces;

const EMPTY_BRACE_SPACES: Message = Message::new("", "No spaces inside empty pair of braces allowed");

impl Rule for EmptyBraceSpaces {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "empty-brace-spaces", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        EmptyBraceSpaces
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], |_, e, cx| {
            // Not a pattern, nor the attributes of an import.
            if e.span().len() > 2
                && matches!(e.kind(), ExprKind::Object(properties) if properties.is_empty())
                && !matches!(e.parent(), Node::File(_))
                && !e.is_assignment_target()
            {
                check(e.span(), e.span(), "{}", cx);
            }
        });
        on.funcs(|_, func, cx| {
            if matches!(func.body(), FnBody::Block(statements) if statements.is_empty())
                && let Some(braces) = func.body_span()
            {
                match func.kind() {
                    FnKind::StaticBlock => check(braces, func.span(), "static {}", cx),
                    _ => check(braces, braces, "{}", cx),
                }
            }
        });
        on.classes(|_, class, cx| {
            if class.members().is_empty() {
                check(class.body_span(), class.body_span(), "{}", cx);
            }
        });
        on.stmts([StmtTag::Block], |_, block, cx| {
            if block.as_block().is_some_and(|it| it.is_empty()) {
                check(block.span(), block.span(), "{}", cx);
            }
        });
    }
}

/// `braces`: from the `{` to the `}`, with nothing but whitespace and comments in between. `span`: what is reported.
fn check(braces: Span, span: Span, replacement: &'static str, cx: &Cx<EmptyBraceSpaces>) {
    if braces.len() > 2 && cx.file().comments_in(span).next().is_none() {
        cx.report(span, EMPTY_BRACE_SPACES).fix(|fixer| fixer.replace(span, replacement));
    }
}
