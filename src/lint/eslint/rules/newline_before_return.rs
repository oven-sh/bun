use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::text::lines;

/// Require an empty line before `return` statements.
pub struct NewlineBeforeReturn;

const EXPECTED: Message = Message::new("expected", "Expected newline before return statement.");

/// The statement before `stmt` in the list that it is in. `None` where ESLint's `isFirstNode`
/// holds: it is the first of the list, or the whole body of an `if`, a loop or the like.
fn previous_sibling(stmt: Stmt<'_>) -> Option<Stmt<'_>> {
    let siblings = match stmt.parent() {
        Node::File(file) => file.body(),
        Node::Func(func) => func.body_statements()?,
        Node::Case(case) => case.body(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Block(statements) => statements,
            StmtKind::Module(module) => module.body(),
            _ => return None,
        },
        _ => return None,
    };
    siblings.before(stmt.span().start)
}

fn line_breaks(text: &[u8]) -> i32 {
    lines(text).count() as i32 - 1
}

impl NewlineBeforeReturn {
    fn check<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(previous) = previous_sibling(stmt) else {
            return;
        };
        let file = cx.file();
        // From the token before the `return`.
        let gap = Span::new(previous.span().end, stmt.span().start);
        let lines_between = line_breaks(file.slice(gap));
        let has_comments = strings::contains_char(file.slice(gap), b'/');
        let is_below_previous = |offset: u32| file.line_of(gap.start) < file.line_of(offset);
        let is_above_return = |offset: u32| file.line_of(offset) < file.line_of(gap.end);

        let mut comment_lines = 0;
        if has_comments {
            for comment in file.comments_between(previous, stmt) {
                comment_lines += 1;
                if comment.kind() == TokenKind::Block {
                    comment_lines += line_breaks(comment.text());
                }
                // A line that a comment shares with code is not counted twice.
                if !is_below_previous(comment.start()) {
                    comment_lines -= 1;
                }
                if !is_above_return(comment.end()) {
                    comment_lines -= 1;
                }
            }
        }
        if lines_between - comment_lines > 1 {
            return;
        }

        cx.report(stmt, EXPECTED).fix(|fixer| {
            // With comments before the `return`, it is only clear where the line goes if the last
            // one ends on the line of the previous token.
            if has_comments
                && let Some(last) = file.comments_between(previous, stmt).next_back()
                && (is_below_previous(last.end()) || !is_above_return(last.end()))
            {
                return None;
            }
            Some(fixer.insert_before(stmt, if lines_between == 0 { "\n\n" } else { "\n" }))
        });
    }
}

impl Rule for NewlineBeforeReturn {
    const META: Meta = Meta::eslint("newline-before-return", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NewlineBeforeReturn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Return], Self::check);
    }
}
