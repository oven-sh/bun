use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

/// Require or disallow an empty line after variable declarations.
pub struct NewlineAfterVar {
    is_never: bool,
}

const EXPECTED: Message = Message::new("expected", "Expected blank line after variable declarations.");
const UNEXPECTED: Message = Message::new("unexpected", "Unexpected blank line after variable declarations.");

/// ESLint's `commentEndLine[line]`: the line on which the last of the comments that start on `line`
/// ends.
fn comment_end_line<'a>(file: &'a File<'a>, line: u32) -> Option<u32> {
    let span = file.line_span(line);
    file.comments_in(Span::new(span.start, file.span().end))
        .take_while(|comment| comment.start() < span.end)
        .last()
        .map(|comment| file.line_of(comment.end()))
}

/// ESLint's `getLastCommentLineOfBlock`: the last line of the comments that start on
/// `comment_start_line` and on the lines that follow one another from there.
fn get_last_comment_line_of_block<'a>(file: &'a File<'a>, comment_start_line: u32) -> Option<u32> {
    let mut end = comment_end_line(file, comment_start_line)?;
    while let Some(next) = comment_end_line(file, end + 1) {
        end = next;
    }
    Some(end)
}

/// Whether the token at `at` is the keyword `var`, `let` or `const`.
fn is_var_keyword<'a>(file: &'a File<'a>, at: u32) -> bool {
    match file.slice(next_token(file.text(), at)) {
        b"var" | b"const" => true,
        // It can be a name.
        b"let" => file.token_at(at).is_some_and(|token| token.kind() == TokenKind::Keyword),
        _ => false,
    }
}

impl NewlineAfterVar {
    fn check_for_blank_line<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = statement.kind() else {
            return;
        };
        if utils::is_for_init(statement) || statement.is_exported() {
            return;
        }
        let file = cx.file();
        let end = statement.span().end;
        let after = skip_trivia(file.text(), end);
        // It is the last statement of the file or of a block.
        if matches!(file.text().get(after as usize), None | Some(b'}')) {
            return;
        }
        // A semicolon on a line of its own, as some write before a `(`, counts as what follows.
        let (last_end, next_start) = match (statement.semicolon(), declarations.last()) {
            (Some(semicolon), Some(last))
                if text::has_line_break(file.slice(Span::new(last.span().end, semicolon.start))) =>
            {
                (last.span().end, semicolon.start)
            }
            _ => (end, after),
        };
        if next_start == after && is_var_keyword(file, after) {
            return;
        }
        let between = file.slice(Span::new(last_end, next_start));
        let no_next_line_token = text::lines(between).count() > 2;
        let has_comments = !text::is_blank(between);

        if self.is_never {
            if !no_next_line_token || has_comments && comment_end_line(file, file.line_of(last_end) + 1).is_some() {
                return;
            }
            cx.report(statement, UNEXPECTED).fix(|fixer| {
                let mut replacement = Vec::with_capacity(between.len());
                let mut lines = text::lines(between).peekable();
                while let Some(line) = lines.next() {
                    if lines.peek().is_none() {
                        replacement.push(b'\n');
                    }
                    replacement.extend_from_slice(line);
                }
                fixer.replace(Span::new(last_end, next_start), replacement)
            });
            return;
        }

        let mut last_line = None;
        if no_next_line_token {
            if !has_comments {
                return;
            }
            last_line = get_last_comment_line_of_block(file, file.line_of(last_end) + 1);
            if last_line.is_none_or(|line| file.line_of(next_start) > line + 1) {
                return;
            }
        }
        cx.report(statement, EXPECTED).fix(|fixer| {
            let next_line = file.line_of(next_start);
            match last_line.unwrap_or_else(|| file.line_of(last_end)) == next_line {
                true => fixer.insert_before(Span::empty(next_start), "\n\n"),
                false => fixer.insert_before(Span::empty(file.line_span(next_line).start), "\n"),
            }
        });
    }
}

impl Rule for NewlineAfterVar {
    const META: Meta = Meta::eslint("newline-after-var", Kind::Layout).fixable(Fixable::Whitespace).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NewlineAfterVar {
            is_never: options.str(0) == Some("never"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], Self::check_for_blank_line);
    }
}
