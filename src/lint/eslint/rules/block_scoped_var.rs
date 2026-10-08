use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Enforce the use of variables within the scope they are defined.
pub struct BlockScopedVar;

const OUT_OF_SCOPE: Message = Message::new(
    "outOfScope",
    "'{{name}}' declared on line {{definitionLine}} column {{definitionColumn}} is used outside of binding context.",
);

#[derive(Default)]
pub struct State<'a> {
    binding_contexts: AncestorMemo<'a, Span>,
    /// The last statement with several names that declares the symbol.
    declared_in: FxHashMap<Symbol<'a>, Stmt<'a>>,
}

impl BlockScopedVar {
    /// The innermost block, loop, `switch` or static block around `statement`. `None` at the top
    /// level of the file, which nothing is outside of.
    fn binding_context<'a>(statement: Stmt<'a>, cx: &mut Cx<'a, Self>) -> Option<Span> {
        cx.state.binding_contexts.find(Node::Stmt(statement), |_, ancestor| match ancestor {
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

    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = statement.kind() else {
            return;
        };
        if cx.has_reported_too_much() {
            return;
        }
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
                // Each of n declarations can have n references outside its block.
                if context.contains(identifier) || cx.has_reported_too_much() {
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
