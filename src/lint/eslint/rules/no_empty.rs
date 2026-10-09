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
    /// comments. `place`: where it is reported.
    fn check(braces: Span, place: Span, kind: &'static str, cx: &Cx<'_, Self>) {
        let inside = braces.shrink(1, 1);
        if !text::is_blank(cx.slice(inside)) {
            return;
        }
        cx.report(place, UNEXPECTED).data("type", kind).suggest_with(
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
            Self::check(stmt.span(), stmt.span(), "block", cx);
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
            let braces = Span::new(open_brace, stmt.span().end);
            if !cx.language().is_oxlint {
                return Self::check(braces, braces, "switch", cx);
            }
            // oxlint points at the whole statement, which a comment does not fill.
            if text::is_blank(cx.slice(braces.shrink(1, 1))) {
                Self::check(braces, stmt.span(), "switch", cx);
            } else {
                cx.report(stmt, UNEXPECTED).data("type", "switch");
            }
        });
    }
}
