use bun_core::strings;
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

/// Each line on which a comment starts, with ESLint's `getLastCommentLineOfBlock`: the last line of the comments that start on it
/// and on the lines that follow one another from there.
fn last_comment_lines_of_blocks<'a>(file: &'a File<'a>) -> Vec<(u32, u32)> {
    let mut lines: Vec<(u32, u32)> = Vec::new();
    for comment in file.comments() {
        let (start, end) = (file.line_of(comment.start()), file.line_of(comment.end()));
        match lines.last_mut() {
            Some(last) if last.0 == start => last.1 = end,
            _ => lines.push((start, end)),
        }
    }
    // A block ends where the one ends that starts on the line after its first comments.
    for i in (0..lines.len()).rev() {
        let (before, after) = lines.split_at_mut(i + 1);
        if let Some(line) = before.last_mut()
            && let Ok(next) = after.binary_search_by_key(&(line.1 + 1), |it| it.0)
            && let Some(next) = after.get(next)
        {
            line.1 = next.1;
        }
    }
    lines
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
                if strings::contains_js_line_break(file.slice(last.span().between(semicolon))) =>
            {
                (last.span().end, semicolon.start)
            }
            _ => (end, after),
        };
        if next_start == after && is_var_keyword(file, after) {
            return;
        }
        let between = file.slice(Span::new(last_end, next_start));
        let no_next_line_token = strings::js_lines(between).count() > 2;
        let has_comments = !strings::is_all_js_whitespace(between);

        if self.is_never {
            if !no_next_line_token || has_comments && comment_end_line(file, file.line_of(last_end) + 1).is_some() {
                return;
            }
            cx.report(statement, UNEXPECTED).fix(|fixer| {
                let mut replacement = Vec::with_capacity(between.len());
                let mut lines = strings::js_lines(between).peekable();
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
            let blocks = cx.state.get_or_insert_with(|| last_comment_lines_of_blocks(file));
            let block = blocks.binary_search_by_key(&(file.line_of(last_end) + 1), |it| it.0);
            last_line = block.ok().and_then(|it| blocks.get(it)).map(|it| it.1);
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
    /// [`last_comment_lines_of_blocks`], once it is asked for.
    type State<'a> = Option<Vec<(u32, u32)>>;

    fn new(options: &Options) -> Self {
        NewlineAfterVar {
            is_never: options.str(0) == Some("never"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.stmts([StmtTag::Var], Self::check_for_blank_line);
        None
    }
}
