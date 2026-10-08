use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{is_semicolon_token, is_token_on_same_line};
use bun_lint::utils::text::has_line_break;

/// Enforce location of semicolons.
pub struct SemiStyle {
    is_first: bool,
}

const EXPECTED_SEMI_COLON: Message = Message::new(
    "expectedSemiColon",
    "Expected this semicolon to be at {{pos}}.",
);

/// ESLint's `isLastChild`: what follows the statement is a `}`, an `else`, the `while` of a
/// `do`-`while`, a `case`, or the end of the file.
fn is_last_child(statement: Stmt<'_>) -> bool {
    let siblings = match statement.parent() {
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::If { yes, no: Some(_), .. } if yes == statement => return true,
            StmtKind::DoWhile { .. } => return true,
            StmtKind::Block(statements) => statements,
            _ => return false,
        },
        Node::File(file) => file.body(),
        Node::Func(func) => match func.body_statements() {
            Some(statements) => statements,
            None => return false,
        },
        Node::Case(case) => case.body(),
        _ => return false,
    };
    siblings.last() == Some(statement)
}

/// The first `;` after `end`, which is the end of a node in the head of a `for`.
fn semicolon_after<'a>(file: &'a File<'a>, end: u32) -> Option<Span> {
    let at = skip_trivia(file.text(), end);
    match file.text().get(at as usize) {
        Some(b';') => Some(Span::new(at, at + 1)),
        _ => file.tokens_after(Span::empty(end)).find(is_semicolon_token).map(Token::span),
    }
}

fn check<'a>(cx: &Cx<'a, SemiStyle>, semicolon: Span, expects_first: bool) {
    let file = cx.file();
    let text = file.text();
    // Most are decided by the text next to the semicolon.
    if expects_first {
        let next = skip_trivia(text, semicolon.end);
        if next as usize >= text.len() || !has_line_break(file.slice(Span::new(semicolon.end, next))) {
            return;
        }
    } else {
        let before = semicolon.start.checked_sub(1).and_then(|at| text.get(at as usize));
        if before.is_none_or(|c| c.is_ascii_graphic() && *c != b'/') {
            return;
        }
    }
    let previous = file.token_before(semicolon);
    let next = file.token_after(semicolon);
    if !expects_first && previous.is_none_or(|it| is_token_on_same_line(file, it, semicolon)) {
        return;
    }
    cx.report(semicolon, EXPECTED_SEMI_COLON)
        .data(
            "pos",
            if expects_first { "the beginning of the next line" } else { "the end of the previous line" },
        )
        .fix(|fixer| {
            if let (Some(previous), Some(next)) = (previous, next)
                && file.comments_exist_between(previous, next)
            {
                return None;
            }
            let start = previous.map_or(semicolon.start, Token::end);
            let end = next.map_or(semicolon.end, Token::start);
            Some(fixer.replace(Span::new(start, end), if expects_first { "\n;" } else { ";\n" }))
        });
}

impl SemiStyle {
    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(semicolon) = statement.semicolon() else {
            return;
        };
        let tag = statement.tag();
        // ESLint has an `ExportNamedDeclaration` around an exported declaration.
        let is_in_export = (tag == StmtTag::Var || is_declaration(tag)) && statement.is_exported();
        if (is_declaration(tag) && !is_in_export) || statement.is_wrapper() {
            return;
        }
        if !(self.is_first && is_last_child(statement)) {
            check(cx, semicolon, self.is_first);
        }
        // The `VariableDeclaration` in it ends with the same semicolon, and is nobody's last child.
        if tag == StmtTag::Var && is_in_export {
            check(cx, semicolon, self.is_first);
        }
    }

    fn check_for<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::For { init, test, .. } = statement.kind() else {
            return;
        };
        let ends = [
            init.map(|init| match init.kind() {
                StmtKind::Expr(e) => e.outer_span().end,
                _ => init.span().end,
            }),
            test.map(|test| test.outer_span().end),
        ];
        for end in ends.into_iter().flatten() {
            if let Some(semicolon) = semicolon_after(cx.file(), end) {
                check(cx, semicolon, false);
            }
        }
    }

    /// ESLint's `PropertyDefinition`.
    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() != MemberKind::Property || !member.text().ends_with(b";") {
            return;
        }
        let Node::Class(class) = member.parent() else {
            return;
        };
        if member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            || (self.is_first && class.members().last() == Some(member))
        {
            return;
        }
        let end = member.span().end;
        check(cx, Span::new(end - 1, end), self.is_first);
    }
}

/// What ESLint checks only as the `declaration` of an `ExportNamedDeclaration`.
fn is_declaration(tag: StmtTag) -> bool {
    matches!(tag, StmtTag::Fn | StmtTag::TypeAlias | StmtTag::Module | StmtTag::ImportEquals)
}

impl Rule for SemiStyle {
    const META: Meta = Meta::eslint("semi-style", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        SemiStyle {
            is_first: options.str(0) == Some("first"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.stmts(
            [
                StmtTag::Break,
                StmtTag::Continue,
                StmtTag::Debugger,
                StmtTag::DoWhile,
                StmtTag::ExportStar,
                StmtTag::ExportDefault,
                StmtTag::ExportNamed,
                StmtTag::Expr,
                StmtTag::Import,
                StmtTag::Return,
                StmtTag::Throw,
                StmtTag::Var,
            ],
            Self::check_statement,
        );
        if !file.is_javascript() {
            on.stmts(
                [StmtTag::Fn, StmtTag::TypeAlias, StmtTag::Module, StmtTag::ImportEquals],
                Self::check_statement,
            );
        }
        on.stmts([StmtTag::For], Self::check_for);
        on.members(Self::check_member);
    }
}
