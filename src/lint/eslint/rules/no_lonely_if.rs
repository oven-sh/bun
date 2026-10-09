use bun_lint::prelude::*;

/// Disallow `if` statements as the only statement in `else` blocks.
pub struct NoLonelyIf;

const UNEXPECTED_LONELY_IF: Message =
    Message::new("unexpectedLonelyIf", "Unexpected if as the only statement in an else block.");

/// `node` is the only statement of `block`, which is after an `else`.
fn fix<'a>(fixer: Fixer<'a>, node: Stmt<'a>, block: Stmt<'a>) -> Option<Fix> {
    let file = fixer.file();
    let StmtKind::If { yes: consequent, .. } = node.kind() else {
        return None;
    };
    let (outer, inner) = (block.span(), node.span());
    // Comments would be lost.
    if !text::is_blank(file.slice(Span::before(outer.start + 1, inner)))
        || !text::is_blank(file.slice(Span::after(inner, outer.end - 1)))
    {
        return None;
    }
    let last_if_token = file.last_token(consequent)?;
    if consequent.as_block().is_none()
        && !last_if_token.is(";")
        && let Some(after) = file.token_after(block)
        && (file.line_of(consequent.span().end) == file.line_of(after.start())
            || matches!(after.text().first(), Some(b'(' | b'[' | b'/' | b'+' | b'`' | b'-'))
            || last_if_token.is("++")
            || last_if_token.is("--"))
    {
        // No semicolon would be inserted after the `if` statement any more.
        return None;
    }
    let is_next_to_else = file.slice(Span::before(0, outer)).ends_with(b"else");
    let separator: &[u8] = if is_next_to_else { b" " } else { b"" };
    Some(fixer.replace(outer, [separator, node.text()].concat()))
}

fn is_else_if(statement: Stmt) -> bool {
    matches!(statement.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::If)
}

impl Rule for NoLonelyIf {
    const META: Meta = Meta::eslint("no-lonely-if", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLonelyIf
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |_, node, cx| {
            if let Node::Stmt(block) = node.parent()
                && block.as_block().is_some_and(|body| body.iter().nth(1).is_none())
                && let Node::Stmt(outer) = block.parent()
                && matches!(outer.kind(), StmtKind::If { no: Some(no), .. } if no == block)
                && !ast_utils::are_braces_necessary(block)
                // oxlint says nothing after an `else if`.
                && !(cx.language().is_oxlint && is_else_if(outer))
            {
                let whole = node.span();
                // oxlint points at the keyword.
                let end = if cx.language().is_oxlint { whole.start + 2 } else { whole.end };
                cx.report(Span::new(whole.start, end), UNEXPECTED_LONELY_IF).fix(|fixer| fix(fixer, node, block));
            }
        });
    }
}
