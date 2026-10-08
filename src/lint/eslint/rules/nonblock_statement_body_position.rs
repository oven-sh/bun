use bun_lint::prelude::*;

/// Enforce the location of single-line statements.
pub struct NonblockStatementBodyPosition {
    of_if: Placement,
    of_else: Placement,
    of_while: Placement,
    of_do: Placement,
    of_for: Placement,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Placement {
    Beside,
    Below,
    Any,
}

const EXPECT_NO_LINEBREAK: Message =
    Message::new("expectNoLinebreak", "Expected no linebreak before this statement.");
const EXPECT_LINEBREAK: Message =
    Message::new("expectLinebreak", "Expected a linebreak before this statement.");

/// `before`: the end of what is before the token that precedes `body`, and the length of that
/// token. `None`: to be looked up.
fn validate_statement<'a>(
    body: Stmt<'a>,
    placement: Placement,
    before: Option<(u32, u32)>,
    cx: &Cx<'a, NonblockStatementBodyPosition>,
) {
    if placement == Placement::Any || matches!(body.kind(), StmtKind::Block(_)) {
        return;
    }
    let token_end = match before {
        Some((end, len)) => skip_trivia(cx.text(), end) + len,
        None => match cx.file().token_before(body) {
            Some(token) => token.end(),
            None => return,
        },
    };
    let between = Span::before(token_end, body.span());
    let is_beside = !text::has_line_break(cx.slice(between));
    if is_beside && placement == Placement::Below {
        cx.report(body, EXPECT_LINEBREAK).fix(|fixer| fixer.insert_before(body, "\n"));
    } else if !is_beside && placement == Placement::Beside {
        cx.report(body, EXPECT_NO_LINEBREAK).fix(|fixer| {
            text::is_blank(fixer.file().slice(between)).then(|| fixer.replace(between, " "))
        });
    }
}

impl NonblockStatementBodyPosition {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // The `)` after `e`.
        let paren_after = |e: Expr<'a>| Some((e.outer_span().end, 1));
        match statement.kind() {
            StmtKind::If { test, yes, no } => {
                validate_statement(yes, self.of_if, paren_after(test), cx);
                if let Some(no) = no
                    && no.tag() != StmtTag::If
                {
                    validate_statement(no, self.of_else, Some((yes.span().end, 4)), cx);
                }
            }
            StmtKind::While { test, body } => {
                validate_statement(body, self.of_while, paren_after(test), cx);
            }
            StmtKind::DoWhile { body, .. } => {
                validate_statement(body, self.of_do, Some((statement.span().start, 2)), cx);
            }
            StmtKind::For { update, body, .. } => {
                validate_statement(body, self.of_for, update.and_then(paren_after), cx);
            }
            StmtKind::ForIn { expr, body, .. } | StmtKind::ForOf { expr, body, .. } => {
                validate_statement(body, self.of_for, paren_after(expr), cx);
            }
            _ => {}
        }
    }
}

impl Rule for NonblockStatementBodyPosition {
    const META: Meta = Meta::eslint("nonblock-statement-body-position", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let overrides = options.object(1).object("overrides");
        let placement = |keyword: &str| match overrides.str(keyword).or_else(|| options.str(0)) {
            Some("below") => Placement::Below,
            Some("any") => Placement::Any,
            _ => Placement::Beside,
        };
        NonblockStatementBodyPosition {
            of_if: placement("if"),
            of_else: placement("else"),
            of_while: placement("while"),
            of_do: placement("do"),
            of_for: placement("for"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts(
            [
                StmtTag::If,
                StmtTag::While,
                StmtTag::DoWhile,
                StmtTag::For,
                StmtTag::ForIn,
                StmtTag::ForOf,
            ],
            Self::check,
        );
    }
}
