use bun_lint::prelude::*;

/// Enforce the use of variables within the scope they are defined.
pub struct BlockScopedVar;

const OUT_OF_SCOPE: Message = Message::new(
    "outOfScope",
    "'{{name}}' declared on line {{definitionLine}} column {{definitionColumn}} is used outside of binding context.",
);

/// The innermost block, loop, `switch` or static block around `statement`. `None` at the top level
/// of the file, which nothing is outside of.
fn binding_context(statement: Stmt<'_>) -> Option<Span> {
    Node::Stmt(statement).ancestors().find_map(|ancestor| match ancestor {
        Node::Func(func) if func.kind() == FnKind::StaticBlock => Some(func.owner().span()),
        Node::Func(func) => func.body_span(),
        Node::Stmt(it) => match it.kind() {
            StmtKind::Block(_)
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Switch { .. } => Some(it.span()),
            _ => None,
        },
        _ => None,
    })
}

impl BlockScopedVar {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = statement.kind() else {
            return;
        };
        if declarations.first().is_none_or(|it| it.var_kind() != VarKind::Var) {
            return;
        }
        let Some(context) = binding_context(statement) else {
            return;
        };
        let here = Some(Node::Stmt(statement));
        let mut check_binding = |pat: Pat<'a>| {
            let Some(symbol) = pat.symbol() else {
                return;
            };
            // Of several declarations of a name in the statement, the first stands for all.
            let is_first = symbol.declarations().find(|it| it.parent() == here).is_some_and(
                |it| matches!(it, Declaration::Var(first) if first == pat),
            );
            if !is_first {
                return;
            }
            for reference in symbol.references() {
                let identifier = match reference.node() {
                    Node::Pat(name) => utils::estree_span(name.into()),
                    _ => reference.span(),
                };
                if context.contains(identifier) {
                    continue;
                }
                let definition = cx.position(pat.span().start);
                cx.report(identifier, OUT_OF_SCOPE)
                    .data("name", reference.name())
                    .data("definitionLine", definition.line)
                    .data("definitionColumn", definition.column + 1);
            }
        };
        for declaration in declarations {
            declaration.pat().for_each_binding(&mut check_binding);
        }
    }
}

impl Rule for BlockScopedVar {
    const META: Meta = Meta::eslint("block-scoped-var", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BlockScopedVar
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], Self::check);
    }
}
