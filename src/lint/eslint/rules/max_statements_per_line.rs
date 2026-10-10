use bun_lint::prelude::*;

/// Enforce a maximum number of statements allowed per line.
pub struct MaxStatementsPerLine {
    max: usize,
}

const EXCEED: Message = Message::new(
    "exceed",
    "This line has {{numberOfStatementsOnThisLine}} {{statements}}. Maximum allowed is {{maxStatementsPerLine}}.",
);

#[derive(Default)]
pub struct State {
    last_statement_line: u32,
    number_of_statements_on_this_line: usize,
    first_extra_statement: Option<Span>,
}

/// The range of the statement, if it is one of those that ESLint counts: not a block, not an empty
/// statement, and of what only TypeScript has, only what is exported.
fn counted_span<'a>(node: Node<'a>) -> Option<(Stmt<'a>, Span)> {
    let Node::Stmt(statement) = node else {
        return None;
    };
    if let Some(export) = statement.export_span() {
        return Some((statement, export));
    }
    match statement.kind() {
        StmtKind::Block(_)
        | StmtKind::Empty
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_) => None,
        StmtKind::Fn(func) if !func.has_body() => None,
        _ => Some((statement, statement.span())),
    }
}

/// `if (a) foo();` is one statement, `if (a) foo(); else foo();` is two.
fn is_single_child(statement: Stmt) -> bool {
    let Node::Stmt(parent) = statement.parent() else {
        return false;
    };
    match parent.kind() {
        StmtKind::DoWhile { .. }
        | StmtKind::For { .. }
        | StmtKind::ForIn { .. }
        | StmtKind::ForOf { .. }
        | StmtKind::Labeled { .. }
        | StmtKind::While { .. } => true,
        StmtKind::If { no, .. } => no != Some(statement),
        _ => false,
    }
}

/// The line on which the last token of `span` that is not a `;` ends.
fn actual_last_line<'a>(file: &'a File<'a>, span: Span) -> Option<u32> {
    let text = file.text();
    let from_end = |back: u32| span.end.checked_sub(back).and_then(|at| text.get(at as usize)).copied();
    match (from_end(1), from_end(2)) {
        // Directly after a token.
        (Some(b';'), Some(before)) if before.is_ascii_graphic() && !matches!(before, b';' | b'/') => {
            Some(file.line_of(span.end - 1))
        }
        (Some(b';'), _) => {
            let token = file.tokens_in(span).rfind(ast_utils::is_not_semicolon_token)?;
            Some(file.line_of(token.end()))
        }
        _ => Some(file.line_of(span.end)),
    }
}

impl MaxStatementsPerLine {
    fn report_first_extra_statement_and_clear(&self, cx: &mut Cx<'_, Self>) {
        if let Some(statement) = cx.state.first_extra_statement.take() {
            let count = cx.state.number_of_statements_on_this_line;
            cx.report(statement, EXCEED)
                .data("numberOfStatementsOnThisLine", count)
                .data("maxStatementsPerLine", self.max)
                .data("statements", if count == 1 { "statement" } else { "statements" });
        }
    }
}

const STATEMENTS: NodeTags = NodeTags::new().stmts(&StmtTag::ALL);

impl Rule for MaxStatementsPerLine {
    const META: Meta = Meta::eslint("max-statements-per-line", Kind::Layout).deprecated();
    const ON: On = On::new().enter(STATEMENTS).exit(STATEMENTS).finish();
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        MaxStatementsPerLine {
            max: options.object(0).usize("max").unwrap_or(1),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State> {
        Some(State::default())
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some((statement, span)) = counted_span(node) else {
            return;
        };
        if is_single_child(statement) {
            return;
        }
        let line = cx.line_of(span.start);
        if line == cx.state.last_statement_line {
            cx.state.number_of_statements_on_this_line += 1;
        } else {
            self.report_first_extra_statement_and_clear(cx);
            cx.state.number_of_statements_on_this_line = 1;
            cx.state.last_statement_line = line;
        }
        if cx.state.number_of_statements_on_this_line == self.max.saturating_add(1)
            && cx.state.first_extra_statement.is_none()
        {
            cx.state.first_extra_statement = Some(span);
        }
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, span)) = counted_span(node) else {
            return;
        };
        let Some(line) = actual_last_line(cx.file(), span) else {
            return;
        };
        if line != cx.state.last_statement_line {
            self.report_first_extra_statement_and_clear(cx);
            cx.state.number_of_statements_on_this_line = 1;
            cx.state.last_statement_line = line;
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.report_first_extra_statement_and_clear(cx);
    }
}
