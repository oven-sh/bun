use bun_lint::prelude::*;

/// Disallow unnecessary nested blocks.
pub struct NoLoneBlocks;

const REDUNDANT_BLOCK: Message = Message::new("redundantBlock", "Block is redundant.");
const REDUNDANT_NESTED_BLOCK: Message =
    Message::new("redundantNestedBlock", "Nested block is redundant.");

/// Whether a statement directly in `body` declares something in the scope of the block.
fn has_block_level_binding<'a>(body: List<'a, Stmt<'a>>) -> bool {
    let is_lexical = |statement: Stmt<'a>| match statement.kind() {
        StmtKind::Var(decls) => decls.first().is_some_and(|it| it.var_kind() != VarKind::Var),
        StmtKind::Class(_) => true,
        _ => false,
    };
    let is_function_in_strict_mode = |statement: Stmt<'a>| match statement.kind() {
        StmtKind::Fn(func) => func.has_body() && Node::Stmt(statement).scope().is_strict(),
        _ => false,
    };
    body.iter().any(is_lexical) || body.iter().any(is_function_in_strict_mode)
}

impl NoLoneBlocks {
    fn check<'a>(&self, block: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // A `with` statement has the same tag.
        let StmtKind::Block(body) = block.kind() else {
            return;
        };
        // Whether it is in a block, which the body of a function is too, and alone in it.
        let (is_nested, is_only_child) = match block.parent() {
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Block(siblings) => (true, siblings.len() == 1),
                _ => return,
            },
            Node::Func(func) => (true, func.body_statements().is_some_and(|it| it.len() == 1)),
            Node::File(_) => (false, false),
            Node::Case(case) if case.body().len() != 1 => (false, false),
            _ => return,
        };
        if !is_only_child && cx.language().ecma_version >= 2015 && has_block_level_binding(body) {
            return;
        }
        cx.report(block, if is_nested { REDUNDANT_NESTED_BLOCK } else { REDUNDANT_BLOCK });
    }
}

impl Rule for NoLoneBlocks {
    const META: Meta = Meta::eslint("no-lone-blocks", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLoneBlocks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Block], Self::check);
    }
}
