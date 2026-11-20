use crate::js::ast_nodes::statement_after;
use crate::prelude::*;

/// A `;`, unless the options turn semicolons off.
pub(crate) struct OptionalSemicolon;

impl<'a> Format<'a> for OptionalSemicolon {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().semicolons.is_always() {
            ";".fmt(f);
        }
    }
}

/// The `;` of a statement that ends in a declaration whose body is optional: an overload signature, `declare function`,
/// `declare module "a"`. Without semicolons it stays if a block statement follows, because then the block is the
/// body. Prettier and oxfmt print `function f(): void⏎{}` with `semi: false`.
pub(crate) struct BodilessDeclarationSemicolon<'a>(pub(crate) Stmt<'a>);

impl<'a> Format<'a> for BodilessDeclarationSemicolon<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().semicolons.is_always() || block_follows_bodiless_declaration(self.0) {
            ";".fmt(f);
        }
    }
}

/// The statement that `statement` ends with, if the end of that one is its own: the body of a loop or a label, the
/// last branch of an `if`. The `while` of a `do` comes after its body.
pub(crate) fn tail_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    match statement.kind() {
        StmtKind::If { yes, no, .. } => Some(no.unwrap_or(yes)),
        StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }
        | StmtKind::While { body, .. }
        | StmtKind::With { body, .. }
        | StmtKind::Labeled { body, .. } => Some(body),
        _ => None,
    }
}

/// True if `statement` is, or ends with, a function or module declaration without a body, and the statement after the
/// outermost statement that ends there is a block.
pub(crate) fn block_follows_bodiless_declaration(statement: Stmt<'_>) -> bool {
    let mut last = statement;
    loop {
        match last.kind() {
            StmtKind::Fn(func) if !func.has_body() => break,
            StmtKind::Module(module) if !module.innermost().has_body() => break,
            _ => match tail_statement(last) {
                Some(tail) => last = tail,
                None => return false,
            },
        }
    }
    // `if (a) function f(): void;⏎{}`: the `if` ends where the function does.
    let mut outermost = statement;
    while let Node::Stmt(parent) = outermost.parent()
        && tail_statement(parent) == Some(outermost)
    {
        outermost = parent;
    }
    statement_after(outermost).is_some_and(|next| matches!(next.kind(), StmtKind::Block(_)))
}
