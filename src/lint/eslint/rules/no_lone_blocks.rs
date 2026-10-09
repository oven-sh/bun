use bun_lint::prelude::*;

/// Disallow unnecessary nested blocks.
pub struct NoLoneBlocks;

const REDUNDANT_BLOCK: Message = Message::new("redundantBlock", "Block is redundant.");
const REDUNDANT_NESTED_BLOCK: Message =
    Message::new("redundantNestedBlock", "Nested block is redundant.");

/// `list.len() == 1`, without counting a long list for each of its elements.
fn has_one<'a>(list: List<'a, Stmt<'a>>) -> bool {
    let mut rest = list.iter();
    rest.next().is_some() && rest.next().is_none()
}

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
    // What is exported, which is an error here, is in an `ExportNamedDeclaration`.
    let declarations = || body.iter().filter(|it| !it.is_exported());
    declarations().any(is_lexical) || declarations().any(is_function_in_strict_mode)
}

/// The rule of oxlint 1.87. It is about every empty block that is not part of a `try` statement or the body of a loop,
/// and about a block in the body of a function only if each of the two has one statement.
fn check_as_oxlint<'a>(block: Stmt<'a>, body: List<'a, Stmt<'a>>, cx: &mut Cx<'a, NoLoneBlocks>) {
    let parent = block.parent();
    let siblings = match parent {
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Block(siblings) => Some(siblings),
            _ => None,
        },
        Node::Func(func) if func.kind() == FnKind::StaticBlock => func.body_statements(),
        _ => None,
    };
    let message = if siblings.is_some() { REDUNDANT_NESTED_BLOCK } else { REDUNDANT_BLOCK };
    if body.is_empty() {
        let is_needed = matches!(parent, Node::Stmt(it) if it.tag() == StmtTag::Try || it.is_loop());
        if !is_needed && cx.file().comments_in(block).next().is_none() {
            cx.report(block, message);
        }
        return;
    }
    let is_lone = match parent {
        Node::File(_) => true,
        Node::Case(case) => !has_one(case.body()),
        _ => siblings.is_some(),
    };
    let declares = |it: Stmt<'a>| match it.kind() {
        StmtKind::Var(decls) => !it.is_exported() && decls.first().is_some_and(|it| it.var_kind() != VarKind::Var),
        StmtKind::Class(_) | StmtKind::Fn(_) => !it.is_exported(),
        _ => false,
    };
    let is_only_child = || match (parent, siblings) {
        (_, Some(siblings)) => has_one(siblings),
        (Node::Func(func), None) => func.body_statements().is_some_and(|statements| {
            let start = block.span().start;
            has_one(body)
                && statements.after(start).is_none()
                && statements.before(start).is_none_or(|it| it.directive().is_some())
        }),
        _ => false,
    };
    if is_lone && !body.iter().any(declares) || is_only_child() {
        cx.report(block, message);
    }
}

impl NoLoneBlocks {
    fn check<'a>(&self, block: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // A `with` statement has the same tag.
        let StmtKind::Block(body) = block.kind() else {
            return;
        };
        if cx.language().is_oxlint {
            return check_as_oxlint(block, body, cx);
        }
        // Whether it is in a block, which the body of a function is too, and alone in it.
        let (is_nested, is_only_child) = match block.parent() {
            Node::Stmt(parent) => match parent.kind() {
                StmtKind::Block(siblings) => (true, has_one(siblings)),
                _ => return,
            },
            Node::Func(func) => (true, func.body_statements().is_some_and(has_one)),
            Node::File(_) => (false, false),
            Node::Case(case) if !has_one(case.body()) => (false, false),
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
