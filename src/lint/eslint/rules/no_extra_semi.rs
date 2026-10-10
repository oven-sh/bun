use bun_lint::prelude::*;
use bun_lint::tokens::next_token;
use bun_lint::utils::fix_tracker::FixTracker;

/// Disallow unnecessary semicolons.
pub struct NoExtraSemi;

const UNEXPECTED: Message = Message::new("unexpected", "Unnecessary semicolon.");

/// Whether the `;` at `semicolon` can be removed without turning the statement after it into a
/// directive.
fn is_fixable<'a>(file: &'a File<'a>, semicolon: Span) -> bool {
    let Some(next) = file.token_after(semicolon).filter(|next| next.kind() == TokenKind::String) else {
        return true;
    };
    match utils::get_node_by_range_index(file, next.start()) {
        Node::Expr(string) => match string.parent() {
            Node::Stmt(statement) => !ast_utils::is_top_level_expression_statement(statement),
            _ => true,
        },
        _ => true,
    }
}

fn report(semicolon: Span, cx: &Cx<'_, NoExtraSemi>) {
    cx.report(semicolon, UNEXPECTED).fix(|fixer| {
        // The tokens around it are part of the fix, so that `semi` does not change them in the same pass.
        is_fixable(fixer.file(), semicolon)
            .then(|| FixTracker::new(fixer).retain_surrounding_tokens(semicolon).remove(semicolon))
    });
}

/// ESLint's `checkForPartOfClassBody`, from the token after `at`: every `;` up to the first token
/// that is not a punctuator, or the `}`.
fn check_for_part_of_class_body(mut at: u32, cx: &Cx<'_, NoExtraSemi>) {
    let text = cx.text();
    loop {
        let token = next_token(text, at);
        match text.get(token.start as usize) {
            Some(b';') => report(token, cx),
            Some(b'*') => {}
            // A name, a string, a number, or the end of the body.
            None
            | Some(b'}' | b'#' | b'"' | b'\'' | b'_' | b'$' | b'\\' | 0x80..=0xFF)
            | Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9') => return,
            // An expression starts here, in which it takes the tokens to tell a `/` from a regular expression.
            Some(_) => break,
        }
        at = token.end;
    }
    for token in cx.file().tokens_after(Span::empty(at)) {
        if token.kind() != TokenKind::Punctuator || token.is("}") {
            return;
        }
        if token.is(";") {
            report(token.span(), cx);
        }
    }
}

impl Rule for NoExtraSemi {
    const META: Meta = Meta::eslint("no-extra-semi", Kind::Suggestion)
        .fixable(Fixable::Code)
        .deprecated();
    const ON: On = On::new().stmts(&[StmtTag::Empty]).classes().members();
    no_state!();

    fn new(_: &Options) -> Self {
        NoExtraSemi
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let is_allowed = match statement.parent() {
            Node::Stmt(parent) => matches!(
                parent.kind(),
                StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. }
                    | StmtKind::If { .. }
                    | StmtKind::Labeled { .. }
                    | StmtKind::With { .. }
            ),
            _ => false,
        };
        if !is_allowed {
            report(statement.span(), cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        check_for_part_of_class_body(class.body_span().start + 1, cx);
    }

    // `MethodDefinition`, `PropertyDefinition` and `StaticBlock`, not what only TypeScript has.
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_listened_for = matches!(
            member.kind(),
            MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor
                | MemberKind::StaticBlock
        );
        if is_listened_for
            && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            && !member.is_signature()
        {
            check_for_part_of_class_body(member.span().end, cx);
        }
    }
}
