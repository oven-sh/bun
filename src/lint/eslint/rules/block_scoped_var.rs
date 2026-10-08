use super::complexity::{Climber, Step};
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

/// Enforce the use of variables within the scope they are defined.
pub struct BlockScopedVar;

const OUT_OF_SCOPE: Message = Message::new(
    "outOfScope",
    "'{{name}}' declared on line {{definitionLine}} column {{definitionColumn}} is used outside of binding context.",
);

#[derive(Default)]
pub struct State<'a> {
    binding_contexts: Climber<'a, Option<Span>>,
    /// The last statement with several names that declares the symbol.
    declared_in: FxHashMap<Symbol<'a>, Stmt<'a>>,
}

impl BlockScopedVar {
    /// The innermost block, loop, `switch` or static block around `statement`. `None` at the top
    /// level of the file, which nothing is outside of.
    fn binding_context<'a>(statement: Stmt<'a>, cx: &mut Cx<'a, Self>) -> Option<Span> {
        let found = |span: Option<Span>| span.map_or(Step::Pass, |it| Step::Stop(Some(it)));
        let context = cx.state.binding_contexts.climb(Node::Stmt(statement), None, |_, ancestor| match ancestor {
            Node::Func(func) if func.kind() == FnKind::StaticBlock => found(Some(func.owner().span())),
            Node::Func(func) => found(func.body_span()),
            Node::Stmt(it) => match it.kind() {
                StmtKind::Block(_)
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::Switch { .. } => found(Some(it.span())),
                _ => Step::Pass,
            },
            _ => Step::Pass,
        });
        context.0
    }

    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = statement.kind() else {
            return;
        };
        let Some(first) = declarations.first().filter(|it| it.var_kind() == VarKind::Var) else {
            return;
        };
        let Some(context) = Self::binding_context(statement, cx) else {
            return;
        };
        let has_one_name = first.pat().tag() == PatTag::Ident && declarations.iter().nth(1).is_none();
        let mut check_binding = |pat: Pat<'a>| {
            let Some(symbol) = pat.symbol() else {
                return;
            };
            // Of several declarations of a name in the statement, the first stands for all.
            if !has_one_name && cx.state.declared_in.insert(symbol, statement) == Some(statement) {
                return;
            }
            let mut definition = None;
            let mut is_inside = |reference: Reference<'a>| {
                let identifier = match reference.node() {
                    Node::Pat(name) => utils::estree_span(name.into()),
                    _ => reference.span(),
                };
                if context.contains(identifier) {
                    return true;
                }
                let definition = *definition.get_or_insert_with(|| cx.position(pat.span().start));
                cx.report(identifier, OUT_OF_SCOPE)
                    .data("name", reference.name())
                    .data("definitionLine", definition.line)
                    .data("definitionColumn", definition.column + 1);
                false
            };
            // They are in source order, but for those in one pattern, which is not partly in a block.
            // So those outside the block are at the two ends.
            let mut references = symbol.references();
            if !references.any(&mut is_inside) {
                return;
            }
            let _ = references.rfind(|&it| is_inside(it));
        };
        for declaration in declarations {
            declaration.pat().for_each_binding(&mut check_binding);
        }
    }
}

impl Rule for BlockScopedVar {
    const META: Meta = Meta::eslint("block-scoped-var", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        BlockScopedVar
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.stmts([StmtTag::Var], Self::check);
        State::default()
    }
}
