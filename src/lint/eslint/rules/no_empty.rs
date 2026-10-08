use bun_lint::prelude::*;
use bun_lint::utils::text;

/// Disallow empty block statements.
pub struct NoEmpty {
    allow_empty_catch: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Empty {{type}} statement.");
const SUGGEST_COMMENT: Message =
    Message::new("suggestComment", "Add comment inside empty {{type}} statement.");

impl NoEmpty {
    /// `braces`: a `{ }` without statements or cases. All that can be in it is whitespace and
    /// comments.
    fn check(braces: Span, kind: &'static str, cx: &Cx<'_, Self>) {
        let inside = braces.shrink(1, 1);
        if !text::is_blank(cx.slice(inside)) {
            return;
        }
        cx.report(braces, UNEXPECTED).data("type", kind).suggest_with(
            SUGGEST_COMMENT,
            &[("type", kind.as_bytes())],
            |fixer| fixer.replace(inside, " /* empty */ "),
        );
    }
}

impl Rule for NoEmpty {
    const META: Meta = Meta::eslint("no-empty", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEmpty {
            allow_empty_catch: options.object(0).bool_or("allowEmptyCatch", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Block], |rule, stmt, cx| {
            if stmt.as_block().is_none_or(|body| !body.is_empty()) {
                return;
            }
            if rule.allow_empty_catch
                && let Node::Stmt(parent) = stmt.parent()
                && let StmtKind::Try { handler, .. } = parent.kind()
                && handler == Some(stmt)
            {
                return;
            }
            Self::check(stmt.span(), "block", cx);
        });
        on.stmts([StmtTag::Switch], |_, stmt, cx| {
            let StmtKind::Switch { expr, cases } = stmt.kind() else {
                return;
            };
            if !cases.is_empty() {
                return;
            }
            let source = cx.text();
            let close_paren = skip_trivia(source, expr.outer_span().end);
            let open_brace = skip_trivia(source, close_paren + 1);
            Self::check(Span::new(open_brace, stmt.span().end), "switch", cx);
        });
    }
}
