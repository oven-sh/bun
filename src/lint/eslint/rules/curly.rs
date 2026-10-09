use bun_core::strings;
use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Enforce consistent brace style for all control statements.
pub struct Curly {
    mode: Mode,
    is_consistent: bool,
}

#[derive(Copy, Clone, PartialEq)]
enum Mode {
    All,
    Multi,
    MultiLine,
    MultiOrNest,
}

const MISSING_CURLY_AFTER: Message =
    Message::new("missingCurlyAfter", "Expected { after '{{name}}'.");
const MISSING_CURLY_AFTER_CONDITION: Message = Message::new(
    "missingCurlyAfterCondition",
    "Expected { after '{{name}}' condition.",
);
const UNEXPECTED_CURLY_AFTER: Message =
    Message::new("unexpectedCurlyAfter", "Unnecessary { after '{{name}}'.");
const UNEXPECTED_CURLY_AFTER_CONDITION: Message = Message::new(
    "unexpectedCurlyAfterCondition",
    "Unnecessary { after '{{name}}' condition.",
);

/// What ESLint's `prepareCheck` returns.
pub struct Check<'a> {
    body: Stmt<'a>,
    name: &'static str,
    has_condition: bool,
    /// The body is a block.
    actual: bool,
    /// Whether it should be one. `None` if it does not matter.
    expected: Option<bool>,
}

/// The line on which the last token of `statement` ends, not counting a `;`.
fn last_line_excluding_semicolon(statement: Stmt<'_>) -> Option<u32> {
    let file = statement.file();
    let last = file.last_token(statement)?;
    let last = match ast_utils::is_semicolon_token(&last) {
        true => file.token_before(last)?,
        false => last,
    };
    Some(file.line_of(last.end()))
}

/// Whether `statement` ends on the line of the token before it.
fn is_collapsed_one_liner(statement: Stmt<'_>) -> bool {
    let file = statement.file();
    let before = file.token_before(statement).map(|it| file.line_of(it.start()));
    before.is_some() && before == last_line_excluding_semicolon(statement)
}

/// oxlint's `is_collapsed_one_liner`: there is no line break between what is written before `statement`, be it a
/// comment, and the end of `statement` without its `;`. So `;` alone on the next line is none.
fn is_collapsed_one_liner_for_oxlint(statement: Stmt<'_>) -> bool {
    let file = statement.file();
    let before = file.text().get(..statement.span().start as usize).unwrap_or_default();
    let before = before.iter().rposition(|it| !it.is_ascii_whitespace()).map_or(0, |it| it as u32 + 1);
    file.line_of(before) == file.line_of(end_without_semicolon_for_oxlint(statement))
}

/// Where the text of `statement` ends without the `;` and the white space at its end. A comment before the `;` is part
/// of it.
fn end_without_semicolon_for_oxlint(statement: Stmt<'_>) -> u32 {
    let last = statement.text().iter().rposition(|it| !it.is_ascii_whitespace() && *it != b';');
    statement.span().start + last.map_or(0, |it| it as u32 + 1)
}

/// oxlint's `is_followed_by_else_keyword`: it skips a character after the block, and wants a space, a `;` or a `{`
/// after the `else`, or where that would be.
fn is_followed_by_else_for_oxlint(block: Stmt<'_>) -> bool {
    let rest = block.file().text().get(block.span().end as usize..).unwrap_or_default();
    let skipped = match rest {
        [b'\r', b'\n', ..] | [b'\n', b'\r', ..] => 2,
        [] => return false,
        _ => strings::wtf8_codepoint_at(rest, 0).1,
    };
    let mut rest = rest.get(skipped..).unwrap_or_default().trim_ascii_start();
    while let Some(after) = rest.strip_prefix(b"else") {
        rest = after;
    }
    matches!(rest.first(), Some(b' ' | b';' | b'{'))
}

fn is_one_liner(statement: Stmt<'_>) -> bool {
    let file = statement.file();
    if file.language().is_oxlint && statement.tag() != StmtTag::Empty {
        return file.line_of(statement.span().start) == file.line_of(end_without_semicolon_for_oxlint(statement));
    }
    statement.tag() == StmtTag::Empty
        || last_line_excluding_semicolon(statement) == Some(statement.file().line_of(statement.span().start))
}

/// Whether what is in the block that `closing` ends needs a `;` after it once the braces are gone.
fn needs_semicolon<'a>(file: &'a File<'a>, closing: Token<'a>) -> bool {
    let (Some(before), Some(after)) = (file.token_before(closing), file.token_after(closing)) else {
        return false;
    };
    if ast_utils::is_semicolon_token(&before) {
        return false;
    }
    // A `;` after a block would be a statement of its own, which an `else` cannot follow. After the
    // body of a function expression or an arrow function it ends the statement.
    let ends_with_block = match utils::get_node_by_range_index(file, before.start()) {
        Node::Stmt(last) => matches!(last.kind(), StmtKind::Block(_)),
        Node::Func(func) => {
            func.kind() == FnKind::Decl && func.body_span().is_some_and(|body| body.end == before.end())
        }
        _ => false,
    };
    if ends_with_block {
        return false;
    }
    file.line_of(before.end()) == file.line_of(after.start())
        || matches!(after.text().first(), Some(b'(' | b'[' | b'/' | b'`' | b'+' | b'-'))
        || before.is_punctuator("++")
        || before.is_punctuator("--")
}

/// The block `body` without its braces.
fn remove_braces<'a>(fixer: Fixer<'a>, body: Stmt<'a>) -> Option<Fix> {
    let (file, span) = (fixer.file(), body.span());
    // oxlint takes the braces away, and puts a space after a `do`.
    if file.language().is_oxlint {
        let is_after_do = matches!(body.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::DoWhile);
        let space: &[u8] = if is_after_do { b" " } else { b"" };
        return Some(fixer.replace(body, [space, file.slice(span.shrink(1, 1))].concat()));
    }
    let needs_preceding_space = file.token_before(body)?.end() == span.start
        && !ast_utils::can_tokens_be_adjacent(file.token_before(body)?, file.tokens_in(body).nth(1)?);
    if needs_semicolon(file, file.last_token(body)?) {
        return None;
    }
    let mut replaced = Vec::with_capacity(span.len() as usize);
    if needs_preceding_space {
        replaced.push(b' ');
    }
    replaced.extend_from_slice(file.slice(span.shrink(1, 1)));
    Some(fixer.replace(body, replaced))
}

impl Curly {
    fn prepare_check<'a>(&self, body: Stmt<'a>, name: &'static str, has_condition: bool) -> Check<'a> {
        let block = body.as_block();
        let only = block.and_then(|it| it.first().filter(|_| it.len() == 1));
        let is_oxlint = body.file().language().is_oxlint;
        let are_braces_necessary = || match is_oxlint {
            true => ast_utils::are_braces_necessary_if(body, || is_followed_by_else_for_oxlint(body)),
            false => ast_utils::are_braces_necessary(body),
        };
        let expected = match self.mode {
            Mode::All => Some(true),
            _ if block.is_some() && (only.is_none() || are_braces_necessary()) => Some(true),
            Mode::Multi => Some(false),
            Mode::MultiLine if is_oxlint => (!is_collapsed_one_liner_for_oxlint(body)).then_some(true),
            Mode::MultiLine => (!is_collapsed_one_liner(body)).then_some(true),
            Mode::MultiOrNest => Some(match only {
                Some(only) => !is_one_liner(only) || body.file().comments_before(only).next().is_some(),
                None => !is_one_liner(body),
            }),
        };
        Check {
            body,
            name,
            has_condition,
            actual: block.is_some(),
            expected,
        }
    }

    fn report<'a>(&self, check: &Check<'a>, cx: &Cx<'a, Self>) {
        let body = check.body;
        match check.expected {
            Some(true) if !check.actual => {
                let message = match check.has_condition {
                    true => MISSING_CURLY_AFTER_CONDITION,
                    false => MISSING_CURLY_AFTER,
                };
                cx.report(body, message)
                    .data("name", check.name)
                    .fix(|fixer| fixer.replace(body, [&b"{"[..], body.text(), b"}"].concat()));
            }
            Some(false) if check.actual => {
                let message = match check.has_condition {
                    true => UNEXPECTED_CURLY_AFTER_CONDITION,
                    false => UNEXPECTED_CURLY_AFTER,
                };
                cx.report(body, message)
                    .data("name", check.name)
                    .fix(|fixer| remove_braces(fixer, body));
            }
            _ => {}
        }
    }

    /// Keeps `check` for [`Curly::report_all`] if there is something to report.
    fn note<'a>(check: Check<'a>, cx: &mut Cx<'a, Self>) {
        if check.expected.is_some_and(|expected| expected != check.actual) {
            cx.state.push(check);
        }
    }

    /// Of bodies that are in each other, only the fix of the outermost can be applied, and each has all the text of its
    /// body. So the outermost come first: a rule that reports more than it can loses what it reports last.
    fn report_all<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut checks = std::mem::take(&mut cx.state);
        utils::sort::sort_unstable_by_key(&mut checks, |it| it.body.span().start);
        for check in &checks {
            self.report(check, cx);
        }
    }

    /// The whole chain of `if`, `else if` and `else` that starts with `first`.
    fn check_if<'a>(&self, first: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(parent) = first.parent()
            && matches!(parent.kind(), StmtKind::If { no, .. } if no == Some(first))
        {
            return;
        }
        let mut checks: SmallVec<[Check<'a>; 4]> = SmallVec::new();
        let mut current = Some(first);
        while let Some(StmtKind::If { yes, no, .. }) = current.map(Stmt::kind) {
            checks.push(self.prepare_check(yes, "if", true));
            current = no;
        }
        if let Some(last) = current {
            checks.push(self.prepare_check(last, "else", false));
        }
        if self.is_consistent {
            let expected = checks.iter().any(|it| it.expected.unwrap_or(it.actual));
            checks.iter_mut().for_each(|it| it.expected = Some(expected));
        }
        for check in checks {
            Self::note(check, cx);
        }
    }

    fn check_loop<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (body, name, has_condition) = match statement.kind() {
            StmtKind::While { body, .. } => (body, "while", true),
            StmtKind::DoWhile { body, .. } => (body, "do", false),
            StmtKind::For { body, .. } => (body, "for", true),
            StmtKind::ForIn { body, .. } => (body, "for-in", false),
            StmtKind::ForOf { body, .. } => (body, "for-of", false),
            _ => return,
        };
        Self::note(self.prepare_check(body, name, has_condition), cx);
    }
}

impl Rule for Curly {
    const META: Meta = Meta::eslint("curly", Kind::Suggestion).fixable(Fixable::Code);
    /// What is to be reported.
    type State<'a> = Vec<Check<'a>>;

    fn new(options: &Options) -> Self {
        Curly {
            mode: match options.str(0) {
                Some("multi") => Mode::Multi,
                Some("multi-line") => Mode::MultiLine,
                Some("multi-or-nest") => Mode::MultiOrNest,
                _ => Mode::All,
            },
            is_consistent: options.str(1) == Some("consistent"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<Check<'a>> {
        const LOOPS: [StmtTag; 5] = [StmtTag::While, StmtTag::DoWhile, StmtTag::For, StmtTag::ForIn, StmtTag::ForOf];
        on.stmts([StmtTag::If], Self::check_if);
        on.stmts(LOOPS, Self::check_loop);
        if file.has_stmts([StmtTag::If]) || file.has_stmts(LOOPS) {
            on.finish(Self::report_all);
        }
        Vec::new()
    }
}
